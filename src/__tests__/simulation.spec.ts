import { describe, it, expect } from 'vitest'
import { spendingMultiplier, runSingleSimulation } from '../simulation'
import type { InputParameters } from '../types'
import type { BootstrapPayload } from '../bootstrap'

describe('spendingMultiplier', () => {
  it('returns 1.0 when disabled', () => {
    expect(spendingMultiplier(30, false)).toBe(1)
    expect(spendingMultiplier(50, false)).toBe(1)
    expect(spendingMultiplier(80, false)).toBe(1)
  })

  it('returns node values at exact node ages', () => {
    expect(spendingMultiplier(30, true)).toBeCloseTo(0.84, 8)
    expect(spendingMultiplier(45, true)).toBeCloseTo(1.08, 8)
    expect(spendingMultiplier(50, true)).toBeCloseTo(1.08, 8)
    expect(spendingMultiplier(60, true)).toBeCloseTo(0.84, 8)
    expect(spendingMultiplier(80, true)).toBeCloseTo(0.70, 8)
  })

  it('interpolates linearly between nodes', () => {
    // Midpoint of 30→45: (0.84+1.08)/2 = 0.96
    expect(spendingMultiplier(37.5, true)).toBeCloseTo(0.96, 8)
    // Midpoint of 60→80: (0.84+0.70)/2 = 0.77
    expect(spendingMultiplier(70, true)).toBeCloseTo(0.77, 8)
  })

  it('preserves Eurostat bucket averages', () => {
    // 30-44 bucket: average of f(30) and f(45) = (0.84+1.08)/2 = 0.96
    const avg3044 = (spendingMultiplier(30, true) + spendingMultiplier(45, true)) / 2
    expect(avg3044).toBeCloseTo(0.96, 8)

    // 45-59 bucket: weighted average of [45→50] and [50→60] segments
    // [5*(f(45)+f(50))/2 + 10*(f(50)+f(60))/2] / 15
    const f45 = spendingMultiplier(45, true)
    const f50 = spendingMultiplier(50, true)
    const f60 = spendingMultiplier(60, true)
    const avg4559 = (5 * (f45 + f50) / 2 + 10 * (f50 + f60) / 2) / 15
    expect(avg4559).toBeCloseTo(1.00, 8)

    // 60+ bucket: average of f(60) and f(80) = (0.84+0.70)/2 = 0.77
    const avg60 = (spendingMultiplier(60, true) + spendingMultiplier(80, true)) / 2
    expect(avg60).toBeCloseTo(0.77, 8)
  })

  it('clamps at boundary values for extreme ages', () => {
    // Below age 30: clamps to f(30)
    expect(spendingMultiplier(20, true)).toBeCloseTo(0.84, 8)
    expect(spendingMultiplier(0, true)).toBeCloseTo(0.84, 8)
    // Above age 80: clamps to f(80)
    expect(spendingMultiplier(90, true)).toBeCloseTo(0.70, 8)
    expect(spendingMultiplier(100, true)).toBeCloseTo(0.70, 8)
  })

  it('is monotonically non-decreasing up to peak and non-increasing after', () => {
    let prev = spendingMultiplier(30, true)
    // Rising phase: 30 → 50
    for (let age = 31; age <= 50; age++) {
      const val = spendingMultiplier(age, true)
      expect(val).toBeGreaterThanOrEqual(prev)
      prev = val
    }
    // Declining phase: 50 → 80
    prev = spendingMultiplier(50, true)
    for (let age = 51; age <= 80; age++) {
      const val = spendingMultiplier(age, true)
      expect(val).toBeLessThanOrEqual(prev)
      prev = val
    }
  })
})

// Helper: build a minimal BootstrapPayload with constant monthly returns.
// nMonths must be >= 14 (BLOCK_MONTHS). Using 24 months of constant returns
// makes every block identical, removing randomness from the return path.
function makePayload(monthlyReturn: number, nAssets: number = 1): BootstrapPayload {
  const nMonths = 24
  const returnMatrix: number[][] = []
  for (let m = 0; m < nMonths; m++) {
    returnMatrix.push(new Array(nAssets).fill(monthlyReturn))
  }
  return {
    returnMatrix,
    nMonths,
    profileComponents: [],
    assetOrder: Array.from({ length: nAssets }, (_, i) => `ASSET${i}`),
    startDate: '2015-01',
    portfolioGeometricMean: Math.pow(1 + monthlyReturn, 12) - 1,
    portfolioVariance: 0,
  }
}

// Helper: build a minimal InputParameters for withdrawal tests.
// Zero inflation/tax/volatility to isolate the withdrawal logic.
function makeParams(overrides: Partial<InputParameters> = {}): InputParameters {
  return {
    seed: 'test',
    initialCapital: 1_000_000,
    startYear: 45,
    yearsLater: 36,
    simulationCount: 1,
    assets: [{ name: 'A', weight: 1, expectedReturn: 0.05, volatility: 0.1 }],
    assetCorrelationMatrix: [[1]],
    assetRebalanceFrequency: 'annually',
    depositAmount: 0,
    depositYears: 0,
    balanceWithdrawalRate: 0.04,
    profitWithdrawalRate: 0,
    profitLookbackYears: 1,
    inflationBasedWithdrawal: 0,
    amortizedWithdrawal: false,
    bequestGoal: 0,
    ageAdjustedSpending: false,
    vpWealthTaxRate: 0,
    capitalGainsTaxRate: 0,
    inflationRate: 0,
    inflationStdDev: 0,
    ...overrides,
  }
}

describe('runSingleSimulation age-adjusted balance withdrawal', () => {
  // Use zero monthly return so the portfolio stays flat (no growth,
  // no tax), isolating the withdrawal scaling effect.
  const payload = makePayload(0)

  it('without age adjustment, balance withdrawal rate is constant', () => {
    const params = makeParams({ ageAdjustedSpending: false })
    const result = runSingleSimulation(params, payload)

    // All withdrawal rates should equal balanceWithdrawalRate (4%)
    for (const rate of result.periodData.withdrawalRate) {
      expect(rate).toBeCloseTo(0.04, 6)
    }
  })

  it('with age adjustment, first-year rate differs from input rate', () => {
    const params = makeParams({ startYear: 45, ageAdjustedSpending: true })
    const result = runSingleSimulation(params, payload)

    // At age 45 the multiplier is 1.08 (peak). The average multiplier
    // over 36 years (ages 45-80) is less than 1.08, so the first-year
    // rate should be HIGHER than the input 4%.
    const firstYearRate = result.periodData.withdrawalRate[0]!
    expect(firstYearRate).toBeGreaterThan(0.04)
  })

  it('with age adjustment, late-year rate is lower than first-year rate', () => {
    const params = makeParams({ startYear: 45, yearsLater: 36, ageAdjustedSpending: true })
    const result = runSingleSimulation(params, payload)

    const firstRate = result.periodData.withdrawalRate[0]!
    const lastRate = result.periodData.withdrawalRate[35]!
    expect(lastRate).toBeLessThan(firstRate)
  })

  it('average withdrawal rate approximates the input rate', () => {
    // With zero returns, each withdrawal shrinks the portfolio, so the
    // dollar amount and rate diverge. But for a single year with
    // depositYears=0, the first-year rate should match the age-scaled rate.
    // Instead, test with a very small rate over many years where the
    // compounding effect is negligible.
    const params = makeParams({
      startYear: 45,
      yearsLater: 36,
      balanceWithdrawalRate: 0.001, // 0.1% — negligible portfolio impact
      ageAdjustedSpending: true,
    })
    const result = runSingleSimulation(params, payload)

    // Sum of all withdrawal rates / nYears should approximate 0.1%
    const rates = result.periodData.withdrawalRate
    const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length
    expect(avgRate).toBeCloseTo(0.001, 4)
  })
})

describe('runSingleSimulation age-adjusted inflation withdrawal', () => {
  const payload = makePayload(0)

  it('without age adjustment, inflation withdrawal is constant', () => {
    const params = makeParams({
      balanceWithdrawalRate: 0,
      inflationBasedWithdrawal: 100_000,
      ageAdjustedSpending: false,
    })
    const result = runSingleSimulation(params, payload)

    // All nominal withdrawals should be 100,000 (inflation=0)
    for (const w of result.periodData.withdrawal) {
      expect(w).toBeCloseTo(100_000, 0)
    }
  })

  it('with age adjustment, inflation withdrawal declines with age', () => {
    const params = makeParams({
      startYear: 45,
      yearsLater: 36,
      balanceWithdrawalRate: 0,
      inflationBasedWithdrawal: 100_000,
      ageAdjustedSpending: true,
    })
    const result = runSingleSimulation(params, payload)

    // At age 45: multiplier = 1.08, withdrawal = 108,000
    expect(result.periodData.withdrawal[0]).toBeCloseTo(100_000 * 1.08, 0)
    // At age 80 (year 35): multiplier = 0.70, withdrawal = 70,000
    expect(result.periodData.withdrawal[35]).toBeCloseTo(100_000 * 0.70, 0)
    // Monotonically decreasing after peak
    for (let t = 6; t < 36; t++) { // age 51+
      expect(result.periodData.withdrawal[t]!).toBeLessThanOrEqual(
        result.periodData.withdrawal[t - 1]!,
      )
    }
  })
})

describe('runSingleSimulation age-adjusted Merton floor', () => {
  // Use a payload with some return so the PMT has something to work with.
  // 0.5% monthly ≈ 6.17% annual.
  const payload = makePayload(0.005)

  it('Merton floor declines with age when age-adjusted', () => {
    const params = makeParams({
      startYear: 45,
      yearsLater: 36,
      balanceWithdrawalRate: 0,
      inflationBasedWithdrawal: 500_000, // high floor to force it to bind
      amortizedWithdrawal: true,
      bequestGoal: 0,
      ageAdjustedSpending: true,
    })
    const result = runSingleSimulation(params, payload)

    // With a very high floor, withdrawals are floor-bound early on.
    // At age 45: floor = 500k * 1.08 = 540k
    // At age 80: floor = 500k * 0.70 = 350k
    // Early withdrawal should be larger than late withdrawal.
    const earlyWithdrawal = result.periodData.withdrawal[0]!
    const lateWithdrawal = result.periodData.withdrawal[35]!
    expect(earlyWithdrawal).toBeGreaterThan(lateWithdrawal)
  })
})
