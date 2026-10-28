import { describe, it, expect } from 'vitest'
import { SurvivalTally, pairedHalfWidth, wilsonHalfWidth } from '../precision'

describe('wilsonHalfWidth', () => {
  it('matches the textbook figure for a proportion in the middle', () => {
    // 86% of 4600: roughly +-1 point, as in the sizing note for the default.
    expect(wilsonHalfWidth(3956, 4600)).toBeCloseTo(0.01, 3)
  })

  it('is not zero when nothing has failed yet', () => {
    // Wald would say 0 here and declare the estimate perfect.
    expect(wilsonHalfWidth(500, 500)).toBeGreaterThan(0)
    expect(wilsonHalfWidth(0, 500)).toBeGreaterThan(0)
  })

  it('shrinks as 1/sqrt(n)', () => {
    const a = wilsonHalfWidth(430, 500)
    const b = wilsonHalfWidth(4300, 5000)
    expect(a / b).toBeCloseTo(Math.sqrt(10), 1)
  })
})

describe('pairedHalfWidth', () => {
  it('is far narrower than treating the scenarios as unpaired when they mostly agree', () => {
    // 10 000 paths, 86% vs 85% survival, of which 400 paths disagree.
    const unpaired = Math.hypot(wilsonHalfWidth(8600, 10000), wilsonHalfWidth(8500, 10000))
    const paired = pairedHalfWidth(400, 100, 10000)
    expect(paired).toBeLessThan(unpaired / 2)
  })

  it('does not call a difference perfectly measured before any path disagrees', () => {
    expect(pairedHalfWidth(0, 0, 500)).toBeGreaterThan(0)
  })

  it('is widest when half the paths disagree one way and half the other', () => {
    expect(pairedHalfWidth(500, 0, 1000)).toBeGreaterThan(pairedHalfWidth(50, 0, 1000))
  })
})

describe('SurvivalTally', () => {
  it('counts survivors per scenario and the pairing against the first', () => {
    const t = new SurvivalTally(2)
    t.add([true, true])
    t.add([true, false])
    t.add([false, true])
    t.add([false, false])
    expect(t.paths).toBe(4)
    // One path where only the first survived, one where only the second did.
    expect(t.differenceHalfWidth()[0]).toBe(0)
    expect(t.differenceHalfWidth()[1]).toBeGreaterThan(0)
  })

  it('is precise only once every interval is inside its target', () => {
    const t = new SurvivalTally(2)
    for (let i = 0; i < 400; i++) t.add([i % 2 === 0, i % 2 === 0])
    expect(t.isPrecise(0.01, 0.01)).toBe(false)
    for (let i = 0; i < 40000; i++) t.add([i % 2 === 0, i % 2 === 0])
    expect(t.isPrecise(0.01, 0.01)).toBe(true)
  })
})
