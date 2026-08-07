import { describe, it, expect } from 'vitest'

import { densityBins } from '../planner/density'
import { runPlanner } from '../planner/propagate'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'

function integrate(bins: ReturnType<typeof densityBins>): number {
  return bins.reduce((sum, bin) => sum + bin.density * bin.decades, 0)
}

describe('densityBins', () => {
  it('integrates to the surviving probability', () => {
    const years = 30
    const result = runPlanner({
      ...defaultPlannerParameters(),
      years,
      initialCapital: 6_000_000,
      cashflow: buildCashflow(years, 250_000, 0),
    })
    const run = result.needRun

    // The y axis is labelled as a probability per decade, so the area under
    // the curve has to be the probability of ending anywhere at all — that is,
    // everything that did not end in ruin.
    expect(integrate(densityBins(run.finalDistribution, 160))).toBeCloseTo(
      1 - run.finalDistribution.ruinProbability,
      12,
    )
  })

  it('gives the same area regardless of how finely it is binned', () => {
    const years = 20
    const run = runPlanner({
      ...defaultPlannerParameters(),
      years,
      cashflow: buildCashflow(years, 150_000, 0),
    }).needRun

    const areas = [40, 160, 400].map((count) =>
      integrate(densityBins(run.finalDistribution, count)),
    )
    for (const area of areas) {
      expect(area).toBeCloseTo(areas[0]!, 12)
    }
  })

  it('measures bin width in grid cells, not node-to-node', () => {
    // Four nodes a decade apart, all the mass on one of them. Binned in pairs,
    // each bin is two decades wide, so the density is half the mass. Measuring
    // node-to-node would call the bin one decade wide and double the density.
    const grid = Float64Array.from([1, 10, 100, 1000])
    const mass = Float64Array.from([0, 0.5, 0, 0])
    const bins = densityBins({ grid, mass, ruinProbability: 0.5 }, 2)

    expect(bins).toHaveLength(2)
    expect(bins[0]!.decades).toBeCloseTo(2, 12)
    expect(bins[0]!.density).toBeCloseTo(0.25, 12)
    expect(integrate(bins)).toBeCloseTo(0.5, 12)
  })

  it('returns nothing for a degenerate grid', () => {
    expect(
      densityBins({ grid: Float64Array.of(1), mass: Float64Array.of(1), ruinProbability: 0 }, 10),
    ).toEqual([])
  })
})
