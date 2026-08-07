import { describe, it, expect } from 'vitest'

import {
  SIGNIFICANT_DIGITS,
  floorToSignificant,
  formatKr,
  formatPercent,
  formatRelative,
  toSignificant,
} from '../planner/format'

const readable = (s: string) => s.replace(/ /g, ' ')

describe('toSignificant', () => {
  it('keeps two significant digits across magnitudes', () => {
    expect(SIGNIFICANT_DIGITS).toBe(2)
    expect(toSignificant(4_031_234)).toBe(4_000_000)
    expect(toSignificant(742_572)).toBe(740_000)
    expect(toSignificant(5.43)).toBeCloseTo(5.4, 10)
    expect(toSignificant(0.2748)).toBeCloseTo(0.27, 10)
    expect(toSignificant(0.00456)).toBeCloseTo(0.0046, 10)
  })

  it('leaves zero and non-finite values alone', () => {
    expect(toSignificant(0)).toBe(0)
    expect(toSignificant(Number.NaN)).toBeNaN()
  })

  it('rounds negatives by magnitude', () => {
    expect(toSignificant(-4_031_234)).toBe(-4_000_000)
  })
})

describe('formatKr', () => {
  it('switches to millions only above a million, after rounding', () => {
    expect(readable(formatKr(4_031_234))).toBe('4 mkr')
    expect(readable(formatKr(742_572))).toBe('740 000 kr')
    // 995 000 rounds to 1 000 000, so it must not print as "1000000 kr".
    expect(readable(formatKr(995_000))).toBe('1 mkr')
  })

  it('renders a dash rather than NaN', () => {
    expect(formatKr(Number.NaN)).toBe('–')
  })
})

describe('formatPercent', () => {
  it('drops digits the model cannot support', () => {
    expect(readable(formatPercent(69.43))).toBe('69 %')
    expect(readable(formatPercent(5.432))).toBe('5,4 %')
    expect(readable(formatPercent(0.2748))).toBe('0,27 %')
  })

  it('uses a non-breaking space before the sign', () => {
    expect(formatPercent(69.43)).toContain(' %')
  })
})

describe('formatRelative', () => {
  it('signs a change in both directions', () => {
    expect(readable(formatRelative(111, 100))).toBe('+11 %')
    // The locale's minus sign, not a hyphen.
    expect(readable(formatRelative(91, 100))).toBe('−9 %')
    expect(readable(formatRelative(100, 100))).toBe('0 %')
  })

  it('rounds like every other computed figure', () => {
    expect(readable(formatRelative(1.3456, 1))).toBe('+35 %')
    expect(readable(formatRelative(6_432_100, 6_000_000))).toBe('+7,2 %')
  })

  it('has nothing to say about a change from zero', () => {
    expect(formatRelative(1000, 0)).toBe('–')
    expect(formatRelative(0, 0)).toBe('–')
    expect(formatRelative(Number.NaN, 100)).toBe('–')
    expect(formatRelative(100, Number.POSITIVE_INFINITY)).toBe('–')
  })

  it('reports a drop to nothing as a total loss rather than a dash', () => {
    // A ruined plan really is −100%, and it is a figure worth printing.
    expect(readable(formatRelative(0, 6_000_000))).toBe('−100 %')
  })
})

describe('floorToSignificant', () => {
  it('rounds down rather than to nearest', () => {
    // 28 320 would round to 28 000 either way; 28 900 is where they differ.
    expect(floorToSignificant(28_320)).toBe(28_000)
    expect(floorToSignificant(28_900)).toBe(28_000)
    expect(toSignificant(28_900)).toBe(29_000)
  })

  it('never returns more than it was given', () => {
    for (const value of [1, 7, 47, 99, 101, 999, 1234, 98_765, 1_234_567]) {
      expect(floorToSignificant(value)).toBeLessThanOrEqual(value)
    }
  })

  it('leaves an exact two-digit value alone', () => {
    expect(floorToSignificant(28_000)).toBe(28_000)
    expect(floorToSignificant(50)).toBe(50)
  })

  it('leaves zero and non-finite values alone', () => {
    expect(floorToSignificant(0)).toBe(0)
    expect(floorToSignificant(Number.NaN)).toBeNaN()
  })
})
