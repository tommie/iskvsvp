import { describe, it, expect } from 'vitest'

import { densityAt, densityBins } from '../planner/density'
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
    const bins = densityBins({ grid, mass, ruinProbability: 0.5, depletedProbability: 0 }, 2)

    expect(bins).toHaveLength(2)
    expect(bins[0]!.decades).toBeCloseTo(2, 12)
    expect(bins[0]!.density).toBeCloseTo(0.25, 12)
    expect(integrate(bins)).toBeCloseTo(0.5, 12)
  })

  it('returns nothing for a degenerate grid', () => {
    expect(
      densityBins(
        {
          grid: Float64Array.of(1),
          mass: Float64Array.of(1),
          ruinProbability: 0,
          depletedProbability: 0,
        },
        10,
      ),
    ).toEqual([])
  })
})

describe('densityAt', () => {
  const bins = [
    { value: 1, density: 10, decades: 1 },
    { value: 10, density: 30, decades: 1 },
    { value: 100, density: 20, decades: 1 },
  ]

  it('returns a bin centre exactly', () => {
    expect(densityAt(bins, 1)).toBeCloseTo(10, 12)
    expect(densityAt(bins, 10)).toBeCloseTo(30, 12)
    expect(densityAt(bins, 100)).toBeCloseTo(20, 12)
  })

  it('interpolates in log space, matching the axis it is drawn on', () => {
    // Half-way between 1 and 10 on a log axis is sqrt(10), not 5.5 — the same
    // fraction the renderer uses for x, so the marker lands on the line.
    expect(densityAt(bins, Math.sqrt(10))).toBeCloseTo(20, 12)
    expect(densityAt(bins, 5.5)).toBeGreaterThan(20)
  })

  it('has nothing to say outside the curve', () => {
    // A median of zero is a plan ruined or depleted more than half the time. A
    // log axis has no room for it, and no marker is the honest answer.
    expect(densityAt(bins, 0)).toBeNull()
    expect(densityAt(bins, -1)).toBeNull()
    expect(densityAt(bins, 0.5)).toBeNull()
    expect(densityAt(bins, 1000)).toBeNull()
    expect(densityAt([], 5)).toBeNull()
  })
})

describe('why the final-distribution marker is the median', () => {
  it('because the tallest bin is the bequest target, not an outcome', () => {
    // The dynamic run's last year pays need + clamp(w − need − target, 0,
    // extra), mapping a whole band of balances onto the target exactly. That
    // atom is the tallest thing on the chart whenever a target is set, so
    // marking the peak labelled the target itself — a property of the rule
    // rather than of the plan.
    const years = 30
    const params = {
      ...defaultPlannerParameters(),
      iskAllowance: 0,
      years,
      bequestRatio: 0.5,
      initialCapital: 9_000_000,
      cashflow: buildCashflow(years, 200_000, 100_000),
    }
    const run = runPlanner(params).adaptiveRun
    const bins = densityBins(run.finalDistribution, 160)
    const peak = bins.reduce((best, bin) => (bin.density > best.density ? bin : best), bins[0]!)
    const target = 0.5 * params.initialCapital
    const median = run.outcomes[years]!.median

    // The peak sits on the target, within the width of one bin.
    expect(Math.abs(Math.log(peak.value / target))).toBeLessThan(Math.LN10 * peak.decades)
    // The median does not, and it is the figure the table reports.
    expect(median).toBeGreaterThan(target * 1.2)
    // And it is somewhere the curve can carry a marker.
    expect(densityAt(bins, median)).not.toBeNull()
  })
})
