import { describe, it, expect } from 'vitest'

import {
  ASSET_CLASS_PRESETS,
  DEFAULT_ASSET_CLASSES,
  DEFAULT_CORRELATIONS,
  UNKNOWN_CORRELATION,
  assetFromPreset,
  correlationMatrixFor,
  presetCorrelation,
} from '../planner/assets'
import { portfolioMoments } from '../planner/propagate'

describe('asset class presets', () => {
  it('has unique ids', () => {
    const ids = ASSET_CLASS_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('seeds a portfolio whose weights sum to one', () => {
    const total = DEFAULT_ASSET_CLASSES.reduce((sum, asset) => sum + asset.weight, 0)
    expect(total).toBeCloseTo(1, 12)
  })

  it('tags every seeded asset with the preset it came from', () => {
    for (const asset of DEFAULT_ASSET_CLASSES) {
      expect(asset.presetId).toBeDefined()
      expect(ASSET_CLASS_PRESETS.some((preset) => preset.id === asset.presetId)).toBe(true)
    }
  })
})

describe('presetCorrelation', () => {
  it('is symmetric and one on the diagonal', () => {
    for (const a of ASSET_CLASS_PRESETS) {
      expect(presetCorrelation(a.id, a.id)).toBe(1)
      for (const b of ASSET_CLASS_PRESETS) {
        expect(presetCorrelation(a.id, b.id)).toBe(presetCorrelation(b.id, a.id))
      }
    }
  })

  it('falls back for a hand-rolled asset with no catalogue entry', () => {
    expect(presetCorrelation(undefined, 'global-equity')).toBe(UNKNOWN_CORRELATION)
    expect(presetCorrelation('global-equity', undefined)).toBe(UNKNOWN_CORRELATION)
    expect(presetCorrelation(undefined, undefined)).toBe(UNKNOWN_CORRELATION)
    expect(presetCorrelation('global-equity', 'not-a-preset')).toBe(UNKNOWN_CORRELATION)
  })

  it('reproduces the documented default matrix', () => {
    // Derived rather than written out, so this pins the values the portfolio
    // actually starts from.
    expect(DEFAULT_CORRELATIONS).toEqual([
      [1, 0.8, 0, 0.1],
      [0.8, 1, 0, 0.15],
      [0, 0, 1, 0.5],
      [0.1, 0.15, 0.5, 1],
    ])
  })
})

describe('correlationMatrixFor', () => {
  it('restores catalogue correlations when a class is re-added', () => {
    const withoutBonds = DEFAULT_ASSET_CLASSES.filter(
      (asset) => asset.presetId !== 'nordic-long-bonds',
    )
    const bonds = ASSET_CLASS_PRESETS.find((preset) => preset.id === 'nordic-long-bonds')!
    const readded = [...withoutBonds, assetFromPreset(bonds, 'nordic-long-bonds', 0)]

    const matrix = correlationMatrixFor(readded)
    // Long bonds against global equity, Swedish equity and short rates.
    expect(matrix[3]).toEqual([0.1, 0.15, 0.5, 1])
  })

  it('treats a duplicated preset as perfectly correlated with itself', () => {
    const global = ASSET_CLASS_PRESETS[0]!
    const matrix = correlationMatrixFor([
      assetFromPreset(global, 'global-equity', 0.5),
      assetFromPreset(global, 'global-equity-2', 0.5),
    ])
    expect(matrix).toEqual([
      [1, 1],
      [1, 1],
    ])
  })
})

describe('alignment with Prognosstandard för pensioner', () => {
  const INFLATION = 0.02

  /** The compound real rate the planner's lognormal fit implies for one class. */
  function compoundReal(presetId: string): number {
    const preset = ASSET_CLASS_PRESETS.find((candidate) => candidate.id === presetId)!
    const moments = portfolioMoments([assetFromPreset(preset, preset.id, 1)], [[1]])
    return Math.exp(moments.logMean) - 1
  }

  it('reproduces the standard’s nominal figures per class', () => {
    // The standard subtracts inflation arithmetically, so the round trip is
    // compound real + 2% = the published nominal rate.
    // Globala aktier: 6.5% nominal.
    expect(compoundReal('global-equity') + INFLATION).toBeCloseTo(0.065, 4)
    // Långa räntor: 2.5% nominal.
    expect(compoundReal('nordic-long-bonds') + INFLATION).toBeCloseTo(0.025, 4)
  })

  it('gives Swedish equity the same compound return as global, only riskier', () => {
    // The standard has one equity number and no Swedish premium, so the extra
    // volatility must not buy extra compound growth.
    expect(compoundReal('swedish-equity')).toBeCloseTo(compoundReal('global-equity'), 4)

    const swedish = ASSET_CLASS_PRESETS.find((p) => p.id === 'swedish-equity')!
    const global = ASSET_CLASS_PRESETS.find((p) => p.id === 'global-equity')!
    expect(swedish.volatility).toBeGreaterThan(global.volatility)
    // The higher arithmetic mean is purely the variance add-back.
    expect(swedish.expectedRealReturn).toBeGreaterThan(global.expectedRealReturn)
  })

  it('keeps short rates below the standard’s long-bond figure', () => {
    expect(compoundReal('nordic-short-rates')).toBeLessThan(compoundReal('nordic-long-bonds'))
    expect(compoundReal('nordic-short-rates')).toBeCloseTo(0, 4)
  })

  it('lands just above 3.5% real on the standard’s reference 75/25 portfolio', () => {
    const global = ASSET_CLASS_PRESETS.find((p) => p.id === 'global-equity')!
    const bonds = ASSET_CLASS_PRESETS.find((p) => p.id === 'nordic-long-bonds')!
    const assets = [
      assetFromPreset(global, global.id, 0.75),
      assetFromPreset(bonds, bonds.id, 0.25),
    ]
    const compound = Math.exp(portfolioMoments(assets, correlationMatrixFor(assets)).logMean) - 1

    // The standard weights its per-class compound rates linearly and gets 3.5%.
    // Doing that ignores diversification: a 75/25 mix has lower variance than
    // the weighted average of its parts, so the honest figure is a little
    // higher. The gap is the diversification benefit, not a disagreement.
    expect(compound).toBeGreaterThan(0.035)
    expect(compound).toBeLessThan(0.039)
  })
})

describe('expected rebalancing turnover', () => {
  const moments = (
    assets: { volatility: number; expectedRealReturn: number; weight: number }[],
    correlations: number[][],
  ) =>
    portfolioMoments(
      assets.map((a, i) => ({ id: `a${i}`, name: `A${i}`, ...a })),
      correlations,
    ).rebalancingTurnover

  it('is zero for a single asset, which has nothing to rebalance against', () => {
    expect(moments([{ weight: 1, expectedRealReturn: 0.06, volatility: 0.2 }], [[1]])).toBe(0)
  })

  it('is zero for assets that never drift apart', () => {
    // Equal volatility and perfect correlation: the weights are unchanged by
    // any return, so the targets never need restoring.
    expect(
      moments(
        [
          { weight: 0.5, expectedRealReturn: 0.06, volatility: 0.2 },
          { weight: 0.5, expectedRealReturn: 0.06, volatility: 0.2 },
        ],
        [
          [1, 1],
          [1, 1],
        ],
      ),
    ).toBeCloseTo(0, 10)
  })

  it('matches the exact answer for a deterministic split', () => {
    // No volatility, so the year is fully determined: 0.5 grows to 0.55 and 0.5
    // stays at 0.5, giving weights 0.5238/0.4762 out of 1.05. Restoring the
    // targets sells 0.0238 of the portfolio.
    const turnover = moments(
      [
        { weight: 0.5, expectedRealReturn: 0.1, volatility: 0 },
        { weight: 0.5, expectedRealReturn: 0, volatility: 0 },
      ],
      [
        [1, 0],
        [0, 1],
      ],
    )
    expect(turnover).toBeCloseTo(0.05 / 2.1, 6)
  })

  it('rises as the assets decouple', () => {
    const at = (correlation: number) =>
      moments(
        [
          { weight: 0.5, expectedRealReturn: 0.06, volatility: 0.2 },
          { weight: 0.5, expectedRealReturn: 0.06, volatility: 0.2 },
        ],
        [
          [1, correlation],
          [correlation, 1],
        ],
      )
    expect(at(0.9)).toBeLessThan(at(0.5))
    expect(at(0.5)).toBeLessThan(at(0))
    expect(at(0)).toBeLessThan(at(-0.5))
  })

  it('gives the default portfolio a plausible annual turnover', () => {
    const turnover = portfolioMoments(
      DEFAULT_ASSET_CLASSES,
      DEFAULT_CORRELATIONS,
    ).rebalancingTurnover
    // A few percent a year for a 70/20/10 mix — small, but not nothing, and it
    // is taxable in an AF account.
    expect(turnover).toBeGreaterThan(0.005)
    expect(turnover).toBeLessThan(0.06)
  })
})
