import { describe, it, expect } from 'vitest'
import {
  arvaWithdrawal,
  bequestRate,
  reserveRate,
  reserveSchedule,
  returnLaw,
  type ReturnLaw,
} from '../arva'

// No volatility: every quantile is the median and the rate curve is flat.
const certain = (rate: number): ReturnLaw => ({ logMean: Math.log(1 + rate), logStdDev: 0 })
const flat = (years: number, amount: number) => new Array<number>(years).fill(amount)

describe('returnLaw', () => {
  it('reproduces the arithmetic mean of the lognormal it describes', () => {
    const law = returnLaw(
      [
        { name: 'A', weight: 0.7, expectedReturn: 0.06, volatility: 0.17 },
        { name: 'B', weight: 0.3, expectedReturn: 0.01, volatility: 0.05 },
      ],
      [
        [1, 0.1],
        [0.1, 1],
      ],
    )
    const mean = Math.exp(law.logMean + (law.logStdDev * law.logStdDev) / 2) - 1
    expect(mean).toBeCloseTo(0.7 * 0.06 + 0.3 * 0.01, 12)
  })
})

describe('rates', () => {
  const law: ReturnLaw = { logMean: 0.04, logStdDev: 0.15 }

  it('discounts a near commitment at a lower rate than a distant one', () => {
    expect(reserveRate(law, 0, 2)).toBeLessThan(reserveRate(law, 0, 40))
  })

  it('stays below the median rate at every distance, which the bequest uses', () => {
    for (const k of [1, 5, 20, 40]) {
      expect(reserveRate(law, 0, k)).toBeLessThan(bequestRate(law, 0))
    }
  })

  it('collapses to one rate without volatility', () => {
    const law0 = certain(0.03)
    expect(reserveRate(law0, 0, 1)).toBeCloseTo(0.03, 12)
    expect(reserveRate(law0, 0, 40)).toBeCloseTo(0.03, 12)
    expect(bequestRate(law0, 0)).toBeCloseTo(0.03, 12)
  })

  it('subtracts the tax drag', () => {
    expect(bequestRate(certain(0.03), 0.01)).toBeCloseTo(0.02, 12)
  })
})

describe('reserveSchedule', () => {
  it('values a flat need as an annuity-due at a certain rate', () => {
    const r = 0.04
    const n = 10
    const s = reserveSchedule(flat(n, 100), flat(n, 0), 0, certain(r), 0)
    // First payment undiscounted: 100 * (1 - v^n) / (1 - v), v = 1 / (1 + r).
    const v = 1 / (1 + r)
    expect(s.reserve[0]!).toBeCloseTo((100 * (1 - Math.pow(v, n))) / (1 - v), 9)
    // One year left: just that year's need, undiscounted.
    expect(s.reserve[n - 1]!).toBeCloseTo(100, 12)
    expect(s.reserve[n]!).toBe(0)
  })

  it('counts the discounted remaining extra payments when the extra is flat', () => {
    const n = 8
    const s = reserveSchedule(flat(n, 0), flat(n, 50), 0, certain(0.02), 0)
    // A flat extra makes every year's weight equal, so the factor is the
    // plain count of discounted payments still to come.
    const v = 1 / 1.02
    for (let t = 0; t < n; t++) {
      const count = (1 - Math.pow(v, n - t)) / (1 - v)
      expect(s.annuity[t]!).toBeCloseTo(count, 9)
    }
    expect(s.annuity[n - 1]!).toBeCloseTo(1, 12)
  })

  it('serves a shaped extra in proportion to what each year asked for', () => {
    const extra = [400, 400, 100, 100]
    const s = reserveSchedule(flat(4, 0), extra, 0, certain(0), 0)
    // Without discounting, annuity[t] is total remaining over this year's own.
    expect(s.annuity[0]!).toBeCloseTo(1000 / 400, 12)
    expect(s.annuity[2]!).toBeCloseTo(200 / 100, 12)
  })

  it('discounts the bequest over one return fewer than the years to the horizon', () => {
    // The target is what is left once the last year is paid, so the final
    // year's commitment is the target itself. Pinned at several rates because a
    // zero rate cannot tell one return too many from the right count.
    for (const r of [0.02, 0.04, 0.08]) {
      const n = 12
      const s = reserveSchedule(flat(n, 0), flat(n, 0), 1000, certain(r), 0)
      expect(s.keep[n - 1]!).toBeCloseTo(1000, 9)
      expect(s.keep[0]!).toBeCloseTo(1000 / Math.pow(1 + r, n - 1), 9)
    }
  })
})

describe('arvaWithdrawal', () => {
  const years = 10
  const schedule = reserveSchedule(flat(years, 100), flat(years, 50), 0, certain(0.03), 0)

  it('pays only the need when there is no surplus', () => {
    expect(arvaWithdrawal(schedule.reserve[0]!, 100, 50, schedule, 0, 1)).toBe(100)
    expect(arvaWithdrawal(10, 100, 50, schedule, 0, 1)).toBe(100)
  })

  it('pays the whole extra when the surplus covers it for every remaining year', () => {
    const rich = schedule.reserve[0]! + 50 * schedule.annuity[0]! * 2
    expect(arvaWithdrawal(rich, 100, 50, schedule, 0, 1)).toBe(150)
  })

  it('pays part of the extra in between, in proportion to the surplus', () => {
    const half = schedule.reserve[0]! + 25 * schedule.annuity[0]!
    expect(arvaWithdrawal(half, 100, 50, schedule, 0, 1)).toBeCloseTo(125, 9)
  })

  it('reserves more balance when a sale also pays tax', () => {
    const balance = schedule.reserve[0]! + 25 * schedule.annuity[0]!
    expect(arvaWithdrawal(balance, 100, 50, schedule, 0, 0.8)).toBeLessThan(
      arvaWithdrawal(balance, 100, 50, schedule, 0, 1),
    )
  })

  it('holds back the bequest before spending any extra', () => {
    const s = reserveSchedule(flat(years, 100), flat(years, 50), 500, certain(0.03), 0)
    const balance = s.reserve[0]! + s.keep[0]!
    expect(arvaWithdrawal(balance, 100, 50, s, 0, 1)).toBe(100)
    expect(arvaWithdrawal(balance + 10 * s.annuity[0]!, 100, 50, s, 0, 1)).toBeCloseTo(110, 9)
  })
})

describe('restarting a year later', () => {
  // The rule depends on the balance and the years remaining alone. Rebuilding
  // the plan one year on, from the balance actually reached, therefore pays
  // exactly what the original plan would have paid in that state. This is what
  // lets a household advance its start year to get next year's budget.
  const law: ReturnLaw = { logMean: 0.035, logStdDev: 0.12 }
  const n = 25
  const need = Array.from({ length: n }, (_, i) => 100 + i)
  const extra = Array.from({ length: n }, (_, i) => 60 - i)

  it('pays the same as the original schedule at the corresponding year', () => {
    const original = reserveSchedule(need, extra, 800, law, 0.002)
    for (const k of [1, 5, 12]) {
      const later = reserveSchedule(need.slice(k), extra.slice(k), 800, law, 0.002)
      for (const balance of [900, 2000, 3500]) {
        expect(arvaWithdrawal(balance, need[k]!, extra[k]!, later, 0, 0.9)).toBeCloseTo(
          arvaWithdrawal(balance, need[k]!, extra[k]!, original, k, 0.9),
          9,
        )
      }
    }
  })
})
