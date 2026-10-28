import { describe, it, expect } from 'vitest'
import { alea } from 'seedrandom'
import { cholesky, lognormalParams, portfolioMoments, realReturnSampler } from '../returns'

describe('cholesky', () => {
  it('reproduces the matrix as L·Lᵀ', () => {
    const m = [
      [1, 0.8, 0.1],
      [0.8, 1, 0.2],
      [0.1, 0.2, 1],
    ]
    const L = cholesky(m)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0
        for (let k = 0; k < 3; k++) s += L[i]![k]! * L[j]![k]!
        expect(s).toBeCloseTo(m[i]![j]!, 12)
      }
    }
  })

  it('accepts the singular matrix of a perfectly correlated duplicate', () => {
    const L = cholesky([
      [1, 1],
      [1, 1],
    ])
    expect(L).toEqual([
      [1, 0],
      [1, 0],
    ])
  })

  it('rejects a matrix that is not positive semi-definite', () => {
    const m = [
      [1, -0.9, -0.9],
      [-0.9, 1, -0.9],
      [-0.9, -0.9, 1],
    ]
    expect(() => cholesky(m)).toThrow(/semi-definite/)
  })
})

describe('lognormalParams', () => {
  it('has no spread at zero volatility, and the log of the gross return as mean', () => {
    const p = lognormalParams(0.05, 0)
    expect(p.sigma).toBe(0)
    expect(p.mu).toBeCloseTo(Math.log(1.05), 12)
  })

  it('reproduces the stated arithmetic mean and volatility', () => {
    const { mu, sigma } = lognormalParams(0.06, 0.17)
    const mean = Math.exp(mu + (sigma * sigma) / 2) - 1
    const variance = (Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma)
    expect(mean).toBeCloseTo(0.06, 12)
    expect(Math.sqrt(variance)).toBeCloseTo(0.17, 12)
  })
})

describe('realReturnSampler', () => {
  const assets = [
    { name: 'A', weight: 0.5, expectedReturn: 0.06, volatility: 0.17 },
    { name: 'B', weight: 0.5, expectedReturn: 0.01, volatility: 0.07 },
  ]
  const corr = [
    [1, 0.5],
    [0.5, 1],
  ]

  it('matches the stated means, volatilities and correlation over many draws', () => {
    const sample = realReturnSampler(assets, corr)
    const rng = alea('moments')
    const n = 200_000
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < n; i++) {
      const [a, b] = sample(rng)
      xs.push(a!)
      ys.push(b!)
    }
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
    const mx = mean(xs)
    const my = mean(ys)
    let sxx = 0
    let syy = 0
    let sxy = 0
    for (let i = 0; i < n; i++) {
      sxx += (xs[i]! - mx) ** 2
      syy += (ys[i]! - my) ** 2
      sxy += (xs[i]! - mx) * (ys[i]! - my)
    }
    expect(mx).toBeCloseTo(0.06, 2)
    expect(my).toBeCloseTo(0.01, 2)
    expect(Math.sqrt(sxx / n)).toBeCloseTo(0.17, 2)
    expect(Math.sqrt(syy / n)).toBeCloseTo(0.07, 2)
    // The correlation of the arithmetic returns sits a little under the 0.5
    // asked for on the underlying normals; see realReturnSampler.
    expect(sxy / Math.sqrt(sxx * syy)).toBeGreaterThan(0.45)
    expect(sxy / Math.sqrt(sxx * syy)).toBeLessThan(0.5)
  })

  it('never returns less than -100%', () => {
    const sample = realReturnSampler(
      [{ name: 'A', weight: 1, expectedReturn: 0.02, volatility: 0.9 }],
      [[1]],
    )
    const rng = alea('floor')
    for (let i = 0; i < 20_000; i++) expect(sample(rng)[0]!).toBeGreaterThan(-1)
  })
})

describe('portfolioMoments', () => {
  it('accounts for correlation in the variance', () => {
    const assets = [
      { name: 'A', weight: 0.5, expectedReturn: 0.06, volatility: 0.2 },
      { name: 'B', weight: 0.5, expectedReturn: 0.02, volatility: 0.2 },
    ]
    const independent = portfolioMoments(assets, [
      [1, 0],
      [0, 1],
    ])
    expect(independent.mean).toBeCloseTo(0.04, 12)
    expect(independent.variance).toBeCloseTo(0.02, 12)
    const perfect = portfolioMoments(assets, [
      [1, 1],
      [1, 1],
    ])
    expect(perfect.variance).toBeCloseTo(0.04, 12)
  })
})
