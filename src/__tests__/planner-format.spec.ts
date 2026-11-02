import { describe, it, expect } from 'vitest'

import {
  SIGNIFICANT_DIGITS,
  formatKr,
  formatPercent,
  formatRelative,
  formatPointChange,
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

describe('formatPointChange', () => {
  it('states the gap between two shares in points, not as a ratio', () => {
    // The distinction the function exists for: 87% against 65% is a fall of 22
    // points, and reporting it as a quarter is a different claim.
    expect(formatPointChange(0.65, 0.87)).toBe('\u221222\u00a0p.e.')
    expect(formatPointChange(0.9, 0.87)).toBe('+3\u00a0p.e.')
  })

  it('signs both directions and leaves no gap unsigned', () => {
    expect(formatPointChange(0.87, 0.87)).toBe('0\u00a0p.e.')
    expect(formatPointChange(0.874, 0.87)).toBe('+0,4\u00a0p.e.')
  })

  it('gives up on figures it cannot state', () => {
    expect(formatPointChange(Number.NaN, 0.5)).toBe('–')
    expect(formatPointChange(0.5, Number.POSITIVE_INFINITY)).toBe('–')
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
