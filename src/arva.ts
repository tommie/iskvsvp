import { portfolioMoments } from './returns'
import type { SimulationAsset } from './types'

/**
 * The withdrawal rule: ARVA (Waring & Siegel's amortization-based withdrawal)
 * applied to the *surplus* alone.
 *
 * The household enters a **need**, which is paid whenever the portfolio can
 * pay it, and an **extra**, which is paid only out of the balance above what
 * the remaining needs (and a bequest) would take. Each year, reserve the
 * discounted remaining need commitments, spread any surplus over the extra
 * still to come, and pay `need + clamp(surplus / annuity, 0, extra)`.
 *
 * Plain ARVA spends wealth divided by an annuity factor. That has no floor, so
 * a bad sequence cuts essential spending; applied to the surplus alone it
 * gives a guaranteed need and a discretionary part that cannot run dry. An
 * extra of zero is simply the fixed, inflation-indexed withdrawal.
 *
 * Relative to Merton: Merton derives the spending share, and the allocation,
 * from a risk-aversion parameter. This keeps only the annuity form and takes
 * the allocation as given. The rate that discounts the need is a *quantile* of
 * the portfolio's own compound return rather than a certainty-equivalent
 * return, which is safety-first pricing of a hard floor, not a preference.
 *
 * Everything here is in real terms: balances and amounts are divided by the
 * cumulative inflation before they get here and multiplied back afterwards.
 *
 * The same rule is used by the Kapitalplanerare, which propagates a density
 * instead of sampling; see `src/planner/propagate.ts` on the `planner` branch
 * for the measurements behind the choices below.
 */

/** Log-return law of the portfolio's annual real return. */
export interface ReturnLaw {
  logMean: number
  logStdDev: number
}

/**
 * The portfolio's annual real return as one moment-matched lognormal. Annual
 * rebalancing is assumed, since letting weights drift would make the schedule
 * depend on the path.
 */
export function returnLaw(assets: SimulationAsset[], correlations: number[][]): ReturnLaw {
  const { mean, variance } = portfolioMoments(assets, correlations)
  const gross = 1 + mean
  const sigma2 = Math.log(1 + variance / (gross * gross))
  return { logMean: Math.log(gross) - sigma2 / 2, logStdDev: Math.sqrt(sigma2) }
}

/**
 * z score of the 25th percentile, used to size the need reserve.
 *
 * Not the median. Discounting the need at the return the plan expects makes
 * the reserve a coin-flip hurdle: a plan clears it for years while spending
 * the whole extra, and only starts cutting once the damage is done. A lower
 * quantile asks whether the need is funded even if the portfolio does poorly.
 * It has no probabilistic reading at plan level, because the reserve applies
 * the p25 of every horizon at once; tune it by measuring.
 */
export const RESERVE_QUANTILE_Z = -0.6744897501960817

/**
 * The real rate a commitment `horizon` years away is discounted at: the 25th
 * percentile of the annualised compound return over that horizon, less the
 * proportional tax drag.
 *
 * The horizon is the *distance to the commitment*, not the plan's length.
 * Quantile dispersion shrinks as 1/sqrt(T), so one full-horizon rate would be
 * only ~1.7 points under the median on a forty-year plan, and applied to a
 * payment two years out (which deserves nearer 7) it made the reserve most
 * optimistic exactly where a bad sequence can no longer be recovered from.
 */
export function reserveRate(law: ReturnLaw, taxDrag: number, horizon: number): number {
  const annualised =
    Math.exp(law.logMean + (RESERVE_QUANTILE_Z * law.logStdDev) / Math.sqrt(Math.max(1, horizon))) -
    1
  return Math.max(-0.99, annualised - taxDrag)
}

/**
 * The rate the bequest is discounted at: the plan's *median* compound return,
 * net of the tax drag. Deliberately not the need's quantile. The need is a hard
 * floor and earns safety-first pricing; the bequest is a wish whose failure is
 * not treated as failure, so pricing it as a floor would take consumption from
 * the living household for the estate. On a 45-year plan a 30 mkr target
 * reserves 10.3 mkr at p25 against 5.3 mkr at the median.
 */
export function bequestRate(law: ReturnLaw, taxDrag: number): number {
  return Math.max(-0.99, Math.exp(law.logMean) - 1 - taxDrag)
}

export interface ArvaSchedule {
  /** Discounted remaining need, valued at the instant year t's withdrawal is taken. */
  reserve: Float64Array
  /** Discounted remaining extra over year t's own extra; 1 for a year with none. */
  annuity: Float64Array
  /** The bequest target discounted to year t. */
  keep: Float64Array
}

/**
 * Reserve, annuity factor and bequest reserve for every year.
 *
 * `need[s]` and `extra[s]` are the real amounts asked for in year `s`
 * (0 outside the withdrawal years); `target` is the real bequest.
 *
 * Every entry is valued at the instant the year's withdrawal is taken, which
 * is *after* that year's return. That makes the reserve an annuity-due: the
 * first remaining payment is undiscounted, and a commitment `k` years off is
 * worth `(1 + reserveRate(k))^-k`. The bequest is what remains once the last
 * year is paid, so it discounts over `years - 1 - t` returns, and the final
 * year's commitment is the undiscounted target itself.
 *
 * The surplus is spread over the extra in the shape the household drew it:
 * `annuity[t]` is the discounted value of *all* remaining extra over year t's
 * own, so every year is served the same fraction of what it asked for.
 */
export function reserveSchedule(
  need: readonly number[],
  extra: readonly number[],
  target: number,
  law: ReturnLaw,
  taxDrag: number,
): ArvaSchedule {
  const years = need.length
  const reserve = new Float64Array(years + 1)
  const annuity = new Float64Array(years + 1)
  const keep = new Float64Array(years + 1)

  // What a krona k years away is worth today. Hoisted: it depends on the
  // distance alone, not on which year is looking.
  const factor = new Float64Array(years + 1)
  factor[0] = 1
  for (let k = 1; k <= years; k++) factor[k] = Math.pow(1 + reserveRate(law, taxDrag, k), -k)

  const keepDiscount = 1 / (1 + bequestRate(law, taxDrag))

  for (let t = 0; t <= years; t++) {
    let needPV = 0
    let extraSum = 0
    for (let s = t; s < years; s++) {
      needPV += need[s]! * factor[s - t]!
      extraSum += Math.max(0, extra[s]!) * factor[s - t]!
    }
    reserve[t] = needPV
    const own = t < years ? Math.max(0, extra[t]!) : 0
    // A year asking for no extra is capped at zero anyway, so its factor is
    // never read; one keeps it clear of a 0/0.
    annuity[t] = own > 0 ? extraSum / own : 1
    keep[t] = target * Math.pow(keepDiscount, years - 1 - t)
  }

  return { reserve, annuity, keep }
}

/**
 * What to withdraw this year, in real terms.
 *
 * `balance` is the real balance after this year's return. `share` is the part
 * of a krona of balance that reaches the household as cash: 1 for an ISK, and
 * for a VP account `1 - g·r`, since a sale that realises gain fraction `g` at
 * rate `r` also pays tax on it. The reserve and the annuity are in cash
 * delivered, so the reserve becomes the balance that funds it. The bequest
 * converts the same way here, because it is measured net of the tax the heirs
 * inherit.
 *
 * The rate is net of the schablon alone: the schablon is a drag on the balance
 * and belongs in the rate, the tax on gains is a cost of *raising* cash and
 * belongs in the amount. Charging it in both would reserve a plan into never
 * spending.
 *
 * Returns the need alone when the need cannot be funded; the caller clamps it
 * to the balance.
 */
export function arvaWithdrawal(
  balance: number,
  need: number,
  extra: number,
  schedule: ArvaSchedule,
  year: number,
  share: number,
): number {
  if (!(share > 0)) return need
  const reservedBalance = (schedule.reserve[year]! + schedule.keep[year]!) / share
  const surplus = balance - reservedBalance
  if (!(surplus > 0) || !(extra > 0)) return need
  const available = balance * share - need
  if (!(available > 0)) return need
  return need + Math.min(extra, (surplus * share) / schedule.annuity[year]!, available)
}
