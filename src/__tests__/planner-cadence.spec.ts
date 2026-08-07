import { describe, it, expect } from 'vitest'

import {
  DAYS_PER_YEAR,
  MONTHS_PER_YEAR,
  WEEKS_PER_YEAR,
  cadences,
  formatCadences,
} from '../planner/cadence'

describe('cadences', () => {
  it('derives every period from one year length', () => {
    // The point of the shared year length: each figure scales back to the
    // annual amount by its own period count, so the three agree with each
    // other rather than only with the year.
    const annual = 200_000
    const { month, week, day } = cadences(annual)
    expect(month * MONTHS_PER_YEAR).toBeCloseTo(annual, 9)
    expect(week * WEEKS_PER_YEAR).toBeCloseTo(annual, 9)
    expect(day * DAYS_PER_YEAR).toBeCloseTo(annual, 9)
    // And a week is seven days, which a flat 52 would break.
    expect(week).toBeCloseTo(day * 7, 9)
  })

  it('counts leap days in the year', () => {
    // 365 would be a common year; a forty-year plan contains ten leap days.
    expect(DAYS_PER_YEAR).toBe(365.25)
    expect(WEEKS_PER_YEAR).toBeCloseTo(52.1786, 4)
  })

  // sv-SE groups thousands with a non-breaking space, so comparing against a
  // plain-space literal would fail on characters that look identical.
  const readable = (value: number) => formatCadences(value).replace(/\u00a0/g, ' ')

  it('formats a yearly amount for display', () => {
    // To the whole krona: unlike the model's outputs these only restate an
    // exact input in another unit, so there is no uncertainty to round away.
    expect(readable(200_000)).toBe('16 667 kr/mån · 3 833 kr/vecka · 548 kr/dag')
  })

  it('groups thousands the Swedish way, without a breakable space', () => {
    expect(formatCadences(200_000)).toContain('16\u00a0667')
  })

  it('keeps the sign on a deposit', () => {
    // A negative need is money going in, and the line has to read that way.
    // Intl uses a real minus sign (U+2212), not a hyphen.
    expect(readable(-120_000)).toContain('\u221210 000 kr/mån')
  })

  it('renders nothing rather than NaN for a cleared field', () => {
    expect(formatCadences(Number.NaN)).toBe('')
    expect(formatCadences(Number.POSITIVE_INFINITY)).toBe('')
  })
})
