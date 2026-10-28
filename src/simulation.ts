import { alea } from 'seedrandom'
import type {
  BengenRate,
  InputParameters,
  SimulationResult,
  SimulationResults,
  SimulationStatistics,
  SimulationPeriodData,
  FinalAssetWeights,
} from './types'
import { arvaWithdrawal, reserveSchedule, returnLaw } from './arva'
import {
  BATCH_PATHS,
  DEFAULT_TIME_BUDGET_MS,
  MIN_PATHS,
  SurvivalTally,
  TARGET_DIFFERENCE_HALF_WIDTH,
  TARGET_SURVIVAL_HALF_WIDTH,
  type Convergence,
  type StopReason,
} from './precision'
import { realReturnSampler } from './returns'
import { horizonYears } from './types'

// Extended result that includes final asset weights and cumulative inflation
export interface SingleSimulationResult extends SimulationResult<number> {
  finalAssetWeights: number[]
  finalCumulativeInflation: number
  // Whether the need was paid in full in every withdrawal year.
  needFunded: boolean
}

const ISK_TAX_RATE_MIN = 0.0125

// Under schablonmetoden the acquisition cost may be taken as 20% of the sale
// proceeds instead of the actual cost.
const SCHABLON_BASIS_FRACTION = 0.2

/**
 * Signed taxable gain on selling proceeds with actual acquisition cost basis,
 * under schablonmetoden (see capitalGainsTax). Losses are kept negative, because
 * realized gains and losses net against each other (kvittning) before the rate
 * applies; only the per-sale schablon floor on the basis is applied here.
 */
export function schablonGain(proceeds: number, basis: number): number {
  return proceeds - Math.max(basis, SCHABLON_BASIS_FRACTION * proceeds)
}

/**
 * Capital gains tax on selling a VP position worth proceeds with actual acquisition
 * cost basis. The taxpayer picks, per sale, whichever of the actual cost and the
 * schablon cost is higher, which caps the taxable gain at 80% of the proceeds.
 * Applying it unconditionally is therefore what a rational investor would do.
 */
export function capitalGainsTax(proceeds: number, basis: number, rate: number): number {
  return Math.max(0, schablonGain(proceeds, basis)) * rate
}

// Skattereduktion for a net loss in inkomstslaget kapital: the full rate on the
// first 100 000 kr, 70% of it above (30%/21% at the statutory rate).
// The threshold is nominal in law and is not inflation-indexed.
const LOSS_CREDIT_THRESHOLD = 100_000
const LOSS_CREDIT_UPPER_QUOTA = 0.7

/**
 * Generate a random number from a normal distribution using Box-Muller transform.
 */
function randomNormal(mean: number, stdDev: number, rng: () => number): number {
  const u1 = rng() || Number.MIN_VALUE
  const u2 = rng()
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z0 * stdDev
}

interface AssetPosition {
  value: number
  costBasis: number
}

/**
 * Piecewise-linear spending multiplier based on age.
 *
 * Derived from Eurostat HBS (Sweden) bucket averages:
 *   30-44 = 0.96, 45-59 = 1.00, 60+ = 0.77 (normalized to peak).
 * Nodes chosen so that the linear interpolation exactly preserves
 * each bucket's average (average of endpoints = bucket mean).
 * Peak at age 50 aligns with BLS Consumer Expenditure Survey (US, 2024)
 * which shows peak spending in the 45-54 bracket.
 *
 * References:
 * - Eurostat HBS_EXP_T135 (Sweden, 1999-2015)
 * - BLS Consumer Expenditure Survey 2024 (FRED series CXUTOTALEXPLB04*)
 * - Blanchett, "Estimating the True Cost of Retirement" (2014)
 */
const SPENDING_CURVE_NODES: [number, number][] = [
  [30, 0.84],
  [45, 1.08],
  [50, 1.08],
  [60, 0.84],
  [80, 0.7],
]

export function spendingMultiplier(age: number, enabled: boolean): number {
  if (!enabled) return 1
  const nodes = SPENDING_CURVE_NODES
  if (age <= nodes[0]![0]) return nodes[0]![1]
  if (age >= nodes[nodes.length - 1]![0]) return nodes[nodes.length - 1]![1]
  for (let j = 1; j < nodes.length; j++) {
    const [x0, y0] = nodes[j - 1]!
    const [x1, y1] = nodes[j]!
    if (age <= x1) {
      const t = (age - x0) / (x1 - x0)
      return y0 + t * (y1 - y0)
    }
  }
  return nodes[nodes.length - 1]![1]
}

/**
 * Run a single simulation for a single scenario (ISK or VP).
 * Returns period-by-period data, cumulative snapshots, and final asset weights.
 */
export interface SingleSimulationOptions {
  /**
   * Stop at the first year the need is not paid in full. The arrays in the
   * result are then short and only `needFunded` means anything; it is for
   * callers that ask a yes/no question of many paths.
   */
  stopAtFailure?: boolean
}

export function runSingleSimulation(
  params: InputParameters,
  options: SingleSimulationOptions = {},
): SingleSimulationResult {
  const years = horizonYears(params)
  const rng = alea(params.seed)
  const isISK = params.iskTaxRate !== undefined

  // Asset returns are real and lognormal; each year they are turned into
  // nominal ones with that year's inflation draw, since the portfolio, the
  // taxes and the cost basis are all nominal.
  const sampleRealReturns = realReturnSampler(params.assets, params.assetCorrelationMatrix)

  // Initialize asset positions
  const assetPositions: AssetPosition[] = params.assets.map((asset) => ({
    value: params.initialCapital * asset.weight,
    costBasis: params.initialCapital * asset.weight,
  }))

  let amount = params.initialCapital
  let cumulativePaidTax = 0
  let accumulatedRealWithdrawal = 0
  let accumulatedNominalWithdrawal = 0
  let currentIskTaxRate = params.iskTaxRate ?? 0
  let peakAmount = params.initialCapital
  let currentDrawdownStart: number | null = null
  let maxDrawdown = 0
  let maxDrawdownPeriod = 0

  let cumulativeInflation = 1
  let needFunded = true

  // Arrays to store period data (per-period values)
  const periodWithdrawals: number[] = []
  const periodWithdrawalsReal: number[] = []
  const periodWithdrawalRates: number[] = []
  const periodTaxes: number[] = []
  const periodTaxationDegrees: number[] = []
  const periodIskTaxRates: number[] = []
  const assetReturnRatesHistory: number[][] = []
  const periodInflationRates: number[] = []

  // Arrays to store snapshots (cumulative data)
  const snapshotCapitals: number[] = []
  const snapshotLiquidValues: number[] = []
  const snapshotTotalValues: number[] = []
  const snapshotMaxDrawdowns: number[] = []
  const snapshotMaxDrawdownPeriods: number[] = []
  const snapshotWithdrawals: number[] = []
  const snapshotWithdrawalsReal: number[] = []
  const snapshotTaxes: number[] = []
  const snapshotTaxationDegrees: number[] = []
  const snapshotIskTaxRates: number[] = []

  // The withdrawal schedule, in real terms: what the household asks for in
  // each year, shaped by the age-dependent spending curve when that is on.
  // The reserve is sized with the schedule's tax drag fixed at today's rate,
  // since the rule must not forecast how the ISK rate wanders.
  const needByYear: number[] = []
  const extraByYear: number[] = []
  for (let i = 0; i < years; i++) {
    const inWithdrawal = i >= params.depositYears
    const multiplier = spendingMultiplier(params.startYear + i, params.ageAdjustedSpending)
    needByYear.push(inWithdrawal ? params.withdrawalNeed * multiplier : 0)
    extraByYear.push(inWithdrawal ? params.withdrawalExtra * multiplier : 0)
  }
  const scheduleDrag = isISK
    ? (params.iskTaxRate ?? 0) * params.capitalGainsTaxRate
    : params.vpWealthTaxRate * params.capitalGainsTaxRate
  const schedule = reserveSchedule(
    needByYear,
    extraByYear,
    params.bequestAmount,
    returnLaw(params.assets, params.assetCorrelationMatrix),
    scheduleDrag,
  )

  for (let i = 0; i < years; i++) {
    // Generate stochastic parameters
    const inflationRate = randomNormal(params.inflationRate, params.inflationStdDev, rng)

    const assetReturns = sampleRealReturns(rng).map((real) => (1 + real) * (1 + inflationRate) - 1)

    cumulativeInflation *= 1 + inflationRate

    // Update ISK tax rate if ISK (random walk)
    if (isISK && params.iskTaxRateStdDev) {
      const taxRateChange = randomNormal(0, params.iskTaxRateStdDev, rng)
      currentIskTaxRate = Math.max(
        ISK_TAX_RATE_MIN,
        Math.min(1.0, currentIskTaxRate + taxRateChange),
      )
    }

    // Step 1: Apply returns to each asset
    for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
      const position = assetPositions[assetIdx]!
      const assetReturn = assetReturns[assetIdx]!
      position.value *= 1 + assetReturn
    }

    amount = assetPositions.reduce((sum, pos) => sum + pos.value, 0)

    // Step 2: Handle deposits or withdrawals
    let withdrawn = 0
    let withdrawalRate = 0
    // Signed realized gain, not tax: losses on one asset must be able to offset
    // gains on another before the rate is applied (Swedish kvittning).
    let withdrawalGain = 0

    if (i < params.depositYears) {
      // Deposit years: add inflation-adjusted deposit to portfolio
      const deposit = params.depositAmount * cumulativeInflation

      // Distribute deposit across assets according to their weights
      for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
        const position = assetPositions[assetIdx]!
        const asset = params.assets[assetIdx]!
        const assetDeposit = deposit * asset.weight
        position.value += assetDeposit
        position.costBasis += assetDeposit
      }

      amount = assetPositions.reduce((sum, pos) => sum + pos.value, 0)
    } else {
      // Withdrawal years: the rule works in real terms, so bring the balance
      // back to today's money and the result forward again.
      const realBalance = amount / cumulativeInflation

      // How much of a krona of balance reaches the household as cash. A VP
      // sale that realises gain fraction g at rate r also pays tax on it.
      let share = 1
      if (!isISK && amount > 0) {
        const netGain = assetPositions.reduce(
          (sum, pos) => sum + schablonGain(pos.value, pos.costBasis),
          0,
        )
        share = 1 - Math.max(0, netGain / amount) * params.capitalGainsTaxRate
      }

      withdrawn =
        arvaWithdrawal(realBalance, needByYear[i]!, extraByYear[i]!, schedule, i, share) *
        cumulativeInflation

      // You cannot withdraw money that is not there. Without this the need
      // keeps being paid out of a depleted portfolio: balances go negative, and when the balance
      // hits exactly zero the withdrawn/amount fraction becomes Infinity and
      // poisons every downstream statistic with NaN.
      withdrawn = Math.max(0, Math.min(withdrawn, amount))

      // Survival is the need paid in full. Ending the plan at zero having paid
      // it is not a failure, which is what the rule aims at in the last year.
      // The tolerance is rounding noise, not slack.
      if (withdrawn < needByYear[i]! * cumulativeInflation * (1 - 1e-9)) needFunded = false

      withdrawalRate = amount > 0 ? withdrawn / amount : 0
    }

    // Step 3: Execute withdrawals (if not in deposit years)
    if (withdrawn > 0 && params.assetRebalanceFrequency === 'annually' && amount > 0) {
      let remainingToWithdraw = withdrawn
      const targetValues = params.assets.map((asset) => amount * asset.weight)

      // First pass: withdraw from overweight assets
      for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
        const position = assetPositions[assetIdx]!
        const targetValue = targetValues[assetIdx]!
        const targetAfterWithdrawal = targetValue * (1 - withdrawn / amount)

        if (position.value > targetAfterWithdrawal && remainingToWithdraw > 0) {
          const excessAmount = Math.min(position.value - targetAfterWithdrawal, remainingToWithdraw)
          const withdrawalFraction = excessAmount / position.value

          if (!isISK) {
            withdrawalGain += schablonGain(excessAmount, position.costBasis * withdrawalFraction)
          }

          position.value -= excessAmount
          position.costBasis *= 1 - withdrawalFraction
          remainingToWithdraw -= excessAmount
        }
      }

      // Second pass: withdraw proportionally if needed
      if (remainingToWithdraw > 0.001) {
        const currentTotal = assetPositions.reduce((sum, pos) => sum + pos.value, 0)

        for (const position of assetPositions) {
          const proportionalWithdrawal = (position.value / currentTotal) * remainingToWithdraw
          const withdrawalFraction = proportionalWithdrawal / position.value

          if (!isISK) {
            withdrawalGain += schablonGain(
              proportionalWithdrawal,
              position.costBasis * withdrawalFraction,
            )
          }

          position.value -= proportionalWithdrawal
          position.costBasis *= 1 - withdrawalFraction
        }
      }
    } else if (withdrawn > 0) {
      // No rebalancing: withdraw proportionally
      for (const position of assetPositions) {
        const withdrawalFraction = withdrawn / amount
        const amountWithdrawn = position.value * withdrawalFraction

        if (!isISK) {
          withdrawalGain += schablonGain(amountWithdrawn, position.costBasis * withdrawalFraction)
        }

        position.value -= amountWithdrawn
        position.costBasis *= 1 - withdrawalFraction
      }
    }

    amount = assetPositions.reduce((sum, pos) => sum + pos.value, 0)

    // Step 4: Rebalance remaining portfolio
    let rebalancingGain = 0
    if (params.assetRebalanceFrequency === 'annually' && i > 0 && amount > 0) {
      const targetValues = params.assets.map((asset) => amount * asset.weight)

      // Sell overweight assets
      for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
        const position = assetPositions[assetIdx]!
        const targetValue = targetValues[assetIdx]!

        if (position.value > targetValue + 0.01) {
          const sellValue = position.value - targetValue
          const sellFraction = sellValue / position.value

          if (!isISK) {
            rebalancingGain += schablonGain(sellValue, position.costBasis * sellFraction)
          }

          position.value = targetValue
          position.costBasis *= 1 - sellFraction
        }
      }

      // Buy underweight assets
      for (let assetIdx = 0; assetIdx < assetPositions.length; assetIdx++) {
        const position = assetPositions[assetIdx]!
        const targetValue = targetValues[assetIdx]!

        if (position.value < targetValue - 0.01) {
          const buyValue = targetValue - position.value
          position.value = targetValue
          position.costBasis += buyValue
        }
      }
    }

    // Step 5: Calculate and pay tax
    let tax: number
    if (isISK) {
      tax = amount * currentIskTaxRate * params.capitalGainsTaxRate
    } else {
      // Schablonintäkt on fund holdings is capital income in the same bucket as
      // realized gains, so gains, losses and the schablon all net against each
      // other before the rate is applied (kvittning within inkomstslaget
      // kapital). The netting is what makes a diverging portfolio taxable on
      // its true result: a rate applied per position would charge the winners
      // at full rate while the losers went unrecognised.
      const schablonIncome = amount * params.vpWealthTaxRate
      const netCapitalIncome = schablonIncome + withdrawalGain + rebalancingGain

      if (netCapitalIncome >= 0) {
        tax = netCapitalIncome * params.capitalGainsTaxRate
      } else {
        // A remaining net loss gives a skattereduktion of 30% on the first
        // 100 000 kr and 21% above — i.e. the full rate on the lower tier and
        // 70% of it above. The threshold is nominal in law and not indexed, so
        // it is applied as written. Crediting it back into the portfolio
        // assumes enough other final tax (pension income) to absorb it.
        const loss = -netCapitalIncome
        const lowerTier = Math.min(loss, LOSS_CREDIT_THRESHOLD)
        const upperTier = loss - lowerTier
        tax = -(
          lowerTier * params.capitalGainsTaxRate +
          upperTier * params.capitalGainsTaxRate * LOSS_CREDIT_UPPER_QUOTA
        )
      }
    }

    // Only the payable side is bounded by the portfolio; a loss credit is an
    // inflow.
    tax = Math.min(tax, Math.max(0, amount))

    // Raising the cash to pay the bill is itself a sale in a VP account, so it
    // realizes gain and triggers further tax. Solve for the gross amount G that
    // nets the tax due: G = tax + G·u·r, hence G = tax / (1 - u·r), where u is
    // the unrealized gain fraction and r the rate. Closed form rather than
    // iterating to a fixed point. Sitting at an unrealized loss does not reduce
    // the cash the bill needs, so u is floored at zero.
    if (!isISK && tax > 0 && amount > 0) {
      // The sale spreads across all holdings, so what it realizes is the
      // netted sum of their gains and losses. The schablon floor on the basis
      // still applies per holding, because it is per sale.
      const unrealizedGain = assetPositions.reduce(
        (sum, pos) => sum + schablonGain(pos.value, pos.costBasis),
        0,
      )
      const unrealizedFraction = Math.max(0, unrealizedGain / amount)
      const denominator = 1 - unrealizedFraction * params.capitalGainsTaxRate
      if (denominator > 0) {
        tax = Math.min(tax / denominator, amount)
      }
    }

    // Pay tax
    if (tax > 0 && amount > 0) {
      const taxFraction = tax / amount
      for (const position of assetPositions) {
        position.value -= position.value * taxFraction
        position.costBasis *= 1 - taxFraction
      }
    } else if (tax < 0 && amount > 0) {
      // The loss credit comes back as new money buying units at the current
      // price, so it adds to value and cost basis alike.
      const credit = -tax
      for (const position of assetPositions) {
        const share = position.value / amount
        position.value += credit * share
        position.costBasis += credit * share
      }
    }

    amount = assetPositions.reduce((sum, pos) => sum + pos.value, 0)

    // Calculate liquidation value
    let liquidValue: number
    if (isISK) {
      liquidValue = amount
    } else {
      // Liquidating realizes everything in one year, so gains and losses net
      // (kvittning) and a net unrealized loss is a deferred tax asset. The
      // schablon floor on the basis applies per holding, since it is per sale.
      const latentTax =
        assetPositions.reduce((sum, pos) => sum + schablonGain(pos.value, pos.costBasis), 0) *
        params.capitalGainsTaxRate
      liquidValue = amount - latentTax
    }

    cumulativePaidTax += tax

    // Cumulative tax counts the capital gains tax still embedded in the
    // portfolio, not just the cash paid so far. A VP account defers that
    // liability rather than escaping it — Swedish heirs take over the
    // acquisition cost, so the tax follows the assets — and liquidValue already
    // subtracts it from the asset side. Counting it here keeps both sides of
    // the ISK/VP comparison on one basis: an account that pays little cash tax
    // while accumulating a large deferred liability is not cheap, it is
    // postponed. Zero for an ISK, which has no CGT. Signed, so an unrealized
    // loss reads as a deferred tax asset, matching liquidValue.
    const deferredTax = amount - liquidValue
    const totalTaxBurden = cumulativePaidTax + deferredTax

    const taxationDegree = liquidValue > 0 ? totalTaxBurden / liquidValue : 0
    const withdrawnReal = withdrawn / cumulativeInflation

    accumulatedRealWithdrawal += withdrawnReal
    accumulatedNominalWithdrawal += withdrawn

    // Store period data (this period's values)
    periodWithdrawals.push(withdrawn)
    periodWithdrawalsReal.push(withdrawnReal)
    periodWithdrawalRates.push(withdrawalRate)
    periodTaxes.push(tax)
    periodTaxationDegrees.push(taxationDegree)
    periodIskTaxRates.push(currentIskTaxRate)
    assetReturnRatesHistory.push([...assetReturns])
    periodInflationRates.push(inflationRate)

    // Track drawdown
    if (amount > peakAmount) {
      peakAmount = amount
      if (currentDrawdownStart !== null) {
        const drawdownPeriod = i - currentDrawdownStart
        maxDrawdownPeriod = Math.max(maxDrawdownPeriod, drawdownPeriod)
        currentDrawdownStart = null
      }
    } else if (amount < peakAmount) {
      const drawdown = (peakAmount - amount) / peakAmount
      maxDrawdown = Math.max(maxDrawdown, drawdown)

      if (currentDrawdownStart === null) {
        currentDrawdownStart = i
      }
    }

    // Store snapshot data (cumulative values as of this period)
    snapshotCapitals.push(amount)
    snapshotLiquidValues.push(liquidValue)
    snapshotTotalValues.push(liquidValue + accumulatedNominalWithdrawal)
    snapshotMaxDrawdowns.push(maxDrawdown)
    snapshotMaxDrawdownPeriods.push(maxDrawdownPeriod)
    snapshotWithdrawals.push(accumulatedNominalWithdrawal)
    snapshotWithdrawalsReal.push(accumulatedRealWithdrawal)
    snapshotTaxes.push(totalTaxBurden)
    snapshotTaxationDegrees.push(taxationDegree)
    snapshotIskTaxRates.push(currentIskTaxRate)

    if (options.stopAtFailure && !needFunded) break
  }

  // Handle final drawdown period if still in drawdown
  if (currentDrawdownStart !== null) {
    const currentDrawdownPeriod = years - 1 - currentDrawdownStart
    maxDrawdownPeriod = Math.max(maxDrawdownPeriod, currentDrawdownPeriod)
  }

  // Calculate final asset weights
  const totalValue = assetPositions.reduce((sum, pos) => sum + pos.value, 0)
  const finalWeights =
    totalValue > 0
      ? assetPositions.map((pos) => pos.value / totalValue)
      : assetPositions.map(() => 1 / assetPositions.length)

  return {
    periodData: {
      withdrawal: periodWithdrawals,
      withdrawalReal: periodWithdrawalsReal,
      withdrawalRate: periodWithdrawalRates,
      tax: periodTaxes,
      taxationDegree: periodTaxationDegrees,
      iskTaxRate: periodIskTaxRates,
      assetReturnRates: assetReturnRatesHistory,
      inflationRate: periodInflationRates,
    },
    snapshots: {
      capital: snapshotCapitals,
      liquidValue: snapshotLiquidValues,
      totalValue: snapshotTotalValues,
      maxDrawdown: snapshotMaxDrawdowns,
      maxDrawdownPeriod: snapshotMaxDrawdownPeriods,
      withdrawal: snapshotWithdrawals,
      withdrawalReal: snapshotWithdrawalsReal,
      withdrawalRate: periodWithdrawalRates, // No cumulative rate, use period values
      tax: snapshotTaxes,
      taxationDegree: snapshotTaxationDegrees,
      iskTaxRate: snapshotIskTaxRates,
      assetReturnRates: assetReturnRatesHistory, // Same as period data
      inflationRate: periodInflationRates, // Same as period data
    },
    finalAssetWeights: finalWeights,
    finalCumulativeInflation: cumulativeInflation,
    needFunded,
  }
}

/**
 * Partition-based selection (Hoare's quickselect) to find the k-th smallest
 * element in O(N) expected time. Mutates arr in-place between lo and hi.
 */
export function quickselect(arr: number[], k: number, lo: number, hi: number): number {
  while (lo < hi) {
    // Median-of-three pivot to avoid worst-case O(N²) on sorted input.
    const mid = (lo + hi) >> 1
    if (arr[mid]! < arr[lo]!) {
      const t = arr[lo]!
      arr[lo] = arr[mid]!
      arr[mid] = t
    }
    if (arr[hi]! < arr[lo]!) {
      const t = arr[lo]!
      arr[lo] = arr[hi]!
      arr[hi] = t
    }
    if (arr[hi]! < arr[mid]!) {
      const t = arr[mid]!
      arr[mid] = arr[hi]!
      arr[hi] = t
    }
    const pivot = arr[mid]!

    let i = lo
    let j = hi
    // Hoare partition: elements ≤ pivot go left, ≥ pivot go right.
    while (i <= j) {
      while (arr[i]! < pivot) i++
      while (arr[j]! > pivot) j--
      if (i <= j) {
        const t = arr[i]!
        arr[i] = arr[j]!
        arr[j] = t
        i++
        j--
      }
    }
    // Recurse into the partition containing k.
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return arr[k]!
}

/**
 * Calculate statistics from an array of values.
 * Uses quickselect for O(N) percentile computation instead of O(N log N) sort.
 */
function calculateStats(values: number[]): {
  mean: number
  stdDev: number
  percentile10: number
  median: number
  percentile90: number
} {
  const n = values.length
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const v = values[i]!
    sum += v
    sumSq += v * v
  }
  const mean = sum / n

  // Quickselect mutates in-place, so work on a copy.
  const work = values.slice()
  const i10 = Math.floor(n * 0.1)
  const i50 = Math.floor(n * 0.5)
  const i90 = Math.floor(n * 0.9)

  // Find percentiles in ascending order of index so each quickselect
  // narrows the working range for the next one.
  const p10 = quickselect(work, i10, 0, n - 1)
  const median = quickselect(work, i50, i10, n - 1)
  const p90 = quickselect(work, i90, i50, n - 1)

  return {
    mean,
    // Var = E[X²] - E[X]² avoids a second pass over the data.
    stdDev: Math.sqrt(sumSq / n - mean * mean),
    percentile10: p10,
    median,
    percentile90: p90,
  }
}

/**
 * Run Monte Carlo simulations for multiple parameter sets.
 * Returns aggregated statistics and median samples.
 */
/** Survival the constant withdrawal has to reach: the 5th percentile path. */
export const BENGEN_SURVIVAL = 0.95
// Paths the search runs on. Each step re-runs all of them, so this sets the
// cost; a thousand put the survival it is judged on within about 0.7 points.
const BENGEN_PATHS = 1000
// Halvings of the search interval: the answer is exact to 1/1024 of the ceiling.
const BENGEN_STEPS = 10
// Highest withdrawal tried, as a share of the starting capital. Past anything a
// plan carries; if even this survives the answer is reported as a lower bound.
const BENGEN_CEILING = 0.1

/**
 * The highest constant real withdrawal that survives at least `target` of the
 * paths, by bisection.
 *
 * Runs on the same seeds as the main run (path i is `seed + i`), so the paths
 * are the ones the rest of the table describes. Survival falls as the amount
 * rises, path by path as well as on average, which is what makes bisection
 * valid. A candidate stops at its first failed year, since all that matters is
 * whether it survives.
 *
 * The extra, the bequest and the age curve are switched off: Bengen's rule is a
 * level amount, and with no extra the bequest has nothing to act on anyway.
 */
export function bengenRate(
  params: InputParameters,
  paths: number = BENGEN_PATHS,
  target: number = BENGEN_SURVIVAL,
): BengenRate {
  // A plan that is only deposits has no starting capital to take a share of.
  const base = Math.max(params.initialCapital, params.depositAmount * params.depositYears)
  const level = {
    ...params,
    withdrawalExtra: 0,
    bequestAmount: 0,
    ageAdjustedSpending: false,
  }
  const survival = (amount: number): number => {
    let survived = 0
    for (let i = 0; i < paths; i++) {
      const path = { ...level, withdrawalNeed: amount, seed: params.seed + i.toString() }
      if (runSingleSimulation(path, { stopAtFailure: true }).needFunded) survived++
    }
    return survived / paths
  }
  const result = (amount: number, atLeast: boolean): BengenRate => ({
    amount,
    rate: base > 0 ? amount / base : 0,
    targetSurvival: target,
    paths,
    atLeast,
  })

  let low = 0
  let high = base * BENGEN_CEILING
  if (survival(high) >= target) return result(high, true)
  for (let step = 0; step < BENGEN_STEPS; step++) {
    const mid = (low + high) / 2
    if (survival(mid) >= target) low = mid
    else high = mid
  }
  return result(low, false)
}

export interface SimulateOptions {
  /** Wall-clock budget in milliseconds; the run stops and says so when it is spent. */
  timeBudgetMs?: number
  /** Clock, injectable so a test can spend the budget without waiting for it. */
  now?: () => number
}

export function simulateAll(
  paramSets: InputParameters[],
  labels: string[],
  onProgress: ((progress: number) => void) | undefined,
  options: SimulateOptions = {},
): SimulationResults {
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  const now = options.now ?? (() => performance.now())
  const startedAt = now()

  // Scenarios are run path by path, in step, because the difference between
  // two scenarios is judged from the per-path pairs: path i meets the same seed
  // in each. There is no limit on paths: precision or the time budget stops it.
  const allResults: SingleSimulationResult[][] = paramSets.map(() => [])
  const tally = new SurvivalTally(paramSets.length)

  let stopReason: StopReason
  for (;;) {
    const batchEnd = tally.paths + BATCH_PATHS
    while (tally.paths < batchEnd) {
      const i = tally.paths
      const funded: boolean[] = []
      for (let setIdx = 0; setIdx < paramSets.length; setIdx++) {
        const params = paramSets[setIdx]!
        const result = runSingleSimulation({ ...params, seed: params.seed + i.toString() })
        allResults[setIdx]!.push(result)
        funded.push(result.needFunded)
      }
      tally.add(funded)
    }

    const elapsed = now() - startedAt
    if (onProgress) {
      onProgress(Math.min(99, (elapsed / timeBudgetMs) * 100))
    }

    if (
      tally.paths >= MIN_PATHS &&
      tally.isPrecise(TARGET_SURVIVAL_HALF_WIDTH, TARGET_DIFFERENCE_HALF_WIDTH)
    ) {
      stopReason = 'precision'
      break
    }
    if (elapsed >= timeBudgetMs) {
      stopReason = 'time'
      break
    }
  }

  const convergence: Convergence = {
    paths: tally.paths,
    elapsedMs: now() - startedAt,
    timeBudgetMs,
    stopReason,
    survivalHalfWidth: tally.survivalHalfWidth(),
    differenceHalfWidth: tally.differenceHalfWidth(),
    targetSurvivalHalfWidth: TARGET_SURVIVAL_HALF_WIDTH,
    targetDifferenceHalfWidth: TARGET_DIFFERENCE_HALF_WIDTH,
    converged: tally.isPrecise(TARGET_SURVIVAL_HALF_WIDTH, TARGET_DIFFERENCE_HALF_WIDTH),
  }

  if (onProgress) {
    onProgress(100)
  }

  // Calculate statistics, median samples, final asset weights, and outcome probabilities for each parameter set
  const statistics: SimulationStatistics<SimulationResult<number>>[] = []
  const medianSamples: SimulationResult<number>[] = []
  const finalAssetWeightsStats: FinalAssetWeights[] = []
  const outcomeProbabilities: { survivalRate: number; breakEvenRate: number }[] = []
  const withdrawalFailureAsZero: SimulationStatistics<number>[] = []

  for (let setIdx = 0; setIdx < allResults.length; setIdx++) {
    const results = allResults[setIdx]!
    const params = paramSets[setIdx]!
    const firstResult = results[0]!
    const numPeriods = firstResult.periodData.withdrawal.length

    // Helper to calculate statistics for a specific field at a specific period
    const calcStatsForField = <T extends 'periodData' | 'snapshots'>(
      dataType: T,
      field: keyof SimulationPeriodData,
      periodIdx: number,
    ): {
      mean: number
      stdDev: number
      p10: number
      median: number
      p90: number
    } => {
      const values = results
        .map((r) => {
          const val = r[dataType][field][periodIdx]
          return Array.isArray(val) ? val[0] : val
        })
        .filter((v): v is number => v !== undefined && isFinite(v))

      if (values.length === 0) {
        return { mean: 0, stdDev: 0, p10: 0, median: 0, p90: 0 }
      }

      const stats = calculateStats(values)
      return {
        mean: stats.mean,
        stdDev: stats.stdDev,
        p10: stats.percentile10,
        median: stats.median,
        p90: stats.percentile90,
      }
    }

    // Calculate statistics for each field and period
    // Type assertion needed: building objects incrementally
    const emptyPeriodData = () =>
      ({}) as SimulationPeriodData<number[]> & { assetReturnRates: number[][] }
    const emptySnapshots = () =>
      ({}) as SimulationPeriodData<number[]> & {
        capital: number[]
        liquidValue: number[]
        totalValue: number[]
        maxDrawdown: number[]
        maxDrawdownPeriod: number[]
        assetReturnRates: number[][]
      }
    const statsResult: SimulationStatistics<SimulationResult<number>> = {
      mean: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
      stdDev: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
      percentile10: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
      median: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
      percentile90: { periodData: emptyPeriodData(), snapshots: emptySnapshots() },
    }

    // Calculate statistics for periodData fields (excluding assetReturnRates which is handled separately)
    type ScalarPeriodField = Exclude<keyof SimulationPeriodData, 'assetReturnRates'>
    const periodDataFields: ScalarPeriodField[] = [
      'withdrawal',
      'withdrawalReal',
      'withdrawalRate',
      'tax',
      'taxationDegree',
      'iskTaxRate',
      'inflationRate',
    ]

    for (const field of periodDataFields) {
      const meanArr: number[] = []
      const stdDevArr: number[] = []
      const p10Arr: number[] = []
      const medianArr: number[] = []
      const p90Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('periodData', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p10Arr.push(stats.p10)
        medianArr.push(stats.median)
        p90Arr.push(stats.p90)
      }

      statsResult.mean.periodData[field] = meanArr
      statsResult.stdDev.periodData[field] = stdDevArr
      statsResult.percentile10.periodData[field] = p10Arr
      statsResult.median.periodData[field] = medianArr
      statsResult.percentile90.periodData[field] = p90Arr
    }

    // Handle assetReturnRates separately (it's an array of arrays)
    // For each period, calculate statistics for each asset
    const numAssets = firstResult.periodData.assetReturnRates[0]?.length ?? 0

    // Initialize assetReturnRates arrays
    statsResult.mean.periodData.assetReturnRates = []
    statsResult.stdDev.periodData.assetReturnRates = []
    statsResult.percentile10.periodData.assetReturnRates = []
    statsResult.median.periodData.assetReturnRates = []
    statsResult.percentile90.periodData.assetReturnRates = []

    for (let period = 0; period < numPeriods; period++) {
      const meanAssetReturns: number[] = []
      const stdDevAssetReturns: number[] = []
      const p10AssetReturns: number[] = []
      const medianAssetReturns: number[] = []
      const p90AssetReturns: number[] = []

      for (let assetIdx = 0; assetIdx < numAssets; assetIdx++) {
        const assetValues = results
          .map((r) => r.periodData.assetReturnRates[period]?.[assetIdx])
          .filter((v): v is number => v !== undefined && isFinite(v))

        if (assetValues.length > 0) {
          const stats = calculateStats(assetValues)
          meanAssetReturns.push(stats.mean)
          stdDevAssetReturns.push(stats.stdDev)
          p10AssetReturns.push(stats.percentile10)
          medianAssetReturns.push(stats.median)
          p90AssetReturns.push(stats.percentile90)
        } else {
          meanAssetReturns.push(0)
          stdDevAssetReturns.push(0)
          p10AssetReturns.push(0)
          medianAssetReturns.push(0)
          p90AssetReturns.push(0)
        }
      }

      statsResult.mean.periodData.assetReturnRates.push(meanAssetReturns)
      statsResult.stdDev.periodData.assetReturnRates.push(stdDevAssetReturns)
      statsResult.percentile10.periodData.assetReturnRates.push(p10AssetReturns)
      statsResult.median.periodData.assetReturnRates.push(medianAssetReturns)
      statsResult.percentile90.periodData.assetReturnRates.push(p90AssetReturns)
    }

    // Calculate statistics for snapshot fields (tax and taxationDegree from SimulationPeriodData)
    type SnapshotScalarField = 'tax' | 'taxationDegree'
    const snapshotFields: SnapshotScalarField[] = ['tax', 'taxationDegree']

    for (const field of snapshotFields) {
      const meanArr: number[] = []
      const stdDevArr: number[] = []
      const p10Arr: number[] = []
      const medianArr: number[] = []
      const p90Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('snapshots', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p10Arr.push(stats.p10)
        medianArr.push(stats.median)
        p90Arr.push(stats.p90)
      }

      statsResult.mean.snapshots[field] = meanArr
      statsResult.stdDev.snapshots[field] = stdDevArr
      statsResult.percentile10.snapshots[field] = p10Arr
      statsResult.median.snapshots[field] = medianArr
      statsResult.percentile90.snapshots[field] = p90Arr
    }

    // Snapshot-only fields (capital, liquidValue, totalValue, maxDrawdown, maxDrawdownPeriod)
    const snapshotOnlyFields = [
      'capital',
      'liquidValue',
      'totalValue',
      'maxDrawdown',
      'maxDrawdownPeriod',
    ] as const

    for (const field of snapshotOnlyFields) {
      statsResult.mean.snapshots[field] = []
      statsResult.stdDev.snapshots[field] = []
      statsResult.percentile10.snapshots[field] = []
      statsResult.median.snapshots[field] = []
      statsResult.percentile90.snapshots[field] = []

      for (let period = 0; period < numPeriods; period++) {
        const values = results
          .map((r) => r.snapshots[field][period])
          .filter((v): v is number => v !== undefined && isFinite(v))

        if (values.length > 0) {
          const stats = calculateStats(values)
          statsResult.mean.snapshots[field].push(stats.mean)
          statsResult.stdDev.snapshots[field].push(stats.stdDev)
          statsResult.percentile10.snapshots[field].push(stats.percentile10)
          statsResult.median.snapshots[field].push(stats.median)
          statsResult.percentile90.snapshots[field].push(stats.percentile90)
        } else {
          statsResult.mean.snapshots[field].push(0)
          statsResult.stdDev.snapshots[field].push(0)
          statsResult.percentile10.snapshots[field].push(0)
          statsResult.median.snapshots[field].push(0)
          statsResult.percentile90.snapshots[field].push(0)
        }
      }
    }

    // Handle remaining snapshot fields that mirror periodData
    type MirroredField =
      | 'withdrawal'
      | 'withdrawalReal'
      | 'withdrawalRate'
      | 'iskTaxRate'
      | 'inflationRate'
    const mirroredFields: MirroredField[] = [
      'withdrawal',
      'withdrawalReal',
      'withdrawalRate',
      'iskTaxRate',
      'inflationRate',
    ]

    for (const field of mirroredFields) {
      const meanArr: number[] = []
      const stdDevArr: number[] = []
      const p10Arr: number[] = []
      const medianArr: number[] = []
      const p90Arr: number[] = []

      for (let period = 0; period < numPeriods; period++) {
        const stats = calcStatsForField('snapshots', field, period)
        meanArr.push(stats.mean)
        stdDevArr.push(stats.stdDev)
        p10Arr.push(stats.p10)
        medianArr.push(stats.median)
        p90Arr.push(stats.p90)
      }

      statsResult.mean.snapshots[field] = meanArr
      statsResult.stdDev.snapshots[field] = stdDevArr
      statsResult.percentile10.snapshots[field] = p10Arr
      statsResult.median.snapshots[field] = medianArr
      statsResult.percentile90.snapshots[field] = p90Arr
    }

    // Handle assetReturnRates for snapshots (same as periodData since they're identical)
    statsResult.mean.snapshots.assetReturnRates = statsResult.mean.periodData.assetReturnRates
    statsResult.stdDev.snapshots.assetReturnRates = statsResult.stdDev.periodData.assetReturnRates
    statsResult.percentile10.snapshots.assetReturnRates =
      statsResult.percentile10.periodData.assetReturnRates
    statsResult.median.snapshots.assetReturnRates = statsResult.median.periodData.assetReturnRates
    statsResult.percentile90.snapshots.assetReturnRates =
      statsResult.percentile90.periodData.assetReturnRates

    statistics.push(statsResult)

    // Find median sample (simulation closest to median across key metrics)
    const medianLiquidValue = calculateStats(
      results.map((r) => r.snapshots.liquidValue[r.snapshots.liquidValue.length - 1]!),
    ).median

    let closestDist = Infinity
    let closestIdx = 0

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const finalLiquidValue =
        result.snapshots.liquidValue[result.snapshots.liquidValue.length - 1]!
      const dist = Math.abs(finalLiquidValue - medianLiquidValue)

      if (dist < closestDist) {
        closestDist = dist
        closestIdx = i
      }
    }

    medianSamples.push(results[closestIdx]!)

    // Calculate final asset weights statistics
    const assetNames = params.assets.map((a) => a.name)
    const weightStats: SimulationStatistics<number>[] = []

    for (let assetIdx = 0; assetIdx < params.assets.length; assetIdx++) {
      const assetWeights = results
        .map((r) => r.finalAssetWeights[assetIdx])
        .filter((v): v is number => v !== undefined && isFinite(v))

      if (assetWeights.length > 0) {
        const stats = calculateStats(assetWeights)
        weightStats.push({
          mean: stats.mean,
          stdDev: stats.stdDev,
          percentile10: stats.percentile10,
          median: stats.median,
          percentile90: stats.percentile90,
        })
      } else {
        weightStats.push({
          mean: 0,
          stdDev: 0,
          percentile10: 0,
          median: 0,
          percentile90: 0,
        })
      }
    }

    finalAssetWeightsStats.push({
      assetNames,
      weights: weightStats,
    })

    // Accumulated real withdrawal, a failed plan counted as zero
    const counted = results.map((r) =>
      r.needFunded ? (r.snapshots.withdrawalReal[r.snapshots.withdrawalReal.length - 1] ?? 0) : 0,
    )
    const countedStats = calculateStats(counted)
    withdrawalFailureAsZero.push({
      mean: countedStats.mean,
      stdDev: countedStats.stdDev,
      percentile10: countedStats.percentile10,
      median: countedStats.median,
      percentile90: countedStats.percentile90,
    })

    // Calculate outcome probabilities
    const initialCapital = params.initialCapital
    let survivalCount = 0
    let breakEvenCount = 0

    for (const result of results) {
      const finalLiquidValue =
        result.snapshots.liquidValue[result.snapshots.liquidValue.length - 1] ?? 0
      const inflationAdjustedCapital = initialCapital * result.finalCumulativeInflation

      if (result.needFunded) {
        survivalCount++
      }

      // Break-even: preserved at least initial capital in real terms
      if (finalLiquidValue >= inflationAdjustedCapital) {
        breakEvenCount++
      }
    }

    outcomeProbabilities.push({
      survivalRate: survivalCount / results.length,
      breakEvenRate: breakEvenCount / results.length,
    })
  }

  return {
    labels,
    statistics,
    medianSamples,
    finalAssetWeights: finalAssetWeightsStats,
    outcomeProbabilities,
    convergence,
    bengen: paramSets.map((p) => bengenRate(p)),
    withdrawalFailureAsZero,
  }
}
