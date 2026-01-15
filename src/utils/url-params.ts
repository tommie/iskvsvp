import type { InputParameters, SimulationAsset } from '../types'
import type { LocationQuery } from 'vue-router'

/**
 * Encode a single asset to compact format: m:0.1299,sd:0.202,w:1,n:Global Equity
 */
function encodeAsset(asset: SimulationAsset): string {
  return `m:${asset.expectedReturn},sd:${asset.volatility},w:${asset.weight},n:${asset.name}`
}

/**
 * Decode a single asset from compact format
 */
function decodeAsset(encoded: string): SimulationAsset | null {
  try {
    const parts = encoded.split(',')
    const asset: Partial<SimulationAsset> = {}

    for (const part of parts) {
      const colonIndex = part.indexOf(':')
      if (colonIndex === -1) continue

      const key = part.substring(0, colonIndex)
      const value = part.substring(colonIndex + 1)

      if (key === 'm') {
        asset.expectedReturn = parseFloat(value)
      } else if (key === 'sd') {
        asset.volatility = parseFloat(value)
      } else if (key === 'w') {
        asset.weight = parseFloat(value)
      } else if (key === 'n') {
        // Name is everything after 'n:' and might contain commas
        const nameStart = encoded.indexOf(',n:')
        if (nameStart !== -1) {
          asset.name = encoded.substring(nameStart + 3)
          break // Name is last, stop processing
        }
      }
    }

    if (
      asset.expectedReturn !== undefined &&
      asset.volatility !== undefined &&
      asset.weight !== undefined &&
      asset.name !== undefined
    ) {
      return asset as SimulationAsset
    }

    return null
  } catch (e) {
    console.warn('Failed to decode asset', e)
    return null
  }
}

/**
 * Encode correlation matrix to flat comma-separated lower triangle
 */
function encodeCorrelationMatrix(matrix: number[][]): string {
  const values: number[] = []
  // Lower triangle only (excluding diagonal)
  for (let i = 1; i < matrix.length; i++) {
    for (let j = 0; j < i; j++) {
      values.push(matrix[i]![j]!)
    }
  }
  return values.map((v) => v.toFixed(2)).join(',')
}

/**
 * Decode correlation matrix from flat comma-separated lower triangle
 */
function decodeCorrelationMatrix(encoded: string, n: number): number[][] | null {
  try {
    const values = encoded.split(',').map((v) => parseFloat(v.trim()))
    const expectedCount = (n * (n - 1)) / 2

    if (values.length !== expectedCount) {
      return null
    }

    // Build full symmetric matrix
    const matrix: number[][] = [[1.0]]
    let valueIndex = 0

    for (let i = 1; i < n; i++) {
      matrix[i] = []
      for (let j = 0; j < i; j++) {
        matrix[i]![j] = values[valueIndex++]!
      }
    }

    // Complete the matrix
    for (let i = 0; i < n; i++) {
      matrix[i]![i] = 1.0
      for (let j = i + 1; j < n; j++) {
        matrix[i]![j] = matrix[j]![i]!
      }
    }

    return matrix
  } catch (e) {
    console.warn('Failed to decode correlation matrix', e)
    return null
  }
}

/**
 * Encode parameters to URL query string
 */
export function encodeParamsToUrl(
  params: Omit<InputParameters, 'seed'> & Partial<Pick<InputParameters, 'seed'>>,
): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}

  // Map each parameter to its short name
  query.ic = params.initialCapital.toString()
  query.sy = params.startYear.toString()
  query.yl = params.yearsLater.toString()
  query.ir = params.inflationRate.toString()
  query.is = params.inflationStdDev.toString()
  query.vft = params.vpWealthTaxRate.toString()
  query.sc = params.simulationCount.toString()

  // Encode assets as multiple pa= parameters
  if (params.assets.length > 0) {
    query.pa = params.assets.map(encodeAsset)

    // Encode correlation matrix if more than one asset
    if (params.assets.length > 1) {
      query.cm = encodeCorrelationMatrix(params.assetCorrelationMatrix)
    } else {
      query.cm = []
    }

    // Encode rebalance frequency (only if not default 'never')
    if (params.assetRebalanceFrequency !== 'never') {
      query.rb = params.assetRebalanceFrequency
    }
  }

  // Withdrawal parameters
  query.bwr = params.balanceWithdrawalRate.toString()
  query.pwr = params.profitWithdrawalRate.toString()
  query.ply = params.profitLookbackYears.toString()
  query.ibw = params.inflationBasedWithdrawal.toString()
  query.cgt = params.capitalGainsTaxRate.toString()

  // ISK-specific params (optional)
  if (params.iskTaxRate !== undefined) {
    query.itr = params.iskTaxRate.toString()
  }
  if (params.iskTaxRateStdDev !== undefined) {
    query.its = params.iskTaxRateStdDev.toString()
  }

  // Include seed if present
  if (params.seed) {
    query.s = params.seed
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

  // Helper to get array of string values from query param
  const getStringArray = (key: string): string[] => {
    const value = query[key]
    if (!value) return []
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === 'string')
    }
    return [value]
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
  const ir = parseNum('ir')
  const is = parseNum('is')
  const vft = parseNum('vft')
  const sc = parseNum('sc')
  const seed = getString('s')

  if (ic !== undefined) params.initialCapital = ic
  if (sy !== undefined) params.startYear = sy
  if (yl !== undefined) params.yearsLater = yl
  if (ir !== undefined) params.inflationRate = ir
  if (is !== undefined) params.inflationStdDev = is
  if (vft !== undefined) params.vpWealthTaxRate = vft
  if (sc !== undefined) params.simulationCount = sc
  if (seed) params.seed = seed

  // Parse assets from multiple pa= parameters
  const assetStrings = getStringArray('pa')
  if (assetStrings.length > 0) {
    const assets = assetStrings.map(decodeAsset).filter((a): a is SimulationAsset => a !== null)

    if (assets.length > 0) {
      params.assets = assets

      // Parse correlation matrix
      const correlationStr = getString('cm')
      let correlationMatrix: number[][] | null = null

      if (correlationStr && assets.length > 1) {
        correlationMatrix = decodeCorrelationMatrix(correlationStr, assets.length)
      }

      // If no valid correlation matrix provided, use default (identity or moderate correlation)
      if (!correlationMatrix) {
        correlationMatrix = []
        for (let i = 0; i < assets.length; i++) {
          correlationMatrix[i] = []
          for (let j = 0; j < assets.length; j++) {
            correlationMatrix[i]![j] = i === j ? 1.0 : 0.5
          }
        }
      }

      params.assetCorrelationMatrix = correlationMatrix

      // Parse rebalance frequency
      const rebalanceFrequency = getString('rb')
      params.assetRebalanceFrequency = rebalanceFrequency === 'annually' ? 'annually' : 'never'
    }
  }

  // Parse withdrawal and tax parameters
  const bwr = parseNum('bwr')
  const pwr = parseNum('pwr')
  const ply = parseNum('ply')
  const ibw = parseNum('ibw')
  const cgt = parseNum('cgt')
  const itr = parseNum('itr')
  const its = parseNum('its')

  if (bwr !== undefined) params.balanceWithdrawalRate = bwr
  if (pwr !== undefined) params.profitWithdrawalRate = pwr
  if (ply !== undefined) params.profitLookbackYears = ply
  if (ibw !== undefined) params.inflationBasedWithdrawal = ibw
  if (cgt !== undefined) params.capitalGainsTaxRate = cgt
  if (itr !== undefined) params.iskTaxRate = itr
  if (its !== undefined) params.iskTaxRateStdDev = its

  return params
}
