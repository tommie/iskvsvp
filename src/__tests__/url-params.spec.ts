import { describe, it, expect } from 'vitest'
import { decodeScenarioTableFromUrl } from '../utils/url-params'

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
