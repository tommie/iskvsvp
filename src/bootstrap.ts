/**
 * Block bootstrap simulation module.
 *
 * Replaces Gaussian return generation with historical block bootstrap,
 * preserving autocorrelation, fat tails, and cross-asset correlation.
 * A GMM over the time axis lets users weight certain historical periods.
 */

export const BLOCK_MONTHS = 24

export interface GmmComponent {
  weight: number
  mean: number // Normalized time [0, 1]
  std: number
}

export interface GmmPreset {
  id: string
  label: string
  components: GmmComponent[]
}

export interface BootstrapData {
  dates: string[]
  funds: Record<string, { name: string; returns: (number | null)[] }>
}

export interface BootstrapPayload {
  returnMatrix: number[][] // [monthIdx][assetIdx]
  nMonths: number
  gmmComponents: GmmComponent[]
  assetOrder: string[] // ISINs in column order
}

interface FundsDb {
  funds: Array<{ name: string; isin: string; category: string }>
}

let cachedBootstrapData: BootstrapData | null = null
let cachedGmmPresets: GmmPreset[] | null = null

/**
 * Fetch and cache fund-returns.json and gmm-presets.json.
 */
export async function loadBootstrapData(): Promise<{
  bootstrapData: BootstrapData
  gmmPresets: GmmPreset[]
}> {
  if (cachedBootstrapData && cachedGmmPresets) {
    return { bootstrapData: cachedBootstrapData, gmmPresets: cachedGmmPresets }
  }

  const [returnsResp, presetsResp] = await Promise.all([
    fetch('/fund-returns.json'),
    fetch('/gmm-presets.json'),
  ])

  if (!returnsResp.ok) {
    throw new Error(`Failed to load fund-returns.json: ${returnsResp.status}`)
  }
  if (!presetsResp.ok) {
    throw new Error(`Failed to load gmm-presets.json: ${presetsResp.status}`)
  }

  cachedBootstrapData = (await returnsResp.json()) as BootstrapData
  const presetsJson = (await presetsResp.json()) as { presets: GmmPreset[] }
  cachedGmmPresets = presetsJson.presets

  return { bootstrapData: cachedBootstrapData, gmmPresets: cachedGmmPresets }
}

/**
 * Prepare a bootstrap payload for the simulation worker.
 *
 * Maps asset names to ISINs via funds.json, finds the common date range
 * where all assets have return data, and builds a dense return matrix.
 */
export function prepareBootstrapPayload(
  assetNames: string[],
  fundsDb: FundsDb,
  bootstrapData: BootstrapData,
  gmmComponents: GmmComponent[],
): BootstrapPayload | { warnings: string[] } {
  const warnings: string[] = []
  const isins: string[] = []

  // Map asset names → ISINs
  for (const name of assetNames) {
    const fund = fundsDb.funds.find((f) => f.name === name)
    if (!fund) {
      warnings.push(`${name}: saknas i fonddatabasen`)
      return { warnings }
    }
    if (!bootstrapData.funds[fund.isin]) {
      warnings.push(`${name}: saknar historisk prisdata`)
      return { warnings }
    }
    isins.push(fund.isin)
  }

  // Find common date range where all assets have non-null returns
  const nDates = bootstrapData.dates.length
  const returnArrays = isins.map((isin) => bootstrapData.funds[isin]!.returns)

  // Find first and last month where ALL assets have data
  let firstCommon = -1
  let lastCommon = -1

  for (let i = 0; i < nDates; i++) {
    const allHaveData = returnArrays.every((r) => r[i] != null)
    if (allHaveData) {
      if (firstCommon === -1) firstCommon = i
      lastCommon = i
    }
  }

  if (firstCommon === -1 || lastCommon - firstCommon + 1 < BLOCK_MONTHS) {
    warnings.push(
      `Otillräcklig gemensam historik (${lastCommon - firstCommon + 1} månader, behöver ${BLOCK_MONTHS})`,
    )
    return { warnings }
  }

  // Build dense return matrix for common period
  const nMonths = lastCommon - firstCommon + 1
  const returnMatrix: number[][] = []

  for (let i = firstCommon; i <= lastCommon; i++) {
    const row: number[] = []
    for (const returns of returnArrays) {
      row.push(returns[i] as number)
    }
    returnMatrix.push(row)
  }

  return {
    returnMatrix,
    nMonths,
    gmmComponents,
    assetOrder: isins,
  }
}

/**
 * Sample annual returns using block bootstrap with GMM weighting.
 *
 * For each 2-year chunk, samples a block start from the GMM distribution
 * and extracts BLOCK_MONTHS consecutive months of historical returns,
 * then compounds them into annual returns.
 */
export function sampleAnnualReturns(
  returnMatrix: number[][], // [monthIdx][assetIdx]
  nMonths: number,
  gmmComponents: GmmComponent[],
  rng: () => number,
  yearsNeeded: number,
): number[][] {
  const nAssets = returnMatrix[0]!.length
  const maxStart = nMonths - BLOCK_MONTHS
  const result: number[][] = []

  // Process in 2-year chunks
  let yearsRemaining = yearsNeeded
  while (yearsRemaining > 0) {
    // Sample block start from GMM
    const blockStart = sampleBlockStart(gmmComponents, maxStart, rng)

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
 * Sample a block start index from the GMM distribution.
 * Components define P(block_start) in normalized time [0, 1].
 */
function sampleBlockStart(components: GmmComponent[], maxStart: number, rng: () => number): number {
  // Select component by weight
  const u = rng()
  let cumWeight = 0
  let selectedComponent = components[0]!
  for (const comp of components) {
    cumWeight += comp.weight
    if (u < cumWeight) {
      selectedComponent = comp
      break
    }
  }

  // Draw from selected Gaussian, retry if out of bounds
  for (let attempt = 0; attempt < 100; attempt++) {
    const t = randomNormalBM(selectedComponent.mean, selectedComponent.std, rng)
    const monthIdx = Math.round(t * maxStart)
    if (monthIdx >= 0 && monthIdx <= maxStart) {
      return monthIdx
    }
  }

  // Fallback: uniform sample
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
