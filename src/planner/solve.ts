import { adaptiveSurvival } from './propagate'
import type { PlannerParameters } from './types'

/**
 * Largest multiple of the drawn extra the solver will consider.
 *
 * Beyond this the answer stops being a plan and starts being a demonstration
 * that spending everything ruins everything: the adaptive rule does not limit
 * its own risk, because spending the whole surplus every year pins the balance
 * at a reserve that only assumes a 25th-percentile return, so nothing is ever
 * banked above it. The extra cap is what makes the rule safe, not the
 * reserve rate.
 */
const MAX_SCALE = 20

/** Bisection stops once the multiplier is pinned this closely. */
const SCALE_TOLERANCE = 0.005

/** Hard stop, so a pathological plan cannot spin. Bisection needs ~13. */
const MAX_ITERATIONS = 40

export type ExtraScaleStatus =
  /** A multiplier hits the target. */
  | 'solved'
  /** Even taking no extra at all leaves the plan short of the target. */
  | 'unreachable'
  /** The target is so easy that the search bound binds first. */
  | 'capped'
  /** The plan has no extra to scale. */
  | 'nothing-to-scale'

export interface ExtraScaleSolution {
  status: ExtraScaleStatus
  /** Multiplier to apply to every year's extra. */
  scale: number
  /** Survival the multiplier actually achieves. */
  survival: number
  /** Survival with no extra at all, which is the best the plan can do. */
  ceiling: number
  evaluations: number
}

/**
 * How far from 1 a multiplier has to be before applying it is worth anything.
 *
 * Below this the plan already is the answer. Amounts written back into a plan
 * are floored to two significant digits, so a few percent frequently produces
 * the very same schedule; and where it does move something, it moves it by less
 * than the grid's own error in the survival probability it was solved for.
 * Acting on a difference that small claims a precision the model does not have.
 */
export const NEGLIGIBLE_SCALE_CHANGE = 0.05

/** Whether a multiplier is so close to 1 that applying it says nothing. */
export function isNegligibleScale(scale: number): boolean {
  return Math.abs(scale - 1) < NEGLIGIBLE_SCALE_CHANGE
}

function withScale(params: PlannerParameters, scale: number): PlannerParameters {
  return {
    ...params,
    cashflow: params.cashflow.map((year) => ({ ...year, extra: year.extra * scale })),
  }
}

/**
 * Finds the multiple of the drawn extra that meets a survival target.
 *
 * Solving for a *multiplier* rather than for an amount is what keeps the
 * household's own spending shape intact: the plan may ask for more in the early
 * years, or drop when a pension starts, and scaling preserves all of it. Only
 * the level is up for negotiation.
 *
 * Survival falls monotonically as the multiplier rises — more discretionary
 * spending can only cost — so plain bisection is reliable and needs no
 * derivative. Each step costs one adaptive propagation.
 */
export function solveExtraScale(
  params: PlannerParameters,
  targetSurvival: number,
): ExtraScaleSolution {
  const hasExtra = params.cashflow.some((year) => year.extra > 0)
  const ceiling = adaptiveSurvival(withScale(params, 0))
  let evaluations = 1

  if (!hasExtra) {
    return { status: 'nothing-to-scale', scale: 1, survival: ceiling, ceiling, evaluations }
  }

  // Taking nothing discretionary is the safest the plan can be, so a target
  // above that cannot be bought by spending less — it needs a different plan.
  if (targetSurvival > ceiling) {
    return { status: 'unreachable', scale: 0, survival: ceiling, ceiling, evaluations }
  }

  const atMax = adaptiveSurvival(withScale(params, MAX_SCALE))
  evaluations++
  if (targetSurvival <= atMax) {
    return { status: 'capped', scale: MAX_SCALE, survival: atMax, ceiling, evaluations }
  }

  let low = 0
  let high = MAX_SCALE
  let survival = ceiling
  for (let i = 0; i < MAX_ITERATIONS && high - low > SCALE_TOLERANCE; i++) {
    const middle = (low + high) / 2
    survival = adaptiveSurvival(withScale(params, middle))
    evaluations++
    // Keep the bracket on the safe side of the target, so the multiplier
    // returned never promises more spending than the target allows.
    if (survival < targetSurvival) high = middle
    else low = middle
  }

  survival = adaptiveSurvival(withScale(params, low))
  evaluations++
  return { status: 'solved', scale: low, survival, ceiling, evaluations }
}
