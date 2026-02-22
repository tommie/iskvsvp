import type {
  AssetPropertyParameter,
  InputParameters,
  Scenario,
  ScenarioParameter,
  ScenarioTable,
  SimulationAsset,
} from '../types'
import { isAssetPropertyParameter, parseAssetPropertyParameter } from '../types'
import type { LocationQuery } from 'vue-router'

// Mapping from base ScenarioParameter to URL param names
const PARAM_KEYS: Record<string, string> = {
  accountType: 'at',
  initialCapital: 'ic',
  startYear: 'sy',
  yearsLater: 'yl',
  simulationCount: 'sc',
  assets: 'pa',
  assetCorrelationMatrix: 'cm',
  assetRebalanceFrequency: 'rb',
  depositAmount: 'da',
  depositYears: 'dy',
  balanceWithdrawalRate: 'bwr',
  profitWithdrawalRate: 'pwr',
  profitLookbackYears: 'ply',
  inflationBasedWithdrawal: 'ibw',
  amortizedWithdrawal: 'aw',
  bequestGoal: 'bg',
  vpWealthTaxRate: 'vft',
  capitalGainsTaxRate: 'cgt',
  iskTaxRate: 'itr',
  iskTaxRateStdDev: 'its',
  inflationRate: 'ir',
  inflationStdDev: 'is',
  bootstrapProfileId: 'bp',
}

// Get URL key for a parameter (asset properties are not directly encoded in URL)
function getParamKey(param: ScenarioParameter): string | null {
  if (isAssetPropertyParameter(param)) {
    return null // Asset properties are encoded within 'pa' params
  }
  return PARAM_KEYS[param] ?? null
}

/**
 * Encode a single asset to compact format: m:0.1299,sd:0.202,w:1,n:Global Equity
 */
function encodeAsset(asset: SimulationAsset): string {
  return `m:${asset.expectedReturn},sd:${asset.volatility},w:${asset.weight},n:${asset.name}`
}

/**
 * Decode a single asset from compact format
 * Takes only the first value if there are repeated keys
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

      if (key === 'm' && asset.expectedReturn === undefined) {
        asset.expectedReturn = parseFloat(value)
      } else if (key === 'sd' && asset.volatility === undefined) {
        asset.volatility = parseFloat(value)
      } else if (key === 'w' && asset.weight === undefined) {
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
 * Decode asset with scenario-specific property overrides
 * Handles repeated keys for multi-valued properties: m:0.13,m:0.14,sd:0.20,w:1,n:Name
 * Returns base asset and property overrides for each scenario
 */
function decodeAssetWithOverrides(
  encoded: string,
  scenarioCount: number,
): {
  asset: SimulationAsset | null
  overrides: Map<string, number[]>
} {
  const overrides = new Map<string, number[]>()

  try {
    const parts = encoded.split(',')
    const asset: Partial<SimulationAsset> = {}
    const mValues: number[] = []
    const sdValues: number[] = []
    const wValues: number[] = []

    for (const part of parts) {
      const colonIndex = part.indexOf(':')
      if (colonIndex === -1) continue

      const key = part.substring(0, colonIndex)
      const value = part.substring(colonIndex + 1)

      if (key === 'm') {
        mValues.push(parseFloat(value))
      } else if (key === 'sd') {
        sdValues.push(parseFloat(value))
      } else if (key === 'w') {
        wValues.push(parseFloat(value))
      } else if (key === 'n') {
        // Name is everything after 'n:' and might contain commas
        const nameStart = encoded.indexOf(',n:')
        if (nameStart !== -1) {
          asset.name = encoded.substring(nameStart + 3)
          break
        }
      }
    }

    // Set base values (first value of each)
    if (mValues.length > 0) asset.expectedReturn = mValues[0]!
    if (sdValues.length > 0) asset.volatility = sdValues[0]!
    if (wValues.length > 0) asset.weight = wValues[0]!

    // If we have multiple values matching scenario count, they're overrides
    if (mValues.length === scenarioCount && scenarioCount > 1) {
      overrides.set('expectedReturn', mValues)
    }
    if (sdValues.length === scenarioCount && scenarioCount > 1) {
      overrides.set('volatility', sdValues)
    }
    if (wValues.length === scenarioCount && scenarioCount > 1) {
      overrides.set('weight', wValues)
    }

    if (
      asset.expectedReturn !== undefined &&
      asset.volatility !== undefined &&
      asset.weight !== undefined &&
      asset.name !== undefined
    ) {
      return { asset: asset as SimulationAsset, overrides }
    }

    return { asset: null, overrides }
  } catch (e) {
    console.warn('Failed to decode asset with overrides', e)
    return { asset: null, overrides }
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
 * Encode a single asset with potentially multi-valued properties
 * Uses repeated keys for multi-valued properties: m:0.13,m:0.14,sd:0.20,w:1,n:Name
 */
function encodeAssetWithOverrides(
  asset: SimulationAsset,
  assetIndex: number,
  propertyOverrides: Map<number, Map<string, (number | undefined)[]>>,
): string {
  const m = propertyOverrides.get(assetIndex)?.get('expectedReturn')
  const sd = propertyOverrides.get(assetIndex)?.get('volatility')
  const w = propertyOverrides.get(assetIndex)?.get('weight')

  const parts: string[] = []

  // Expected return (mean)
  if (m) {
    m.forEach((v) => parts.push(`m:${v ?? asset.expectedReturn}`))
  } else {
    parts.push(`m:${asset.expectedReturn}`)
  }

  // Volatility (stddev)
  if (sd) {
    sd.forEach((v) => parts.push(`sd:${v ?? asset.volatility}`))
  } else {
    parts.push(`sd:${asset.volatility}`)
  }

  // Weight
  if (w) {
    w.forEach((v) => parts.push(`w:${v ?? asset.weight}`))
  } else {
    parts.push(`w:${asset.weight}`)
  }

  // Name (always single value)
  parts.push(`n:${asset.name}`)

  return parts.join(',')
}

/**
 * Encode scenario table to URL query params
 */
function encodeScenarioTable(
  scenarioTable: ScenarioTable,
  baseParams: Omit<InputParameters, 'seed'> & Partial<Pick<InputParameters, 'seed'>>,
): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}

  // Enable scenario table flag
  query.st = '1'

  // Scenario names
  query.sn = scenarioTable.scenarios.map((s) => s.label)

  // Find all controlled parameters across all scenarios
  const controlledParams = new Set<ScenarioParameter>()
  const assetPropertyParams = new Set<AssetPropertyParameter>()

  for (const scenario of scenarioTable.scenarios) {
    for (const key of Object.keys(scenario.parameters) as ScenarioParameter[]) {
      if (isAssetPropertyParameter(key)) {
        assetPropertyParams.add(key)
      } else {
        controlledParams.add(key)
      }
    }
  }

  // Collect asset property overrides: Map<assetIndex, Map<property, values[]>>
  const assetPropertyOverrides = new Map<number, Map<string, (number | undefined)[]>>()
  for (const paramKey of assetPropertyParams) {
    const parsed = parseAssetPropertyParameter(paramKey)
    if (!parsed) continue

    if (!assetPropertyOverrides.has(parsed.index)) {
      assetPropertyOverrides.set(parsed.index, new Map())
    }

    const values: (number | undefined)[] = []
    for (const scenario of scenarioTable.scenarios) {
      values.push(scenario.parameters[paramKey] as number | undefined)
    }

    assetPropertyOverrides.get(parsed.index)!.set(parsed.property, values)
  }

  // Build controlled parameters list (excluding asset properties)
  const cpList: string[] = []
  for (const param of controlledParams) {
    const key = getParamKey(param)
    if (key) cpList.push(key)
  }

  query.cp = cpList.join(',')

  // Encode controlled parameters (non-asset-property)
  for (const param of controlledParams) {
    const urlKey = getParamKey(param)
    if (!urlKey) continue

    const values: string[] = []

    for (const scenario of scenarioTable.scenarios) {
      const value = scenario.parameters[param]

      if (value === undefined) {
        values.push('')
      } else if (param === 'assets' && Array.isArray(value)) {
        // Special case for assets - encode as before
        values.push((value as SimulationAsset[]).map(encodeAsset).join('|'))
      } else if (param === 'assetCorrelationMatrix' && Array.isArray(value)) {
        // Special case for correlation matrix
        values.push(encodeCorrelationMatrix(value as number[][]))
      } else {
        values.push(String(value))
      }
    }

    query[urlKey] = values
  }

  // Encode all non-controlled base parameters
  const baseQuery = encodeParamsToUrl(baseParams)
  for (const [key, value] of Object.entries(baseQuery)) {
    // Only include if not already controlled by the table
    const paramKey = (Object.keys(PARAM_KEYS) as ScenarioParameter[]).find(
      (k) => PARAM_KEYS[k] === key,
    )
    if (!paramKey || !controlledParams.has(paramKey)) {
      query[key] = value
    }
  }

  // If we have asset property overrides but assets is not fully controlled,
  // override the base assets with multi-valued properties
  if (assetPropertyOverrides.size > 0 && !controlledParams.has('assets')) {
    const encodedAssets = baseParams.assets.map((asset, index) =>
      encodeAssetWithOverrides(asset, index, assetPropertyOverrides),
    )
    query.pa = encodedAssets
  }

  return query
}

/**
 * Decode scenario table from URL query params
 */
function decodeScenarioTable(query: LocationQuery): ScenarioTable | null {
  // Helper to get array of string values from query param
  const getStringArray = (key: string): string[] => {
    const value = query[key]
    if (!value) return []
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === 'string')
    }
    return [value]
  }

  // Check if scenario table is enabled
  const enabled = query.st === '1'
  if (!enabled) return null

  // Get scenario names
  const names = getStringArray('sn')
  if (names.length === 0) return null

  // Get controlled parameters
  const cpStr = query.cp
  if (!cpStr || Array.isArray(cpStr)) return null
  const controlledParams = cpStr.split(',').filter((p) => p.length > 0)

  // Check if assets have property overrides (multi-valued properties)
  // Always check 'pa' params for overrides, not just when 'pa' is controlled
  const assetPropertyOverrides = new Map<number, Map<string, number[]>>()
  const assetStrings = getStringArray('pa')
  if (assetStrings.length > 0) {
    // Decode each asset and check for multi-valued properties
    assetStrings.forEach((encoded, assetIndex) => {
      const { overrides } = decodeAssetWithOverrides(encoded, names.length)
      if (overrides.size > 0) {
        assetPropertyOverrides.set(assetIndex, overrides)
      }
    })
  }

  // Build scenarios
  const scenarios = names.map((label, idx) => {
    const parameters: Record<string, unknown> = {}

    for (const urlKey of controlledParams) {
      // Find the ScenarioParameter key for this URL key
      const paramKey = (Object.keys(PARAM_KEYS) as string[]).find((k) => PARAM_KEYS[k] === urlKey)
      if (!paramKey) continue

      // Get values for this parameter
      const values = getStringArray(urlKey)
      if (idx >= values.length) continue

      const value = values[idx]
      if (!value || value === '') continue

      // Parse the value based on parameter type
      if (paramKey === 'accountType') {
        parameters[paramKey] = value as 'ISK' | 'VP'
      } else if (paramKey === 'bootstrapProfileId') {
        parameters[paramKey] = value
      } else if (paramKey === 'assets') {
        // If we have asset property overrides, don't set full assets array
        if (assetPropertyOverrides.size === 0) {
          // Decode pipe-separated assets (legacy mode)
          const assetStrings = value.split('|')
          parameters[paramKey] = assetStrings
            .map(decodeAsset)
            .filter((a): a is SimulationAsset => a !== null)
        }
      } else if (paramKey === 'assetCorrelationMatrix') {
        // Decode correlation matrix (need to know asset count from assets param)
        const assets = parameters.assets as SimulationAsset[] | undefined
        if (assets && assets.length > 1) {
          parameters[paramKey] = decodeCorrelationMatrix(value, assets.length)
        }
      } else if (paramKey === 'assetRebalanceFrequency') {
        parameters[paramKey] = value === 'annually' ? 'annually' : 'never'
      } else if (paramKey === 'amortizedWithdrawal') {
        parameters[paramKey] = value === '1'
      } else {
        // Parse as number
        const num = parseFloat(value)
        if (isFinite(num)) {
          parameters[paramKey] = num
        }
      }
    }

    // Add asset property overrides to this scenario
    for (const [assetIndex, overrides] of assetPropertyOverrides.entries()) {
      for (const [property, values] of overrides.entries()) {
        const paramKey = `assets.${property}.${assetIndex}` as ScenarioParameter
        parameters[paramKey] = values[idx]
      }
    }

    return { label, parameters }
  }) as Scenario[]

  return { scenarios }
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

  // Deposit parameters
  query.da = params.depositAmount.toString()
  query.dy = params.depositYears.toString()

  // Withdrawal parameters
  query.bwr = params.balanceWithdrawalRate.toString()
  query.pwr = params.profitWithdrawalRate.toString()
  query.ply = params.profitLookbackYears.toString()
  query.ibw = params.inflationBasedWithdrawal.toString()
  if (params.amortizedWithdrawal) {
    query.aw = '1'
  }
  if (params.bequestGoal) {
    query.bg = params.bequestGoal.toString()
  }
  query.cgt = params.capitalGainsTaxRate.toString()

  // Bootstrap profile (optional)
  if (params.bootstrapProfileId) {
    query.bp = params.bootstrapProfileId
  }

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

  // Parse deposit parameters
  const da = parseNum('da')
  const dy = parseNum('dy')

  if (da !== undefined) params.depositAmount = da
  if (dy !== undefined) params.depositYears = dy

  // Parse withdrawal and tax parameters
  const bwr = parseNum('bwr')
  const pwr = parseNum('pwr')
  const ply = parseNum('ply')
  const ibw = parseNum('ibw')
  const cgt = parseNum('cgt')
  const itr = parseNum('itr')
  const its = parseNum('its')

  const bp = getString('bp')
  if (bp) params.bootstrapProfileId = bp

  const aw = getString('aw')
  const bg = parseNum('bg')

  if (bwr !== undefined) params.balanceWithdrawalRate = bwr
  if (pwr !== undefined) params.profitWithdrawalRate = pwr
  if (ply !== undefined) params.profitLookbackYears = ply
  if (ibw !== undefined) params.inflationBasedWithdrawal = ibw
  if (aw !== undefined) params.amortizedWithdrawal = aw === '1'
  if (bg !== undefined) params.bequestGoal = bg
  if (cgt !== undefined) params.capitalGainsTaxRate = cgt
  if (itr !== undefined) params.iskTaxRate = itr
  if (its !== undefined) params.iskTaxRateStdDev = its

  return params
}

/**
 * Encode scenario table to URL
 */
export function encodeScenarioTableToUrl(
  scenarioTable: ScenarioTable,
  baseParams: Omit<InputParameters, 'seed'> & Partial<Pick<InputParameters, 'seed'>>,
): Record<string, string | string[]> {
  return encodeScenarioTable(scenarioTable, baseParams)
}

/**
 * Decode scenario table from URL
 */
export function decodeScenarioTableFromUrl(query: LocationQuery): ScenarioTable | null {
  return decodeScenarioTable(query)
}
