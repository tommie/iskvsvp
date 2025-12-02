import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { InputParameters, SimulationStatistics } from '../types'

export interface HistoryRecord {
  id: string
  timestamp: number
  title: string
  parameters: InputParameters
  statistics: SimulationStatistics
}

export const useHistoryStore = defineStore('history', () => {
  const records = ref<HistoryRecord[]>([])
  const maxRecords = 100

  // Load from localStorage on init
  const loadFromStorage = () => {
    try {
      const stored = localStorage.getItem('simulation-history')
      if (stored) {
        records.value = JSON.parse(stored)
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
  const addRecord = (parameters: InputParameters, statistics: SimulationStatistics) => {
    const timestamp = Date.now()
    const record: HistoryRecord = {
      id: `sim-${timestamp}`,
      timestamp,
      title: new Date(timestamp).toLocaleString('sv-SE'),
      parameters,
      statistics,
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
