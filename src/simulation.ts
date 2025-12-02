import type {
  InputParameters,
  SimulationResult,
  SimulationStatistics,
  Summary,
  YearlyData,
  TimeSeriesPoint,
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

/**
 * Run a single simulation with stochastic parameters.
 */
export function runSingleSimulation(params: InputParameters): SimulationResult {
  const yearlyData: YearlyData[] = []
  let amountISK = params.initialCapital
  let amountVP = params.initialCapital
  let cumulativePaidTaxISK = 0
  let cumulativePaidTaxVP = 0
  let cumulativeInflation = 1
  let currentISKTaxRate = params.iskTaxRate

  for (let i = 0; i < params.yearsLater; i++) {
    const year = params.startYear + i

    // Generate stochastic parameters for this year
    const development = randomNormal(params.development, params.developmentStdDev)
    const inflationRate = randomNormal(params.inflationRate, params.inflationStdDev)

    // ISK tax rate changes with drift=0, but has minimum of 1.25%
    const iskTaxRateChange = randomNormal(0, params.iskTaxRateStdDev)
    currentISKTaxRate = Math.max(ISK_TAX_RATE_MIN, currentISKTaxRate + iskTaxRateChange)

    // Calculate withdrawals
    const withdrawnISK = amountISK * params.withdrawalISK
    const withdrawnVP = amountVP * params.withdrawalVP

    // Calculate capital gain for VP (relative to initial capital)
    const capitalGainVP = amountVP * (1 + development) - params.initialCapital

    // Calculate ISK tax (on the notional return)
    const taxISK = amountISK * currentISKTaxRate * params.capitalGainsTax

    // Calculate VP tax (on the withdrawal from capital gains)
    const taxVP = Math.max(0, capitalGainVP) * params.withdrawalVP * params.capitalGainsTax

    // Calculate future tax VP (total tax if liquidated)
    const futureTaxVP = Math.max(0, capitalGainVP) * params.capitalGainsTax

    // Update cumulative taxes
    cumulativePaidTaxISK += taxISK
    cumulativePaidTaxVP += taxVP

    // Calculate VP liquid value (after future tax)
    const vpLiquidValue = amountVP - futureTaxVP / (1 + development)

    // Update cumulative inflation
    cumulativeInflation *= 1 + inflationRate

    // Real values adjusted for inflation
    const withdrawnISKReal = withdrawnISK / cumulativeInflation
    const withdrawnVPReal = withdrawnVP / cumulativeInflation
    const iskMinusVP = amountISK - vpLiquidValue
    const iskMinusVPReal = iskMinusVP / cumulativeInflation

    yearlyData.push({
      year,
      development,
      withdrawalISK: params.withdrawalISK,
      withdrawalVP: params.withdrawalVP,
      iskTaxRate: currentISKTaxRate,
      inflationRate,
      capitalGainsTax: params.capitalGainsTax,
      amountISK,
      amountVP,
      withdrawnISK,
      withdrawnVP,
      taxBasisVP: Math.max(0, capitalGainVP),
      taxISK,
      taxVP,
      futureTaxVP,
      vpLiquidValue,
      paidTaxISK: cumulativePaidTaxISK,
      paidTaxVP: cumulativePaidTaxVP,
      taxationDegreeISK: amountISK > 0 ? cumulativePaidTaxISK / amountISK : 0,
      taxationDegreeVP: vpLiquidValue > 0 ? cumulativePaidTaxVP / vpLiquidValue : 0,
      inflation: cumulativeInflation,
      iskMinusVP,
      iskMinusVPReal,
      withdrawnISKReal,
      withdrawnVPReal,
      advantageISKPercent: vpLiquidValue !== 0 ? iskMinusVP / vpLiquidValue : 0,
    })

    // Update amounts for next year
    amountISK = amountISK * (1 + development - params.withdrawalISK) - taxISK
    amountVP = amountVP * (1 + development - params.withdrawalVP)
  }

  const lastYear = yearlyData[yearlyData.length - 1]!

  // Calculate averages across all years
  const averageISKTaxRate =
    yearlyData.reduce((sum, year) => sum + year.iskTaxRate, 0) / yearlyData.length
  const averageInflationRate =
    yearlyData.reduce((sum, year) => sum + year.inflationRate, 0) / yearlyData.length
  const averageDevelopment =
    yearlyData.reduce((sum, year) => sum + year.development, 0) / yearlyData.length

  const summary: Summary = {
    liquidValueISK: lastYear.amountISK,
    liquidValueVP: lastYear.vpLiquidValue,
    liquidValueDiff: lastYear.amountISK - lastYear.vpLiquidValue,
    liquidValueDiffPercent:
      lastYear.amountISK !== 0
        ? (lastYear.amountISK - lastYear.vpLiquidValue) / lastYear.amountISK
        : 0,
    paidTaxISK: lastYear.paidTaxISK,
    paidTaxVP: lastYear.paidTaxVP,
    paidTaxDiff: lastYear.paidTaxVP - lastYear.paidTaxISK,
    paidTaxDiffPercent:
      lastYear.paidTaxISK !== 0
        ? (lastYear.paidTaxVP - lastYear.paidTaxISK) / lastYear.paidTaxISK
        : 0,
    taxationDegreeISK: lastYear.taxationDegreeISK,
    taxationDegreeVP: lastYear.taxationDegreeVP,
    taxationDegreeDiff: lastYear.taxationDegreeVP - lastYear.taxationDegreeISK,
    taxationDegreeDiffPercent:
      lastYear.taxationDegreeISK !== 0
        ? (lastYear.taxationDegreeVP - lastYear.taxationDegreeISK) / lastYear.taxationDegreeISK
        : 0,
    realWithdrawalISK: lastYear.withdrawnISKReal,
    realWithdrawalVP: lastYear.withdrawnVPReal,
    realWithdrawalDiff: lastYear.withdrawnISKReal - lastYear.withdrawnVPReal,
    realWithdrawalDiffPercent:
      lastYear.withdrawnISKReal !== 0
        ? (lastYear.withdrawnISKReal - lastYear.withdrawnVPReal) / lastYear.withdrawnISKReal
        : 0,
    averageISKTaxRate,
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

  const getSummaryField = (field: keyof Summary): number[] =>
    summaries.map((s) => s[field] as number)

  const calculateFieldStats = (field: keyof Summary) => {
    const values = getSummaryField(field).sort((a, b) => a - b)
    const n = values.length

    return {
      mean: values.reduce((a, b) => a + b, 0) / n,
      stdDev: Math.sqrt(
        values.reduce(
          (sum, val) => sum + Math.pow(val - values.reduce((a, b) => a + b, 0) / n, 2),
          0,
        ) / n,
      ),
      percentile5: values[Math.floor(n * 0.05)] ?? 0,
      percentile25: values[Math.floor(n * 0.25)] ?? 0,
      median: values[Math.floor(n * 0.5)] ?? 0,
      percentile75: values[Math.floor(n * 0.75)] ?? 0,
      percentile95: values[Math.floor(n * 0.95)] ?? 0,
    }
  }

  const fields: (keyof Summary)[] = [
    'liquidValueISK',
    'liquidValueVP',
    'liquidValueDiff',
    'liquidValueDiffPercent',
    'paidTaxISK',
    'paidTaxVP',
    'paidTaxDiff',
    'paidTaxDiffPercent',
    'taxationDegreeISK',
    'taxationDegreeVP',
    'taxationDegreeDiff',
    'taxationDegreeDiffPercent',
    'realWithdrawalISK',
    'realWithdrawalVP',
    'realWithdrawalDiff',
    'realWithdrawalDiffPercent',
    'averageISKTaxRate',
    'averageInflationRate',
    'averageDevelopment',
  ]

  const stats = fields.reduce(
    (acc, field) => {
      const fieldStats = calculateFieldStats(field)
      acc.mean[field] = fieldStats.mean
      acc.stdDev[field] = fieldStats.stdDev
      acc.percentile5[field] = fieldStats.percentile5
      acc.percentile25[field] = fieldStats.percentile25
      acc.median[field] = fieldStats.median
      acc.percentile75[field] = fieldStats.percentile75
      acc.percentile95[field] = fieldStats.percentile95
      return acc
    },
    {
      mean: {} as Summary,
      stdDev: {} as Summary,
      percentile5: {} as Summary,
      percentile25: {} as Summary,
      median: {} as Summary,
      percentile75: {} as Summary,
      percentile95: {} as Summary,
    },
  )

  return stats
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
        iskValue: yearData.amountISK,
        vpValue: yearData.vpLiquidValue,
      })
    })
  })

  return points
}
