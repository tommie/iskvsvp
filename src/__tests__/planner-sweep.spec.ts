import { describe, it, expect, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SweepCard from '../components/planner/SweepCard.vue'
import SweepChart from '../components/planner/charts/SweepChart.vue'
import { usePlannerStore } from '../stores/planner'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import { adaptiveSummary, runPlanner } from '../planner/propagate'
import {
  canSweep,
  crossingFor,
  expectedPerYear,
  keepProbability,
  KEEP_TARGETS,
  levelMarks,
  peakDeliveryLevel,
  planExtraRate,
  plannedPerYear,
  sweepLength,
  sweepPoints,
  sweepRates,
  sweepVariant,
  SURVIVAL_TARGETS,
  SWEEP_MAX,
  SWEEP_STEP,
  type SweepPoint,
} from '../planner/sweep'
import type { PlannerParameters } from '../planner/types'

/**
 * D3Chart observes its container to render only when it is on screen, and jsdom
 * has no IntersectionObserver. A stub that never reports intersection leaves
 * the chart unrendered, which is what this file wants: the subject is the
 * sweep, not its rendering.
 */
beforeAll(() => {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: readonly number[] = []
  } as unknown as typeof IntersectionObserver
})

function plan(overrides: Partial<PlannerParameters> = {}): PlannerParameters {
  return {
    ...defaultPlannerParameters(),
    iskAllowance: 0,
    years: 20,
    initialCapital: 6_000_000,
    cashflow: buildCashflow(20, 200_000, 100_000),
    ...overrides,
  }
}

/** A point at a given survival, for the crossing arithmetic. */
function point(rate: number, survival: number): SweepPoint {
  return {
    rate,
    extra: rate * 1_000_000,
    survival,
    // Ten years, so the per-year figures the crossing reports are a tenth of
    // these and the division is visible in the expectations.
    years: 10,
    plannedWithdrawn: 10 * rate * 1_000_000,
    expectedWithdrawn: 5 * rate * 1_000_000,
    minWithdrawal: 0,
    maxWithdrawal: rate * 1_000_000,
    plannedMin: 10 * rate * 1_000_000,
    plannedMax: 10 * rate * 1_000_000,
    finalPercentile10: 0,
    finalMedian: 0,
    finalPercentile90: 0,
  }
}

describe('sweepRates', () => {
  it('is an exact decimal ladder from zero to the maximum', () => {
    const rates = sweepRates()
    expect(rates[0]).toBe(0)
    expect(rates[rates.length - 1]).toBe(SWEEP_MAX)
    expect(rates).toHaveLength(sweepLength())
    // Exact, not merely close. A rate computed as `i * 0.005` is
    // 0.035000000000000003 at the eighth rung, which prints an extra digit and
    // fails any comparison against a rate arrived at another way.
    expect(rates).toContain(0.035)
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]! - rates[i - 1]!).toBeCloseTo(SWEEP_STEP, 12)
    }
  })
})

describe('sweepVariant', () => {
  it('replaces the extra with a constant share of the starting capital', () => {
    const params = plan({ cashflow: buildCashflow(20, 200_000, 100_000) })
    const variant = sweepVariant(params, 0.03)
    expect(variant.cashflow.every((year) => year.extra === 180_000)).toBe(true)
    // The need is the plan's own, untouched.
    expect(variant.cashflow.map((year) => year.need)).toEqual(
      params.cashflow.map((year) => year.need),
    )
  })

  it('keeps the shape of the need, including deposit years', () => {
    const cashflow = buildCashflow(20, 200_000, 100_000)
    cashflow[0] = { need: -500_000, extra: 100_000 }
    cashflow[5] = { need: 400_000, extra: 0 }
    const variant = sweepVariant(plan({ cashflow }), 0.01)
    expect(variant.cashflow[0]!.need).toBe(-500_000)
    expect(variant.cashflow[5]!.need).toBe(400_000)
    expect(variant.cashflow.every((year) => year.extra === 60_000)).toBe(true)
  })
})

describe('sweepPoints', () => {
  it('starts at the need run, which is what a zero extra withdrawal is', () => {
    // The left end of the curve is not a swept outcome at all: with no extra to
    // brake, the adaptive rule pays the need and nothing else, so the point has
    // to agree with the Minimum run of the same plan. If it ever stops
    // agreeing, the sweep is varying something it should not be.
    const params = plan()
    const first = sweepPoints(params).next().value!
    const { needRun } = runPlanner(params)
    expect(first.rate).toBe(0)
    expect(first.extra).toBe(0)
    expect(first.survival).toBeCloseTo(1 - needRun.finalDistribution.ruinProbability, 10)
    expect(first.expectedWithdrawn).toBeCloseTo(needRun.expectedWithdrawn, 6)
  })

  it('falls as the withdrawal rises, and flattens where the brake takes over', () => {
    const points = [...sweepPoints(plan())]
    expect(points).toHaveLength(sweepLength())

    // Monotone: raising the ceiling on discretionary spending can only spend
    // more. A tolerance of a tenth of a point absorbs the grid's own
    // quantisation of the ruin mass, which is what the shared grid keeps small.
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.survival).toBeLessThanOrEqual(points[i - 1]!.survival + 0.001)
    }
    expect(points[points.length - 1]!.survival).toBeLessThan(points[0]!.survival)

    // The adaptive rule is still in force, so the curve bottoms out rather than
    // heading for zero: past some rate the surplus, not the ceiling, is what
    // decides the payout. The last step is a fraction of the first.
    const firstStep = points[0]!.survival - points[1]!.survival
    const lastStep = points[points.length - 2]!.survival - points[points.length - 1]!.survival
    expect(lastStep).toBeLessThan(firstStep)
    expect(points[points.length - 1]!.survival).toBeGreaterThan(0.1)
  })

  it('declines much of what the level asks for, and says so', () => {
    // The point the card exists to make. Under the adaptive rule the swept rate
    // is a ceiling, so survival flattens out — but only because the plan is not
    // spending it. Reading the survival curve alone would take that flatness as
    // a level the plan can carry, when what it actually means is that the level
    // is never reached. The gap between planned and expected is the correction,
    // and it has to widen as the level rises.
    const points = [...sweepPoints(plan())]
    const low = points[1]!
    const high = points[points.length - 1]!
    expect(high.plannedWithdrawn).toBeGreaterThan(low.plannedWithdrawn)
    expect(high.expectedWithdrawn).toBeLessThan(high.plannedWithdrawn)
    const gap = (p: SweepPoint) => p.plannedWithdrawn - p.expectedWithdrawn
    expect(gap(high)).toBeGreaterThan(gap(low))
  })

  it('annualises to an envelope the average sits inside', () => {
    // The chart is per year, because a forty-year total cannot be read against
    // a rule of thumb stated as a rate. The average is `expectedWithdrawn`
    // divided by the horizon, and min/max are over the same per-year means it
    // sums, so the band must bracket the line — if it ever does not, the two
    // are no longer measuring the same thing.
    for (const point of sweepPoints(plan())) {
      expect(expectedPerYear(point)).toBeGreaterThanOrEqual(point.minWithdrawal - 1e-6)
      expect(expectedPerYear(point)).toBeLessThanOrEqual(point.maxWithdrawal + 1e-6)
      expect(plannedPerYear(point) * point.years).toBeCloseTo(point.plannedWithdrawn, 6)
    }
  })

  it('opens the envelope as the level rises, and the average lags the plan', () => {
    const points = [...sweepPoints(plan())]
    const spread = (p: SweepPoint) => p.maxWithdrawal - p.minWithdrawal
    expect(spread(points[points.length - 1]!)).toBeGreaterThan(spread(points[1]!))
    // Under the adaptive rule the average delivered falls short of the planned
    // amount, and by more as the ceiling rises — the same statement as the
    // totals, in the unit the chart now uses.
    const last = points[points.length - 1]!
    expect(expectedPerYear(last)).toBeLessThan(plannedPerYear(last))
  })

  it('never delivers more than it planned, at either end of the envelope', () => {
    // A year cannot hand over more than it set out to, so the delivered
    // envelope sits inside the planned one and the average sits inside both.
    // That is why the chart can draw the two as envelope against envelope and
    // why a delivered curve crossing above a planned one would be a bug rather
    // than a finding.
    for (const point of sweepPoints(plan())) {
      expect(point.maxWithdrawal).toBeLessThanOrEqual(point.plannedMax + 1e-6)
      expect(point.minWithdrawal).toBeLessThanOrEqual(point.plannedMin + 1e-6)
      expect(expectedPerYear(point)).toBeLessThanOrEqual(plannedPerYear(point) + 1e-6)
      expect(point.minWithdrawal).toBeLessThanOrEqual(expectedPerYear(point) + 1e-6)
    }
  })

  it('finds the level that delivers the most under a fixed schedule', () => {
    // A real turning point: spending more than this hands the household less,
    // because the extra costs more years than it buys. It is the answer the
    // card's mark exists to give, and it only exists for a rule that can
    // overspend.
    const points = [...sweepPoints(plan(), 'fixed')]
    const level = peakDeliveryLevel(points)!
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThan(SWEEP_MAX)
    const at = points.find((point) => point.rate === level)!
    for (const point of points) {
      expect(expectedPerYear(point)).toBeLessThanOrEqual(expectedPerYear(at) + 1e-6)
    }
    // And the far end really is past the top, not merely level with it.
    expect(expectedPerYear(points[points.length - 1]!)).toBeLessThan(expectedPerYear(at) * 0.99)
  })

  it('has no such level under the adaptive rule, which declines instead of overspending', () => {
    // Not a gap in the mark but the finding itself: raising a ceiling the rule
    // is free to decline never costs delivered kronor, so the curve is still
    // climbing at the end of the swept range and there is no level to stay
    // under.
    const points = [...sweepPoints(plan())]
    expect(peakDeliveryLevel(points)).toBeNull()
    for (let i = 1; i < points.length; i++) {
      expect(expectedPerYear(points[i]!)).toBeGreaterThan(expectedPerYear(points[i - 1]!))
    }
  })

  it('reports nothing while the sweep is still filling in', () => {
    // The highest point so far is always the last one computed, so a partial
    // sweep has nothing that has been shown to turn over.
    const partial = [...sweepPoints(plan(), 'fixed')].slice(0, 4)
    expect(peakDeliveryLevel(partial)).toBeNull()
  })

  it('brackets the delivered envelope inside the planned one, year for year', () => {
    // What makes the two sides of the chart comparable. A year cannot hand over
    // more than it planned to, so its envelope sits inside the planned one —
    // and against the plan's *mean* instead, a shaped cash flow would look like
    // it was overpaying.
    const cashflow = buildCashflow(20, 200_000, 0)
    for (let i = 0; i < 6; i++) cashflow[i] = { need: 500_000, extra: 0 }
    for (const point of sweepPoints(plan({ cashflow }))) {
      expect(point.maxWithdrawal).toBeLessThanOrEqual(point.plannedMax + 1e-6)
      expect(point.minWithdrawal).toBeLessThanOrEqual(point.plannedMin + 1e-6)
      // The shaped case the envelope exists for: the best delivered year is
      // above the plan's average, which is not an overpayment.
      expect(point.plannedMax).toBeGreaterThan(plannedPerYear(point))
    }
  })

  it('moves the kept-capital curve where survival barely moves', () => {
    // The reason the chart has a second curve at all. The adaptive rule's job
    // is to keep survival flat, so a sweep that reported only survival would
    // look like a plan indifferent to how much it spends. What the level
    // actually costs lands on the terminal capital.
    const points = [...sweepPoints(plan())]
    const first = points[0]!
    const last = points[points.length - 1]!
    const survivalDrop = first.survival - last.survival
    const keepDrop = keepProbability(first)! - keepProbability(last)!
    expect(keepDrop).toBeGreaterThan(survivalDrop * 3)
  })

  it('plots the bequest target when the plan sets one, and the capital when it does not', () => {
    // The same measure at two thresholds, and the household's own threshold
    // wins where it has expressed one.
    const without = sweepPoints(plan()).next().value!
    expect(without.bequestProbability).toBeUndefined()
    expect(keepProbability(without)).toBe(without.preservationProbability)

    const withTarget = sweepPoints(plan({ bequestRatio: 0.5 })).next().value!
    expect(withTarget.bequestProbability).toBeDefined()
    expect(keepProbability(withTarget)).toBe(withTarget.bequestProbability)
    // Half the capital is an easier threshold than all of it, which is what
    // says the two are the same measure and not two different calculations.
    expect(withTarget.bequestProbability!).toBeGreaterThan(withTarget.preservationProbability!)
  })

  it('falls further without the rule, which is the original SAFEMAX question', () => {
    // Spending the level regardless of the balance is what Bengen asked about,
    // and it is strictly worse for survival at every level above zero: there is
    // no brake, so a bad sequence is spent straight through.
    const params = plan()
    const adaptive = [...sweepPoints(params, 'adaptive')]
    const fixed = [...sweepPoints(params, 'fixed')]
    // Taking nothing extra is the same plan under either rule.
    expect(fixed[0]!.survival).toBeCloseTo(adaptive[0]!.survival, 10)
    for (let i = 1; i < fixed.length; i++) {
      expect(fixed[i]!.survival).toBeLessThanOrEqual(adaptive[i]!.survival + 0.001)
    }
    expect(fixed[fixed.length - 1]!.survival).toBeLessThan(
      adaptive[adaptive.length - 1]!.survival - 0.05,
    )
    // And the fixed rule plans the same totals — it is the delivery that
    // differs, because a plan that has failed stops paying out entirely.
    expect(fixed[4]!.plannedWithdrawn).toBeCloseTo(adaptive[4]!.plannedWithdrawn, 6)
  })

  it('agrees with a standalone run of the same variant', () => {
    // The sweep shares one wealth grid across its rungs, which is what keeps
    // the curve free of quantisation wiggles. That grid is wider than any one
    // variant would build for itself, so the figures must still be the same
    // plan's to within the resolution — not a different answer arrived at
    // cheaply.
    const params = plan()
    const points = [...sweepPoints(params)]
    const at = points.find((p) => p.rate === 0.02)!
    const alone = adaptiveSummary(sweepVariant(params, 0.02))
    expect(at.survival).toBeCloseTo(alone.survival, 2)
    expect(at.expectedWithdrawn / alone.expectedWithdrawn).toBeCloseTo(1, 2)
  })

  it('runs an AF plan, where the cost basis is a second state dimension', () => {
    // Cheaper resolution than the default so the test is not a five-second
    // propagation: the point is that the sweep works at all for the account
    // type whose tax depends on a basis the withdrawal itself moves.
    const params = plan({
      accountType: 'AF',
      years: 12,
      basisNodes: 8,
      gridNodes: 200,
      initialCostBasisRatio: 0.5,
      cashflow: buildCashflow(12, 200_000, 100_000),
    })
    const points = [...sweepPoints(params)]
    expect(points).toHaveLength(sweepLength())
    expect(points[points.length - 1]!.survival).toBeLessThanOrEqual(points[0]!.survival)
  })
})

describe('crossingFor', () => {
  it('interpolates between the rungs it brackets', () => {
    const points = [point(0, 0.99), point(0.01, 0.95), point(0.02, 0.85)]
    const crossing = crossingFor(points, 0.9)!
    expect(crossing.atLeast).toBe(false)
    // Halfway between 0.95 and 0.85 is halfway between the two rates.
    expect(crossing.rate).toBeCloseTo(0.015, 12)
    expect(crossing.extra).toBeCloseTo(15_000, 6)
    // And the two amounts come along, interpolated the same way and divided by
    // the horizon. Without them the table would report a level and let it be
    // read as income, which under either rule it is not; and without the
    // division it would report a forty-year total against a rule of thumb
    // stated per year.
    expect(crossing.plannedPerYear).toBeCloseTo(15_000, 6)
    expect(crossing.expectedPerYear).toBeCloseTo(7_500, 6)
  })

  it('reports a bound when the curve never falls below the target', () => {
    const crossing = crossingFor([point(0, 0.99), point(0.01, 0.97)], 0.9)!
    expect(crossing.atLeast).toBe(true)
    expect(crossing.rate).toBe(0.01)
  })

  it('has nothing to report when the need alone misses the target', () => {
    // Not a rate of zero, which would read as "zero is affordable". The need is
    // below the target however little else is taken, and no extra withdrawal
    // buys survival back.
    expect(crossingFor([point(0, 0.7), point(0.01, 0.6)], 0.9)).toBeNull()
    expect(crossingFor([], 0.9)).toBeNull()
  })

  it('takes the first crossing when the curve wobbles back over the target', () => {
    // The curve is monotone in theory but quantised in practice, so a nearly
    // flat stretch can dip under a target and come back. The conservative
    // reading is the first rate that fails it, not the last.
    const points = [point(0, 0.95), point(0.01, 0.88), point(0.02, 0.91), point(0.03, 0.8)]
    const crossing = crossingFor(points, 0.9)!
    expect(crossing.rate).toBeGreaterThan(0)
    expect(crossing.rate).toBeLessThan(0.01)
  })

  it('counts a rung that lands exactly on the target as reaching it', () => {
    const points = [point(0, 0.95), point(0.01, 0.9), point(0.02, 0.8)]
    expect(crossingFor(points, 0.9)!.rate).toBeCloseTo(0.01, 12)
  })
})

describe('levelMarks', () => {
  /**
   * The page's own default plan: forty years rather than twenty, which is long
   * enough that the adaptive rule's survival curve never leaves the eighties
   * and its ladder yields nothing. The shorter plan above is comfortable enough
   * to cross 95% even adaptively, so it cannot exercise the fallback.
   */
  const longPlan = () => ({ ...defaultPlannerParameters(), iskAllowance: 0 })

  it('prefers survival wherever it genuinely crosses something', () => {
    // A fixed schedule's survival falls all the way, so the ladder fits it and
    // the marks are the answer the card is built around.
    const { family, marks } = levelMarks([...sweepPoints(plan(), 'fixed')])
    expect(family).toBe('survival')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) expect(SURVIVAL_TARGETS).toContain(mark.target)
    // Stricter target, lower level — the ordering that makes the marks readable
    // left to right.
    const sorted = [...marks].sort((a, b) => b.target - a.target)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.rate).toBeGreaterThan(sorted[i - 1]!.rate)
    }
  })

  it('switches on having no crossing at all, not on missing 95%', () => {
    // The distinction matters. On the forty-year plan under a fixed schedule
    // 95% is out of reach from the first rung, but 80% crosses at well under
    // one per cent — a usable answer that a "must reach 95%" test would have
    // thrown away in favour of the other curve.
    const points = [...sweepPoints(longPlan(), 'fixed')]
    expect(crossingFor(points, 0.95)).toBeNull()
    expect(levelMarks(points).family).toBe('survival')
    const eighty = levelMarks(points).marks.find((mark) => mark.target === 0.8)!
    expect(eighty.rate).toBeGreaterThan(0)
    expect(eighty.rate).toBeLessThan(0.02)
  })

  it('falls back to the kept-capital curve when survival says nothing', () => {
    // The adaptive rule holds survival flat by design, so its ladder yields
    // only bounds — a line at the edge of the chart marking nothing. What moves
    // on that plan is the capital left at the end, so that is what gets marked.
    const points = [...sweepPoints(longPlan())]
    for (const target of SURVIVAL_TARGETS) {
      const crossing = crossingFor(points, target)
      expect(crossing === null || crossing.atLeast).toBe(true)
    }
    const { family, marks } = levelMarks(points)
    expect(family).toBe('keep')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) expect(KEEP_TARGETS).toContain(mark.target)
  })

  it('picks the ladder as well as the curve, since neither sits anywhere fixed', () => {
    // A comfortable plan: survival is 100% across the whole swept range, so its
    // ladder yields only bounds, and the kept-capital curve stays in the
    // nineties, where the quartiles are unreachable. With one fixed ladder per
    // curve the chart came out completely unannotated. The survival thresholds
    // applied to the kept-capital curve are what fit here.
    const comfortable = plan({
      initialCapital: 30_000_000,
      years: 40,
      bequestRatio: 0.3,
      cashflow: buildCashflow(40, 300_000, 300_000),
    })
    const points = [...sweepPoints(comfortable)]
    expect(points[points.length - 1]!.survival).toBeGreaterThan(0.99)
    expect(keepProbability(points[points.length - 1]!)!).toBeGreaterThan(Math.max(...KEEP_TARGETS))

    const { family, marks } = levelMarks(points)
    expect(family).toBe('keep')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) expect(SURVIVAL_TARGETS).toContain(mark.target)
  })

  it('needs its own ladder for that curve, which lives far lower', () => {
    // Why KEEP_TARGETS exists at all: reusing the survival thresholds would
    // draw nothing, because leaving the whole starting capital behind after
    // decades of withdrawals is hard and the curve never gets near 80%. Its
    // best value is at the left end, where nothing discretionary is taken.
    for (const params of [plan(), longPlan()]) {
      const best = keepProbability([...sweepPoints(params)][0]!)!
      expect(best).toBeLessThan(Math.min(...SURVIVAL_TARGETS))
    }
  })

  it('falls monotonically, which is what makes a level readable off a threshold', () => {
    // The whole mapping rests on this: a probability that wandered up and down
    // would not name one level.
    for (const rule of ['adaptive', 'fixed'] as const) {
      const points = [...sweepPoints(plan(), rule)]
      for (let i = 1; i < points.length; i++) {
        expect(keepProbability(points[i]!)!).toBeLessThanOrEqual(
          keepProbability(points[i - 1]!)! + 1e-6,
        )
      }
    }
  })

  it('reports no marks rather than inventing them', () => {
    // A plan whose kept-capital curve never leaves the band between two
    // thresholds has no level to point at, and saying so is the honest report.
    expect(levelMarks([]).marks).toHaveLength(0)
  })
})

describe('planExtraRate', () => {
  it('places a flat extra on the curve', () => {
    const params = plan({ cashflow: buildCashflow(20, 200_000, 120_000) })
    expect(planExtraRate(params)).toBeCloseTo(0.02, 12)
  })

  it('declines to place a shaped extra, which is not a member of the family', () => {
    const cashflow = buildCashflow(20, 200_000, 100_000)
    cashflow[3] = { need: 200_000, extra: 400_000 }
    expect(planExtraRate(plan({ cashflow }))).toBeNull()
  })

  it('has no rate to report without a starting capital', () => {
    const params = plan({ initialCapital: 0 })
    expect(canSweep(params)).toBe(false)
    expect(planExtraRate(params)).toBeNull()
  })
})

function mountCard(params: PlannerParameters) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlannerStore()
  store.$patch({ ...params })
  store.run()
  return { wrapper: mount(SweepCard, { global: { plugins: [pinia] } }), store }
}

type Wrapper = ReturnType<typeof mountCard>['wrapper']

/** The points the chart has been handed, which is the sweep's own progress. */
function drawn(wrapper: Wrapper): SweepPoint[] {
  const chart = wrapper.findComponent(SweepChart)
  return chart.exists() ? (chart.props('points') as SweepPoint[]) : []
}

async function until(wrapper: Wrapper, what: string, ready: () => boolean) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    await wrapper.vm.$nextTick()
    if (ready()) return
  }
  throw new Error(`gave up waiting for ${what}, saw ${drawn(wrapper).length} points`)
}

const settle = (wrapper: Wrapper, expected: number) =>
  until(wrapper, `${expected} points`, () => drawn(wrapper).length === expected)

async function openCard(wrapper: Wrapper) {
  await wrapper.get('button[aria-controls]').trigger('click')
  await wrapper.vm.$nextTick()
}

describe('SweepCard', () => {
  // Short, because every test here pays for a whole sweep.
  const short = () =>
    plan({ years: 10, initialCapital: 6_000_000, cashflow: buildCashflow(10, 300_000, 50_000) })

  it('computes nothing until it is opened', async () => {
    const { wrapper } = mountCard(short())
    expect(wrapper.get('button[aria-controls]').attributes('aria-expanded')).toBe('false')
    // Bootstrap's collapse hides with CSS rather than unmounting, so the chart
    // is in the DOM either way. What must not have happened is the work: this
    // card is seventeen propagations, and paying for them on every edit is the
    // whole reason it starts closed.
    expect(wrapper.get('#planner-sweep-body').classes()).not.toContain('show')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(drawn(wrapper)).toHaveLength(0)
  })

  it('fills the curve in and reports a rate per target', async () => {
    const { wrapper } = mountCard(short())
    await openCard(wrapper)
    // Waited on the table rather than the point count: the table appears one
    // tick after the last rung, when the sweep settles.
    await until(wrapper, 'the table', () => wrapper.findAll('tbody tr').length > 0)

    const cells = wrapper.findAll('tbody tr')
    expect(cells).toHaveLength(SURVIVAL_TARGETS.length)
    // A comfortable plan reaches every target, and a stricter one costs a lower
    // rate — which is the whole shape of the answer the card exists to give.
    const points = drawn(wrapper)
    const rates = SURVIVAL_TARGETS.map((target) => crossingFor(points, target)!.rate)
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]!).toBeGreaterThanOrEqual(rates[i - 1]!)
    }
  })

  it('lets the curve fill in but holds the table back until the sweep settles', async () => {
    // A curve growing a point at a time reads as progress; a table rewriting
    // its figures seventeen times reads as flicker, and the early rungs
    // genuinely do give different answers — a target the sweep has not reached
    // down to yet is reported as a bound and firms up into a crossing later.
    const { wrapper } = mountCard(short())
    await openCard(wrapper)

    let sawPartialCurve = false
    let sawPartialTable = false
    await until(wrapper, 'the sweep to settle', () => {
      const drawnCount = drawn(wrapper).length
      const rows = wrapper.findAll('tbody tr').length
      if (drawnCount > 0 && drawnCount < sweepLength()) {
        sawPartialCurve = true
        if (rows > 0) sawPartialTable = true
      }
      return rows > 0 && drawnCount === sweepLength()
    })

    // Both halves matter: without the first the test would pass on a sweep too
    // fast to observe, and prove nothing about the second.
    expect(sawPartialCurve).toBe(true)
    expect(sawPartialTable).toBe(false)
  })

  it('resweeps without the rule when the switch is turned off', async () => {
    const { wrapper } = mountCard(short())
    await openCard(wrapper)
    await settle(wrapper, sweepLength())
    const withRule = drawn(wrapper)[sweepLength() - 1]!.survival

    await wrapper.get('#planner-sweep-adaptive').setValue(false)
    // Waited out by value rather than by length: the previous curve stays up
    // through the debounce, so a full-length curve alone could still be the old
    // rule's and the test would pass for the wrong reason.
    await until(
      wrapper,
      'the curve to be reswept',
      () =>
        drawn(wrapper).length === sweepLength() &&
        drawn(wrapper)[sweepLength() - 1]!.survival !== withRule,
    )
    // Spending the level regardless of the balance costs survival, and the card
    // has to recompute rather than relabel: the switch changes the model, not
    // the presentation.
    expect(drawn(wrapper)[sweepLength() - 1]!.survival).toBeLessThan(withRule)
  })

  it('abandons a sweep in flight when the card is closed', async () => {
    const { wrapper } = mountCard(short())
    await openCard(wrapper)
    await openCard(wrapper)
    await new Promise((resolve) => setTimeout(resolve, 500))
    // Closing has to stop the work rather than merely hide it; a sweep left
    // running behind a closed card is seconds of thread nobody asked for.
    expect(drawn(wrapper)).toHaveLength(0)
  })

  it('says so when the plan has no capital to take a share of', async () => {
    const { wrapper } = mountCard(
      plan({ years: 10, initialCapital: 0, cashflow: buildCashflow(10, -200_000, 0) }),
    )
    await openCard(wrapper)
    expect(wrapper.text()).toContain('andel av startkapitalet')
    expect(wrapper.findComponent(SweepChart).exists()).toBe(false)
  })
})

describe('SURVIVAL_TARGETS', () => {
  it('runs from strict to loose, which is the order the table prints', () => {
    for (let i = 1; i < SURVIVAL_TARGETS.length; i++) {
      expect(SURVIVAL_TARGETS[i]!).toBeLessThan(SURVIVAL_TARGETS[i - 1]!)
    }
  })
})
