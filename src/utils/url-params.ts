import type { InputParameters } from '../types'
import type { LocationQuery } from 'vue-router'

/**
 * Encode parameters to URL query string
 */
export function encodeParamsToUrl(params: InputParameters): Record<string, string> {
  const query: Record<string, string> = {}

  // Map each parameter to its short name
  query.ic = params.initialCapital.toString()
  query.sy = params.startYear.toString()
  query.yl = params.yearsLater.toString()
  query.d = params.development.toString()
  query.ds = params.developmentStdDev.toString()
  query.ir = params.inflationRate.toString()
  query.is = params.inflationStdDev.toString()
  query.sc = params.simulationCount.toString()

  // Get from first scenario (shared across ISK and VP)
  const firstScenario = params.scenarios[0]
  if (firstScenario) {
    query.bwr = firstScenario.balanceWithdrawalRate.toString()
    query.pwr = firstScenario.profitWithdrawalRate.toString()
    query.ply = firstScenario.profitLookbackYears.toString()
    query.cgt = firstScenario.capitalGainsTax.toString()
  }

  // Get ISK-specific params
  const iskScenario = params.scenarios.find((s) => s.isISK)
  if (iskScenario?.iskTaxRate !== undefined) {
    query.itr = iskScenario.iskTaxRate.toString()
  }
  if (iskScenario?.iskTaxRateStdDev !== undefined) {
    query.its = iskScenario.iskTaxRateStdDev.toString()
  }

  return query
}

/**
 * Decode parameters from URL query string
 */
export function decodeParamsFromUrl(query: LocationQuery): Partial<InputParameters> | null {
  const params: Partial<InputParameters> = {}

  // Helper to get single string value from query param
  const getString = (key: string): string | undefined => {
    const value = query[key]
    if (!value) return undefined
    if (Array.isArray(value)) {
      const first = value[0]
      return first ?? undefined
    }
    return value
  }

  // Helper to parse number with validation
  const parseNum = (key: string): number | undefined => {
    const str = getString(key)
    if (!str) return undefined
    const num = parseFloat(str)
    return isFinite(num) ? num : undefined
  }

  // Check if we have at least some parameters
  const hasParams = Object.keys(query).length > 0

  if (!hasParams) return null

  // Parse basic parameters
  const ic = parseNum('ic')
  const sy = parseNum('sy')
  const yl = parseNum('yl')
  const d = parseNum('d')
  const ds = parseNum('ds')
  const ir = parseNum('ir')
  const is = parseNum('is')
  const sc = parseNum('sc')

  if (ic !== undefined) params.initialCapital = ic
  if (sy !== undefined) params.startYear = sy
  if (yl !== undefined) params.yearsLater = yl
  if (d !== undefined) params.development = d
  if (ds !== undefined) params.developmentStdDev = ds
  if (ir !== undefined) params.inflationRate = ir
  if (is !== undefined) params.inflationStdDev = is
  if (sc !== undefined) params.simulationCount = sc

  // Parse scenario parameters
  const bwr = parseNum('bwr')
  const pwr = parseNum('pwr')
  const ply = parseNum('ply')
  const cgt = parseNum('cgt')
  const itr = parseNum('itr')
  const its = parseNum('its')

  // Only create scenarios if we have at least some scenario params
  if (bwr !== undefined || pwr !== undefined || ply !== undefined || cgt !== undefined) {
    params.scenarios = [
      {
        name: 'ISK',
        balanceWithdrawalRate: bwr ?? 0.015,
        profitWithdrawalRate: pwr ?? 0.15,
        profitLookbackYears: ply ?? 5,
        capitalGainsTax: cgt ?? 0.3,
        iskTaxRate: itr ?? 0.0296,
        iskTaxRateStdDev: its ?? 0.005,
        isISK: true,
      },
      {
        name: 'VP',
        balanceWithdrawalRate: bwr ?? 0.015,
        profitWithdrawalRate: pwr ?? 0.15,
        profitLookbackYears: ply ?? 5,
        capitalGainsTax: cgt ?? 0.3,
        isISK: false,
      },
    ]
  }

  return params
}
