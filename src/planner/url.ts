import { defaultPlannerParameters } from './assets'
import type { CashflowYear, PlannerParameters } from './types'

// Compact URL encoding for a plan, so a plan can be shared or bookmarked.
//
// The cash flow is the bulky part: one entry per year, most of them identical.
// It is run-length encoded as "count*need|extra" segments, which keeps a
// typical plan — a handful of distinct spending phases — down to a few dozen
// characters regardless of the horizon.

const SEGMENT_SEPARATOR = ';'

function encodeCashflow(cashflow: CashflowYear[]): string {
  const segments: string[] = []
  let count = 0
  let current: CashflowYear | null = null

  const flush = () => {
    if (current === null || count === 0) return
    segments.push(`${count}*${current.need}|${current.extra}`)
  }

  for (const year of cashflow) {
    if (current !== null && year.need === current.need && year.extra === current.extra) {
      count++
      continue
    }
    flush()
    current = year
    count = 1
  }
  flush()

  return segments.join(SEGMENT_SEPARATOR)
}

function decodeCashflow(encoded: string, years: number): CashflowYear[] | null {
  const cashflow: CashflowYear[] = []

  for (const segment of encoded.split(SEGMENT_SEPARATOR)) {
    if (!segment) continue
    const match = segment.match(/^(\d+)\*(-?[\d.]+)\|(-?[\d.]+)$/)
    if (!match) return null
    const count = parseInt(match[1]!, 10)
    const need = parseFloat(match[2]!)
    const extra = parseFloat(match[3]!)
    if (!Number.isFinite(need) || !Number.isFinite(extra)) return null
    // Guard against a hand-edited URL asking for a huge allocation.
    if (count < 1 || cashflow.length + count > 200) return null
    for (let i = 0; i < count; i++) cashflow.push({ need, extra })
  }

  if (cashflow.length !== years) return null
  return cashflow
}

function numberList(values: number[]): string {
  return values.map((value) => Number(value.toPrecision(6))).join(',')
}

function parseNumberList(raw: string | null, expected: number): number[] | null {
  if (raw === null) return null
  const parts = raw.split(',').map((part) => parseFloat(part))
  if (parts.length !== expected || parts.some((value) => !Number.isFinite(value))) return null
  return parts
}

/** Flattens the strict upper triangle, which is all a symmetric matrix needs. */
function encodeCorrelations(correlations: number[][], size: number): string {
  const values: number[] = []
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      values.push(correlations[i]?.[j] ?? 0)
    }
  }
  return numberList(values)
}

function decodeCorrelations(raw: string | null, size: number): number[][] | null {
  const expected = (size * (size - 1)) / 2
  const values = expected === 0 ? [] : parseNumberList(raw, expected)
  if (values === null) return null

  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => 0))
  let index = 0
  for (let i = 0; i < size; i++) {
    matrix[i]![i] = 1
    for (let j = i + 1; j < size; j++) {
      const value = values[index++]!
      matrix[i]![j] = value
      matrix[j]![i] = value
    }
  }
  return matrix
}

export function encodePlan(params: PlannerParameters): string {
  const query = new URLSearchParams()
  query.set('c', String(params.initialCapital))
  query.set('a', String(params.startAge))
  query.set('y', String(params.years))
  query.set('f', encodeCashflow(params.cashflow))
  query.set('n', params.assets.map((asset) => asset.name).join(','))
  // Preset ids ride along so correlations for assets added after a reload
  // still come from the catalogue rather than the unknown-pair placeholder.
  query.set('p', params.assets.map((asset) => asset.presetId ?? '').join(','))
  query.set('w', numberList(params.assets.map((asset) => asset.weight)))
  query.set('r', numberList(params.assets.map((asset) => asset.expectedRealReturn)))
  query.set('v', numberList(params.assets.map((asset) => asset.volatility)))
  query.set('k', encodeCorrelations(params.correlations, params.assets.length))
  query.set('t', params.accountType)
  query.set('it', String(params.iskTaxRate))
  query.set('cg', String(params.capitalGainsTaxRate))
  query.set('ia', String(params.iskAllowance))
  query.set('sr', String(params.afSchablonRate))
  query.set('cb', String(params.initialCostBasisRatio))
  query.set('i', String(params.inflationRate))
  query.set('bq', String(params.bequestRatio))
  // Carried even though the engine ignores it: it decides which income
  // percentile the withdrawals are reported against, so a shared link that
  // dropped it would show the recipient a different reading of the same plan.
  query.set('q', String(params.consumptionUnits))
  return query.toString()
}

function parsePositive(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const value = parseFloat(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function parseStrictlyPositive(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const value = parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Rebuilds a plan from a query string, falling back to the defaults field by
 * field. A malformed or truncated URL therefore degrades to a usable plan
 * rather than an error page, but anything structurally inconsistent — a cash
 * flow whose length disagrees with the horizon, a correlation triangle of the
 * wrong size — is rejected wholesale so the plan can never be silently wrong.
 */
export function decodePlan(search: string): PlannerParameters {
  const defaults = defaultPlannerParameters()
  const query = new URLSearchParams(search)
  if ([...query.keys()].length === 0) return defaults

  const names =
    query
      .get('n')
      ?.split(',')
      .filter((name) => name.length > 0) ?? null
  const size = names?.length ?? defaults.assets.length

  const weights = parseNumberList(query.get('w'), size)
  const returns = parseNumberList(query.get('r'), size)
  const volatilities = parseNumberList(query.get('v'), size)
  const correlations = decodeCorrelations(query.get('k'), size)

  const presetIds = query.get('p')?.split(',') ?? null
  const assets =
    names && weights && returns && volatilities
      ? names.map((name, index) => {
          const presetId = presetIds?.[index]
          return {
            id: presetId || `asset-${index}`,
            ...(presetId ? { presetId } : {}),
            name,
            weight: weights[index]!,
            expectedRealReturn: returns[index]!,
            volatility: volatilities[index]!,
          }
        })
      : defaults.assets

  const yearsRaw = parseInt(query.get('y') ?? '', 10)
  const years =
    Number.isInteger(yearsRaw) && yearsRaw >= 1 && yearsRaw <= 100 ? yearsRaw : defaults.years

  const encodedCashflow = query.get('f')
  const cashflow = encodedCashflow ? decodeCashflow(encodedCashflow, years) : null

  const accountType = query.get('t') === 'AF' ? 'AF' : 'ISK'

  return {
    ...defaults,
    initialCapital: parsePositive(query.get('c'), defaults.initialCapital),
    startAge: parsePositive(query.get('a'), defaults.startAge),
    years,
    // A cash flow that failed to decode falls back to a schedule of the right
    // length rather than the default's, which would be the wrong horizon.
    cashflow:
      cashflow ??
      Array.from({ length: years }, (_, index) =>
        index < defaults.cashflow.length
          ? { ...defaults.cashflow[index]! }
          : { ...defaults.cashflow[defaults.cashflow.length - 1]! },
      ),
    assets: assets.map((asset) => ({ ...asset })),
    correlations:
      correlations ??
      (assets === defaults.assets
        ? defaults.correlations
        : Array.from({ length: size }, (_, i) =>
            Array.from({ length: size }, (_, j) => (i === j ? 1 : 0.5)),
          )),
    accountType,
    iskTaxRate: parsePositive(query.get('it'), defaults.iskTaxRate),
    capitalGainsTaxRate: parsePositive(query.get('cg'), defaults.capitalGainsTaxRate),
    iskAllowance: parsePositive(query.get('ia'), defaults.iskAllowance),
    afSchablonRate: parsePositive(query.get('sr'), defaults.afSchablonRate),
    initialCostBasisRatio: parsePositive(query.get('cb'), defaults.initialCostBasisRatio),
    inflationRate: parsePositive(query.get('i'), defaults.inflationRate),
    bequestRatio: parsePositive(query.get('bq'), defaults.bequestRatio),
    // Strictly positive, unlike the rates above: zero consumption units would
    // divide the household's spending by nothing.
    consumptionUnits: parseStrictlyPositive(query.get('q'), defaults.consumptionUnits),
  }
}
