import { adaptiveSummary, type AdaptiveSummary } from './propagate'
import type { PlannerParameters } from './types'

/**
 * How far each axis is moved from the plan as entered.
 *
 * Halved and doubled, not a fine sweep. The question a household asks is "what
 * if I have badly misjudged this", and the answer is only useful if the step is
 * large enough to be outside the model's own error — a few per cent either way
 * would report the grid's quantisation as sensitivity. Factors of two also read
 * without a legend, which a sweep of 0.8/0.9/1.1/1.2 does not.
 *
 * Ordered ascending so the grid reads like an axis, and 1 sits in the middle
 * where the plan as entered belongs.
 */
export const SENSITIVITY_FACTORS = [0.5, 1, 2] as const

/** The plan as entered, which is the cell every other one is read against. */
export const BASE_FACTOR = 1

export interface SensitivityCell extends AdaptiveSummary {
  needScale: number
  extraScale: number
  /** True for the plan as entered. */
  base: boolean
}

/**
 * Scales one axis of the cash flow.
 *
 * A negative need is a deposit, and doubling it doubles the deposit — the axis
 * is "what if I have this wrong by a factor of two", and a household that has
 * misjudged its contributions has misjudged them in the same direction as its
 * withdrawals. The bequest target is left alone: it is a share of the starting
 * capital, which neither axis touches.
 */
function scaled(
  params: PlannerParameters,
  needScale: number,
  extraScale: number,
): PlannerParameters {
  return {
    ...params,
    cashflow: params.cashflow.map((year) => ({
      need: year.need * needScale,
      extra: year.extra * extraScale,
    })),
  }
}

/**
 * Runs the plan across the grid of need and extra multipliers.
 *
 * Nine propagations of the adaptive run only — around 0.2 s for an ISK plan and
 * a couple of seconds for an AF one, so this belongs behind an explicit request
 * rather than on every edit.
 *
 * Indexed `[needIndex][extraIndex]` against `SENSITIVITY_FACTORS`, so a row is
 * one need level across the extra axis.
 */
export function sensitivityGrid(params: PlannerParameters): SensitivityCell[][] {
  return SENSITIVITY_FACTORS.map((needScale) =>
    SENSITIVITY_FACTORS.map((extraScale) => ({
      needScale,
      extraScale,
      base: needScale === BASE_FACTOR && extraScale === BASE_FACTOR,
      ...adaptiveSummary(scaled(params, needScale, extraScale)),
    })),
  )
}
