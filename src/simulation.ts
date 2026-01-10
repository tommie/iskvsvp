import { alea } from 'seedrandom'
import type {
  InputParameters,
  SimulationResult,
  SimulationStatistics,
  Summary,
  YearlyData,
  TimeSeriesPoint,
  ScenarioYearlyData,
  ScenarioSummary,
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
 * @param means Array of means for each variable
 * @param stdDevs Array of standard deviations for each variable
 * @param correlationMatrix Correlation matrix (symmetric, diagonal = 1)
 * @param rng Random number generator
 * @returns Array of correlated samples
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

  // Transform to correlated samples: X = μ + Σ^(1/2) * Z
  // where Σ^(1/2) = diag(σ) * L * diag(σ)^T = diag(σ) * L (since L is lower triangular)
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
  value: number // Current market value
  costBasis: number // Original cost basis (for VP tax calculation)
}

interface ScenarioState {
  amount: number // Total portfolio value (sum of asset values)
  assetPositions: AssetPosition[] // One per asset in portfolio
  cumulativePaidTax: number
  accumulatedRealWithdrawal: number
  accumulatedNominalWithdrawal: number
  currentTaxRate: number
  yearlyAmounts: number[]
  peakAmount: number
  currentDrawdownStart: number | null
  maxDrawdown: number
  maxDrawdownPeriod: number
}

/**
 * Run a single simulation with stochastic parameters for multiple scenarios.
 */
export function runSingleSimulation(params: InputParameters): SimulationResult {
  // Create seeded random number generator
  const rng = alea(params.seed)

  const yearlyData: YearlyData[] = []

  // Initialize state for each scenario
  const scenarioStates: Record<string, ScenarioState> = {}
  for (const scenario of params.scenarios) {
    // Initialize asset positions based on target weights
    const assetPositions: AssetPosition[] = params.portfolio.assets.map((asset) => ({
      value: params.initialCapital * asset.weight,
      costBasis: params.initialCapital * asset.weight,
    }))

    scenarioStates[scenario.name] = {
      amount: params.initialCapital,
      assetPositions,
      cumulativePaidTax: 0,
      accumulatedRealWithdrawal: 0,
      accumulatedNominalWithdrawal: 0,
      currentTaxRate: scenario.iskTaxRate ?? 0, // ISK basis rate (or 0 for VP)
      yearlyAmounts: [params.initialCapital],
      peakAmount: params.initialCapital,
      currentDrawdownStart: null,
      maxDrawdown: 0,
      maxDrawdownPeriod: 0,
    }
  }

  let cumulativeInflation = 1
  const firstYearData: Record<string, { withdrawnReal: number }> = {}

  for (let i = 0; i < params.yearsLater; i++) {
    const year = params.startYear + i

    // Generate shared stochastics for this year (same across all scenarios for fair comparison)
    const inflationRate = randomNormal(params.inflationRate, params.inflationStdDev, rng)

    // Sample correlated asset returns
    const assetReturns = sampleCorrelatedNormals(
      params.portfolio.assets.map((a) => a.expectedReturn),
      params.portfolio.assets.map((a) => a.volatility),
      params.portfolio.correlationMatrix,
      rng,
    )

    // Calculate portfolio return as weighted sum
    const development = params.portfolio.assets.reduce(
      (sum, asset, idx) => sum + asset.weight * assetReturns[idx]!,
      0,
    )

    cumulativeInflation *= 1 + inflationRate

    const scenarioYearlyData: Record<string, ScenarioYearlyData> = {}

    // Process each scenario
    for (const scenario of params.scenarios) {
      const state = scenarioStates[scenario.name]!

      // Update ISK basis rate if ISK (random walk)
      if (scenario.isISK && scenario.iskTaxRateStdDev) {
        const taxRateChange = randomNormal(0, scenario.iskTaxRateStdDev, rng)
        state.currentTaxRate = Math.max(
          ISK_TAX_RATE_MIN,
          Math.min(1.0, state.currentTaxRate + taxRateChange),
        )
      }

      // Step 1: Apply returns to each asset
      for (let assetIdx = 0; assetIdx < state.assetPositions.length; assetIdx++) {
        const position = state.assetPositions[assetIdx]!
        const assetReturn = assetReturns[assetIdx]!
        position.value *= 1 + assetReturn
      }

      // Calculate total portfolio value
      state.amount = state.assetPositions.reduce((sum, pos) => sum + pos.value, 0)

      // Step 2: Calculate balance-based withdrawal
      const balanceWithdrawal = state.amount * scenario.balanceWithdrawalRate

      // Calculate profit-based withdrawal
      let profitWithdrawal = 0
      if (i > 0 && scenario.profitWithdrawalRate > 0) {
        const lookbackYears = Math.min(scenario.profitLookbackYears, state.yearlyAmounts.length - 1)
        if (lookbackYears > 0) {
          const oldAmount = state.yearlyAmounts[state.yearlyAmounts.length - 1 - lookbackYears]!
          const totalProfit = state.amount - oldAmount
          const averageAnnualProfit = totalProfit / lookbackYears
          profitWithdrawal = Math.max(0, averageAnnualProfit * scenario.profitWithdrawalRate)
        }
      }

      // Calculate inflation-based withdrawal
      const inflationWithdrawal = scenario.inflationBasedWithdrawal * cumulativeInflation

      const withdrawn = balanceWithdrawal + profitWithdrawal + inflationWithdrawal
      const withdrawalRate = state.amount > 0 ? withdrawn / state.amount : 0

      // Step 3: Execute withdrawals (tax efficiently by withdrawing from overweight assets first)
      let withdrawalTax = 0
      if (withdrawn > 0 && params.portfolio.rebalanceFrequency === 'annually' && state.amount > 0) {
        // Calculate current and target weights
        let remainingToWithdraw = withdrawn

        // First pass: withdraw from overweight assets to move toward target
        const targetValues = params.portfolio.assets.map((asset) => state.amount * asset.weight)

        for (let assetIdx = 0; assetIdx < state.assetPositions.length; assetIdx++) {
          const position = state.assetPositions[assetIdx]!
          const targetValue = targetValues[assetIdx]!
          const targetAfterWithdrawal = targetValue * (1 - withdrawn / state.amount)

          if (position.value > targetAfterWithdrawal && remainingToWithdraw > 0) {
            // Withdraw excess from overweight position
            const excessAmount = Math.min(
              position.value - targetAfterWithdrawal,
              remainingToWithdraw,
            )
            const withdrawalFraction = excessAmount / position.value

            if (!scenario.isISK) {
              const costBasisWithdrawn = position.costBasis * withdrawalFraction
              const gainOnWithdrawal = excessAmount - costBasisWithdrawn
              if (gainOnWithdrawal > 0) {
                withdrawalTax += gainOnWithdrawal * scenario.capitalGainsTax
              }
            }

            position.value -= excessAmount
            position.costBasis *= 1 - withdrawalFraction
            remainingToWithdraw -= excessAmount
          }
        }

        // Second pass: if still need to withdraw, take proportionally from all assets
        if (remainingToWithdraw > 0.001) {
          const currentTotal = state.assetPositions.reduce((sum, pos) => sum + pos.value, 0)

          for (const position of state.assetPositions) {
            const proportionalWithdrawal = (position.value / currentTotal) * remainingToWithdraw
            const withdrawalFraction = proportionalWithdrawal / position.value

            if (!scenario.isISK) {
              const costBasisWithdrawn = position.costBasis * withdrawalFraction
              const gainOnWithdrawal = proportionalWithdrawal - costBasisWithdrawn
              if (gainOnWithdrawal > 0) {
                withdrawalTax += gainOnWithdrawal * scenario.capitalGainsTax
              }
            }

            position.value -= proportionalWithdrawal
            position.costBasis *= 1 - withdrawalFraction
          }
        }
      } else if (withdrawn > 0) {
        // No rebalancing: withdraw proportionally from all assets
        for (const position of state.assetPositions) {
          const withdrawalFraction = withdrawn / state.amount
          const amountWithdrawn = position.value * withdrawalFraction

          if (!scenario.isISK) {
            const costBasisWithdrawn = position.costBasis * withdrawalFraction
            const gainOnWithdrawal = amountWithdrawn - costBasisWithdrawn
            if (gainOnWithdrawal > 0) {
              withdrawalTax += gainOnWithdrawal * scenario.capitalGainsTax
            }
          }

          position.value -= amountWithdrawn
          position.costBasis *= 1 - withdrawalFraction
        }
      }

      // Recalculate total after withdrawals
      state.amount = state.assetPositions.reduce((sum, pos) => sum + pos.value, 0)

      // Step 4: Rebalance remaining portfolio (both ISK and VP)
      let rebalancingTax = 0
      if (params.portfolio.rebalanceFrequency === 'annually' && i > 0 && state.amount > 0) {
        // Calculate target values for remaining portfolio
        const targetValues = params.portfolio.assets.map((asset) => state.amount * asset.weight)

        // Sell overweight assets
        for (let assetIdx = 0; assetIdx < state.assetPositions.length; assetIdx++) {
          const position = state.assetPositions[assetIdx]!
          const targetValue = targetValues[assetIdx]!

          if (position.value > targetValue + 0.01) {
            // Small tolerance for rounding
            const sellValue = position.value - targetValue
            const sellFraction = sellValue / position.value

            // Only VP pays capital gains tax on rebalancing
            if (!scenario.isISK) {
              const gainOnSale = sellValue - position.costBasis * sellFraction
              if (gainOnSale > 0) {
                rebalancingTax += gainOnSale * scenario.capitalGainsTax
              }
            }

            position.value = targetValue
            position.costBasis *= 1 - sellFraction
          }
        }

        // Buy underweight assets
        for (let assetIdx = 0; assetIdx < state.assetPositions.length; assetIdx++) {
          const position = state.assetPositions[assetIdx]!
          const targetValue = targetValues[assetIdx]!

          if (position.value < targetValue - 0.01) {
            // Small tolerance for rounding
            const buyValue = targetValue - position.value
            position.value = targetValue
            position.costBasis += buyValue
          }
        }
      }

      // Step 5: Calculate total tax
      let tax: number

      if (scenario.isISK) {
        // ISK: only pays the ISK basis tax (schablonsskatt), no capital gains tax
        tax = state.amount * state.currentTaxRate * scenario.capitalGainsTax
      } else {
        // VP: pays fund tax (CGT on vpWealthTaxRate of fund value) + capital gains tax on withdrawals and rebalancing
        const fundTax = state.amount * params.vpWealthTaxRate * scenario.capitalGainsTax
        tax = fundTax + withdrawalTax + rebalancingTax
      }

      tax = Math.min(Math.max(0, tax), state.amount)

      // Pay tax
      for (const position of state.assetPositions) {
        const taxFraction = tax / state.amount
        const taxFromAsset = position.value * taxFraction
        position.value -= taxFromAsset
        position.costBasis *= 1 - taxFraction
      }

      // Recalculate total amount after withdrawals and tax
      state.amount = state.assetPositions.reduce((sum, pos) => sum + pos.value, 0)

      // Calculate liquidation value
      let liquidValue: number
      if (scenario.isISK) {
        liquidValue = state.amount
      } else {
        // Calculate total unrealized gains
        const totalCostBasis = state.assetPositions.reduce((sum, pos) => sum + pos.costBasis, 0)
        const unrealizedGain = state.amount - totalCostBasis
        liquidValue = state.amount - unrealizedGain * scenario.capitalGainsTax
      }

      // Update cumulative taxes
      state.cumulativePaidTax += tax

      // Calculate taxation degree
      const taxationDegree = liquidValue > 0 ? state.cumulativePaidTax / liquidValue : 0

      // Real withdrawal adjusted for inflation
      const withdrawnReal = withdrawn / cumulativeInflation

      // Accumulate withdrawals
      state.accumulatedRealWithdrawal += withdrawnReal
      state.accumulatedNominalWithdrawal += withdrawn

      // Store first year data
      //
      // If we are doing profit-based withdrawals, the first year will be strangely low.
      if (i === 0 || (scenario.profitWithdrawalRate > 0 && i === 1)) {
        firstYearData[scenario.name] = { withdrawnReal }
      }

      scenarioYearlyData[scenario.name] = {
        amount: state.amount,
        withdrawn,
        tax,
        paidTax: state.cumulativePaidTax,
        liquidValue,
        taxationDegree,
        withdrawnReal,
        withdrawalRate,
        taxRate: state.currentTaxRate,
        development, // Shared but stored for reference
        inflationRate, // Shared but stored for reference
      }

      // Track yearly amount for profit calculation
      // (amount already updated by per-asset operations)
      state.yearlyAmounts.push(state.amount)

      // Track drawdown
      if (state.amount > state.peakAmount) {
        // New peak - end any current drawdown
        state.peakAmount = state.amount
        if (state.currentDrawdownStart !== null) {
          const drawdownPeriod = i - state.currentDrawdownStart
          state.maxDrawdownPeriod = Math.max(state.maxDrawdownPeriod, drawdownPeriod)
          state.currentDrawdownStart = null
        }
      } else if (state.amount < state.peakAmount) {
        // In drawdown
        const drawdown = (state.peakAmount - state.amount) / state.peakAmount
        state.maxDrawdown = Math.max(state.maxDrawdown, drawdown)

        // Track drawdown period
        if (state.currentDrawdownStart === null) {
          state.currentDrawdownStart = i
        }
      }
    }

    yearlyData.push({
      year,
      development,
      inflationRate,
      inflation: cumulativeInflation,
      scenarios: scenarioYearlyData,
    })
  }

  const lastYear = yearlyData[yearlyData.length - 1]!

  // Calculate averages across all years
  const averageInflationRate =
    yearlyData.reduce((sum, year) => sum + year.inflationRate, 0) / yearlyData.length
  const averageDevelopment =
    yearlyData.reduce((sum, year) => sum + year.development, 0) / yearlyData.length

  // Build scenario summaries
  const scenarioSummaries: Record<string, ScenarioSummary> = {}
  for (const scenario of params.scenarios) {
    const lastYearData = lastYear.scenarios[scenario.name]!
    const firstYearWithdrawal = firstYearData[scenario.name]!.withdrawnReal
    const state = scenarioStates[scenario.name]!

    // Calculate average tax rate across all years
    const averageTaxRate =
      yearlyData.reduce((sum, year) => sum + year.scenarios[scenario.name]!.taxRate, 0) /
      yearlyData.length

    // Handle final drawdown period if still in drawdown at end
    let finalMaxDrawdownPeriod = state.maxDrawdownPeriod
    if (state.currentDrawdownStart !== null) {
      const currentDrawdownPeriod = params.yearsLater - 1 - state.currentDrawdownStart
      finalMaxDrawdownPeriod = Math.max(finalMaxDrawdownPeriod, currentDrawdownPeriod)
    }

    scenarioSummaries[scenario.name] = {
      liquidValue: lastYearData.liquidValue,
      firstYearLiquidValue: params.initialCapital,
      paidTax: lastYearData.paidTax,
      taxationDegree: lastYearData.taxationDegree,
      realWithdrawal: lastYearData.withdrawnReal,
      firstYearWithdrawal,
      accumulatedRealWithdrawal: state.accumulatedRealWithdrawal,
      accumulatedNominalWithdrawal: state.accumulatedNominalWithdrawal,
      totalValue: lastYearData.liquidValue + state.accumulatedNominalWithdrawal,
      averageTaxRate,
      maxDrawdown: state.maxDrawdown,
      maxDrawdownPeriod: finalMaxDrawdownPeriod,
    }
  }

  const summary: Summary = {
    scenarios: scenarioSummaries,
    averageInflationRate,
    averageDevelopment,
  }

  return { summary, yearlyData }
}

/**
 * Run Monte Carlo simulation with multiple iterations.
 */
export function runMonteCarloSimulation(
  params: InputParameters,
  onProgress?: (progress: number) => void,
): SimulationResult[] {
  const results: SimulationResult[] = []

  for (let i = 0; i < params.simulationCount; i++) {
    const params2 = { ...params, seed: params.seed + i.toString() }
    results.push(runSingleSimulation(params2))

    if (onProgress && i % 100 === 0) {
      onProgress((i / params.simulationCount) * 100)
    }
  }

  if (onProgress) {
    onProgress(100)
  }

  return results
}

/**
 * Calculate statistics from simulation results.
 */
export function calculateStatistics(results: SimulationResult[]): SimulationStatistics {
  const summaries = results.map((r) => r.summary)

  const calculateStats = (values: number[]) => {
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

  // Get all scenario names from first result
  const scenarioNames = Object.keys(summaries[0]?.scenarios ?? {})

  // Calculate statistics for each scenario
  const scenarioStats: Record<
    string,
    {
      mean: ScenarioSummary
      stdDev: ScenarioSummary
      percentile5: ScenarioSummary
      percentile25: ScenarioSummary
      median: ScenarioSummary
      percentile75: ScenarioSummary
      percentile95: ScenarioSummary
    }
  > = {}

  for (const scenarioName of scenarioNames) {
    const scenarioSummaries = summaries.map((s) => s.scenarios[scenarioName]!)

    // Get all fields from scenario summary
    const fields: (keyof ScenarioSummary)[] = [
      'liquidValue',
      'firstYearLiquidValue',
      'paidTax',
      'taxationDegree',
      'realWithdrawal',
      'firstYearWithdrawal',
      'accumulatedRealWithdrawal',
      'accumulatedNominalWithdrawal',
      'totalValue',
      'averageTaxRate',
      'maxDrawdown',
      'maxDrawdownPeriod',
    ]

    const meanScenario = {} as ScenarioSummary
    const stdDevScenario = {} as ScenarioSummary
    const percentile5Scenario = {} as ScenarioSummary
    const percentile25Scenario = {} as ScenarioSummary
    const medianScenario = {} as ScenarioSummary
    const percentile75Scenario = {} as ScenarioSummary
    const percentile95Scenario = {} as ScenarioSummary

    for (const field of fields) {
      const values = scenarioSummaries.map((s) => s[field])
      const stats = calculateStats(values)

      meanScenario[field] = stats.mean
      stdDevScenario[field] = stats.stdDev
      percentile5Scenario[field] = stats.percentile5
      percentile25Scenario[field] = stats.percentile25
      medianScenario[field] = stats.median
      percentile75Scenario[field] = stats.percentile75
      percentile95Scenario[field] = stats.percentile95
    }

    scenarioStats[scenarioName] = {
      mean: meanScenario,
      stdDev: stdDevScenario,
      percentile5: percentile5Scenario,
      percentile25: percentile25Scenario,
      median: medianScenario,
      percentile75: percentile75Scenario,
      percentile95: percentile95Scenario,
    }
  }

  // Calculate statistics for top-level fields
  const avgInflationStats = calculateStats(summaries.map((s) => s.averageInflationRate))
  const avgDevelopmentStats = calculateStats(summaries.map((s) => s.averageDevelopment))

  return {
    mean: {
      scenarios: Object.fromEntries(
        Object.entries(scenarioStats).map(([name, stats]) => [name, stats.mean]),
      ),
      averageInflationRate: avgInflationStats.mean,
      averageDevelopment: avgDevelopmentStats.mean,
    },
    stdDev: {
      scenarios: Object.fromEntries(
        Object.entries(scenarioStats).map(([name, stats]) => [name, stats.stdDev]),
      ),
      averageInflationRate: avgInflationStats.stdDev,
      averageDevelopment: avgDevelopmentStats.stdDev,
    },
    percentile5: {
      scenarios: Object.fromEntries(
        Object.entries(scenarioStats).map(([name, stats]) => [name, stats.percentile5]),
      ),
      averageInflationRate: avgInflationStats.percentile5,
      averageDevelopment: avgDevelopmentStats.percentile5,
    },
    percentile25: {
      scenarios: Object.fromEntries(
        Object.entries(scenarioStats).map(([name, stats]) => [name, stats.percentile25]),
      ),
      averageInflationRate: avgInflationStats.percentile25,
      averageDevelopment: avgDevelopmentStats.percentile25,
    },
    median: {
      scenarios: Object.fromEntries(
        Object.entries(scenarioStats).map(([name, stats]) => [name, stats.median]),
      ),
      averageInflationRate: avgInflationStats.median,
      averageDevelopment: avgDevelopmentStats.median,
    },
    percentile75: {
      scenarios: Object.fromEntries(
        Object.entries(scenarioStats).map(([name, stats]) => [name, stats.percentile75]),
      ),
      averageInflationRate: avgInflationStats.percentile75,
      averageDevelopment: avgDevelopmentStats.percentile75,
    },
    percentile95: {
      scenarios: Object.fromEntries(
        Object.entries(scenarioStats).map(([name, stats]) => [name, stats.percentile95]),
      ),
      averageInflationRate: avgInflationStats.percentile95,
      averageDevelopment: avgDevelopmentStats.percentile95,
    },
  }
}

/**
 * Extract time series data for visualization.
 */
export function extractTimeSeriesData(results: SimulationResult[]): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = []

  results.forEach((result, simulationId) => {
    result.yearlyData.forEach((yearData) => {
      points.push({
        simulationId,
        year: yearData.year,
        liquidValue: Object.fromEntries(
          Object.entries(yearData.scenarios).map(([name, data]) => [name, data.liquidValue]),
        ),
        withdrawalsReal: Object.fromEntries(
          Object.entries(yearData.scenarios).map(([name, data]) => [name, data.withdrawnReal]),
        ),
      })
    })
  })

  return points
}
