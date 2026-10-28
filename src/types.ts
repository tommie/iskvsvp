import type { Convergence } from './precision'

export interface SimulationAsset {
  // Catalogue entry (src/assets.ts) this asset came from, if any. Correlations
  // for an added asset are looked up by it; absent for a hand-rolled asset.
  presetId?: string
  name: string // Display name for the asset
  weight: number // Weight in portfolio (should sum to 1.0 across all assets)
  expectedReturn: number // Arithmetic mean annual *real* return
  volatility: number // Standard deviation of returns
}

export type RebalanceFrequency = 'never' | 'annually'

export type AccountType = 'ISK' | 'VP'

export interface InputParameters {
  seed: string // Random seed for reproducibility

  initialCapital: number
  startYear: number // First year of the plan. An age or a calendar year; the tool only uses endYear - startYear
  endYear: number // Last year of the plan; only the difference to startYear is used

  assets: SimulationAsset[]
  assetCorrelationMatrix: number[][] // Correlation matrix between assets (symmetric, diagonal = 1)
  assetRebalanceFrequency: RebalanceFrequency // How often to rebalance portfolio

  depositAmount: number // Annual deposit amount (inflation-adjusted)
  depositYears: number // Number of years to make deposits (before withdrawals start)

  // Withdrawal rule (see arva.ts). Amounts are annual, in today's money.
  withdrawalNeed: number // Paid whenever the portfolio can pay it
  withdrawalExtra: number // Paid only out of the surplus over the remaining needs and bequest
  bequestAmount: number // Capital to leave at the end, in today's money (0 = spend it all)
  ageAdjustedSpending: boolean // Age-dependent spending decline on need and extra

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
  // Per-period: tax actually paid that year. As a snapshot: cumulative tax
  // paid plus the capital gains tax still embedded in the portfolio, so ISK
  // and VP are comparable on the same basis.
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
  percentile10: T
  median: T
  percentile90: T
}

// Final portfolio composition (weights) at end of simulation
export interface FinalAssetWeights {
  // Asset names for labeling
  assetNames: string[]
  // Statistics for each asset's final weight (0-1)
  weights: SimulationStatistics<number>[]
}

// Outcome probabilities for a scenario
export interface OutcomeProbabilities {
  // Probability that the need was paid in full in every year. Ending at zero
  // having paid it counts as surviving: the withdrawal rule aims at that.
  survivalRate: number
  // Probability of ending with at least initial capital (inflation-adjusted)
  breakEvenRate: number
}

// The constant real withdrawal a scenario's portfolio, tax and horizon can
// carry at a given survival, found on the same paths as the main run. This is
// Bengen's question put to the Monte Carlo: his SAFEMAX is the highest constant
// rate that survived the worst historical sequence; with sampled paths the
// worst case is a percentile, so it is the highest constant rate that survives
// at least `targetSurvival` of them.
export interface BengenRate {
  // Annual amount in today's money, held constant (no extra, no bequest, no age curve)
  amount: number
  // The same, as a share of the starting capital
  rate: number
  targetSurvival: number
  // Paths it was found on
  paths: number
  // True when even the highest amount tried survived, so the real figure is higher
  atLeast: boolean
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

  // Outcome probabilities for each scenario
  outcomeProbabilities: OutcomeProbabilities[]

  // How many paths were run and how precisely survival is known
  convergence: Convergence

  // The constant withdrawal that survives, for comparison with the need
  bengen: BengenRate[]

  // Accumulated real withdrawal over the whole plan, with a plan that failed
  // counted as zero: what can be counted on, not what was received. A path that
  // fails late still keeps most of its total, so counted as it was received the
  // lower percentiles cannot tell it from a success. Unconditional, like the
  // planner's percentiles, where ruined outcomes sit at zero.
  withdrawalFailureAsZero: SimulationStatistics<number>[]
}

// Asset property parameter format: "assets.weight.0", etc.
// expectedReturn and volatility belong to the asset class and are not varied per scenario.
export type AssetPropertyParameter = `assets.${'weight'}.${number}`

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

// Type-safe parameter keys (excludes internal/auto-generated fields)
export type ScenarioParameter =
  | Exclude<keyof InputParameters, 'seed'>
  | 'accountType'
  | AssetPropertyParameter

// Helper to check if a parameter is an asset property
export function isAssetPropertyParameter(param: string): param is AssetPropertyParameter {
  return /^assets\.weight\.\d+$/.test(param)
}

// Helper to parse asset property parameter
export function parseAssetPropertyParameter(param: AssetPropertyParameter): {
  index: number
  property: 'weight'
} | null {
  const match = param.match(/^assets\.weight\.(\d+)$/)
  if (!match) return null
  return {
    property: 'weight',
    index: parseInt(match[1]!, 10),
  }
}

/**
 * How many years the plan runs. The tool never interprets startYear and endYear
 * (they may be ages or calendar years), only their difference, which has to be
 * a whole number of years and at least one. Anything else is a mistake in the
 * input rather than something to round, so it throws.
 */
export function horizonYears(plan: { startYear: number; endYear: number }): number {
  const years = plan.endYear - plan.startYear
  if (!Number.isInteger(years) || years < 1) {
    throw new Error(
      `Slutår (${plan.endYear}) måste ligga ett helt antal år efter startår (${plan.startYear}).`,
    )
  }
  return years
}
