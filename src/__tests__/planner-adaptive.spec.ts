import { describe, it, expect } from 'vitest'

import { runPlanner } from '../planner/propagate'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import type { PlannerParameters } from '../planner/types'

function plan(overrides: Partial<PlannerParameters> = {}): PlannerParameters {
  return { ...defaultPlannerParameters(), iskAllowance: 0, ...overrides }
}

/** A one-asset portfolio, so the return law is known exactly. */
function singleAsset(expectedRealReturn: number, volatility: number) {
  return {
    assets: [{ id: 'a', name: 'A', weight: 1, expectedRealReturn, volatility }],
    correlations: [[1]],
  }
}

const finalOf = (run: { outcomes: { median: number; ruinProbability: number }[] }) =>
  run.outcomes[run.outcomes.length - 1]!

describe('adaptive extra withdrawals', () => {
  it('sits between the two fixed runs', () => {
    const years = 40
    const result = runPlanner(
      plan({
        years,
        initialCapital: 6_000_000,
        cashflow: buildCashflow(years, 200_000, 100_000),
      }),
    )

    // It spends at least the need and at most need+extra every year, so
    // both its survival and its terminal capital have to land in between.
    const need = finalOf(result.needRun)
    const extra = finalOf(result.extraRun)
    const adaptive = finalOf(result.adaptiveRun)

    expect(adaptive.ruinProbability).toBeGreaterThanOrEqual(need.ruinProbability - 1e-12)
    expect(adaptive.ruinProbability).toBeLessThanOrEqual(extra.ruinProbability + 1e-12)
    expect(adaptive.median).toBeLessThanOrEqual(need.median)
    expect(adaptive.median).toBeGreaterThanOrEqual(extra.median)
  })

  it('cuts failure risk well below spending the extra regardless', () => {
    const years = 40
    const result = runPlanner(
      plan({
        years,
        initialCapital: 6_000_000,
        cashflow: buildCashflow(years, 200_000, 100_000),
      }),
    )

    // The whole point: taking the extra only when it is affordable should
    // recover most of the survival that taking it unconditionally gives up.
    const needRuin = finalOf(result.needRun).ruinProbability
    const extraRuin = finalOf(result.extraRun).ruinProbability
    const adaptiveRuin = finalOf(result.adaptiveRun).ruinProbability
    // Measured at about two thirds for this plan. The remainder is the price
    // of actually spending the extra when it is affordable — a rule that
    // recovered all of it would be one that never paid out.
    const recovered = (extraRuin - adaptiveRuin) / (extraRuin - needRuin)
    expect(recovered).toBeGreaterThan(0.6)
  })

  it('never touches the need, so a plan with no extra is unchanged', () => {
    const years = 30
    const result = runPlanner(
      plan({
        years,
        initialCapital: 5_000_000,
        cashflow: buildCashflow(years, 250_000, 0),
      }),
    )

    // With nothing discretionary to modulate there is nothing for the rule to
    // do, and it must not quietly alter the need itself.
    expect(finalOf(result.adaptiveRun).median).toBe(finalOf(result.needRun).median)
    expect(finalOf(result.adaptiveRun).ruinProbability).toBeCloseTo(
      finalOf(result.needRun).ruinProbability,
      12,
    )
  })

  it('pays the full extra when the plan is far ahead of its commitments', () => {
    const years = 20
    // Capital far beyond what the need needs, so the surplus supports the
    // whole extra from the first year and the run matches spending it
    // unconditionally.
    const result = runPlanner(
      plan({
        years,
        initialCapital: 100_000_000,
        cashflow: buildCashflow(years, 200_000, 100_000),
        ...singleAsset(0.05, 0.1),
      }),
    )
    expect(finalOf(result.adaptiveRun).median / finalOf(result.extraRun).median).toBeCloseTo(1, 2)
  })

  describe('the clamp at both ends, with returns held deterministic', () => {
    // No volatility, so the reserve rate is exactly the median return and the
    // first year can be worked out by hand. Returns are applied before the cash
    // flow, so the surplus is judged on the grown balance.
    const years = 20
    const rate = 0.03
    // An annuity *due*: the year's withdrawal is taken immediately, right after
    // returns, so the first of the remaining payments is not discounted. Using
    // the annuity-immediate factor would understate both the reserve and the
    // payment count by a factor of (1 + rate).
    let annuity = 0
    for (let k = 0; k < years; k++) annuity += Math.pow(1 + rate, -k)
    const reserve = 200_000 * annuity

    const oneYear = (initialCapital: number) =>
      runPlanner(
        plan({
          years,
          initialCapital,
          iskTaxRate: 0,
          cashflow: buildCashflow(years, 200_000, 100_000),
          ...singleAsset(rate, 0),
        }),
      ).adaptiveRun.outcomes[1]!.mean

    it('pays the need alone when the balance is short of the reserve', () => {
      const capital = 2_500_000
      expect(capital * (1 + rate)).toBeLessThan(reserve)
      // Nothing spare, so the extra is declined in full.
      expect(oneYear(capital)).toBeCloseTo(capital * (1 + rate) - 200_000, 2)
    })

    it('pays part of the extra out of a thin surplus', () => {
      const capital = 4_000_000
      const grown = capital * (1 + rate)
      const affordable = (grown - reserve) / annuity
      expect(affordable).toBeGreaterThan(0)
      expect(affordable).toBeLessThan(100_000)
      expect(oneYear(capital)).toBeCloseTo(grown - 200_000 - affordable, 2)
    })

    it('never pays more than the extra the household asked for', () => {
      const capital = 20_000_000
      const grown = capital * (1 + rate)
      // The surplus would support far more, but the plan only wants 100 000.
      expect((grown - reserve) / annuity).toBeGreaterThan(100_000)
      expect(oneYear(capital)).toBeCloseTo(grown - 300_000, 2)
    })
  })

  it('derives the reserve return from the plan rather than asking for one', () => {
    const params = plan({ years: 25, cashflow: buildCashflow(25, 200_000, 50_000) })
    const result = runPlanner(params)

    // The 25th percentile of the annualised compound return over the horizon,
    // less the proportional schablon drag — not the median, which would make
    // the reserve a coin-flip hurdle.
    const z = -0.6744897501960817
    const expected =
      Math.exp(result.portfolio.logMean + (z * result.portfolio.logStdDev) / Math.sqrt(25)) -
      1 -
      params.iskTaxRate * params.capitalGainsTaxRate
    expect(result.reserveReturn).toBeCloseTo(expected, 12)
    expect(result.reserveReturn).toBeLessThan(Math.exp(result.portfolio.logMean) - 1)
  })

  it('reserves less when the portfolio is expected to do the work', () => {
    const years = 30
    const build = (expectedRealReturn: number) =>
      runPlanner(
        plan({
          years,
          initialCapital: 6_000_000,
          cashflow: buildCashflow(years, 200_000, 100_000),
          ...singleAsset(expectedRealReturn, 0.12),
        }),
      )

    // A higher expected return discounts the same commitments to a smaller
    // reserve, which frees more surplus and pays more of the extra.
    const modest = build(0.03)
    const strong = build(0.07)
    expect(strong.reserveReturn).toBeGreaterThan(modest.reserveReturn)

    const gapToNeed = (r: ReturnType<typeof build>) =>
      finalOf(r.needRun).median - finalOf(r.adaptiveRun).median
    expect(gapToNeed(strong)).toBeGreaterThan(gapToNeed(modest))
  })

  it('works for AF as well as ISK', () => {
    const years = 30
    const result = runPlanner(
      plan({
        years,
        accountType: 'AF',
        initialCapital: 6_000_000,
        cashflow: buildCashflow(years, 200_000, 100_000),
      }),
    )
    const adaptive = finalOf(result.adaptiveRun)
    expect(adaptive.ruinProbability).toBeLessThanOrEqual(
      finalOf(result.extraRun).ruinProbability + 1e-12,
    )
    // The cost-basis dimension has to be carried through the adaptive run too.
    expect(result.adaptiveRun.liquidOutcomes).toBeDefined()
  })
})

describe('actual versus planned withdrawals', () => {
  const planned = (years: number, need: number, extra: number) => years * (need + extra)

  it('takes exactly the plan when nothing fails and nothing is declined', () => {
    const years = 20
    // No volatility and capital far beyond the reserve, so every year pays the
    // need and the whole extra, and no path ruins.
    const result = runPlanner(
      plan({
        years,
        initialCapital: 200_000_000,
        cashflow: buildCashflow(years, 200_000, 100_000),
        ...singleAsset(0.04, 0),
      }),
    )
    const target = planned(years, 200_000, 100_000)
    expect(result.extraRun.expectedWithdrawn).toBeCloseTo(target, 2)
    expect(result.adaptiveRun.expectedWithdrawn).toBeCloseTo(target, 2)
  })

  it('stops counting once a plan has failed', () => {
    const years = 12
    // 1 000 000 funds five withdrawals of 190 000 with change; the sixth
    // cannot be paid, so exactly five are ever taken.
    const result = runPlanner(
      plan({
        years,
        initialCapital: 1_000_000,
        iskTaxRate: 0,
        cashflow: buildCashflow(years, 190_000, 0),
        ...singleAsset(0, 0),
      }),
    )
    expect(result.needRun.expectedWithdrawn).toBeCloseTo(5 * 190_000, 2)
  })

  it('delivers more spending than taking the extra regardless', () => {
    const years = 40
    const result = runPlanner(
      plan({
        years,
        initialCapital: 6_000_000,
        cashflow: buildCashflow(years, 200_000, 100_000),
      }),
    )

    // Both plan the same total and the adaptive run declines part of it, yet it
    // still hands over more money. Spending regardless ruins far more plans,
    // and a failed plan stops withdrawing altogether — so the restraint buys
    // back more years of spending than it gives up. Against the unconditional
    // run it is better on both money and risk, not a trade between them.
    const target = planned(years, 200_000, 100_000)
    expect(result.adaptiveRun.expectedWithdrawn).toBeGreaterThan(result.extraRun.expectedWithdrawn)
    expect(result.adaptiveRun.expectedWithdrawn).toBeGreaterThan(result.needRun.expectedWithdrawn)
    // And neither can exceed what was planned.
    for (const run of [result.needRun, result.extraRun, result.adaptiveRun]) {
      expect(run.expectedWithdrawn).toBeLessThanOrEqual(target + 1e-6)
    }
  })

  it('counts a deposit as money going the other way', () => {
    const years = 10
    const result = runPlanner(
      plan({
        years,
        initialCapital: 0,
        iskTaxRate: 0,
        cashflow: buildCashflow(years, -100_000, 0),
        ...singleAsset(0.05, 0),
      }),
    )
    expect(result.needRun.expectedWithdrawn).toBeCloseTo(-10 * 100_000, 2)
  })
})
