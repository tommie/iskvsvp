/**
 * Block bootstrap simulation module.
 *
 * Replaces Gaussian return generation with historical block bootstrap,
 * preserving autocorrelation, fat tails, and cross-asset correlation.
 * A bootstrap sampling profile over the time axis lets users weight certain historical periods.
 */

export const BLOCK_MONTHS = 24

export interface BootstrapComponent {
  weight: number
  centerMonth: string // "YYYY-MM", e.g. "2008-07"
  stdMonths: number // standard deviation in months, e.g. 6
}

export interface BootstrapProfile {
  id: string
  label: string
  components: BootstrapComponent[]
}

export interface BootstrapPayload {
  returnMatrix: number[][] // [monthIdx][assetIdx]
  nMonths: number
  profileComponents: BootstrapComponent[]
  assetOrder: string[] // ISINs in column order
  startDate: string // "YYYY-MM" of first month in common range
}

interface FundIndexEntry {
  isin: string
  name: string
  category: string
  monthly_file: string
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
 * Prepare a bootstrap payload for the simulation worker.
 *
 * Looks up each asset in the fund index, fetches per-fund monthly files,
 * finds the common date range, and builds a dense return matrix.
 */
export async function prepareBootstrapPayload(
  assetNames: string[],
  fundsDb: FundsDb,
  profileComponents: BootstrapComponent[],
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

  // Find contiguous range where all funds have data
  let firstCommon = -1
  let lastCommon = -1

  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i]!
    const allHaveData = dateMaps.every((m) => m.has(date))
    if (allHaveData) {
      if (firstCommon === -1) firstCommon = i
      lastCommon = i
    }
  }

  const commonMonths = firstCommon === -1 ? 0 : lastCommon - firstCommon + 1
  if (commonMonths < BLOCK_MONTHS) {
    warnings.push(
      `Otillräcklig gemensam historik (${commonMonths} månader, behöver ${BLOCK_MONTHS})`,
    )
    return { warnings }
  }

  // Build dense return matrix for common period
  const returnMatrix: number[][] = []
  for (let i = firstCommon; i <= lastCommon; i++) {
    const date = sortedDates[i]!
    const row: number[] = []
    for (let a = 0; a < monthlyDataArr.length; a++) {
      const idx = dateMaps[a]!.get(date)!
      row.push(monthlyDataArr[a]!.returns[idx]!)
    }
    returnMatrix.push(row)
  }

  return {
    returnMatrix,
    nMonths: commonMonths,
    profileComponents,
    assetOrder: fundEntries.map((e) => e.isin),
    startDate: sortedDates[firstCommon]!,
  }
}

/**
 * Sample annual returns using block bootstrap with profile-weighted period sampling.
 *
 * For each 2-year chunk, samples a block start from the bootstrap profile distribution
 * and extracts BLOCK_MONTHS consecutive months of historical returns,
 * then compounds them into annual returns.
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

  // Process in 2-year chunks
  let yearsRemaining = yearsNeeded
  while (yearsRemaining > 0) {
    const blockStart = sampleBlockStart(profileComponents, maxStart, rng, startDate)

    // Extract block of BLOCK_MONTHS consecutive months
    const monthsToUse = yearsRemaining >= 2 ? BLOCK_MONTHS : 12

    // Compound months 0–11 → year 1
    const year1Returns: number[] = new Array(nAssets).fill(1)
    for (let m = 0; m < 12; m++) {
      const row = returnMatrix[blockStart + m]!
      for (let a = 0; a < nAssets; a++) {
        year1Returns[a]! *= 1 + row[a]!
      }
    }
    result.push(year1Returns.map((v) => v - 1))
    yearsRemaining--

    // Compound months 12–23 → year 2 (if needed)
    if (yearsRemaining > 0 && monthsToUse === BLOCK_MONTHS) {
      const year2Returns: number[] = new Array(nAssets).fill(1)
      for (let m = 12; m < BLOCK_MONTHS; m++) {
        const row = returnMatrix[blockStart + m]!
        for (let a = 0; a < nAssets; a++) {
          year2Returns[a]! *= 1 + row[a]!
        }
      }
      result.push(year2Returns.map((v) => v - 1))
      yearsRemaining--
    }
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
  const u = rng()
  let cumWeight = 0
  for (const comp of components) {
    cumWeight += comp.weight
    if (u < cumWeight) {
      // Draw from this component's Gaussian in absolute month space
      const startIdx = parseYearMonth(startDate)
      const centerIdx = parseYearMonth(comp.centerMonth) - startIdx
      for (let attempt = 0; attempt < 100; attempt++) {
        const monthIdx = Math.round(randomNormalBM(centerIdx, comp.stdMonths, rng))
        if (monthIdx >= 0 && monthIdx <= maxStart) {
          return monthIdx
        }
      }
      // Fallback: clamp center to valid range
      return Math.max(0, Math.min(maxStart, Math.round(centerIdx)))
    }
  }

  // Implicit uniform for remainder weight
  return Math.floor(rng() * (maxStart + 1))
}

/**
 * Box-Muller normal random variate.
 */
function randomNormalBM(mean: number, std: number, rng: () => number): number {
  const u1 = rng()
  const u2 = rng()
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z * std
}
