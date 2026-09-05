import { adaptiveSummary, type AdaptiveSummary } from './propagate'
import type { PlannerParameters } from './types'

/**
 * The factor a dimension reaches at full stress.
 *
 * Doubled or halved. Large enough to be well outside the model's own error — a
 * few per cent either way would report the grid's quantisation as sensitivity —
 * and it reads without a legend, which 1.7x does not.
 */
export const FULL_STRESS_FACTOR = 2

/** Which way a dimension has to move for the plan to be worse off. */
type Worse = 'higher' | 'lower'

/** One assumption the plan could be wrong about. */
export interface StressDimension {
  /** Stable key; used in the slider list and as a map key. */
  id: string
  /** Names the row of sliders; short, because the list repeats it. */
  label: string
  /**
   * Whether the plan suffers when this goes up or when it goes down. This is
   * the whole reason a single good-to-bad axis is possible: without it, the
   * dimensions could not be pointed the same way.
   */
  worse: Worse
  scale: (params: PlannerParameters, factor: number) => PlannerParameters
  /**
   * Whether the dimension is worth offering for this plan at all. Absent means
   * always. A slider that cannot move the answer is worse than no slider: it
   * invites the reader to conclude the model is broken.
   */
  applies?: (params: PlannerParameters) => boolean
}

function scaleCashflow(
  params: PlannerParameters,
  pick: (year: PlannerParameters['cashflow'][number]) => Partial<{ need: number; extra: number }>,
): PlannerParameters {
  return {
    ...params,
    cashflow: params.cashflow.map((year) => ({ ...year, ...pick(year) })),
  }
}

/**
 * Everything the card can stress, in the order the sliders show them: what the
 * household spends first, then what the market does, then what the state takes.
 *
 * A negative need is a deposit, and stressing the need upward doubles the
 * deposit too — the dimension asks "what if I have this wrong by a factor of
 * two", and flipping the sign for deposits would ask something else. The
 * bequest target is not on the list: it is a share of the starting capital, and
 * stressing a target the household chose is stressing its preferences rather
 * than its assumptions.
 */
export const STRESS_DIMENSIONS: StressDimension[] = [
  {
    id: 'need',
    label: 'Behov',
    worse: 'higher',
    scale: (params, factor) => scaleCashflow(params, (year) => ({ need: year.need * factor })),
  },
  {
    id: 'extra',
    label: 'Extra',
    worse: 'higher',
    scale: (params, factor) => scaleCashflow(params, (year) => ({ extra: year.extra * factor })),
  },
  {
    // The means only; the volatilities are their own dimension below. Scaling
    // both together would confound "I am wrong about what this earns" with "the
    // market is a different market", and the answer would be unattributable.
    id: 'return',
    label: 'Avkastning',
    worse: 'lower',
    scale: (params, factor) => ({
      ...params,
      assets: params.assets.map((asset) => ({
        ...asset,
        expectedRealReturn: asset.expectedRealReturn * factor,
      })),
    }),
  },
  {
    // More spread is worse even at an unchanged mean: the plan withdraws along
    // the path, so it is exposed to the order returns arrive in.
    id: 'volatility',
    label: 'Volatilitet',
    worse: 'higher',
    scale: (params, factor) => ({
      ...params,
      assets: params.assets.map((asset) => ({
        ...asset,
        volatility: asset.volatility * factor,
      })),
    }),
  },
  {
    /**
     * The schablon rate, which CLAUDE.md calls the model's largest un-surfaced
     * sensitivity: it is a forecast of the real statslåneränta held for four
     * decades, and one point of it is 0.3 points of annual drag. Doubling is
     * wider than the +-1.5 point band that note suggests, but the slider makes
     * any narrower stress reachable.
     */
    id: 'schablon',
    label: 'Schablonränta',
    worse: 'higher',
    scale: (params, factor) =>
      params.accountType === 'AF'
        ? { ...params, afSchablonRate: params.afSchablonRate * factor }
        : { ...params, iskTaxRate: params.iskTaxRate * factor },
  },
  {
    /**
     * **AF only.** Everything here is real and the schablon is proportional, so
     * inflation only reaches the result where the tax code is written in
     * nominal kronor. For an AF that is the acquisition cost and the loss
     * threshold, neither indexed, so a rising price level is taxed as gain:
     * doubling inflation costs the default plan 4 points of survival and a
     * fifth of its final capital.
     *
     * For an ISK the only nominal figure is the fribelopp, and the same move is
     * worth 0.3 points of survival and nothing measurable in capital — under
     * the resolution the outputs are rounded to. The slider is therefore not
     * offered: one that cannot move the answer reads as a broken model rather
     * than as a plan that does not depend on a forecast nobody can make.
     */
    id: 'inflation',
    label: 'Inflation',
    worse: 'higher',
    applies: (params) => params.accountType === 'AF',
    scale: (params, factor) => ({ ...params, inflationRate: params.inflationRate * factor }),
  },
]

/** Slider positions, 0 (untouched) to 1 (full), keyed by dimension id. */
export type StressLevels = Record<string, number>

/**
 * The dimensions worth offering for this plan.
 *
 * Filtered rather than disabled: a greyed-out slider still asks to be
 * explained, and the reason it is missing belongs in the docs rather than in
 * the card. Levels for a dimension that does not apply are ignored everywhere
 * below, so switching account type cannot leave a hidden stress in force.
 */
export function stressDimensionsFor(params: PlannerParameters): StressDimension[] {
  return STRESS_DIMENSIONS.filter((dimension) => dimension.applies?.(params) ?? true)
}

export const SCENARIOS = ['good', 'base', 'bad'] as const
export type Scenario = (typeof SCENARIOS)[number]

/**
 * The factor a dimension takes in one scenario.
 *
 * Geometric in the slider position, so half-way is the square root of the full
 * factor rather than the arithmetic mid-point. That is what makes the good and
 * bad sides mirror each other: at any position the two are reciprocals, so a
 * dimension pushed both ways is off the baseline by the same *proportion* in
 * each direction. On an arithmetic scale, +50% and -50% are not the same move.
 */
export function stressFactor(
  dimension: StressDimension,
  level: number,
  scenario: Scenario,
): number {
  if (scenario === 'base') return 1
  const towardsWorse = scenario === 'bad' ? 1 : -1
  const sign = dimension.worse === 'higher' ? 1 : -1
  return Math.pow(FULL_STRESS_FACTOR, clamp(level) * towardsWorse * sign)
}

function clamp(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(1, level))
}

/** Whether any applicable dimension is stressed; if not, all three scenarios agree. */
export function isStressed(params: PlannerParameters, levels: StressLevels): boolean {
  return stressDimensionsFor(params).some((dimension) => clamp(levels[dimension.id] ?? 0) > 0)
}

/**
 * The plan with every stressed dimension pushed the same way at once.
 *
 * All of them together rather than one at a time, which is the point: a plan
 * rarely fails because a single assumption was wrong, and the combinations are
 * what a two-axis grid could not show. It is a deliberately correlated
 * scenario, not a probability — nothing here says the assumptions move
 * together, only that this is what it would cost if they did.
 */
export function stressedParams(
  params: PlannerParameters,
  levels: StressLevels,
  scenario: Scenario,
): PlannerParameters {
  return stressDimensionsFor(params).reduce((current, dimension) => {
    const level = clamp(levels[dimension.id] ?? 0)
    if (level === 0) return current
    return dimension.scale(current, stressFactor(dimension, level, scenario))
  }, params)
}

export interface StressResult extends AdaptiveSummary {
  scenario: Scenario
}

/**
 * Runs the plan good, as entered, and bad.
 *
 * Three propagations, or one when nothing is stressed — the three scenarios are
 * then the same plan, and computing it three times to print it three times
 * would be waste the AF account type cannot afford.
 */
export function stressScenarios(
  params: PlannerParameters,
  levels: StressLevels,
): Record<Scenario, StressResult> {
  if (!isStressed(params, levels)) {
    const summary = adaptiveSummary(params)
    return {
      good: { ...summary, scenario: 'good' },
      base: { ...summary, scenario: 'base' },
      bad: { ...summary, scenario: 'bad' },
    }
  }
  return {
    good: { ...adaptiveSummary(stressedParams(params, levels, 'good')), scenario: 'good' },
    base: { ...adaptiveSummary(params), scenario: 'base' },
    bad: { ...adaptiveSummary(stressedParams(params, levels, 'bad')), scenario: 'bad' },
  }
}
