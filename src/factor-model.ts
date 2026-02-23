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

function randomNormal(mean: number, stdDev: number, rng: () => number): number {
  const u1 = rng() || Number.MIN_VALUE
  const u2 = rng()
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z0 * stdDev
}

/**
 * Sample from Student's t-distribution using the ratio method.
 * params: [df, loc, scale]
 */
function sampleT(params: number[], rng: () => number): number {
  const df = params[0]!
  const scale = params[2]!

  // Use the polar method for t-distribution
  // Generate t via ratio of normals: t = Z / sqrt(V/df) where V ~ chi-squared(df)
  // For efficiency, use Box-Muller for Z and sum of squared normals for chi-squared
  let t: number
  if (df <= 0) {
    // Fallback to standard normal
    t = randomNormal(0, 1, rng)
  } else {
    // Generate chi-squared(df) as sum of df standard normals squared
    // For large df, use the normal approximation
    if (df > 100) {
      // Normal approximation: t ≈ N(0, df/(df-2))
      const z = randomNormal(0, 1, rng)
      const v = df / (df - 2)
      t = z * Math.sqrt(v)
    } else {
      // Direct: generate df standard normals, sum squares
      let chiSq = 0
      for (let i = 0; i < Math.ceil(df); i++) {
        const z = randomNormal(0, 1, rng)
        chiSq += z * z
      }
      // For non-integer df, scale linearly
      chiSq *= df / Math.ceil(df)
      const z = randomNormal(0, 1, rng)
      t = z / Math.sqrt(chiSq / df)
    }
  }

  // Subtract loc to center at zero (alpha already has the mean)
  return t * scale
}

/**
 * Sample from skew-normal distribution.
 * params: [a, loc, scale] where a is the skewness parameter.
 * Uses the standard construction: if Z1,Z2 ~ N(0,1) independent,
 * then X = delta*|Z1| + sqrt(1-delta^2)*Z2 where delta = a/sqrt(1+a^2)
 */
function sampleSkewNorm(params: number[], rng: () => number): number {
  const a = params[0]!
  const scale = params[2]!

  const delta = a / Math.sqrt(1 + a * a)
  const z1 = randomNormal(0, 1, rng)
  const z2 = randomNormal(0, 1, rng)
  const x = delta * Math.abs(z1) + Math.sqrt(1 - delta * delta) * z2

  // The skewnorm has a nonzero mean = delta * sqrt(2/pi).
  // Subtract it to center at zero (alpha captures the mean).
  const skewMean = delta * Math.sqrt(2 / Math.PI)
  return (x - skewMean) * scale
}

/**
 * Sample a zero-mean residual innovation from the fund's distribution.
 */
function sampleResidual(fp: FundFactorParams, rng: () => number): number {
  switch (fp.residualType) {
    case 't':
      return sampleT(fp.residualParams, rng)
    case 'skewnorm':
      return sampleSkewNorm(fp.residualParams, rng)
    case 'norm':
    default:
      // Normal: params are [loc, scale]; use scale, center at zero
      return randomNormal(0, fp.residualParams[1] ?? fp.residualStd, rng)
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
  const { nFactors, means, choleskyL, fundParams, factorAr1, innovationCholeskyL } = payload
  const nAssets = fundParams.length
  const results: number[][] = []

  // AR(1) residual state per asset (carries across months).
  // Initialized to NaN to signal that the first month should not be filtered
  // (matching Python which starts the AR(1) loop at t=1, leaving t=0 as-is).
  const ar1State = new Array(nAssets).fill(NaN) as number[]

  // Initialize VAR(1) factor state from stationary distribution N(means, Σ)
  // so the first month doesn't start with a deterministic bias.
  const prevFactors = new Array(nFactors) as number[]
  const z0 = new Array(nFactors) as number[]
  for (let f = 0; f < nFactors; f++) z0[f] = randomNormal(0, 1, rng)
  for (let f = 0; f < nFactors; f++) {
    let sum = 0
    for (let k = 0; k <= f; k++) sum += choleskyL[f]![k]! * z0[k]!
    prevFactors[f] = means[f]! + sum
  }

  for (let year = 0; year < nYears; year++) {
    // Monthly compounding: product of (1 + monthly_return/100) over 12 months
    const monthlyProducts = new Array(nAssets).fill(1) as number[]

    for (let month = 0; month < 12; month++) {
      // 1. Draw independent standard normals
      const z = new Array(nFactors) as number[]
      for (let f = 0; f < nFactors; f++) {
        z[f] = randomNormal(0, 1, rng)
      }

      // 2. Transform to correlated innovations and apply VAR(1)
      // factors_t = means + ar1*(prev - means) + L_innov * z
      const factors = new Array(nFactors) as number[]
      for (let f = 0; f < nFactors; f++) {
        let sum = 0
        for (let k = 0; k <= f; k++) {
          sum += innovationCholeskyL[f]![k]! * z[k]!
        }
        factors[f] = means[f]! + factorAr1[f]! * (prevFactors[f]! - means[f]!) + sum
      }

      // Update state for next month
      for (let f = 0; f < nFactors; f++) {
        prevFactors[f] = factors[f]!
      }

      // 3. For each asset, compute monthly return
      for (let a = 0; a < nAssets; a++) {
        const fp = fundParams[a]!

        // Systematic component: alpha + dot(betas, factors)
        let systematic = fp.alpha
        for (let f = 0; f < nFactors; f++) {
          systematic += fp.betasFull[f]! * factors[f]!
        }

        // Sample residual innovation
        let eta = sampleResidual(fp, rng)

        // Heteroskedastic vol scaling
        if (fp.volBetasFull) {
          let logVol = fp.volIntercept
          for (let f = 0; f < nFactors; f++) {
            logVol += fp.volBetasFull[f]! * Math.abs(factors[f]!)
          }
          const scaleFactor = Math.min(Math.exp(0.5 * (logVol - fp.volBaseline)), 10.0)
          eta *= scaleFactor
        }

        // AR(1) filtering: ε_t = φ·ε_{t-1} + √(1-φ²)·η_t
        // First month uses raw eta (no prior state to filter from).
        if (fp.ar1Coefficient !== 0) {
          if (Number.isNaN(ar1State[a])) {
            ar1State[a] = eta
          } else {
            const phi = fp.ar1Coefficient
            const epsilon = phi * ar1State[a]! + Math.sqrt(1 - phi * phi) * eta
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
