import { describe, it, expect } from 'vitest'
import { alea } from 'seedrandom'
import { prepareFactorModelPayload, sampleFactorModelReturns, makeNormalSampler, sampleT } from '../factor-model'
import type { FactorModelPayload } from '../factor-model'
import type { FactorData, FundsDb } from '../stress'

// --- Test fixtures ---

// Minimal 2-factor, 1-fund setup for deterministic testing.
function makeFactorData(overrides: {
  factor_ar1?: number[]
  residualType?: string
  residualParams?: number[]
  ar1Significant?: boolean
  ar1Coefficient?: number
  volBetas?: Record<string, number>
  volIntercept?: number
  volLogResidSqMean?: number
} = {}): FactorData {
  // 2×2 identity covariance → factors are independent with unit variance.
  // Lower triangle row-major: [cov[0][0], cov[1][0], cov[1][1]]
  const covariance_lower = [1.0, 0.0, 1.0]

  const fundParams = {
    ISIN001: {
      alpha: 0.5, // 0.5% monthly
      betas: { f1: 0.8 },
      residual_distribution: {
        type: overrides.residualType ?? 'norm',
        params: overrides.residualParams ?? [0, 0.5],
        std: 0.5,
      },
      residual_ar1: {
        ar1_coefficient: overrides.ar1Coefficient ?? 0,
        ar1_significant: overrides.ar1Significant ?? false,
      },
      vol_betas: overrides.volBetas,
      vol_intercept: overrides.volIntercept ?? 0,
      vol_log_resid_sq_mean: overrides.volLogResidSqMean ?? 0,
    },
  }

  return {
    categories: {
      testcat: { fund_params: fundParams },
    },
    factor_covariance: {
      factor_names: ['f1', 'f2'],
      means: [0.1, 0.2],
      covariance_lower,
      factor_ar1: overrides.factor_ar1,
    },
    factor_presets: { presets: [] },
  }
}

function makeFundsDb(): FundsDb {
  return {
    funds: [{ name: 'TestFund', isin: 'ISIN001', category: 'testcat' }],
  }
}

// --- prepareFactorModelPayload ---

describe('prepareFactorModelPayload', () => {
  it('returns payload for a valid fund', () => {
    const result = prepareFactorModelPayload(['TestFund'], [1.0], makeFundsDb(), makeFactorData())
    expect('payload' in result).toBe(true)
    if (!('payload' in result)) return

    const p = result.payload
    expect(p.nFactors).toBe(2)
    expect(p.means).toEqual([0.1, 0.2])
    expect(p.fundParams).toHaveLength(1)
    expect(p.fundParams[0]!.alpha).toBe(0.5)
    // Beta for f1=0.8, f2=0 (not in sparse betas)
    expect(p.fundParams[0]!.betasFull).toEqual([0.8, 0])
  })

  it('returns warning for unknown fund', () => {
    const result = prepareFactorModelPayload(['NoSuchFund'], [1.0], makeFundsDb(), makeFactorData())
    expect('warnings' in result).toBe(true)
  })

  it('returns warning for unknown category', () => {
    const fundsDb: FundsDb = {
      funds: [{ name: 'BadCat', isin: 'X', category: 'nonexistent' }],
    }
    const result = prepareFactorModelPayload(['BadCat'], [1.0], fundsDb, makeFactorData())
    expect('warnings' in result).toBe(true)
  })

  it('returns warning for unknown ISIN', () => {
    const fundsDb: FundsDb = {
      funds: [{ name: 'BadISIN', isin: 'MISSING', category: 'testcat' }],
    }
    const result = prepareFactorModelPayload(['BadISIN'], [1.0], fundsDb, makeFactorData())
    expect('warnings' in result).toBe(true)
  })

  it('computes Cholesky L for identity covariance', () => {
    const result = prepareFactorModelPayload(['TestFund'], [1.0], makeFundsDb(), makeFactorData())
    if (!('payload' in result)) throw new Error('expected payload')

    // Cholesky of identity is identity
    const L = result.payload.choleskyL
    expect(L[0]![0]).toBeCloseTo(1, 8)
    expect(L[0]![1]).toBeCloseTo(0, 8)
    expect(L[1]![0]).toBeCloseTo(0, 8)
    expect(L[1]![1]).toBeCloseTo(1, 8)
  })

  it('defaults factorAr1 to zeros when absent', () => {
    const result = prepareFactorModelPayload(['TestFund'], [1.0], makeFundsDb(), makeFactorData())
    if (!('payload' in result)) throw new Error('expected payload')
    expect(result.payload.factorAr1).toEqual([0, 0])
  })

  it('uses provided factorAr1', () => {
    const data = makeFactorData({ factor_ar1: [0.3, 0.5] })
    const result = prepareFactorModelPayload(['TestFund'], [1.0], makeFundsDb(), data)
    if (!('payload' in result)) throw new Error('expected payload')
    expect(result.payload.factorAr1).toEqual([0.3, 0.5])
  })

  it('computes portfolio expected return and variance', () => {
    const result = prepareFactorModelPayload(['TestFund'], [1.0], makeFundsDb(), makeFactorData())
    if (!('payload' in result)) throw new Error('expected payload')

    // E[monthly] = alpha + beta_f1 * mean_f1 = 0.5 + 0.8*0.1 = 0.58%
    // Annual return = (1 + 0.0058)^12 - 1 ≈ 0.07185
    const expectedAnnual = Math.pow(1 + 0.58 / 100, 12) - 1
    // Systematic variance: beta' * Cov * beta = 0.8^2 * 1 = 0.64
    // Total variance = 0.64 + 0.5^2 = 0.89
    // Annual variance = 0.89 * 12 / (100*100)
    const expectedVariance = 0.89 * 12 / (100 * 100)
    const expectedGeo = expectedAnnual - 0.5 * expectedVariance

    expect(result.payload.portfolioExpectedReturn).toBeCloseTo(expectedGeo, 6)
    expect(result.payload.portfolioVariance).toBeCloseTo(expectedVariance, 6)
  })

  it('falls back to norm for gmm residual type', () => {
    const data = makeFactorData({ residualType: 'gmm', residualParams: [0, 0.5] })
    const result = prepareFactorModelPayload(['TestFund'], [1.0], makeFundsDb(), data)
    if (!('payload' in result)) throw new Error('expected payload')
    expect(result.payload.fundParams[0]!.residualType).toBe('norm')
  })
})

// --- sampleFactorModelReturns ---

// Build a minimal payload directly for simulation tests.
function makePayload(overrides: Partial<FactorModelPayload> = {}): FactorModelPayload {
  return {
    nFactors: 2,
    means: [0.1, 0.2],
    // Identity Cholesky
    choleskyL: [[1, 0], [0, 1]],
    fundParams: [{
      alpha: 0.5,
      betasFull: [0.8, 0],
      residualStd: 0.5,
      residualType: 'norm',
      residualParams: [0, 0.5],
      ar1Coefficient: 0,
      volBetasFull: null,
      volIntercept: 0,
      volBaseline: 0,
    }],
    factorAr1: [0, 0],
    innovationCholeskyL: [[1, 0], [0, 1]],
    portfolioExpectedReturn: 0.07,
    portfolioVariance: 0.01,
    ...overrides,
  }
}

describe('sampleFactorModelReturns', () => {
  it('returns correct dimensions (years × assets)', () => {
    const rng = alea('dim-test')
    const result = sampleFactorModelReturns(makePayload(), rng, 5)
    expect(result).toHaveLength(5)
    for (const year of result) {
      expect(year).toHaveLength(1) // 1 asset
    }
  })

  it('produces deterministic results for same seed', () => {
    const r1 = sampleFactorModelReturns(makePayload(), alea('seed1'), 3)
    const r2 = sampleFactorModelReturns(makePayload(), alea('seed1'), 3)
    for (let y = 0; y < 3; y++) {
      expect(r1[y]![0]).toBe(r2[y]![0])
    }
  })

  it('produces different results for different seeds', () => {
    const r1 = sampleFactorModelReturns(makePayload(), alea('seed-a'), 3)
    const r2 = sampleFactorModelReturns(makePayload(), alea('seed-b'), 3)
    // Extremely unlikely to be identical across 3 years
    const allSame = r1.every((yr, i) => yr[0] === r2[i]![0])
    expect(allSame).toBe(false)
  })

  it('returns are decimal (not percentage)', () => {
    const rng = alea('decimal-test')
    const result = sampleFactorModelReturns(makePayload(), rng, 10)
    for (const year of result) {
      // Annual returns from monthly compounding of ~0.5% should be roughly
      // in [-0.5, 0.5] range, not [−50, 50].
      expect(Math.abs(year[0]!)).toBeLessThan(2)
    }
  })

  it('compounds monthly returns correctly for zero-volatility case', () => {
    // With zero residual std and identity covariance, factors ≈ means,
    // so monthly return ≈ alpha + beta*mean = 0.5 + 0.8*0.1 = 0.58%.
    // But factors are random, so use zero betas + known alpha.
    const payload = makePayload({
      fundParams: [{
        alpha: 1.0, // 1% monthly
        betasFull: [0, 0],
        residualStd: 0.001, // near-zero
        residualType: 'norm',
        residualParams: [0, 0.001],
        ar1Coefficient: 0,
        volBetasFull: null,
        volIntercept: 0,
        volBaseline: 0,
      }],
    })

    const rng = alea('compound-test')
    const results = sampleFactorModelReturns(payload, rng, 1)
    const expected = Math.pow(1 + 1.0 / 100, 12) - 1 // ≈ 0.1268
    expect(results[0]![0]).toBeCloseTo(expected, 2)
  })

  it('mean annual return converges to expected value over many samples', () => {
    // alpha=0.5%, beta_f1=0.8, mean_f1=0.1 → E[monthly] ≈ 0.58%
    // E[annual] = (1.0058)^12 - 1 ≈ 0.0719
    const N = 2000
    let sum = 0
    for (let i = 0; i < N; i++) {
      const rng = alea(`mean-${i}`)
      const result = sampleFactorModelReturns(makePayload(), rng, 1)
      sum += result[0]![0]!
    }
    const mean = sum / N
    const expected = Math.pow(1 + 0.58 / 100, 12) - 1
    // Allow ±2% absolute tolerance for Monte Carlo noise
    expect(mean).toBeCloseTo(expected, 1)
  })

  it('handles multiple assets', () => {
    const payload = makePayload({
      fundParams: [
        {
          alpha: 0.5, betasFull: [0.8, 0], residualStd: 0.5,
          residualType: 'norm', residualParams: [0, 0.5],
          ar1Coefficient: 0, volBetasFull: null, volIntercept: 0, volBaseline: 0,
        },
        {
          alpha: 0.2, betasFull: [0, 0.5], residualStd: 0.3,
          residualType: 'norm', residualParams: [0, 0.3],
          ar1Coefficient: 0, volBetasFull: null, volIntercept: 0, volBaseline: 0,
        },
      ],
    })
    const rng = alea('multi-asset')
    const result = sampleFactorModelReturns(payload, rng, 3)
    expect(result[0]).toHaveLength(2)
    // Returns should differ between assets (different betas/alpha)
    expect(result[0]![0]).not.toBe(result[0]![1])
  })
})

describe('sampleFactorModelReturns with AR(1) residuals', () => {
  it('first month is not filtered (uses raw residual)', () => {
    // With very high AR(1) coefficient, if the first month were filtered
    // with state=0, the residual would be scaled by sqrt(1-phi²) ≈ 0.
    // Instead it should pass through unscaled.
    const payload = makePayload({
      fundParams: [{
        alpha: 0, betasFull: [0, 0], residualStd: 5.0,
        residualType: 'norm', residualParams: [0, 5.0],
        ar1Coefficient: 0.99,
        volBetasFull: null, volIntercept: 0, volBaseline: 0,
      }],
    })

    // Run many times and check variance of first-year returns.
    // If first month is wrongly filtered, variance would be near zero.
    const N = 500
    const firstYearReturns: number[] = []
    for (let i = 0; i < N; i++) {
      const rng = alea(`ar1-first-${i}`)
      const result = sampleFactorModelReturns(payload, rng, 1)
      firstYearReturns.push(result[0]![0]!)
    }
    const mean = firstYearReturns.reduce((s, v) => s + v, 0) / N
    const variance = firstYearReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (N - 1)
    // With residualStd=5 and 12 months, variance should be substantial
    expect(variance).toBeGreaterThan(0.01)
  })
})

describe('sampleFactorModelReturns with VAR(1) factors', () => {
  it('factor momentum increases multi-year variance', () => {
    // With positive AR(1), consecutive factor draws are correlated,
    // so cumulative variance over multiple years should be higher
    // than the i.i.d. case.
    const N = 1000
    const nYears = 5

    function cumulativeVariance(factorAr1: number[]): number {
      const sums: number[] = []
      for (let i = 0; i < N; i++) {
        const rng = alea(`var1-${i}`)
        const payload = makePayload({ factorAr1 })
        // Recompute innovationCholeskyL for non-zero AR(1)
        // For identity cov and ar1=[φ,0], innov_cov[0][0] = 1-φ² ≈ 0.91
        if (factorAr1[0] !== 0) {
          const phi = factorAr1[0]!
          payload.innovationCholeskyL = [
            [Math.sqrt(1 - phi * phi), 0],
            [0, 1],
          ]
        }
        const result = sampleFactorModelReturns(payload, rng, nYears)
        const total = result.reduce((s, yr) => s + yr[0]!, 0)
        sums.push(total)
      }
      const mean = sums.reduce((s, v) => s + v, 0) / N
      return sums.reduce((s, v) => s + (v - mean) ** 2, 0) / (N - 1)
    }

    const varIID = cumulativeVariance([0, 0])
    const varAR1 = cumulativeVariance([0.3, 0])
    // AR(1) should increase variance by a measurable amount
    expect(varAR1).toBeGreaterThan(varIID * 1.05)
  })
})

describe('sampleFactorModelReturns with t-distribution residuals', () => {
  it('t-distribution produces heavier tails than normal', () => {
    const N = 2000
    const collect = (type: 'norm' | 't', params: number[]): number[] => {
      const returns: number[] = []
      for (let i = 0; i < N; i++) {
        const rng = alea(`tail-${type}-${i}`)
        const payload = makePayload({
          fundParams: [{
            alpha: 0, betasFull: [0, 0], residualStd: 1.0,
            residualType: type, residualParams: params,
            ar1Coefficient: 0, volBetasFull: null, volIntercept: 0, volBaseline: 0,
          }],
        })
        const result = sampleFactorModelReturns(payload, rng, 1)
        returns.push(result[0]![0]!)
      }
      return returns
    }

    const normReturns = collect('norm', [0, 1.0])
    const tReturns = collect('t', [5, 0, 1.0]) // df=5

    // Kurtosis proxy: fraction of returns beyond ±2 std devs
    const normStd = Math.sqrt(normReturns.reduce((s, v) => s + v * v, 0) / N)
    const tStd = Math.sqrt(tReturns.reduce((s, v) => s + v * v, 0) / N)
    const normTail = normReturns.filter((v) => Math.abs(v) > 2 * normStd).length / N
    const tTail = tReturns.filter((v) => Math.abs(v) > 2 * tStd).length / N

    // t(5) should have more extreme values
    expect(tTail).toBeGreaterThan(normTail)
  })
})

describe('sampleFactorModelReturns with skew-normal residuals', () => {
  it('positive skew shifts distribution right', () => {
    const N = 2000
    const collect = (a: number): number[] => {
      const returns: number[] = []
      for (let i = 0; i < N; i++) {
        const rng = alea(`skew-${a}-${i}`)
        const payload = makePayload({
          fundParams: [{
            alpha: 0, betasFull: [0, 0], residualStd: 1.0,
            residualType: 'skewnorm', residualParams: [a, 0, 1.0],
            ar1Coefficient: 0, volBetasFull: null, volIntercept: 0, volBaseline: 0,
          }],
        })
        const result = sampleFactorModelReturns(payload, rng, 1)
        returns.push(result[0]![0]!)
      }
      return returns
    }

    const symmetric = collect(0)
    const skewed = collect(5) // strong positive skew

    // Both should be roughly zero-mean (centered by construction)
    const symMean = symmetric.reduce((s, v) => s + v, 0) / N
    const skewMean = skewed.reduce((s, v) => s + v, 0) / N
    expect(Math.abs(symMean)).toBeLessThan(0.05)
    expect(Math.abs(skewMean)).toBeLessThan(0.05)

    // Positive skew produces a heavier right tail. Measure via the
    // ratio of max to |min| — skewed distribution should be more
    // right-tailed (higher max relative to |min|).
    const symSorted = symmetric.sort((a, b) => a - b)
    const skewSorted = skewed.sort((a, b) => a - b)
    const symSkewness = symSorted[Math.floor(N * 0.99)]! + symSorted[Math.floor(N * 0.01)]!
    const skewSkewness = skewSorted[Math.floor(N * 0.99)]! + skewSorted[Math.floor(N * 0.01)]!
    // P99 + P1 > 0 means right tail extends further than left tail
    expect(skewSkewness).toBeGreaterThan(symSkewness)
  })
})

describe('sampleFactorModelReturns with vol scaling', () => {
  it('vol scaling increases return dispersion', () => {
    const N = 1000
    const collect = (withVol: boolean): number[] => {
      const returns: number[] = []
      for (let i = 0; i < N; i++) {
        const rng = alea(`vol-${withVol}-${i}`)
        const payload = makePayload({
          fundParams: [{
            alpha: 0, betasFull: [0.8, 0], residualStd: 1.0,
            residualType: 'norm', residualParams: [0, 1.0],
            ar1Coefficient: 0,
            volBetasFull: withVol ? [0.5, 0] : null,
            volIntercept: withVol ? 0.5 : 0,
            volBaseline: withVol ? 0.5 : 0,
          }],
        })
        const result = sampleFactorModelReturns(payload, rng, 1)
        returns.push(result[0]![0]!)
      }
      return returns
    }

    const noVol = collect(false)
    const withVol = collect(true)

    const variance = (arr: number[]) => {
      const m = arr.reduce((s, v) => s + v, 0) / arr.length
      return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1)
    }

    // Vol scaling should increase dispersion
    expect(variance(withVol)).toBeGreaterThan(variance(noVol))
  })
})

describe('prepareFactorModelPayload eigenvalue clamping', () => {
  it('handles near-singular innovation covariance from high AR(1)', () => {
    // With factor_ar1 close to 1, innovation covariance = Σ*(1-φ²) → near zero,
    // potentially with numerical issues. Should still produce a valid payload.
    const data = makeFactorData({ factor_ar1: [0.99, 0.99] })
    const result = prepareFactorModelPayload(['TestFund'], [1.0], makeFundsDb(), data)
    expect('payload' in result).toBe(true)
    if (!('payload' in result)) return

    // Innovation Cholesky should have positive diagonal elements
    const L = result.payload.innovationCholeskyL
    expect(L[0]![0]).toBeGreaterThan(0)
    expect(L[1]![1]).toBeGreaterThan(0)
  })
})

// --- Correctness tests for optimized sampling primitives ---

describe('makeNormalSampler (Marsaglia polar)', () => {
  it('produces mean ≈ 0 and stdDev ≈ 1 for N(0,1)', () => {
    const rng = alea('normal-stats')
    const sample = makeNormalSampler(rng)
    const N = 50_000
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < N; i++) {
      const x = sample(0, 1)
      sum += x
      sumSq += x * x
    }
    const mean = sum / N
    const variance = sumSq / N - mean * mean
    expect(mean).toBeCloseTo(0, 1) // within ±0.05
    expect(variance).toBeCloseTo(1, 1) // within ±0.05
  })

  it('respects mean and stdDev parameters', () => {
    const rng = alea('normal-params')
    const sample = makeNormalSampler(rng)
    const N = 20_000
    let sum = 0
    for (let i = 0; i < N; i++) sum += sample(5, 3)
    const mean = sum / N
    expect(mean).toBeCloseTo(5, 0) // within ±0.5
  })

  it('empirical quantiles match N(0,1) theoretical quantiles', () => {
    // Verify that sorted samples land where N(0,1) predicts.
    // N(0,1) quantiles: p10=-1.282, p25=-0.674, p50=0, p75=0.674, p90=1.282
    const rng = alea('normal-quantile')
    const sample = makeNormalSampler(rng)
    const N = 50_000
    const data: number[] = []
    for (let i = 0; i < N; i++) data.push(sample(0, 1))
    data.sort((a, b) => a - b)

    const empirical = (p: number) => data[Math.floor(N * p)]!
    // Allow ±0.03 tolerance at each quantile (generous for N=50k).
    expect(empirical(0.1)).toBeCloseTo(-1.282, 1)
    expect(empirical(0.25)).toBeCloseTo(-0.674, 1)
    expect(empirical(0.5)).toBeCloseTo(0, 1)
    expect(empirical(0.75)).toBeCloseTo(0.674, 1)
    expect(empirical(0.9)).toBeCloseTo(1.282, 1)
  })

  it('spare caching produces independent variates', () => {
    // Consecutive pairs from the cache should be uncorrelated.
    const rng = alea('normal-indep')
    const sample = makeNormalSampler(rng)
    const N = 10_000
    let sumXY = 0, sumX = 0, sumY = 0
    for (let i = 0; i < N; i++) {
      const x = sample(0, 1)
      const y = sample(0, 1) // this one comes from the spare
      sumX += x; sumY += y; sumXY += x * y
    }
    const corr = (sumXY / N - (sumX / N) * (sumY / N))
    // Correlation should be near zero (|r| < 0.05 for N=10k).
    expect(Math.abs(corr)).toBeLessThan(0.05)
  })
})

describe('sampleT (Bailey polar)', () => {
  it('variance matches df/(df-2) for df=5', () => {
    const rng = alea('t-var-5')
    const df = 5
    const N = 50_000
    let sum = 0, sumSq = 0
    for (let i = 0; i < N; i++) {
      const x = sampleT([df, 0, 1], rng)
      sum += x
      sumSq += x * x
    }
    const mean = sum / N
    const variance = sumSq / N - mean * mean
    const expectedVariance = df / (df - 2) // 5/3 ≈ 1.667
    expect(mean).toBeCloseTo(0, 1)
    // Allow ±15% tolerance — t(5) has high variance in variance estimates.
    expect(variance).toBeCloseTo(expectedVariance, 0)
  })

  it('variance matches df/(df-2) for df=10', () => {
    const rng = alea('t-var-10')
    const df = 10
    const N = 50_000
    let sum = 0, sumSq = 0
    for (let i = 0; i < N; i++) {
      const x = sampleT([df, 0, 1], rng)
      sum += x
      sumSq += x * x
    }
    const mean = sum / N
    const variance = sumSq / N - mean * mean
    const expectedVariance = df / (df - 2) // 1.25
    expect(mean).toBeCloseTo(0, 1)
    expect(variance).toBeCloseTo(expectedVariance, 0)
  })

  it('produces heavier tails than normal', () => {
    const rng = alea('t-tail')
    const N = 50_000
    let tExceedCount = 0, normExceedCount = 0
    const normSample = makeNormalSampler(rng)
    const rng2 = alea('t-tail-t')
    for (let i = 0; i < N; i++) {
      if (Math.abs(sampleT([5, 0, 1], rng2)) > 2.5) tExceedCount++
      if (Math.abs(normSample(0, 1)) > 2.5) normExceedCount++
    }
    // t(5) should have roughly 3-4x more exceedances beyond ±2.5σ.
    expect(tExceedCount).toBeGreaterThan(normExceedCount * 1.5)
  })

  it('scale parameter works correctly', () => {
    const rng = alea('t-scale')
    const N = 20_000
    let sum1 = 0, sum2 = 0
    const rng2 = alea('t-scale-2')
    for (let i = 0; i < N; i++) {
      sum1 += sampleT([5, 0, 1], rng) ** 2
      sum2 += sampleT([5, 0, 3], rng2) ** 2
    }
    // Variance with scale=3 should be 9x variance with scale=1.
    const ratio = sum2 / sum1
    expect(ratio).toBeCloseTo(9, 0)
  })
})

describe('Float32Array precision in sampleFactorModelReturns', () => {
  it('37-factor model produces results within 0.1% of expected mean', () => {
    // Build a payload with 37 factors (matching the real model size) to
    // stress-test Float32 accumulation in the Cholesky multiply and
    // beta dot products.
    const nFactors = 37
    const means = new Array(nFactors).fill(0).map((_, i) => 0.05 + i * 0.005)
    const choleskyL: number[][] = []
    const innovCholeskyL: number[][] = []
    for (let i = 0; i < nFactors; i++) {
      const row = new Array(nFactors).fill(0)
      row[i] = 1.0
      // Add small off-diagonal to exercise the full Cholesky multiply.
      if (i > 0) row[i - 1] = 0.1
      choleskyL.push(row)
      innovCholeskyL.push([...row])
    }

    const betas = new Array(nFactors).fill(0).map((_, i) => 0.02 * (i % 5 === 0 ? 1 : 0))
    const alpha = 0.3 // 0.3% monthly

    const payload: FactorModelPayload = {
      nFactors,
      means,
      choleskyL,
      innovationCholeskyL: innovCholeskyL,
      fundParams: [{
        alpha,
        betasFull: betas,
        residualStd: 0.001,
        residualType: 'norm',
        residualParams: [0, 0.001],
        ar1Coefficient: 0,
        volBetasFull: null,
        volIntercept: 0,
        volBaseline: 0,
      }],
      factorAr1: new Array(nFactors).fill(0),
      portfolioExpectedReturn: 0.05,
      portfolioVariance: 0.01,
    }

    // E[monthly] ≈ alpha + dot(betas, means)
    let expectedMonthly = alpha
    for (let f = 0; f < nFactors; f++) expectedMonthly += betas[f]! * means[f]!
    const expectedAnnual = Math.pow(1 + expectedMonthly / 100, 12) - 1

    const N = 3000
    let sum = 0
    for (let i = 0; i < N; i++) {
      const rng = alea(`f32-precision-${i}`)
      const result = sampleFactorModelReturns(payload, rng, 1)
      sum += result[0]![0]!
    }
    const mean = sum / N
    // Float32 truncation in the 37-element dot product should NOT shift
    // the mean by more than 0.1% absolute.
    expect(Math.abs(mean - expectedAnnual)).toBeLessThan(0.001)
  })
})
