export interface InputParameters {
  initialCapital: number
  development: number
  developmentStdDev: number
  withdrawalISK: number
  withdrawalVP: number
  iskTaxRate: number
  iskTaxRateStdDev: number
  inflationRate: number
  inflationStdDev: number
  capitalGainsTax: number
  startYear: number
  yearsLater: number
  simulationCount: number
}

export interface YearlyData {
  year: number
  development: number
  withdrawalISK: number
  withdrawalVP: number
  iskTaxRate: number
  inflationRate: number
  capitalGainsTax: number
  amountISK: number
  amountVP: number
  withdrawnISK: number
  withdrawnVP: number
  taxBasisVP: number
  taxISK: number
  taxVP: number
  futureTaxVP: number
  vpLiquidValue: number
  paidTaxISK: number
  paidTaxVP: number
  taxationDegreeISK: number
  taxationDegreeVP: number
  inflation: number
  iskMinusVP: number
  iskMinusVPReal: number
  withdrawnISKReal: number
  withdrawnVPReal: number
  advantageISKPercent: number
}

export interface Summary {
  liquidValueISK: number
  liquidValueVP: number
  liquidValueDiff: number
  liquidValueDiffPercent: number
  paidTaxISK: number
  paidTaxVP: number
  paidTaxDiff: number
  paidTaxDiffPercent: number
  taxationDegreeISK: number
  taxationDegreeVP: number
  taxationDegreeDiff: number
  taxationDegreeDiffPercent: number
  realWithdrawalISK: number
  realWithdrawalVP: number
  realWithdrawalDiff: number
  realWithdrawalDiffPercent: number
  averageISKTaxRate: number
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
  iskValue: number
  vpValue: number
}
