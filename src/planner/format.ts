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

/**
 * Rounds *down* to `digits` significant digits.
 *
 * For amounts written back into a plan rather than merely displayed: rounding
 * down can only spend less than was solved for, so the result stays on the safe
 * side of whatever target produced it, and it leaves a round number the
 * household can reason about.
 */
export function floorToSignificant(value: number, digits = SIGNIFICANT_DIGITS): number {
  if (!Number.isFinite(value) || value === 0) return value
  const factor = Math.pow(10, Math.floor(Math.log10(Math.abs(value))) - digits + 1)
  // toPrecision clears the residue that dividing by a sub-unit factor leaves
  // behind for amounts below ten.
  return Number((Math.floor(value / factor) * factor).toPrecision(15))
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

/** A percentage, given a value already expressed in percent (0-100). */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '–'
  // Svenska skrivregler puts a non-breaking space before the sign.
  return `${decimal.format(toSignificant(value))} %`
}
