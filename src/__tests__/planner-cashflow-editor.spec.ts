import { describe, it, expect, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import CashflowEditor from '../components/planner/CashflowEditor.vue'
import { usePlannerStore } from '../stores/planner'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import { formatKrExact } from '../planner/format'

/** D3Chart observes visibility to decide when to draw; jsdom has no such API. */
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

const YEARS = 10
const NEED = 200_000
const EXTRA = 100_000

function mountEditor() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlannerStore()
  store.$patch({
    ...defaultPlannerParameters(),
    years: YEARS,
    cashflow: buildCashflow(YEARS, NEED, EXTRA),
  })

  const wrapper = mount(CashflowEditor, { global: { plugins: [pinia] } })
  return { wrapper, store }
}

describe('CashflowEditor', () => {
  it('applies an edit to the whole schedule after selecting every year', async () => {
    const { wrapper, store } = mountEditor()

    await wrapper.get('button').trigger('click')
    const need = wrapper.get('#cashflow-need')
    await need.setValue(150_000)
    await need.trigger('change')

    // Select-all plus one edit is what replaces a dedicated "set every year"
    // button, so every year has to move, not just the one first selected.
    expect(store.cashflow.every((year) => year.need === 150_000)).toBe(true)
    // The extra is untouched: the fields write only what they carry.
    expect(store.cashflow.every((year) => year.extra === EXTRA)).toBe(true)
  })

  it('edits only the selected year when the selection is one year', async () => {
    const { wrapper, store } = mountEditor()

    const need = wrapper.get('#cashflow-need')
    await need.setValue(150_000)
    await need.trigger('change')

    expect(store.cashflow[0]!.need).toBe(150_000)
    expect(store.cashflow[1]!.need).toBe(NEED)
  })

  it('totals the two fields, exactly and in every cadence', async () => {
    const { wrapper } = mountEditor()
    // sv-SE groups digits with a non-breaking space; compare on plain ones.
    const text = wrapper.text().replace(/ /g, ' ')

    expect(text).toContain(formatKrExact(NEED + EXTRA).replace(/ /g, ' '))
    // 300 000 a year is 25 000 a month; the total carries the same cadence line
    // as the fields it sums, which is the point of showing it at all.
    expect(text).toContain('25 000 kr/mån')
  })
})
