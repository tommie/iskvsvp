import { alea } from 'seedrandom'
import type {
  InputParameters,
  SimulationResult,
  SimulationResults,
  SimulationStatistics,
  SimulationPeriodData,
  SimulationSummary,
  Histogram,
} from './types'

const ISK_TAX_RATE_MIN = 0.0125

/**
 * Generate a random number from a normal distribution using Box-Muller transform.
 */
function randomNormal(mean: number, stdDev: number, rng: () => number): number {
  const u1 = rng()
  const u2 = rng()
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z0 * stdDev
}

/**
 * Cholesky decomposition of a symmetric positive definite matrix.
 * Returns the lower triangular matrix L such that A = L * L^T
 */
function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length
  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < j; k++) {
        sum += L[i]![k]! * L[j]![k]!
      }

      if (i === j) {
        L[i]![j] = Math.sqrt(matrix[i]![i]! - sum)
      } else {
        L[i]![j] = (matrix[i]![j]! - sum) / L[j]![j]!
      }
    }
  }

  return L
}

/**
 * Generate correlated normal random variables using Cholesky decomposition.
 */
function sampleCorrelatedNormals(
  means: number[],
  stdDevs: number[],
  correlationMatrix: number[][],
  rng: () => number,
): number[] {
  const n = means.length

  // Generate independent standard normal samples
  const z: number[] = []
  for (let i = 0; i < n; i++) {
    z.push(randomNormal(0, 1, rng))
  }

  // Compute Cholesky decomposition of correlation matrix
  const L = choleskyDecomposition(correlationMatrix)

  // Transform to correlated samples
  const samples: number[] = []
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j <= i; j++) {
      sum += L[i]![j]! * z[j]!
    }
    samples.push(means[i]! + stdDevs[i]! * sum)
  }

  return samples
}

interface AssetPosition {
  value: number
  costBasis: number
}

/**
 * Run a single simulation for a single scenario (ISK or VP).
 * Returns period-by-period data and cumulative snapshots.
 */
export function runSingleSimulation(params: InputParameters): SimulationResult<number> {
  const rng = alea(params.seed)
  const isISK = params.iskTaxRate !== undefined

  // Initialize asset positions
  const assetPositions: AssetPosition[] = params.assets.map((asset) => ({
    value: params.initialCapital * asset.weight,
    costBasis: params.initialCapital * asset.weight,
  }))

  let amount = params.initialCapital
  let cumulativePaidTax = 0
  let accumulatedRealWithdrawal = 0
  let accumulatedNominalWithdrawal = 0
  let currentIskTaxRate = params.iskTaxRate ?? 0
  const yearlyAmounts: number[] = [params.initialCapital]
  let peakAmount = params.initialCapital
  let currentDrawdownStart: number | null = null
  let maxDrawdown = 0
  let maxDrawdownPeriod = 0

  let cumulativeInflation = 1
  let firstYearWithdrawalReal = 0

  // Arrays to store period data (per-period values)
  const periodWithdrawals: number[] = []
  const periodWithdrawalsReal: number[] = []
  const periodWithdrawalRates: number[] = []
  const periodTaxes: number[] = []
  const periodTaxationDegrees: number[] = []
  const periodIskTaxRates: number[] = []
  const assetReturnRatesHistory: number[][] = []
  const periodInflationRates: number[] = []

  // Arrays to store snapshots (cumulative data)
  const snapshotCapitals: number[] = []
  const snapshotLiquidValues: number[] = []
  const snapshotTotalValues: number[] = []
  const snapshotMaxDrawdowns: number[] = []
  const snapshotMaxDrawdownPeriods: number[] = []
  const snapshotWithdrawals: number[] = []
  const snapshotWithdrawalsReal: number[] = []
  const snapshotTaxes: number[] = []
  const snapshotTaxationDegrees: number[] = []
  const snapshotIskTaxRates: number[] = []

  for (let i = 0; i < params.yearsLater; i++) {
    // Generate stochastic parameters
    const inflationRate = randomNormal(params.inflationRate, params.inflationStdDev, rng)
    const assetReturns = sampleCorrelatedNormals(
      params.assets.map((a) => a.expectedReturn),
      params.assets.map((a) => a.volatility),
      params.assetCorrelationMatrix,
      rng,
    )

    cumulativeInflation *= 1 + inflationRate

    // Update ISK tax rate if ISK (random walk)
    if (isISK && params.iskTaxRateStdDev) {
      const taxRateChange = randomNormal(0, params.iskTaxRateStdDev, rng)
      currentIskTaxRate = Math.max(
        ISK_TAX_RATE_MIN,
        Math.min(1.0, currentIskTaxRate + taxRateChange),
      )
    }

    // Step 1: Apply returns to each asset
    for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
      const position = assetPositions[assetIdx]!
      const assetReturn = assetReturns[assetIdx]!
      position.value *= 1 + assetReturn
    }

    amount = assetPositions.reduce((sum, pos) => sum + pos.value, 0)

    // Step 2: Handle deposits or withdrawals
    let withdrawn = 0
    let withdrawalRate = 0
    let withdrawalTax = 0

    if (i < params.depositYears) {
      // Deposit years: add inflation-adjusted deposit to portfolio
      const deposit = params.depositAmount * cumulativeInflation

      // Distribute deposit across assets according to their weights
      for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
        const position = assetPositions[assetIdx]!
        const asset = params.assets[assetIdx]!
        const assetDeposit = deposit * asset.weight
        position.value += assetDeposit
        position.costBasis += assetDeposit
      }

      amount = assetPositions.reduce((sum, pos) => sum + pos.value, 0)
    } else {
      // Withdrawal years: calculate and execute withdrawals
      const balanceWithdrawal = amount * params.balanceWithdrawalRate

      let profitWithdrawal = 0
      if (i > 0 && params.profitWithdrawalRate > 0) {
        const lookbackYears = Math.min(params.profitLookbackYears, yearlyAmounts.length - 1)
        if (lookbackYears > 0) {
          const oldAmount = yearlyAmounts[yearlyAmounts.length - 1 - lookbackYears]!
          const totalProfit = amount - oldAmount
          const averageAnnualProfit = totalProfit / lookbackYears
          profitWithdrawal = Math.max(0, averageAnnualProfit * params.profitWithdrawalRate)
        }
      }

      const inflationWithdrawal = params.inflationBasedWithdrawal * cumulativeInflation
      withdrawn = balanceWithdrawal + profitWithdrawal + inflationWithdrawal
      withdrawalRate = amount > 0 ? withdrawn / amount : 0
    }

    // Step 3: Execute withdrawals (if not in deposit years)
    if (withdrawn > 0 && params.assetRebalanceFrequency === 'annually' && amount > 0) {
      let remainingToWithdraw = withdrawn
      const targetValues = params.assets.map((asset) => amount * asset.weight)

      // First pass: withdraw from overweight assets
      for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
        const position = assetPositions[assetIdx]!
        const targetValue = targetValues[assetIdx]!
        const targetAfterWithdrawal = targetValue * (1 - withdrawn / amount)

        if (position.value > targetAfterWithdrawal && remainingToWithdraw > 0) {
          const excessAmount = Math.min(position.value - targetAfterWithdrawal, remainingToWithdraw)
          const withdrawalFraction = excessAmount / position.value

          if (!isISK) {
            const costBasisWithdrawn = position.costBasis * withdrawalFraction
            const gainOnWithdrawal = excessAmount - costBasisWithdrawn
            if (gainOnWithdrawal > 0) {
              withdrawalTax += gainOnWithdrawal * params.capitalGainsTaxRate
            }
          }

          position.value -= excessAmount
          position.costBasis *= 1 - withdrawalFraction
          remainingToWithdraw -= excessAmount
        }
      }

      // Second pass: withdraw proportionally if needed
      if (remainingToWithdraw > 0.001) {
        const currentTotal = assetPositions.reduce((sum, pos) => sum + pos.value, 0)

        for (const position of assetPositions) {
          const proportionalWithdrawal = (position.value / currentTotal) * remainingToWithdraw
          const withdrawalFraction = proportionalWithdrawal / position.value

          if (!isISK) {
            const costBasisWithdrawn = position.costBasis * withdrawalFraction
            const gainOnWithdrawal = proportionalWithdrawal - costBasisWithdrawn
            if (gainOnWithdrawal > 0) {
              withdrawalTax += gainOnWithdrawal * params.capitalGainsTaxRate
            }
          }

          position.value -= proportionalWithdrawal
          position.costBasis *= 1 - withdrawalFraction
        }
      }
    } else if (withdrawn > 0) {
      // No rebalancing: withdraw proportionally
      for (const position of assetPositions) {
        const withdrawalFraction = withdrawn / amount
        const amountWithdrawn = position.value * withdrawalFraction

        if (!isISK) {
          const costBasisWithdrawn = position.costBasis * withdrawalFraction
          const gainOnWithdrawal = amountWithdrawn - costBasisWithdrawn
          if (gainOnWithdrawal > 0) {
            withdrawalTax += gainOnWithdrawal * params.capitalGainsTaxRate
          }
        }

        position.value -= amountWithdrawn
        position.costBasis *= 1 - withdrawalFraction
      }
    }

    amount = assetPositions.reduce((sum, pos) => sum + pos.value, 0)

    // Step 4: Rebalance remaining portfolio
    let rebalancingTax = 0
    if (params.assetRebalanceFrequency === 'annually' && i > 0 && amount > 0) {
      const targetValues = params.assets.map((asset) => amount * asset.weight)

      // Sell overweight assets
      for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
        const position = assetPositions[assetIdx]!
        const targetValue = targetValues[assetIdx]!

        if (position.value > targetValue + 0.01) {
          const sellValue = position.value - targetValue
          const sellFraction = sellValue / position.value

          if (!isISK) {
            const gainOnSale = sellValue - position.costBasis * sellFraction
            if (gainOnSale > 0) {
              rebalancingTax += gainOnSale * params.capitalGainsTaxRate
            }
          }

          position.value = targetValue
          position.costBasis *= 1 - sellFraction
        }
      }

      // Buy underweight assets
      for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
        const position = assetPositions[assetIdx]!
        const targetValue = targetValues[assetIdx]!

        if (position.value < targetValue - 0.01) {
          const buyValue = targetValue - position.value
          position.value = targetValue
          position.costBasis += buyValue
        }
      }
    }

    // Step 5: Calculate and pay tax
    let tax: number
    if (isISK) {
      tax = amount * currentIskTaxRate * params.capitalGainsTaxRate
    } else {
      const fundTax = amount * params.vpWealthTaxRate * params.capitalGainsTaxRate
      tax = fundTax + withdrawalTax + rebalancingTax
    }

    tax = Math.min(Math.max(0, tax), amount)

    // Pay tax
    for (const position of assetPositions) {
      const taxFraction = tax / amount
      const taxFromAsset = position.value * taxFraction
      position.value -= taxFromAsset
      position.costBasis *= 1 - taxFraction
    }

    amount = assetPositions.reduce((sum, pos) => sum + pos.value, 0)

    // Calculate liquidation value
    let liquidValue: number
    if (isISK) {
      liquidValue = amount
    } else {
      const totalCostBasis = assetPositions.reduce((sum, pos) => sum + pos.costBasis, 0)
      const unrealizedGain = amount - totalCostBasis
      liquidValue = amount - unrealizedGain * params.capitalGainsTaxRate
    }

    cumulativePaidTax += tax

    const taxationDegree = liquidValue > 0 ? cumulativePaidTax / liquidValue : 0
    const withdrawnReal = withdrawn / cumulativeInflation

    accumulatedRealWithdrawal += withdrawnReal
    accumulatedNominalWithdrawal += withdrawn

    // Store first year withdrawal (first year after deposits end)
    // If profit withdrawal is enabled, wait one more year for profit calculation to be meaningful
    const firstWithdrawalYear =
      params.profitWithdrawalRate > 0 ? params.depositYears + 1 : params.depositYears
    if (i === firstWithdrawalYear) {
      firstYearWithdrawalReal = withdrawnReal
    }

    // Store period data (this period's values)
    periodWithdrawals.push(withdrawn)
    periodWithdrawalsReal.push(withdrawnReal)
    periodWithdrawalRates.push(withdrawalRate)
    periodTaxes.push(tax)
    periodTaxationDegrees.push(taxationDegree)
    periodIskTaxRates.push(currentIskTaxRate)
    assetReturnRatesHistory.push([...assetReturns])
    periodInflationRates.push(inflationRate)

    // Track drawdown
    if (amount > peakAmount) {
      peakAmount = amount
      if (currentDrawdownStart !== null) {
        const drawdownPeriod = i - currentDrawdownStart
        maxDrawdownPeriod = Math.max(maxDrawdownPeriod, drawdownPeriod)
        currentDrawdownStart = null
      }
    } else if (amount < peakAmount) {
      const drawdown = (peakAmount - amount) / peakAmount
      maxDrawdown = Math.max(maxDrawdown, drawdown)

      if (currentDrawdownStart === null) {
        currentDrawdownStart = i
      }
    }

    // Store snapshot data (cumulative values as of this period)
    snapshotCapitals.push(amount)
    snapshotLiquidValues.push(liquidValue)
    snapshotTotalValues.push(liquidValue + accumulatedNominalWithdrawal)
    snapshotMaxDrawdowns.push(maxDrawdown)
    snapshotMaxDrawdownPeriods.push(maxDrawdownPeriod)
    snapshotWithdrawals.push(accumulatedNominalWithdrawal)
    snapshotWithdrawalsReal.push(accumulatedRealWithdrawal)
    snapshotTaxes.push(cumulativePaidTax)
    snapshotTaxationDegrees.push(taxationDegree)
    snapshotIskTaxRates.push(currentIskTaxRate)

    // Track yearly amount for profit calculation
    yearlyAmounts.push(amount)
  }

  // Handle final drawdown period if still in drawdown
  if (currentDrawdownStart !== null) {
    const currentDrawdownPeriod = params.yearsLater - 1 - currentDrawdownStart
    maxDrawdownPeriod = Math.max(maxDrawdownPeriod, currentDrawdownPeriod)
  }

  return {
    periodData: {
      withdrawal: periodWithdrawals,
      withdrawalReal: periodWithdrawalsReal,
      withdrawalRate: periodWithdrawalRates,
      tax: periodTaxes,
      taxationDegree: periodTaxationDegrees,
      iskTaxRate: periodIskTaxRates,
      assetReturnRates: assetReturnRatesHistory,
      inflationRate: periodInflationRates,
    },
    snapshots: {
      capital: snapshotCapitals,
      liquidValue: snapshotLiquidValues,
      totalValue: snapshotTotalValues,
      maxDrawdown: snapshotMaxDrawdowns,
      maxDrawdownPeriod: snapshotMaxDrawdownPeriods,
      withdrawal: snapshotWithdrawals,
      withdrawalReal: snapshotWithdrawalsReal,
      withdrawalRate: periodWithdrawalRates, // No cumulative rate, use period values
      tax: snapshotTaxes,
      taxationDegree: snapshotTaxationDegrees,
      iskTaxRate: snapshotIskTaxRates,
      assetReturnRates: assetReturnRatesHistory, // Same as period data
      inflationRate: periodInflationRates, // Same as period data
    },
  }
}

/**
 * Calculate statistics from an array of values.
 */
function calculateStats(values: number[]): {
  mean: number
  stdDev: number
  percentile5: number
  percentile25: number
  median: number
  percentile75: number
  percentile95: number
} {
  const sorted = values.slice().sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((a, b) => a + b, 0) / n

  return {
    mean,
    stdDev: Math.sqrt(sorted.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n),
    percentile5: sorted[Math.floor(n * 0.05)] ?? 0,
    percentile25: sorted[Math.floor(n * 0.25)] ?? 0,
    median: sorted[Math.floor(n * 0.5)] ?? 0,
    percentile75: sorted[Math.floor(n * 0.75)] ?? 0,
    percentile95: sorted[Math.floor(n * 0.95)] ?? 0,
  }
}

/**
 * Create a histogram from an array of values.
 */
function createHistogram(values: number[], bucketCount: number = 50): Histogram {
  if (values.length === 0) {
    return { lowest: 0, uppers: [], buckets: [] }
  }

  const sorted = values.slice().sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  const range = max - min

  if (range === 0) {
    return { lowest: min, uppers: [max], buckets: [values.length] }
  }

  const bucketSize = range / bucketCount
  const buckets = Array(bucketCount).fill(0)
  const uppers: number[] = []

  for (let i = 0; i < bucketCount; i++) {
    uppers.push(min + (i + 1) * bucketSize)
  }

  for (const value of values) {
    const bucketIndex = Math.min(Math.floor((value - min) / bucketSize), bucketCount - 1)
    buckets[bucketIndex]!++
  }

  return { lowest: min, uppers, buckets }
}

/**
 * Calculate statistics for a SimulationResult field across all simulations.
 */
function calculateResultStatistics<K extends keyof SimulationPeriodData>(
  results: SimulationResult<number>[],
  field: K,
  periodIndex: number,
): SimulationStatistics<number> {
  const values = results
    .map((r) => {
      const value = r.periodData[field][periodIndex]
      return Array.isArray(value) ? value[0] : value
    })
    .filter((v): v is number => v !== undefined)
  return calculateStats(values)
}

/**
 * Run Monte Carlo simulations for multiple parameter sets.
 * Returns aggregated histograms, statistics, and median samples.
 */
export function simulateAll(
  paramSets: InputParameters[],
  labels: string[],
  onProgress?: (progress: number) => void,
): SimulationResults {
  const allResults: SimulationResult<number>[][] = []

  // Run simulations for each parameter set
  for (let setIdx = 0; setIdx < paramSets.length; setIdx++) {
    const params = paramSets[setIdx]!
    const results: SimulationResult<number>[] = []

    for (let i = 0; i < params.simulationCount; i++) {
      const params2 = { ...params, seed: params.seed + i.toString() }
      results.push(runSingleSimulation(params2))

      if (onProgress && i % 100 === 0) {
        const overallProgress =
          ((setIdx * params.simulationCount + i) / (paramSets.length * params.simulationCount)) *
          100
        onProgress(overallProgress)
      }
    }

    allResults.push(results)
  }

  if (onProgress) {
    onProgress(100)
  }

  // Calculate histograms, statistics, and median samples for each parameter set
  const histograms: SimulationResult<number[]>[] = []
  const statistics: SimulationStatistics<SimulationResult<number>>[] = []
  const medianSamples: SimulationResult<number>[] = []

  for (const results of allResults) {
    const firstResult = results[0]!
    const numPeriods = firstResult.periodData.withdrawal.length

    // Helper to calculate statistics for a specific field at a specific period
    const calcStatsForField = <T extends 'periodData' | 'snapshots'>(
      dataType: T,
      field: keyof SimulationPeriodData,
      periodIdx: number,
    ): {
      mean: number
      stdDev: number
      p5: number
      p25: number
      median: number
      p75: number
      p95: number
    } => {
      const values = results
        .map((r) => {
          const val = r[dataType][field][periodIdx]
          return Array.isArray(val) ? val[0] : val
        })
        .filter((v): v is number => v !== undefined && isFinite(v))

      if (values.length === 0) {
        return { mean: 0, stdDev: 0, p5: 0, p25: 0, median: 0, p75: 0, p95: 0 }
      }

      const stats = calculateStats(values)
      return {
        mean: stats.mean,
        stdDev: stats.stdDev,
        p5: stats.percentile5,
        p25: stats.percentile25,
        median: stats.median,
        p75: stats.percentile75,
        p95: stats.percentile95,
      }
    }

    // Create histograms for each period
    const histogramResult: SimulationResult<number[]> = {
      periodData: {
        withdrawal: [],
        withdrawalReal: [],
        withdrawalRate: [],
        tax: [],
        taxationDegree: [],
        iskTaxRate: [],
        assetReturnRates: [],
        inflationRate: [],
      },
      snapshots: {
        capital: [],
        liquidValue: [],
        totalValue: [],
        maxDrawdown: [],
        maxDrawdownPeriod: [],
        withdrawal: [],
        withdrawalReal: [],
        withdrawalRate: [],
        tax: [],
        taxationDegree: [],
        iskTaxRate: [],
        assetReturnRates: [],
        inflationRate: [],
      },
    }

    // Generate histograms for each period (currently just bucket counts)
    // For simplicity, we'll store histograms for the final period only
    const finalPeriod = numPeriods - 1
    const periodFields: (keyof SimulationPeriodData)[] = [
      'withdrawal',
      'withdrawalReal',
      'withdrawalRate',
      'tax',
      'taxationDegree',
      'iskTaxRate',
      'inflationRate',
    ]

    for (const field of periodFields) {
      const values = results
        .map((r) => {
          const val = r.periodData[field][finalPeriod]
          return Array.isArray(val) ? val[0] : val
        })
        .filter((v): v is number => v !== undefined && isFinite(v))

      const histogram = createHistogram(values, 50)
      histogramResult.periodData[field] = histogram.buckets as any
    }

    const snapshotHistFields: (keyof SimulationPeriodData)[] = ['tax', 'taxationDegree']

    for (const field of snapshotHistFields) {
      const values = results
        .map((r) => {
          const val = r.snapshots[field][finalPeriod]
          return Array.isArray(val) ? val[0] : val
        })
        .filter((v): v is number => v !== undefined && isFinite(v))

      const histogram = createHistogram(values, 50)
      histogramResult.snapshots[field] = histogram.buckets as any
    }

    // Snapshot-specific fields
    const capitalValues = results.map((r) => r.snapshots.capital[finalPeriod]!).filter(isFinite)
    histogramResult.snapshots.capital = createHistogram(capitalValues, 50).buckets as any

    const liquidValues = results.map((r) => r.snapshots.liquidValue[finalPeriod]!).filter(isFinite)
    histogramResult.snapshots.liquidValue = createHistogram(liquidValues, 50).buckets as any

    const totalValues = results.map((r) => r.snapshots.totalValue[finalPeriod]!).filter(isFinite)
    histogramResult.snapshots.totalValue = createHistogram(totalValues, 50).buckets as any

    histograms.push(histogramResult)

    // Calculate statistics for each field and period
    const statsResult: SimulationStatistics<SimulationResult<number>> = {
      mean: { periodData: {} as any, snapshots: {} as any },
      stdDev: { periodData: {} as any, snapshots: {} as any },
      percentile5: { periodData: {} as any, snapshots: {} as any },
      percentile25: { periodData: {} as any, snapshots: {} as any },
      median: { periodData: {} as any, snapshots: {} as any },
      percentile75: { periodData: {} as any, snapshots: {} as any },
      percentile95: { periodData: {} as any, snapshots: {} as any },
    }

    // Calculate statistics for periodData fields
    const periodDataFields: (keyof SimulationPeriodData)[] = [
      'withdrawal',
      'withdrawalReal',
      'withdrawalRate',
      'tax',
      'taxationDegree',
      'iskTaxRate',
      'inflationRate',
    ]

    for (const field of periodDataFields) {
      const meanArr: number[] = []
      const stdDevArr: number[] = []
      const p5Arr: number[] = []
      const p25Arr: number[] = []
      const medianArr: number[] = []
      const p75Arr: number[] = []
      const p95Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('periodData', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p5Arr.push(stats.p5)
        p25Arr.push(stats.p25)
        medianArr.push(stats.median)
        p75Arr.push(stats.p75)
        p95Arr.push(stats.p95)
      }

      statsResult.mean.periodData[field] = meanArr as any
      statsResult.stdDev.periodData[field] = stdDevArr as any
      statsResult.percentile5.periodData[field] = p5Arr as any
      statsResult.percentile25.periodData[field] = p25Arr as any
      statsResult.median.periodData[field] = medianArr as any
      statsResult.percentile75.periodData[field] = p75Arr as any
      statsResult.percentile95.periodData[field] = p95Arr as any
    }

    // Handle assetReturnRates separately (it's an array of arrays)
    // For each period, calculate statistics for each asset
    const numAssets = firstResult.periodData.assetReturnRates[0]?.length ?? 0

    // Initialize assetReturnRates arrays
    statsResult.mean.periodData.assetReturnRates = []
    statsResult.stdDev.periodData.assetReturnRates = []
    statsResult.percentile5.periodData.assetReturnRates = []
    statsResult.percentile25.periodData.assetReturnRates = []
    statsResult.median.periodData.assetReturnRates = []
    statsResult.percentile75.periodData.assetReturnRates = []
    statsResult.percentile95.periodData.assetReturnRates = []

    for (let period = 0; period < numPeriods; period++) {
      const meanAssetReturns: number[] = []
      const stdDevAssetReturns: number[] = []
      const p5AssetReturns: number[] = []
      const p25AssetReturns: number[] = []
      const medianAssetReturns: number[] = []
      const p75AssetReturns: number[] = []
      const p95AssetReturns: number[] = []

      for (let assetIdx = 0; assetIdx < numAssets; assetIdx++) {
        const assetValues = results
          .map((r) => r.periodData.assetReturnRates[period]?.[assetIdx])
          .filter((v): v is number => v !== undefined && isFinite(v))

        if (assetValues.length > 0) {
          const stats = calculateStats(assetValues)
          meanAssetReturns.push(stats.mean)
          stdDevAssetReturns.push(stats.stdDev)
          p5AssetReturns.push(stats.percentile5)
          p25AssetReturns.push(stats.percentile25)
          medianAssetReturns.push(stats.median)
          p75AssetReturns.push(stats.percentile75)
          p95AssetReturns.push(stats.percentile95)
        } else {
          meanAssetReturns.push(0)
          stdDevAssetReturns.push(0)
          p5AssetReturns.push(0)
          p25AssetReturns.push(0)
          medianAssetReturns.push(0)
          p75AssetReturns.push(0)
          p95AssetReturns.push(0)
        }
      }

      statsResult.mean.periodData.assetReturnRates.push(meanAssetReturns)
      statsResult.stdDev.periodData.assetReturnRates.push(stdDevAssetReturns)
      statsResult.percentile5.periodData.assetReturnRates.push(p5AssetReturns)
      statsResult.percentile25.periodData.assetReturnRates.push(p25AssetReturns)
      statsResult.median.periodData.assetReturnRates.push(medianAssetReturns)
      statsResult.percentile75.periodData.assetReturnRates.push(p75AssetReturns)
      statsResult.percentile95.periodData.assetReturnRates.push(p95AssetReturns)
    }

    // Calculate statistics for snapshot fields
    const snapshotFields: Array<keyof Pick<SimulationPeriodData, 'tax' | 'taxationDegree'>> = [
      'tax',
      'taxationDegree',
    ]

    for (const field of snapshotFields) {
      const meanArr: number[] = []
      const stdDevArr: number[] = []
      const p5Arr: number[] = []
      const p25Arr: number[] = []
      const medianArr: number[] = []
      const p75Arr: number[] = []
      const p95Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('snapshots', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p5Arr.push(stats.p5)
        p25Arr.push(stats.p25)
        medianArr.push(stats.median)
        p75Arr.push(stats.p75)
        p95Arr.push(stats.p95)
      }

      statsResult.mean.snapshots[field] = meanArr as any
      statsResult.stdDev.snapshots[field] = stdDevArr as any
      statsResult.percentile5.snapshots[field] = p5Arr as any
      statsResult.percentile25.snapshots[field] = p25Arr as any
      statsResult.median.snapshots[field] = medianArr as any
      statsResult.percentile75.snapshots[field] = p75Arr as any
      statsResult.percentile95.snapshots[field] = p95Arr as any
    }

    // Snapshot-only fields (capital, liquidValue, totalValue, maxDrawdown, maxDrawdownPeriod)
    const snapshotOnlyFields = [
      'capital',
      'liquidValue',
      'totalValue',
      'maxDrawdown',
      'maxDrawdownPeriod',
    ] as const

    for (const field of snapshotOnlyFields) {
      statsResult.mean.snapshots[field] = []
      statsResult.stdDev.snapshots[field] = []
      statsResult.percentile5.snapshots[field] = []
      statsResult.percentile25.snapshots[field] = []
      statsResult.median.snapshots[field] = []
      statsResult.percentile75.snapshots[field] = []
      statsResult.percentile95.snapshots[field] = []

      for (let period = 0; period < numPeriods; period++) {
        const values = results
          .map((r) => r.snapshots[field][period])
          .filter((v): v is number => v !== undefined && isFinite(v))

        if (values.length > 0) {
          const stats = calculateStats(values)
          statsResult.mean.snapshots[field].push(stats.mean)
          statsResult.stdDev.snapshots[field].push(stats.stdDev)
          statsResult.percentile5.snapshots[field].push(stats.percentile5)
          statsResult.percentile25.snapshots[field].push(stats.percentile25)
          statsResult.median.snapshots[field].push(stats.median)
          statsResult.percentile75.snapshots[field].push(stats.percentile75)
          statsResult.percentile95.snapshots[field].push(stats.percentile95)
        } else {
          statsResult.mean.snapshots[field].push(0)
          statsResult.stdDev.snapshots[field].push(0)
          statsResult.percentile5.snapshots[field].push(0)
          statsResult.percentile25.snapshots[field].push(0)
          statsResult.median.snapshots[field].push(0)
          statsResult.percentile75.snapshots[field].push(0)
          statsResult.percentile95.snapshots[field].push(0)
        }
      }
    }

    // Handle remaining snapshot fields that mirror periodData
    const mirroredFields: Array<
      keyof Pick<
        SimulationPeriodData,
        'withdrawal' | 'withdrawalReal' | 'withdrawalRate' | 'iskTaxRate' | 'inflationRate'
      >
    > = ['withdrawal', 'withdrawalReal', 'withdrawalRate', 'iskTaxRate', 'inflationRate']

    for (const field of mirroredFields) {
      const meanArr: number[] = []
      const stdDevArr: number[] = []
      const p5Arr: number[] = []
      const p25Arr: number[] = []
      const medianArr: number[] = []
      const p75Arr: number[] = []
      const p95Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('snapshots', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p5Arr.push(stats.p5)
        p25Arr.push(stats.p25)
        medianArr.push(stats.median)
        p75Arr.push(stats.p75)
        p95Arr.push(stats.p95)
      }

      statsResult.mean.snapshots[field] = meanArr as any
      statsResult.stdDev.snapshots[field] = stdDevArr as any
      statsResult.percentile5.snapshots[field] = p5Arr as any
      statsResult.percentile25.snapshots[field] = p25Arr as any
      statsResult.median.snapshots[field] = medianArr as any
      statsResult.percentile75.snapshots[field] = p75Arr as any
      statsResult.percentile95.snapshots[field] = p95Arr as any
    }

    // Handle assetReturnRates for snapshots (same as periodData since they're identical)
    statsResult.mean.snapshots.assetReturnRates = statsResult.mean.periodData.assetReturnRates
    statsResult.stdDev.snapshots.assetReturnRates = statsResult.stdDev.periodData.assetReturnRates
    statsResult.percentile5.snapshots.assetReturnRates =
      statsResult.percentile5.periodData.assetReturnRates
    statsResult.percentile25.snapshots.assetReturnRates =
      statsResult.percentile25.periodData.assetReturnRates
    statsResult.median.snapshots.assetReturnRates = statsResult.median.periodData.assetReturnRates
    statsResult.percentile75.snapshots.assetReturnRates =
      statsResult.percentile75.periodData.assetReturnRates
    statsResult.percentile95.snapshots.assetReturnRates =
      statsResult.percentile95.periodData.assetReturnRates

    statistics.push(statsResult)

    // Find median sample (simulation closest to median across key metrics)
    const medianLiquidValue = calculateStats(
      results.map((r) => r.snapshots.liquidValue[r.snapshots.liquidValue.length - 1]!),
    ).median

    let closestDist = Infinity
    let closestIdx = 0

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const finalLiquidValue =
        result.snapshots.liquidValue[result.snapshots.liquidValue.length - 1]!
      const dist = Math.abs(finalLiquidValue - medianLiquidValue)

      if (dist < closestDist) {
        closestDist = dist
        closestIdx = i
      }
    }

    medianSamples.push(results[closestIdx]!)
  }

  return { labels, histograms, statistics, medianSamples }
}
