import { formatKrExact } from './format'

/** Mean year length including leap days, which a decades-long plan contains. */
export const DAYS_PER_YEAR = 365.25
export const WEEKS_PER_YEAR = DAYS_PER_YEAR / 7
export const MONTHS_PER_YEAR = 12

export interface Cadences {
  month: number
  week: number
  day: number
}

/**
 * Splits a yearly amount into the cadences a household budgets in.
 *
 * The divisors all derive from one year length, so the set is coherent: a year
 * is twelve months, 52.18 weeks and 365.25 days, and a week is seven days.
 * Dividing by a flat 52 and 365 instead would make each figure multiply back to
 * exactly the annual amount, but only by pretending a year is both 364 and 365
 * days at once — and the weekly and daily figures would then disagree with each
 * other by a day and a quarter's worth of spending.
 */
export function cadences(annual: number): Cadences {
  return {
    month: annual / MONTHS_PER_YEAR,
    week: annual / WEEKS_PER_YEAR,
    day: annual / DAYS_PER_YEAR,
  }
}

/**
 * The cadences as a single line for display, to the whole krona.
 *
 * Deliberately exempt from the two-significant-digit rounding the model outputs
 * use: these are an exact restatement of an amount the user entered, not a
 * result carrying discretisation error. Empty for a non-finite amount, which is
 * what a cleared number input yields — rendering "NaN kr/mån" under a field the
 * user is in the middle of editing helps nobody.
 */
export function formatCadences(annual: number): string {
  if (!Number.isFinite(annual)) return ''
  const { month, week, day } = cadences(annual)
  return `${formatKrExact(month)}/mån · ${formatKrExact(week)}/vecka · ${formatKrExact(day)}/dag`
}
