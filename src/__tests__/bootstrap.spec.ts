import { describe, it, expect, vi, beforeEach } from 'vitest'
import { alea } from 'seedrandom'
import { sampleAnnualReturns, prepareBootstrapPayload } from '../bootstrap'
import type { GmmComponent, BootstrapPayload } from '../bootstrap'

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
  const gmmComponents: GmmComponent[] = [{ weight: 1.0, mean: 0.5, std: 0.29 }]

  // Mock per-fund monthly data
  const fundAData = {
    isin: 'SE0001',
    name: 'Fund A',
    dates: Array.from({ length: 60 }, (_, i) => {
      const year = 2015 + Math.floor(i / 12)
      const month = (i % 12) + 1
      return `${year}-${String(month).padStart(2, '0')}`
    }),
    returns: Array.from({ length: 60 }, () => 0.01),
  }

  const fundBData = {
    isin: 'SE0002',
    name: 'Fund B',
    dates: Array.from({ length: 60 }, (_, i) => {
      const year = 2015 + Math.floor(i / 12)
      const month = (i % 12) + 1
      return `${year}-${String(month).padStart(2, '0')}`
    }),
    returns: Array.from({ length: 60 }, () => 0.02),
  }

  // Fund C only has data from month 30 onward
  const fundCData = {
    isin: 'SE0003',
    name: 'Fund C',
    dates: Array.from({ length: 30 }, (_, i) => {
      const totalMonth = 30 + i
      const year = 2015 + Math.floor(totalMonth / 12)
      const month = (totalMonth % 12) + 1
      return `${year}-${String(month).padStart(2, '0')}`
    }),
    returns: Array.from({ length: 30 }, () => 0.015),
  }

  const fundsDb = {
    funds: [
      {
        isin: 'SE0001',
        name: 'Fund A',
        category: 'global',
        monthly_file: 'global/fund_se0001_monthly.json',
      },
      {
        isin: 'SE0002',
        name: 'Fund B',
        category: 'global',
        monthly_file: 'global/fund_se0002_monthly.json',
      },
      {
        isin: 'SE0003',
        name: 'Fund C',
        category: 'global',
        monthly_file: 'global/fund_se0003_monthly.json',
      },
    ],
  }

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      const dataMap: Record<string, unknown> = {
        '/data/global/fund_se0001_monthly.json': fundAData,
        '/data/global/fund_se0002_monthly.json': fundBData,
        '/data/global/fund_se0003_monthly.json': fundCData,
      }
      const data = dataMap[urlStr]
      if (data) {
        return new Response(JSON.stringify(data), { status: 200 })
      }
      return new Response('Not found', { status: 404 })
    })
  })

  it('builds a dense return matrix for assets with full overlap', async () => {
    const result = await prepareBootstrapPayload(['Fund A', 'Fund B'], fundsDb, gmmComponents)
    expect('warnings' in result).toBe(false)

    const payload = result as BootstrapPayload
    expect(payload.nMonths).toBe(60)
    expect(payload.returnMatrix).toHaveLength(60)
    expect(payload.returnMatrix[0]).toEqual([0.01, 0.02])
    expect(payload.assetOrder).toEqual(['SE0001', 'SE0002'])
  })

  it('restricts to common date range when one fund starts later', async () => {
    const result = await prepareBootstrapPayload(['Fund A', 'Fund C'], fundsDb, gmmComponents)
    expect('warnings' in result).toBe(false)

    const payload = result as BootstrapPayload
    // Fund C only has data from month 30 onward
    expect(payload.nMonths).toBe(30)
    expect(payload.returnMatrix).toHaveLength(30)
  })

  it('returns warning for unknown asset', async () => {
    const result = await prepareBootstrapPayload(['Fund A', 'Unknown Fund'], fundsDb, gmmComponents)
    expect('warnings' in result).toBe(true)
    const warnings = (result as { warnings: string[] }).warnings
    expect(warnings[0]).toContain('Unknown Fund')
  })

  it('returns warning when common period is too short', async () => {
    // Fund D has only 10 months of data
    const fundDData = {
      isin: 'SE0004',
      name: 'Fund D',
      dates: Array.from({ length: 10 }, (_, i) => `2020-${String(i + 1).padStart(2, '0')}`),
      returns: Array.from({ length: 10 }, () => 0.01),
    }
    const shortFundsDb = {
      funds: [
        {
          isin: 'SE0004',
          name: 'Fund D',
          category: 'global',
          monthly_file: 'global/fund_se0004_monthly.json',
        },
      ],
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(fundDData), { status: 200 })
    })

    const result = await prepareBootstrapPayload(['Fund D'], shortFundsDb, gmmComponents)
    expect('warnings' in result).toBe(true)
    const warnings = (result as { warnings: string[] }).warnings
    expect(warnings[0]).toContain('Otillräcklig')
  })

  it('passes through GMM components', async () => {
    const customGmm: GmmComponent[] = [
      { weight: 0.6, mean: 0.3, std: 0.1 },
      { weight: 0.4, mean: 0.8, std: 0.05 },
    ]
    const result = await prepareBootstrapPayload(['Fund A'], fundsDb, customGmm)
    expect('warnings' in result).toBe(false)
    const payload = result as BootstrapPayload
    expect(payload.gmmComponents).toEqual(customGmm)
  })
})
