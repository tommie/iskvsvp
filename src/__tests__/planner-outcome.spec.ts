import { describe, it, expect, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import PlannerOutcome from '../components/planner/PlannerOutcome.vue'
import { usePlannerStore } from '../stores/planner'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import { formatKr, formatRelative } from '../planner/format'

/**
 * D3Chart observes its container to render only when it is on screen, and jsdom
 * has no IntersectionObserver. A stub that never reports intersection leaves the
 * charts unrendered, which is what this file wants: the subject is the table.
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

const INITIAL_CAPITAL = 6_000_000
const NEED = 200_000
const EXTRA = 100_000
const YEARS = 40

function mountOutcome() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlannerStore()
  store.$patch({
    ...defaultPlannerParameters(),
    iskAllowance: 0,
    years: YEARS,
    initialCapital: INITIAL_CAPITAL,
    cashflow: buildCashflow(YEARS, NEED, EXTRA),
  })
  store.run()

  const wrapper = mount(PlannerOutcome, { global: { plugins: [pinia] } })
  return { wrapper, store }
}

/** Cells of one body row of the summary table, by its row header. */
function row(wrapper: ReturnType<typeof mountOutcome>['wrapper'], header: string) {
  const tr = wrapper.findAll('.summary-table tbody tr').find((r) => r.get('th').text() === header)
  if (!tr) throw new Error(`no row headed "${header}"`)
  return tr.findAll('td').map((cell) => cell.text())
}

async function toggleRelative(wrapper: ReturnType<typeof mountOutcome>['wrapper']) {
  await wrapper.get('#planner-relative').setValue(true)
}

describe('PlannerOutcome layout', () => {
  it('names the curves exactly as it names the columns', () => {
    const { wrapper } = mountOutcome()
    const legend = wrapper
      .findAll('.line')
      .map((swatch) => swatch.element.parentElement!.textContent!.trim())
    // The header row leads with an empty corner cell for the row labels.
    const columns = wrapper
      .findAll('.summary-table thead th')
      .map((th) => th.text())
      .filter((text) => text !== '')

    expect(legend).toEqual(columns)
  })
})

describe('PlannerOutcome relative view', () => {
  it('shows amounts in kronor until it is turned on', () => {
    const { wrapper } = mountOutcome()
    for (const cell of row(wrapper, 'Median slutkapital')) expect(cell).toContain('kr')
    for (const cell of row(wrapper, 'Förväntat faktiskt uttag')) expect(cell).toContain('kr')
  })

  it('keeps the planned withdrawal in kronor, since it is what the rest is measured against', async () => {
    const { wrapper } = mountOutcome()
    await toggleRelative(wrapper)

    // The need column plans the need alone; the other two add the extra.
    const planned = row(wrapper, 'Totalt planerat uttag')
    expect(planned[0]).toBe(formatKr(YEARS * NEED))
    expect(planned[1]).toBe(formatKr(YEARS * (NEED + EXTRA)))
    expect(planned[2]).toBe(formatKr(YEARS * (NEED + EXTRA)))
  })

  it('states the expected withdrawal against what that column planned', async () => {
    const { wrapper, store } = mountOutcome()
    await toggleRelative(wrapper)

    const expected = [
      formatRelative(store.results!.needRun.expectedWithdrawn, YEARS * NEED),
      formatRelative(store.results!.adaptiveRun.expectedWithdrawn, YEARS * (NEED + EXTRA)),
      formatRelative(store.results!.extraRun.expectedWithdrawn, YEARS * (NEED + EXTRA)),
    ]
    expect(row(wrapper, 'Förväntat faktiskt uttag')).toEqual(expected)
    // A plan can only fall short of its own schedule, never exceed it.
    for (const cell of expected) expect(cell.startsWith('+')).toBe(false)
  })

  it('states final capital against the capital paid in', async () => {
    const { wrapper } = mountOutcome()
    const absolute = row(wrapper, 'Median slutkapital')
    await toggleRelative(wrapper)
    const shown = row(wrapper, 'Median slutkapital')

    expect(shown).not.toEqual(absolute)
    for (const cell of shown) expect(cell).toContain('%')

    // Recovering the amount from the percentage has to land back on the median
    // the absolute view printed, which pins the reference to the start capital.
    const percent = Number(shown[0]!.replace('−', '-').replace('+', '').replace(/[\s%]/g, ''))
    expect(formatKr(INITIAL_CAPITAL * (1 + percent / 100))).toBe(absolute[0])
  })

  it('leaves the survival probability alone', async () => {
    const { wrapper } = mountOutcome()
    const before = row(wrapper, 'Sannolikhet att planen håller')
    await toggleRelative(wrapper)
    expect(row(wrapper, 'Sannolikhet att planen håller')).toEqual(before)
  })
})
