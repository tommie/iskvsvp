import { describe, it, expect } from 'vitest'

import { isNegligibleScale, solveExtraScale, NEGLIGIBLE_SCALE_CHANGE } from '../planner/solve'
import { adaptiveSurvival } from '../planner/propagate'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import { floorToSignificant } from '../planner/format'
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

describe('solveExtraScale', () => {
  it('finds a multiplier that meets the target', () => {
    const params = plan()
    const target = 0.65
    const solution = solveExtraScale(params, target)

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
    const solution = solveExtraScale(params, 0.6)

    const scaled = cashflow.map((year) => year.extra * solution.scale)
    expect(scaled[0]! / scaled[29]!).toBeCloseTo(200_000 / 50_000, 9)
  })

  it('reproduces its own answer when the scale is applied', () => {
    const params = plan()
    const solution = solveExtraScale(params, 0.62)
    const applied = adaptiveSurvival({
      ...params,
      cashflow: params.cashflow.map((y) => ({ ...y, extra: y.extra * solution.scale })),
    })
    expect(applied).toBeCloseTo(solution.survival, 9)
  })

  it('reports a target above what the need alone can reach as unreachable', () => {
    const params = plan()
    const ceiling = solveExtraScale(params, 0.5).ceiling
    const solution = solveExtraScale(params, ceiling + 0.05)

    // No amount of restraint helps: the need itself is what fails.
    expect(solution.status).toBe('unreachable')
    expect(solution.scale).toBe(0)
  })

  it('caps rather than running away when the target is easy', () => {
    // A tiny extra against a large portfolio: even twenty times the drawn
    // amount clears the target.
    const solution = solveExtraScale(
      plan({ initialCapital: 60_000_000, cashflow: buildCashflow(40, 200_000, 10_000) }),
      0.5,
    )
    expect(solution.status).toBe('capped')
    expect(solution.survival).toBeGreaterThan(0.5)
  })

  it('says so when there is no extra to scale', () => {
    const solution = solveExtraScale(plan({ cashflow: buildCashflow(40, 200_000, 0) }), 0.5)
    expect(solution.status).toBe('nothing-to-scale')
    expect(solution.scale).toBe(1)
  })

  it('is monotone: a higher target buys a smaller multiplier', () => {
    const params = plan()
    const relaxed = solveExtraScale(params, 0.55)
    const strict = solveExtraScale(params, 0.65)
    expect(strict.scale).toBeLessThan(relaxed.scale)
  })

  it('converges in a handful of propagations', () => {
    // Bisection over [0, 20] to 0.005 is about thirteen steps; anything much
    // larger means the bracket logic has gone wrong.
    expect(solveExtraScale(plan(), 0.6).evaluations).toBeLessThan(20)
  })
})

describe('isNegligibleScale', () => {
  it('treats a small move in either direction as nothing', () => {
    expect(isNegligibleScale(1)).toBe(true)
    expect(isNegligibleScale(1 + NEGLIGIBLE_SCALE_CHANGE / 2)).toBe(true)
    expect(isNegligibleScale(1 - NEGLIGIBLE_SCALE_CHANGE / 2)).toBe(true)
  })

  it('is symmetric about 1 and lets real moves through', () => {
    expect(isNegligibleScale(1 + NEGLIGIBLE_SCALE_CHANGE)).toBe(false)
    expect(isNegligibleScale(1 - NEGLIGIBLE_SCALE_CHANGE)).toBe(false)
    expect(isNegligibleScale(0.5)).toBe(false)
    expect(isNegligibleScale(2)).toBe(false)
  })

  it('holds back a rescale that two-significant-digit flooring would swallow', () => {
    // The reason for the threshold: below it the written-back schedule is
    // frequently the schedule the household already has.
    const extra = 100_000
    const scale = 1 + NEGLIGIBLE_SCALE_CHANGE / 2
    expect(isNegligibleScale(scale)).toBe(true)
    expect(floorToSignificant(extra * scale)).toBe(extra)
  })
})
