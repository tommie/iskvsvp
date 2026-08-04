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
      pa: [
        'm:0.13,sd:0.16,w:0.85,w:0,n:Fund A',
        'm:0.04,sd:0.04,w:0.15,w:1,n:Fund B',
      ],
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

describe('withdrawalCap round-trip', () => {
  const params: Omit<InputParameters, 'seed'> = {
    initialCapital: 1_000_000,
    startYear: 45,
    yearsLater: 30,
    simulationCount: 100,
    assets: [{ name: 'A', weight: 1, expectedReturn: 0.08, volatility: 0.15 }],
    assetCorrelationMatrix: [[1]],
    assetRebalanceFrequency: 'never',
    depositAmount: 0,
    depositYears: 0,
    balanceWithdrawalRate: 0.01,
    profitWithdrawalRate: 0,
    profitLookbackYears: 5,
    inflationBasedWithdrawal: 500_000,
    amortizedWithdrawal: false,
    bequestGoal: 0,
    ageAdjustedSpending: false,
    withdrawalRatchetLimit: 0,
    withdrawalCap: 800_000,
    vpWealthTaxRate: 0.004,
    capitalGainsTaxRate: 0.3,
    inflationRate: 0.02,
    inflationStdDev: 0.009,
  }

  it('encodes as wc and decodes back', () => {
    const query = encodeParamsToUrl(params)
    expect(query.wc).toBe('800000')

    const decoded = decodeParamsFromUrl(query)
    expect(decoded).not.toBeNull()
    expect(decoded!.withdrawalCap).toBe(800_000)
  })

  it('omits wc when the cap is off, and decodes to undefined', () => {
    const query = encodeParamsToUrl({ ...params, withdrawalCap: 0 })
    expect(query.wc).toBeUndefined()

    const decoded = decodeParamsFromUrl(query)
    expect(decoded).not.toBeNull()
    expect(decoded!.withdrawalCap).toBeUndefined()
  })
})
