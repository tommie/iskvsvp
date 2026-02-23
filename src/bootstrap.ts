import { alea } from 'seedrandom'

/**
 * Block bootstrap simulation module.
 *
 * Replaces Gaussian return generation with historical block bootstrap,
 * preserving autocorrelation, fat tails, and cross-asset correlation.
 * A bootstrap sampling profile over the time axis lets users weight certain historical periods.
 */

export const BLOCK_MONTHS = 14

export interface BootstrapComponent {
  weight: number
  centerMonth: string // "YYYY-MM", e.g. "2008-07"
  stdMonths: number // standard deviation in months, e.g. 6
}

export interface BootstrapProfile {
  id: string
  label: string
  components: BootstrapComponent[]
  allowPartial?: boolean // If true, skip date range filtering (out-of-range components handled by retry)
}

export interface BootstrapPayload {
  returnMatrix: number[][] // [monthIdx][assetIdx]
  nMonths: number
  profileComponents: BootstrapComponent[]
  assetOrder: string[] // ISINs in column order
  startDate: string // "YYYY-MM" of first month in common range
  portfolioGeometricMean: number // Portfolio-level geometric mean annual return
  portfolioVariance: number // Variance of portfolio annual returns (for CER adjustment)
}

interface FundIndexEntry {
  isin: string
  name: string
  category: string
  monthly_file: string
  start_month: string // "YYYY-MM"
}

interface FundMonthlyData {
  isin: string
  name: string
  dates: string[] // "YYYY-MM" format, only months with data
  returns: number[]
}

interface FundsDb {
  funds: FundIndexEntry[]
}

let cachedBootstrapProfiles: BootstrapProfile[] | null = null
let cachedFundsDb: FundsDb | null = null
const cachedMonthlyData = new Map<string, FundMonthlyData>()

/**
 * Fetch and cache bootstrap profiles and fund index.
 */
export async function loadBootstrapData(): Promise<{
  fundsDb: FundsDb
  profiles: BootstrapProfile[]
}> {
  if (cachedFundsDb && cachedBootstrapProfiles) {
    return { fundsDb: cachedFundsDb, profiles: cachedBootstrapProfiles }
  }

  const [fundsResp, presetsResp] = await Promise.all([
    fetch('/data/index.json'),
    fetch('/bootstrap-profiles.json'),
  ])

  if (!fundsResp.ok) {
    throw new Error(`Failed to load data/index.json: ${fundsResp.status}`)
  }
  if (!presetsResp.ok) {
    throw new Error(`Failed to load bootstrap-profiles.json: ${presetsResp.status}`)
  }

  cachedFundsDb = (await fundsResp.json()) as FundsDb
  const presetsJson = (await presetsResp.json()) as { presets: BootstrapProfile[] }
  cachedBootstrapProfiles = presetsJson.presets

  return { fundsDb: cachedFundsDb, profiles: cachedBootstrapProfiles }
}

/**
 * Fetch a fund's monthly return data, with caching.
 */
async function fetchMonthlyData(monthlyFile: string): Promise<FundMonthlyData> {
  const cached = cachedMonthlyData.get(monthlyFile)
  if (cached) return cached

  const resp = await fetch(`/data/${monthlyFile}`)
  if (!resp.ok) {
    throw new Error(`Failed to load ${monthlyFile}: ${resp.status}`)
  }
  const data = (await resp.json()) as FundMonthlyData
  cachedMonthlyData.set(monthlyFile, data)
  return data
}

/**
 * Filter profiles to only those whose center month falls within the data range.
 * Profiles with no components (e.g. Uniform) are always included.
 */
export function filterProfilesByDateRange(
  profiles: BootstrapProfile[],
  startDate: string,
  nMonths: number,
): BootstrapProfile[] {
  const startIdx = parseYearMonth(startDate)
  const maxStart = nMonths - BLOCK_MONTHS
  return profiles.filter((p) => {
    if (p.components.length === 0 || p.allowPartial) return true
    return p.components.every((c) => {
      const centerIdx = parseYearMonth(c.centerMonth) - startIdx - Math.floor(BLOCK_MONTHS / 2)
      return centerIdx >= 0 && centerIdx <= maxStart
    })
  })
}

/**
 * Estimate the common date range for a set of assets using start_month from the fund index.
 * Returns null if any asset is missing from the database.
 */
export function getCommonDateRange(
  assetNames: string[],
  fundsDb: FundsDb,
): { startDate: string; nMonths: number } | null {
  let latestStart = 0
  for (const name of assetNames) {
    const entry = fundsDb.funds.find((f) => f.name === name)
    if (!entry?.start_month) return null
    const idx = parseYearMonth(entry.start_month)
    if (idx > latestStart) latestStart = idx
  }

  const now = new Date()
  const nowIdx = now.getFullYear() * 12 + now.getMonth()
  const nMonths = nowIdx - latestStart

  if (nMonths < BLOCK_MONTHS) return null

  const startYear = Math.floor(latestStart / 12)
  const startMonth = (latestStart % 12) + 1
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}`

  return { startDate, nMonths }
}

/**
 * Estimate the portfolio-level geometric mean annual return by Monte Carlo
 * sampling of the bootstrap process itself. Compounds the weighted portfolio
 * return each sample year, matching the actual simulation return distribution.
 *
 * Using the portfolio geometric mean (rather than a weighted average of
 * per-asset geometric means) correctly accounts for Jensen's inequality:
 * E[log(Σ w_i r_i)] ≠ Σ w_i E[log(r_i)].
 */
function estimatePortfolioReturnStats(
  returnMatrix: number[][],
  nMonths: number,
  components: BootstrapComponent[],
  startDate: string,
  assetWeights: number[],
): { geometricMean: number; variance: number } {
  const rng = alea('return-estimate')
  const nSampleYears = 10000
  const samples = sampleAnnualReturns(returnMatrix, nMonths, components, rng, nSampleYears, startDate)

  let logSum = 0
  let sum = 0
  let sumSq = 0
  for (let y = 0; y < nSampleYears; y++) {
    const row = samples[y]!
    let portfolioReturn = 0
    for (let a = 0; a < assetWeights.length; a++) {
      portfolioReturn += assetWeights[a]! * row[a]!
    }
    logSum += Math.log(1 + portfolioReturn)
    sum += portfolioReturn
    sumSq += portfolioReturn * portfolioReturn
  }

  const geometricMean = Math.exp(logSum / nSampleYears) - 1
  const mean = sum / nSampleYears
  const variance = sumSq / nSampleYears - mean * mean

  return { geometricMean, variance }
}

/**
 * Prepare a bootstrap payload for the simulation worker.
 *
 * Looks up each asset in the fund index, fetches per-fund monthly files,
 * finds the common date range, and builds a dense return matrix.
 */
export async function prepareBootstrapPayload(
  assetNames: string[],
  fundsDb: FundsDb,
  profileComponents: BootstrapComponent[],
  assetWeights: number[],
): Promise<BootstrapPayload | { warnings: string[] }> {
  const warnings: string[] = []
  const fundEntries: FundIndexEntry[] = []

  // Map asset names → fund index entries
  for (const name of assetNames) {
    const entry = fundsDb.funds.find((f) => f.name === name)
    if (!entry) {
      warnings.push(`${name}: saknas i fonddatabasen`)
      return { warnings }
    }
    if (!entry.monthly_file) {
      warnings.push(`${name}: saknar historisk prisdata`)
      return { warnings }
    }
    fundEntries.push(entry)
  }

  // Fetch all per-fund monthly files in parallel
  let monthlyDataArr: FundMonthlyData[]
  try {
    monthlyDataArr = await Promise.all(fundEntries.map((e) => fetchMonthlyData(e.monthly_file)))
  } catch (e) {
    warnings.push(`Kunde inte ladda historisk data: ${e instanceof Error ? e.message : String(e)}`)
    return { warnings }
  }

  // Build date→index maps for each fund
  const dateMaps = monthlyDataArr.map((md) => {
    const map = new Map<string, number>()
    md.dates.forEach((d, i) => map.set(d, i))
    return map
  })

  // Collect all unique dates across all funds, sorted
  const allDates = new Set<string>()
  for (const md of monthlyDataArr) {
    for (const d of md.dates) {
      allDates.add(d)
    }
  }
  const sortedDates = [...allDates].sort()

  // Find dates where all funds have data
  const commonDates = sortedDates.filter((date) => dateMaps.every((m) => m.has(date)))

  if (commonDates.length < BLOCK_MONTHS) {
    warnings.push(
      `Otillräcklig gemensam historik (${commonDates.length} månader, behöver ${BLOCK_MONTHS})`,
    )
    return { warnings }
  }

  // Build dense return matrix for common dates
  const returnMatrix: number[][] = []
  for (const date of commonDates) {
    const row: number[] = []
    for (let a = 0; a < monthlyDataArr.length; a++) {
      const idx = dateMaps[a]!.get(date)!
      row.push(monthlyDataArr[a]!.returns[idx]!)
    }
    returnMatrix.push(row)
  }

  // Estimate the portfolio-level geometric mean and variance by Monte Carlo
  // sampling from the exact same bootstrap process the simulation uses.
  // Uses portfolio weights to correctly account for Jensen's inequality.
  const { geometricMean, variance } = estimatePortfolioReturnStats(
    returnMatrix,
    commonDates.length,
    profileComponents,
    commonDates[0]!,
    assetWeights,
  )

  return {
    returnMatrix,
    nMonths: commonDates.length,
    profileComponents,
    assetOrder: fundEntries.map((e) => e.isin),
    startDate: commonDates[0]!,
    portfolioGeometricMean: geometricMean,
    portfolioVariance: variance,
  }
}

/**
 * Sample annual returns using block bootstrap with profile-weighted period sampling.
 *
 * For each year, samples a block start from the bootstrap profile distribution
 * and compounds 12 consecutive months of historical returns. The block length
 * (BLOCK_MONTHS = 14) is intentionally non-aligned with calendar quarters to
 * avoid aliasing with fund rebalances and quarterly reports.
 */
export function sampleAnnualReturns(
  returnMatrix: number[][], // [monthIdx][assetIdx]
  nMonths: number,
  profileComponents: BootstrapComponent[],
  rng: () => number,
  yearsNeeded: number,
  startDate: string,
): number[][] {
  const nAssets = returnMatrix[0]!.length
  const maxStart = nMonths - BLOCK_MONTHS
  const result: number[][] = []

  for (let y = 0; y < yearsNeeded; y++) {
    const blockStart = sampleBlockStart(profileComponents, maxStart, rng, startDate)

    const yearReturns: number[] = new Array(nAssets).fill(1)
    for (let m = 0; m < 12; m++) {
      const row = returnMatrix[blockStart + m]!
      for (let a = 0; a < nAssets; a++) {
        yearReturns[a]! *= 1 + row[a]!
      }
    }
    result.push(yearReturns.map((v) => v - 1))
  }

  return result
}

/**
 * Parse a "YYYY-MM" string into an absolute month index (year * 12 + (month - 1)).
 */
export function parseYearMonth(s: string): number {
  const [y, m] = s.split('-').map(Number)
  return y! * 12 + (m! - 1)
}

/**
 * Sample a block start index from the bootstrap profile distribution.
 * Component weights don't need to sum to 1; the remainder is implicit uniform.
 */
function sampleBlockStart(
  components: BootstrapComponent[],
  maxStart: number,
  rng: () => number,
  startDate: string,
): number {
  const startIdx = parseYearMonth(startDate)

  for (let attempt = 0; attempt < 100; attempt++) {
    const u = rng()
    let cumWeight = 0
    let monthIdx: number | null = null

    for (const comp of components) {
      cumWeight += comp.weight
      if (u < cumWeight) {
        // Draw from this component's Gaussian in absolute month space.
        // Offset by half the block length so the block midpoint aligns with centerMonth.
        const centerIdx = parseYearMonth(comp.centerMonth) - startIdx - Math.floor(BLOCK_MONTHS / 2)
        monthIdx = Math.round(randomNormalBM(centerIdx, comp.stdMonths, rng))
        break
      }
    }

    // Implicit uniform for remainder weight
    if (monthIdx === null) {
      monthIdx = Math.floor(rng() * (maxStart + 1))
    }

    if (monthIdx >= 0 && monthIdx <= maxStart) {
      return monthIdx
    }
  }

  // Fallback after 100 failed attempts: uniform
  return Math.floor(rng() * (maxStart + 1))
}

/**
 * Box-Muller normal random variate.
 */
function randomNormalBM(mean: number, std: number, rng: () => number): number {
  const u1 = rng() || Number.MIN_VALUE
  const u2 = rng()
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z * std
}
