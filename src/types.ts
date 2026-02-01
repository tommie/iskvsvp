export interface SimulationAsset {
  name: string // Display name for the asset
  weight: number // Weight in portfolio (should sum to 1.0 across all assets)
  expectedReturn: number // Mean annual return
  volatility: number // Standard deviation of returns
}

export type RebalanceFrequency = 'never' | 'annually'

export type AccountType = 'ISK' | 'VP'

export interface InputParameters {
  seed: string // Random seed for reproducibility

  initialCapital: number
  startYear: number
  yearsLater: number
  simulationCount: number

  assets: SimulationAsset[]
  assetCorrelationMatrix: number[][] // Correlation matrix between assets (symmetric, diagonal = 1)
  assetRebalanceFrequency: RebalanceFrequency // How often to rebalance portfolio

  depositAmount: number // Annual deposit amount (inflation-adjusted)
  depositYears: number // Number of years to make deposits (before withdrawals start)

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

// Final portfolio composition (weights) at end of simulation
export interface FinalAssetWeights {
  // Asset names for labeling
  assetNames: string[]
  // Statistics for each asset's final weight (0-1)
  weights: SimulationStatistics<number>[]
}

export interface SimulationResults {
  // Labels for each scenario (e.g., ["ISK", "VP"])
  labels: string[]

  // Statistics for each scenario and period
  statistics: SimulationStatistics<SimulationResult<number>>[]

  // A representative sample of the median for each scenario
  medianSamples: SimulationResult<number>[]

  // Final portfolio composition for each scenario (only meaningful when rebalancing is 'never')
  finalAssetWeights: FinalAssetWeights[]
}

// Asset property parameter format: "assets.expectedReturn.0", "assets.volatility.1", etc.
export type AssetPropertyParameter =
  `assets.${'expectedReturn' | 'volatility' | 'weight'}.${number}`

// Mapped type for asset properties
type AssetProperties = {
  [K in AssetPropertyParameter]?: number
}

// Scenario table for multi-scenario comparisons
export interface Scenario {
  label: string
  parameters: Partial<InputParameters> & { accountType?: AccountType } & AssetProperties
}

export interface ScenarioTable {
  scenarios: Scenario[]
}

// Type-safe parameter keys (excludes seed which is auto-generated)
export type ScenarioParameter =
  | Exclude<keyof InputParameters, 'seed'>
  | 'accountType'
  | AssetPropertyParameter

// Helper to check if a parameter is an asset property
export function isAssetPropertyParameter(param: string): param is AssetPropertyParameter {
  return /^assets\.(expectedReturn|volatility|weight)\.\d+$/.test(param)
}

// Helper to parse asset property parameter
export function parseAssetPropertyParameter(param: AssetPropertyParameter): {
  index: number
  property: 'expectedReturn' | 'volatility' | 'weight'
} | null {
  const match = param.match(/^assets\.(expectedReturn|volatility|weight)\.(\d+)$/)
  if (!match) return null
  return {
    property: match[1]! as 'expectedReturn' | 'volatility' | 'weight',
    index: parseInt(match[2]!, 10),
  }
}
