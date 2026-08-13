import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  INCOME_REFERENCE_FILE,
  deflateToReferenceYear,
  formatPercentileOrdinal,
  medianForHousehold,
  placeOnLadder,
  type IncomeReference,
} from '../planner/income'

/** A toy ladder with an obvious shape, so interpolation can be checked by hand. */
const LADDER = { '1': 100, '50': 500, '99': 1000 }

describe('placeOnLadder', () => {
  it('returns the exact percentile at a published limit', () => {
    expect(placeOnLadder(LADDER, 500)?.percentile).toBeCloseTo(50, 6)
  })

  it('interpolates linearly between two limits', () => {
    // Half way from P50 to P99 in kronor is half way in percentiles.
    expect(placeOnLadder(LADDER, 750)?.percentile).toBeCloseTo(74.5, 6)
  })

  it('marks amounts outside the published range as bounds, not locations', () => {
    expect(placeOnLadder(LADDER, 5000)).toEqual({ percentile: 99, bound: 'above' })
    expect(placeOnLadder(LADDER, 10)).toEqual({ percentile: 1, bound: 'below' })
  })

  it('has no answer for a year that withdraws nothing or deposits', () => {
    expect(placeOnLadder(LADDER, 0)).toBeNull()
    expect(placeOnLadder(LADDER, -200_000)).toBeNull()
  })

  it('orders the ladder numerically, not by key', () => {
    // Lexical key order would put "10" before "9" and break the bracket search.
    const jumbled = { '9': 900, '10': 1000, '1': 100, '99': 9900 }
    expect(placeOnLadder(jumbled, 950)?.percentile).toBeCloseTo(9.5, 6)
  })
})

describe('deflateToReferenceYear', () => {
  it('undoes the publication lag at the plan’s own inflation rate', () => {
    // Two years at 2% is what separates a 2026 plan from 2024 statistics.
    expect(deflateToReferenceYear(1000, 2024, 2026, 0.02)).toBeCloseTo(1000 / 1.02 ** 2, 9)
  })

  it('leaves an amount alone when the plan starts in the reference year', () => {
    expect(deflateToReferenceYear(1000, 2024, 2024, 0.02)).toBe(1000)
  })
})

describe('formatPercentileOrdinal', () => {
  it('uses the Swedish irregular ordinals for 1 and 2', () => {
    expect(formatPercentileOrdinal(1)).toBe('1:a')
    expect(formatPercentileOrdinal(2)).toBe('2:a')
    expect(formatPercentileOrdinal(3)).toBe('3:e')
    expect(formatPercentileOrdinal(74.5)).toBe('75:e')
  })
})

// The file the app actually ships. These guard the data as much as the code:
// a regenerated file that lost a percentile or changed a label would place
// every plan silently wrong.
const reference = JSON.parse(
  readFileSync(resolve(__dirname, '../../public', INCOME_REFERENCE_FILE), 'utf8'),
) as IncomeReference

describe('the checked-in income reference', () => {
  it('is the file the source constant names', () => {
    // The fetch script enforces this too, but only for whoever runs it.
    expect(INCOME_REFERENCE_FILE).toMatch(/^income-reference-\d{8}\.json$/)
  })

  it('carries a complete, monotone ladder for both series', () => {
    for (const ladder of [reference.perConsumptionUnit, reference.perHousehold]) {
      const percentiles = Object.keys(ladder)
        .map(Number)
        .sort((a, b) => a - b)
      expect(percentiles).toHaveLength(99)
      expect(percentiles[0]).toBe(1)
      expect(percentiles[98]).toBe(99)

      let previous = 0
      for (const percentile of percentiles) {
        const limit = ladder[String(percentile)]!
        expect(limit).toBeGreaterThan(previous)
        previous = limit
      }
    }
  })

  it('is in kronor rather than the tusental kronor SCB publishes', () => {
    // A median Swedish income per consumption unit is a six-figure amount. If
    // the conversion were dropped this would be in the hundreds.
    expect(reference.perConsumptionUnit['50']).toBeGreaterThan(100_000)
  })

  it('states a reference year the deflation can use', () => {
    expect(reference.source.referenceYear).toBeGreaterThan(2010)
    expect(reference.source.referenceYear).toBeLessThanOrEqual(new Date().getFullYear())
  })

  it('has a median for every age band and household form the UI can ask for', () => {
    for (const startAge of [30, 55, 67, 85]) {
      for (const units of [1, 1.51]) {
        const group = medianForHousehold(reference, startAge, units)
        expect(group).not.toBeNull()
        // The band labels reach the page, so they must not be raw table codes.
        expect(group!.ageLabel).not.toMatch(/[-+]/)
      }
    }
  })

  it('puts retirees below the working-age median, which is why the band matters', () => {
    const working = medianForHousehold(reference, 55, 1.51)!
    const retired = medianForHousehold(reference, 70, 1.51)!
    expect(retired.median).toBeLessThan(working.median)
  })

  it('reports the median for the whole household, not per consumption unit', () => {
    // The plan's withdrawal is a household amount, so the anchor beside it has
    // to be one too. Against the file's own per-k.e. figure for the same group,
    // since the household form also selects a different row.
    const couple = medianForHousehold(reference, 70, 1.51)!
    const row = reference.medianByAge.find(
      (entry) => entry.age === '65-79' && entry.householdType === 'sammanboende utan barn',
    )!
    expect(couple.median).toBeCloseTo(row.median * 1.51, 6)
  })
})
