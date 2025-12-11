export interface PortfolioAsset {
  name: string
  weight: number // Weight in portfolio (should sum to 1.0 across all assets)
  expectedReturn: number // Mean annual return
  volatility: number // Standard deviation of returns
}

export interface Portfolio {
  assets: PortfolioAsset[]
  correlationMatrix: number[][] // Correlation matrix between assets (symmetric, diagonal = 1)
}

export interface ScenarioConfig {
  name: string
  balanceWithdrawalRate: number
  profitWithdrawalRate: number
  profitLookbackYears: number
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
  portfolio: Portfolio
  inflationRate: number
  inflationStdDev: number
  scenarios: ScenarioConfig[]
  seed: string // Random seed for reproducibility
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
  firstYearLiquidValue: number
  paidTax: number
  taxationDegree: number
  realWithdrawal: number
  firstYearWithdrawal: number // Second year if profitWithdrawalRate > 0
  accumulatedRealWithdrawal: number
  accumulatedNominalWithdrawal: number
  totalValue: number // liquidValue + accumulatedNominalWithdrawal
  averageTaxRate: number
  maxDrawdown: number
  maxDrawdownPeriod: number
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
  liquidValue: Record<string, number> // scenario name -> liquidValue
  withdrawalsReal: Record<string, number>
}
