/**
 * Significant digits shown for every computed figure.
 *
 * The propagation carries real error — the grid leaves the ruin probability a
 * few tenths of a percentage point out, and the return assumptions are round
 * numbers to begin with — so printing a balance to the krona claims a precision
 * the model does not have. Two digits is about what the inputs support.
 *
 * This applies to *outputs*. Values the user typed are echoed back as entered.
 */
export const SIGNIFICANT_DIGITS = 2

/**
 * Rounds to `digits` significant digits, leaving zero and non-finite alone.
 *
 * Via toPrecision rather than scaling by a power of ten and back: dividing by a
 * small float leaves residue, so 4 031 234 came out as 4000000.0000000005 and
 * printed an extra digit at exactly the magnitudes this is meant to tidy.
 */
export function toSignificant(value: number, digits = SIGNIFICANT_DIGITS): number {
  if (!Number.isFinite(value) || value === 0) return value
  return Number(value.toPrecision(digits))
}

// maximumFractionDigits is generous because the value has already been rounded;
// it only needs to be enough to render what is left without adding noise.
const decimal = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 6 })
const whole = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 })

/**
 * Kronor, switching to millions once the number would otherwise be a wall of
 * digits. The unit is chosen after rounding, so a figure never rounds up across
 * the boundary and back down again.
 */
export function formatKr(value: number): string {
  if (!Number.isFinite(value)) return '–'
  const rounded = toSignificant(value)
  if (Math.abs(rounded) >= 1e6) return `${decimal.format(rounded / 1e6)} mkr`
  return `${decimal.format(rounded)} kr`
}

/**
 * Kronor to the whole krona, without significant-digit rounding.
 *
 * For figures that only restate something the user typed in another unit:
 * 200 000 a year really is 16 667 a month, and there is no model uncertainty in
 * the division to round away. Rounding those would make them worse at the one
 * job they have, which is being compared against a household budget.
 */
export function formatKrExact(value: number): string {
  if (!Number.isFinite(value)) return '–'
  return `${whole.format(value)} kr`
}

/**
 * A figure as its change against a reference, signed: `+11 %`, `−9 %`.
 *
 * Reported rather than the two amounts because the difference is often the only
 * thing being asked of a comparison, and a percentage says it in one number
 * where two balances make the reader do the division. A reference of zero has no
 * change to express — every non-zero value is infinitely more than nothing — so
 * it gives the same dash as any other figure the model cannot state.
 */
export function formatRelative(value: number, reference: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference === 0) return '–'
  const percent = (value / reference - 1) * 100
  // Only the plus needs adding; the locale supplies its own minus sign.
  return `${percent > 0 ? '+' : ''}${formatPercent(percent)}`
}

/**
 * The gap between two shares, in percentage points.
 *
 * The counterpart to `formatRelative` for a figure that is already a
 * probability. A survival of 0.87 against 0.65 is a fall of 22 points, and
 * saying it fell by a quarter instead invites the two readings to be confused —
 * the whole model is discussed in points of survival, so the display should be
 * too. Both arguments are shares, not percentages.
 */
export function formatPointChange(value: number, reference: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(reference)) return '–'
  const points = (value - reference) * 100
  // Only the plus needs adding; the locale supplies its own minus sign.
  return `${points > 0 ? '+' : ''}${decimal.format(toSignificant(points))}\u00a0p.e.`
}

/** A percentage, given a value already expressed in percent (0-100). */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '–'
  // Svenska skrivregler puts a non-breaking space before the sign.
  return `${decimal.format(toSignificant(value))} %`
}
