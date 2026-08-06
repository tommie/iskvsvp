import { describe, it, expect } from 'vitest'

import { SIGNIFICANT_DIGITS, formatKr, formatPercent, toSignificant } from '../planner/format'

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
