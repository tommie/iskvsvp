import { describe, it, expect } from 'vitest'

import { decodePlan, encodePlan } from '../planner/url'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'

describe('planner URL encoding', () => {
  it('round-trips the default plan', () => {
    const original = defaultPlannerParameters()
    const restored = decodePlan(encodePlan(original))

    expect(restored.initialCapital).toBe(original.initialCapital)
    expect(restored.startAge).toBe(original.startAge)
    expect(restored.years).toBe(original.years)
    expect(restored.accountType).toBe(original.accountType)
    expect(restored.inflationRate).toBe(original.inflationRate)
    expect(restored.cashflow).toEqual(original.cashflow)
    expect(restored.assets.map((a) => a.name)).toEqual(original.assets.map((a) => a.name))
    expect(restored.assets.map((a) => a.weight)).toEqual(original.assets.map((a) => a.weight))
    expect(restored.correlations).toEqual(original.correlations)
  })

  it('round-trips a multi-phase cash flow', () => {
    const original = defaultPlannerParameters()
    original.years = 30
    original.cashflow = [
      ...buildCashflow(5, -150_000, 0),
      ...buildCashflow(10, 300_000, 120_000),
      ...buildCashflow(15, 180_000, 60_000),
    ]

    const restored = decodePlan(encodePlan(original))
    expect(restored.cashflow).toEqual(original.cashflow)
  })

  it('run-length encodes repeated years', () => {
    const params = defaultPlannerParameters()
    params.years = 40
    params.cashflow = buildCashflow(40, 200_000, 100_000)

    const encoded = new URLSearchParams(encodePlan(params)).get('f')
    expect(encoded).toBe('40*200000|100000')
  })

  it('falls back to the defaults for an empty query', () => {
    const restored = decodePlan('')
    expect(restored).toEqual(defaultPlannerParameters())
  })

  it('keeps the cash flow the same length as the horizon when it fails to decode', () => {
    // A hand-edited URL where the schedule and the horizon disagree must not
    // produce parameters the engine will reject outright.
    const restored = decodePlan('y=25&f=40*200000|100000')
    expect(restored.years).toBe(25)
    expect(restored.cashflow).toHaveLength(25)
  })

  it('rejects a cash flow that would allocate an absurd number of years', () => {
    const restored = decodePlan('y=30&f=999999*1000|0')
    expect(restored.cashflow).toHaveLength(30)
  })

  it('reconstructs a symmetric correlation matrix from the upper triangle', () => {
    const original = defaultPlannerParameters()
    original.correlations = [
      [1, 0.7, 0.1, 0.2],
      [0.7, 1, -0.3, 0.25],
      [0.1, -0.3, 1, 0.45],
      [0.2, 0.25, 0.45, 1],
    ]

    const restored = decodePlan(encodePlan(original))
    expect(restored.correlations).toEqual(original.correlations)
  })
})

describe('planner URL preset ids', () => {
  it('round-trips the preset each asset came from', () => {
    const original = defaultPlannerParameters()
    const restored = decodePlan(encodePlan(original))
    expect(restored.assets.map((a) => a.presetId)).toEqual(original.assets.map((a) => a.presetId))
  })

  it('leaves a hand-rolled asset without a preset', () => {
    const original = defaultPlannerParameters()
    original.assets = [
      { ...original.assets[0]! },
      {
        id: 'egen',
        name: 'Egen tillgång',
        weight: 0.5,
        expectedRealReturn: 0.04,
        volatility: 0.12,
      },
    ]
    original.correlations = [
      [1, 0.5],
      [0.5, 1],
    ]

    const restored = decodePlan(encodePlan(original))
    expect(restored.assets[0]!.presetId).toBe('global-equity')
    expect(restored.assets[1]!.presetId).toBeUndefined()
    expect(restored.correlations).toEqual(original.correlations)
  })
})
