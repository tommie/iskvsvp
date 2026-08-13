import { describe, it, expect } from 'vitest'
import seedrandom from 'seedrandom'

import { portfolioMoments, runPlanner } from '../planner/propagate'
import { buildCashflow, defaultPlannerParameters } from '../planner/assets'
import type { PlannerParameters, PropagationRun, YearOutcome } from '../planner/types'

const LOSS_CREDIT_THRESHOLD = 100_000
const LOSS_CREDIT_UPPER_QUOTA = 0.7

function af(overrides: Partial<PlannerParameters> = {}): PlannerParameters {
  const base = defaultPlannerParameters()
  const merged: PlannerParameters = {
    ...base,
    accountType: 'AF',
    // Inflation only reaches a real AF result through the nominal loss-credit
    // threshold, so pin it unless a test is about that.
    inflationRate: 0,
    ...overrides,
  }
  if (overrides.years !== undefined && overrides.cashflow === undefined) {
    merged.cashflow = buildCashflow(overrides.years, 0, 0)
  }
  return merged
}

/** The last year of the net-of-deferred-tax series. */
function netFinal(run: PropagationRun): YearOutcome {
  const series = run.liquidOutcomes!
  return series[series.length - 1]!
}

/** A one-asset portfolio, so the lognormal parameters are known exactly. */
function singleAsset(expectedRealReturn: number, volatility: number) {
  return {
    assets: [{ id: 'a', name: 'A', weight: 1, expectedRealReturn, volatility }],
    correlations: [[1]],
  }
}

/**
 * One year of the AF rules in absolute (value, basis) terms.
 *
 * Written independently of the grid engine, which works in basis *ratios*, so
 * agreement between the two is a real check rather than a restatement.
 */
function afYear(
  wealth: number,
  basis: number,
  growth: number,
  flow: number,
  p: PlannerParameters,
  lossThreshold: number,
  turnover: number,
): { wealth: number; basis: number; ruined: boolean } {
  const grown = wealth * growth
  const afterFlow = grown - flow
  if (afterFlow <= 0) return { wealth: 0, basis: 0, ruined: true }

  let currentBasis = basis
  let realizedGain = 0
  if (flow >= 0) {
    const fraction = flow / grown
    realizedGain = flow - currentBasis * fraction
    currentBasis *= 1 - fraction
  } else {
    currentBasis += -flow
  }

  if (turnover > 0) {
    realizedGain += turnover * (afterFlow - currentBasis)
    currentBasis = currentBasis * (1 - turnover) + turnover * afterFlow
  }

  const netCapitalIncome = afterFlow * p.afSchablonRate + realizedGain
  let tax: number
  if (netCapitalIncome >= 0) {
    tax = netCapitalIncome * p.capitalGainsTaxRate
  } else {
    const loss = -netCapitalIncome
    const lower = Math.min(loss, lossThreshold)
    const upper = loss - lower
    tax = -(lower * p.capitalGainsTaxRate + upper * p.capitalGainsTaxRate * LOSS_CREDIT_UPPER_QUOTA)
  }
  tax = Math.min(tax, Math.max(0, afterFlow))

  if (tax > 0) {
    const unrealized = Math.max(0, (afterFlow - currentBasis) / afterFlow)
    const denominator = 1 - unrealized * p.capitalGainsTaxRate
    if (denominator > 0) tax = Math.min(tax / denominator, afterFlow)
  }

  const next = afterFlow - tax
  if (next <= 0) return { wealth: 0, basis: 0, ruined: true }

  if (tax > 0) {
    currentBasis *= 1 - tax / afterFlow
  } else if (tax < 0) {
    currentBasis += -tax
  }

  return { wealth: next, basis: currentBasis, ruined: false }
}

describe('AF propagation', () => {
  it('produces a result instead of refusing, and reports a liquidation value', () => {
    const result = runPlanner(af({ years: 20, cashflow: buildCashflow(20, 200_000, 0) }))
    expect(result.needRun.liquidOutcomes).toBeDefined()
    expect(result.needRun.outcomes).toHaveLength(21)
  })

  it('leaves ISK without a liquidation value, having no deferred tax', () => {
    const result = runPlanner({
      ...defaultPlannerParameters(),
      years: 10,
      cashflow: buildCashflow(10, 100_000, 0),
    })
    expect(result.needRun.liquidOutcomes).toBeUndefined()
  })

  it('conserves probability mass', () => {
    const run = runPlanner(af({ years: 25, cashflow: buildCashflow(25, 250_000, 100_000) }))
    for (const propagation of [run.needRun, run.extraRun]) {
      // Three places a path can end: failed, spent out, or holding capital.
      let total =
        propagation.finalDistribution.ruinProbability +
        propagation.finalDistribution.depletedProbability
      for (const m of propagation.finalDistribution.mass) total += m
      expect(total).toBeCloseTo(1, 9)
    }
  })

  it('matches an absolute-terms recursion when volatility is zero', () => {
    const years = 15
    const flow = 100_000
    const p = af({
      years,
      initialCapital: 1_000_000,
      initialCostBasisRatio: 1,
      cashflow: buildCashflow(years, flow, 0),
      ...singleAsset(0.1, 0),
    })
    const result = runPlanner(p)

    let wealth = p.initialCapital
    let basis = p.initialCapital * p.initialCostBasisRatio
    for (let i = 0; i < years; i++) {
      const stepped = afYear(wealth, basis, 1.1, flow, p, LOSS_CREDIT_THRESHOLD, 0)
      wealth = stepped.wealth
      basis = stepped.basis
    }

    // Returns compound the value but never the basis, so this exercises the
    // ratio transition, the realised gain on each withdrawal and the gross-up.
    //
    // Unlike the ISK case this cannot be exact. With no volatility there is no
    // averaging over returns to smooth the cost-basis interpolation, and the
    // ratio sweeps across the whole basis grid as the value compounds away from
    // the basis, so every year contributes discretisation error.
    const atDefault = result.needRun.outcomes[years]!.mean
    expect(Math.abs(atDefault / wealth - 1)).toBeLessThan(0.01)

    const liquid = wealth - Math.max(0, wealth - basis) * p.capitalGainsTaxRate
    expect(Math.abs(netFinal(result.needRun).mean / liquid - 1)).toBeLessThan(0.01)

    // What makes that discretisation rather than a modelling error: refining
    // the basis grid converges on the closed-form recursion.
    const refined = runPlanner({ ...p, basisNodes: 256 }).needRun.outcomes[years]!.mean
    expect(Math.abs(refined / wealth - 1)).toBeLessThan(Math.abs(atDefault / wealth - 1) / 4)
  })

  it('values a fully taxed holding below its balance, and an untaxed one at par', () => {
    const years = 20
    const shared = {
      years,
      initialCapital: 3_000_000,
      cashflow: buildCashflow(years, 0, 0),
      ...singleAsset(0, 0),
    }

    // No growth and basis equal to value: nothing is unrealised, so settling
    // the tax costs nothing.
    const par = runPlanner(af({ ...shared, initialCostBasisRatio: 1 }))
    expect(netFinal(par.needRun).median).toBeCloseTo(par.needRun.outcomes[years]!.median, 0)

    // Half the balance is untaxed gain, so liquidation gives up 30% of it.
    const embedded = runPlanner(af({ ...shared, initialCostBasisRatio: 0.5 }))
    const capital = embedded.needRun.outcomes[years]!.median
    expect(netFinal(embedded.needRun).median).toBeLessThan(capital)
    expect(netFinal(embedded.needRun).median / capital).toBeCloseTo(1 - 0.5 * 0.3, 2)
  })

  it('defers more tax the longer it compounds', () => {
    const build = (years: number) =>
      runPlanner(
        af({
          years,
          initialCapital: 1_000_000,
          initialCostBasisRatio: 1,
          cashflow: buildCashflow(years, 0, 0),
          ...singleAsset(0.06, 0),
        }),
      ).needRun

    // The basis never grows, so the embedded gain — and the gap between the
    // balance and what it is worth after tax — widens with the horizon.
    const gap = (years: number) => {
      const run = build(years)
      const capital = run.outcomes[years]!.mean
      return (capital - netFinal(run).mean) / capital
    }
    expect(gap(30)).toBeGreaterThan(gap(10))
    expect(gap(10)).toBeGreaterThan(0)
  })

  it('raises the cost basis when money is deposited', () => {
    const years = 10
    const shared = {
      years,
      initialCapital: 1_000_000,
      initialCostBasisRatio: 0.2,
      ...singleAsset(0.05, 0),
    }
    const noDeposits = runPlanner(af({ ...shared, cashflow: buildCashflow(years, 0, 0) })).needRun
    const deposits = runPlanner(
      af({ ...shared, cashflow: buildCashflow(years, -200_000, 0) }),
    ).needRun

    // Deposits buy at market, so they add basis and dilute the embedded gain.
    const embeddedShare = (run: typeof noDeposits, index: number) =>
      1 - netFinal(run).mean / run.outcomes[index]!.mean
    expect(embeddedShare(deposits, years)).toBeLessThan(embeddedShare(noDeposits, years))
  })

  it('realises more gain the further the assets drift apart', () => {
    const years = 25
    // Same assets and weights throughout; only the correlation changes. Lower
    // correlation means the holdings drift apart further each year, so
    // rebalancing has to sell more to restore the targets.
    const twoAssets = (correlation: number) => ({
      assets: [
        { id: 'a', name: 'A', weight: 0.5, expectedRealReturn: 0.06, volatility: 0.18 },
        { id: 'b', name: 'B', weight: 0.5, expectedRealReturn: 0.06, volatility: 0.18 },
      ],
      correlations: [
        [1, correlation],
        [correlation, 1],
      ],
    })
    const shared = {
      years,
      initialCapital: 4_000_000,
      initialCostBasisRatio: 1,
      cashflow: buildCashflow(years, 100_000, 0),
    }

    const locked = runPlanner(af({ ...shared, ...twoAssets(1) }))
    const drifting = runPlanner(af({ ...shared, ...twoAssets(0) }))

    // Perfectly correlated assets of equal volatility never diverge, so there
    // is nothing to rebalance and nothing to realise.
    expect(locked.portfolio.rebalancingTurnover).toBeCloseTo(0, 10)
    expect(drifting.portfolio.rebalancingTurnover).toBeGreaterThan(0.02)

    // Realising gain along the way steps the basis up, so less tax stays
    // embedded in the final balance.
    const embedded = (run: typeof locked.needRun) =>
      1 - netFinal(run).mean / run.outcomes[years]!.mean
    expect(embedded(drifting.needRun)).toBeLessThan(embedded(locked.needRun))
  })

  it('pays a loss credit back into the portfolio', () => {
    const years = 1
    // A deep loss with a fresh basis: the realised loss on the withdrawal
    // swamps the schablon, so the net capital income is negative.
    const p = af({
      years,
      initialCapital: 2_000_000,
      initialCostBasisRatio: 1,
      cashflow: buildCashflow(years, 500_000, 0),
      ...singleAsset(-0.5, 0),
    })
    const result = runPlanner(p)

    const expected = afYear(2_000_000, 2_000_000, 0.5, 500_000, p, LOSS_CREDIT_THRESHOLD, 0)
    expect(result.needRun.outcomes[1]!.mean / expected.wealth).toBeCloseTo(1, 5)
    // A credit, not a charge: the balance ends above the untaxed 500 000.
    expect(result.needRun.outcomes[1]!.mean).toBeGreaterThan(500_000)
  })

  it('taxes the nominal gain, not the real one', () => {
    const years = 20
    const inflation = 0.02
    const p = af({
      years,
      inflationRate: inflation,
      initialCapital: 1_000_000,
      initialCostBasisRatio: 1,
      cashflow: buildCashflow(years, 0, 0),
      // Zero *real* return: in real terms the holding never gains a krona.
      ...singleAsset(0, 0),
    })
    const run = runPlanner(p).needRun

    // Nominally it has gained, because the cost basis is fixed in kronor and
    // the price level is not. Swedish law does not index the omkostnadsbelopp,
    // so that nominal gain is taxable and liquidation costs something.
    const capital = run.outcomes[years]!.mean
    expect(netFinal(run).mean).toBeLessThan(capital * 0.97)

    // The reference runs in nominal kronor, where the basis is simply constant,
    // and is deflated only at the end — so it shares no algebra with the
    // engine's unit-free ratio.
    let nominalWealth = p.initialCapital
    let nominalBasis = p.initialCapital
    let priceLevel = 1
    for (let year = 0; year < years; year++) {
      priceLevel *= 1 + inflation
      const stepped = afYear(
        nominalWealth,
        nominalBasis,
        1 + inflation,
        0,
        p,
        LOSS_CREDIT_THRESHOLD,
        0,
      )
      nominalWealth = stepped.wealth
      nominalBasis = stepped.basis
    }
    const realWealth = nominalWealth / priceLevel
    const realLiquid =
      (nominalWealth - Math.max(0, nominalWealth - nominalBasis) * p.capitalGainsTaxRate) /
      priceLevel

    expect(Math.abs(capital / realWealth - 1)).toBeLessThan(0.01)
    expect(Math.abs(netFinal(run).mean / realLiquid - 1)).toBeLessThan(0.01)
  })

  it('deflates the nominal loss-credit threshold', () => {
    const years = 30
    const shared = {
      years,
      initialCapital: 2_000_000,
      cashflow: buildCashflow(years, 150_000, 0),
      ...singleAsset(0.02, 0.18),
    }
    const noInflation = runPlanner(af({ ...shared, inflationRate: 0 })).needRun
    const highInflation = runPlanner(af({ ...shared, inflationRate: 0.06 })).needRun

    // The 100 000 kr threshold is nominal, so inflation shrinks the band that
    // earns the full credit rate and losses are relieved less generously.
    expect(highInflation.outcomes[years]!.mean).toBeLessThan(noInflation.outcomes[years]!.mean)
  })

  describe('validation', () => {
    it('rejects a basis grid too coarse to interpolate', () => {
      expect(() => runPlanner(af({ basisNodes: 1 }))).toThrow(/at least 2 basisNodes/)
    })

    it('rejects a negative starting cost basis', () => {
      expect(() => runPlanner(af({ initialCostBasisRatio: -0.1 }))).toThrow(/initialCostBasisRatio/)
    })
  })
})

describe('AF against Monte Carlo', () => {
  /**
   * The cost-basis dimension is the whole of the AF implementation, and none of
   * the analytic checks above exercise it jointly with a random return path.
   * This runs the identical rules path-wise in absolute (value, basis) terms
   * and compares, which is what would catch a wrong ratio transition, a
   * mis-ordered rebalance or a gross-up applied to the wrong balance.
   */
  it('agrees on ruin, percentiles and liquidation value', () => {
    const years = 25
    const inflation = 0.02
    const p = af({
      years,
      inflationRate: inflation,
      initialCapital: 5_000_000,
      initialCostBasisRatio: 0.7,
      cashflow: buildCashflow(years, 200_000, 0),
      // Two assets that drift, so the reference recursion has to reproduce the
      // rebalancing realisations as well as the withdrawals.
      assets: [
        { id: 'a', name: 'A', weight: 0.6, expectedRealReturn: 0.06, volatility: 0.18 },
        { id: 'b', name: 'B', weight: 0.4, expectedRealReturn: 0.03, volatility: 0.08 },
      ],
      correlations: [
        [1, 0.2],
        [0.2, 1],
      ],
    })

    const moments = portfolioMoments(p.assets, p.correlations)
    const rng = seedrandom('planner-vp-cross-check')
    const paths = 150_000
    const finals: number[] = []
    const liquids: number[] = []
    let ruined = 0

    // Everything below is in nominal kronor, where the cost basis is simply a
    // constant and the loss-credit threshold needs no deflation. Deflating only
    // at the end is what makes this an independent check of the engine, which
    // works in real terms with a unit-free basis ratio.
    for (let path = 0; path < paths; path++) {
      let wealth = p.initialCapital
      let basis = p.initialCapital * p.initialCostBasisRatio
      let priceLevel = 1
      let alive = true

      for (let year = 0; year < years; year++) {
        const u1 = Math.max(rng(), Number.MIN_VALUE)
        const u2 = rng()
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
        const realGrowth = Math.exp(moments.logMean + moments.logStdDev * z)

        priceLevel *= 1 + inflation
        const stepped = afYear(
          wealth,
          basis,
          realGrowth * (1 + inflation),
          p.cashflow[year]!.need * priceLevel,
          p,
          LOSS_CREDIT_THRESHOLD,
          moments.rebalancingTurnover,
        )
        if (stepped.ruined) {
          alive = false
          break
        }
        wealth = stepped.wealth
        basis = stepped.basis
      }

      if (alive) {
        finals.push(wealth / priceLevel)
        liquids.push((wealth - Math.max(0, wealth - basis) * p.capitalGainsTaxRate) / priceLevel)
      } else ruined++
    }

    finals.sort((a, b) => a - b)
    liquids.sort((a, b) => a - b)

    const quantile = (sorted: number[], q: number) => {
      const rank = q * paths - ruined
      if (rank <= 0) return 0
      return sorted[Math.min(sorted.length - 1, Math.floor(rank))]!
    }

    const run = runPlanner(p).needRun
    const final = run.outcomes[years]!

    expect(run.finalDistribution.ruinProbability).toBeCloseTo(ruined / paths, 2)

    for (const [q, gridValue] of [
      [0.5, final.median],
      [0.75, final.percentile75],
      [0.9, final.percentile90],
    ] as const) {
      expect(Math.abs(gridValue / quantile(finals, q) - 1)).toBeLessThan(0.03)
    }

    expect(Math.abs(netFinal(run).median / quantile(liquids, 0.5) - 1)).toBeLessThan(0.03)
  })
})
