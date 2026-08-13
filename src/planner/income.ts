// Placing a plan's withdrawals on the Swedish income distribution.
//
// A withdrawal in kronor says nothing on its own — 300 000 a year is either
// comfortable or thin depending on who is asking. SCB publishes the whole
// percentile ladder of disposable income, so the plan can say where its
// spending sits among Swedish households instead of leaving the reader to
// guess.
//
// The data lives in `public/income-reference-YYYYMMDD.json` and is regenerated
// by `scripts/fetch-income-reference.sh`. See the "Reference Data" section of
// CLAUDE.md for the source and its publication schedule.

/**
 * The reference file currently checked in.
 *
 * The date in the name is the staleness signal, so it cannot be derived — it
 * has to be stated somewhere. The fetch script checks this constant against
 * what it wrote and fails if they have drifted apart, which is the only thing
 * keeping the two in step.
 */
export const INCOME_REFERENCE_FILE = 'income-reference-20260808.json'

/** One age band's median, for the group the plan's household actually belongs to. */
export interface IncomeMedianByAge {
  age: string
  householdType: string
  median: number
}

export interface IncomeReference {
  source: {
    agency: string
    product: string
    url: string
    attribution: string
    region: string
    referenceYear: number
    retrieved: string
    publicationFrequency: string
  }
  unit: string
  incomeConcept: string
  consumptionUnitScale: {
    singleAdult: number
    cohabitingCouple: number
    additionalAdult: number
    firstChild0to19: number
    furtherChild0to19: number
  }
  /** Percentile limits, keyed by percentile as a string. P1 through P99. */
  perConsumptionUnit: Record<string, number>
  perHousehold: Record<string, number>
  medianByAge: IncomeMedianByAge[]
}

/** SCB publishes P1 through P99; there is nothing to interpolate beyond either end. */
const LOWEST_PERCENTILE = 1
const HIGHEST_PERCENTILE = 99

/**
 * Where an amount falls on the ladder.
 *
 * `bound` is set when the amount lies outside the published range, where the
 * percentile is a limit rather than a location. The distinction matters at the
 * top: a plan spending five times P99 and one spending P99 exactly are both
 * "the 99th percentile", and only one of them should be phrased that way.
 */
export interface IncomePlacement {
  percentile: number
  bound: 'below' | 'above' | null
}

/**
 * Reads a ladder into ascending [percentile, limit] pairs.
 *
 * Sorted rather than trusted in file order: JSON object key order is not
 * something to build an interpolation on, and the numeric keys would sort
 * lexically anyway ("10" before "9").
 */
function ladderPairs(ladder: Record<string, number>): [number, number][] {
  return Object.entries(ladder)
    .map(([percentile, limit]): [number, number] => [Number(percentile), limit])
    .filter(([percentile, limit]) => Number.isFinite(percentile) && Number.isFinite(limit))
    .sort((a, b) => a[0] - b[0])
}

/**
 * The percentile an amount lands at, interpolated between the published limits.
 *
 * Linear in kronor between two adjacent limits. The ladder is dense enough that
 * the choice of interpolant barely shows: one percentile step is a few thousand
 * kronor over most of the range.
 *
 * Returns null for an amount that has no place on an income ladder — a deposit
 * year, or a year that withdraws nothing.
 */
export function placeOnLadder(
  ladder: Record<string, number>,
  amount: number,
): IncomePlacement | null {
  if (!Number.isFinite(amount) || amount <= 0) return null

  const pairs = ladderPairs(ladder)
  if (pairs.length < 2) return null

  const first = pairs[0]!
  const last = pairs[pairs.length - 1]!
  if (amount <= first[1]) return { percentile: first[0], bound: 'below' }
  if (amount >= last[1]) return { percentile: last[0], bound: 'above' }

  for (let i = 1; i < pairs.length; i++) {
    const [upperPercentile, upperLimit] = pairs[i]!
    if (amount > upperLimit) continue
    const [lowerPercentile, lowerLimit] = pairs[i - 1]!
    const span = upperLimit - lowerLimit
    // Two identical limits would divide by zero; the lower percentile is the
    // honest answer there, since everything in the flat stretch shares it.
    const fraction = span > 0 ? (amount - lowerLimit) / span : 0
    return {
      percentile: lowerPercentile + fraction * (upperPercentile - lowerPercentile),
      bound: null,
    }
  }

  return null
}

/**
 * Restates a plan amount in the reference year's prices.
 *
 * The plan runs in real terms in today's money; SCB's figures are nominal in
 * the prices of a reference year that is always two years behind, because that
 * is the lag the statistic is published at. Comparing the two directly would
 * overstate the plan's percentile by whatever inflation ran in between.
 *
 * The correction uses the plan's *own* inflation assumption over a window that
 * is in the past and therefore already measured. That is a deliberate scope
 * limit: pulling in KPI would mean a second source with a monthly cadence to
 * keep current, for a correction worth roughly two percentile points, and the
 * plan's assumption is at least the one every other figure on the page is
 * consistent with.
 */
export function deflateToReferenceYear(
  amount: number,
  referenceYear: number,
  currentYear: number,
  inflationRate: number,
): number {
  const years = currentYear - referenceYear
  if (!Number.isFinite(years) || !Number.isFinite(inflationRate) || inflationRate <= -1) {
    return amount
  }
  return amount / Math.pow(1 + inflationRate, years)
}

/**
 * SCB's age bands, coarsest last so a lookup can fall back through them.
 *
 * `label` exists because the codes are the table's own keys — "50-64", "80+" —
 * and putting those in front of a reader means an ASCII hyphen where Swedish
 * wants an en dash, and a bare "+" where it wants words.
 */
const AGE_BANDS: { upTo: number; code: string; label: string }[] = [
  { upTo: 49, code: '20+', label: '20 år och äldre' },
  { upTo: 64, code: '50-64', label: '50–64 år' },
  { upTo: 79, code: '65-79', label: '65–79 år' },
  { upTo: Infinity, code: '80+', label: '80 år och äldre' },
]

/**
 * Household type code for a given number of consumption units.
 *
 * Only the two forms SCB reports as childless households are offered, which is
 * what a drawdown plan almost always is. Anything above a single adult reads as
 * cohabiting: the alternative bands (with children at home) describe a
 * different life stage than a plan that spends down capital.
 */
function householdTypeFor(consumptionUnits: number): string {
  return consumptionUnits > 1 ? 'sammanboende utan barn' : 'ensamstående utan barn'
}

/**
 * The median for the group the plan's household belongs to.
 *
 * Retirees sit well below the all-ages median, so the population-wide ladder on
 * its own flatters a retirement plan. This is the figure that says so.
 */
export function medianForHousehold(
  reference: IncomeReference,
  startAge: number,
  consumptionUnits: number,
): GroupMedian | null {
  const band = AGE_BANDS.find((candidate) => startAge <= candidate.upTo) ?? AGE_BANDS[0]!
  const householdType = householdTypeFor(consumptionUnits)
  const entry = reference.medianByAge.find(
    (candidate) => candidate.age === band.code && candidate.householdType === householdType,
  )
  if (!entry) return null

  return {
    ageLabel: band.label,
    householdType: entry.householdType,
    // Back out of consumption units into what the household actually has,
    // which is the basis the plan's own withdrawal is stated on.
    median: entry.median * consumptionUnits,
  }
}

/** A reference group's median, converted back to a whole-household amount. */
export interface GroupMedian {
  ageLabel: string
  householdType: string
  median: number
}

/**
 * Loads the reference file.
 *
 * Rejects rather than returning a partial object: a ladder that silently lost
 * its percentiles would place every plan at the same spot, which reads as an
 * answer rather than as a missing file.
 */
export async function loadIncomeReference(baseUrl = import.meta.env.BASE_URL): Promise<IncomeReference> {
  const url = `${baseUrl}${INCOME_REFERENCE_FILE}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Kunde inte hämta ${INCOME_REFERENCE_FILE}: ${response.status}`)
  }

  const data = (await response.json()) as IncomeReference
  const ladderSize = Object.keys(data?.perConsumptionUnit ?? {}).length
  if (ladderSize < HIGHEST_PERCENTILE - LOWEST_PERCENTILE + 1) {
    throw new Error(`${INCOME_REFERENCE_FILE} saknar percentiler (${ladderSize} av 99)`)
  }
  if (!Number.isFinite(data?.source?.referenceYear)) {
    throw new Error(`${INCOME_REFERENCE_FILE} saknar referensår`)
  }
  return data
}

/**
 * A percentile as a Swedish ordinal: 1:a, 2:a, 3:e…
 *
 * Rounded to a whole percentile first. The ladder is published in whole
 * percentiles and the amounts feeding it are rounded budget figures, so a
 * decimal would be invented precision — the same reason every other computed
 * figure on the page goes through `format.ts`.
 */
export function formatPercentileOrdinal(percentile: number): string {
  const whole = Math.round(percentile)
  const suffix = whole === 1 || whole === 2 ? 'a' : 'e'
  return `${whole}:${suffix}`
}
