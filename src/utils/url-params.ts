import type { InputParameters, PortfolioAsset } from '../types'
import type { LocationQuery } from 'vue-router'

/**
 * Encode a single asset to compact format: m:0.1299,sd:0.202,w:1,n:Global Equity
 */
function encodeAsset(asset: PortfolioAsset): string {
  return `m:${asset.expectedReturn},sd:${asset.volatility},w:${asset.weight},n:${asset.name}`
}

/**
 * Decode a single asset from compact format
 */
function decodeAsset(encoded: string): PortfolioAsset | null {
  try {
    const parts = encoded.split(',')
    const asset: Partial<PortfolioAsset> = {}

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
      return asset as PortfolioAsset
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
  query.sc = params.simulationCount.toString()

  // Encode portfolio assets as multiple p= parameters
  if (params.portfolio && params.portfolio.assets.length > 0) {
    query.pa = params.portfolio.assets.map(encodeAsset)

    // Encode correlation matrix if more than one asset
    if (params.portfolio.assets.length > 1) {
      query.cm = encodeCorrelationMatrix(params.portfolio.correlationMatrix)
    } else {
      query.cm = []
    }
  }

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
  const sc = parseNum('sc')
  const seed = getString('s')

  if (ic !== undefined) params.initialCapital = ic
  if (sy !== undefined) params.startYear = sy
  if (yl !== undefined) params.yearsLater = yl
  if (ir !== undefined) params.inflationRate = ir
  if (is !== undefined) params.inflationStdDev = is
  if (sc !== undefined) params.simulationCount = sc
  if (seed) params.seed = seed

  // Parse portfolio assets from multiple pa= parameters
  const assetStrings = getStringArray('pa')
  if (assetStrings.length > 0) {
    const assets = assetStrings.map(decodeAsset).filter((a): a is PortfolioAsset => a !== null)

    if (assets.length > 0) {
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

      params.portfolio = {
        assets,
        correlationMatrix,
      }
    }
  }

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
