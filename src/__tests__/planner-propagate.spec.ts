import { describe, it, expect } from 'vitest'
import seedrandom from 'seedrandom'

import { normalQuadrature } from '../planner/quadrature'
import { portfolioMoments, runPlanner } from '../planner/propagate'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import type { CashflowYear, PlannerParameters } from '../planner/types'

function params(overrides: Partial<PlannerParameters> = {}): PlannerParameters {
  const base = defaultPlannerParameters()
  // The default plan carries the current ISK fribelopp. Most tests here check
  // the propagation mechanics against closed forms that assume a flat
  // proportional tax, so switch it off unless a test asks for it.
  const merged = { ...base, iskAllowance: 0, ...overrides }
  if (overrides.years !== undefined && overrides.cashflow === undefined) {
    merged.cashflow = buildCashflow(overrides.years, 0, 0)
  }
  return merged
}

/** A one-asset portfolio, so the lognormal parameters are known exactly. */
function singleAsset(expectedRealReturn: number, volatility: number) {
  return {
    assets: [{ id: 'a', name: 'A', weight: 1, expectedRealReturn, volatility }],
    correlations: [[1]],
  }
}

function totalMass(run: { finalDistribution: { mass: Float64Array; ruinProbability: number } }) {
  let sum = run.finalDistribution.ruinProbability
  for (const m of run.finalDistribution.mass) sum += m
  return sum
}

describe('normalQuadrature', () => {
  it('is a normalised law with exactly zero mean and unit variance', () => {
    const quad = normalQuadrature(81)

    let weightSum = 0
    let mean = 0
    let secondMoment = 0
    for (let i = 0; i < quad.z.length; i++) {
      weightSum += quad.weight[i]!
      mean += quad.weight[i]! * quad.z[i]!
      secondMoment += quad.weight[i]! * quad.z[i]! * quad.z[i]!
    }

    expect(weightSum).toBeCloseTo(1, 14)
    expect(mean).toBeCloseTo(0, 14)
    expect(secondMoment).toBeCloseTo(1, 12)
  })

  it('integrates the lognormal mean, which is what the propagation relies on', () => {
    const quad = normalQuadrature(81)
    for (const s of [0.05, 0.15, 0.35]) {
      let expectation = 0
      for (let i = 0; i < quad.z.length; i++) {
        expectation += quad.weight[i]! * Math.exp(s * quad.z[i]!)
      }
      // E[exp(sZ)] = exp(s^2/2) for a standard normal Z. The residual is the
      // truncated tail beyond zMax, around 1e-9 — four orders of magnitude
      // below anything that could matter once compounded over a horizon.
      expect(expectation / Math.exp(0.5 * s * s)).toBeCloseTo(1, 8)
    }
  })

  it('forces an odd node count so the grid stays symmetric', () => {
    expect(normalQuadrature(80).z.length).toBe(81)
    expect(() => normalQuadrature(2)).toThrow(/at least 3/)
  })
})

describe('portfolioMoments', () => {
  it('combines assets through the correlation matrix', () => {
    const moments = portfolioMoments(
      [
        { id: 'a', name: 'A', weight: 0.5, expectedRealReturn: 0.08, volatility: 0.2 },
        { id: 'b', name: 'B', weight: 0.5, expectedRealReturn: 0.02, volatility: 0.05 },
      ],
      [
        [1, 0.3],
        [0.3, 1],
      ],
    )

    expect(moments.expectedReturn).toBeCloseTo(0.05, 12)
    // 0.25*0.04 + 0.25*0.0025 + 2*0.25*0.3*0.2*0.05
    expect(moments.variance).toBeCloseTo(0.012125, 12)
  })

  it('normalises weights that do not sum to one', () => {
    const scaled = portfolioMoments(
      [
        { id: 'a', name: 'A', weight: 5, expectedRealReturn: 0.08, volatility: 0.2 },
        { id: 'b', name: 'B', weight: 5, expectedRealReturn: 0.02, volatility: 0.05 },
      ],
      [
        [1, 0.3],
        [0.3, 1],
      ],
    )
    expect(scaled.expectedReturn).toBeCloseTo(0.05, 12)
  })

  it('rejects a correlation matrix that implies a negative variance', () => {
    expect(() =>
      portfolioMoments(
        [
          { id: 'a', name: 'A', weight: 1 / 3, expectedRealReturn: 0.05, volatility: 0.2 },
          { id: 'b', name: 'B', weight: 1 / 3, expectedRealReturn: 0.05, volatility: 0.2 },
          { id: 'c', name: 'C', weight: 1 / 3, expectedRealReturn: 0.05, volatility: 0.2 },
        ],
        [
          [1, -1, -1],
          [-1, 1, -1],
          [-1, -1, 1],
        ],
      ),
    ).toThrow(/not consistent/)
  })
})

describe('runPlanner', () => {
  it('conserves probability mass', () => {
    const result = runPlanner(
      params({
        years: 30,
        cashflow: buildCashflow(30, 300_000, 100_000),
      }),
    )
    expect(totalMass(result.floorRun)).toBeCloseTo(1, 10)
    expect(totalMass(result.optionalRun)).toBeCloseTo(1, 10)
  })

  it('preserves the arithmetic mean when nothing is withdrawn or taxed', () => {
    const years = 30
    const result = runPlanner(
      params({
        years,
        initialCapital: 1_000_000,
        iskTaxRate: 0,
        cashflow: buildCashflow(years, 0, 0),
        ...singleAsset(0.06, 0.15),
      }),
    )

    // Value-space interpolation conserves the mean exactly, and the quadrature
    // reproduces E[G] = 1 + mu to near machine precision, so the compounded
    // mean must match the closed form.
    const expected = 1_000_000 * Math.pow(1.06, years)
    const final = result.floorRun.outcomes[years]!
    expect(final.mean / expected).toBeCloseTo(1, 5)
    expect(result.floorRun.clippedMass).toBeLessThan(1e-8)
  })

  it('reproduces the lognormal median when nothing is withdrawn', () => {
    const years = 25
    const result = runPlanner(
      params({
        years,
        initialCapital: 1_000_000,
        iskTaxRate: 0,
        cashflow: buildCashflow(years, 0, 0),
        ...singleAsset(0.06, 0.15),
      }),
    )

    const expectedMedian = 1_000_000 * Math.exp(result.portfolio.logMean * years)
    expect(result.floorRun.outcomes[years]!.median / expectedMedian).toBeCloseTo(1, 2)
  })

  it('matches a deterministic recursion when volatility is zero', () => {
    const years = 20
    const flow = 200_000
    const p = params({
      years,
      initialCapital: 4_000_000,
      cashflow: buildCashflow(years, flow, 0),
      ...singleAsset(0.04, 0),
    })
    const result = runPlanner(p)

    const taxRate = p.iskTaxRate * p.capitalGainsTaxRate
    let wealth = p.initialCapital
    for (let i = 0; i < years; i++) {
      wealth = wealth * 1.04 - flow
      wealth -= wealth * taxRate
    }

    expect(result.floorRun.outcomes[years]!.mean / wealth).toBeCloseTo(1, 6)
    expect(result.floorRun.finalDistribution.ruinProbability).toBe(0)
  })

  it('pays the schablon out of the portfolio, so the withdrawal is net', () => {
    const flow = 300_000
    const p = params({
      years: 1,
      initialCapital: 5_000_000,
      cashflow: buildCashflow(1, flow, 0),
      // No growth, so the year's arithmetic is exact and the two deductions
      // can be told apart.
      ...singleAsset(0, 0),
    })
    const result = runPlanner(p)

    const taxRate = p.iskTaxRate * p.capitalGainsTaxRate
    const afterWithdrawal = 5_000_000 - flow

    // The full 300 000 reaches the plan holder; the schablon is charged on the
    // balance that remains, on top of the withdrawal rather than out of it. If
    // the tax were netted out of the withdrawal the balance would instead be
    // 5 000 000 - 300 000 exactly.
    expect(result.floorRun.outcomes[1]!.mean).toBeCloseTo(afterWithdrawal * (1 - taxRate), 4)
    expect(result.floorRun.outcomes[1]!.mean).toBeLessThan(afterWithdrawal)
  })

  it('charges the schablon only above the allowance', () => {
    const p = params({
      years: 1,
      initialCapital: 1_000_000,
      iskAllowance: 300_000,
      inflationRate: 0,
      cashflow: buildCashflow(1, 0, 0),
      ...singleAsset(0, 0),
    })
    const result = runPlanner(p)

    const taxRate = p.iskTaxRate * p.capitalGainsTaxRate
    expect(result.floorRun.outcomes[1]!.mean).toBeCloseTo(
      1_000_000 - (1_000_000 - 300_000) * taxRate,
      4,
    )
  })

  it('applies the ISK schablon as a proportional drag', () => {
    const years = 10
    const shared = { years, initialCapital: 1_000_000, cashflow: buildCashflow(years, 0, 0) }
    const untaxed = runPlanner(params({ ...shared, iskTaxRate: 0, ...singleAsset(0.05, 0) }))
    const taxed = runPlanner(params({ ...shared, iskTaxRate: 0.03, ...singleAsset(0.05, 0) }))

    const drag = Math.pow(1 - 0.03 * 0.3, years)
    const ratio = taxed.floorRun.outcomes[years]!.mean / untaxed.floorRun.outcomes[years]!.mean
    expect(ratio).toBeCloseTo(drag, 6)
  })

  it('deflates a nominal ISK allowance, so inflation reduces its worth', () => {
    const years = 30
    const shared = {
      years,
      initialCapital: 2_000_000,
      cashflow: buildCashflow(years, 0, 0),
      iskAllowance: 300_000,
      ...singleAsset(0.05, 0.12),
    }
    const lowInflation = runPlanner(params({ ...shared, inflationRate: 0.0 }))
    const highInflation = runPlanner(params({ ...shared, inflationRate: 0.06 }))

    // The allowance shields a nominal amount. High inflation erodes it, so the
    // same real portfolio pays more real tax and ends up smaller.
    expect(highInflation.floorRun.outcomes[years]!.mean).toBeLessThan(
      lowInflation.floorRun.outcomes[years]!.mean,
    )
  })

  it('leaves the real result untouched by inflation when no allowance applies', () => {
    const years = 30
    const shared = {
      years,
      initialCapital: 2_000_000,
      cashflow: buildCashflow(years, 150_000, 0),
      iskAllowance: 0,
      ...singleAsset(0.05, 0.12),
    }
    const a = runPlanner(params({ ...shared, inflationRate: 0.0 }))
    const b = runPlanner(params({ ...shared, inflationRate: 0.08 }))

    expect(a.floorRun.outcomes[years]!.median).toBeCloseTo(b.floorRun.outcomes[years]!.median, 6)
  })

  it('ruins with certainty at the year a zero-volatility plan runs dry', () => {
    const years = 12
    const p = params({
      years,
      initialCapital: 1_000_000,
      iskTaxRate: 0,
      cashflow: buildCashflow(years, 190_000, 0),
      ...singleAsset(0, 0),
    })
    const result = runPlanner(p)

    // 1 000 000 funds five withdrawals of 190 000 with 50 000 to spare; the
    // sixth cannot be paid. The amounts avoid landing exactly on zero, where
    // the grid interpolation would legitimately straddle the ruin boundary.
    expect(result.floorRun.outcomes[5]!.ruinProbability).toBeCloseTo(0, 10)
    expect(result.floorRun.outcomes[6]!.ruinProbability).toBeCloseTo(1, 10)
  })

  it('treats ruin as absorbing, so a later deposit cannot revive the plan', () => {
    const years = 10
    const cashflow: CashflowYear[] = buildCashflow(years, 0, 0)
    for (let i = 0; i < 6; i++) cashflow[i] = { floor: 200_000, optional: 0 }
    cashflow[8] = { floor: -5_000_000, optional: 0 }

    const result = runPlanner(
      params({
        years,
        initialCapital: 1_000_000,
        iskTaxRate: 0,
        cashflow,
        ...singleAsset(0, 0),
      }),
    )

    expect(result.floorRun.finalDistribution.ruinProbability).toBeCloseTo(1, 10)
  })

  it('makes ruin probability non-decreasing over time', () => {
    const years = 40
    const result = runPlanner(
      params({ years, initialCapital: 3_000_000, cashflow: buildCashflow(years, 250_000, 0) }),
    )
    const outcomes = result.floorRun.outcomes
    for (let i = 1; i < outcomes.length; i++) {
      expect(outcomes[i]!.ruinProbability).toBeGreaterThanOrEqual(
        outcomes[i - 1]!.ruinProbability - 1e-15,
      )
    }
  })

  it('leaves the optional run no better off than the floor run', () => {
    const years = 35
    // Enough capital that both runs finish with a positive median; otherwise
    // both medians are zero and the comparison says nothing.
    const result = runPlanner(
      params({
        years,
        initialCapital: 12_000_000,
        cashflow: buildCashflow(years, 250_000, 120_000),
      }),
    )

    expect(result.optionalRun.outcomes[years]!.median).toBeLessThan(
      result.floorRun.outcomes[years]!.median,
    )
    expect(result.optionalRun.finalDistribution.ruinProbability).toBeGreaterThanOrEqual(
      result.floorRun.finalDistribution.ruinProbability,
    )
  })

  it('accumulates capital from a deposit schedule', () => {
    const years = 20
    const result = runPlanner(
      params({
        years,
        initialCapital: 0,
        iskTaxRate: 0,
        cashflow: buildCashflow(years, -100_000, 0),
        ...singleAsset(0.05, 0),
      }),
    )

    // Returns are applied before the cash flow, so the deposit lands at the
    // end of each year: an ordinary annuity, not an annuity-due.
    const expected = 100_000 * ((Math.pow(1.05, years) - 1) / 0.05)
    expect(result.floorRun.outcomes[years]!.mean / expected).toBeCloseTo(1, 5)
  })

  describe('input validation', () => {
    it('rejects a cashflow whose length does not match the horizon', () => {
      expect(() => runPlanner(params({ years: 10, cashflow: buildCashflow(9, 0, 0) }))).toThrow(
        /cashflow has 9 entries/,
      )
    })

    it('rejects a non-positive horizon', () => {
      expect(() => runPlanner(params({ years: 0, cashflow: [] }))).toThrow(/positive integer/)
    })
  })
})

describe('runPlanner against Monte Carlo', () => {
  /**
   * The propagation is only worth trusting if it agrees with the sampling it
   * replaces. This runs the identical law and ordering by simulation and
   * compares the two, which catches ordering mistakes, tax-base errors and any
   * bias in the grid interpolation that the analytic checks above would miss.
   */
  function monteCarlo(p: PlannerParameters, paths: number) {
    const moments = portfolioMoments(p.assets, p.correlations)
    const taxRate = p.iskTaxRate * p.capitalGainsTaxRate
    const rng = seedrandom('planner-cross-check')

    const finals: number[] = []
    let ruined = 0

    for (let path = 0; path < paths; path++) {
      let wealth = p.initialCapital
      let alive = true
      for (let year = 0; year < p.years; year++) {
        // Box-Muller, one draw per year.
        const u1 = Math.max(rng(), Number.MIN_VALUE)
        const u2 = rng()
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)

        wealth *= Math.exp(moments.logMean + moments.logStdDev * z)
        wealth -= p.cashflow[year]!.floor
        if (wealth <= 0) {
          alive = false
          break
        }
        wealth -= wealth * taxRate
      }
      if (alive) finals.push(wealth)
      else ruined++
    }

    finals.sort((a, b) => a - b)
    return { finals, ruinProbability: ruined / paths, paths }
  }

  function mcQuantile(mc: ReturnType<typeof monteCarlo>, q: number) {
    // Ruined paths occupy the bottom of the ordering with a value of zero,
    // matching quantileOf().
    const rank = q * mc.paths - mc.ruinProbability * mc.paths
    if (rank <= 0) return 0
    const index = Math.min(mc.finals.length - 1, Math.floor(rank))
    return mc.finals[index]!
  }

  it('agrees on ruin probability and percentiles for a plan under stress', () => {
    const years = 30
    // A 4% withdrawal rate: enough failures that the ruin probability is worth
    // comparing, but not so many that the lower percentiles collapse to zero.
    const p = params({
      years,
      initialCapital: 7_500_000,
      iskTaxRate: 0.0296,
      cashflow: buildCashflow(years, 300_000, 0),
      ...singleAsset(0.05, 0.16),
    })

    const grid = runPlanner(p).floorRun
    const mc = monteCarlo(p, 200_000)

    // Binomial standard error at p ~ 0.2 over 200k paths is ~0.001; allow a
    // few of those plus the grid's own discretisation.
    expect(grid.finalDistribution.ruinProbability).toBeCloseTo(mc.ruinProbability, 2)

    const final = grid.outcomes[years]!

    // Roughly a third of plans fail, so both engines must put the 25th
    // percentile at zero — that agreement is itself part of the check.
    expect(final.percentile25).toBe(0)
    expect(mcQuantile(mc, 0.25)).toBe(0)

    const comparisons: [number, number][] = [
      [0.5, final.median],
      [0.75, final.percentile75],
      [0.9, final.percentile90],
    ]
    for (const [q, gridValue] of comparisons) {
      const mcValue = mcQuantile(mc, q)
      // The residual is Monte Carlo quantile error over ~134k surviving paths,
      // not grid bias; the gap shrinks as the path count grows.
      expect(Math.abs(gridValue / mcValue - 1)).toBeLessThan(0.02)
    }
  })
})
