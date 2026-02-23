import { alea } from 'seedrandom'
import type {
  InputParameters,
  SimulationResult,
  SimulationResults,
  SimulationStatistics,
  SimulationPeriodData,
  FinalAssetWeights,
} from './types'
import type { BootstrapPayload } from './bootstrap'
import { sampleAnnualReturns } from './bootstrap'

// Extended result that includes final asset weights and cumulative inflation
export interface SingleSimulationResult extends SimulationResult<number> {
  finalAssetWeights: number[]
  finalCumulativeInflation: number
}

const ISK_TAX_RATE_MIN = 0.0125

/**
 * Generate a random number from a normal distribution using Box-Muller transform.
 */
function randomNormal(mean: number, stdDev: number, rng: () => number): number {
  const u1 = rng() || Number.MIN_VALUE
  const u2 = rng()
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z0 * stdDev
}

interface AssetPosition {
  value: number
  costBasis: number
}

/**
 * Run a single simulation for a single scenario (ISK or VP).
 * Returns period-by-period data, cumulative snapshots, and final asset weights.
 */
export function runSingleSimulation(
  params: InputParameters,
  bootstrapPayload: BootstrapPayload,
): SingleSimulationResult {
  const rng = alea(params.seed)
  const isISK = params.iskTaxRate !== undefined

  // Pre-compute bootstrap returns from historical data
  const precomputedReturns = sampleAnnualReturns(
    bootstrapPayload.returnMatrix,
    bootstrapPayload.nMonths,
    bootstrapPayload.profileComponents,
    rng,
    params.yearsLater,
    bootstrapPayload.startDate,
  )

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

    const assetReturns: number[] = precomputedReturns[i]!

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
      if (params.amortizedWithdrawal) {
        // Merton's rule: PMT-based amortization
        const withdrawalYearsTotal = params.yearsLater - params.depositYears
        const remainingYears = withdrawalYearsTotal - (i - params.depositYears)
        if (remainingYears > 0 && amount > 0) {
          // Certainty-equivalent return (CER) per Merton's framework.
          // The geometric mean already incorporates σ²/2 (γ=1). We apply an
          // additional (γ-1)×σ²/2 reduction for risk aversion.
          // γ=3: slightly more conservative than empirical estimates (typically
          // 2–4 in the literature), chosen as a round number that reduces floor
          // binding in volatile portfolios without over-suppressing withdrawals.
          const GAMMA = 3
          const nominalReturn = bootstrapPayload.portfolioGeometricMean
            - (GAMMA - 1) * bootstrapPayload.portfolioVariance / 2
          const taxDrag = isISK
            ? currentIskTaxRate * params.capitalGainsTaxRate
            : params.vpWealthTaxRate * params.capitalGainsTaxRate
          const r = nominalReturn - params.inflationRate - taxDrag
          // Target FV/(1-t): tax is applied after the final withdrawal,
          // so aim higher to end at the desired value post-tax.
          const fv = (params.bequestGoal * params.initialCapital * cumulativeInflation) / (1 - taxDrag)
          // amount is post-growth (returns already applied in step 1), so
          // divide by (1+r) to get the pre-growth PV the PMT formula expects.
          let amortized: number
          if (Math.abs(r) < 1e-10) {
            amortized = (amount - fv) / remainingYears
          } else {
            const disc = Math.pow(1 + r, -remainingYears)
            const pv = amount / (1 + r)
            amortized = (r * (pv - fv * disc)) / (1 - disc)
          }
          // Floor: inflation-based withdrawal
          const floor = params.inflationBasedWithdrawal * cumulativeInflation
          withdrawn = Math.max(floor, amortized)
          withdrawn = Math.max(0, Math.min(withdrawn, amount))

        }
      } else {
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
      }
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

    tax = Math.min(Math.max(0, tax), Math.max(0, amount))

    // Pay tax
    if (tax > 0 && amount > 0) {
      for (const position of assetPositions) {
        const taxFraction = tax / amount
        const taxFromAsset = position.value * taxFraction
        position.value -= taxFromAsset
        position.costBasis *= 1 - taxFraction
      }
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

  // Calculate final asset weights
  const totalValue = assetPositions.reduce((sum, pos) => sum + pos.value, 0)
  const finalWeights =
    totalValue > 0
      ? assetPositions.map((pos) => pos.value / totalValue)
      : assetPositions.map(() => 1 / assetPositions.length)

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
    finalAssetWeights: finalWeights,
    finalCumulativeInflation: cumulativeInflation,
  }
}

/**
 * Calculate statistics from an array of values.
 */
function calculateStats(values: number[]): {
  mean: number
  stdDev: number
  percentile10: number
  median: number
  percentile90: number
} {
  const sorted = values.slice().sort((a, b) => a - b)
  const n = sorted.length
  const mean = sorted.reduce((a, b) => a + b, 0) / n

  return {
    mean,
    stdDev: Math.sqrt(sorted.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n),
    percentile10: sorted[Math.floor(n * 0.1)] ?? 0,
    median: sorted[Math.floor(n * 0.5)] ?? 0,
    percentile90: sorted[Math.floor(n * 0.9)] ?? 0,
  }
}

/**
 * Run Monte Carlo simulations for multiple parameter sets.
 * Returns aggregated statistics and median samples.
 */
export function simulateAll(
  paramSets: InputParameters[],
  labels: string[],
  onProgress: ((progress: number) => void) | undefined,
  bootstrapPayload: BootstrapPayload,
): SimulationResults {
  const allResults: SingleSimulationResult[][] = []

  // Run simulations for each parameter set
  for (let setIdx = 0; setIdx < paramSets.length; setIdx++) {
    const params = paramSets[setIdx]!
    const results: SingleSimulationResult[] = []

    for (let i = 0; i < params.simulationCount; i++) {
      const params2 = { ...params, seed: params.seed + i.toString() }
      results.push(runSingleSimulation(params2, bootstrapPayload))

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

  // Calculate statistics, median samples, final asset weights, and outcome probabilities for each parameter set
  const statistics: SimulationStatistics<SimulationResult<number>>[] = []
  const medianSamples: SimulationResult<number>[] = []
  const finalAssetWeightsStats: FinalAssetWeights[] = []
  const outcomeProbabilities: { successRate: number; breakEvenRate: number }[] = []

  for (let setIdx = 0; setIdx < allResults.length; setIdx++) {
    const results = allResults[setIdx]!
    const params = paramSets[setIdx]!
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
      p10: number
      median: number
      p90: number
    } => {
      const values = results
        .map((r) => {
          const val = r[dataType][field][periodIdx]
          return Array.isArray(val) ? val[0] : val
        })
        .filter((v): v is number => v !== undefined && isFinite(v))

      if (values.length === 0) {
        return { mean: 0, stdDev: 0, p10: 0, median: 0, p90: 0 }
      }

      const stats = calculateStats(values)
      return {
        mean: stats.mean,
        stdDev: stats.stdDev,
        p10: stats.percentile10,
        median: stats.median,
        p90: stats.percentile90,
      }
    }

    // Calculate statistics for each field and period
    // Type assertion needed: building objects incrementally
    const emptyPeriodData = () =>
      ({}) as SimulationPeriodData<number[]> & { assetReturnRates: number[][] }
    const emptySnapshots = () =>
      ({}) as SimulationPeriodData<number[]> & {
        capital: number[]
        liquidValue: number[]
        totalValue: number[]
        maxDrawdown: number[]
        maxDrawdownPeriod: number[]
        assetReturnRates: number[][]
      }
    const statsResult: SimulationStatistics<SimulationResult<number>> = {
      mean: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
      stdDev: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
      percentile10: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
      median: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
      percentile90: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
    }

    // Calculate statistics for periodData fields (excluding assetReturnRates which is handled separately)
    type ScalarPeriodField = Exclude<keyof SimulationPeriodData, 'assetReturnRates'>
    const periodDataFields: ScalarPeriodField[] = [
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
      const p10Arr: number[] = []
      const medianArr: number[] = []
      const p90Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('periodData', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p10Arr.push(stats.p10)
        medianArr.push(stats.median)
        p90Arr.push(stats.p90)
      }

      statsResult.mean.periodData[field] = meanArr
      statsResult.stdDev.periodData[field] = stdDevArr
      statsResult.percentile10.periodData[field] = p10Arr
      statsResult.median.periodData[field] = medianArr
      statsResult.percentile90.periodData[field] = p90Arr
    }

    // Handle assetReturnRates separately (it's an array of arrays)
    // For each period, calculate statistics for each asset
    const numAssets = firstResult.periodData.assetReturnRates[0]?.length ?? 0

    // Initialize assetReturnRates arrays
    statsResult.mean.periodData.assetReturnRates = []
    statsResult.stdDev.periodData.assetReturnRates = []
    statsResult.percentile10.periodData.assetReturnRates = []
    statsResult.median.periodData.assetReturnRates = []
    statsResult.percentile90.periodData.assetReturnRates = []

    for (let period = 0; period < numPeriods; period++) {
      const meanAssetReturns: number[] = []
      const stdDevAssetReturns: number[] = []
      const p10AssetReturns: number[] = []
      const medianAssetReturns: number[] = []
      const p90AssetReturns: number[] = []

      for (let assetIdx = 0; assetIdx < numAssets; assetIdx++) {
        const assetValues = results
          .map((r) => r.periodData.assetReturnRates[period]?.[assetIdx])
          .filter((v): v is number => v !== undefined && isFinite(v))

        if (assetValues.length > 0) {
          const stats = calculateStats(assetValues)
          meanAssetReturns.push(stats.mean)
          stdDevAssetReturns.push(stats.stdDev)
          p10AssetReturns.push(stats.percentile10)
          medianAssetReturns.push(stats.median)
          p90AssetReturns.push(stats.percentile90)
        } else {
          meanAssetReturns.push(0)
          stdDevAssetReturns.push(0)
          p10AssetReturns.push(0)
          medianAssetReturns.push(0)
          p90AssetReturns.push(0)
        }
      }

      statsResult.mean.periodData.assetReturnRates.push(meanAssetReturns)
      statsResult.stdDev.periodData.assetReturnRates.push(stdDevAssetReturns)
      statsResult.percentile10.periodData.assetReturnRates.push(p10AssetReturns)
      statsResult.median.periodData.assetReturnRates.push(medianAssetReturns)
      statsResult.percentile90.periodData.assetReturnRates.push(p90AssetReturns)
    }

    // Calculate statistics for snapshot fields (tax and taxationDegree from SimulationPeriodData)
    type SnapshotScalarField = 'tax' | 'taxationDegree'
    const snapshotFields: SnapshotScalarField[] = ['tax', 'taxationDegree']

    for (const field of snapshotFields) {
      const meanArr: number[] = []
      const stdDevArr: number[] = []
      const p10Arr: number[] = []
      const medianArr: number[] = []
      const p90Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('snapshots', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p10Arr.push(stats.p10)
        medianArr.push(stats.median)
        p90Arr.push(stats.p90)
      }

      statsResult.mean.snapshots[field] = meanArr
      statsResult.stdDev.snapshots[field] = stdDevArr
      statsResult.percentile10.snapshots[field] = p10Arr
      statsResult.median.snapshots[field] = medianArr
      statsResult.percentile90.snapshots[field] = p90Arr
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
      statsResult.percentile10.snapshots[field] = []
      statsResult.median.snapshots[field] = []
      statsResult.percentile90.snapshots[field] = []

      for (let period = 0; period < numPeriods; period++) {
        const values = results
          .map((r) => r.snapshots[field][period])
          .filter((v): v is number => v !== undefined && isFinite(v))

        if (values.length > 0) {
          const stats = calculateStats(values)
          statsResult.mean.snapshots[field].push(stats.mean)
          statsResult.stdDev.snapshots[field].push(stats.stdDev)
          statsResult.percentile10.snapshots[field].push(stats.percentile10)
          statsResult.median.snapshots[field].push(stats.median)
          statsResult.percentile90.snapshots[field].push(stats.percentile90)
        } else {
          statsResult.mean.snapshots[field].push(0)
          statsResult.stdDev.snapshots[field].push(0)
          statsResult.percentile10.snapshots[field].push(0)
          statsResult.median.snapshots[field].push(0)
          statsResult.percentile90.snapshots[field].push(0)
        }
      }
    }

    // Handle remaining snapshot fields that mirror periodData
    type MirroredField =
      | 'withdrawal'
      | 'withdrawalReal'
      | 'withdrawalRate'
      | 'iskTaxRate'
      | 'inflationRate'
    const mirroredFields: MirroredField[] = [
      'withdrawal',
      'withdrawalReal',
      'withdrawalRate',
      'iskTaxRate',
      'inflationRate',
    ]

    for (const field of mirroredFields) {
      const meanArr: number[] = []
      const stdDevArr: number[] = []
      const p10Arr: number[] = []
      const medianArr: number[] = []
      const p90Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('snapshots', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p10Arr.push(stats.p10)
        medianArr.push(stats.median)
        p90Arr.push(stats.p90)
      }

      statsResult.mean.snapshots[field] = meanArr
      statsResult.stdDev.snapshots[field] = stdDevArr
      statsResult.percentile10.snapshots[field] = p10Arr
      statsResult.median.snapshots[field] = medianArr
      statsResult.percentile90.snapshots[field] = p90Arr
    }

    // Handle assetReturnRates for snapshots (same as periodData since they're identical)
    statsResult.mean.snapshots.assetReturnRates = statsResult.mean.periodData.assetReturnRates
    statsResult.stdDev.snapshots.assetReturnRates = statsResult.stdDev.periodData.assetReturnRates
    statsResult.percentile10.snapshots.assetReturnRates =
      statsResult.percentile10.periodData.assetReturnRates
    statsResult.median.snapshots.assetReturnRates = statsResult.median.periodData.assetReturnRates
    statsResult.percentile90.snapshots.assetReturnRates =
      statsResult.percentile90.periodData.assetReturnRates

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

    // Calculate final asset weights statistics
    const assetNames = params.assets.map((a) => a.name)
    const weightStats: SimulationStatistics<number>[] = []

    for (let assetIdx = 0; assetIdx < params.assets.length; assetIdx++) {
      const assetWeights = results
        .map((r) => r.finalAssetWeights[assetIdx])
        .filter((v): v is number => v !== undefined && isFinite(v))

      if (assetWeights.length > 0) {
        const stats = calculateStats(assetWeights)
        weightStats.push({
          mean: stats.mean,
          stdDev: stats.stdDev,
          percentile10: stats.percentile10,
          median: stats.median,
          percentile90: stats.percentile90,
        })
      } else {
        weightStats.push({
          mean: 0,
          stdDev: 0,
          percentile10: 0,
          median: 0,
          percentile90: 0,
        })
      }
    }

    finalAssetWeightsStats.push({
      assetNames,
      weights: weightStats,
    })

    // Calculate outcome probabilities
    const initialCapital = params.initialCapital
    let successCount = 0
    let breakEvenCount = 0

    for (const result of results) {
      const finalLiquidValue =
        result.snapshots.liquidValue[result.snapshots.liquidValue.length - 1] ?? 0
      const inflationAdjustedCapital = initialCapital * result.finalCumulativeInflation

      // Success: ended with positive balance
      if (finalLiquidValue > 0) {
        successCount++
      }

      // Break-even: preserved at least initial capital in real terms
      if (finalLiquidValue >= inflationAdjustedCapital) {
        breakEvenCount++
      }
    }

    outcomeProbabilities.push({
      successRate: successCount / results.length,
      breakEvenRate: breakEvenCount / results.length,
    })
  }

  return {
    labels,
    statistics,
    medianSamples,
    finalAssetWeights: finalAssetWeightsStats,
    outcomeProbabilities,
  }
}
