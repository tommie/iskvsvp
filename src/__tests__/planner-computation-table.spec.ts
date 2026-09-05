import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import ComputationTable from '../components/planner/ComputationTable.vue'
import { usePlannerStore } from '../stores/planner'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import { formatKr } from '../planner/format'
import type { PlannerParameters } from '../planner/types'

function plan(overrides: Partial<PlannerParameters> = {}): PlannerParameters {
  return {
    ...defaultPlannerParameters(),
    years: 12,
    initialCapital: 9_000_000,
    cashflow: buildCashflow(12, 200_000, 100_000),
    ...overrides,
  }
}

function mountTable(params: PlannerParameters) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlannerStore()
  store.$patch({ ...params })
  store.run()
  return { wrapper: mount(ComputationTable, { global: { plugins: [pinia] } }), store }
}

const headers = (wrapper: ReturnType<typeof mountTable>['wrapper']) => wrapper.findAll('thead th')

describe('ComputationTable', () => {
  it('starts collapsed', () => {
    // It is the working, not the answer. A card that opens itself would push
    // the results the reader came for off the screen.
    const { wrapper } = mountTable(plan())
    const details = wrapper.get('details')
    expect(details.attributes('open')).toBeUndefined()
  })

  it('gives every cash-flow year exactly one row', () => {
    const { wrapper } = mountTable(plan())
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(12)
    expect(rows[0]!.findAll('td')).toHaveLength(headers(wrapper).length)
  })

  it('shows the schedule the rule actually used, not a recomputation', () => {
    // The reserve column is the engine's own `schedule.reserve`, so a plan whose
    // needs are all identical has a reserve that falls monotonically as they are
    // paid off, ending at one year's need in the final row.
    const { wrapper, store } = mountTable(plan())
    const schedule = store.results!.schedule
    const reserveColumn = headers(wrapper).findIndex((th) => th.text() === 'Reserv')
    expect(reserveColumn).toBeGreaterThanOrEqual(0)

    const rows = wrapper.findAll('tbody tr')
    for (let t = 0; t < rows.length; t++) {
      expect(rows[t]!.findAll('td')[reserveColumn]!.text()).toBe(formatKr(schedule.reserve[t]!))
    }
    expect(schedule.reserve[0]).toBeGreaterThan(schedule.reserve[11]!)
    expect(schedule.reserve[11]).toBeCloseTo(200_000, 6)
  })

  it('explains each column on hover, and carries the same text for those who cannot hover', () => {
    const { wrapper } = mountTable(plan())
    const bar = () => wrapper.get('.formula-bar')

    // Nothing hovered: a prompt rather than a stale formula.
    expect(bar().text()).toContain('Håll muspekaren')
    expect(bar().find('code').exists()).toBe(false)

    const annuity = headers(wrapper).find((th) => th.text() === 'Annuitetsfaktor')!
    // Touch and assistive technology have no pointer, so the same text is on the
    // element itself.
    expect(annuity.attributes('title')).toContain('extra[s]')
    expect(annuity.attributes('tabindex')).toBe('0')

    return annuity.trigger('mouseenter').then(async () => {
      expect(bar().get('code').text()).toContain('extra[s]')
      expect(bar().text()).toContain('överskott')
      await annuity.trigger('mouseleave')
      expect(bar().find('code').exists()).toBe(false)
    })
  })

  it('keyboard focus works the same as the pointer', async () => {
    const { wrapper } = mountTable(plan())
    const reserve = headers(wrapper).find((th) => th.text() === 'Reserv')!
    await reserve.trigger('focus')
    expect(wrapper.get('.formula-bar').get('code').text()).toContain('behov[s]')
    await reserve.trigger('blur')
    expect(wrapper.get('.formula-bar').find('code').exists()).toBe(false)
  })

  it('renders nothing at all when the plan has no results', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    usePlannerStore()
    const wrapper = mount(ComputationTable, { global: { plugins: [pinia] } })
    expect(wrapper.find('details').exists()).toBe(false)
  })
})
