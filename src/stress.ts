import type { SimulationAsset } from './types'

export interface StressPreset {
  id: string
  label: string
  shocks: Record<string, number>
}

export interface FundParams {
  alpha: number
  betas: Record<string, number>
  residual_distribution: {
    type: string
    params: number[]
    std: number
  }
  residual_ar1: {
    ar1_coefficient: number
    ar1_significant: boolean
  }
  vol_betas?: Record<string, number>
  vol_intercept?: number
  vol_log_resid_sq_mean?: number
}

export interface FactorData {
  categories: Record<string, { fund_params: Record<string, FundParams> }>
  factor_covariance: {
    factor_names: string[]
    means: number[]
    covariance_lower: number[]
    factor_ar1?: number[]
  }
  factor_presets: {
    presets: StressPreset[]
  }
}

export interface FundsDb {
  funds: Array<{ name: string; isin: string; category: string }>
}

let cachedPresets: StressPreset[] | null = null
let cachedFactorData: FactorData | null = null
let cachedFundsDb: FundsDb | null = null

/**
 * Load and cache stress test data from /fund-factors.json and /data/index.json.
 */
export async function loadStressData(): Promise<{
  presets: StressPreset[]
  factorData: FactorData
  fundsDb: FundsDb
}> {
  if (cachedPresets && cachedFactorData && cachedFundsDb) {
    return { presets: cachedPresets, factorData: cachedFactorData, fundsDb: cachedFundsDb }
  }

  const [factorsResp, fundsResp] = await Promise.all([
    fetch('/fund-factors.json'),
    fetch('/data/index.json'),
  ])

  const factorsJson = (await factorsResp.json()) as FactorData
  const fundsJson = (await fundsResp.json()) as FundsDb

  cachedPresets = factorsJson.factor_presets.presets.map((p) => ({
    id: p.id,
    label: p.label,
    shocks: p.shocks,
  }))
  cachedFactorData = factorsJson
  cachedFundsDb = fundsJson

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
