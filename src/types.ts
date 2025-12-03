export interface ScenarioConfig {
  name: string
  withdrawalRate: number
  badYearWithdrawalRate: number
  development: number
  developmentStdDev: number
  inflationRate: number
  inflationStdDev: number
  capitalGainsTax: number // Capital gains tax rate (used by both ISK and VP)
  iskTaxRate?: number // ISK basis rate (only for ISK scenarios)
  iskTaxRateStdDev?: number // ISK basis rate volatility (only for ISK scenarios)
  isISK: boolean // Whether this scenario uses ISK tax model
}

export interface InputParameters {
  initialCapital: number
  startYear: number
  yearsLater: number
  simulationCount: number
  scenarios: ScenarioConfig[]
}

export interface ScenarioYearlyData {
  amount: number
  withdrawn: number
  tax: number
  paidTax: number
  liquidValue: number
  taxationDegree: number
  withdrawnReal: number
  withdrawalRate: number
  taxRate: number // Current tax rate (for ISK varies, for VP constant)
  development: number // Actual development this year for this scenario
  inflationRate: number // Shared inflation rate (same across scenarios)
}

export interface YearlyData {
  year: number
  development: number
  inflationRate: number
  inflation: number
  scenarios: Record<string, ScenarioYearlyData>
}

export interface ScenarioSummary {
  liquidValue: number
  paidTax: number
  taxationDegree: number
  realWithdrawal: number
  firstYearWithdrawal: number
  accumulatedRealWithdrawal: number
  averageTaxRate: number
}

export interface Summary {
  scenarios: Record<string, ScenarioSummary>
  averageInflationRate: number
  averageDevelopment: number
}

export interface SimulationResult {
  summary: Summary
  yearlyData: YearlyData[]
}

export interface SimulationStatistics {
  mean: Summary
  stdDev: Summary
  percentile5: Summary
  percentile25: Summary
  median: Summary
  percentile75: Summary
  percentile95: Summary
}

export interface TimeSeriesPoint {
  simulationId: number
  year: number
  scenarios: Record<string, number> // scenario name -> value
}
