// Types for the deterministic capital planner.
//
// The planner answers "what is the distribution of real capital over time"
// without drawing sample paths. It propagates the whole probability density
// forward year by year, so sequence-of-returns risk is captured exactly (for
// the assumed return law) rather than estimated from samples, and the tails
// carry no simulation noise.
//
// Everything the user sees is in real (inflation-adjusted) terms, in today's
// money. Inflation only enters where the tax code is written in nominal
// kronor; see `iskAllowance`.

export type PlannerAccountType = 'ISK' | 'VP'

export interface PlannerAsset {
  /** Unique instance key. The same preset may appear twice, so this is not the preset's id. */
  id: string
  /**
   * Catalogue entry this asset came from, when it came from one. Correlations
   * for a newly added asset are looked up by preset, so a class re-added after
   * being removed comes back with its documented correlations rather than a
   * placeholder. Absent for a hand-rolled asset.
   */
  presetId?: string
  name: string
  /** Share of the portfolio. Weights are normalised before use. */
  weight: number
  /** Real arithmetic mean annual return, as a fraction (0.065 = 6.5%). */
  expectedRealReturn: number
  /** Annual standard deviation of the real return, as a fraction. */
  volatility: number
}

/**
 * One year of planned real cash flow, expressed in today's money.
 *
 * `floor` is the amount that must come out of the portfolio; a negative floor
 * is a deposit. `optional` is the discretionary amount on top, used only by
 * the upper bracketing run. Splitting them this way lets the plan express
 * things like "spend 400k/yr until the state pension starts, then 250k plus up
 * to 150k if the portfolio allows".
 */
export interface CashflowYear {
  floor: number
  /** Non-negative top-up above the floor. */
  optional: number
}

export interface PlannerParameters {
  initialCapital: number
  /** Age at the start of year 0. Used for axis labels only. */
  startAge: number
  /** Number of years to propagate. `cashflow` has one entry per year. */
  years: number

  assets: PlannerAsset[]
  /** Symmetric correlation matrix of real returns, diagonal 1. */
  correlations: number[][]

  accountType: PlannerAccountType

  /** ISK schablon basis rate (statslåneränta + påslag), nominal. */
  iskTaxRate: number
  /** Capital gains tax rate, applied to the schablon basis. */
  capitalGainsTaxRate: number
  /**
   * ISK schablonintäkt allowance (fribelopp) in nominal kronor. This is the one
   * place inflation changes a real result: the allowance is written in nominal
   * kronor, so its real value decays at the inflation rate. 0 disables it,
   * which reproduces the tax model used by the Monte Carlo simulator.
   *
   * The level went from 150 000 kr (2025) to 300 000 kr (2026) by legislated
   * step, not by indexation, and Skatteverket states no annual indexation
   * rule. It is therefore modelled as un-indexed: its real value decays at the
   * inflation rate until the Riksdag raises it again.
   */
  iskAllowance: number

  /** Deterministic annual inflation, used to deflate nominal tax thresholds. */
  inflationRate: number

  /** One entry per year; length must equal `years`. */
  cashflow: CashflowYear[]

  /** Number of wealth grid nodes. Higher is more accurate and slower. */
  gridNodes: number
  /** Number of quadrature nodes for the annual return integral. */
  quadratureNodes: number
}

/** Moment-matched lognormal description of the annually rebalanced portfolio. */
export interface PortfolioMoments {
  /** Arithmetic mean real return, as a fraction. */
  expectedReturn: number
  /** Variance of the real return. */
  variance: number
  /** Standard deviation of the real return. */
  volatility: number
  /** Mean of log(1 + real return). */
  logMean: number
  /** Standard deviation of log(1 + real return). */
  logStdDev: number
}

/**
 * Discrete distribution of real capital.
 *
 * `mass` sums with `ruinProbability` to 1. Ruined outcomes are held separately
 * rather than as mass on a zero node, because "the plan failed" is a different
 * statement from "the balance happens to be small".
 */
export interface WealthDistribution {
  grid: Float64Array
  mass: Float64Array
  ruinProbability: number
}

export interface YearOutcome {
  /** 0 = the starting position, before any return or cash flow. */
  year: number
  age: number
  /** Cumulative probability of having failed to fund a floor withdrawal. */
  ruinProbability: number
  /** Unconditional mean; ruined outcomes contribute zero. */
  mean: number
  percentile5: number
  percentile10: number
  percentile25: number
  median: number
  percentile75: number
  percentile90: number
  percentile95: number
}

export interface PropagationRun {
  label: string
  /** Length `years + 1`; index 0 is the deterministic starting position. */
  outcomes: YearOutcome[]
  finalDistribution: WealthDistribution
  /**
   * Mass that reached the top of the grid and was pinned there. Anything above
   * ~1e-6 means the grid was too narrow and the upper percentiles understate.
   */
  clippedMass: number
}

export interface PlannerResults {
  /** Withdrawing only the floor each year. */
  floorRun: PropagationRun
  /** Withdrawing floor + optional each year. */
  optionalRun: PropagationRun
  portfolio: PortfolioMoments
}
