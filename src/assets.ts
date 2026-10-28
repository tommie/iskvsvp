import type { SimulationAsset } from './types'

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
 * `expectedReturn` below is therefore the arithmetic mean that reproduces
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
  expectedReturn: number
  volatility: number
  /** Weight this class gets when it seeds the starting portfolio. */
  defaultWeight: number
}

export const ASSET_CLASS_PRESETS: AssetClassPreset[] = [
  {
    id: 'global-equity',
    name: 'Globala aktier',
    // Standard: 6.5% nominal − 2% inflation = 4.5% real compound.
    expectedReturn: 0.0584,
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
    expectedReturn: 0.067,
    volatility: 0.22,
    defaultWeight: 0.2,
  },
  {
    id: 'nordic-short-rates',
    name: 'Korta räntor (SEK/Norden)',
    // Not in the standard, whose rate figure is explicitly for *långa* räntor.
    // Extrapolated as 0% real compound — cash keeping pace with inflation over
    // the long run — which stays below the standard's only rate number.
    expectedReturn: 0.0002,
    volatility: 0.02,
    defaultWeight: 0.1,
  },
  {
    id: 'nordic-long-bonds',
    name: 'Långa obligationer (SEK/Norden)',
    // Standard: 2.5% nominal − 2% inflation = 0.5% real compound.
    expectedReturn: 0.0074,
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

export function assetFromPreset(preset: AssetClassPreset, weight: number): SimulationAsset {
  return {
    presetId: preset.id,
    name: preset.name,
    weight,
    expectedReturn: preset.expectedReturn,
    volatility: preset.volatility,
  }
}

/** Builds the symmetric correlation matrix implied by the assets' presets. */
export function correlationMatrixFor(assets: SimulationAsset[]): number[][] {
  return assets.map((row) =>
    assets.map((column) => presetCorrelation(row.presetId, column.presetId)),
  )
}

export const DEFAULT_ASSET_CLASSES: SimulationAsset[] = ASSET_CLASS_PRESETS.map((preset) =>
  assetFromPreset(preset, preset.defaultWeight),
)

export const DEFAULT_CORRELATIONS: number[][] = correlationMatrixFor(DEFAULT_ASSET_CLASSES)
