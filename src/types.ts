export interface SimulationAsset {
  name: string // Display name for the asset
  weight: number // Weight in portfolio (should sum to 1.0 across all assets)
  expectedReturn: number // Mean annual return
  volatility: number // Standard deviation of returns
}

export type RebalanceFrequency = 'never' | 'annually'

export interface InputParameters {
  seed: string // Random seed for reproducibility

  initialCapital: number
  startYear: number
  yearsLater: number
  simulationCount: number

  assets: SimulationAsset[]
  assetCorrelationMatrix: number[][] // Correlation matrix between assets (symmetric, diagonal = 1)
  assetRebalanceFrequency: RebalanceFrequency // How often to rebalance portfolio

  balanceWithdrawalRate: number
  profitWithdrawalRate: number
  profitLookbackYears: number
  inflationBasedWithdrawal: number // Fixed withdrawal amount adjusted by inflation each year

  vpWealthTaxRate: number // VP wealth tax rate (e.g., 0.004 for 0.4%)
  capitalGainsTaxRate: number // Capital gains tax rate (used by both ISK and VP)
  iskTaxRate?: number // ISK basis rate (only for ISK scenarios)
  iskTaxRateStdDev?: number // ISK basis rate volatility (only for ISK scenarios)

  inflationRate: number
  inflationStdDev: number
}

export interface SimulationPeriodData<T = number> {
  withdrawal: T
  withdrawalReal: T
  withdrawalRate: T
  tax: T
  taxationDegree: T
  iskTaxRate: T
  inflationRate: T

  // assetReturnRates is special - it's always a 2D array (period x asset) for single simulations
  // For statistics, we just leave it as an empty array since per-asset stats are complex
  assetReturnRates: number[][]
}

export interface SimulationSummary<T = number> extends SimulationPeriodData<T> {
  capital: T
  liquidValue: T
  totalValue: T // liquidValue + accumulated nominal withdrawals
  maxDrawdown: T
  maxDrawdownPeriod: T
}

export interface SimulationResult<T> {
  // Per-period information
  periodData: SimulationPeriodData<T[]>

  // Cumulative information since simulation start, with one snapshot per period
  snapshots: SimulationSummary<T[]>
}

export interface SimulationStatistics<T> {
  mean: T
  stdDev: T
  percentile5: T
  percentile25: T
  median: T
  percentile75: T
  percentile95: T
}

export interface Histogram {
  lowest: number
  uppers: number[]
  buckets: number[]
}

export interface SimulationResults {
  // Labels for each scenario (e.g., ["ISK", "VP"])
  labels: string[]

  // Histograms for each scenario and period
  histograms: SimulationResult<number[]>[] // number[bucket]

  // Statistics for each scenario and period
  statistics: SimulationStatistics<SimulationResult<number>>[]

  // A representative sample of the median for each scenario
  medianSamples: SimulationResult<number>[]
}

// Scenario table for multi-scenario comparisons
export interface Scenario {
  label: string
  parameters: Partial<InputParameters>
}

export interface ScenarioTable {
  scenarios: Scenario[]
}

// Type-safe parameter keys (excludes seed which is auto-generated)
export type ScenarioParameter = Exclude<keyof InputParameters, 'seed'>
