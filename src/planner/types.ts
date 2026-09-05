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

// Skatteverket calls a taxable brokerage account an aktie- och fondkonto (AF),
// so that is the term used throughout the planner.
export type PlannerAccountType = 'ISK' | 'AF'

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
 * `need` is the amount that must come out of the portfolio; a negative need
 * is a deposit. `extra` is the discretionary amount on top, used only by
 * the upper bracketing run. Splitting them this way lets the plan express
 * things like "spend 400k/yr until the state pension starts, then 250k plus up
 * to 150k if the portfolio allows".
 */
export interface CashflowYear {
  need: number
  /** Non-negative top-up above the need. */
  extra: number
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

  /**
   * Schablonintäkt rate on fund holdings in an AF account, 0.4% in law. Unlike
   * the ISK schablon this is capital *income*, so it nets against realised
   * gains and losses before the rate is applied.
   */
  afSchablonRate: number

  /**
   * Cost basis of the starting capital as a fraction of its value. 1 means
   * freshly invested money with no unrealised gain; 0.4 means 60% of the
   * balance is untaxed gain. Only used by AF — an ISK has no cost basis.
   */
  initialCostBasisRatio: number

  /** Deterministic annual inflation, used to deflate nominal tax thresholds. */
  inflationRate: number

  /**
   * Real capital the plan should still hold at the horizon, as a fraction of
   * `initialCapital`. 0 means the plan may be spent down to nothing.
   *
   * A share rather than an amount because that is the question a household
   * actually has an opinion on — "leave the capital intact", "leave half" —
   * and because it is the form that survives editing the plan: rescaling the
   * starting capital, or applying the extra solver's multiplier, leaves the
   * intent alone instead of turning it into a different target.
   *
   * Measured **net of the deferred capital gains tax**, like the Slutkapital
   * table's default view: an AF balance owes its heirs' tax bill, so only the
   * after-tax figure is what is actually left behind, and only on that basis is
   * the same target the same thing in an ISK and an AF. Both sides are real, so
   * "100%" means preserving the purchasing power of the starting capital, not
   * its kronor.
   *
   * It changes what the *adaptive* run spends and nothing else. The rule holds
   * the target back as a commitment alongside the need, so only the
   * discretionary extra pays for it; the need is untouched, the two fixed runs
   * ignore it, and failing to leave it is not ruin — ruin stays "failed to fund
   * the need". `PropagationRun.bequestProbability` reports how often each run
   * reaches it, which is what makes the cost of the target visible.
   */
  bequestRatio: number

  /**
   * Consumption units the plan's household is worth, on SCB's scale: 1 for a
   * single adult, 1.51 for a cohabiting couple.
   *
   * **The engine ignores this.** It exists only to place the withdrawals
   * against SCB's income distribution, which is published per consumption unit
   * so that households of different sizes are comparable. It rides along in
   * `PlannerParameters` so that a shared link shows the reader the same
   * percentile the sender saw; the store keeps it out of the recompute trigger
   * so changing it does not re-run three propagations for a label.
   *
   * Any positive number is accepted from the URL — the scale can express a
   * couple with an adult child at home — but the UI offers only the two forms
   * a drawdown plan is nearly always one of.
   */
  consumptionUnits: number

  /** One entry per year; length must equal `years`. */
  cashflow: CashflowYear[]

  /** Number of wealth grid nodes. Higher is more accurate and slower. */
  gridNodes: number
  /** Number of quadrature nodes for the annual return integral. */
  quadratureNodes: number
  /**
   * Nodes across the cost-basis ratio, the second state dimension an AF account
   * needs. Ignored for ISK, which collapses to a single node.
   */
  basisNodes: number
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
  /**
   * Expected share of the portfolio sold each year to restore target weights,
   * implied by how far the assets drift apart. Derived rather than assumed, and
   * only taxable in an AF account.
   */
  rebalancingTurnover: number
}

/**
 * Discrete distribution of real capital.
 *
 * `mass` sums with `ruinProbability` and `depletedProbability` to 1. Both
 * zero-capital outcomes are held separately rather than as mass on a zero node,
 * because "the plan failed" and "the plan spent its last krona" are different
 * statements from "the balance happens to be small".
 */
export interface WealthDistribution {
  grid: Float64Array
  mass: Float64Array
  ruinProbability: number
  /**
   * Funded every commitment and ended with nothing.
   *
   * Not a failure, and kept apart from `ruinProbability` for that reason. The
   * adaptive run lands a whole band of outcomes here in the final year, where
   * it spends the entire remaining surplus by design.
   */
  depletedProbability: number
}

export interface YearOutcome {
  /** 0 = the starting position, before any return or cash flow. */
  year: number
  age: number
  /** Cumulative probability of having failed to fund a need withdrawal. */
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

/**
 * The spread of what a plan hands over in one year.
 *
 * Interesting mainly for the adaptive run, whose payout is the only one the
 * balance modulates: a fixed schedule pays its amount or has failed. Reported
 * for every run so the fixed ones can be drawn as the envelope the adaptive
 * payout moves inside.
 */
export interface WithdrawalOutcome {
  /** Index into `cashflow`, so a chart lines up with the schedule as entered. */
  index: number
  age: number
  /** Probability-weighted amount paid; the year's share of `expectedWithdrawn`. */
  mean: number
  percentile10: number
  median: number
  percentile90: number
}

export interface PropagationRun {
  label: string
  /** Length `years + 1`; index 0 is the deterministic starting position. */
  outcomes: YearOutcome[]
  /** Length `years`; one entry per cash-flow year. */
  withdrawals: WithdrawalOutcome[]
  finalDistribution: WealthDistribution
  /**
   * The same series and final distribution, net of the capital gains tax still
   * embedded in the balance.
   *
   * Present only for AF. An ISK carries no deferred liability, so its balance
   * is already net and there is nothing to report separately — which is also
   * why the UI's net-of-tax toggle only appears for AF.
   */
  liquidOutcomes?: YearOutcome[]
  finalLiquidDistribution?: WealthDistribution
  /**
   * Expected real cash actually taken over the horizon, probability-weighted.
   *
   * Two things pull it below the planned total, and the figure carries both. A
   * plan that fails in year 25 of 40 took every earlier year's flow and nothing
   * after, so failure paths contribute less. And the adaptive run declines part
   * of the extra whenever the surplus will not stretch to it — for that run
   * the planned total is only a ceiling.
   *
   * This is an expectation, not a median. The total taken depends on the whole
   * spending path, so its distribution would need cumulative withdrawals as a
   * state variable; the mean needs nothing beyond the mass already on the grid.
   */
  expectedWithdrawn: number
  /**
   * Probability of ending with at least the bequest target left, net of any
   * deferred tax. `undefined` when the plan sets no target.
   *
   * Reported for every run, not only the adaptive one that aims at it: what a
   * target costs is the difference between the runs, and a fixed schedule that
   * reaches it anyway is worth knowing about.
   */
  bequestProbability?: number
  /**
   * Mass that reached the top of the grid and was pinned there. Anything above
   * ~1e-6 means the grid was too narrow and the upper percentiles understate.
   */
  clippedMass: number
}

export interface PlannerResults {
  /** Withdrawing only the need each year. */
  needRun: PropagationRun
  /** Withdrawing need + the full extra every year, regardless of the balance. */
  extraRun: PropagationRun
  /**
   * Withdrawing the need plus as much of the extra as the surplus supports.
   *
   * The need is never touched and the extra is never exceeded, so the plan
   * is still driven by the amounts the household actually needs; the balance
   * only ever acts as a brake on the discretionary part.
   */
  adaptiveRun: PropagationRun
  portfolio: PortfolioMoments
  /**
   * Real return used to discount the need commitments when sizing the
   * reserve, at the plan's full horizon. Derived from the plan's own portfolio
   * and tax drag rather than asked for, so the adaptive rule introduces no
   * forecast of its own.
   *
   * The 25th percentile of the compound return: the need is a hard floor, and
   * failing it is what the model calls ruin. Nearer commitments discount at
   * lower rates still, since the quantile spread widens as the horizon shortens.
   */
  reserveReturn: number
  /**
   * Real return used to discount the bequest target — the plan's **median**
   * compound return, net of the same drag, and so always above `reserveReturn`.
   *
   * The two differ because the outcomes differ: missing the bequest is not
   * ruin, so it is not priced as a floor. Reported alongside the reserve rate
   * rather than left implicit, because a plan that discounts two commitments at
   * two rates should say so.
   */
  bequestReturn: number
}
