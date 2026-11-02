/** Discrete law approximating a standard normal, used to integrate one year of returns. */
export interface NormalQuadrature {
  z: Float64Array
  weight: Float64Array
}

/**
 * Builds a discrete standard-normal law by sampling the density on an evenly
 * spaced, symmetric grid.
 *
 * The trapezoid rule is used rather than Gauss-Hermite because for an analytic
 * integrand decaying like a Gaussian, trapezoid quadrature on the real line
 * converges exponentially in the step size (every Euler-Maclaurin correction
 * term vanishes). That gets us to machine precision at ~81 nodes without
 * needing a symmetric-tridiagonal eigensolver for the Gauss-Hermite abscissae.
 *
 * Two corrections are applied so the discrete law is not merely close but
 * exact in its first two moments:
 *
 *  - the node count is forced odd and the grid is symmetric, so all odd
 *    moments cancel and the mean is exactly zero;
 *  - truncating at `zMax` and renormalising the weights shrinks the variance
 *    slightly, so the abscissae are rescaled to restore unit variance.
 *
 * The variance correction matters because the propagation compounds: a
 * systematic under-dispersion of a fraction of a percent per year would
 * visibly narrow the distribution over a 40-year horizon.
 */
export function normalQuadrature(nodeCount: number, zMax = 6): NormalQuadrature {
  if (!Number.isFinite(nodeCount) || nodeCount < 3) {
    throw new Error(`normalQuadrature: nodeCount must be at least 3, got ${nodeCount}`)
  }
  if (!(zMax > 0)) {
    throw new Error(`normalQuadrature: zMax must be positive, got ${zMax}`)
  }

  const n = nodeCount % 2 === 0 ? nodeCount + 1 : nodeCount
  const z = new Float64Array(n)
  const weight = new Float64Array(n)
  const step = (2 * zMax) / (n - 1)

  let total = 0
  for (let i = 0; i < n; i++) {
    // The 1/sqrt(2*pi) factor is omitted; it cancels in the normalisation.
    const zi = -zMax + i * step
    const w = Math.exp(-0.5 * zi * zi)
    z[i] = zi
    weight[i] = w
    total += w
  }

  for (let i = 0; i < n; i++) {
    weight[i]! /= total
  }

  let variance = 0
  for (let i = 0; i < n; i++) {
    variance += weight[i]! * z[i]! * z[i]!
  }
  const scale = 1 / Math.sqrt(variance)
  for (let i = 0; i < n; i++) {
    z[i]! *= scale
  }

  return { z, weight }
}
