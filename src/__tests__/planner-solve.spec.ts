import { describe, it, expect } from 'vitest'

import { solveOptionalScale } from '../planner/solve'
import { adaptiveSurvival } from '../planner/propagate'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import type { PlannerParameters } from '../planner/types'

function plan(overrides: Partial<PlannerParameters> = {}): PlannerParameters {
  return {
    ...defaultPlannerParameters(),
    iskAllowance: 0,
    years: 40,
    initialCapital: 6_000_000,
    cashflow: buildCashflow(40, 200_000, 100_000),
    ...overrides,
  }
}

describe('solveOptionalScale', () => {
  it('finds a multiplier that meets the target', () => {
    const params = plan()
    const target = 0.65
    const solution = solveOptionalScale(params, target)

    expect(solution.status).toBe('solved')
    expect(solution.survival).toBeGreaterThanOrEqual(target)
    // The bracket is kept on the safe side, so the answer never overspends the
    // target — but it should be close, not merely conservative.
    expect(solution.survival - target).toBeLessThan(0.01)
    expect(solution.scale).toBeGreaterThan(0)
    expect(solution.scale).toBeLessThan(1)
  })

  it('scales the drawn shape rather than flattening it', () => {
    // A plan that spends more early and tapers later: whatever multiplier comes
    // back, the ratio between the years has to survive it.
    const years = 30
    const cashflow = [...buildCashflow(10, 200_000, 200_000), ...buildCashflow(20, 200_000, 50_000)]
    const params = plan({ years, cashflow })
    const solution = solveOptionalScale(params, 0.6)

    const scaled = cashflow.map((year) => year.optional * solution.scale)
    expect(scaled[0]! / scaled[29]!).toBeCloseTo(200_000 / 50_000, 9)
  })

  it('reproduces its own answer when the scale is applied', () => {
    const params = plan()
    const solution = solveOptionalScale(params, 0.62)
    const applied = adaptiveSurvival({
      ...params,
      cashflow: params.cashflow.map((y) => ({ ...y, optional: y.optional * solution.scale })),
    })
    expect(applied).toBeCloseTo(solution.survival, 9)
  })

  it('reports a target above what the floor alone can reach as unreachable', () => {
    const params = plan()
    const ceiling = solveOptionalScale(params, 0.5).ceiling
    const solution = solveOptionalScale(params, ceiling + 0.05)

    // No amount of restraint helps: the floor itself is what fails.
    expect(solution.status).toBe('unreachable')
    expect(solution.scale).toBe(0)
  })

  it('caps rather than running away when the target is easy', () => {
    // A tiny optional against a large portfolio: even twenty times the drawn
    // amount clears the target.
    const solution = solveOptionalScale(
      plan({ initialCapital: 60_000_000, cashflow: buildCashflow(40, 200_000, 10_000) }),
      0.5,
    )
    expect(solution.status).toBe('capped')
    expect(solution.survival).toBeGreaterThan(0.5)
  })

  it('says so when there is no optional to scale', () => {
    const solution = solveOptionalScale(plan({ cashflow: buildCashflow(40, 200_000, 0) }), 0.5)
    expect(solution.status).toBe('nothing-to-scale')
    expect(solution.scale).toBe(1)
  })

  it('is monotone: a higher target buys a smaller multiplier', () => {
    const params = plan()
    const relaxed = solveOptionalScale(params, 0.55)
    const strict = solveOptionalScale(params, 0.65)
    expect(strict.scale).toBeLessThan(relaxed.scale)
  })

  it('converges in a handful of propagations', () => {
    // Bisection over [0, 20] to 0.005 is about thirteen steps; anything much
    // larger means the bracket logic has gone wrong.
    expect(solveOptionalScale(plan(), 0.6).evaluations).toBeLessThan(20)
  })
})
