/**
 * Factor model simulation: per-fund alpha+betas on correlated macro factors,
 * residual distributions (norm/t/skewnorm), heteroskedastic vol scaling,
 * and AR(1) filtering — all at monthly resolution, compounded to annual.
 *
 * Matches fundcmp's simulate_fund_returns() pipeline.
 *
 * Expected return note: the factor model's E[r] = alpha_ols + dot(betas, global_means)
 * uses the raw OLS intercept with global (full-history) factor means, so the
 * expected return reflects what the fund's factor exposures would have earned
 * over the full factor history (~275 months), not just the fund's own training
 * window.
 */

import type { FactorData, FundsDb } from './stress'

export interface FundFactorParams {
  alpha: number
  betasFull: number[]           // Dense, length = nFactors
  residualStd: number
  residualType: 'norm' | 't' | 'skewnorm'
  residualParams: number[]      // norm: [loc, scale], t: [df, loc, scale], skewnorm: [a, loc, scale]
  ar1Coefficient: number        // 0 if not significant
  volBetasFull: number[] | null // Dense or null
  volIntercept: number
  volBaseline: number           // vol_log_resid_sq_mean
}

export interface FactorModelPayload {
  nFactors: number
  means: number[]               // Monthly factor means
  choleskyL: number[][]         // Lower-triangular Cholesky of covariance
  fundParams: FundFactorParams[]
  factorAr1: number[]              // Per-factor AR(1) coefficients
  innovationCholeskyL: number[][]  // Cholesky of innovation covariance
  // Pre-computed portfolio-level stats for CER in Merton's rule
  portfolioExpectedReturn: number  // Annualized expected return
  portfolioVariance: number        // Annualized variance
}

// --- Symmetric eigendecomposition (Jacobi rotation) ---

/**
 * Compute eigenvalues and eigenvectors of a symmetric matrix using
 * the cyclic Jacobi method. Returns { values, vectors } where
 * vectors[i] is the i-th column eigenvector.
 */
function symmetricEigen(A: number[][]): { values: number[]; vectors: number[][] } {
  const n = A.length
  // Work on a copy
  const S: number[][] = A.map((row) => [...row])
  // V accumulates rotations (starts as identity)
  const V: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0) as number[]
    row[i] = 1
    return row
  })

  const maxIter = 100
  const tol = 1e-12

  for (let iter = 0; iter < maxIter; iter++) {
    // Find max off-diagonal element
    let maxVal = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.abs(S[i]![j]!)
        if (v > maxVal) maxVal = v
      }
    }
    if (maxVal < tol) break

    // Sweep all off-diagonal pairs
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(S[p]![q]!) < tol) continue

        const tau = (S[q]![q]! - S[p]![p]!) / (2 * S[p]![q]!)
        const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau))
        const c = 1 / Math.sqrt(1 + t * t)
        const s = t * c

        // Rotate S
        const Spq = S[p]![q]!
        S[p]![p]! -= t * Spq
        S[q]![q]! += t * Spq
        S[p]![q] = 0
        S[q]![p] = 0

        for (let r = 0; r < n; r++) {
          if (r === p || r === q) continue
          const Srp = S[r]![p]!
          const Srq = S[r]![q]!
          S[r]![p] = c * Srp - s * Srq
          S[p]![r] = S[r]![p]!
          S[r]![q] = s * Srp + c * Srq
          S[q]![r] = S[r]![q]!
        }

        // Rotate V
        for (let r = 0; r < n; r++) {
          const Vrp = V[r]![p]!
          const Vrq = V[r]![q]!
          V[r]![p] = c * Vrp - s * Vrq
          V[r]![q] = s * Vrp + c * Vrq
        }
      }
    }
  }

  const values = new Array(n) as number[]
  for (let i = 0; i < n; i++) values[i] = S[i]![i]!
  return { values, vectors: V }
}

/**
 * Clamp eigenvalues to a minimum and reconstruct: V * diag(clamped) * V^T.
 * Ensures the result is positive semi-definite.
 */
function clampEigenvaluesPSD(matrix: number[][], minEig: number = 1e-8): number[][] {
  const n = matrix.length
  const { values, vectors } = symmetricEigen(matrix)

  // Clamp
  for (let i = 0; i < n; i++) {
    if (values[i]! < minEig) values[i] = minEig
  }

  // Reconstruct: V * diag(values) * V^T
  const result: number[][] = Array.from({ length: n }, () => new Array(n).fill(0) as number[])
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < n; k++) {
        sum += vectors[i]![k]! * values[k]! * vectors[j]![k]!
      }
      result[i]![j] = sum
      result[j]![i] = sum
    }
  }
  return result
}

// --- Cholesky decomposition ---

function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length
  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0
      for (let k = 0; k < j; k++) {
        sum += L[i]![k]! * L[j]![k]!
      }

      if (i === j) {
        L[i]![j] = Math.sqrt(matrix[i]![i]! - sum)
      } else {
        L[i]![j] = (matrix[i]![j]! - sum) / L[j]![j]!
      }
    }
  }

  return L
}

// --- Reconstruct full covariance from lower-triangle row-major ---

function reconstructCovariance(lower: number[], n: number): number[][] {
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
  let idx = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      const val = lower[idx++]!
      matrix[i]![j] = val
      matrix[j]![i] = val
    }
  }
  return matrix
}

// --- Expand sparse betas to dense array ---

function expandBetas(sparse: Record<string, number>, factorNames: string[]): number[] {
  const dense = new Array(factorNames.length).fill(0) as number[]
  for (const [name, value] of Object.entries(sparse)) {
    const idx = factorNames.indexOf(name)
    if (idx >= 0) {
      dense[idx] = value
    }
  }
  return dense
}

// --- Prepare payload ---

export function prepareFactorModelPayload(
  assetNames: string[],
  assetWeights: number[],
  fundsDb: FundsDb,
  factorData: FactorData,
): { payload: FactorModelPayload } | { warnings: string[] } {
  const warnings: string[] = []
  const factorNames = factorData.factor_covariance.factor_names
  const nFactors = factorNames.length
  const means = factorData.factor_covariance.means

  // Reconstruct and decompose covariance
  const cov = reconstructCovariance(factorData.factor_covariance.covariance_lower, nFactors)
  const choleskyL = choleskyDecomposition(cov)

  // Compute innovation covariance for VAR(1) factor model
  const ar1 = factorData.factor_covariance.factor_ar1 ?? new Array(nFactors).fill(0) as number[]
  // Innovation covariance: Σ_ε[i,j] = Σ[i,j] * (1 - φ_i * φ_j).
  // With sample estimates this can have small negative eigenvalues; clamp to PSD.
  const innovCovRaw = cov.map((row, i) => row.map((v, j) => v * (1 - ar1[i]! * ar1[j]!)))
  const innovCov = clampEigenvaluesPSD(innovCovRaw)
  const innovationCholeskyL = choleskyDecomposition(innovCov)

  const fundParams: FundFactorParams[] = []

  for (const assetName of assetNames) {
    const fund = fundsDb.funds.find((f) => f.name === assetName)
    if (!fund) {
      warnings.push(`${assetName}: saknas i fonddatabasen`)
      return { warnings }
    }

    const categoryData = factorData.categories[fund.category]
    if (!categoryData) {
      warnings.push(`${assetName}: kategori "${fund.category}" saknas i faktormodellen`)
      return { warnings }
    }

    const raw = categoryData.fund_params[fund.isin]
    if (!raw) {
      warnings.push(`${assetName}: ISIN ${fund.isin} saknas i faktormodellen`)
      return { warnings }
    }

    const betasFull = expandBetas(raw.betas, factorNames)

    // Determine residual type — fall back to norm for unsupported types (e.g. gmm)
    let residualType: 'norm' | 't' | 'skewnorm' = 'norm'
    if (raw.residual_distribution.type === 't' || raw.residual_distribution.type === 'skewnorm') {
      residualType = raw.residual_distribution.type
    }

    const volBetasFull = raw.vol_betas
      ? expandBetas(raw.vol_betas, factorNames)
      : null

    fundParams.push({
      alpha: raw.alpha,
      betasFull,
      residualStd: raw.residual_distribution.std,
      residualType,
      residualParams: raw.residual_distribution.params,
      ar1Coefficient: raw.residual_ar1.ar1_significant ? raw.residual_ar1.ar1_coefficient : 0,
      volBetasFull,
      volIntercept: raw.vol_intercept ?? 0,
      volBaseline: raw.vol_log_resid_sq_mean ?? 0,
    })
  }

  // Compute portfolio-level expected return and variance for Merton's rule
  // Monthly: E[r_asset] = alpha + dot(betas, means)
  // Annual geometric mean ≈ 12*monthly_mean - 0.5*annual_variance
  let portfolioMonthlyReturn = 0
  let portfolioMonthlyVariance = 0
  for (let a = 0; a < fundParams.length; a++) {
    const fp = fundParams[a]!
    const w = assetWeights[a] ?? 0
    // Expected monthly return for this fund
    let monthlyMean = fp.alpha
    for (let f = 0; f < nFactors; f++) {
      monthlyMean += fp.betasFull[f]! * means[f]!
    }
    portfolioMonthlyReturn += w * monthlyMean

    // Systematic variance: beta' * Cov * beta (only this fund's contribution, weighted)
    let sysVar = 0
    for (let f1 = 0; f1 < nFactors; f1++) {
      for (let f2 = 0; f2 < nFactors; f2++) {
        sysVar += fp.betasFull[f1]! * fp.betasFull[f2]! * cov[f1]![f2]!
      }
    }
    // Total variance = systematic + residual
    const totalVar = sysVar + fp.residualStd * fp.residualStd
    portfolioMonthlyVariance += w * w * totalVar
  }
  // Cross-asset covariance via factor model (systematic only)
  for (let a1 = 0; a1 < fundParams.length; a1++) {
    for (let a2 = a1 + 1; a2 < fundParams.length; a2++) {
      const fp1 = fundParams[a1]!
      const fp2 = fundParams[a2]!
      const w1 = assetWeights[a1] ?? 0
      const w2 = assetWeights[a2] ?? 0
      let crossCov = 0
      for (let f1 = 0; f1 < nFactors; f1++) {
        for (let f2 = 0; f2 < nFactors; f2++) {
          crossCov += fp1.betasFull[f1]! * fp2.betasFull[f2]! * cov[f1]![f2]!
        }
      }
      portfolioMonthlyVariance += 2 * w1 * w2 * crossCov
    }
  }

  // Annualize: monthly % to annual decimal
  const annualReturn = Math.pow(1 + portfolioMonthlyReturn / 100, 12) - 1
  const annualVariance = portfolioMonthlyVariance * 12 / (100 * 100)

  // Geometric mean approximation
  const portfolioGeometricReturn = annualReturn - 0.5 * annualVariance

  return {
    payload: {
      nFactors,
      means,
      choleskyL,
      fundParams,
      factorAr1: ar1,
      innovationCholeskyL,
      portfolioExpectedReturn: portfolioGeometricReturn,
      portfolioVariance: annualVariance,
    },
  }
}

// --- Random sampling utilities ---

/**
 * Normal variate generator using the Marsaglia polar method with spare
 * caching. Produces two variates per rejection loop, returns one and
 * caches the other. Avoids all trig (cos/sin) — uses only sqrt + log,
 * which are ~2-3x faster than trig on modern CPUs.
 *
 * Expected cost: ~1.27 uniform pairs (rejection rate π/4) + 1 log + 1 sqrt
 * per pair of normals, vs Box-Muller's 1 log + 1 sqrt + 1 cos + 1 sin.
 */
export function makeNormalSampler(rng: () => number): (mean: number, stdDev: number) => number {
  let hasSpare = false
  let spare = 0

  return (mean: number, stdDev: number): number => {
    if (hasSpare) {
      hasSpare = false
      return mean + spare * stdDev
    }
    // Marsaglia polar: sample (u,v) in unit disk, then scale.
    let u: number, v: number, s: number
    do {
      u = 2 * rng() - 1
      v = 2 * rng() - 1
      s = u * u + v * v
    } while (s >= 1 || s === 0)
    const f = Math.sqrt(-2.0 * Math.log(s) / s)
    spare = v * f
    hasSpare = true
    return mean + u * f * stdDev
  }
}

/**
 * Sample from Student's t-distribution using Bailey's polar method.
 * Needs ~1.27 uniform pairs on average (rejection when w > 1) plus
 * one sqrt and one pow — much cheaper than the previous O(df) normals
 * for the chi-squared denominator.
 *
 * Algorithm: generate (u,v) uniform in the unit disk, w = u² + v², then
 *   t = u * sqrt(df * (w^(-2/df) - 1) / w)
 * The /w term normalizes the directional component; without it the
 * variance is ν/(4(ν-1)) instead of the correct ν/(ν-2).
 * See Bailey, R.W. (1994) "Polar generation of random variates
 * with the t-distribution", Mathematics of Computation 62(206).
 * params: [df, loc, scale]
 */
export function sampleT(params: number[], rng: () => number): number {
  const df = params[0]!
  const scale = params[2]!

  if (df <= 0) {
    // Degenerate: fall back to standard normal (Marsaglia polar).
    let u0: number, v0: number, s0: number
    do { u0 = 2 * rng() - 1; v0 = 2 * rng() - 1; s0 = u0 * u0 + v0 * v0 } while (s0 >= 1 || s0 === 0)
    return u0 * Math.sqrt(-2.0 * Math.log(s0) / s0) * scale
  }

  const negTwoOverDf = -2 / df
  let u: number, v: number, w: number
  // Rejection loop: accept when (u,v) falls inside the unit disk.
  // Expected iterations: 4/π ≈ 1.27.
  do {
    u = 2 * rng() - 1
    v = 2 * rng() - 1
    w = u * u + v * v
  } while (w > 1 || w === 0)

  // Bailey's transform with the /w normalization.
  const t = u * Math.sqrt(df * (Math.pow(w, negTwoOverDf) - 1) / w)
  return t * scale
}

/**
 * Sample from skew-normal distribution.
 * params: [a, loc, scale] where a is the skewness parameter.
 * Uses the standard construction: if Z1,Z2 ~ N(0,1) independent,
 * then X = delta*|Z1| + sqrt(1-delta^2)*Z2 where delta = a/sqrt(1+a^2)
 */
function sampleSkewNorm(
  params: number[],
  randomNormal: (mean: number, stdDev: number) => number,
): number {
  const a = params[0]!
  const scale = params[2]!

  const delta = a / Math.sqrt(1 + a * a)
  const z1 = randomNormal(0, 1)
  const z2 = randomNormal(0, 1)
  const x = delta * Math.abs(z1) + Math.sqrt(1 - delta * delta) * z2

  // The skewnorm has a nonzero mean = delta * sqrt(2/pi).
  // Subtract it to center at zero (alpha captures the mean).
  const skewMean = delta * Math.sqrt(2 / Math.PI)
  return (x - skewMean) * scale
}

/**
 * Sample a zero-mean residual innovation from the fund's distribution.
 */
function sampleResidual(
  fp: FundFactorParams,
  rng: () => number,
  randomNormal: (mean: number, stdDev: number) => number,
): number {
  switch (fp.residualType) {
    case 't':
      return sampleT(fp.residualParams, rng)
    case 'skewnorm':
      return sampleSkewNorm(fp.residualParams, randomNormal)
    case 'norm':
    default:
      // Normal: params are [loc, scale]; use scale, center at zero
      return randomNormal(0, fp.residualParams[1] ?? fp.residualStd)
  }
}

// --- Main simulation ---

/**
 * Generate annual returns for all assets over nYears using the full factor model.
 * Returns number[][] (years × assets), each value is a decimal return (e.g. 0.10 for 10%).
 */
export function sampleFactorModelReturns(
  payload: FactorModelPayload,
  rng: () => number,
  nYears: number,
): number[][] {
  const { nFactors, means, fundParams, factorAr1, innovationCholeskyL, choleskyL } = payload
  const nAssets = fundParams.length
  const results: number[][] = []
  const randomNormal = makeNormalSampler(rng)

  // --- One-time flattening of jagged arrays into contiguous Float32Arrays ---
  // Eliminates pointer chasing and non-null assertions in the hot loop.

  // Flatten innovation Cholesky (lower triangular) to row-major 1D.
  // Access: innovFlat[f * nFactors + k] instead of innovationCholeskyL[f]![k]!
  const innovFlat = new Float32Array(nFactors * nFactors)
  for (let f = 0; f < nFactors; f++)
    for (let k = 0; k <= f; k++)
      innovFlat[f * nFactors + k] = innovationCholeskyL[f]![k]!

  // Flatten stationary Cholesky for the initial draw.
  const cholFlat = new Float32Array(nFactors * nFactors)
  for (let f = 0; f < nFactors; f++)
    for (let k = 0; k <= f; k++)
      cholFlat[f * nFactors + k] = choleskyL[f]![k]!

  // Factor means as typed array for consistent access.
  const meansF = new Float32Array(nFactors)
  for (let f = 0; f < nFactors; f++) meansF[f] = means[f]!

  // Factor AR(1) coefficients as typed array.
  const ar1F = new Float32Array(nFactors)
  for (let f = 0; f < nFactors; f++) ar1F[f] = factorAr1[f]!

  // Flatten all asset betas into a single contiguous array.
  // Access: allBetas[a * nFactors + f] instead of fundParams[a].betasFull[f]!
  const allBetas = new Float32Array(nAssets * nFactors)
  for (let a = 0; a < nAssets; a++)
    for (let f = 0; f < nFactors; f++)
      allBetas[a * nFactors + f] = fundParams[a]!.betasFull[f]!

  // Flatten vol betas for assets that have heteroskedastic vol.
  // For assets without vol betas, the row stays zero (unused).
  const hasVolBetas = new Uint8Array(nAssets)
  const allVolBetas = new Float32Array(nAssets * nFactors)
  for (let a = 0; a < nAssets; a++) {
    const vb = fundParams[a]!.volBetasFull
    if (vb) {
      hasVolBetas[a] = 1
      for (let f = 0; f < nFactors; f++)
        allVolBetas[a * nFactors + f] = vb[f]!
    }
  }

  // Pre-compute per-asset AR(1) sqrt(1 - phi^2) to avoid recomputing each month.
  const ar1Sqrt = new Float32Array(nAssets)
  const ar1Phi = new Float32Array(nAssets)
  for (let a = 0; a < nAssets; a++) {
    const phi = fundParams[a]!.ar1Coefficient
    ar1Phi[a] = phi
    ar1Sqrt[a] = Math.sqrt(1 - phi * phi)
  }

  // --- Pre-allocate reusable scratch arrays ---
  // Avoids ~432,000 array allocations per simulation batch (nYears * 12).
  const z = new Float32Array(nFactors)
  const factors = new Float32Array(nFactors)
  const monthlyProducts = new Float32Array(nAssets)

  // AR(1) residual state per asset (carries across months).
  // Initialized to NaN to signal that the first month should not be filtered
  // (matching Python which starts the AR(1) loop at t=1, leaving t=0 as-is).
  const ar1State = new Float32Array(nAssets)
  for (let a = 0; a < nAssets; a++) ar1State[a] = NaN

  // Initialize VAR(1) factor state from stationary distribution N(means, Σ)
  // so the first month doesn't start with a deterministic bias.
  const prevFactors = new Float32Array(nFactors)
  for (let f = 0; f < nFactors; f++) z[f] = randomNormal(0, 1)
  for (let f = 0; f < nFactors; f++) {
    let sum = 0
    const fRow = f * nFactors
    for (let k = 0; k <= f; k++) sum += cholFlat[fRow + k]! * z[k]!
    prevFactors[f] = meansF[f]! + sum
  }

  for (let year = 0; year < nYears; year++) {
    // Reset monthly compounding products to 1.
    for (let a = 0; a < nAssets; a++) monthlyProducts[a] = 1

    for (let month = 0; month < 12; month++) {
      // 1. Draw independent standard normals (reuse z).
      for (let f = 0; f < nFactors; f++) {
        z[f] = randomNormal(0, 1)
      }

      // 2. Transform to correlated innovations and apply VAR(1).
      // factors_t = means + ar1*(prev - means) + L_innov * z
      for (let f = 0; f < nFactors; f++) {
        let sum = 0
        const fRow = f * nFactors
        for (let k = 0; k <= f; k++) {
          sum += innovFlat[fRow + k]! * z[k]!
        }
        factors[f] = meansF[f]! + ar1F[f]! * (prevFactors[f]! - meansF[f]!) + sum
      }

      // Update state for next month.
      for (let f = 0; f < nFactors; f++) {
        prevFactors[f] = factors[f]!
      }

      // 3. For each asset, compute monthly return.
      for (let a = 0; a < nAssets; a++) {
        const fp = fundParams[a]!
        const aRow = a * nFactors

        // Systematic component: alpha + dot(betas, factors)
        let systematic = fp.alpha
        for (let f = 0; f < nFactors; f++) {
          systematic += allBetas[aRow + f]! * factors[f]!
        }

        // Sample residual innovation
        let eta = sampleResidual(fp, rng, randomNormal)

        // Heteroskedastic vol scaling
        if (hasVolBetas[a]) {
          let logVol = fp.volIntercept
          for (let f = 0; f < nFactors; f++) {
            logVol += allVolBetas[aRow + f]! * Math.abs(factors[f]!)
          }
          const scaleFactor = Math.min(Math.exp(0.5 * (logVol - fp.volBaseline)), 10.0)
          eta *= scaleFactor
        }

        // AR(1) filtering: ε_t = φ·ε_{t-1} + √(1-φ²)·η_t
        // First month uses raw eta (no prior state to filter from).
        if (ar1Phi[a] !== 0) {
          if (Number.isNaN(ar1State[a])) {
            ar1State[a] = eta
          } else {
            const epsilon = ar1Phi[a]! * ar1State[a]! + ar1Sqrt[a]! * eta
            ar1State[a] = epsilon
            eta = epsilon
          }
        }

        // Monthly return in %
        const monthlyReturn = systematic + eta
        monthlyProducts[a]! *= (1 + monthlyReturn / 100)
      }
    }

    // Compound to annual: product - 1 (as decimal, not %)
    const annualReturns = new Array(nAssets) as number[]
    for (let a = 0; a < nAssets; a++) {
      annualReturns[a] = monthlyProducts[a]! - 1
    }
    results.push(annualReturns)
  }

  return results
}
