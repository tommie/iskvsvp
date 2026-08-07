import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import OptionalSolver from '../components/planner/OptionalSolver.vue'
import { usePlannerStore } from '../stores/planner'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import { solveOptionalScale } from '../planner/solve'
import type { PlannerParameters } from '../planner/types'

/**
 * An ISK plan the solver has real work to do on: the drawn optional is well
 * above what the target survival allows, so a solve comes back with a
 * multiplier clearly below 1. ISK keeps a propagation at ~20 ms, which is what
 * makes a component test that runs the actual search affordable.
 */
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

function mountSolver(params: PlannerParameters) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlannerStore()
  // The parameter names on the store are the PlannerParameters names, so the
  // whole plan patches straight in; $patch replaces the arrays rather than
  // merging them, which matters for the cash flow.
  store.$patch({ ...params })
  store.run()

  const wrapper = mount(OptionalSolver, { global: { plugins: [pinia] } })
  return { wrapper, store }
}

/** Moves the slider and lets both the debounce and the solve's own yield run. */
async function setTarget(wrapper: ReturnType<typeof mountSolver>['wrapper'], percent: number) {
  const slider = wrapper.get('input[type="range"]')
  await slider.setValue(percent)
  await slider.trigger('input')
  await vi.runAllTimersAsync()
  await flushPromises()
}

const applyLink = (wrapper: ReturnType<typeof mountSolver>['wrapper']) =>
  wrapper.find('a.btn-primary')

describe('OptionalSolver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('solves on its own once the slider settles', async () => {
    const { wrapper } = mountSolver(plan())
    // Nothing is solved before the slider is touched: a search on load would
    // freeze the page before anyone has asked for anything.
    expect(applyLink(wrapper).exists()).toBe(false)

    await setTarget(wrapper, 65)

    expect(wrapper.text()).toContain('Ändring av tillvalet')
    expect(applyLink(wrapper).exists()).toBe(true)
    expect(applyLink(wrapper).attributes('href')).toContain('?')
  })

  it('shows the multiplier as a signed percentage change', async () => {
    const params = plan()
    const { wrapper } = mountSolver(params)
    await setTarget(wrapper, 65)

    // The target is well above what this plan survives at full optional, so the
    // answer has to be a cut.
    const expected = solveOptionalScale(params, 0.65)
    expect(expected.scale).toBeLessThan(0.95)
    const percent = Math.round((expected.scale - 1) * 100)
    // Two significant digits and a Swedish minus sign, via formatPercent.
    expect(wrapper.text()).toContain(`−${Math.abs(percent)}`)
    expect(wrapper.text()).not.toContain('×')
  })

  it('discards the previous answer as soon as the slider moves again', async () => {
    const { wrapper } = mountSolver(plan())
    await setTarget(wrapper, 65)
    expect(applyLink(wrapper).exists()).toBe(true)

    const slider = wrapper.get('input[type="range"]')
    await slider.setValue(60)
    await slider.trigger('input')
    // Still inside the debounce: the old multiplier belonged to a target the
    // slider no longer shows, so it must be gone rather than merely stale.
    expect(applyLink(wrapper).exists()).toBe(false)
    expect(wrapper.text()).toContain('Räknar…')
  })

  it('refuses to offer a rescale the plan does not need', async () => {
    // Solve once, apply the answer, and ask the same question of the result: the
    // plan is now at the level the target wants, so the multiplier is ~1.
    const params = plan()
    const solved = solveOptionalScale(params, 0.65)
    const applied = plan({
      cashflow: params.cashflow.map((year) => ({
        ...year,
        optional: year.optional * solved.scale,
      })),
    })

    const { wrapper } = mountSolver(applied)
    await setTarget(wrapper, 65)

    expect(wrapper.text()).toContain('Planen ligger redan på den nivån')
    expect(applyLink(wrapper).exists()).toBe(false)
    expect(wrapper.get('button.btn-primary').attributes('disabled')).toBeDefined()
  })
})
