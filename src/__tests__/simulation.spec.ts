import { describe, it, expect } from 'vitest'
import { spendingMultiplier, runSingleSimulation, quickselect } from '../simulation'
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
    withdrawalRatchetLimit: 0,
    withdrawalCap: 0,
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
      // 100k/yr for 36 years needs 3.6M with zero return; a 1M portfolio would
      // empty at year 10 and the withdrawal would be clamped to the balance.
      initialCapital: 4_000_000,
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
      // As above: the portfolio must be able to fund the whole schedule,
      // otherwise the late-year assertions measure the clamp, not the age curve.
      initialCapital: 4_000_000,
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

describe('withdrawal ratchet (Kitces)', () => {
  // Use constant 0% monthly return so the portfolio only changes via withdrawals.
  // With 4% balance withdrawal and no growth, withdrawals naturally decline each year.
  // The ratchet should prevent that decline.

  it('without ratchet, withdrawals decline when portfolio shrinks', () => {
    const payload = makePayload(0)
    const params = makeParams({
      balanceWithdrawalRate: 0.04,
      withdrawalRatchetLimit: 0,
    })
    const result = runSingleSimulation(params, payload)
    const w0 = result.periodData.withdrawal[0]!
    const w5 = result.periodData.withdrawal[5]!
    // With 0% return and 4% withdrawal, portfolio shrinks → withdrawals decline
    expect(w5).toBeLessThan(w0)
  })

  it('with ratchet, withdrawals never decrease', () => {
    const payload = makePayload(0)
    const params = makeParams({
      balanceWithdrawalRate: 0.04,
      withdrawalRatchetLimit: 0.10, // 10% max increase per year
      // A ratcheted 4% of a zero-return portfolio is a flat 4% of the starting
      // capital, so it always runs dry in year 25 regardless of capital size.
      // Stay inside that horizon, as the cumulative-withdrawal test does.
      yearsLater: 20,
    })
    const result = runSingleSimulation(params, payload)
    const withdrawals = result.periodData.withdrawal
    for (let i = 1; i < withdrawals.length; i++) {
      expect(withdrawals[i]!).toBeGreaterThanOrEqual(withdrawals[i - 1]! - 0.01)
    }
  })

  it('ratchet prevents withdrawal decline in volatile parametric sim', () => {
    // No bootstrap payload → uses independent normal returns (parametric fallback).
    // High volatility + high withdrawal rate makes withdrawals decline in bad years.
    const params = makeParams({
      seed: 'ratchet-test',
      balanceWithdrawalRate: 0.05,
      withdrawalRatchetLimit: 0.10,
      yearsLater: 20,
      assets: [{ name: 'A', weight: 1, expectedReturn: 0.06, volatility: 0.20 }],
    })
    const result = runSingleSimulation(params) // no bootstrap, no factor model
    const w = result.periodData.withdrawal

    const declines: string[] = []
    for (let i = 1; i < w.length; i++) {
      if (w[i]! < w[i - 1]! - 0.01) {
        declines.push(`year ${i}: ${w[i - 1]!.toFixed(2)} → ${w[i]!.toFixed(2)}`)
      }
    }
    expect(declines).toEqual([])
  })

  it('ratchet increases cumulative withdrawals vs no ratchet (same seed)', () => {
    // With 0% return: portfolio only shrinks from withdrawals.
    // Without ratchet: withdrawals decline each year (4% of shrinking balance).
    // With ratchet: withdrawals stay at the first-year level.
    // So cumulative withdrawals must be strictly higher with ratchet.
    const payload = makePayload(0)
    const baseOpts = { balanceWithdrawalRate: 0.04, yearsLater: 20, seed: 'same' }

    const noRatchet = runSingleSimulation(
      makeParams({ ...baseOpts, withdrawalRatchetLimit: 0 }),
      payload,
    )
    const withRatchet = runSingleSimulation(
      makeParams({ ...baseOpts, withdrawalRatchetLimit: 0.10 }),
      payload,
    )

    const cumNoRatchet = noRatchet.periodData.withdrawal.reduce((a, b) => a + b, 0)
    const cumWithRatchet = withRatchet.periodData.withdrawal.reduce((a, b) => a + b, 0)

    // Ratchet should produce more total withdrawals
    expect(cumWithRatchet).toBeGreaterThan(cumNoRatchet * 1.05)

    // Verify specific: year 5 withdrawal is higher with ratchet
    expect(withRatchet.periodData.withdrawal[5]!).toBeGreaterThan(
      noRatchet.periodData.withdrawal[5]!,
    )
  })
})

describe('withdrawal cap', () => {
  // 7%/yr growth against a 4% withdrawal rate means the balance — and thus the
  // uncapped withdrawal — grows every year, so the cap has something to bind on.
  const growing = makePayload(Math.pow(1.07, 1 / 12) - 1)

  it('caps withdrawals at the configured amount', () => {
    const uncapped = runSingleSimulation(makeParams(), growing)
    const capped = runSingleSimulation(makeParams({ withdrawalCap: 45_000 }), growing)

    // Sanity: the uncapped run must exceed the cap, or the test proves nothing.
    expect(Math.max(...uncapped.periodData.withdrawal)).toBeGreaterThan(45_000)
    for (const w of capped.periodData.withdrawal) {
      expect(w).toBeLessThanOrEqual(45_000 + 1e-6)
    }
  })

  it('leaves withdrawals untouched when the cap is above them', () => {
    const uncapped = runSingleSimulation(makeParams(), growing)
    const capped = runSingleSimulation(makeParams({ withdrawalCap: 10_000_000 }), growing)

    expect(capped.periodData.withdrawal).toEqual(uncapped.periodData.withdrawal)
  })

  it('cap grows with inflation', () => {
    const cap = 45_000
    const inflationRate = 0.03
    const result = runSingleSimulation(
      makeParams({ withdrawalCap: cap, inflationRate, inflationStdDev: 0 }),
      growing,
    )

    for (let i = 0; i < result.periodData.withdrawal.length; i++) {
      // Inflation is applied before the withdrawal in year i, so the ceiling
      // for year i is the cap compounded i+1 times.
      const nominalCap = cap * Math.pow(1 + inflationRate, i + 1)
      expect(result.periodData.withdrawal[i]!).toBeLessThanOrEqual(nominalCap + 1e-6)
    }
    // The cap must actually rise, not stay pinned at the real amount.
    const last = result.periodData.withdrawal[result.periodData.withdrawal.length - 1]!
    expect(last).toBeGreaterThan(cap)
  })

  it('cap follows the age curve when age-adjusted spending is on', () => {
    // spendingMultiplier peaks around 45-50 and declines to ~65% at 80+,
    // so a cap that binds throughout must decline over the run.
    const result = runSingleSimulation(
      makeParams({ withdrawalCap: 30_000, ageAdjustedSpending: true, startYear: 45 }),
      growing,
    )
    const w = result.periodData.withdrawal
    expect(w[w.length - 1]!).toBeLessThan(w[0]!)
  })

  it('cap overrides the ratchet floor', () => {
    // The ratchet alone would lock withdrawals at their peak; the cap must win
    // and must not leave a stale floor above the ceiling.
    const result = runSingleSimulation(
      makeParams({ withdrawalCap: 45_000, withdrawalRatchetLimit: 0.1 }),
      growing,
    )
    for (const w of result.periodData.withdrawal) {
      expect(w).toBeLessThanOrEqual(45_000 + 1e-6)
    }
  })

  it('caps the Merton amortized withdrawal too', () => {
    const params = makeParams({
      amortizedWithdrawal: true,
      withdrawalCap: 45_000,
      yearsLater: 20,
    })
    const uncapped = runSingleSimulation({ ...params, withdrawalCap: 0 }, growing)
    expect(Math.max(...uncapped.periodData.withdrawal)).toBeGreaterThan(45_000)

    const capped = runSingleSimulation(params, growing)
    for (const w of capped.periodData.withdrawal) {
      expect(w).toBeLessThanOrEqual(45_000 + 1e-6)
    }
  })

  it('defers VP capital gains tax by leaving gains unrealized', () => {
    // The point of the cap: unspent gains are never realized, so the annual
    // CGT bill drops and the invested capital compounds on a larger base.
    const vp = { capitalGainsTaxRate: 0.3, vpWealthTaxRate: 0.004, yearsLater: 20 }
    const uncapped = runSingleSimulation(makeParams(vp), growing)
    const capped = runSingleSimulation(makeParams({ ...vp, withdrawalCap: 45_000 }), growing)

    const cumTax = (r: typeof uncapped) => r.periodData.tax.reduce((a, b) => a + b, 0)
    const finalCapital = (r: typeof uncapped) => r.snapshots.capital[r.snapshots.capital.length - 1]!

    expect(cumTax(capped)).toBeLessThan(cumTax(uncapped))
    expect(finalCapital(capped)).toBeGreaterThan(finalCapital(uncapped))
  })
})

describe('withdrawal clamped to available capital', () => {
  // 200k/yr fixed out of 1M with zero return: the account is empty in year 5.
  const depleting = (overrides: Partial<InputParameters> = {}) =>
    makeParams({
      balanceWithdrawalRate: 0,
      inflationBasedWithdrawal: 200_000,
      capitalGainsTaxRate: 0.3,
      yearsLater: 10,
      assets: [{ name: 'A', weight: 1, expectedReturn: 0, volatility: 0 }],
      ...overrides,
    })

  it('stops withdrawing once the portfolio is empty', () => {
    const r = runSingleSimulation(depleting())

    // Five full withdrawals, then nothing — not 200k/yr forever.
    expect(r.periodData.withdrawal.slice(0, 5).map(Math.round)).toEqual([
      200_000, 200_000, 200_000, 200_000, 200_000,
    ])
    for (const w of r.periodData.withdrawal.slice(5)) {
      expect(w).toBeCloseTo(0, 2)
    }
  })

  it('never reports a negative balance or NaN', () => {
    for (const rebalance of ['annually', 'never'] as const) {
      const r = runSingleSimulation(
        depleting({
          assetRebalanceFrequency: rebalance,
          assets: [
            { name: 'A', weight: 0.5, expectedReturn: 0, volatility: 0 },
            { name: 'B', weight: 0.5, expectedReturn: 0, volatility: 0 },
          ],
          assetCorrelationMatrix: [
            [1, 0],
            [0, 1],
          ],
        }),
      )
      for (const series of [
        r.periodData.withdrawal,
        r.periodData.tax,
        r.snapshots.capital,
        r.snapshots.liquidValue,
      ]) {
        for (const v of series) {
          expect(Number.isFinite(v)).toBe(true)
        }
      }
      for (const c of r.snapshots.capital) {
        expect(c).toBeGreaterThanOrEqual(-0.01)
      }
    }
  })
})

describe('VP capital gains netting', () => {
  it('offsets a loss on one asset against a gain on another', () => {
    // A doubles to 1,000,000 (basis 500,000), B halves to 250,000 (basis
    // 500,000). Withdrawing 10% of 1,250,000 realizes +50,000 on A and
    // -25,000 on B, so the taxable net is 25,000 → 7,500 before gross-up.
    // Taxing each position separately would charge 15,000.
    const r = runSingleSimulation(
      makeParams({
        balanceWithdrawalRate: 0.1,
        capitalGainsTaxRate: 0.3,
        yearsLater: 1,
        assetRebalanceFrequency: 'never',
        assets: [
          { name: 'A', weight: 0.5, expectedReturn: 1.0, volatility: 0 },
          { name: 'B', weight: 0.5, expectedReturn: -0.5, volatility: 0 },
        ],
        assetCorrelationMatrix: [
          [1, 0],
          [0, 1],
        ],
      }),
    )
    // Post-withdrawal the portfolio is 1,125,000 against a basis of 900,000,
    // so the gross-up divisor is 1 - 0.2 * 0.3 = 0.94.
    expect(r.periodData.tax[0]!).toBeCloseTo(7_500 / 0.94, 2)
  })

  it('credits a net loss at 30% below the threshold', () => {
    // Asset halves: 500,000 against a 1,000,000 basis. Withdrawing 10% of
    // 500,000 realizes -50,000, under the 100,000 threshold → 15,000 credit.
    const r = runSingleSimulation(
      makeParams({
        balanceWithdrawalRate: 0.1,
        capitalGainsTaxRate: 0.3,
        yearsLater: 1,
        assets: [{ name: 'A', weight: 1, expectedReturn: -0.5, volatility: 0 }],
      }),
    )
    expect(r.periodData.tax[0]!).toBeCloseTo(-15_000, 2)
  })

  it('credits the excess above the threshold at 21%', () => {
    // 4M halves to 2M against a 4M basis; a 10% withdrawal realizes -200,000.
    // Credit = 100,000 * 30% + 100,000 * 21% = 51,000.
    const r = runSingleSimulation(
      makeParams({
        initialCapital: 4_000_000,
        balanceWithdrawalRate: 0.1,
        capitalGainsTaxRate: 0.3,
        yearsLater: 1,
        assets: [{ name: 'A', weight: 1, expectedReturn: -0.5, volatility: 0 }],
      }),
    )
    expect(r.periodData.tax[0]!).toBeCloseTo(-51_000, 2)
  })

  it('leaves ISK untouched by realized gains', () => {
    const r = runSingleSimulation(
      makeParams({
        balanceWithdrawalRate: 0.1,
        capitalGainsTaxRate: 0.3,
        iskTaxRate: 0.02,
        yearsLater: 1,
        assets: [{ name: 'A', weight: 1, expectedReturn: 1.0, volatility: 0 }],
      }),
    )
    // 2,000,000 grows, 200,000 withdrawn → 1,800,000 * 2% * 30% = 10,800.
    expect(r.periodData.tax[0]!).toBeCloseTo(10_800, 2)
  })
})

describe('tax paid from the portfolio is itself a realization', () => {
  it('grosses up the sale needed to settle the bill', () => {
    // 1M doubles to 2M (basis 1M). A 10% withdrawal realizes 100,000 → a
    // 30,000 bill. Raising that cash sells units that are 50% unrealized gain,
    // so the gross sale is 30,000 / (1 - 0.5 * 0.3) = 35,294.12.
    const r = runSingleSimulation(
      makeParams({
        balanceWithdrawalRate: 0.1,
        capitalGainsTaxRate: 0.3,
        yearsLater: 1,
        assets: [{ name: 'A', weight: 1, expectedReturn: 1.0, volatility: 0 }],
      }),
    )
    expect(r.periodData.tax[0]!).toBeCloseTo(30_000 / 0.85, 2)
    expect(r.snapshots.capital[0]!).toBeCloseTo(1_800_000 - 30_000 / 0.85, 2)
  })

  it('does not gross up an ISK bill', () => {
    const r = runSingleSimulation(
      makeParams({
        balanceWithdrawalRate: 0,
        capitalGainsTaxRate: 0.3,
        iskTaxRate: 0.02,
        yearsLater: 1,
        assets: [{ name: 'A', weight: 1, expectedReturn: 1.0, volatility: 0 }],
      }),
    )
    // No CGT in an ISK, so the bill is exactly 2,000,000 * 2% * 30%.
    expect(r.periodData.tax[0]!).toBeCloseTo(12_000, 2)
  })
})

// --- Quickselect correctness tests ---

describe('quickselect', () => {
  // Reference: sort-based k-th smallest.
  function sortedKth(arr: number[], k: number): number {
    return arr.slice().sort((a, b) => a - b)[k]!
  }

  it('finds exact median matching sort on random arrays', () => {
    // Use a seeded PRNG for reproducibility.
    const rng = (seed: number) => {
      let s = seed
      return () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff }
    }
    for (let trial = 0; trial < 50; trial++) {
      const r = rng(trial * 137)
      const n = 100 + trial * 20
      const arr = Array.from({ length: n }, () => r() * 200 - 100)
      const k = Math.floor(n / 2)
      const work = arr.slice()
      const got = quickselect(work, k, 0, n - 1)
      expect(got).toBe(sortedKth(arr, k))
    }
  })

  it('finds p10, p50, p90 matching sort', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => Math.sin(i) * 100)
    for (const pct of [0.1, 0.5, 0.9]) {
      const k = Math.floor(arr.length * pct)
      const work = arr.slice()
      const got = quickselect(work, k, 0, arr.length - 1)
      expect(got).toBe(sortedKth(arr, k))
    }
  })

  it('handles already-sorted input', () => {
    const arr = Array.from({ length: 500 }, (_, i) => i)
    const k = 250
    const work = arr.slice()
    expect(quickselect(work, k, 0, arr.length - 1)).toBe(250)
  })

  it('handles reverse-sorted input', () => {
    const arr = Array.from({ length: 500 }, (_, i) => 499 - i)
    const k = 250
    const work = arr.slice()
    expect(quickselect(work, k, 0, arr.length - 1)).toBe(250)
  })

  it('handles all-equal values', () => {
    const arr = new Array(100).fill(42)
    const work = arr.slice()
    expect(quickselect(work, 50, 0, 99)).toBe(42)
  })

  it('handles two-element array', () => {
    expect(quickselect([5, 3], 0, 0, 1)).toBe(3)
    expect(quickselect([5, 3], 1, 0, 1)).toBe(5)
  })

  it('handles single-element array', () => {
    expect(quickselect([7], 0, 0, 0)).toBe(7)
  })

  it('works with negative values', () => {
    const arr = [-10, -5, -1, 0, 1, 5, 10]
    const work = arr.slice()
    expect(quickselect(work, 3, 0, 6)).toBe(0)
  })

  it('chained calls narrow correctly (p10 < p50 < p90)', () => {
    // Simulate how calculateStats chains quickselect calls with
    // narrowing ranges.
    const arr = Array.from({ length: 1000 }, (_, i) => Math.cos(i * 0.1) * 50)
    const work = arr.slice()
    const n = work.length

    const i10 = Math.floor(n * 0.1)
    const i50 = Math.floor(n * 0.5)
    const i90 = Math.floor(n * 0.9)

    const p10 = quickselect(work, i10, 0, n - 1)
    const p50 = quickselect(work, i50, i10, n - 1)
    const p90 = quickselect(work, i90, i50, n - 1)

    expect(p10).toBe(sortedKth(arr, i10))
    expect(p50).toBe(sortedKth(arr, i50))
    expect(p90).toBe(sortedKth(arr, i90))
    expect(p10).toBeLessThanOrEqual(p50)
    expect(p50).toBeLessThanOrEqual(p90)
  })
})
