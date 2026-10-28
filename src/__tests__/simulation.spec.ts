import { describe, it, expect } from 'vitest'
import {
  spendingMultiplier,
  runSingleSimulation,
  capitalGainsTax,
  quickselect,
  simulateAll,
  bengenRate,
} from '../simulation'
import { DEFAULT_ASSET_CLASSES, DEFAULT_CORRELATIONS } from '../assets'
import type { InputParameters } from '../types'

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
    expect(spendingMultiplier(80, true)).toBeCloseTo(0.7, 8)
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
    const avg4559 = ((5 * (f45 + f50)) / 2 + (10 * (f50 + f60)) / 2) / 15
    expect(avg4559).toBeCloseTo(1.0, 8)

    // 60+ bucket: average of f(60) and f(80) = (0.84+0.70)/2 = 0.77
    const avg60 = (spendingMultiplier(60, true) + spendingMultiplier(80, true)) / 2
    expect(avg60).toBeCloseTo(0.77, 8)
  })

  it('clamps at boundary values for extreme ages', () => {
    // Below age 30: clamps to f(30)
    expect(spendingMultiplier(20, true)).toBeCloseTo(0.84, 8)
    expect(spendingMultiplier(0, true)).toBeCloseTo(0.84, 8)
    // Above age 80: clamps to f(80)
    expect(spendingMultiplier(90, true)).toBeCloseTo(0.7, 8)
    expect(spendingMultiplier(100, true)).toBeCloseTo(0.7, 8)
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

// Helper: parameter overrides for assets that return a constant amount every
// year and have no volatility, which removes the randomness from the return
// path. The rate is given per month to keep the figures readable.
function makePayload(monthlyReturn: number, nAssets: number = 1): Partial<InputParameters> {
  const annual = Math.pow(1 + monthlyReturn, 12) - 1
  return {
    assets: Array.from({ length: nAssets }, (_, i) => ({
      name: `ASSET${i}`,
      weight: 1 / nAssets,
      expectedReturn: annual,
      volatility: 0,
    })),
    assetCorrelationMatrix: Array.from({ length: nAssets }, (_, i) =>
      Array.from({ length: nAssets }, (_, j) => (i === j ? 1 : 0)),
    ),
  }
}

// Runs one simulation with the given constant-return assets laid over the
// parameters, so a test can pick its return path separately from the rest.
function run(params: InputParameters, returns: Partial<InputParameters> = {}) {
  return runSingleSimulation({ ...params, ...returns })
}

// Helper: build a minimal InputParameters for withdrawal tests.
// Zero inflation/tax/volatility to isolate the withdrawal logic.
function makeParams(overrides: Partial<InputParameters> = {}): InputParameters {
  return {
    seed: 'test',
    initialCapital: 1_000_000,
    startYear: 45,
    yearsLater: 36,
    assets: [{ name: 'A', weight: 1, expectedReturn: 0.05, volatility: 0.1 }],
    assetCorrelationMatrix: [[1]],
    assetRebalanceFrequency: 'annually',
    depositAmount: 0,
    depositYears: 0,
    withdrawalNeed: 40_000,
    withdrawalExtra: 0,
    bequestAmount: 0,
    ageAdjustedSpending: false,
    vpWealthTaxRate: 0,
    capitalGainsTaxRate: 0,
    inflationRate: 0,
    inflationStdDev: 0,
    ...overrides,
  }
}

describe('age-adjusted need', () => {
  // A flat portfolio isolates the shape of the need: nothing grows, so the
  // extra is zero and the need is paid exactly.
  const flat = makePayload(0)
  const params = (ageAdjustedSpending: boolean) =>
    makeParams({ ageAdjustedSpending, withdrawalNeed: 40_000, yearsLater: 20 })

  it('without age adjustment, the need is constant', () => {
    const w = run(params(false), flat).periodData.withdrawal
    for (const v of w) expect(v).toBeCloseTo(40_000, 6)
  })

  it('with age adjustment, the need follows the spending curve', () => {
    const w = run(params(true), flat).periodData.withdrawal
    expect(w[0]!).toBeCloseTo(40_000 * spendingMultiplier(45, true), 6)
    expect(w[19]!).toBeCloseTo(40_000 * spendingMultiplier(64, true), 6)
    expect(w[19]!).toBeLessThan(w[0]!)
  })
})

describe('the extra', () => {
  const flat = makePayload(0)

  it('is paid out of a surplus and never exceeds what was asked for', () => {
    // 1M flat, 10 years of need 20k: 800k of surplus against 10 * 30k of extra.
    const r = run(
      makeParams({ withdrawalNeed: 20_000, withdrawalExtra: 30_000, yearsLater: 10 }),
      flat,
    )
    for (const w of r.periodData.withdrawal) expect(w).toBeLessThanOrEqual(50_000 + 1e-6)
    expect(r.periodData.withdrawal[0]!).toBeCloseTo(50_000, 6)
  })

  it('is withheld when the surplus cannot carry it, but the need is still paid', () => {
    // 100k flat against 10 * 20k need: no surplus at all.
    const r = run(
      makeParams({
        initialCapital: 200_000,
        withdrawalNeed: 20_000,
        withdrawalExtra: 30_000,
        yearsLater: 10,
      }),
      flat,
    )
    for (const w of r.periodData.withdrawal) expect(w).toBeCloseTo(20_000, 6)
  })

  it('ends a flat portfolio with nothing left when the extra is large enough', () => {
    // Spending exactly the capital over the horizon: the last year's annuity
    // factor is one, so the rule empties the account rather than aiming at zero
    // and missing.
    const r = run(makeParams({ withdrawalNeed: 0, withdrawalExtra: 200_000, yearsLater: 5 }), flat)
    expect(r.snapshots.capital[4]!).toBeCloseTo(0, 6)
    expect(r.periodData.withdrawal.reduce((a, b) => a + b, 0)).toBeCloseTo(1_000_000, 4)
  })
})

describe('schablonmetoden capital gains tax', () => {
  it('uses the actual cost when it exceeds 20% of the proceeds', () => {
    // Gain 40 on proceeds 100 (basis 60): 40 * 30% = 12.
    expect(capitalGainsTax(100, 60, 0.3)).toBeCloseTo(12, 10)
  })

  it('caps the effective rate at 24% of proceeds for a near-zero basis', () => {
    expect(capitalGainsTax(100, 0, 0.3)).toBeCloseTo(24, 10)
    expect(capitalGainsTax(100, 5, 0.3)).toBeCloseTo(24, 10)
  })

  it('is continuous at the point where the schablon basis takes over', () => {
    expect(capitalGainsTax(100, 20, 0.3)).toBeCloseTo(24, 10)
  })

  it('does not tax losses', () => {
    expect(capitalGainsTax(100, 150, 0.3)).toBe(0)
  })

  it('taxes VP withdrawals at 24% of proceeds once the basis is negligible', () => {
    // 2% monthly growth (~27%/year) makes the initial cost basis a vanishing
    // fraction of the portfolio after a couple of decades.
    const params = makeParams({ capitalGainsTaxRate: 0.3, yearsLater: 36 })
    const result = run({ ...params, ...makePayload(0.02) })

    const last = params.yearsLater - 1
    const ratio = result.periodData.tax[last]! / result.periodData.withdrawal[last]!
    // 24% of the proceeds is the tax on the withdrawal itself. The year's bill
    // is then paid by selling holdings that are 80% gain, which realizes more
    // gain: G = tax / (1 - 0.8 * 0.3).
    expect(ratio).toBeCloseTo(0.24 / (1 - 0.8 * 0.3), 3)
  })
})

describe('withdrawal clamped to available capital', () => {
  // 200k/yr fixed out of 1M with zero return: the account is empty in year 5.
  const depleting = (overrides: Partial<InputParameters> = {}) =>
    makeParams({
      withdrawalNeed: 200_000,
      capitalGainsTaxRate: 0.3,
      yearsLater: 10,
      assets: [{ name: 'A', weight: 1, expectedReturn: 0, volatility: 0 }],
      ...overrides,
    })

  it('stops withdrawing once the portfolio is empty', () => {
    const r = run(depleting())

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
      const r = run(
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
    const r = run(
      makeParams({
        withdrawalNeed: 125_000,
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
    const r = run(
      makeParams({
        withdrawalNeed: 50_000,
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
    const r = run(
      makeParams({
        initialCapital: 4_000_000,
        withdrawalNeed: 200_000,
        capitalGainsTaxRate: 0.3,
        yearsLater: 1,
        assets: [{ name: 'A', weight: 1, expectedReturn: -0.5, volatility: 0 }],
      }),
    )
    expect(r.periodData.tax[0]!).toBeCloseTo(-51_000, 2)
  })

  it('leaves ISK untouched by realized gains', () => {
    const r = run(
      makeParams({
        withdrawalNeed: 200_000,
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

describe('cumulative tax includes the deferred liability', () => {
  const growing = makePayload(Math.pow(1.07, 1 / 12) - 1)

  it('adds the embedded CGT to the VP tax snapshot', () => {
    const r = run(
      makeParams({ capitalGainsTaxRate: 0.3, vpWealthTaxRate: 0.004, yearsLater: 20 }),
      growing,
    )
    const paid = r.periodData.tax.reduce((a, b) => a + b, 0)
    const last = r.snapshots.tax.length - 1
    const embedded = r.snapshots.capital[last]! - r.snapshots.liquidValue[last]!

    expect(embedded).toBeGreaterThan(0) // sanity: there is a deferred liability
    expect(r.snapshots.tax[last]!).toBeCloseTo(paid + embedded, 2)
  })

  it('leaves ISK unchanged, since it has no deferred CGT', () => {
    const r = run(
      makeParams({ capitalGainsTaxRate: 0.3, iskTaxRate: 0.0296, yearsLater: 20 }),
      growing,
    )
    const paid = r.periodData.tax.reduce((a, b) => a + b, 0)
    const last = r.snapshots.tax.length - 1

    expect(r.snapshots.capital[last]!).toBeCloseTo(r.snapshots.liquidValue[last]!, 6)
    expect(r.snapshots.tax[last]!).toBeCloseTo(paid, 2)
  })

  it('treats an unrealized loss as a deferred tax asset', () => {
    // Portfolio halves and stays down: liquidating would realize a loss, so the
    // burden is below what was actually paid.
    const r = run(
      makeParams({
        withdrawalNeed: 5_000,
        capitalGainsTaxRate: 0.3,
        vpWealthTaxRate: 0.004,
        yearsLater: 1,
        assets: [{ name: 'A', weight: 1, expectedReturn: -0.5, volatility: 0 }],
      }),
    )
    expect(r.snapshots.tax[0]!).toBeLessThan(r.periodData.tax[0]!)
  })
})

describe('tax paid from the portfolio is itself a realization', () => {
  it('grosses up the sale needed to settle the bill', () => {
    // 1M doubles to 2M (basis 1M). A 10% withdrawal realizes 100,000 → a
    // 30,000 bill. Raising that cash sells units that are 50% unrealized gain,
    // so the gross sale is 30,000 / (1 - 0.5 * 0.3) = 35,294.12.
    const r = run(
      makeParams({
        withdrawalNeed: 200_000,
        capitalGainsTaxRate: 0.3,
        yearsLater: 1,
        assets: [{ name: 'A', weight: 1, expectedReturn: 1.0, volatility: 0 }],
      }),
    )
    expect(r.periodData.tax[0]!).toBeCloseTo(30_000 / 0.85, 2)
    expect(r.snapshots.capital[0]!).toBeCloseTo(1_800_000 - 30_000 / 0.85, 2)
  })

  it('does not gross up an ISK bill', () => {
    const r = run(
      makeParams({
        withdrawalNeed: 0,
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

describe('agreement with the Kapitalplanerare', () => {
  // The planner propagates the whole return density over a grid instead of
  // sampling, and shares the rule in arva.ts. On the same plan the two must
  // agree to within sampling noise; this catches an ordering or discounting
  // mistake in either. The figures are the planner's (default plan, ISK with
  // no fribelopp, inflation known): survival of the need alone ~90%, of the
  // dynamic rule ~86%, and expected real spending 7.81 and 10.81 mkr. 20 000
  // paths reproduced them to 7.83 and 10.83 mkr and 90.0% and 86.2%.
  const plan = (withdrawalExtra: number) =>
    makeParams({
      initialCapital: 9_000_000,
      startYear: 60,
      yearsLater: 40,
      assets: DEFAULT_ASSET_CLASSES,
      assetCorrelationMatrix: DEFAULT_CORRELATIONS,
      withdrawalNeed: 200_000,
      withdrawalExtra,
      capitalGainsTaxRate: 0.3,
      iskTaxRate: 0.04,
      iskTaxRateStdDev: 0,
      inflationRate: 0.02,
      inflationStdDev: 0,
    })

  function measure(withdrawalExtra: number, paths: number) {
    let survived = 0
    let spent = 0
    for (let i = 0; i < paths; i++) {
      const r = run({ ...plan(withdrawalExtra), seed: `planner-${i}` })
      const w = r.periodData.withdrawalReal
      if (w.every((x) => x >= 200_000 - 1)) survived++
      spent += w.reduce((a, b) => a + b, 0)
    }
    return { survival: survived / paths, spent: spent / paths }
  }

  it('matches survival and expected spending of the need alone', () => {
    const m = measure(0, 4000)
    expect(m.survival).toBeGreaterThan(0.87)
    expect(m.survival).toBeLessThan(0.93)
    expect(m.spent / 1e6).toBeGreaterThan(7.6)
    expect(m.spent / 1e6).toBeLessThan(8.0)
  })

  it('matches survival and expected spending of the dynamic rule', () => {
    const m = measure(100_000, 4000)
    expect(m.survival).toBeGreaterThan(0.83)
    expect(m.survival).toBeLessThan(0.89)
    expect(m.spent / 1e6).toBeGreaterThan(10.5)
    expect(m.spent / 1e6).toBeLessThan(11.1)
  })
})

describe('how many paths simulateAll runs', () => {
  // Flat, certain assets: every path is the same, so survival is known exactly
  // and the only question is how soon the intervals are narrow enough.
  const certain = (overrides: Partial<InputParameters> = {}) =>
    makeParams({
      ...makePayload(0),
      withdrawalNeed: 10_000,
      withdrawalExtra: 0,
      yearsLater: 10,
      ...overrides,
    })

  it('stops as soon as survival and the scenario difference are known well enough', () => {
    const r = simulateAll([certain(), certain({ iskTaxRate: 0 })], ['VP', 'ISK'], undefined)
    expect(r.convergence.stopReason).toBe('precision')
    expect(r.convergence.converged).toBe(true)
    // The first check is after the minimum number of paths.
    expect(r.convergence.paths).toBeLessThan(1000)
    expect(r.statistics).toHaveLength(2)
    expect(r.outcomeProbabilities[0]!.survivalRate).toBe(1)
  })

  it('keeps going while the difference between scenarios is not yet resolved', () => {
    // The second scenario withdraws more than the first, so it fails in some
    // paths and not others, and the pairing takes more paths to pin down.
    const volatile = (need: number) =>
      certain({
        withdrawalNeed: need,
        assets: [{ name: 'A', weight: 1, expectedReturn: 0.04, volatility: 0.18 }],
        assetCorrelationMatrix: [[1]],
        yearsLater: 30,
      })
    const r = simulateAll([volatile(40_000), volatile(41_000)], ['a', 'b'], undefined)
    expect(r.convergence.paths).toBeGreaterThan(1000)
    expect(r.convergence.differenceHalfWidth[1]!).toBeGreaterThan(0)
  })

  it('says so when the time budget runs out before the intervals are narrow', () => {
    let t = 0
    const slowClock = () => (t += 2000)
    const volatile = certain({
      assets: [{ name: 'A', weight: 1, expectedReturn: 0.04, volatility: 0.18 }],
      assetCorrelationMatrix: [[1]],
      withdrawalNeed: 40_000,
      yearsLater: 30,
    })
    const r = simulateAll([volatile], ['a'], undefined, { timeBudgetMs: 5000, now: slowClock })
    expect(r.convergence.stopReason).toBe('time')
    expect(r.convergence.converged).toBe(false)
    expect(r.convergence.paths).toBeLessThan(2000)
  })

  it('gives the same answer twice when it stops on precision, so a shared link reproduces', () => {
    const volatile = certain({
      assets: [{ name: 'A', weight: 1, expectedReturn: 0.04, volatility: 0.18 }],
      assetCorrelationMatrix: [[1]],
      withdrawalNeed: 20_000,
      yearsLater: 30,
      seed: 'repeat',
    })
    const a = simulateAll([volatile], ['a'], undefined)
    const b = simulateAll([volatile], ['a'], undefined)
    expect(a.convergence.paths).toBe(b.convergence.paths)
    expect(a.outcomeProbabilities).toEqual(b.outcomeProbabilities)
  })

  it('counts a plan that ends at zero having paid its need as surviving', () => {
    // 5 years of 200 000 out of 1 000 000, flat: the last withdrawal empties it.
    const r = run(certain({ withdrawalNeed: 200_000, yearsLater: 5 }))
    expect(r.needFunded).toBe(true)
    expect(r.snapshots.capital[4]!).toBeCloseTo(0, 6)
    // One year more than the money covers is a failure.
    expect(run(certain({ withdrawalNeed: 200_000, yearsLater: 6 })).needFunded).toBe(false)
  })
})

describe('withdrawalFailureAsZero', () => {
  const flat = (overrides: Partial<InputParameters> = {}) =>
    makeParams({ ...makePayload(0), yearsLater: 10, ...overrides })

  it('is the plain total when the plan survives', () => {
    // 1 000 000 flat, 50 000 a year for 10 years: 500 000 over the plan.
    const r = simulateAll([flat({ withdrawalNeed: 50_000 })], ['a'], undefined)
    expect(r.withdrawalFailureAsZero[0]!.percentile10).toBeCloseTo(500_000, 6)
    expect(r.withdrawalFailureAsZero[0]!.median).toBeCloseTo(500_000, 6)
  })

  it('is zero when the plan fails, even though most of the money was paid before it did', () => {
    // 150 000 a year out of 1 000 000: nine years are paid, the tenth is not.
    // Received, that is 900 000; counted as a failure it is nothing.
    const r = simulateAll([flat({ withdrawalNeed: 150_000 })], ['a'], undefined)
    expect(r.outcomeProbabilities[0]!.survivalRate).toBe(0)
    expect(r.withdrawalFailureAsZero[0]!.percentile10).toBe(0)
    expect(r.withdrawalFailureAsZero[0]!.median).toBe(0)
    // The received total is untouched for everything else that reads it.
    expect(r.statistics[0]!.median.snapshots.withdrawalReal[9]!).toBeGreaterThan(800_000)
  })
})

describe('bengenRate', () => {
  const flat = (annualReturn: number, overrides: Partial<InputParameters> = {}) =>
    makeParams({
      assets: [{ name: 'A', weight: 1, expectedReturn: annualReturn, volatility: 0 }],
      assetCorrelationMatrix: [[1]],
      ...overrides,
    })

  it('is the capital over the years when nothing grows', () => {
    // 1 000 000 over 20 years at no return: 50 000 a year empties it exactly.
    const b = bengenRate(flat(0, { yearsLater: 20 }), 20)
    expect(b.atLeast).toBe(false)
    expect(b.amount).toBeLessThanOrEqual(50_000 + 1e-6)
    expect(b.amount).toBeGreaterThan(50_000 - 150)
    expect(b.rate).toBeCloseTo(0.05, 3)
  })

  it('is the level annuity when the return is certain', () => {
    // Withdrawals come after the year's return, so this is an ordinary annuity:
    // P = C·r / (1 - (1 + r)^-n).
    const r = 0.05
    const n = 30
    const annuity = (1_000_000 * r) / (1 - Math.pow(1 + r, -n))
    const b = bengenRate(flat(r, { yearsLater: n }), 20)
    expect(b.amount).toBeLessThanOrEqual(annuity + 1e-6)
    expect(b.amount).toBeGreaterThan(annuity - 150)
  })

  it('ignores the extra, the bequest and the age curve, which are not Bengen’s rule', () => {
    const plain = bengenRate(flat(0.03, { yearsLater: 25 }), 20)
    const decorated = bengenRate(
      flat(0.03, {
        yearsLater: 25,
        withdrawalExtra: 80_000,
        bequestAmount: 500_000,
        ageAdjustedSpending: true,
      }),
      20,
    )
    expect(decorated.amount).toBe(plain.amount)
  })

  it('reports a lower bound when even the ceiling survives', () => {
    const b = bengenRate(flat(0.5, { yearsLater: 10 }), 20)
    expect(b.atLeast).toBe(true)
    expect(b.rate).toBeCloseTo(0.1, 12)
  })

  it('asks for less when it must survive more of the paths', () => {
    const volatile = flat(0.04, {
      assets: [{ name: 'A', weight: 1, expectedReturn: 0.04, volatility: 0.18 }],
      yearsLater: 30,
      seed: 'bengen',
    })
    const lenient = bengenRate(volatile, 400, 0.8)
    const strict = bengenRate(volatile, 400, 0.99)
    expect(strict.amount).toBeLessThan(lenient.amount)
  })

  it('is reported once per scenario by simulateAll', () => {
    const r = simulateAll([flat(0.03), flat(0.03, { iskTaxRate: 0.04 })], ['VP', 'ISK'], undefined)
    expect(r.bengen).toHaveLength(2)
    for (const b of r.bengen) expect(b.targetSurvival).toBe(0.95)
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
      return () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff
        return s / 0x7fffffff
      }
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
