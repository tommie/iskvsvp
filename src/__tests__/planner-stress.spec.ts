import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import StressCard from '../components/planner/StressCard.vue'
import { usePlannerStore } from '../stores/planner'
import {
  isStressed,
  stressDimensionsFor,
  stressedParams,
  stressFactor,
  stressScenarios,
  STRESS_DIMENSIONS,
  type StressLevels,
} from '../planner/stress'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import type { PlannerParameters } from '../planner/types'

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

const at = (id: string, level: number): StressLevels => ({ [id]: level })
const dimension = (id: string) => STRESS_DIMENSIONS.find((d) => d.id === id)!

describe('stressFactor', () => {
  it('is geometric, so the two directions are reciprocals at every position', () => {
    // The property that makes a single good-to-bad axis honest: at any slider
    // position the good and bad sides are off the plan by the same proportion.
    // On an arithmetic scale +50% and −50% are not the same move.
    for (const level of [0.25, 0.5, 0.75, 1]) {
      const bad = stressFactor(dimension('need'), level, 'bad')
      const good = stressFactor(dimension('need'), level, 'good')
      expect(bad * good).toBeCloseTo(1, 12)
    }
    expect(stressFactor(dimension('need'), 0.5, 'bad')).toBeCloseTo(Math.SQRT2, 12)
    expect(stressFactor(dimension('need'), 1, 'bad')).toBe(2)
  })

  it('points every dimension the same way, whichever way is worse for it', () => {
    // More need is worse; less return is worse. The card can only put them on
    // one axis because each dimension says which of its directions hurts.
    expect(stressFactor(dimension('need'), 1, 'bad')).toBeGreaterThan(1)
    expect(stressFactor(dimension('return'), 1, 'bad')).toBeLessThan(1)
    expect(stressFactor(dimension('return'), 1, 'good')).toBeGreaterThan(1)
  })

  it('leaves the plan alone at zero and in the middle column', () => {
    for (const d of STRESS_DIMENSIONS) {
      expect(stressFactor(d, 0, 'bad')).toBe(1)
      expect(stressFactor(d, 1, 'base')).toBe(1)
    }
  })
})

describe('stressedParams', () => {
  it('touches nothing a slider has not been moved for', () => {
    const params = plan()
    expect(stressedParams(params, {}, 'bad')).toBe(params)
    expect(stressedParams(params, at('need', 0), 'bad')).toBe(params)
  })

  it('combines every stressed dimension in the same direction at once', () => {
    // The point of one axis over a grid: plans rarely fail because a single
    // assumption was wrong.
    const params = plan()
    const both = stressedParams(params, { need: 1, return: 1 }, 'bad')
    expect(both.cashflow[0]!.need).toBeCloseTo(params.cashflow[0]!.need * 2, 6)
    expect(both.assets[0]!.expectedRealReturn).toBeCloseTo(
      params.assets[0]!.expectedRealReturn / 2,
      12,
    )
  })

  it('scales a deposit with the need rather than against it', () => {
    // A negative need is money going in. The dimension asks "what if this is
    // wrong by a factor of two"; flipping the sign for deposits asks something
    // else entirely.
    const params = plan({ years: 4, cashflow: buildCashflow(4, -100_000, 0) })
    expect(stressedParams(params, at('need', 1), 'bad').cashflow[0]!.need).toBeCloseTo(-200_000, 6)
  })

  it('stresses whichever schablon the account actually pays', () => {
    const isk = stressedParams(plan(), at('schablon', 1), 'bad')
    expect(isk.iskTaxRate).toBeCloseTo(plan().iskTaxRate * 2, 12)
    expect(isk.afSchablonRate).toBe(plan().afSchablonRate)

    const af = stressedParams(plan({ accountType: 'AF' }), at('schablon', 1), 'bad')
    expect(af.afSchablonRate).toBeCloseTo(plan().afSchablonRate * 2, 12)
    expect(af.iskTaxRate).toBe(plan().iskTaxRate)
  })

  it('moves the means without the spreads, and the spreads without the means', () => {
    // Two dimensions, not one: confounding them would make the answer
    // unattributable.
    const params = plan()
    const returns = stressedParams(params, at('return', 1), 'bad')
    const spread = stressedParams(params, at('volatility', 1), 'bad')
    expect(returns.assets[0]!.volatility).toBe(params.assets[0]!.volatility)
    expect(spread.assets[0]!.expectedRealReturn).toBe(params.assets[0]!.expectedRealReturn)
    expect(spread.assets[0]!.volatility).toBeCloseTo(params.assets[0]!.volatility * 2, 12)
  })
})

describe('stressScenarios', () => {
  it('orders the three columns worst to best on survival', () => {
    const result = stressScenarios(plan(), { need: 1, return: 1 })
    expect(result.good.survival).toBeGreaterThan(result.base.survival)
    expect(result.base.survival).toBeGreaterThan(result.bad.survival)
  })

  it('gives all three the same answer when nothing is stressed', () => {
    // And computes it once: three propagations to print one number three times
    // is waste an AF plan cannot afford.
    const result = stressScenarios(plan(), {})
    expect(result.good.survival).toBe(result.base.survival)
    expect(result.bad.finalMedian).toBe(result.base.finalMedian)
    expect(isStressed(plan(), {})).toBe(false)
  })

  it('reports the planned total per scenario, since stressing changes it', () => {
    const result = stressScenarios(plan(), at('need', 1))
    // 20 years of 200k need and 100k extra; the bad column doubles the need.
    expect(result.base.plannedWithdrawn).toBeCloseTo(6_000_000, 6)
    expect(result.bad.plannedWithdrawn).toBeCloseTo(10_000_000, 6)
    expect(result.good.plannedWithdrawn).toBeCloseTo(4_000_000, 6)
  })

  it('offers inflation to an AF and not to an ISK', () => {
    // Everything here is real, so inflation only reaches the result through the
    // nominal thresholds in the tax code. An AF carries an unindexed
    // acquisition cost, so a rising price level is taxed as gain; an ISK has
    // only the fribelopp, worth a few tenths of a point. Both halves are
    // pinned: the ISK claim is a statement about the model, and a regression
    // that made it matter should not pass silently just because the slider is
    // hidden.
    const ids = (params: PlannerParameters) => stressDimensionsFor(params).map((d) => d.id)
    expect(ids(plan())).not.toContain('inflation')
    expect(ids(plan({ accountType: 'AF' }))).toContain('inflation')

    const spread = (params: PlannerParameters) => {
      const result = stressScenarios(params, at('inflation', 1))
      return result.good.survival - result.bad.survival
    }
    expect(spread(plan({ accountType: 'AF', initialCostBasisRatio: 0.5 }))).toBeGreaterThan(0.02)
  })

  it('ignores a level for a dimension this plan does not offer', () => {
    // Switching to an ISK must not leave an inflation stress silently in force
    // behind a slider that is no longer on screen.
    const params = plan()
    expect(stressedParams(params, at('inflation', 1), 'bad')).toBe(params)
    expect(isStressed(params, at('inflation', 1))).toBe(false)
  })
})

function mountCard(params: PlannerParameters) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlannerStore()
  store.$patch({ ...params })
  store.run()
  return { wrapper: mount(StressCard, { global: { plugins: [pinia] } }), store }
}

describe('StressCard', () => {
  const rows = (wrapper: ReturnType<typeof mountCard>['wrapper']) => wrapper.findAll('tbody tr')

  async function settle(wrapper: ReturnType<typeof mountCard>['wrapper'], expected: number) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      await wrapper.vm.$nextTick()
      if (rows(wrapper).length === expected) return
    }
    throw new Error(`gave up waiting for ${expected} rows, saw ${rows(wrapper).length}`)
  }

  async function openCard(wrapper: ReturnType<typeof mountCard>['wrapper']) {
    await wrapper.get('button[aria-controls]').trigger('click')
    await wrapper.vm.$nextTick()
  }

  async function drag(
    wrapper: ReturnType<typeof mountCard>['wrapper'],
    id: string,
    percent: number,
  ) {
    const slider = wrapper.get(`#stress-${id}`)
    await slider.setValue(String(percent))
    await slider.trigger('input')
  }

  it('starts closed, with every slider at zero', () => {
    const { wrapper } = mountCard(plan())
    expect(wrapper.get('button[aria-controls]').attributes('aria-expanded')).toBe('false')
    // Bootstrap's collapse hides with CSS rather than unmounting — it has to,
    // to animate a height — so the sliders exist but the region is not shown.
    expect(wrapper.get('#planner-stress-body').classes()).not.toContain('show')
    for (const slider of wrapper.findAll('input[type="range"]')) {
      expect((slider.element as HTMLInputElement).value).toBe('0')
    }
    // And nothing has been computed for them.
    expect(rows(wrapper)).toHaveLength(0)
  })

  it('offers a slider per dimension and no table until one is moved', async () => {
    const { wrapper } = mountCard(plan())
    await openCard(wrapper)
    // One per dimension this account type can be stressed on — an ISK plan
    // does not get the inflation slider, so this is not STRESS_DIMENSIONS.
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(stressDimensionsFor(plan()).length)
    expect(stressDimensionsFor(plan()).length).toBeLessThan(STRESS_DIMENSIONS.length)
    // aria-expanded rather than the `show` class: Bootstrap adds `collapsing`
    // first and only swaps in `show` when the transition ends, which jsdom does
    // not report. The card's own state flips on `show.bs.collapse`, at the
    // start, which is what this is asserting.
    expect(wrapper.get('button[aria-controls]').attributes('aria-expanded')).toBe('true')
    // Nothing stressed means the three columns would be one number printed
    // three times, so the card says what to do instead.
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('Dra ett reglage')
  })

  it('shows the three scenarios once a dimension is stressed', async () => {
    const { wrapper } = mountCard(plan())
    await openCard(wrapper)
    await drag(wrapper, 'need', 100)
    await settle(wrapper, 6)

    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual([
      '',
      'Lägre risk',
      'Plan',
      'Högre risk',
    ])
    // Six rows: no bequest target on this plan, so that row is left out rather
    // than printed as three dashes.
    expect(rows(wrapper)[0]!.text()).toContain('Totalt planerat uttag')
    expect(
      rows(wrapper)
        .map((r) => r.findAll('td'))
        .every((tds) => tds.length === 3),
    ).toBe(true)
  })

  it('tints the good column better and the bad column worse', async () => {
    const { wrapper } = mountCard(plan())
    await openCard(wrapper)
    await drag(wrapper, 'need', 100)
    await settle(wrapper, 6)

    // Survival is the third row; every row here is higher-is-better.
    const survival = rows(wrapper)[2]!.findAll('td')
    expect(survival[0]!.classes()).toContain('up')
    expect(survival[1]!.classes()).not.toContain('up')
    expect(survival[1]!.classes()).not.toContain('down')
    expect(survival[2]!.classes()).toContain('down')
  })

  it('states the two outer columns against the plan, and leaves the plan alone', async () => {
    const { wrapper } = mountCard(plan())
    await openCard(wrapper)
    await drag(wrapper, 'need', 100)
    await settle(wrapper, 6)
    const absolute = rows(wrapper).map((r) => r.findAll('td').map((d) => d.text()))

    await wrapper.get('input[type="checkbox"]').setValue(true)
    const relative = rows(wrapper).map((r) => r.findAll('td').map((d) => d.text()))

    // The middle column is the reference; three zeroes there would delete the
    // anchor the others are read against.
    expect(relative.map((r) => r[1])).toEqual(absolute.map((r) => r[1]))
    // Survival in points, the money rows relative.
    expect(relative[2]![2]).toContain('p.e.')
    expect(relative[1]![2]).toContain('%')
  })

  it('spins alone on the first computation, with nothing yet to show', async () => {
    const { wrapper } = mountCard(plan())
    await openCard(wrapper)
    await drag(wrapper, 'need', 100)

    // Debounced, so the card is busy before any work starts: the wait and the
    // work are indistinguishable from outside.
    expect(wrapper.find('.spinner-border').exists()).toBe(true)
    // Screen readers get the word the spinner replaced.
    expect(wrapper.get('.spinner-border').text()).toBe('Räknar…')
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.find('.overlay').exists()).toBe(false)

    await settle(wrapper, 6)
    expect(wrapper.find('.spinner-border').exists()).toBe(false)
  })

  it('keeps the previous figures under the spinner while it recomputes', async () => {
    const { wrapper } = mountCard(plan())
    await openCard(wrapper)
    await drag(wrapper, 'need', 100)
    await settle(wrapper, 6)
    const before = rows(wrapper)[2]!
      .findAll('td')
      .map((d) => d.text())

    await drag(wrapper, 'return', 100)
    // Still there, still the old numbers, but marked busy and overlaid — which
    // is what stops them reading as current. Dropping them would empty the card
    // for most of a second on an AF plan, exactly while a reader is dragging.
    expect(rows(wrapper)).toHaveLength(6)
    expect(
      rows(wrapper)[2]!
        .findAll('td')
        .map((d) => d.text()),
    ).toEqual(before)
    expect(wrapper.get('.results').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('.overlay .spinner-border').exists()).toBe(true)

    await settle(wrapper, 6)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && wrapper.find('.overlay').exists()) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      await wrapper.vm.$nextTick()
    }
    expect(wrapper.find('.overlay').exists()).toBe(false)
    // Stressing a second dimension has to have moved something.
    expect(
      rows(wrapper)[2]!
        .findAll('td')
        .map((d) => d.text()),
    ).not.toEqual(before)
  })

  it('clears back to the plan as entered', async () => {
    const { wrapper } = mountCard(plan())
    await openCard(wrapper)
    await drag(wrapper, 'need', 100)
    await settle(wrapper, 6)

    await wrapper.get('.btn-outline-secondary').trigger('click')
    await wrapper.vm.$nextTick()
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('Dra ett reglage')
  })

  it('stops computing once it is closed', async () => {
    const { wrapper, store } = mountCard(plan())
    await openCard(wrapper)
    await drag(wrapper, 'need', 100)
    await settle(wrapper, 6)

    await wrapper.get('button[aria-controls]').trigger('click')
    expect(rows(wrapper)).toHaveLength(0)

    store.initialCapital = 20_000_000
    store.run()
    await new Promise((resolve) => setTimeout(resolve, 600))
    await wrapper.vm.$nextTick()
    expect(rows(wrapper)).toHaveLength(0)
  })
})
