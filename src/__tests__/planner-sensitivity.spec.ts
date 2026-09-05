import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import SensitivityCard from '../components/planner/SensitivityCard.vue'
import { usePlannerStore } from '../stores/planner'
import {
  sensitivityGrid,
  SENSITIVITY_FACTORS,
  EXTRA_AXIS,
  INFLATION_AXIS,
  NEED_AXIS,
  RETURN_AXIS,
} from '../planner/sensitivity'
import { adaptiveSummary, runPlanner } from '../planner/propagate'
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

/** The pair every case here varies, unless it says otherwise. */
const cashflowGrid = (params: PlannerParameters) => sensitivityGrid(params, NEED_AXIS, EXTRA_AXIS)

describe('sensitivityGrid', () => {
  it('covers every combination of the two axes', () => {
    const grid = cashflowGrid(plan())
    expect(grid).toHaveLength(SENSITIVITY_FACTORS.length)
    for (const row of grid) expect(row).toHaveLength(SENSITIVITY_FACTORS.length)

    // Indexed [need][extra], so a row is one need level read across the extra
    // axis. Getting this transposed would put the answer under the wrong
    // question and look entirely plausible.
    for (let n = 0; n < grid.length; n++) {
      for (let e = 0; e < grid[n]!.length; e++) {
        expect(grid[n]![e]!.rowScale).toBe(SENSITIVITY_FACTORS[n])
        expect(grid[n]![e]!.colScale).toBe(SENSITIVITY_FACTORS[e])
      }
    }
  })

  it('marks exactly one cell as the plan as entered, and it is the plan as entered', () => {
    const params = plan()
    const grid = cashflowGrid(params)
    const base = grid.flat().filter((cell) => cell.base)
    expect(base).toHaveLength(1)
    expect(base[0]!.rowScale).toBe(1)
    expect(base[0]!.colScale).toBe(1)

    // The middle cell has to be the plan itself, not a near miss — it is the
    // reference every other cell is read against.
    const direct = adaptiveSummary(params)
    expect(base[0]!.survival).toBeCloseTo(direct.survival, 12)
    expect(base[0]!.expectedWithdrawn).toBeCloseTo(direct.expectedWithdrawn, 6)
    expect(base[0]!.finalMedian).toBeCloseTo(direct.finalMedian, 6)
  })

  it('agrees with the headline figures the page already shows', () => {
    // The card sits under a table built from `runPlanner`. If the two disagreed
    // on the same plan the reader would have no way to tell which was wrong.
    const params = plan()
    const full = runPlanner(params).adaptiveRun
    const base = cashflowGrid(params)
      .flat()
      .find((cell) => cell.base)!
    expect(base.survival).toBeCloseTo(1 - full.finalDistribution.ruinProbability, 12)
    expect(base.expectedWithdrawn).toBeCloseTo(full.expectedWithdrawn, 6)
  })

  it('makes a bigger need strictly worse and a bigger extra weakly worse', () => {
    const grid = cashflowGrid(plan())
    const survival = (n: number, e: number) => grid[n]![e]!.survival

    // More need is more that must be funded, and the need is what ruin is
    // defined against, so survival falls down every column.
    for (let e = 0; e < SENSITIVITY_FACTORS.length; e++) {
      expect(survival(0, e)).toBeGreaterThan(survival(1, e))
      expect(survival(1, e)).toBeGreaterThan(survival(2, e))
    }
    // More extra can only be declined or spent, never required, so survival is
    // non-increasing across a row rather than strictly falling.
    for (let n = 0; n < SENSITIVITY_FACTORS.length; n++) {
      expect(survival(n, 0)).toBeGreaterThanOrEqual(survival(n, 1) - 1e-12)
      expect(survival(n, 1)).toBeGreaterThanOrEqual(survival(n, 2) - 1e-12)
    }
  })

  it('scales a deposit with the need rather than against it', () => {
    // A negative need is money going in. Doubling the need axis has to double
    // the deposit too: the axis asks "what if I have this wrong by a factor of
    // two", and flipping the sign for deposits would ask something else.
    const params = plan({
      years: 10,
      cashflow: [...buildCashflow(4, -100_000, 0), ...buildCashflow(6, 300_000, 50_000)],
    })
    const grid = cashflowGrid(params)
    // Halving both the deposits and the withdrawals leaves a plan that pays in
    // less but also takes out less; what must not happen is the halved-need
    // column being read as a plan that saves *more*.
    expect(grid[0]![1]!.expectedWithdrawn).toBeLessThan(grid[2]![1]!.expectedWithdrawn)
  })

  it('leaves the bequest target alone, since it is a share of the capital', () => {
    const params = plan({ bequestRatio: 0.5 })
    const grid = cashflowGrid(params)
    // Neither axis touches initialCapital, so the target is the same amount in
    // all nine cells; a plan spending twice as much simply reaches it less often.
    expect(grid[2]![2]!.finalMedian).toBeLessThan(grid[0]![0]!.finalMedian)
  })
})

describe('the market axes', () => {
  it('moves survival hard on the return axis', () => {
    const grid = sensitivityGrid(plan(), RETURN_AXIS, INFLATION_AXIS)
    // Halving what the portfolio earns and doubling it are the two ends of the
    // plan's viability, so this axis has to dominate every other one on offer.
    // Measured on this plan: 81%, 93%, 100% as the return is halved, kept and
    // doubled. Asserted loosely, since the point is the size of the effect
    // against the other axes, not these three numbers.
    expect(grid[0]![1]!.survival).toBeLessThan(grid[1]![1]!.survival - 0.05)
    expect(grid[2]![1]!.survival).toBeGreaterThan(grid[1]![1]!.survival + 0.03)
  })

  it('scales the means without touching the spread', () => {
    // "What if I am wrong about what this earns", not "what if it is a
    // different asset". Confounding the two would make the answer
    // unattributable.
    const params = plan()
    const doubled = RETURN_AXIS.scale(params, 2)
    for (let i = 0; i < params.assets.length; i++) {
      expect(doubled.assets[i]!.expectedRealReturn).toBeCloseTo(
        params.assets[i]!.expectedRealReturn * 2,
        12,
      )
      expect(doubled.assets[i]!.volatility).toBe(params.assets[i]!.volatility)
    }
  })

  it('leaves an ISK almost untouched by inflation, and an AF not', () => {
    // The whole model is real, so inflation only reaches the result where the
    // tax code is written in nominal kronor. For an ISK that is the fribelopp
    // alone; for an AF it is also the acquisition cost, which is not indexed,
    // so a rising price level is taxed as gain. An axis that barely moves is a
    // finding, not a fault — but the AF column is what earns it its place.
    const spread = (params: PlannerParameters) => {
      const grid = sensitivityGrid(params, INFLATION_AXIS, NEED_AXIS)
      return grid[0]![1]!.survival - grid[2]![1]!.survival
    }
    const isk = spread(plan())
    const af = spread(plan({ accountType: 'AF', initialCostBasisRatio: 0.5 }))

    // This plan sets iskAllowance to 0, so the ISK has no nominal threshold at
    // all and the axis is exactly inert; the AF still moves several points.
    expect(isk).toBeLessThan(0.005)
    expect(af).toBeGreaterThan(0.02)
  })
})

function mountCard(params: PlannerParameters) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlannerStore()
  store.$patch({ ...params })
  store.run()
  return {
    wrapper: mount(SensitivityCard, {
      props: {
        title: 'Känslighet',
        bodyId: 'test-sensitivity',
        rowAxis: NEED_AXIS,
        colAxis: EXTRA_AXIS,
      },
      global: { plugins: [pinia] },
    }),
    store,
  }
}

describe('SensitivityCard', () => {
  const tiles = (wrapper: ReturnType<typeof mountCard>['wrapper']) => wrapper.findAll('.tile')

  /**
   * Waits for the debounce, the yield and the render.
   *
   * Polled rather than slept for a fixed span: the card debounces 300 ms and
   * then runs nine propagations, and a wall-clock guess that holds on an idle
   * machine fails on a loaded one.
   */
  async function settle(wrapper: ReturnType<typeof mountCard>['wrapper'], expected: number) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      await wrapper.vm.$nextTick()
      if (tiles(wrapper).length === expected) return
    }
    throw new Error(`gave up waiting for ${expected} tiles, saw ${tiles(wrapper).length}`)
  }

  /** Long enough to be sure nothing was going to happen. */
  async function quiet(wrapper: ReturnType<typeof mountCard>['wrapper']) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    await wrapper.vm.$nextTick()
  }

  async function open(wrapper: ReturnType<typeof mountCard>['wrapper']) {
    await wrapper.get('button[aria-controls]').trigger('click')
    await settle(wrapper, 9)
  }

  it('computes nothing while it is closed', () => {
    // Nine propagations is seconds of main thread on an AF plan. Doing that for
    // a reader who has not opened the card is a price for nothing.
    const { wrapper } = mountCard(plan())
    expect(wrapper.findAll('.tile')).toHaveLength(0)
    expect(wrapper.get('button[aria-controls]').attributes('aria-expanded')).toBe('false')
    // The switch only means something once there is a grid to switch.
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('recomputes with the results while it is open, without being asked again', async () => {
    const { wrapper, store } = mountCard(plan())
    await open(wrapper)
    // The final capital, not the withdrawal: on the halved/halved tile the
    // withdrawal is already at its planned total, so more capital cannot move
    // it and the assertion would pass for the wrong reason.
    const before = tiles(wrapper)[0]!.findAll('dd')[2]!.text()

    // No button to press: the card follows the plan the way the rest of the
    // page does.
    store.initialCapital = 20_000_000
    store.run()
    await settle(wrapper, 9)

    expect(tiles(wrapper)[0]!.findAll('dd')[2]!.text()).not.toBe(before)
  })

  it('stops computing again once it is closed', async () => {
    const { wrapper, store } = mountCard(plan())
    await open(wrapper)
    expect(tiles(wrapper)).toHaveLength(9)

    await wrapper.get('button[aria-controls]').trigger('click')
    expect(tiles(wrapper)).toHaveLength(0)

    store.initialCapital = 20_000_000
    store.run()
    await quiet(wrapper)
    expect(tiles(wrapper)).toHaveLength(0)
  })

  it('fills nine tiles, each carrying all three figures', async () => {
    const { wrapper } = mountCard(plan())
    await open(wrapper)

    const tiles = wrapper.findAll('.tile')
    expect(tiles).toHaveLength(9)
    for (const tile of tiles) {
      expect(tile.findAll('dt').map((t) => t.text())).toEqual(['Uttag', 'Håller', 'Slutkapital'])
      expect(tile.findAll('dd')).toHaveLength(3)
    }

    // Row-major, so the plan as entered is the middle tile and the only one
    // marked. Transposing the grid would put it there too, which is why the
    // engine test pins the axes separately.
    expect(wrapper.findAll('.tile.base')).toHaveLength(1)
    expect(tiles[4]!.classes()).toContain('base')
    expect(tiles[4]!.text()).toContain('Din plan')
  })

  it('states the other eight against the middle, and leaves the middle in its own units', async () => {
    const { wrapper } = mountCard(plan())
    await open(wrapper)
    const absolute = wrapper.findAll('.tile').map((t) => t.findAll('dd').map((d) => d.text()))

    await wrapper.get('input[type="checkbox"]').setValue(true)
    const relative = wrapper.findAll('.tile').map((t) => t.findAll('dd').map((d) => d.text()))

    // The reference keeps its amounts: three zeroes there would delete the
    // anchor the other tiles are read against.
    expect(relative[4]).toEqual(absolute[4])
    // Everything else becomes a signed change. Halving the need can only help,
    // so the top-left tile survives more often than the plan as entered.
    expect(relative[0]![1]!.startsWith('+')).toBe(true)
    // And doubling it can only hurt.
    expect(relative[8]![1]).toMatch(/^−/)

    // Survival moves in percentage points; the two money figures are relative.
    // Reporting a probability as a ratio invites "fell by a quarter" to be read
    // as "fell by 25 points".
    expect(relative[0]![1]).toContain('p.e.')
    expect(relative[0]![0]).toContain('%')
    expect(relative[0]![2]).toContain('%')
  })

  it('tints each figure by how it compares with the middle tile', async () => {
    const { wrapper } = mountCard(plan())
    await open(wrapper)
    const tiles = wrapper.findAll('.tile')
    const survival = (index: number) => tiles[index]!.findAll('.metric')[1]!

    // Blue for better, red for worse, and nothing at all on the reference.
    expect(survival(0).classes()).toContain('up')
    expect(survival(8).classes()).toContain('down')
    expect(survival(4).classes()).not.toContain('up')
    expect(survival(4).classes()).not.toContain('down')

    // The tint does not depend on the display mode: the comparison is the point
    // of the grid whether or not the figures are printed as changes.
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.findAll('.tile')[0]!.findAll('.metric')[1]!.classes()).toContain('up')
  })

  it('drops the old grid the moment the plan moves, not when the new one lands', async () => {
    const { wrapper, store } = mountCard(plan())
    await open(wrapper)
    expect(wrapper.findAll('.tile')).toHaveLength(9)

    store.initialCapital = 8_000_000
    store.run()
    await wrapper.vm.$nextTick()
    // Nine figures for a plan that no longer exists read as current, and the
    // recompute is debounced behind them.
    expect(tiles(wrapper)).toHaveLength(0)
  })
})
