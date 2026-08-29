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
    // Measured at 88% for this plan, and 81% for the default one. The
    // remainder is the price of actually spending the extra when it is
    // affordable — a rule that recovered all of it would be one that never
    // paid out. It was 70% while the reserve discounted every year at the
    // plan's original horizon rather than the one still remaining.
    const recovered = (extraRuin - adaptiveRuin) / (extraRuin - needRuin)
    expect(recovered).toBeGreaterThan(0.8)
  })

  it('discounts a shrinking horizon at a falling rate', () => {
    const years = 40
    const result = runPlanner(
      plan({
        years,
        iskAllowance: 300_000,
        initialCapital: 9_000_000,
        cashflow: buildCashflow(years, 200_000, 100_000),
      }),
    )

    // The reported rate is the one at the start of the plan, where the whole
    // horizon is still ahead and the curve is at its least conservative. Every
    // year after it discounts lower, which is not observable from here — what
    // is, is the survival it buys: 86% against the 84% a single full-horizon
    // rate gives, for two tenths of a per cent of the expected spending.
    expect(1 - finalOf(result.adaptiveRun).ruinProbability).toBeGreaterThan(0.85)
    expect(result.adaptiveRun.expectedWithdrawn).toBeGreaterThan(
      0.99 * result.extraRun.expectedWithdrawn,
    )
    // Still only a brake on the discretionary part: the need run, which the
    // reserve never touches, is unchanged by any of this.
    expect(1 - finalOf(result.needRun).ruinProbability).toBeGreaterThan(0.89)
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

  describe('the final year, where the rule spends the whole remaining surplus', () => {
    // Zero return, no tax and no volatility, so the reserve rate is zero: the
    // reserve is the remaining needs undiscounted and the annuity is the count
    // of remaining payments. A capital of exactly need + extra per year is then
    // spent to precisely zero, which is what the last year is supposed to do.
    const years = 10
    const spent = () =>
      runPlanner(
        plan({
          years,
          initialCapital: 1_000_000,
          iskTaxRate: 0,
          cashflow: buildCashflow(years, 50_000, 100_000),
          ...singleAsset(0, 0),
        }),
      ).adaptiveRun

    it('counts a plan that funded everything and ended at zero as survived', () => {
      const run = spent()
      // Ruin is failing to fund the *need*. Landing on zero having paid the
      // need and the extra it could afford is the plan working, not failing;
      // reading it as ruin would put a cliff in the last year of every
      // adaptive survival curve.
      expect(finalOf(run).ruinProbability).toBeCloseTo(0, 10)
      expect(run.finalDistribution.depletedProbability).toBeCloseTo(1, 10)
      expect(finalOf(run).median).toBe(0)
    })

    it('counts the cash that emptied the account as withdrawn', () => {
      // 50 000 of need plus 50 000 of affordable extra, ten times over: the
      // whole starting capital reaches the household.
      expect(spent().expectedWithdrawn).toBeCloseTo(1_000_000, 2)
    })

    // The annuity factor falls to one in the last year, so spending does
    // accelerate towards the horizon and the final step is legitimately the
    // largest — measured at about 1.4x its predecessor on either account type.
    // What it must not be is a discontinuity. Three separate mistakes produce
    // one: counting the deliberately emptied accounts as failures rather than
    // as depleted takes it to 3.8x, reserving an AF's need without the tax that
    // raising it costs takes it to 3.4x, and discounting every year at the
    // plan's original horizon instead of the one remaining takes it to 1.7x.
    for (const accountType of ['ISK', 'AF'] as const) {
      it(`leaves no step in the ${accountType} survival curve at the horizon`, () => {
        const horizon = 30
        const outcomes = runPlanner(
          plan({
            years: horizon,
            accountType,
            initialCapital: 6_000_000,
            cashflow: buildCashflow(horizon, 200_000, 100_000),
          }),
        ).adaptiveRun.outcomes
        const failed = (i: number) =>
          outcomes[i]!.ruinProbability - outcomes[i - 1]!.ruinProbability

        expect(failed(horizon)).toBeLessThan(1.9 * failed(horizon - 1))
      })
    }
  })

  describe('the payout it reports year by year', () => {
    const years = 40
    const result = () =>
      runPlanner(
        plan({
          years,
          initialCapital: 6_000_000,
          cashflow: buildCashflow(years, 200_000, 100_000),
        }),
      )

    it('stays inside the envelope the household asked for', () => {
      // The rule can decline part of the extra and it can fail outright, but it
      // can never pay more than was asked for — the amounts come from the
      // schedule, and only the level of the discretionary part is negotiable.
      for (const year of result().adaptiveRun.withdrawals) {
        expect(year.percentile90).toBeLessThanOrEqual(300_000 + 1e-6)
        expect(year.percentile10).toBeLessThanOrEqual(year.median + 1e-6)
        expect(year.median).toBeLessThanOrEqual(year.percentile90 + 1e-6)
        expect(year.percentile10).toBeGreaterThanOrEqual(0)
      }
    })

    it('rations the extra from the first year and harder later', () => {
      // 6 mkr against forty years of need is tight enough that the reserve
      // already claims most of the balance in year one: the rule pays the need
      // and only a sliver of the extra. By the horizon the low outcomes are
      // down to the need alone or to nothing.
      const withdrawals = result().adaptiveRun.withdrawals
      expect(withdrawals[0]!.median).toBeGreaterThan(200_000)
      expect(withdrawals[0]!.median).toBeLessThan(300_000)
      expect(withdrawals[0]!.percentile10).toBeGreaterThan(withdrawals[years - 1]!.percentile10)
    })
  })

  describe('the bequest target', () => {
    // No return, no volatility and no tax, so the reserve rate is zero: the
    // need reserve is the remaining needs undiscounted, the bequest reserve is
    // the target itself, and the whole recursion can be worked out by hand.
    const years = 10
    const deterministic = (bequestRatio: number) =>
      runPlanner(
        plan({
          years,
          bequestRatio,
          initialCapital: 1_000_000,
          iskTaxRate: 0,
          cashflow: buildCashflow(years, 50_000, 100_000),
          ...singleAsset(0, 0),
        }),
      ).adaptiveRun

    it('lands on the target instead of spending the plan to zero', () => {
      // Half the capital reserved and half of it committed to the need leaves
      // no surplus at all, so the extra is declined outright and the plan ends
      // on exactly the target. The mean is the figure to check: the linear
      // scatter conserves it exactly, while a percentile can only land on a
      // grid node.
      //
      // Only to within a per cent, though, and deliberately not tightened. The
      // surplus is a convex function of the balance — clamped below at zero —
      // so mass spread across two grid nodes spends slightly more than the
      // exact path does, exactly as the zero-volatility AF recursion is off for
      // want of averaging. It converges: 493.8k, 496.6k, 498.0k, 498.9k over
      // four doublings of the grid.
      const run = deterministic(0.5)
      const final = run.outcomes[years]!
      expect(final.mean).toBeGreaterThan(500_000 * 0.985)
      expect(final.mean).toBeLessThanOrEqual(500_000)
      expect(run.expectedWithdrawn).toBeGreaterThanOrEqual(years * 50_000)
      expect(run.expectedWithdrawn).toBeLessThan(years * 50_000 * 1.02)
      expect(run.finalDistribution.depletedProbability).toBeCloseTo(0, 10)
    })

    it('reports reaching a target it clears and missing one it does not', () => {
      // The deterministic plan above ends on half its starting capital, so a
      // target well inside that is certain and one well outside it impossible.
      // Deliberately not asked at the margin: a plan that aims exactly at its
      // target puts the whole distribution on the threshold, where the answer
      // is decided by how far the interpolation has smeared it and not by the
      // plan.
      expect(deterministic(0.3).bequestProbability).toBeCloseTo(1, 6)
      expect(deterministic(0.5).bequestProbability).toBeGreaterThan(0.5)
      // Twice the starting capital, from a plan that also has forty years of
      // need to fund out of a portfolio that grows not at all.
      expect(deterministic(2).bequestProbability).toBeCloseTo(0, 6)
    })

    it('converges on the target as the grid is refined', () => {
      // The shortfall above is quantisation, not the rule, so it has to shrink
      // with the grid. Pinned because a rule that genuinely overspent would
      // look identical at a single resolution.
      const meanAt = (gridNodes: number) =>
        runPlanner(
          plan({
            years,
            gridNodes,
            bequestRatio: 0.5,
            initialCapital: 1_000_000,
            iskTaxRate: 0,
            cashflow: buildCashflow(years, 50_000, 100_000),
            ...singleAsset(0, 0),
          }),
        ).adaptiveRun.outcomes[years]!.mean

      const coarse = meanAt(400)
      const fine = meanAt(3200)
      expect(500_000 - fine).toBeLessThan((500_000 - coarse) / 4)
    })

    it('reports no probability when the plan sets no target', () => {
      expect(deterministic(0).bequestProbability).toBeUndefined()
      // And the same plan without one is spent to nothing, which is the
      // behaviour the target exists to change.
      expect(deterministic(0).outcomes[years]!.mean).toBeCloseTo(0, 2)
    })

    it('buys terminal capital out of the extra, and only out of the extra', () => {
      const none = deterministic(0)
      const some = deterministic(0.25)
      const most = deterministic(0.5)

      // Every krona left behind is a krona of extra declined; the need is
      // untouched, so the totals move together and in opposite directions.
      expect(some.outcomes[years]!.mean).toBeGreaterThan(none.outcomes[years]!.mean)
      expect(most.outcomes[years]!.mean).toBeGreaterThan(some.outcomes[years]!.mean)
      expect(some.expectedWithdrawn).toBeLessThan(none.expectedWithdrawn)
      expect(most.expectedWithdrawn).toBeLessThan(some.expectedWithdrawn)
      // Every krona of it, to the same per cent the grid resolves the target to.
      const givenUp = none.expectedWithdrawn - most.expectedWithdrawn
      expect(givenUp).toBeGreaterThan(500_000 * 0.98)
      expect(givenUp).toBeLessThanOrEqual(500_000)
    })

    it('leaves a plan with no extra to give up completely alone', () => {
      const build = (bequestRatio: number) =>
        runPlanner(
          plan({
            years: 30,
            bequestRatio,
            initialCapital: 6_000_000,
            cashflow: buildCashflow(30, 250_000, 0),
          }),
        )
      // The target is a brake on discretionary spending. With none to brake it
      // must not reach for the need instead — a household that has to spend
      // 250 000 a year does not stop doing so to leave an inheritance.
      const withTarget = build(1)
      const without = build(0)
      expect(withTarget.adaptiveRun.expectedWithdrawn).toBeCloseTo(
        without.adaptiveRun.expectedWithdrawn,
        6,
      )
      expect(finalOf(withTarget.adaptiveRun).ruinProbability).toBeCloseTo(
        finalOf(without.adaptiveRun).ruinProbability,
        12,
      )
    })

    it('does not make missing the target count as ruin', () => {
      const years = 40
      const build = (bequestRatio: number) =>
        runPlanner(
          plan({
            years,
            bequestRatio,
            initialCapital: 6_000_000,
            cashflow: buildCashflow(years, 200_000, 100_000),
          }),
        ).adaptiveRun
      // An ambitious target on a plan that cannot afford it is missed most of
      // the time, and that has to show up as a low bequest probability rather
      // than as a plan that failed. Spending less can only help survival.
      const ambitious = build(1)
      expect(ambitious.bequestProbability!).toBeLessThan(0.5)
      expect(finalOf(ambitious).ruinProbability).toBeLessThan(
        finalOf(build(0)).ruinProbability + 1e-12,
      )
    })

    it('measures an AF target after the tax the heirs inherit', () => {
      // Half the balance is unrealised gain and stays so: with no return and no
      // inflation the basis ratio never moves, and a single asset rebalances
      // nothing. A 500 000 target therefore has to leave 588 235 of balance,
      // which is 500 000 once the 30% on the embedded gain is settled.
      const years = 10
      const run = runPlanner(
        plan({
          years,
          accountType: 'AF',
          bequestRatio: 0.5,
          initialCapital: 1_000_000,
          initialCostBasisRatio: 0.5,
          afSchablonRate: 0,
          capitalGainsTaxRate: 0.3,
          inflationRate: 0,
          // No need at all, so the only commitment the rule weighs is the
          // bequest and the arithmetic is the target's alone.
          cashflow: buildCashflow(years, 0, 1_000_000),
          ...singleAsset(0, 0),
        }),
      ).adaptiveRun

      const liquid = run.liquidOutcomes![years]!
      expect(liquid.mean).toBeCloseTo(500_000, 0)
      expect(run.outcomes[years]!.mean).toBeCloseTo(500_000 / 0.85, 0)
      // What is left over is spendable at 85 öre in the krona, the rest going
      // to the tax the sales realise.
      expect(run.expectedWithdrawn).toBeCloseTo((1_000_000 - 500_000 / 0.85) * 0.85, 0)
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
