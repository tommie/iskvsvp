import type { CashflowYear, PlannerAsset, PlannerParameters } from './types'

/**
 * One entry in the asset-class catalogue offered when adding to a portfolio.
 *
 * The figures follow the Swedish Prognosstandard för pensioner — the forecast
 * standard Pensionsmyndigheten and the pension companies agreed on and use for
 * minPension — rather than being fitted to the fund database. That database
 * holds individual funds over short, overlapping windows in nominal terms,
 * while a horizon of decades needs long-run real class returns. Following the
 * pension standard also means this page answers with the same assumptions the
 * rest of a Swedish saver's projections use.
 *
 * The standard assumes 6.5% nominal for globala aktier, 2.5% nominal for långa
 * räntor and 2% inflation (the Riksbank target), giving 3.5% real at its
 * reference 75/25 allocation, before tax and fees. It subtracts inflation
 * arithmetically (5.5 − 2.0 = 3.5), so the real figures here do the same.
 *
 * IMPORTANT — the standard is a deterministic point projection, so its numbers
 * are *compound* growth rates. This model needs *arithmetic* means, because it
 * applies the variance drag itself when it fits the lognormal. Each
 * `expectedRealReturn` below is therefore the arithmetic mean that reproduces
 * the standard's compound rate at that volatility, not the standard's figure
 * copied across; using the standard's number directly would understate growth
 * by roughly σ²/2 per year. The comments record the compound rate each one
 * targets, and a test pins the round trip.
 *
 * Volatilities are *not* from the standard, which is deterministic and states
 * none. They remain long-run figures of the order the Dimson–Marsh–Staunton
 * series show. Everything here is editable in the UI.
 */
export interface AssetClassPreset {
  id: string
  name: string
  expectedRealReturn: number
  volatility: number
  /** Weight this class gets when it seeds the starting portfolio. */
  defaultWeight: number
}

export const ASSET_CLASS_PRESETS: AssetClassPreset[] = [
  {
    id: 'global-equity',
    name: 'Globala aktier',
    // Standard: 6.5% nominal − 2% inflation = 4.5% real compound.
    expectedRealReturn: 0.0584,
    volatility: 0.17,
    defaultWeight: 0.7,
  },
  {
    id: 'swedish-equity',
    name: 'Svenska aktier',
    // The standard has a single equity figure, for *globala* aktier, and no
    // Swedish premium. Swedish equity therefore carries the same 4.5% real
    // compound return with more volatility: no compounding advantage, just
    // more risk. Its higher arithmetic mean is the variance add-back, not a
    // claim that Swedish shares earn more.
    expectedRealReturn: 0.067,
    volatility: 0.22,
    defaultWeight: 0.2,
  },
  {
    id: 'nordic-short-rates',
    name: 'Korta räntor (SEK/Norden)',
    // Not in the standard, whose rate figure is explicitly for *långa* räntor.
    // Extrapolated as 0% real compound — cash keeping pace with inflation over
    // the long run — which stays below the standard's only rate number.
    expectedRealReturn: 0.0002,
    volatility: 0.02,
    defaultWeight: 0.1,
  },
  {
    id: 'nordic-long-bonds',
    name: 'Långa obligationer (SEK/Norden)',
    // Standard: 2.5% nominal − 2% inflation = 0.5% real compound.
    expectedRealReturn: 0.0074,
    volatility: 0.07,
    defaultWeight: 0,
  },
]

/** Correlation applied when at least one side is not a known preset. */
export const UNKNOWN_CORRELATION = 0.5

/**
 * Correlations of *real* returns between catalogue entries, keyed by the two
 * preset ids joined in alphabetical order.
 *
 * Real-return correlations are not the same as nominal ones: a common
 * inflation term is removed from every series, which pushes the bond classes
 * away from equities relative to the nominal figures most tables quote. Like
 * the returns above, these are editable starting points.
 */
const PRESET_CORRELATIONS: Record<string, number> = {
  'global-equity|swedish-equity': 0.8,
  'global-equity|nordic-short-rates': 0.0,
  'global-equity|nordic-long-bonds': 0.1,
  'nordic-short-rates|swedish-equity': 0.0,
  'nordic-long-bonds|swedish-equity': 0.15,
  'nordic-long-bonds|nordic-short-rates': 0.5,
}

/**
 * Correlation between two catalogue entries. Falls back to
 * `UNKNOWN_CORRELATION` for a hand-rolled asset, which has no documented
 * relationship to anything — a visible, editable placeholder rather than an
 * implied independence that would flatter the portfolio's diversification.
 */
export function presetCorrelation(a: string | undefined, b: string | undefined): number {
  if (a !== undefined && a === b) return 1
  if (a === undefined || b === undefined) return UNKNOWN_CORRELATION
  return PRESET_CORRELATIONS[[a, b].sort().join('|')] ?? UNKNOWN_CORRELATION
}

export function assetFromPreset(
  preset: AssetClassPreset,
  id: string,
  weight: number,
): PlannerAsset {
  return {
    id,
    presetId: preset.id,
    name: preset.name,
    weight,
    expectedRealReturn: preset.expectedRealReturn,
    volatility: preset.volatility,
  }
}

/** Builds the symmetric correlation matrix implied by the assets' presets. */
export function correlationMatrixFor(assets: PlannerAsset[]): number[][] {
  return assets.map((row) =>
    assets.map((column) => presetCorrelation(row.presetId, column.presetId)),
  )
}

export const DEFAULT_ASSET_CLASSES: PlannerAsset[] = ASSET_CLASS_PRESETS.map((preset) =>
  assetFromPreset(preset, preset.id, preset.defaultWeight),
)

export const DEFAULT_CORRELATIONS: number[][] = correlationMatrixFor(DEFAULT_ASSET_CLASSES)

/** Builds a flat cash flow schedule of `years` entries. */
export function buildCashflow(years: number, floor: number, optional: number): CashflowYear[] {
  return Array.from({ length: years }, () => ({ floor, optional }))
}

/**
 * Resizes a schedule in place-safe fashion, keeping existing years and
 * extending with the last entry's values so lengthening the horizon does not
 * silently insert zero-spend years.
 */
export function resizeCashflow(cashflow: CashflowYear[], years: number): CashflowYear[] {
  if (years <= cashflow.length) return cashflow.slice(0, years)
  const last = cashflow[cashflow.length - 1] ?? { floor: 0, optional: 0 }
  return [...cashflow, ...Array.from({ length: years - cashflow.length }, () => ({ ...last }))]
}

export function defaultPlannerParameters(): PlannerParameters {
  const years = 40
  return {
    // A 2.2% floor and a 3.3% ceiling over forty years. The floor alone survives
    // about 90%, which puts it inside the band practitioners target for a fixed
    // spending plan — and a sound floor is the premise the adaptive rule and the
    // scale solver are both built on, so the page should open on one. It also
    // separates the three runs enough that each says something: roughly 90%,
    // 81% and 69%.
    initialCapital: 9_000_000,
    startAge: 60,
    years,
    assets: DEFAULT_ASSET_CLASSES.map((asset) => ({ ...asset })),
    correlations: DEFAULT_CORRELATIONS.map((row) => [...row]),
    accountType: 'ISK',
    // The schablon rate is statslåneräntan plus one percentage point (floored
    // at 1.25% in law). For income year 2026 that is 3.55%, from an SLR of
    // 2.55% on 2025-11-30 — but holding one year's spot rate for four decades
    // makes the answer jump with short-term rate moves, which is precisely why
    // the pension forecast standard fixes a long-run SLR instead of using the
    // current one. The standard's own choice is 2.5%, giving 3.5%.
    //
    // 4% is used here instead, i.e. a long-run SLR near 3%. Konjunkturinstitutet's
    // scenario has the policy rate rising to 2.5% by 2031, and the observed term
    // premium of SLR over the policy rate is currently around 0.8 points. That
    // is half a point above the standard; see the note in the UI.
    //
    // This is a forecast of the *real* SLR, not of inflation, and it is
    // deliberately independent of `inflationRate`. SLR is a nominal yield, so
    // Fisher would have it track inflation — but it does not, at the horizon
    // this model runs at. Regressing annual SLR (Riksgälden, weekly from 1986)
    // on annual KPI (SCB) gives a slope of -0.09 over the inflation-targeting
    // era 1995-2025, and SLR is a *negative* predictor of the following five
    // years' inflation over the same window. 2022-2023 is the vivid case:
    // inflation of 8.4% and 8.6% moved SLR from 1.5% to 2.5%. What actually
    // moves the schablon is the real rate, which fell monotonically across 8
    // percentage points in the sample — from a +5.5% real SLR in 1996-2000 to
    // -2.8% in 2021-2025. A full-sample regression looks Fisher-like only
    // because that secular decline happened to overlap the disinflation.
    //
    // So this rate is the model's largest un-surfaced sensitivity, and it is
    // not one that varying inflation would expose. A plausible band is +-1.5
    // points (2.5% to 5.5%); one point of SLR is 0.3 points of annual drag on
    // the whole balance, which compounds to roughly 11% of terminal capital
    // over forty years.
    iskTaxRate: 0.04,
    capitalGainsTaxRate: 0.3,
    // The tax-free base level is 300 000 kr from 2026-01-01. Unlike the
    // Monte Carlo simulator, which has no allowance, the planner models it —
    // it is the only channel through which inflation touches a real result.
    iskAllowance: 300_000,
    // Schablonintäkt on fund holdings in a taxable account: 0.4% of value,
    // taxed as capital income.
    afSchablonRate: 0.004,
    // Freshly invested money, so the whole balance is cost basis and nothing is
    // unrealised gain. Anyone carrying an older holding should lower this.
    initialCostBasisRatio: 1,
    inflationRate: 0.02,
    cashflow: buildCashflow(years, 200_000, 100_000),
    gridNodes: 800,
    // 41 nodes is fully converged: raising it to 81 moves nothing at the fifth
    // decimal, and the return integral is the inner loop of a two-dimensional
    // sweep for AF.
    quadratureNodes: 41,
    // The cost-basis dimension is what AF accuracy actually costs. Against a
    // 1200x96x121 reference, 32 nodes leaves the ruin probability 0.27
    // percentage points high; 24 doubles that and 48 halves it at 1.5x the
    // time.
    basisNodes: 32,
  }
}
