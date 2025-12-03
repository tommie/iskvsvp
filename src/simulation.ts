import type {
  InputParameters,
  SimulationResult,
  SimulationStatistics,
  Summary,
  YearlyData,
  TimeSeriesPoint,
  ScenarioConfig,
  ScenarioYearlyData,
  ScenarioSummary,
} from './types'

const ISK_TAX_RATE_MIN = 0.0125

/**
 * Generate a random number from a normal distribution using Box-Muller transform.
 */
function randomNormal(mean: number, stdDev: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z0 * stdDev
}

interface ScenarioState {
  amount: number
  cumulativePaidTax: number
  accumulatedRealWithdrawal: number
  currentTaxRate: number
  yearlyAmounts: number[]
}

/**
 * Run a single simulation with stochastic parameters for multiple scenarios.
 */
export function runSingleSimulation(params: InputParameters): SimulationResult {
  const yearlyData: YearlyData[] = []

  // Initialize state for each scenario
  const scenarioStates: Record<string, ScenarioState> = {}
  for (const scenario of params.scenarios) {
    scenarioStates[scenario.name] = {
      amount: params.initialCapital,
      cumulativePaidTax: 0,
      accumulatedRealWithdrawal: 0,
      currentTaxRate: scenario.iskTaxRate ?? 0, // ISK basis rate (or 0 for VP)
      yearlyAmounts: [params.initialCapital],
    }
  }

  let cumulativeInflation = 1
  const firstYearData: Record<string, { withdrawnReal: number }> = {}

  for (let i = 0; i < params.yearsLater; i++) {
    const year = params.startYear + i

    // Generate shared stochastics for this year (same across all scenarios for fair comparison)
    const inflationRate = randomNormal(params.inflationRate, params.inflationStdDev)
    const development = randomNormal(params.development, params.developmentStdDev)
    cumulativeInflation *= 1 + inflationRate

    const scenarioYearlyData: Record<string, ScenarioYearlyData> = {}

    // Process each scenario
    for (const scenario of params.scenarios) {
      const state = scenarioStates[scenario.name]!

      // Update ISK basis rate if ISK (random walk)
      if (scenario.isISK && scenario.iskTaxRateStdDev) {
        const taxRateChange = randomNormal(0, scenario.iskTaxRateStdDev)
        state.currentTaxRate = Math.max(
          ISK_TAX_RATE_MIN,
          Math.min(1.0, state.currentTaxRate + taxRateChange),
        )
      }

      // Calculate balance-based withdrawal
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

      const withdrawn = balanceWithdrawal + profitWithdrawal
      const withdrawalRate = state.amount > 0 ? withdrawn / state.amount : 0

      // Calculate liquidation value and withdrawal
      let liquidValue: number

      if (scenario.isISK) {
        // ISK: tax is ISK basis rate × capital gains tax rate, applied to account value
        // currentTaxRate is the ISK basis rate (e.g., 2.96%)
        liquidValue = state.amount
      } else {
        // Calculate future tax if liquidated
        const capitalGain = state.amount - params.initialCapital
        // We allow negative future tax, though it will only be valid if offset by other tax
        liquidValue = state.amount - capitalGain * scenario.capitalGainsTax
      }

      // Calculate tax
      let tax: number

      if (scenario.isISK) {
        // ISK: tax is ISK basis rate × capital gains tax rate, applied to account value
        // currentTaxRate is the ISK basis rate (e.g., 2.96%)
        tax = state.amount * state.currentTaxRate * scenario.capitalGainsTax
      } else {
        // VP: capital gains tax applied to actual sold value
        tax = withdrawn * scenario.capitalGainsTax
      }

      // Update cumulative taxes
      state.cumulativePaidTax += tax

      // Calculate taxation degree
      const taxationDegree = liquidValue > 0 ? state.cumulativePaidTax / liquidValue : 0

      // Real withdrawal adjusted for inflation
      const withdrawnReal = withdrawn / cumulativeInflation

      // Accumulate real withdrawals
      state.accumulatedRealWithdrawal += withdrawnReal

      // Store first year data
      if (i === 0) {
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

      // Update amount for next year, ensure non-negative
      if (scenario.isISK) {
        state.amount = Math.max(0, state.amount * (1 + development) - withdrawn - tax)
      } else {
        state.amount = Math.max(0, state.amount * (1 + development) - withdrawn)
      }

      // Track yearly amount for profit calculation
      state.yearlyAmounts.push(state.amount)
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

    scenarioSummaries[scenario.name] = {
      liquidValue: lastYearData.liquidValue,
      firstYearLiquidValue: params.initialCapital,
      paidTax: lastYearData.paidTax,
      taxationDegree: lastYearData.taxationDegree,
      realWithdrawal: lastYearData.withdrawnReal,
      firstYearWithdrawal,
      accumulatedRealWithdrawal: state.accumulatedRealWithdrawal,
      averageTaxRate,
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
    results.push(runSingleSimulation(params))

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
      'averageTaxRate',
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
        scenarios: Object.fromEntries(
          Object.entries(yearData.scenarios).map(([name, data]) => [name, data.liquidValue]),
        ),
      })
    })
  })

  return points
}
