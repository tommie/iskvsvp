import { describe, it, expect, vi, beforeEach } from 'vitest'
import { alea } from 'seedrandom'
import { sampleAnnualReturns, prepareBootstrapPayload, parseYearMonth, filterProfilesByDateRange, getCommonDateRange } from '../bootstrap'
import type { BootstrapComponent, BootstrapPayload, BootstrapProfile } from '../bootstrap'

describe('parseYearMonth', () => {
  it('converts YYYY-MM to absolute month index', () => {
    expect(parseYearMonth('2015-01')).toBe(2015 * 12 + 0)
    expect(parseYearMonth('2008-07')).toBe(2008 * 12 + 6)
    expect(parseYearMonth('2020-03')).toBe(2020 * 12 + 2)
  })
})

describe('sampleAnnualReturns', () => {
  // Build a simple return matrix: 60 months, 2 assets
  // Asset 0: constant 1% monthly, Asset 1: constant 2% monthly
  const nMonths = 60
  const startDate = '2015-01'
  const returnMatrix: number[][] = []
  for (let i = 0; i < nMonths; i++) {
    returnMatrix.push([0.01, 0.02])
  }

  // Empty components = pure uniform
  const uniformComponents: BootstrapComponent[] = []

  it('returns correct number of years', () => {
    const rng = alea('test-seed')
    const result = sampleAnnualReturns(returnMatrix, nMonths, uniformComponents, rng, 5, startDate)
    expect(result).toHaveLength(5)
  })

  it('returns one entry per asset per year', () => {
    const rng = alea('test-seed')
    const result = sampleAnnualReturns(returnMatrix, nMonths, uniformComponents, rng, 3, startDate)
    for (const yearReturns of result) {
      expect(yearReturns).toHaveLength(2)
    }
  })

  it('compounds 12 monthly returns into annual returns', () => {
    // With constant 1% monthly return, annual = (1.01)^12 - 1 ≈ 0.1268
    const rng = alea('compound-test')
    const result = sampleAnnualReturns(returnMatrix, nMonths, uniformComponents, rng, 1, startDate)
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

    const result1 = sampleAnnualReturns(varyingMatrix, nMonths, uniformComponents, rng1, 3, startDate)
    const result2 = sampleAnnualReturns(varyingMatrix, nMonths, uniformComponents, rng2, 3, startDate)

    expect(result1).toEqual(result2)
  })

  it('handles odd number of years (final year uses first 12 months of block)', () => {
    const rng = alea('odd-years')
    const result = sampleAnnualReturns(returnMatrix, nMonths, uniformComponents, rng, 3, startDate)
    expect(result).toHaveLength(3)
    // All years should have valid compounded returns
    for (const yearReturns of result) {
      expect(yearReturns[0]).toBeGreaterThan(0)
      expect(yearReturns[1]).toBeGreaterThan(0)
    }
  })

  it('respects profile weighting by biasing block start', () => {
    // 60-month matrix starting "2015-01"
    // Early months have 10% return, late months have -10%
    const biasedMatrix: number[][] = []
    const biasedMonths = 60
    for (let i = 0; i < biasedMonths; i++) {
      const ret = i < biasedMonths / 2 ? 0.1 : -0.1
      biasedMatrix.push([ret])
    }
    const biasedStartDate = '2015-01'

    // Early component centered at 2015-06 (month index 5 from start)
    const earlyComponents: BootstrapComponent[] = [
      { weight: 1.0, centerMonth: '2015-06', stdMonths: 2 },
    ]
    // Late component centered at 2019-06 (month index 53 from start)
    const lateComponents: BootstrapComponent[] = [
      { weight: 1.0, centerMonth: '2019-06', stdMonths: 2 },
    ]

    // Run many samples and compare average returns
    let earlySum = 0
    let lateSum = 0
    const trials = 200
    for (let t = 0; t < trials; t++) {
      const rngE = alea(`early-${t}`)
      const rngL = alea(`late-${t}`)
      const earlyResult = sampleAnnualReturns(biasedMatrix, biasedMonths, earlyComponents, rngE, 1, biasedStartDate)
      const lateResult = sampleAnnualReturns(biasedMatrix, biasedMonths, lateComponents, rngL, 1, biasedStartDate)
      earlySum += earlyResult[0]![0]!
      lateSum += lateResult[0]![0]!
    }

    // Early-biased profile should produce higher average returns
    expect(earlySum / trials).toBeGreaterThan(lateSum / trials)
  })
})

describe('prepareBootstrapPayload', () => {
  const profileComponents: BootstrapComponent[] = []

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
        start_month: '2015-01',
      },
      {
        isin: 'SE0002',
        name: 'Fund B',
        category: 'global',
        monthly_file: 'global/fund_se0002_monthly.json',
        start_month: '2015-01',
      },
      {
        isin: 'SE0003',
        name: 'Fund C',
        category: 'global',
        monthly_file: 'global/fund_se0003_monthly.json',
        start_month: '2017-07',
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
    const result = await prepareBootstrapPayload(['Fund A', 'Fund B'], fundsDb, profileComponents)
    expect('warnings' in result).toBe(false)

    const payload = result as BootstrapPayload
    expect(payload.nMonths).toBe(60)
    expect(payload.returnMatrix).toHaveLength(60)
    expect(payload.returnMatrix[0]).toEqual([0.01, 0.02])
    expect(payload.assetOrder).toEqual(['SE0001', 'SE0002'])
  })

  it('restricts to common date range when one fund starts later', async () => {
    const result = await prepareBootstrapPayload(['Fund A', 'Fund C'], fundsDb, profileComponents)
    expect('warnings' in result).toBe(false)

    const payload = result as BootstrapPayload
    // Fund C only has data from month 30 onward
    expect(payload.nMonths).toBe(30)
    expect(payload.returnMatrix).toHaveLength(30)
  })

  it('returns warning for unknown asset', async () => {
    const result = await prepareBootstrapPayload(
      ['Fund A', 'Unknown Fund'],
      fundsDb,
      profileComponents,
    )
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
          start_month: '2020-01',
        },
      ],
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify(fundDData), { status: 200 })
    })

    const result = await prepareBootstrapPayload(['Fund D'], shortFundsDb, profileComponents)
    expect('warnings' in result).toBe(true)
    const warnings = (result as { warnings: string[] }).warnings
    expect(warnings[0]).toContain('Otillräcklig')
  })

  it('passes through profile components', async () => {
    const customProfile: BootstrapComponent[] = [
      { weight: 0.6, centerMonth: '2016-04', stdMonths: 3 },
      { weight: 0.4, centerMonth: '2019-01', stdMonths: 2 },
    ]
    const result = await prepareBootstrapPayload(['Fund A'], fundsDb, customProfile)
    expect('warnings' in result).toBe(false)
    const payload = result as BootstrapPayload
    expect(payload.profileComponents).toEqual(customProfile)
  })

  it('includes startDate in returned payload', async () => {
    const result = await prepareBootstrapPayload(['Fund A', 'Fund B'], fundsDb, profileComponents)
    expect('warnings' in result).toBe(false)
    const payload = result as BootstrapPayload
    expect(payload.startDate).toBe('2015-01')
  })

  it('sets startDate to beginning of common range', async () => {
    const result = await prepareBootstrapPayload(['Fund A', 'Fund C'], fundsDb, profileComponents)
    expect('warnings' in result).toBe(false)
    const payload = result as BootstrapPayload
    // Fund C starts at month 30 = 2017-07
    expect(payload.startDate).toBe('2017-07')
  })
})

describe('filterProfilesByDateRange', () => {
  const profiles: BootstrapProfile[] = [
    { id: 'uniform', label: 'Uniform', components: [] },
    { id: 'early', label: 'Early', components: [{ weight: 0.4, centerMonth: '2005-01', stdMonths: 6 }] },
    { id: 'mid', label: 'Mid', components: [{ weight: 0.4, centerMonth: '2015-06', stdMonths: 4 }] },
    { id: 'late', label: 'Late', components: [{ weight: 0.4, centerMonth: '2024-01', stdMonths: 3 }] },
  ]

  it('always includes profiles with no components', () => {
    const result = filterProfilesByDateRange(profiles, '2010-01', 120)
    expect(result.map((p) => p.id)).toContain('uniform')
  })

  it('excludes profiles whose center predates the data range', () => {
    // Data starts 2010-01, 120 months. "Early" at 2005-01 is before the range.
    const result = filterProfilesByDateRange(profiles, '2010-01', 120)
    expect(result.map((p) => p.id)).not.toContain('early')
    expect(result.map((p) => p.id)).toContain('mid')
  })

  it('excludes profiles whose center exceeds maxStart', () => {
    // Data starts 2010-01, 60 months (ends ~2015-01). "Late" at 2024-01 is way past.
    const result = filterProfilesByDateRange(profiles, '2010-01', 60)
    expect(result.map((p) => p.id)).not.toContain('late')
  })

  it('includes allowPartial profiles even when some components are out of range', () => {
    const mixed: BootstrapProfile[] = [
      {
        id: 'combo', label: 'Combo', allowPartial: true,
        components: [
          { weight: 0.03, centerMonth: '2005-01', stdMonths: 6 }, // out of range
          { weight: 0.03, centerMonth: '2015-06', stdMonths: 4 }, // in range
        ],
      },
    ]
    const result = filterProfilesByDateRange(mixed, '2010-01', 120)
    expect(result.map((p) => p.id)).toContain('combo')
  })
})

describe('getCommonDateRange', () => {
  const fundsDb = {
    funds: [
      { isin: 'A', name: 'Fund A', category: 'x', monthly_file: 'a.json', start_month: '2010-01' },
      { isin: 'B', name: 'Fund B', category: 'x', monthly_file: 'b.json', start_month: '2015-06' },
    ],
  }

  it('returns the latest start_month as startDate', () => {
    const range = getCommonDateRange(['Fund A', 'Fund B'], fundsDb)
    expect(range).not.toBeNull()
    expect(range!.startDate).toBe('2015-06')
  })

  it('returns null for unknown assets', () => {
    expect(getCommonDateRange(['Unknown'], fundsDb)).toBeNull()
  })

  it('returns null when data range is too short', () => {
    const tinyDb = {
      funds: [
        { isin: 'C', name: 'Fund C', category: 'x', monthly_file: 'c.json', start_month: '2026-01' },
      ],
    }
    expect(getCommonDateRange(['Fund C'], tinyDb)).toBeNull()
  })
})

describe('sampleBlockStart retry', () => {
  it('produces valid samples even when profile center is near data boundary', () => {
    // 60-month matrix, profile centered at month 2 from start with tight std.
    // With BLOCK_MONTHS/2 offset, adjusted center is negative — tests retry logic.
    const nMonths = 60
    const startDate = '2015-01'
    const returnMatrix: number[][] = Array.from({ length: nMonths }, () => [0.01])
    const components: BootstrapComponent[] = [
      { weight: 0.4, centerMonth: '2015-03', stdMonths: 1 },
    ]

    const rng = alea('retry-test')
    const result = sampleAnnualReturns(returnMatrix, nMonths, components, rng, 10, startDate)

    // All years should produce finite returns (no out-of-bounds access)
    for (const year of result) {
      expect(year[0]).toBeDefined()
      expect(Number.isFinite(year[0])).toBe(true)
    }
  })
})
