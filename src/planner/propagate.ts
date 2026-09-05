import { normalQuadrature, type NormalQuadrature } from './quadrature'
import type {
  PlannerAsset,
  PlannerParameters,
  PlannerResults,
  PortfolioMoments,
  PropagationRun,
  WealthDistribution,
  WithdrawalOutcome,
  YearOutcome,
} from './types'

/** Headroom above the drift used to size the top of the wealth grid. */
const GRID_HEADROOM_SIGMAS = 6
/** The bottom of the grid, relative to the plan's monetary scale. */
const GRID_LOW_FRACTION = 1e-6

/**
 * Widest cost-basis ratio the grid represents. A ratio of 3 means the holding
 * is worth a third of what was paid for it; deeper losses are pinned to the top
 * node, which slightly understates the loss credit in a tail that has already
 * lost two thirds of its money.
 */
const BASIS_RATIO_MAX = 3

/**
 * A net capital loss gives a skattereduktion of the full rate on the first
 * 100 000 kr and 70% of it above. The threshold is nominal in law and is not
 * inflation-indexed, so it is deflated to today's money like any other nominal
 * threshold. Matching `simulation.ts`.
 */
const LOSS_CREDIT_THRESHOLD = 100_000
const LOSS_CREDIT_UPPER_QUOTA = 0.7

interface GridSpec {
  grid: Float64Array
  logLow: number
  logStep: number
  n: number
}

/**
 * The cost-basis dimension: basis divided by value, on a uniform grid.
 *
 * Uniform rather than geometric because the tax depends on the *unrealised gain
 * fraction* `1 - ratio`, which is linear in the ratio, so equal absolute
 * resolution is what keeps the tax error even. An ISK has no cost basis and
 * collapses this to a single node.
 */
interface BasisSpec {
  grid: Float64Array
  n: number
  step: number
}

interface StepContext {
  spec: GridSpec
  basis: BasisSpec
  quad: NormalQuadrature
  /** Real gross return at each quadrature node. */
  growth: Float64Array
  isAF: boolean
  /** ISK only: proportional annual drag on the balance. */
  iskRate: number
  /** AF only: share of the portfolio rebalancing realises each year. */
  turnover: number
  /** One plus the annual inflation rate. */
  inflationFactor: number
  params: PlannerParameters
}

/**
 * What a year's cash flow is, at one grid node.
 *
 * A fixed policy pays `baseFlow` whatever the balance. An adaptive one pays the
 * need plus as much of the extra as the surplus over the reserve supports —
 * so the amounts still come from what the household needs, and the balance only
 * decides how much of the discretionary part is affordable.
 */
interface YearPolicy {
  /** The whole flow when fixed; the need alone when adaptive. */
  baseFlow: number
  adaptive: boolean
  /** Adaptive only: the most that may be added on top of the need. */
  extra: number
  /** Adaptive only: capital to hold back for the remaining need commitments. */
  reserve: number
  /**
   * Adaptive only: capital to hold back for the bequest target, as the
   * after-tax value it has to be worth at the horizon, discounted to this year.
   */
  keep: number
  /**
   * Adaptive only: surplus needed per krona of *this* year's extra.
   *
   * The surplus is spread over the remaining extra commitments in the shape the
   * household drew them, so a year that asks for twice as much as its
   * neighbours is served twice as fast. A flat extra makes it the plain count
   * of discounted remaining payments.
   */
  annuityFactor: number
}

/**
 * The bequest target as an amount of real capital.
 *
 * Entered as a share of the starting capital, so this is the one place the two
 * are tied together. Both sides are real, so the target keeps its purchasing
 * power rather than its kronor.
 */
export function bequestTarget(params: PlannerParameters): number {
  return Math.max(0, params.bequestRatio) * Math.max(0, params.initialCapital)
}

/**
 * Reserve, bequest reserve and annuity factor for every year, by backward
 * recursion.
 *
 * `reserve[t]` is what the remaining need commitments are worth at the start
 * of year t; `annuity[t]` is how much surplus one krona of year t's extra
 * costs, so `surplus / annuity[t]` is what the year can pay.
 *
 * The surplus is spread over the remaining extra **in the shape the household
 * drew it**, not as a level amount. `extraPV[t]` is the discounted value of
 * every extra still to come, and dividing by the year's own extra turns it into
 * that year's share of it: a go-go decade asking 200 000 a year against 25 000
 * later is served eight times as fast, and a plan whose extra is flat gets the
 * plain count of discounted remaining payments the rule always used.
 *
 * Levelling it instead — one annuity factor for every year regardless of what
 * was asked for — quietly overrode the schedule. On a 9 mkr plan asking 400 000
 * for ten years then tapering, the median payout in the first year was 283 000
 * of the 400 000 requested and did not reach the request until the tapered
 * years, which is the opposite of the profile that was drawn. Following the
 * shape pays 363 000 in year one and the full 400 000 from year four. It costs
 * survival — 86.4% to 84.2% on that plan, for 0.33 mkr more expected spending —
 * and that price is real rather than an artefact: kronor taken at 60 are
 * exposed to sequence risk that kronor taken at 90 are not. But it is the
 * household's price to pay, and the extra solver is the lever for it, because
 * scaling the extra preserves the shape while the level does not.
 *
 * Each fold discounts one year at `rateFor(years - t)`, the rate for the
 * horizon still left at that point, so the discount curve tightens as the plan
 * runs out of room to recover. See `reserveReturnFor` for why a single
 * full-horizon rate was the rule's main source of aggression.
 *
 * A commitment therefore reaches year 0 through a product of one-year factors
 * spanning long horizons at the start and short ones at the end, rather than
 * being discounted at the rate for its own distance. That alternative — a
 * stationary term structure along the path that sits at the 25th percentile at
 * every horizon at once — is more conservative again, chiefly about the next
 * few years, and is the obvious next thing to try if the rule still looks too
 * aggressive. It was not measured.
 *
 * `keep[t]` is the bequest target discounted the same way. It is held apart
 * from the need reserve because the two are in different units: the need is
 * **cash delivered to the household**, while the bequest is capital that is
 * never sold at all. On an AF those convert differently — raising a krona
 * realises gain and costs more than a krona of balance, whereas leaving a krona
 * behind costs the deferred tax on it — so `step()` converts each at the node's
 * own cost basis, which it knows and this schedule cannot.
 *
 * Discounting the bequest at the same 25th-percentile rate as the need is what
 * makes it a commitment rather than a hope: the surplus is measured over what
 * the target needs to be worth today if the portfolio does poorly, not on the
 * median path.
 *
 * The reserve is floored at zero. A schedule whose future deposits outweigh its
 * withdrawals would otherwise produce a negative requirement, manufacturing
 * surplus out of money not yet paid in.
 */
function reserveSchedule(params: PlannerParameters, rateFor: (horizon: number) => number) {
  const years = params.years
  const reserve = new Float64Array(years + 1)
  const annuity = new Float64Array(years + 1)
  const extraPV = new Float64Array(years + 1)
  const keep = new Float64Array(years + 1)

  keep[years] = bequestTarget(params)
  for (let t = years - 1; t >= 0; t--) {
    const discount = 1 / (1 + rateFor(years - t))
    const extra = Math.max(0, params.cashflow[t]!.extra)
    reserve[t] = params.cashflow[t]!.need + reserve[t + 1]! * discount
    extraPV[t] = extra + extraPV[t + 1]! * discount
    // A year that wants nothing discretionary is capped at zero anyway, so the
    // factor is never read; one keeps it out of the way of a 0/0.
    annuity[t] = extra > 0 ? extraPV[t]! / extra : 1
    keep[t] = keep[t + 1]! * discount
  }
  for (let t = 0; t <= years; t++) {
    if (reserve[t]! < 0) reserve[t] = 0
  }

  return { reserve, annuity, keep }
}

/**
 * Quantile of the compound return used to size the reserve, and its z score.
 *
 * Not the median. Discounting the need at the return the plan expects on
 * average makes the reserve a coin-flip hurdle: clearing it only means the
 * need is funded on the median path, and half of all paths are worse. A plan
 * would then pass the test for years while spending the whole extra, and
 * only start cutting once the damage was done. A lower quantile asks the
 * question that matters — is the need funded even if the portfolio does
 * poorly — which is what the safety-first literature asks of essential
 * spending: secure it first, treat the rest as discretionary.
 */
const RESERVE_QUANTILE_Z = -0.6744897501960817 // 25th percentile

/**
 * The real return a commitment `horizon` years away is discounted at.
 *
 * Derived from the plan's own return law rather than asked for, so the adaptive
 * rule introduces no forecast the plan was not already making: it is the 25th
 * percentile of the annualised compound return over that horizon, less the
 * proportional tax drag.
 *
 * **The horizon is the one actually remaining, not the plan's original one.**
 * Quantile dispersion shrinks as 1/sqrt(T), so a single full-horizon rate is
 * only about 1.7 points below the median on a forty-year plan — and it stays
 * 1.7 points below in year 38, when the honest figure for two years left is
 * nearer 7. That made the reserve most optimistic exactly where a bad sequence
 * can no longer be recovered from, and it was the whole of the rule's
 * aggression: measured on the default plan, discounting each year at its own
 * remaining horizon buys 2.4 points of survival for 0.9% of the expected
 * spending, and takes the final year's failure step from 1.67x its predecessor
 * to 1.44x (AF: 1.76x to 1.51x). No other adjustment tried came close on that
 * exchange rate — a lower quantile at the full horizon costs twice as much
 * spending per point, and scaling the extra costs fifteen times as much,
 * because it cuts discretionary spending in the good states too, where it
 * buys no safety at all.
 *
 * Only the schablonintäkt is subtracted for AF, and that is the whole of it:
 * the schablon is a drag on the balance and so belongs in the rate, while the
 * tax on realised gains is a cost of *raising* cash and is priced into the
 * amount instead, by `step()` dividing the reserve through the node's payable
 * share. Charging it twice would reserve a plan into never spending.
 */
function reserveReturnFor(
  params: PlannerParameters,
  moments: PortfolioMoments,
  horizon: number,
): number {
  const taxDrag =
    params.accountType === 'AF'
      ? params.afSchablonRate * params.capitalGainsTaxRate
      : params.iskTaxRate * params.capitalGainsTaxRate
  const annualised =
    Math.exp(
      moments.logMean + (RESERVE_QUANTILE_Z * moments.logStdDev) / Math.sqrt(Math.max(1, horizon)),
    ) - 1
  return Math.max(-0.99, annualised - taxDrag)
}

/** Which of the three bracketing runs a propagation represents. */
type SpendingMode = 'need' | 'extra' | 'adaptive'

/**
 * Number of bins the year's payout is collected into.
 *
 * The payout spans at most `need + extra`, so a few hundred bins put the
 * quantisation three orders of magnitude below the amount itself — well under
 * the two significant digits the outputs are rounded to.
 */
const FLOW_BINS = 257

/**
 * Histogram of what a plan hands over in one year.
 *
 * A histogram rather than a mapping of the wealth quantiles, even though the
 * payout is monotone in the balance: on an AF it also depends on the cost-basis
 * ratio, through the tax the sale realises, so there is no single index to read
 * the quantiles off.
 *
 * Linear binning splits each amount between its two neighbouring bins, which
 * conserves the mean exactly. That is what lets the mean of this histogram and
 * `expectedWithdrawn` be the same number rather than two estimates of it.
 */
interface FlowHistogram {
  low: number
  step: number
  /** Reciprocal of `step`, so binning costs a multiply rather than a divide in
   *  a loop that runs hundreds of millions of times. Zero for a degenerate
   *  range, which is the flag that everything lands in one bin. */
  perStep: number
  mass: Float64Array
}

function buildFlowHistogram(baseFlow: number, extra: number): FlowHistogram {
  // A failed year pays nothing, so zero has to be inside the range even when
  // the schedule itself never passes through it.
  const low = Math.min(0, baseFlow)
  const high = Math.max(0, baseFlow + extra)
  const step = high > low ? (high - low) / (FLOW_BINS - 1) : 0
  return { low, step, perStep: step > 0 ? 1 / step : 0, mass: new Float64Array(FLOW_BINS) }
}

function addFlow(histogram: FlowHistogram, value: number, probability: number): void {
  if (histogram.perStep === 0) {
    histogram.mass[0]! += probability
    return
  }
  const position = (value - histogram.low) * histogram.perStep
  let index = position | 0
  if (index < 0) index = 0
  else if (index > FLOW_BINS - 2) index = FLOW_BINS - 2
  const fraction = position - index
  histogram.mass[index]! += probability * (1 - fraction)
  histogram.mass[index + 1]! += probability * fraction
}

interface StepResult {
  mass: Float64Array
  /** Probability-weighted cash actually taken this year. */
  withdrawn: number
  /** Mass that failed to fund its need withdrawal in this step. */
  ruin: number
  /**
   * Mass that funded the year in full and was left with nothing.
   *
   * A separate outcome from ruin: the commitment was met. It is what the
   * adaptive rule aims for in the final year, where the annuity factor is one
   * and the whole remaining surplus is spent.
   */
  depleted: number
  /** Mass pinned to the top grid node. */
  clipped: number
}

/** Normalises weights to sum to one, rejecting a degenerate portfolio. */
function normalizedWeights(assets: PlannerAsset[]): number[] {
  const total = assets.reduce((sum, asset) => sum + Math.max(0, asset.weight), 0)
  if (!(total > 0)) {
    throw new Error('planner: portfolio weights must sum to a positive number')
  }
  return assets.map((asset) => Math.max(0, asset.weight) / total)
}

function correlationAt(correlations: number[][], i: number, j: number): number {
  if (i === j) return 1
  // The matrix is stored symmetrically, but accept either triangle so a
  // partially filled matrix still works.
  const value = correlations[i]?.[j] ?? correlations[j]?.[i] ?? 0
  if (!Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

/**
 * Collapses the portfolio to a single lognormal real return.
 *
 * A weighted sum of lognormals is not itself lognormal, so this is a
 * moment match: the portfolio's arithmetic mean and variance are computed
 * exactly from the asset moments and the correlation matrix, then a lognormal
 * is fitted to those two moments. At annual frequency the fit is good, and it
 * is what keeps the return dimension one-dimensional.
 *
 * This assumes the portfolio is rebalanced to its target weights every year.
 * Letting the weights drift would make the asset split a path-dependent state
 * of its own, which the grid does not carry.
 */
export function portfolioMoments(
  assets: PlannerAsset[],
  correlations: number[][],
): PortfolioMoments {
  if (assets.length === 0) {
    throw new Error('planner: the portfolio needs at least one asset')
  }
  const weights = normalizedWeights(assets)

  let expectedReturn = 0
  for (let i = 0; i < assets.length; i++) {
    expectedReturn += weights[i]! * assets[i]!.expectedRealReturn
  }

  let variance = 0
  for (let i = 0; i < assets.length; i++) {
    for (let j = 0; j < assets.length; j++) {
      variance +=
        weights[i]! *
        weights[j]! *
        assets[i]!.volatility *
        assets[j]!.volatility *
        correlationAt(correlations, i, j)
    }
  }

  // A hand-entered correlation matrix can fail to be positive semi-definite,
  // which shows up here as a negative variance. That is a real input error and
  // silently clamping it would hide an impossible portfolio, so reject it.
  if (variance < -1e-12) {
    throw new Error(
      'planner: the correlation matrix is not consistent — it implies a negative portfolio variance',
    )
  }
  variance = Math.max(0, variance)

  const gross = 1 + expectedReturn
  if (!(gross > 0)) {
    throw new Error(
      `planner: the portfolio expected return of ${expectedReturn} wipes out the capital every year`,
    )
  }

  const logStdDev = Math.sqrt(Math.log(1 + variance / (gross * gross)))
  const logMean = Math.log(gross) - 0.5 * logStdDev * logStdDev

  return {
    expectedReturn,
    variance,
    volatility: Math.sqrt(variance),
    logMean,
    logStdDev,
    rebalancingTurnover: expectedRebalancingTurnover(
      assets,
      correlations,
      weights,
      expectedReturn,
      variance,
    ),
  }
}

/**
 * Error function, Abramowitz & Stegun 7.1.26. Absolute error below 1.5e-7,
 * orders of magnitude finer than the turnover estimate needs.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const absolute = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * absolute)
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - poly * Math.exp(-absolute * absolute))
}

/** E|X| for X ~ N(mean, sd^2): the mean of the folded normal. */
function foldedNormalMean(mean: number, sd: number): number {
  if (!(sd > 0)) return Math.abs(mean)
  const t = mean / sd
  const density = Math.exp(-0.5 * t * t) / Math.sqrt(2 * Math.PI)
  const cdf = 0.5 * (1 + erf(t / Math.SQRT2))
  return sd * (2 * density + t * (2 * cdf - 1))
}

/**
 * Expected share of the portfolio sold each year to restore target weights.
 *
 * Rebalancing is not a free parameter: it is forced by the assets drifting
 * apart, so it follows from the same moments the portfolio return does. After a
 * year asset i holds weight `x_i·G_i / G_p`, and restoring the targets means
 * selling everything that ended overweight —
 *
 *     turnover = ½ Σ_i |x_i·G_i/G_p − x_i| = ½ Σ_i x_i·|R_i − R_p| / (1 + R_p)
 *
 * Each excess return `R_i − R_p` is a linear combination of the asset returns,
 * so it is approximately normal with variance `σ_i² − 2·Cov(R_i, R_p) + σ_p²`,
 * and its expected absolute value is a folded normal mean. The denominator is
 * replaced by its own mean, which varies far less than the numerator.
 *
 * Consequences worth knowing: a single-asset portfolio has nothing to
 * rebalance and turns over nothing, and two perfectly correlated assets with
 * equal volatility never drift apart. Dispersion is what creates turnover, not
 * volatility as such.
 */
function expectedRebalancingTurnover(
  assets: PlannerAsset[],
  correlations: number[][],
  weights: number[],
  expectedReturn: number,
  variance: number,
): number {
  if (assets.length < 2) return 0

  let total = 0
  for (let i = 0; i < assets.length; i++) {
    let covariance = 0
    for (let j = 0; j < assets.length; j++) {
      covariance +=
        weights[j]! *
        assets[i]!.volatility *
        assets[j]!.volatility *
        correlationAt(correlations, i, j)
    }
    const excessVariance = Math.max(
      0,
      assets[i]!.volatility * assets[i]!.volatility - 2 * covariance + variance,
    )
    total +=
      weights[i]! *
      foldedNormalMean(assets[i]!.expectedRealReturn - expectedReturn, Math.sqrt(excessVariance))
  }

  const gross = 1 + expectedReturn
  return gross > 0 ? Math.min(1, total / (2 * gross)) : 0
}

function buildGrid(low: number, high: number, n: number): GridSpec {
  if (!(low > 0) || !(high > low)) {
    throw new Error(`planner: invalid grid bounds [${low}, ${high}]`)
  }
  const logLow = Math.log(low)
  const logStep = (Math.log(high) - logLow) / (n - 1)
  const grid = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    grid[i] = Math.exp(logLow + i * logStep)
  }
  // The spacing is geometric because the dynamics are multiplicative: constant
  // relative resolution keeps the interpolation error uniform across four
  // orders of magnitude of capital.
  return { grid, logLow, logStep, n }
}

/**
 * Builds the cost-basis grid, with a node exactly at a ratio of one.
 *
 * That point matters more than any other: it is where a holding switches from
 * unrealised gain to unrealised loss, so it is the kink in `max(0, 1 - ratio)`
 * that the tax and the liquidation value both turn on, and it is where freshly
 * invested money starts. Letting it fall between nodes smears a little
 * phantom gain across a holding that has none, which shows up as a liquidation
 * value below par for a portfolio that owes nothing.
 *
 * The requested node count is therefore rounded to the nearest whole number of
 * steps per unit ratio rather than honoured exactly.
 */
function buildBasisGrid(requestedNodes: number): BasisSpec {
  if (requestedNodes <= 1) {
    // ISK: no cost basis to carry, so the dimension degenerates to one node.
    return { grid: Float64Array.of(1), n: 1, step: 0 }
  }
  const perUnit = Math.max(1, Math.round((requestedNodes - 1) / BASIS_RATIO_MAX))
  const step = 1 / perUnit
  const n = perUnit * BASIS_RATIO_MAX + 1
  const grid = new Float64Array(n)
  for (let i = 0; i < n; i++) grid[i] = i * step
  return { grid, n, step }
}

/**
 * Sizes the grid so that essentially no mass escapes either end.
 *
 * The top is the best case that the return law can plausibly reach: pure drift
 * plus `GRID_HEADROOM_SIGMAS` standard deviations of cumulative log return,
 * applied to the capital that could have accumulated with no withdrawals. The
 * bottom is a small fraction of the plan's monetary scale — below that a
 * portfolio cannot fund another year of spending and will be absorbed into
 * ruin on the next step anyway.
 */
function gridBounds(params: PlannerParameters, moments: PortfolioMoments) {
  let deposits = 0
  let scale = Math.max(params.initialCapital, 1)

  for (const year of params.cashflow) {
    // Deposits are largest when the extra top-up is not taken, so the need
    // alone bounds how much capital can be added.
    if (year.need < 0) deposits += -year.need
    scale = Math.max(scale, Math.abs(year.need) + Math.max(0, year.extra))
  }

  const drift = Math.max(0, moments.logMean) * params.years
  const spread = moments.logStdDev * Math.sqrt(params.years) * GRID_HEADROOM_SIGMAS
  const high = (Math.max(params.initialCapital, 0) + deposits + scale) * Math.exp(drift + spread)
  const low = Math.max(1e-6, scale * GRID_LOW_FRACTION)

  return { low, high }
}

/**
 * The AF tax bill for one year, as capital income.
 *
 * Schablonintäkt and every realised gain and loss land in the same bucket and
 * net against each other before the rate is applied (kvittning within
 * inkomstslaget kapital). A rate applied per position would charge the winners
 * in full while the losers went unrecognised.
 *
 * Returns a signed amount: negative is a skattereduktion, which flows back into
 * the portfolio as new money. That assumes enough other final tax — pension
 * income, say — to absorb the credit.
 *
 * The bill is *not* capped at the balance. A charge the portfolio cannot cover
 * is a plan that has failed, and only the caller knows that; forgiving the
 * excess here would let an account be emptied by a withdrawal, owe tax on the
 * gain it realised, and carry on as though the debt had never existed.
 */
function afTax(
  balance: number,
  basisRatio: number,
  realizedGain: number,
  lossThresholdReal: number,
  schablonRate: number,
  capitalGainsTaxRate: number,
): number {
  const netCapitalIncome = balance * schablonRate + realizedGain

  let tax: number
  if (netCapitalIncome >= 0) {
    tax = netCapitalIncome * capitalGainsTaxRate
  } else {
    const loss = -netCapitalIncome
    const lowerTier = Math.min(loss, lossThresholdReal)
    const upperTier = loss - lowerTier
    tax = -(
      lowerTier * capitalGainsTaxRate +
      upperTier * capitalGainsTaxRate * LOSS_CREDIT_UPPER_QUOTA
    )
  }

  // Raising the cash to pay the bill is itself a sale, so it realises further
  // gain and further tax. Solve for the gross amount G that nets the tax due:
  // G = tax + G·u·r, hence G = tax / (1 - u·r), with u the unrealised gain
  // fraction and r the rate. Closed form rather than iterating to a fixed
  // point. Sitting at an unrealised loss does not reduce the cash the bill
  // needs, so u is floored at zero.
  if (tax > 0) {
    const unrealizedFraction = Math.max(0, 1 - basisRatio)
    const denominator = 1 - unrealizedFraction * capitalGainsTaxRate
    if (denominator > 0) tax = tax / denominator
  }

  return tax
}

/**
 * The share of a grown AF balance that can be withdrawn with the tax the
 * withdrawal itself triggers still payable out of what remains.
 *
 * Selling realises gain, and the gain is taxed whether or not anything is left
 * to pay with, so "withdraw the whole balance" is not a feasible instruction
 * for a taxable account. Everything in the year's tax is proportional to either
 * the withdrawal or the balance behind it, so the largest fundable withdrawal
 * has a closed form: with `k` the effective rate after the gross-up, the
 * remainder must satisfy `x·(1 − k·(s + τ·(1−r))) ≥ k·(1−r)·F`, which solves to
 * a fixed share of the grown balance.
 *
 * Depends only on the cost-basis ratio and the year's rates, so it is computed
 * once per basis and return node rather than per wealth node.
 *
 * An unrealised loss makes the year's capital income negative, and a credit is
 * an inflow rather than a charge, so the whole balance stays available.
 */
function payableWithdrawalShare(
  basisRatio: number,
  schablonRate: number,
  turnover: number,
  capitalGainsTaxRate: number,
): number {
  const unrealizedFraction = Math.max(0, (1 - basisRatio) * (1 - turnover))
  const denominator = 1 - unrealizedFraction * capitalGainsTaxRate
  if (!(denominator > 0)) return 0
  const rate = capitalGainsTaxRate / denominator

  const remainderShare = 1 - rate * (schablonRate + turnover * (1 - basisRatio))
  const withdrawalShare = rate * (1 - basisRatio)
  if (!(remainderShare > 0)) return 0
  const total = remainderShare + withdrawalShare
  if (!(total > 0)) return 1
  return Math.min(1, remainderShare / total)
}

/**
 * Advances one year: apply the real return, take the cash flow, rebalance, then
 * tax.
 *
 * The ordering mirrors the Monte Carlo simulator so the two engines can be
 * compared directly.
 *
 * The cost-basis ratio needs no separate transition rule for most of this.
 * Genomsnittsmetoden scales the basis by the same fraction as the value on any
 * partial disposal, so a withdrawal and a tax payment both leave the *ratio*
 * untouched — only returns, deposits and rebalancing move it.
 *
 * The loop nests basis, then return, then wealth, for two reasons. Mass is
 * stored basis-major so the innermost loop walks contiguous memory. And for a
 * fixed basis node and return, the post-tax wealth is monotone increasing in
 * the source wealth, so the target cell can be found by walking a pointer
 * forward instead of taking a logarithm per node — which at a few hundred
 * million node-return pairs was the single dominant cost.
 */
function step(
  ctx: StepContext,
  sourceValues: Float64Array,
  sourceMass: Float64Array,
  policy: YearPolicy,
  allowanceReal: number,
  lossThresholdReal: number,
  flows: FlowHistogram,
): StepResult {
  const { spec, basis, quad, growth, isAF, iskRate, turnover, inflationFactor, params } = ctx
  const nWealth = sourceValues.length
  const nGrid = spec.n
  const grid = spec.grid
  const mass = new Float64Array(nGrid * basis.n)
  const nodes = growth.length

  const capitalGainsTaxRate = params.capitalGainsTaxRate
  const schablonRate = params.afSchablonRate
  const top = grid[nGrid - 1]!
  const { adaptive, baseFlow, extra, reserve, keep, annuityFactor } = policy
  // With a fixed flow the sign is known before the loops, which lets the AF
  // path hoist the post-flow basis ratio out of the wealth loop. An adaptive
  // flow varies per node, so those have to be computed inside.
  const isWithdrawal = baseFlow >= 0

  let ruin = 0
  let depleted = 0
  let clipped = 0
  let withdrawn = 0
  let paidMass = 0

  for (let b = 0; b < basis.n; b++) {
    const rowOffset = b * nWealth
    const startRatio = basis.grid[b]!

    for (let k = 0; k < nodes; k++) {
      const factor = growth[k]!
      const weight = quad.weight[k]!
      // The cost basis is a nominal amount fixed at purchase, and Swedish law
      // does not index it, so what is taxed is the *nominal* gain. The ratio is
      // unit-free — basis and value deflate alike — so it has to fall with
      // nominal growth, not the real growth this grid runs on. Dividing by the
      // real factor alone would silently inflation-index the omkostnadsbelopp
      // and understate the tax by the whole price level: 2% over forty years
      // overstates the basis by more than a factor of two.
      const grownRatio = startRatio / (factor * inflationFactor)
      // A proportional disposal leaves the ratio alone, so the post-flow ratio
      // is just grownRatio. With a fixed flow the realised gain is known here
      // too, before the wealth loop starts.
      const flatGain = !adaptive && isWithdrawal ? baseFlow * (1 - grownRatio) : 0
      // An ISK's schablon is a fraction of the balance, so whatever is left
      // always covers it and the whole balance is withdrawable. An AF has to
      // keep back the tax on the gain the sale realises.
      const payableShare = isAF
        ? payableWithdrawalShare(grownRatio, schablonRate, turnover, capitalGainsTaxRate)
        : 1
      // The reserve and the annuity are in cash delivered; the balance is not.
      // Holding back the need itself would leave an AF short of the tax that
      // raising it costs, so the reserve becomes the balance that funds it, and
      // a surplus of balance supports a correspondingly smaller payment.
      //
      // Both use the share at this node's *current* basis. Gains accrue as the
      // plan runs, so the share the far future will face is lower and the
      // reserve is still a little optimistic — carrying that would need the
      // remaining horizon's basis path as a state of its own.
      //
      // The bequest converts the other way. It is never sold, so it costs no
      // gain tax to raise — but it is measured after the tax the heirs inherit,
      // so the balance that leaves that much behind is larger than the target
      // by exactly the deferred liability. Dividing it by `payableShare` like
      // the need would charge a sale that never happens.
      const keptBalance = isAF
        ? keep / (1 - Math.max(0, 1 - grownRatio) * capitalGainsTaxRate)
        : keep
      const reservedBalance = (payableShare > 0 ? reserve / payableShare : Infinity) + keptBalance
      const paymentPerSurplus = payableShare / annuityFactor

      let pointer = 0

      for (let j = 0; j < nWealth; j++) {
        const probability = sourceMass[rowOffset + j]! * weight
        if (probability <= 0) continue

        const grown = sourceValues[j]! * factor

        // Ruin is defined as being unable to fund the need withdrawal in
        // full — the tax the withdrawal itself triggers included, since a
        // household that cannot settle the bill has not funded the year.
        // Paying part of it and continuing would understate the failure.
        // Landing on exactly zero is *not* ruin: the commitment was met and
        // nothing was left over, which is precisely what the adaptive rule
        // aims for in the final year.
        const available = grown * payableShare - baseFlow
        if (available < 0) {
          ruin += probability
          if (adaptive) addFlow(flows, 0, probability)
          continue
        }

        let flow = baseFlow
        if (adaptive) {
          // Spend the need, then this year's share of what the surplus over
          // the reserve would support across the extra still to come — never
          // more than the extra the household actually asked for, and never
          // more than can be paid for. Two things bound the last one: a schedule whose
          // future deposits push the reserve below the current need can ask
          // for more than the balance holds, and on an AF the sale that funds
          // the withdrawal is taxed.
          const surplus = grown - reservedBalance
          if (surplus > 0) flow += Math.min(extra, surplus * paymentPerSurplus, available)
        }

        const afterFlow = grown - flow

        let tax: number
        let ratio = 1

        if (isAF) {
          let realizedGain: number
          if (flow >= 0) {
            ratio = grownRatio
            realizedGain = adaptive ? flow * (1 - grownRatio) : flatGain
          } else {
            // A deposit buys at market, so it adds equally to value and basis
            // and pulls the ratio toward one.
            ratio = (grownRatio * grown - flow) / afterFlow
            realizedGain = 0
          }

          if (turnover > 0) {
            // Selling and rebuying a slice realises its gain and steps that
            // slice's basis up to market.
            //
            // TODO: the slice is charged the portfolio's *average* basis ratio,
            // but rebalancing sells whatever ended overweight — the winners,
            // which carry more embedded gain than average. That understates the
            // realised gain, and so the AF tax. Correcting it needs the basis
            // per asset, which the aggregated portfolio does not carry.
            realizedGain += turnover * afterFlow * (1 - ratio)
            ratio = ratio * (1 - turnover) + turnover
          }

          tax = afTax(
            afterFlow,
            ratio,
            realizedGain,
            lossThresholdReal,
            schablonRate,
            capitalGainsTaxRate,
          )
        } else {
          const taxable = allowanceReal > 0 ? Math.max(0, afterFlow - allowanceReal) : afterFlow
          tax = taxable * iskRate
        }

        const next = afterFlow - tax

        // The adaptive rule aims squarely at the point where what remains is
        // exactly the bill, so the closed form that caps the withdrawal and the
        // one that charges the tax have to agree to the last bit or a whole
        // band of outcomes flips to ruin on rounding noise. A shortfall inside
        // a billionth of the balance is that noise — fractions of an öre on a
        // multi-million plan — and not something a household could act on.
        const noise = grown * 1e-9

        // A bill the remaining balance cannot cover is a failed year, and the
        // withdrawal that caused it was never really affordable, so it is not
        // counted either. `payableShare` keeps the adaptive rule clear of this
        // by construction; a fixed schedule can still walk into it.
        if (next < -noise) {
          ruin += probability
          if (adaptive) addFlow(flows, 0, probability)
          continue
        }

        withdrawn += probability * flow
        paidMass += probability
        // A fixed schedule pays the same amount wherever it can afford it, so
        // its payout is two lumps and is added once at the end. Only the
        // adaptive run varies node by node, and this loop body runs hundreds of
        // millions of times, so it is worth the branch.
        if (adaptive) addFlow(flows, flow, probability)

        // Spending can empty the account exactly, owing nothing further. The
        // year's commitment was met, so this is not ruin; it leaves the grid as
        // depleted mass, at a capital of exactly zero. Calling it ruin instead
        // would put a step in the last year of the adaptive run's survival
        // curve, which by construction spends the whole remaining surplus and
        // so lands a whole band of outcomes on zero.
        if (next <= noise) {
          depleted += probability
          continue
        }

        if (isAF && tax < 0) {
          // The credit comes back as new money buying units at the current
          // price, so it adds to value and basis alike.
          ratio = (ratio * afterFlow - tax) / next
        }

        if (next >= top) clipped += probability

        // `next` is monotone in `j` here, so the bracketing cell is never
        // behind the pointer.
        while (pointer < nGrid - 2 && grid[pointer + 1]! < next) pointer++
        const g0 = grid[pointer]!
        let fraction = (next - g0) / (grid[pointer + 1]! - g0)
        if (fraction < 0) fraction = 0
        else if (fraction > 1) fraction = 1

        const lowMass = probability * (1 - fraction)
        const highMass = probability * fraction

        if (basis.n === 1) {
          mass[pointer]! += lowMass
          mass[pointer + 1]! += highMass
          continue
        }

        let bIndex: number
        let bFraction: number
        const position = ratio / basis.step
        if (position <= 0) {
          bIndex = 0
          bFraction = 0
        } else if (position >= basis.n - 1) {
          bIndex = basis.n - 2
          bFraction = 1
        } else {
          bIndex = position | 0
          bFraction = position - bIndex
        }

        const low = bIndex * nGrid + pointer
        const high = low + nGrid
        mass[low]! += lowMass * (1 - bFraction)
        mass[low + 1]! += highMass * (1 - bFraction)
        mass[high]! += lowMass * bFraction
        mass[high + 1]! += highMass * bFraction
      }
    }
  }

  if (!adaptive) {
    addFlow(flows, baseFlow, paidMass)
    addFlow(flows, 0, ruin)
  }

  return { mass, ruin, depleted, clipped, withdrawn }
}

/** Sums the joint mass over the cost-basis dimension. */
function marginalOverBasis(mass: Float64Array, spec: GridSpec, basis: BasisSpec): Float64Array {
  if (basis.n === 1) return mass
  const marginal = new Float64Array(spec.n)
  for (let b = 0; b < basis.n; b++) {
    const offset = b * spec.n
    for (let j = 0; j < spec.n; j++) marginal[j]! += mass[offset + j]!
  }
  return marginal
}

function quantileOf(grid: Float64Array, mass: Float64Array, atZero: number, p: number): number {
  // Ruined outcomes sit at the bottom of the ordering with a capital of zero,
  // so a plan that fails a third of the time genuinely has a zero 10th
  // percentile. Reporting percentiles conditional on survival would hide that.
  // Depleted outcomes are worth zero too and share that position, even though
  // they are not failures.
  if (p <= atZero) return 0
  let cumulative = atZero
  for (let i = 0; i < grid.length; i++) {
    cumulative += mass[i]!
    if (cumulative >= p) return grid[i]!
  }
  return grid[grid.length - 1]!
}

function summarize(
  year: number,
  startAge: number,
  grid: Float64Array,
  mass: Float64Array,
  ruin: number,
  depleted: number,
): YearOutcome {
  let mean = 0
  for (let i = 0; i < grid.length; i++) {
    mean += mass[i]! * grid[i]!
  }

  // Depleted mass contributes nothing to the mean and nothing to the grid, but
  // it does occupy the bottom of the ordering, so the quantiles have to step
  // over it before they reach the first grid node.
  const atZero = ruin + depleted

  return {
    year,
    age: startAge + year,
    ruinProbability: ruin,
    mean,
    percentile5: quantileOf(grid, mass, atZero, 0.05),
    percentile10: quantileOf(grid, mass, atZero, 0.1),
    percentile25: quantileOf(grid, mass, atZero, 0.25),
    median: quantileOf(grid, mass, atZero, 0.5),
    percentile75: quantileOf(grid, mass, atZero, 0.75),
    percentile90: quantileOf(grid, mass, atZero, 0.9),
    percentile95: quantileOf(grid, mass, atZero, 0.95),
  }
}

/**
 * Probability that the final capital is at least `threshold`, to grid
 * resolution: the node the threshold falls between counts as reaching it.
 *
 * That last cell is not slack, it is the only honest reading. The adaptive rule
 * aims *at* the target, so the terminal distribution piles up on it — and a
 * value that lands exactly on the threshold is scattered across the two
 * bracketing nodes, which a strict comparison would split into a near-arbitrary
 * coin flip. Measured on a deterministic plan that hits the target exactly, a
 * strict count reported 0.37, 0.10, 0.10 and 0.25 as the grid was refined
 * through four doublings, where the answer is 1.
 *
 * The cell is also the right *size*. The rule undershoots the target by a
 * fraction of a per cent, because the surplus is a convex function of the
 * balance and mass smeared over two nodes therefore spends a little more than
 * the exact path would; that error and the cell width both shrink as 1/n, so
 * one cell of tolerance tracks it rather than hiding it.
 */
function tailProbability(grid: Float64Array, mass: Float64Array, threshold: number): number {
  let i = grid.length - 1
  // Nothing on the grid reaches the target. The top node also absorbs whatever
  // was clipped there, which is why this is asked before the loop rather than
  // being allowed to fall out of it.
  if (grid[i]! < threshold) return 0

  let total = 0
  while (i >= 0 && grid[i]! >= threshold) total += mass[i--]!
  if (i >= 0) total += mass[i]!
  return Math.min(1, total)
}

function flowQuantile(histogram: FlowHistogram, p: number): number {
  let cumulative = 0
  for (let i = 0; i < FLOW_BINS; i++) {
    cumulative += histogram.mass[i]!
    if (cumulative >= p) return histogram.low + i * histogram.step
  }
  return histogram.low + (FLOW_BINS - 1) * histogram.step
}

/**
 * The spread of what one year actually pays out.
 *
 * Unconditional, like every other figure the planner reports: a year the plan
 * never reached pays nothing and is counted as zero rather than left out. That
 * is why the lower band drops to zero once the risk of failure passes ten per
 * cent, and it is the same reading as the capital percentiles.
 */
function summarizeWithdrawal(
  index: number,
  startAge: number,
  histogram: FlowHistogram,
): WithdrawalOutcome {
  let mean = 0
  for (let i = 0; i < FLOW_BINS; i++) {
    mean += histogram.mass[i]! * (histogram.low + i * histogram.step)
  }

  return {
    index,
    age: startAge + index,
    mean,
    percentile10: flowQuantile(histogram, 0.1),
    median: flowQuantile(histogram, 0.5),
    percentile90: flowQuantile(histogram, 0.9),
  }
}

/**
 * The distribution of what the capital is worth after settling the embedded
 * capital gains tax.
 *
 * An AF account defers its liability rather than escaping it — Swedish heirs
 * take over the acquisition cost, so the tax follows the assets — which means
 * the balance alone overstates what the plan can actually hand over as cash.
 *
 * Settling the tax scales the balance by a factor that depends only on the
 * basis node, so each basis row is the wealth grid shifted by a constant factor
 * and lands back on the same grid.
 */
function liquidDistribution(
  mass: Float64Array,
  spec: GridSpec,
  basis: BasisSpec,
  capitalGainsTaxRate: number,
): Float64Array {
  const liquid = new Float64Array(spec.n)

  for (let b = 0; b < basis.n; b++) {
    const unrealizedFraction = Math.max(0, 1 - basis.grid[b]!)
    const factor = 1 - unrealizedFraction * capitalGainsTaxRate
    if (!(factor > 0)) continue
    // A constant multiple is a constant offset along a geometric grid.
    const shift = Math.log(factor) / spec.logStep
    const offset = b * spec.n

    for (let j = 0; j < spec.n; j++) {
      const probability = mass[offset + j]!
      if (probability <= 0) continue
      const value = spec.grid[j]! * factor

      const position = j + shift
      let index: number
      if (position <= 0) index = 0
      else if (position >= spec.n - 1) index = spec.n - 2
      else index = position | 0

      const g0 = spec.grid[index]!
      let fraction = (value - g0) / (spec.grid[index + 1]! - g0)
      if (fraction < 0) fraction = 0
      else if (fraction > 1) fraction = 1

      liquid[index]! += probability * (1 - fraction)
      liquid[index + 1]! += probability * fraction
    }
  }

  return liquid
}

function validate(params: PlannerParameters): void {
  if (!Number.isInteger(params.years) || params.years < 1) {
    throw new Error(`planner: years must be a positive integer, got ${params.years}`)
  }
  if (params.cashflow.length !== params.years) {
    throw new Error(
      `planner: cashflow has ${params.cashflow.length} entries but the horizon is ${params.years} years`,
    )
  }
  if (!(params.initialCapital >= 0)) {
    throw new Error(`planner: initialCapital must not be negative, got ${params.initialCapital}`)
  }
  if (!(params.inflationRate > -1)) {
    throw new Error(
      `planner: inflationRate must be greater than -100%, got ${params.inflationRate}`,
    )
  }
  if (params.gridNodes < 50) {
    throw new Error(`planner: gridNodes must be at least 50, got ${params.gridNodes}`)
  }
  if (params.accountType === 'AF') {
    if (params.basisNodes < 2) {
      throw new Error(`planner: AF needs at least 2 basisNodes, got ${params.basisNodes}`)
    }
    if (!(params.initialCostBasisRatio >= 0)) {
      throw new Error(
        `planner: initialCostBasisRatio must not be negative, got ${params.initialCostBasisRatio}`,
      )
    }
  }
  for (const year of params.cashflow) {
    if (!Number.isFinite(year.need) || !Number.isFinite(year.extra)) {
      throw new Error('planner: cashflow entries must be finite numbers')
    }
  }
}

function propagate(
  params: PlannerParameters,
  spec: GridSpec,
  basis: BasisSpec,
  quad: NormalQuadrature,
  moments: PortfolioMoments,
  mode: SpendingMode,
  label: string,
  schedule: ReturnType<typeof reserveSchedule>,
): PropagationRun {
  const growth = new Float64Array(quad.z.length)
  for (let k = 0; k < growth.length; k++) {
    growth[k] = Math.exp(moments.logMean + moments.logStdDev * quad.z[k]!)
  }

  const isAF = params.accountType === 'AF'
  const ctx: StepContext = {
    spec,
    basis,
    quad,
    growth,
    isAF,
    // The ISK schablon is levied on the balance, so it is a constant
    // proportional drag. Being proportional, it is the same rate in real terms
    // as in nominal terms: the price level divides out of base and tax alike.
    iskRate: params.iskTaxRate * params.capitalGainsTaxRate,
    // Rebalancing is forced by the assets drifting apart, so the turnover it
    // implies comes from the portfolio moments rather than from a setting.
    turnover: isAF ? moments.rebalancingTurnover : 0,
    inflationFactor: 1 + params.inflationRate,
    params,
  }

  // Year 0 is an exact point mass at the starting capital rather than a
  // projection onto the grid. That keeps the first step exact and lets the
  // plan start from zero capital, which no geometric grid can represent.
  let values: Float64Array = Float64Array.of(params.initialCapital)
  // Mass is basis-major, so with a single wealth node the starting row is just
  // the cost-basis distribution.
  let mass: Float64Array = new Float64Array(basis.n)
  if (basis.n === 1) {
    mass[0] = 1
  } else {
    const position = params.initialCostBasisRatio / basis.step
    let index: number
    let fraction: number
    if (position <= 0) {
      index = 0
      fraction = 0
    } else if (position >= basis.n - 1) {
      index = basis.n - 2
      fraction = 1
    } else {
      index = Math.floor(position)
      fraction = position - index
    }
    mass[index] = 1 - fraction
    mass[index + 1] = fraction
  }
  let ruin = 0
  let depleted = 0
  let clipped = 0
  let expectedWithdrawn = 0

  const startOutcome = (net: boolean): YearOutcome => {
    const value = net
      ? params.initialCapital *
        (1 - Math.max(0, 1 - params.initialCostBasisRatio) * params.capitalGainsTaxRate)
      : params.initialCapital
    return {
      year: 0,
      age: params.startAge,
      ruinProbability: 0,
      mean: value,
      percentile5: value,
      percentile10: value,
      percentile25: value,
      median: value,
      percentile75: value,
      percentile90: value,
      percentile95: value,
    }
  }

  const outcomes: YearOutcome[] = [startOutcome(false)]
  // One entry per cash-flow year, indexed as the cash flow itself is, so the
  // chart lines up with the schedule the household typed in. There is no
  // year-zero entry: nothing is paid before the first year's return.
  const withdrawals: WithdrawalOutcome[] = []
  const liquidOutcomes: YearOutcome[] = isAF ? [startOutcome(true)] : []
  let liquidMass: Float64Array | null = null

  for (let year = 0; year < params.years; year++) {
    const entry = params.cashflow[year]!
    const extra = Math.max(0, entry.extra)
    const policy: YearPolicy =
      mode === 'adaptive'
        ? {
            baseFlow: entry.need,
            adaptive: true,
            extra,
            reserve: schedule.reserve[year]!,
            keep: schedule.keep[year]!,
            annuityFactor: schedule.annuity[year]!,
          }
        : {
            baseFlow: entry.need + (mode === 'extra' ? extra : 0),
            adaptive: false,
            extra: 0,
            reserve: 0,
            // A fixed schedule spends what it was told to. The bequest target is
            // a brake on discretionary spending, and there is none to brake.
            keep: 0,
            annuityFactor: 1,
          }

    // Nominal thresholds are written in kronor of the day, so deflate them to
    // today's money. Year `year` ends at price level (1+pi)^(year+1), matching
    // the Monte Carlo simulator, which accrues inflation at the top of each
    // year.
    //
    // Deflating is a forecast that neither threshold is ever raised, and the
    // two do not deserve equal confidence. The loss threshold has stood at a
    // nominal 100 000 kr since the 1991 tax reform, so thirty-five years say
    // it is left alone. The ISK fribelopp is likewise a fixed kronor figure
    // with no indexation provision (42 kap. 48 § IL), but it has been
    // legislated exactly twice — 150 000 kr for 2025, 300 000 kr for 2026 —
    // which is a doubling in its second year and no track record at all.
    // Swedish practice on un-indexed amounts sorts by political salience
    // rather than by legal form: unsalient ones are left to erode for decades,
    // while salient ones have beaten inflation outright (the rental
    // schablonavdrag went 18 000 -> 50 000 kr in fourteen years), and the
    // preparatory works state no intent either way. Holding the fribelopp
    // constant in real terms is therefore at least as defensible as deflating
    // it. There is not enough evidence to say which is right, nor — given how
    // small the allowance is against a multi-million balance — whether the
    // choice moves the answer enough to be worth a parameter. Deflating is
    // kept because it is the conservative side of the range.
    const priceLevel = Math.pow(1 + params.inflationRate, year + 1)
    const allowanceReal = params.iskAllowance > 0 ? params.iskAllowance / priceLevel : 0
    const lossThresholdReal = LOSS_CREDIT_THRESHOLD / priceLevel

    // What a cohort with no capital left does this year is decided entirely by
    // the year's own flow, so it is settled here rather than inside the step.
    if (depleted > 0) {
      if (policy.baseFlow > 0) {
        // Nothing to withdraw from, so the need fails and the plan ruins.
        ruin += depleted
        depleted = 0
      } else if (policy.baseFlow < 0) {
        // A deposit revives it: depletion is not failure, so a household that
        // keeps paying in has a plan again. The mass re-enters at the bottom
        // grid node rather than at a true zero, which hands it a millionth of
        // the plan's scale — far below anything the outputs resolve.
        //
        // Copied rather than written in place because `marginalOverBasis`
        // hands back this very array for a single-node basis, so the summary
        // already published for last year can alias it.
        mass = mass.slice()
        // Fresh money is bought at market, so its basis ratio is one, which
        // `buildBasisGrid` guarantees is a node.
        const basisRow = basis.n === 1 ? 0 : Math.round(1 / basis.step)
        mass[basisRow * values.length]! += depleted
        depleted = 0
      }
      // A year with no flow at all leaves zero capital at zero.
    }

    // Everything off the grid pays nothing this year: a failed plan takes no
    // more withdrawals, and a depleted one has nothing to take them from. The
    // step bins the rest as it goes.
    const flows = buildFlowHistogram(policy.baseFlow, policy.extra)
    addFlow(flows, 0, ruin + depleted)

    const stepped = step(ctx, values, mass, policy, allowanceReal, lossThresholdReal, flows)
    withdrawals.push(summarizeWithdrawal(year, params.startAge, flows))

    // Ruin is absorbing. A deposit scheduled after the plan already failed to
    // cover its need does not undo that failure, so the ruined mass is never
    // returned to the grid.
    ruin += stepped.ruin
    depleted += stepped.depleted
    clipped += stepped.clipped
    expectedWithdrawn += stepped.withdrawn
    values = spec.grid
    mass = stepped.mass

    outcomes.push(
      summarize(
        year + 1,
        params.startAge,
        spec.grid,
        marginalOverBasis(mass, spec, basis),
        ruin,
        depleted,
      ),
    )

    if (isAF) {
      // Cheap next to the propagation itself — one pass over the joint grid —
      // so the net series is built every year rather than only at the end,
      // which lets the charts follow the same toggle as the table.
      liquidMass = liquidDistribution(mass, spec, basis, params.capitalGainsTaxRate)
      liquidOutcomes.push(
        summarize(year + 1, params.startAge, spec.grid, liquidMass, ruin, depleted),
      )
    }
  }

  const finalDistribution: WealthDistribution = {
    grid: spec.grid,
    mass: marginalOverBasis(mass, spec, basis),
    ruinProbability: ruin,
    depletedProbability: depleted,
  }

  // Measured on the same basis the target is stated on: what is actually left
  // behind, after the tax an AF's heirs inherit. A ruined or depleted plan
  // leaves nothing and is off the grid entirely, so it cannot reach a positive
  // target — no term for either is needed here.
  const target = bequestTarget(params)
  const bequestProbability =
    target > 0
      ? tailProbability(spec.grid, liquidMass ?? finalDistribution.mass, target)
      : undefined

  return {
    label,
    outcomes,
    withdrawals,
    finalDistribution,
    expectedWithdrawn,
    bequestProbability,
    liquidOutcomes: isAF ? liquidOutcomes : undefined,
    finalLiquidDistribution:
      isAF && liquidMass
        ? {
            grid: spec.grid,
            mass: liquidMass,
            ruinProbability: ruin,
            depletedProbability: depleted,
          }
        : undefined,
    clippedMass: clipped,
  }
}

/**
 * Runs the plan twice to bracket the discretionary spending.
 *
 * The lower run takes only the need every year, the upper run takes the need
 * plus the extra top-up. Both share one grid so their distributions are
 * directly comparable node for node. Neither run lets the balance influence
 * what is spent, which is what keeps the model free of a feedback rule that
 * would need to be justified separately.
 */
/** Everything a propagation needs that does not depend on which run it is. */
function setup(params: PlannerParameters) {
  validate(params)

  const portfolio = portfolioMoments(params.assets, params.correlations)
  const quad = normalQuadrature(params.quadratureNodes)
  const { low, high } = gridBounds(params, portfolio)
  const spec = buildGrid(low, high, params.gridNodes)
  // Only AF carries a cost basis; ISK collapses the dimension to one node and
  // pays none of its cost.
  const basis = buildBasisGrid(params.accountType === 'AF' ? params.basisNodes : 1)

  const rateFor = (horizon: number) => reserveReturnFor(params, portfolio, horizon)
  return {
    portfolio,
    quad,
    spec,
    basis,
    // Reported as the rate at the start of the plan, which is the whole horizon
    // and the least conservative point on the curve. The years after it discount
    // at progressively lower rates.
    reserveReturn: rateFor(params.years),
    schedule: reserveSchedule(params, rateFor),
  }
}

/**
 * Survival probability of the adaptive run alone.
 *
 * The scale solver evaluates this many times over, and the other two runs would
 * be pure waste there — the need run does not depend on the extra at all,
 * and the unconditional run is not what is being solved for.
 */
export function adaptiveSurvival(params: PlannerParameters): number {
  const { portfolio, quad, spec, basis, schedule } = setup(params)
  const run = propagate(params, spec, basis, quad, portfolio, 'adaptive', '', schedule)
  return 1 - run.finalDistribution.ruinProbability
}

export function runPlanner(params: PlannerParameters): PlannerResults {
  const { portfolio, quad, spec, basis, reserveReturn, schedule } = setup(params)

  return {
    needRun: propagate(params, spec, basis, quad, portfolio, 'need', 'Behov', schedule),
    extraRun: propagate(params, spec, basis, quad, portfolio, 'extra', 'Behov + extra', schedule),
    adaptiveRun: propagate(
      params,
      spec,
      basis,
      quad,
      portfolio,
      'adaptive',
      // Short because it is a column header in a table that shares its row with
      // the fan chart; the chart legend carries the full description.
      'Behov + anpassat',
      schedule,
    ),
    portfolio,
    reserveReturn,
  }
}
