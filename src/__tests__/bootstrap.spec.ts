import { describe, it, expect } from 'vitest'
import { alea } from 'seedrandom'
import { sampleAnnualReturns, prepareBootstrapPayload } from '../bootstrap'
import type { GmmComponent, BootstrapData, BootstrapPayload } from '../bootstrap'

describe('sampleAnnualReturns', () => {
  // Build a simple return matrix: 60 months, 2 assets
  // Asset 0: constant 1% monthly, Asset 1: constant 2% monthly
  const nMonths = 60
  const returnMatrix: number[][] = []
  for (let i = 0; i < nMonths; i++) {
    returnMatrix.push([0.01, 0.02])
  }

  const uniformComponents: GmmComponent[] = [{ weight: 1.0, mean: 0.5, std: 0.29 }]

  it('returns correct number of years', () => {
    const rng = alea('test-seed')
    const result = sampleAnnualReturns(returnMatrix, nMonths, uniformComponents, rng, 5)
    expect(result).toHaveLength(5)
  })

  it('returns one entry per asset per year', () => {
    const rng = alea('test-seed')
    const result = sampleAnnualReturns(returnMatrix, nMonths, uniformComponents, rng, 3)
    for (const yearReturns of result) {
      expect(yearReturns).toHaveLength(2)
    }
  })

  it('compounds 12 monthly returns into annual returns', () => {
    // With constant 1% monthly return, annual = (1.01)^12 - 1 ≈ 0.1268
    const rng = alea('compound-test')
    const result = sampleAnnualReturns(returnMatrix, nMonths, uniformComponents, rng, 1)
    const expectedAsset0 = Math.pow(1.01, 12) - 1
    const expectedAsset1 = Math.pow(1.02, 12) - 1

    expect(result[0]![0]).toBeCloseTo(expectedAsset0, 8)
    expect(result[0]![1]).toBeCloseTo(expectedAsset1, 8)
  })

  it('is deterministic with same seed', () => {
    const rng1 = alea('deterministic')
    const rng2 = alea('deterministic')

    // Use a matrix with varying returns to make this meaningful
    const varyingMatrix: number[][] = []
    for (let i = 0; i < nMonths; i++) {
      varyingMatrix.push([0.01 * Math.sin(i), 0.02 * Math.cos(i)])
    }

    const result1 = sampleAnnualReturns(varyingMatrix, nMonths, uniformComponents, rng1, 3)
    const result2 = sampleAnnualReturns(varyingMatrix, nMonths, uniformComponents, rng2, 3)

    expect(result1).toEqual(result2)
  })

  it('handles odd number of years (final year uses first 12 months of block)', () => {
    const rng = alea('odd-years')
    const result = sampleAnnualReturns(returnMatrix, nMonths, uniformComponents, rng, 3)
    expect(result).toHaveLength(3)
    // All years should have valid compounded returns
    for (const yearReturns of result) {
      expect(yearReturns[0]).toBeGreaterThan(0)
      expect(yearReturns[1]).toBeGreaterThan(0)
    }
  })

  it('respects GMM weighting by biasing block start', () => {
    // Build a matrix where early months have 10% return, late months have -10%
    const biasedMatrix: number[][] = []
    const biasedMonths = 60
    for (let i = 0; i < biasedMonths; i++) {
      const ret = i < biasedMonths / 2 ? 0.1 : -0.1
      biasedMatrix.push([ret])
    }

    // GMM heavily weighted toward early period (mean=0.1, std=0.02)
    const earlyComponents: GmmComponent[] = [{ weight: 1.0, mean: 0.1, std: 0.02 }]
    // GMM heavily weighted toward late period (mean=0.9, std=0.02)
    const lateComponents: GmmComponent[] = [{ weight: 1.0, mean: 0.9, std: 0.02 }]

    // Run many samples and compare average returns
    let earlySum = 0
    let lateSum = 0
    const trials = 200
    for (let t = 0; t < trials; t++) {
      const rngE = alea(`early-${t}`)
      const rngL = alea(`late-${t}`)
      const earlyResult = sampleAnnualReturns(biasedMatrix, biasedMonths, earlyComponents, rngE, 1)
      const lateResult = sampleAnnualReturns(biasedMatrix, biasedMonths, lateComponents, rngL, 1)
      earlySum += earlyResult[0]![0]!
      lateSum += lateResult[0]![0]!
    }

    // Early-biased GMM should produce higher average returns
    expect(earlySum / trials).toBeGreaterThan(lateSum / trials)
  })
})

describe('prepareBootstrapPayload', () => {
  const bootstrapData: BootstrapData = {
    dates: Array.from({ length: 60 }, (_, i) => {
      const year = 2015 + Math.floor(i / 12)
      const month = (i % 12) + 1
      return `${year}-${String(month).padStart(2, '0')}`
    }),
    funds: {
      SE0001: { name: 'Fund A', returns: Array.from({ length: 60 }, () => 0.01) },
      SE0002: { name: 'Fund B', returns: Array.from({ length: 60 }, () => 0.02) },
      SE0003: {
        name: 'Fund C',
        returns: [
          // Only available from month 30 onward
          ...Array.from({ length: 30 }, () => null),
          ...Array.from({ length: 30 }, () => 0.015),
        ],
      },
    },
  }

  const fundsDb = {
    funds: [
      { name: 'Fund A', isin: 'SE0001', category: 'global' },
      { name: 'Fund B', isin: 'SE0002', category: 'global' },
      { name: 'Fund C', isin: 'SE0003', category: 'global' },
    ],
  }

  const gmmComponents: GmmComponent[] = [{ weight: 1.0, mean: 0.5, std: 0.29 }]

  it('builds a dense return matrix for assets with full overlap', () => {
    const result = prepareBootstrapPayload(
      ['Fund A', 'Fund B'],
      fundsDb,
      bootstrapData,
      gmmComponents,
    )
    expect('warnings' in result).toBe(false)

    const payload = result as BootstrapPayload
    expect(payload.nMonths).toBe(60)
    expect(payload.returnMatrix).toHaveLength(60)
    expect(payload.returnMatrix[0]).toEqual([0.01, 0.02])
    expect(payload.assetOrder).toEqual(['SE0001', 'SE0002'])
  })

  it('restricts to common date range when one fund starts later', () => {
    const result = prepareBootstrapPayload(
      ['Fund A', 'Fund C'],
      fundsDb,
      bootstrapData,
      gmmComponents,
    )
    expect('warnings' in result).toBe(false)

    const payload = result as BootstrapPayload
    // Fund C only has data from month 30 onward
    expect(payload.nMonths).toBe(30)
    expect(payload.returnMatrix).toHaveLength(30)
  })

  it('returns warning for unknown asset', () => {
    const result = prepareBootstrapPayload(
      ['Fund A', 'Unknown Fund'],
      fundsDb,
      bootstrapData,
      gmmComponents,
    )
    expect('warnings' in result).toBe(true)
    const warnings = (result as { warnings: string[] }).warnings
    expect(warnings[0]).toContain('Unknown Fund')
  })

  it('returns warning when common period is too short', () => {
    const shortData: BootstrapData = {
      dates: Array.from({ length: 10 }, (_, i) => `2020-${String(i + 1).padStart(2, '0')}`),
      funds: {
        SE0001: { name: 'Fund A', returns: Array.from({ length: 10 }, () => 0.01) },
      },
    }
    const result = prepareBootstrapPayload(['Fund A'], fundsDb, shortData, gmmComponents)
    expect('warnings' in result).toBe(true)
    const warnings = (result as { warnings: string[] }).warnings
    expect(warnings[0]).toContain('Otillräcklig')
  })

  it('passes through GMM components', () => {
    const customGmm: GmmComponent[] = [
      { weight: 0.6, mean: 0.3, std: 0.1 },
      { weight: 0.4, mean: 0.8, std: 0.05 },
    ]
    const result = prepareBootstrapPayload(['Fund A'], fundsDb, bootstrapData, customGmm)
    expect('warnings' in result).toBe(false)
    const payload = result as BootstrapPayload
    expect(payload.gmmComponents).toEqual(customGmm)
  })
})
