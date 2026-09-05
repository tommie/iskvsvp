import type { WealthDistribution } from './types'

export interface DensityBin {
  /** Geometric centre of the bin, in kronor. */
  value: number
  /** Probability per decade of capital. */
  density: number
  /** Width of the bin, in decades. */
  decades: number
}

/**
 * Bins the grid mass into a plottable density.
 *
 * The grid is geometric, so equal-width bins in log space are equal-width runs
 * of the grid index. Dividing the binned mass by the bin's width gives a
 * density, which is what makes the familiar lognormal hump appear on a log
 * axis instead of a spike crushed against the left edge.
 *
 * The width is measured in decades rather than natural log units so the
 * density carries a unit a reader can use: the area under the curve across one
 * factor of ten of capital is the probability of landing in it. That makes the
 * y axis a percentage rather than an arbitrary scale. It can exceed 100% where
 * the distribution is concentrated in less than a decade, which is correct for
 * a density.
 *
 * The width counts grid *cells*, not the span between the first and last node
 * in the bin. Measuring node-to-node drops one cell per bin and would inflate
 * every density by perBin/(perBin-1) — 25% at the default binning — which is
 * exactly the kind of error a percentage axis invites a reader to trust.
 */
export function densityBins(distribution: WealthDistribution, binCount: number): DensityBin[] {
  const { grid, mass } = distribution
  if (grid.length < 2) return []

  const logStep = Math.log(grid[1]!) - Math.log(grid[0]!)
  const perBin = Math.max(1, Math.floor(grid.length / binCount))
  const bins: DensityBin[] = []

  for (let start = 0; start < grid.length; start += perBin) {
    const end = Math.min(grid.length, start + perBin)
    let total = 0
    for (let i = start; i < end; i++) total += mass[i]!

    const decades = ((end - start) * logStep) / Math.LN10
    bins.push({
      value: Math.sqrt(grid[start]! * grid[end - 1]!),
      density: decades > 0 ? total / decades : 0,
      decades,
    })
  }

  return bins
}

/**
 * Height of the plotted curve at `value`, or null when it falls outside it.
 *
 * Interpolated between the two neighbouring bin centres rather than taken from
 * the nearest one, so a marker placed with it sits *on* the line instead of
 * beside it. That matters most exactly where the density is steepest, which is
 * where markers are most often wanted: the point mass a bequest target leaves
 * on the final distribution is the steepest thing on that chart.
 *
 * Interpolated in log space, matching the geometric bins and the log axis they
 * are drawn on, so the fraction is the same one the renderer uses for x.
 */
export function densityAt(bins: DensityBin[], value: number): number | null {
  if (!(value > 0) || bins.length === 0) return null
  if (value < bins[0]!.value || value > bins[bins.length - 1]!.value) return null

  let index = 0
  while (index < bins.length - 2 && bins[index + 1]!.value < value) index++
  const low = bins[index]!
  const high = bins[index + 1]!
  const span = Math.log(high.value) - Math.log(low.value)
  if (!(span > 0)) return low.density
  const fraction = (Math.log(value) - Math.log(low.value)) / span
  return low.density + fraction * (high.density - low.density)
}
