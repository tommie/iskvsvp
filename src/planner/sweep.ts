// The withdrawal-rate sweep: what the plan's survival does as the discretionary
// withdrawal is raised, holding everything else as entered.
//
// This is Bengen's question — the one his 1994 paper answered as SAFEMAX — put
// to this model rather than to the historical record. A rate is set once, at
// the start, as a share of the starting capital, and then held constant in real
// terms for the whole plan; sweeping it and reading off where survival crosses
// a threshold is what "a 4% rule" means. The differences from Bengen are worth
// being clear about, because they are what make the answer here a different
// number from his:
//
//  - The rate sets the **extra** only. The need is the plan's own, year by year
//    and shape and all, so the curve starts at the need's own survival rather
//    than at 100%. The extra the household entered is ignored — that is the
//    point of the card, which asks what the plan could carry rather than what it
//    was told to take.
//  - Survival is the probability of funding every *need* withdrawal, the same
//    definition the rest of the planner uses. Missing the bequest target is not
//    failure here either.
//  - Which spending rule is in force is the caller's choice, and it changes
//    what the rate *means*. See `SweepRule`.
//
// **A swept rate is not what the plan hands over**, under either rule, and the
// card must not be read as though it were. Under the adaptive rule the rate is
// only a ceiling and the surplus test declines much of it; under the fixed rule
// it is taken until the plan fails and then nothing is taken at all. Each point
// therefore carries `expectedWithdrawn` beside `plannedWithdrawn`, and the gap
// between the two is the whole reason both are reported.
//
// One propagation per rung, so a sweep costs seventeen runs: about a third of a
// second on an ISK and five on an AF. The card drives it one rung at a time;
// see `runSummaries`.

import { runSummaries, type RunSummary, type SpendingMode } from './propagate'
import type { PlannerParameters } from './types'

/**
 * Which spending rule the swept rate feeds.
 *
 * - `adaptive` keeps the planner's own rule, so the rate is a **ceiling**: a
 *   year pays it only while the surplus over the reserved need — and any
 *   bequest target — stretches to it. Survival then flattens out as the rate
 *   rises rather than falling to zero, because past some level it is the brake
 *   and not the level that decides the payout. What that costs is visible only
 *   in what is actually delivered, which is why the card plots it.
 * - `fixed` takes the rate every year regardless of the balance, which is
 *   Bengen's own question and the one the "4% rule" is an answer to. The curve
 *   then falls the way a survival curve is expected to, and the crossing is a
 *   SAFEMAX in the original sense.
 *
 * Both are worth asking, and they answer different things: the fixed rule says
 * what a rate committed to in advance would have cost, the adaptive one says
 * what a household willing to adjust can put on the table.
 */
export type SweepRule = 'adaptive' | 'fixed'

const MODES: Record<SweepRule, SpendingMode> = {
  adaptive: 'adaptive',
  // The unconditional run: need plus the whole extra, every year, until the
  // plan can no longer fund the need.
  fixed: 'extra',
}

/**
 * Spacing of the swept rates, as a share of the starting capital.
 *
 * Half a percentage point. The crossings below are interpolated between rungs,
 * and the curve is smooth enough over half a point that the interpolation is
 * worth a few hundredths at most — well under what a figure rounded to two
 * significant digits can show.
 */
export const SWEEP_STEP = 0.005

/**
 * Highest swept rate.
 *
 * Eight per cent of the starting capital, *on top of* the need. Far beyond
 * anything a plan carries — the rules of thumb are 3 to 4% for the whole
 * withdrawal — but the top of the range is where the adaptive rule's brake is
 * visibly the binding constraint, and a curve that has flattened says more
 * about the rule than one cut off while it is still falling.
 */
export const SWEEP_MAX = 0.08

/** The rungs, lowest first. Always starts at zero: the need alone. */
export function sweepRates(): number[] {
  const perUnit = Math.round(1 / SWEEP_STEP)
  const count = Math.round(SWEEP_MAX / SWEEP_STEP) + 1
  // Divided rather than multiplied. `i * 0.005` accumulates representation
  // error — the eighth rung comes out as 0.035000000000000003 — and a rate that
  // is not the exact decimal it prints as cannot be compared against one
  // computed any other way.
  return Array.from({ length: count }, (_, i) => i / perUnit)
}

/** How many propagations a sweep will run. Needed for a determinate progress bar. */
export function sweepLength(): number {
  return sweepRates().length
}

/**
 * The plan with its extra replaced by a constant real share of the starting
 * capital.
 *
 * Constant in today's money for every year, which is what the withdrawal-rate
 * literature means by a rate: it is set once against the opening balance and
 * never revisited. The need is untouched, including its shape and any deposit
 * years.
 */
export function sweepVariant(params: PlannerParameters, rate: number): PlannerParameters {
  const extra = Math.max(0, rate) * Math.max(0, params.initialCapital)
  return { ...params, cashflow: params.cashflow.map((year) => ({ ...year, extra })) }
}

export interface SweepPoint extends RunSummary {
  /** The swept rate, as a share of the starting capital. */
  rate: number
  /** The same rate as the yearly amount it sets, in today's money. */
  extra: number
}

/**
 * The two totals as annual amounts.
 *
 * Everything the withdrawal-rate literature states is a rate — "4%" is four per
 * cent of the opening balance **a year** — so a total over a forty-year plan is
 * not comparable with any of it. Dividing by the horizon is what makes the
 * chart readable against a rule of thumb, and under the fixed rule the planned
 * figure is then exactly the constant real amount that defines SAFEMAX.
 *
 * It is a mean over the years, not the first year's payment. For a flat need
 * the two coincide; for a shaped one they do not, and the mean is the figure
 * that stays tied to `expectedWithdrawn`.
 */
export function plannedPerYear(point: RunSummary): number {
  return point.years > 0 ? point.plannedWithdrawn / point.years : 0
}

export function expectedPerYear(point: RunSummary): number {
  return point.years > 0 ? point.expectedWithdrawn / point.years : 0
}

/**
 * Whether a sweep would say anything.
 *
 * A rate is a share of the starting capital, so a plan that starts from nothing
 * has every rung at zero kronor and seventeen identical propagations to show
 * for it. The card says so rather than drawing a flat line.
 */
export function canSweep(params: PlannerParameters): boolean {
  return params.initialCapital > 0
}

/**
 * The sweep, one rung at a time.
 *
 * Yields in rate order so a partial sweep is a curve drawn left to right rather
 * than a scatter of holes, which is what lets the card show its progress by
 * simply drawing what it has.
 */
export function* sweepPoints(
  params: PlannerParameters,
  rule: SweepRule = 'adaptive',
): Generator<SweepPoint> {
  const rates = sweepRates()
  const variants = rates.map((rate) => sweepVariant(params, rate))
  let index = 0
  for (const summary of runSummaries(variants, MODES[rule])) {
    const rate = rates[index++]!
    yield { ...summary, rate, extra: Math.max(0, rate) * Math.max(0, params.initialCapital) }
  }
}

/**
 * How far the curve must fall past its peak before the peak counts as one.
 *
 * A thousandth of the peak: enough that a flat top left over by the grid's own
 * quantisation is not reported as a turning point, and far under the two
 * significant digits the amount is printed to.
 */
const PEAK_TOLERANCE = 1e-3

/**
 * The level that delivers the most, where there is one.
 *
 * A genuine maximum rather than a threshold: past this level the plan hands
 * over *less* over its lifetime than it would have at a lower one, because what
 * the extra spending buys is outweighed by the years a broken plan never
 * reaches. On the default plan under a fixed schedule it is 4,0% — spending
 * 8,0% delivers less per year than spending 3,0%.
 *
 * **Normally `null` under the adaptive rule**, and that is the finding rather
 * than a gap: the rule declines what the surplus will not carry instead of
 * overspending, so raising the ceiling never costs delivered kronor and the
 * curve still climbs at the end of the swept range. Only a rule that can
 * overspend has a level worth not exceeding.
 *
 * Reported as the rung itself rather than a parabolic vertex through its
 * neighbours. The top is flat — the default plan moves 0,3% of a per-year
 * amount across a whole point of level either side of the peak — so a fitted
 * vertex would put a third digit on a figure the card prints to two, and the
 * rung at least names a level that was actually computed.
 *
 * `null` while the sweep is still filling in, since the highest point so far is
 * always the last one and nothing has been shown to turn over yet.
 */
export function peakDeliveryLevel(points: SweepPoint[]): number | null {
  if (points.length < 3) return null
  let best = 0
  for (let i = 1; i < points.length; i++) {
    if (expectedPerYear(points[i]!) > expectedPerYear(points[best]!)) best = i
  }
  // Interior, and followed by a fall worth calling one. A peak at either end is
  // a curve that is still climbing or one that never climbed.
  if (best === 0 || best === points.length - 1) return null
  const peak = expectedPerYear(points[best]!)
  const end = expectedPerYear(points[points.length - 1]!)
  if (!(end < peak * (1 - PEAK_TOLERANCE))) return null
  return points[best]!.rate
}

/**
 * The second probability curve: how often the plan still leaves something
 * behind.
 *
 * The bequest target when the household set one, since that is the threshold it
 * said it cared about, and the starting capital when it did not — the same
 * measure either way, on the same after-tax basis, differing only in where the
 * line is drawn. The card labels which of the two it is showing.
 *
 * Without it the chart is one nearly flat line under the adaptive rule, because
 * keeping survival flat is precisely what that rule is for: it declines
 * discretionary spending rather than letting it eat the need. That makes the
 * survival curve a statement about the *need* and almost nothing about the
 * level being swept. What the level costs lands on the terminal capital
 * instead, and this is that cost as a probability.
 */
export function keepProbability(point: SweepPoint): number | undefined {
  return point.bequestProbability ?? point.preservationProbability
}

/**
 * Survival levels the card reports a rate for.
 *
 * Three rather than one, because there is no single threshold that means "safe"
 * and picking one would imply there is. 90% is roughly where a fixed spending
 * plan is usually aimed, with a stricter and a looser reading either side of it.
 */
export const SURVIVAL_TARGETS = [0.95, 0.9, 0.8] as const

export interface SweepCrossing {
  target: number
  /** Highest rate whose survival still reaches the target. */
  rate: number
  /** The rate as a yearly amount, in today's money. */
  extra: number
  /**
   * Need plus the full rate, **per year**: what this rate asks for.
   *
   * Annual rather than a total over the plan, because that is the unit every
   * withdrawal rule of thumb is stated in — and under the fixed rule this is
   * exactly the constant real amount SAFEMAX is defined as.
   */
  plannedPerYear: number
  /**
   * Expected real cash the plan actually hands over per year at this rate.
   *
   * Reported beside the rate rather than left to the chart, because the rate on
   * its own overstates what the household gets under either rule — the adaptive
   * one declines part of it, and the fixed one stops paying anything once the
   * plan has failed. A table that gave only the rate would be an invitation to
   * read it as income.
   */
  expectedPerYear: number
  /**
   * The curve never fell below the target inside the swept range, so the rate
   * is a lower bound — "at least this much" — rather than a crossing.
   */
  atLeast: boolean
}

/** Where a monotone falling curve passes a target, as an index and a share of the next step. */
interface Bracket {
  /** Index of the last rung still at or above the target. */
  index: number
  /** How far from that rung towards the next one the target sits, 0 to 1. */
  share: number
  /** The curve never fell below the target inside the range. */
  atLeast: boolean
}

/**
 * Brackets a target on any of the swept curves.
 *
 * Shared by the survival crossings the table reports and the level marks the
 * payout chart draws, so the two cannot disagree about where a threshold sits.
 * `null` when the curve starts below the target, which is a statement about the
 * plan rather than a level.
 *
 * The **first** rung that falls below is taken, not the last: the curves are
 * monotone in theory — spending more can only lower both survival and what is
 * left at the end — but the grid quantises the mass, and a nearly flat stretch
 * can dip under a target and come back. The first crossing is the conservative
 * reading of that.
 */
function bracket(
  points: SweepPoint[],
  value: (point: SweepPoint) => number,
  target: number,
): Bracket | null {
  if (points.length === 0 || value(points[0]!) < target) return null
  for (let i = 1; i < points.length; i++) {
    if (value(points[i]!) >= target) continue
    const above = value(points[i - 1]!)
    const span = above - value(points[i]!)
    // A zero span means the two rungs agree and the target sits exactly on
    // them; the lower rate is then the honest answer.
    return { index: i - 1, share: span > 0 ? (above - target) / span : 0, atLeast: false }
  }
  return { index: points.length - 1, share: 0, atLeast: true }
}

/**
 * Where the survival curve crosses a target, interpolated between rungs.
 *
 * `null` when even taking nothing discretionary misses the target: the need
 * alone is then already below it, and no extra withdrawal can buy survival
 * back. That is a statement about the need, and the card says so rather than
 * reporting a rate of zero — which would read as "zero is affordable".
 */
export function crossingFor(points: SweepPoint[], target: number): SweepCrossing | null {
  const found = bracket(points, (point) => point.survival, target)
  if (!found) return null

  const above = points[found.index]!
  const below = points[Math.min(found.index + 1, points.length - 1)]!
  const between = (from: number, to: number) => from + found.share * (to - from)
  const rate = between(above.rate, below.rate)
  return {
    target,
    rate,
    // The amount is linear in the rate by construction, so it can be scaled
    // from the starting capital rather than interpolated alongside it. The two
    // withdrawal figures are not: `plannedPerYear` is linear only when the rate
    // reaches every year, and `expectedPerYear` is not linear at all, so both
    // are interpolated between the rungs that bracket the crossing.
    extra: rate * amountPerRate(points),
    plannedPerYear: between(plannedPerYear(above), plannedPerYear(below)),
    expectedPerYear: between(expectedPerYear(above), expectedPerYear(below)),
    atLeast: found.atLeast,
  }
}

/**
 * A second, lower ladder, for a curve that spends its range well under the
 * survival thresholds.
 *
 * Quartiles. Needed because the kept-capital curve does not sit anywhere in
 * particular: on the default plan it runs 61% down to 16%, where 95/90/80 is
 * entirely out of reach, and on a comfortable one it runs 99% to 85%, where the
 * quartiles are. One fixed ladder cannot serve both, and a threshold the curve
 * never passes marks nothing.
 *
 * Quartiles are also the right question for that curve on its own terms: the
 * need is a hard floor and earns safety-first thresholds, while what is left at
 * the end is a wish the model does not call failure, and a wish is judged on
 * "more likely than not".
 */
export const KEEP_TARGETS = [0.75, 0.5, 0.25] as const

/** Which curve the payout chart's level marks were taken from. */
export type MarkFamily = 'survival' | 'keep'

export interface LevelMark {
  /** The probability this level corresponds to. */
  target: number
  /** The swept level at which the curve passes it. */
  rate: number
}

export interface LevelMarks {
  family: MarkFamily
  marks: LevelMark[]
}

/**
 * The levels to rule off on the payout chart, taken from one curve only.
 *
 * Both probability curves fall monotonically in the level, so each threshold on
 * one of them names a level — and that level can be marked on the payout chart,
 * which is what ties the two charts together: *at the level where the plan holds
 * 90% of the time, this is what it hands over*.
 *
 * **One family at a time**, because two ladders on one chart is clutter and the
 * reader would have to work out which percentage means what. Survival is
 * preferred, since it is the question the card is built around; the kept-capital
 * curve stands in when survival has nothing to say.
 *
 * The switch is "this pairing produced no real crossing", not "survival never
 * reaches 95%". They are different, and the second is wrong: on the default plan
 * under a fixed schedule, 95% and 90% are both out of reach but 80% crosses at
 * 0,55% — a perfectly good SAFEMAX-style answer that the stricter test would
 * have hidden. A *bound* does not count as a crossing either, since its line
 * would sit at the edge of the chart marking nothing.
 *
 * **The ladder is chosen as well as the curve**, because neither curve sits
 * anywhere fixed. A comfortable plan holds its bequest probability between 99%
 * and 85%, where the quartiles are unreachable; a stretched one runs it from
 * 61% to 16%, where the survival thresholds are. So the candidates are tried in
 * order and the first pairing that the curve actually passes through wins.
 * Reporting a threshold the curve never crosses is not an option, and inventing
 * thresholds out of the curve's own range would make the numbers on the chart
 * mean something different on every plan.
 *
 * Empty marks are still a real answer: a curve flat enough to stay between two
 * rungs of both ladders has no level to point at.
 */
const MARK_LADDERS: { family: MarkFamily; targets: readonly number[] }[] = [
  // Survival first: it is the question the card is built around.
  { family: 'survival', targets: SURVIVAL_TARGETS },
  // Then the kept-capital curve, high ladder before low — a comfortable plan
  // keeps it in the nineties, which is where the survival thresholds live.
  { family: 'keep', targets: SURVIVAL_TARGETS },
  { family: 'keep', targets: KEEP_TARGETS },
]

export function levelMarks(points: SweepPoint[]): LevelMarks {
  for (const { family, targets } of MARK_LADDERS) {
    const value =
      family === 'survival'
        ? (point: SweepPoint) => point.survival
        : (point: SweepPoint) => keepProbability(point) ?? 0
    const marks = realMarks(points, value, targets)
    if (marks.length > 0) return { family, marks }
  }
  return { family: 'survival', marks: [] }
}

/** The targets this curve genuinely crosses inside the swept range. */
function realMarks(
  points: SweepPoint[],
  value: (point: SweepPoint) => number,
  targets: readonly number[],
): LevelMark[] {
  const marks: LevelMark[] = []
  for (const target of targets) {
    const found = bracket(points, value, target)
    if (!found || found.atLeast) continue
    const above = points[found.index]!
    const below = points[Math.min(found.index + 1, points.length - 1)]!
    marks.push({ target, rate: above.rate + found.share * (below.rate - above.rate) })
  }
  return marks
}

/** Kronor per unit of rate, i.e. the starting capital, recovered from any rung. */
function amountPerRate(points: SweepPoint[]): number {
  for (const point of points) {
    if (point.rate > 0) return point.extra / point.rate
  }
  return 0
}

/**
 * The plan's own extra as a rate, when it is one.
 *
 * Only when the entered extra is the same amount every year, because only then
 * is the plan a member of the family being swept and the marker a point on the
 * curve. A shaped extra — a go-go decade and then a taper — is not on the curve
 * at all, and marking its first year would put it somewhere it does not belong.
 */
export function planExtraRate(params: PlannerParameters): number | null {
  if (!canSweep(params) || params.cashflow.length === 0) return null
  const first = Math.max(0, params.cashflow[0]!.extra)
  for (const year of params.cashflow) {
    if (Math.max(0, year.extra) !== first) return null
  }
  return first / params.initialCapital
}
