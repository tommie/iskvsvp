/**
 * Statistics for deciding when enough simulation paths have been run.
 *
 * What the user acts on is survival, the share of paths in which the need is
 * paid in full every year, and the *difference* in survival between scenarios.
 * Both are about proportions, so the intervals here are for proportions rather
 * than the t-interval of a mean: a t interval on a 0/1 outcome is wrong near 0
 * and 1, which is exactly where a comfortable plan sits.
 *
 * Scenarios share their seeds, so path i meets the same returns in every
 * scenario. The difference is therefore estimated from the per-path pairs, whose
 * variance is far smaller than the sum of the two scenarios' own, and a gap that
 * would need thousands of unpaired paths to resolve needs a few hundred paired.
 */

/** z score for a two-sided 95% interval. */
export const Z95 = 1.959963984540054

/**
 * Half-width of the Wilson score interval for a proportion.
 *
 * Wilson rather than the Wald interval `z·sqrt(p(1-p)/n)`, which collapses to
 * zero at p = 0 or 1 and would declare a plan that has not yet failed once
 * perfectly measured.
 */
export function wilsonHalfWidth(successes: number, n: number, z = Z95): number {
  if (n <= 0) return 1
  const p = successes / n
  const z2 = z * z
  return (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
}

/**
 * Half-width of the interval for the difference of two paired 0/1 outcomes.
 *
 * `discordant` is the number of paths where exactly one of the two survived and
 * `net` is survivors of the first minus survivors of the second, so each path
 * contributes -1, 0 or +1. The variance of that contribution is
 * `P(discordant) - mean²`.
 *
 * One discordant path is added to the count before the variance is formed. With
 * none seen yet the sample variance is exactly zero, which would call a
 * difference perfectly measured after the first few hundred paths when all that
 * has been learnt is that it is small.
 */
export function pairedHalfWidth(discordant: number, net: number, n: number, z = Z95): number {
  if (n <= 0) return 1
  const meanDiff = net / n
  const variance = (discordant + 1) / (n + 2) - meanDiff * meanDiff
  return z * Math.sqrt(Math.max(variance, 0) / n)
}

/** Why a run stopped. */
export type StopReason = 'precision' | 'time'

export interface Convergence {
  /** Paths actually run, in each scenario. */
  paths: number
  elapsedMs: number
  timeBudgetMs: number
  stopReason: StopReason
  /** 95% half-width of each scenario's survival, as a probability. */
  survivalHalfWidth: number[]
  /** 95% half-width of each scenario's survival minus the first scenario's. Zero for the first. */
  differenceHalfWidth: number[]
  /** The half-widths asked for. */
  targetSurvivalHalfWidth: number
  targetDifferenceHalfWidth: number
  /** Whether every half-width is within its target, however the run stopped. */
  converged: boolean
}

/** Survival to within one percentage point. */
export const TARGET_SURVIVAL_HALF_WIDTH = 0.01
/**
 * Scenario differences to within one point too. The aim is a reliable sign and
 * size for the gap, not its third digit: asking for half a point took more than
 * 20 000 paths on a 3-point ISK/VP gap, for no change in what anyone would do.
 */
export const TARGET_DIFFERENCE_HALF_WIDTH = 0.01
/** The most wall-clock time a run may take before it stops and says so. */
export const DEFAULT_TIME_BUDGET_MS = 5000
/** Never judge precision on fewer paths than this; the interval rules assume a sample. */
export const MIN_PATHS = 500
/** Paths between checks. Large enough that checking costs nothing. */
export const BATCH_PATHS = 250

/**
 * Running tallies of survival across scenarios, and the intervals they imply.
 */
export class SurvivalTally {
  paths = 0
  private readonly survivors: number[]
  private readonly discordant: number[]
  private readonly net: number[]

  constructor(scenarios: number) {
    this.survivors = new Array<number>(scenarios).fill(0)
    this.discordant = new Array<number>(scenarios).fill(0)
    this.net = new Array<number>(scenarios).fill(0)
  }

  /** Records one path: whether the need was funded throughout in each scenario. */
  add(funded: readonly boolean[]): void {
    this.paths++
    const first = funded[0]!
    for (let s = 0; s < funded.length; s++) {
      if (funded[s]) this.survivors[s]!++
      if (s > 0 && funded[s] !== first) this.discordant[s]!++
      if (s > 0) this.net[s]! += (first ? 1 : 0) - (funded[s] ? 1 : 0)
    }
  }

  survivalHalfWidth(): number[] {
    return this.survivors.map((k) => wilsonHalfWidth(k, this.paths))
  }

  differenceHalfWidth(): number[] {
    return this.survivors.map((_, s) =>
      s === 0 ? 0 : pairedHalfWidth(this.discordant[s]!, this.net[s]!, this.paths),
    )
  }

  /** Whether every interval is within its target. */
  isPrecise(targetSurvival: number, targetDifference: number): boolean {
    return (
      this.survivalHalfWidth().every((h) => h <= targetSurvival) &&
      this.differenceHalfWidth().every((h) => h <= targetDifference)
    )
  }
}
