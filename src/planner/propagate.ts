import { normalQuadrature, type NormalQuadrature } from './quadrature'
import type {
  PlannerAsset,
  PlannerParameters,
  PlannerResults,
  PortfolioMoments,
  PropagationRun,
  WealthDistribution,
  YearOutcome,
} from './types'

/** Headroom above the drift used to size the top of the wealth grid. */
const GRID_HEADROOM_SIGMAS = 6
/** The bottom of the grid, relative to the plan's monetary scale. */
const GRID_LOW_FRACTION = 1e-6

interface GridSpec {
  grid: Float64Array
  logLow: number
  logStep: number
  n: number
}

interface StepContext {
  spec: GridSpec
  quad: NormalQuadrature
  /** Real gross return at each quadrature node. */
  growth: Float64Array
  /** Effective annual tax rate on the (post-allowance) balance. */
  taxRate: number
}

interface StepResult {
  mass: Float64Array
  /** Mass that failed to fund its floor withdrawal in this step. */
  ruin: number
  /** Mass pinned to the top grid node. */
  clipped: number
}

/** Normalises weights to sum to one, rejecting a degenerate portfolio. */
function normalizedWeights(assets: PlannerAsset[]): number[] {
  const total = assets.reduce((sum, asset) => sum + Math.max(0, asset.weight), 0)
  if (!(total > 0)) {
    throw new Error('planner: portfolio weights must sum to a positive number')
  }
  return assets.map((asset) => Math.max(0, asset.weight) / total)
}

function correlationAt(correlations: number[][], i: number, j: number): number {
  if (i === j) return 1
  // The matrix is stored symmetrically, but accept either triangle so a
  // partially filled matrix still works.
  const value = correlations[i]?.[j] ?? correlations[j]?.[i] ?? 0
  if (!Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

/**
 * Collapses the portfolio to a single lognormal real return.
 *
 * A weighted sum of lognormals is not itself lognormal, so this is a
 * moment match: the portfolio's arithmetic mean and variance are computed
 * exactly from the asset moments and the correlation matrix, then a lognormal
 * is fitted to those two moments. At annual frequency the fit is good, and it
 * is what keeps the state space one-dimensional.
 *
 * This assumes the portfolio is rebalanced to its target weights every year.
 * Letting the weights drift would make the asset split a path-dependent state
 * of its own, which a one-dimensional grid cannot carry.
 */
export function portfolioMoments(
  assets: PlannerAsset[],
  correlations: number[][],
): PortfolioMoments {
  if (assets.length === 0) {
    throw new Error('planner: the portfolio needs at least one asset')
  }
  const weights = normalizedWeights(assets)

  let expectedReturn = 0
  for (let i = 0; i < assets.length; i++) {
    expectedReturn += weights[i]! * assets[i]!.expectedRealReturn
  }

  let variance = 0
  for (let i = 0; i < assets.length; i++) {
    for (let j = 0; j < assets.length; j++) {
      variance +=
        weights[i]! *
        weights[j]! *
        assets[i]!.volatility *
        assets[j]!.volatility *
        correlationAt(correlations, i, j)
    }
  }

  // A hand-entered correlation matrix can fail to be positive semi-definite,
  // which shows up here as a negative variance. That is a real input error and
  // silently clamping it would hide an impossible portfolio, so reject it.
  if (variance < -1e-12) {
    throw new Error(
      'planner: the correlation matrix is not consistent — it implies a negative portfolio variance',
    )
  }
  variance = Math.max(0, variance)

  const gross = 1 + expectedReturn
  if (!(gross > 0)) {
    throw new Error(
      `planner: the portfolio expected return of ${expectedReturn} wipes out the capital every year`,
    )
  }

  const logStdDev = Math.sqrt(Math.log(1 + variance / (gross * gross)))
  const logMean = Math.log(gross) - 0.5 * logStdDev * logStdDev

  return {
    expectedReturn,
    variance,
    volatility: Math.sqrt(variance),
    logMean,
    logStdDev,
  }
}

function buildGrid(low: number, high: number, n: number): GridSpec {
  if (!(low > 0) || !(high > low)) {
    throw new Error(`planner: invalid grid bounds [${low}, ${high}]`)
  }
  const logLow = Math.log(low)
  const logStep = (Math.log(high) - logLow) / (n - 1)
  const grid = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    grid[i] = Math.exp(logLow + i * logStep)
  }
  // The spacing is geometric because the dynamics are multiplicative: constant
  // relative resolution keeps the interpolation error uniform across four
  // orders of magnitude of capital.
  return { grid, logLow, logStep, n }
}

/**
 * Sizes the grid so that essentially no mass escapes either end.
 *
 * The top is the best case that the return law can plausibly reach: pure drift
 * plus `GRID_HEADROOM_SIGMAS` standard deviations of cumulative log return,
 * applied to the capital that could have accumulated with no withdrawals. The
 * bottom is a small fraction of the plan's monetary scale — below that a
 * portfolio cannot fund another year of spending and will be absorbed into
 * ruin on the next step anyway.
 */
function gridBounds(params: PlannerParameters, moments: PortfolioMoments) {
  let deposits = 0
  let scale = Math.max(params.initialCapital, 1)

  for (const year of params.cashflow) {
    // Deposits are largest when the optional top-up is not taken, so the floor
    // alone bounds how much capital can be added.
    if (year.floor < 0) deposits += -year.floor
    scale = Math.max(scale, Math.abs(year.floor) + Math.max(0, year.optional))
  }

  const drift = Math.max(0, moments.logMean) * params.years
  const spread = moments.logStdDev * Math.sqrt(params.years) * GRID_HEADROOM_SIGMAS
  const high = (Math.max(params.initialCapital, 0) + deposits + scale) * Math.exp(drift + spread)
  const low = Math.max(1e-6, scale * GRID_LOW_FRACTION)

  return { low, high }
}

/**
 * Places `mass` at `value` on the grid, splitting it between the two
 * bracketing nodes.
 *
 * The bracketing cell is found in O(1) from the geometric spacing. The split
 * is linear in value rather than in log value: value-space weights conserve
 * total mass and the arithmetic mean exactly, so the reported mean capital
 * does not drift over a long horizon. Returns the mass pinned to the top node.
 */
function scatter(target: Float64Array, spec: GridSpec, value: number, mass: number): number {
  if (mass <= 0) return 0

  if (value <= spec.grid[0]!) {
    target[0]! += mass
    return 0
  }
  if (value >= spec.grid[spec.n - 1]!) {
    target[spec.n - 1]! += mass
    return mass
  }

  const u = (Math.log(value) - spec.logLow) / spec.logStep
  let i = Math.floor(u)
  if (i < 0) i = 0
  if (i > spec.n - 2) i = spec.n - 2

  const g0 = spec.grid[i]!
  const g1 = spec.grid[i + 1]!
  let f = (value - g0) / (g1 - g0)
  if (f < 0) f = 0
  if (f > 1) f = 1

  target[i]! += mass * (1 - f)
  target[i + 1]! += mass * f
  return 0
}

/**
 * Advances one year: apply the real return, take the cash flow, then tax.
 *
 * The ordering mirrors the Monte Carlo simulator (returns, then withdrawal,
 * then the schablon on the resulting balance) so the two engines can be
 * compared directly.
 */
function step(
  ctx: StepContext,
  sourceValues: Float64Array,
  sourceMass: Float64Array,
  flow: number,
  allowanceReal: number,
): StepResult {
  const mass = new Float64Array(ctx.spec.n)
  const { growth, quad, taxRate, spec } = ctx
  const nodes = growth.length

  let ruin = 0
  let clipped = 0

  for (let j = 0; j < sourceValues.length; j++) {
    const sourceProbability = sourceMass[j]!
    if (sourceProbability <= 0) continue
    const wealth = sourceValues[j]!

    for (let k = 0; k < nodes; k++) {
      const probability = quad.weight[k]! * sourceProbability
      const afterFlow = wealth * growth[k]! - flow

      // Ruin is defined as being unable to fund the floor withdrawal in full.
      // Paying part of it and continuing would understate the failure, and a
      // clamped withdrawal is what makes the Monte Carlo simulator's balances
      // bottom out rather than go negative.
      if (afterFlow <= 0) {
        ruin += probability
        continue
      }

      const taxable = allowanceReal > 0 ? Math.max(0, afterFlow - allowanceReal) : afterFlow
      const next = afterFlow - taxable * taxRate
      if (next <= 0) {
        ruin += probability
        continue
      }

      clipped += scatter(mass, spec, next, probability)
    }
  }

  return { mass, ruin, clipped }
}

function quantileOf(grid: Float64Array, mass: Float64Array, ruin: number, p: number): number {
  // Ruined outcomes sit at the bottom of the ordering with a capital of zero,
  // so a plan that fails a third of the time genuinely has a zero 10th
  // percentile. Reporting percentiles conditional on survival would hide that.
  if (p <= ruin) return 0
  let cumulative = ruin
  for (let i = 0; i < grid.length; i++) {
    cumulative += mass[i]!
    if (cumulative >= p) return grid[i]!
  }
  return grid[grid.length - 1]!
}

function summarize(
  year: number,
  startAge: number,
  grid: Float64Array,
  mass: Float64Array,
  ruin: number,
): YearOutcome {
  let mean = 0
  for (let i = 0; i < grid.length; i++) {
    mean += mass[i]! * grid[i]!
  }

  return {
    year,
    age: startAge + year,
    ruinProbability: ruin,
    mean,
    percentile5: quantileOf(grid, mass, ruin, 0.05),
    percentile10: quantileOf(grid, mass, ruin, 0.1),
    percentile25: quantileOf(grid, mass, ruin, 0.25),
    median: quantileOf(grid, mass, ruin, 0.5),
    percentile75: quantileOf(grid, mass, ruin, 0.75),
    percentile90: quantileOf(grid, mass, ruin, 0.9),
    percentile95: quantileOf(grid, mass, ruin, 0.95),
  }
}

function accountTaxRate(params: PlannerParameters): number {
  if (params.accountType === 'VP') {
    // A VP account's tax depends on the cost basis, which is a second,
    // path-dependent state variable. Carrying it needs a two-dimensional grid;
    // until that exists, refuse rather than quietly charge the wrong tax.
    //
    // TODO: support VP. The state becomes (wealth, cost-basis ratio); the ratio
    // is smooth and bounded to [0, 1], so a 200x40 grid over 60 years stays
    // affordable. The tax rules to port from simulation.ts are kvittning
    // between the schablon and realised gains, the loss skattereduktion, the
    // closed-form gross-up for the sale that funds the tax bill, and
    // genomsnittsmetoden on partial disposals.
    throw new Error('planner: VP accounts are not supported yet — cost basis is not tracked')
  }
  // The ISK schablon is levied on the balance, so it is a constant proportional
  // drag. Being proportional, it is the same rate in real terms as in nominal
  // terms: the price level divides out of both the base and the tax.
  return params.iskTaxRate * params.capitalGainsTaxRate
}

function validate(params: PlannerParameters): void {
  if (!Number.isInteger(params.years) || params.years < 1) {
    throw new Error(`planner: years must be a positive integer, got ${params.years}`)
  }
  if (params.cashflow.length !== params.years) {
    throw new Error(
      `planner: cashflow has ${params.cashflow.length} entries but the horizon is ${params.years} years`,
    )
  }
  if (!(params.initialCapital >= 0)) {
    throw new Error(`planner: initialCapital must not be negative, got ${params.initialCapital}`)
  }
  if (!(params.inflationRate > -1)) {
    throw new Error(
      `planner: inflationRate must be greater than -100%, got ${params.inflationRate}`,
    )
  }
  if (params.gridNodes < 50) {
    throw new Error(`planner: gridNodes must be at least 50, got ${params.gridNodes}`)
  }
  for (const year of params.cashflow) {
    if (!Number.isFinite(year.floor) || !Number.isFinite(year.optional)) {
      throw new Error('planner: cashflow entries must be finite numbers')
    }
  }
}

function propagate(
  params: PlannerParameters,
  spec: GridSpec,
  quad: NormalQuadrature,
  moments: PortfolioMoments,
  includeOptional: boolean,
  label: string,
): PropagationRun {
  const growth = new Float64Array(quad.z.length)
  for (let k = 0; k < growth.length; k++) {
    growth[k] = Math.exp(moments.logMean + moments.logStdDev * quad.z[k]!)
  }

  const ctx: StepContext = { spec, quad, growth, taxRate: accountTaxRate(params) }

  // Year 0 is an exact point mass at the starting capital rather than a
  // projection onto the grid. That keeps the first step exact and lets the
  // plan start from zero capital, which no geometric grid can represent.
  let values: Float64Array = Float64Array.of(params.initialCapital)
  let mass: Float64Array = Float64Array.of(1)
  let ruin = 0
  let clipped = 0

  const outcomes: YearOutcome[] = [
    {
      year: 0,
      age: params.startAge,
      ruinProbability: 0,
      mean: params.initialCapital,
      percentile5: params.initialCapital,
      percentile10: params.initialCapital,
      percentile25: params.initialCapital,
      median: params.initialCapital,
      percentile75: params.initialCapital,
      percentile90: params.initialCapital,
      percentile95: params.initialCapital,
    },
  ]

  for (let year = 0; year < params.years; year++) {
    const entry = params.cashflow[year]!
    const flow = entry.floor + (includeOptional ? Math.max(0, entry.optional) : 0)

    // The ISK allowance is written in nominal kronor, so deflate it to today's
    // money. Year `year` ends at price level (1+pi)^(year+1), matching the
    // Monte Carlo simulator, which accrues inflation at the top of each year.
    const allowanceReal =
      params.iskAllowance > 0
        ? params.iskAllowance / Math.pow(1 + params.inflationRate, year + 1)
        : 0

    const stepped = step(ctx, values, mass, flow, allowanceReal)

    // Ruin is absorbing. A deposit scheduled after the plan already failed to
    // pay its floor does not undo that failure, so the ruined mass is never
    // returned to the grid.
    ruin += stepped.ruin
    clipped += stepped.clipped
    values = spec.grid
    mass = stepped.mass

    outcomes.push(summarize(year + 1, params.startAge, spec.grid, mass, ruin))
  }

  const finalDistribution: WealthDistribution = {
    grid: spec.grid,
    mass,
    ruinProbability: ruin,
  }

  return { label, outcomes, finalDistribution, clippedMass: clipped }
}

/**
 * Runs the plan twice to bracket the discretionary spending.
 *
 * The lower run takes only the floor every year, the upper run takes the floor
 * plus the optional top-up. Both share one grid so their distributions are
 * directly comparable node for node. Neither run lets the balance influence
 * what is spent, which is what keeps the model free of a feedback rule that
 * would need to be justified separately.
 */
export function runPlanner(params: PlannerParameters): PlannerResults {
  validate(params)

  const portfolio = portfolioMoments(params.assets, params.correlations)
  const quad = normalQuadrature(params.quadratureNodes)
  const { low, high } = gridBounds(params, portfolio)
  const spec = buildGrid(low, high, params.gridNodes)

  return {
    floorRun: propagate(params, spec, quad, portfolio, false, 'Golv'),
    optionalRun: propagate(params, spec, quad, portfolio, true, 'Golv + tillval'),
    portfolio,
  }
}
