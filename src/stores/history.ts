import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { InputParameters, SimulationResults } from '../types'

export interface HistoryScenarioSummary {
  label: string
  totalValue: number
  liquidValue: number
  accumulatedRealWithdrawal: number
  taxationDegree: number
  maxDrawdown: number
}

export interface HistorySummary {
  scenarios: HistoryScenarioSummary[]
}

export interface HistoryRecord {
  id: string
  timestamp: number
  title: string
  parameters: InputParameters
  summary: HistorySummary
}

function buildSummary(results: SimulationResults): HistorySummary {
  const scenarios: HistoryScenarioSummary[] = results.statistics.map((stats, i) => {
    const finalPeriod = stats.median.snapshots.liquidValue.length - 1
    return {
      label: results.labels[i] ?? '',
      totalValue: stats.median.snapshots.totalValue[finalPeriod] ?? 0,
      liquidValue: stats.median.snapshots.liquidValue[finalPeriod] ?? 0,
      accumulatedRealWithdrawal: stats.median.snapshots.withdrawalReal[finalPeriod] ?? 0,
      taxationDegree: stats.median.snapshots.taxationDegree[finalPeriod] ?? 0,
      maxDrawdown: stats.median.snapshots.maxDrawdown[finalPeriod] ?? 0,
    }
  })
  return { scenarios }
}

export const useHistoryStore = defineStore('history', () => {
  const records = ref<HistoryRecord[]>([])
  const maxRecords = 100

  // Load from localStorage on init
  const loadFromStorage = () => {
    try {
      const stored = localStorage.getItem('simulation-history')
      if (stored) {
        const parsed = JSON.parse(stored) as HistoryRecord[]
        // Only keep records that have the summary field (drop legacy records with results)
        records.value = parsed.filter((r) => r.summary)
      }
    } catch (e) {
      console.error('Failed to load history from localStorage:', e)
    }
  }

  // Save to localStorage
  const saveToStorage = () => {
    try {
      localStorage.setItem('simulation-history', JSON.stringify(records.value))
    } catch (e) {
      console.error('Failed to save history to localStorage:', e)
    }
  }

  // Add a new simulation record
  const addRecord = (parameters: InputParameters, results: SimulationResults) => {
    const timestamp = Date.now()
    const record: HistoryRecord = {
      id: `sim-${timestamp}`,
      timestamp,
      title: new Date(timestamp).toLocaleString('sv-SE'),
      parameters,
      summary: buildSummary(results),
    }

    records.value.unshift(record)

    // Keep only the most recent maxRecords
    if (records.value.length > maxRecords) {
      records.value = records.value.slice(0, maxRecords)
    }

    saveToStorage()
  }

  // Update record title
  const updateTitle = (id: string, newTitle: string) => {
    const record = records.value.find((r) => r.id === id)
    if (record) {
      record.title = newTitle
      saveToStorage()
    }
  }

  // Remove a record
  const removeRecord = (id: string) => {
    records.value = records.value.filter((r) => r.id !== id)
    saveToStorage()
  }

  // Clear all records
  const clearAll = () => {
    records.value = []
    saveToStorage()
  }

  // Initialize by loading from storage
  loadFromStorage()

  return {
    records,
    addRecord,
    updateTitle,
    removeRecord,
    clearAll,
  }
})
