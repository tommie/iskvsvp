import type { SimulationAsset } from './types'

/**
 * Lower-triangular Cholesky factor L of a symmetric positive semi-definite
 * matrix, so that L·Lᵀ = matrix.
 *
 * Semi-definite is accepted because the same asset class held twice is
 * perfectly correlated with itself, which is a legitimate portfolio. A matrix
 * that is genuinely indefinite throws: a hand-edited one easily is (three
 * assets pairwise at -0.9 cannot exist), and silently repairing it would
 * produce a portfolio the user did not describe.
 */
export function cholesky(matrix: number[][]): number[][] {
  const n = matrix.length
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i]![j]!
      for (let k = 0; k < j; k++) sum -= L[i]![k]! * L[j]![k]!
      if (i === j) {
        if (sum < -1e-9) {
          throw new Error('The correlation matrix is not positive semi-definite.')
        }
        L[i]![i] = sum > 1e-12 ? Math.sqrt(sum) : 0
      } else {
        // A zero pivot means asset j adds nothing beyond those before it.
        L[i]![j] = L[j]![j]! > 0 ? sum / L[j]![j]! : 0
      }
    }
  }
  return L
}

/**
 * Parameters of the log-return of one asset whose *arithmetic* annual return
 * has the given mean and standard deviation: gross return G = exp(mu + sigma·Z).
 *
 * Lognormal rather than normal because a normal return can fall below -100%,
 * and the arithmetic mean is what the asset catalogue states, so the variance
 * drag is applied by the model rather than baked into the input.
 */
export function lognormalParams(mean: number, volatility: number): { mu: number; sigma: number } {
  const gross = 1 + mean
  if (gross <= 0) throw new Error('An expected return of -100% or lower is not modelled.')
  const sigma2 = Math.log(1 + (volatility * volatility) / (gross * gross))
  return { mu: Math.log(gross) - sigma2 / 2, sigma: Math.sqrt(sigma2) }
}

/** Box-Muller standard normal draw. */
export function standardNormal(rng: () => number): number {
  const u1 = rng() || Number.MIN_VALUE
  const u2 = rng()
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
}

/**
 * Prepare annual return sampling for a portfolio of assets. The returned
 * function draws one year of *real* returns per asset, correlated through the
 * given matrix of correlations between the assets' log-returns.
 *
 * The correlations are applied to the underlying normals, which for
 * lognormal marginals differ from the correlations of the arithmetic returns
 * by a fraction of a point at the volatilities used here.
 */
export function realReturnSampler(
  assets: SimulationAsset[],
  correlations: number[][],
): (rng: () => number) => number[] {
  const L = cholesky(correlations)
  const marginals = assets.map((a) => lognormalParams(a.expectedReturn, a.volatility))
  const n = assets.length
  const z = new Array<number>(n)
  return (rng) => {
    for (let i = 0; i < n; i++) z[i] = standardNormal(rng)
    const out = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      let corr = 0
      for (let k = 0; k <= i; k++) corr += L[i]![k]! * z[k]!
      out[i] = Math.exp(marginals[i]!.mu + marginals[i]!.sigma * corr) - 1
    }
    return out
  }
}

/**
 * Arithmetic mean and variance of the annual real return of a portfolio held
 * at the assets' weights, with the correlations accounted for.
 */
export function portfolioMoments(
  assets: SimulationAsset[],
  correlations: number[][],
): { mean: number; variance: number } {
  let mean = 0
  let variance = 0
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i]!
    mean += a.weight * a.expectedReturn
    for (let j = 0; j < assets.length; j++) {
      const b = assets[j]!
      variance += a.weight * b.weight * a.volatility * b.volatility * correlations[i]![j]!
    }
  }
  return { mean, variance }
}
