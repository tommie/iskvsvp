import type { SimulationAsset } from './types'

export interface StressPreset {
  id: string
  label: string
  shocks: Record<string, number>
}

interface FundParams {
  alpha: number
  betas: Record<string, number>
}

interface FactorData {
  categories: Record<string, { fund_params: Record<string, FundParams> }>
  factor_covariance: {
    factor_names: string[]
    means: number[]
  }
}

interface FundsDb {
  funds: Array<{ name: string; isin: string; category: string }>
}

let cachedPresets: StressPreset[] | null = null
let cachedFactorData: FactorData | null = null
let cachedFundsDb: FundsDb | null = null

/**
 * Load and cache stress test data (factor-presets.json, fund-factors.json, funds.json).
 */
export async function loadStressData(): Promise<{
  presets: StressPreset[]
  factorData: FactorData
  fundsDb: FundsDb
}> {
  if (cachedPresets && cachedFactorData && cachedFundsDb) {
    return { presets: cachedPresets, factorData: cachedFactorData, fundsDb: cachedFundsDb }
  }

  const [presetsResp, factorsResp, fundsResp] = await Promise.all([
    fetch('/factor-presets.json'),
    fetch('/fund-factors.json'),
    fetch('/funds.json'),
  ])

  const presetsJson = await presetsResp.json()
  const factorsJson = await factorsResp.json()
  const fundsJson = await fundsResp.json()

  cachedPresets = (presetsJson.presets as StressPreset[]).map((p) => ({
    id: p.id,
    label: p.label,
    shocks: p.shocks,
  }))
  cachedFactorData = factorsJson as FactorData
  cachedFundsDb = fundsJson as FundsDb

  return { presets: cachedPresets, factorData: cachedFactorData, fundsDb: cachedFundsDb }
}

/**
 * Return the list of available stress presets for the dropdown.
 */
export function stressPresets(): StressPreset[] {
  return cachedPresets ?? []
}

/**
 * Build a factor-name-to-mean map from the factor data.
 */
function buildMeansMap(factorData: FactorData): Record<string, number> {
  const map: Record<string, number> = {}
  const names = factorData.factor_covariance.factor_names
  const means = factorData.factor_covariance.means
  for (let i = 0; i < names.length; i++) {
    map[names[i]!] = means[i]!
  }
  return map
}

/**
 * Compute stressed annual returns for each portfolio asset under a given preset.
 * Returns empty returns array + warning if any asset is missing from the factor DB.
 */
export function computeStressReturns(
  presetId: string,
  assets: SimulationAsset[],
  fundsDb: FundsDb,
  factorData: FactorData,
): { returns: number[]; warnings: string[] } {
  const preset = (cachedPresets ?? []).find((p) => p.id === presetId)
  if (!preset) {
    return { returns: [], warnings: [`Okänd stresspresets: ${presetId}`] }
  }

  const meansMap = buildMeansMap(factorData)
  const warnings: string[] = []
  const returns: number[] = []

  for (const asset of assets) {
    // Look up ISIN and category from funds DB
    const fund = fundsDb.funds.find((f) => f.name === asset.name)
    if (!fund) {
      warnings.push(`${asset.name}: saknas i fonddatabasen`)
      return { returns: [], warnings }
    }

    // Find fund params in factor data by category and ISIN
    const categoryData = factorData.categories[fund.category]
    if (!categoryData) {
      warnings.push(`${asset.name}: kategori "${fund.category}" saknas i faktormodellen`)
      return { returns: [], warnings }
    }

    const fundParams = categoryData.fund_params[fund.isin]
    if (!fundParams) {
      warnings.push(`${asset.name}: ISIN ${fund.isin} saknas i faktormodellen`)
      return { returns: [], warnings }
    }

    // Compute monthly stressed return: alpha + sum(beta_i * (mean_i + shock_i))
    let monthlyStressed = fundParams.alpha
    for (const [factor, beta] of Object.entries(fundParams.betas)) {
      const mean = meansMap[factor] ?? 0
      const shock = preset.shocks[factor] ?? 0
      monthlyStressed += beta * (mean + shock)
    }

    // Convert monthly % to annual: (1 + monthly/100)^12 - 1
    const annual = Math.pow(1 + monthlyStressed / 100, 12) - 1
    returns.push(annual)
  }

  return { returns, warnings }
}
