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

/** One thing a grid can be wrong about, and how to be wrong about it. */
export interface SensitivityAxis {
  /** Names the axis in the grid; short, because it repeats. */
  label: string
  scale: (params: PlannerParameters, factor: number) => PlannerParameters
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
 * A negative need is a deposit, and doubling it doubles the deposit — the axis
 * asks "what if I have this wrong by a factor of two", and a household that has
 * misjudged its contributions has misjudged them in the same direction as its
 * withdrawals.
 *
 * The bequest target is untouched by either cash-flow axis: it is a share of the
 * starting capital, which neither moves.
 */
export const NEED_AXIS: SensitivityAxis = {
  label: 'Behov',
  scale: (params, factor) => scaleCashflow(params, (year) => ({ need: year.need * factor })),
}

export const EXTRA_AXIS: SensitivityAxis = {
  label: 'Extra',
  scale: (params, factor) => scaleCashflow(params, (year) => ({ extra: year.extra * factor })),
}

/**
 * The expected real return of every asset, with the volatilities left alone.
 *
 * That makes it "what if I am wrong about what this portfolio earns", not "what
 * if the market is a different market" — the spread is a property of the assets,
 * while the mean is the assumption the household is taking on trust. Scaling
 * both would confound the two, and the answer would be unattributable.
 */
export const RETURN_AXIS: SensitivityAxis = {
  label: 'Avkastning',
  scale: (params, factor) => ({
    ...params,
    assets: params.assets.map((asset) => ({
      ...asset,
      expectedRealReturn: asset.expectedRealReturn * factor,
    })),
  }),
}

/**
 * Inflation, which the plan is *mostly* immune to and deliberately so.
 *
 * Everything here is real and the ISK schablon is proportional, so inflation
 * cancels out of the result except where the tax code is written in nominal
 * kronor: the ISK fribelopp, and for an AF the acquisition cost and the loss
 * threshold, none of which are indexed. Measured on the default plan, doubling
 * it costs an ISK 0.3 points of survival and nothing measurable in capital,
 * against 4 points and a fifth of the final capital for an AF — where the
 * unindexed omkostnadsbelopp means a rising price level is taxed as gain.
 *
 * An axis that barely moves is a finding rather than a fault: it says the plan
 * does not turn on a forecast the household cannot make.
 */
export const INFLATION_AXIS: SensitivityAxis = {
  label: 'Inflation',
  scale: (params, factor) => ({ ...params, inflationRate: params.inflationRate * factor }),
}

export interface SensitivityCell extends AdaptiveSummary {
  rowScale: number
  colScale: number
  /** True for the plan as entered. */
  base: boolean
}

/**
 * Runs the plan across the grid of two axes' multipliers.
 *
 * Nine propagations of the adaptive run only — around 0.2 s for an ISK plan and
 * a couple of seconds for an AF one, so this belongs behind an explicit request
 * rather than on every edit.
 *
 * Indexed `[row][col]` against `SENSITIVITY_FACTORS`, so a row is one level of
 * the first axis read across the second.
 */
export function sensitivityGrid(
  params: PlannerParameters,
  rowAxis: SensitivityAxis,
  colAxis: SensitivityAxis,
): SensitivityCell[][] {
  return SENSITIVITY_FACTORS.map((rowScale) =>
    SENSITIVITY_FACTORS.map((colScale) => ({
      rowScale,
      colScale,
      base: rowScale === BASE_FACTOR && colScale === BASE_FACTOR,
      ...adaptiveSummary(colAxis.scale(rowAxis.scale(params, rowScale), colScale)),
    })),
  )
}
