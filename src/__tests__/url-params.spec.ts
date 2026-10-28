import { describe, it, expect } from 'vitest'
import {
  decodeParamsFromUrl,
  decodeScenarioTableFromUrl,
  encodeParamsToUrl,
} from '../utils/url-params'
import type { InputParameters } from '../types'

describe('decodeScenarioTableFromUrl', () => {
  it('decodes scenario table with empty controlled params (asset-weight-only overrides)', () => {
    // When only asset weights vary between scenarios, cp is an empty
    // string because there are no regular (non-asset-property) controlled
    // params. The decoder must accept this.
    const query = {
      st: '1',
      sn: ['Aktiv', 'Passiv'],
      cp: '',
      pa: ['m:0.13,sd:0.16,w:0.85,w:0,n:Fund A', 'm:0.04,sd:0.04,w:0.15,w:1,n:Fund B'],
      ic: '5000000',
    }

    const result = decodeScenarioTableFromUrl(query)

    expect(result).not.toBeNull()
    expect(result!.scenarios).toHaveLength(2)
    expect(result!.scenarios[0]!.label).toBe('Aktiv')
    expect(result!.scenarios[1]!.label).toBe('Passiv')

    // Asset weight overrides should be decoded into scenario parameters
    expect(result!.scenarios[0]!.parameters['assets.weight.0']).toBe(0.85)
    expect(result!.scenarios[0]!.parameters['assets.weight.1']).toBe(0.15)
    expect(result!.scenarios[1]!.parameters['assets.weight.0']).toBe(0)
    expect(result!.scenarios[1]!.parameters['assets.weight.1']).toBe(1)
  })

  it('decodes scenario table with regular controlled params', () => {
    const query = {
      st: '1',
      sn: ['ISK', 'VP'],
      cp: 'at',
      at: ['ISK', 'VP'],
      ic: '5000000',
    }

    const result = decodeScenarioTableFromUrl(query)

    expect(result).not.toBeNull()
    expect(result!.scenarios).toHaveLength(2)
    expect(result!.scenarios[0]!.parameters.accountType).toBe('ISK')
    expect(result!.scenarios[1]!.parameters.accountType).toBe('VP')
  })

  it('returns null when st flag is missing', () => {
    const query = { sn: ['A', 'B'], cp: '' }
    expect(decodeScenarioTableFromUrl(query)).toBeNull()
  })

  it('returns null when scenario names are missing', () => {
    const query = { st: '1', cp: '' }
    expect(decodeScenarioTableFromUrl(query)).toBeNull()
  })

  it('returns null when cp is missing entirely', () => {
    const query = { st: '1', sn: ['A', 'B'] }
    expect(decodeScenarioTableFromUrl(query)).toBeNull()
  })
})

describe('asset classes in the URL', () => {
  const params = {
    initialCapital: 5_000_000,
    startYear: 45,
    yearsLater: 36,
    simulationCount: 1000,
    assets: [
      {
        presetId: 'global-equity',
        name: 'Globala aktier',
        weight: 0.7,
        expectedReturn: 0.0584,
        volatility: 0.17,
      },
      { name: 'Eget, med komma', weight: 0.3, expectedReturn: 0.01, volatility: 0.05 },
    ],
    assetCorrelationMatrix: [
      [1, 0.5],
      [0.5, 1],
    ],
    assetRebalanceFrequency: 'annually',
    depositAmount: 0,
    depositYears: 0,
    withdrawalNeed: 110_000,
    withdrawalExtra: 55_000,
    bequestAmount: 0,
    ageAdjustedSpending: false,
    vpWealthTaxRate: 0.004,
    capitalGainsTaxRate: 0.3,
    inflationRate: 0.02,
    inflationStdDev: 0.009,
  } satisfies Omit<InputParameters, 'seed'>

  it('round-trips the preset id and a name containing a comma', () => {
    const decoded = decodeParamsFromUrl(encodeParamsToUrl(params))
    expect(decoded!.assets).toEqual(params.assets)
  })

  it('round-trips need, extra and the bequest amount', () => {
    const withBequest = { ...params, bequestAmount: 2_000_000 }
    const decoded = decodeParamsFromUrl(encodeParamsToUrl(withBequest))
    expect(decoded!.withdrawalNeed).toBe(110_000)
    expect(decoded!.withdrawalExtra).toBe(55_000)
    expect(decoded!.bequestAmount).toBe(2_000_000)
  })

  it('writes rb only when rebalancing is turned off, since annual is the default', () => {
    expect(encodeParamsToUrl(params).rb).toBeUndefined()
    const off = encodeParamsToUrl({ ...params, assetRebalanceFrequency: 'never' })
    expect(off.rb).toBe('never')
    expect(decodeParamsFromUrl(off)!.assetRebalanceFrequency).toBe('never')
    expect(decodeParamsFromUrl(encodeParamsToUrl(params))!.assetRebalanceFrequency).toBe('annually')
  })
})
