<script setup lang="ts">
import { useHistoryStore } from '../stores/history'
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import type { HistoryRecord } from '../stores/history'

const historyStore = useHistoryStore()
const calculatorStore = useCalculatorStore()
const { records } = storeToRefs(historyStore)

const editingId = ref<string | null>(null)
const editingTitle = ref('')

const startEdit = (record: HistoryRecord) => {
  editingId.value = record.id
  editingTitle.value = record.title
}

const saveEdit = (id: string) => {
  if (editingTitle.value.trim()) {
    historyStore.updateTitle(id, editingTitle.value.trim())
  }
  editingId.value = null
  editingTitle.value = ''
}

const cancelEdit = () => {
  editingId.value = null
  editingTitle.value = ''
}

const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('sv-SE', {
    maximumFractionDigits: 0,
  }).format(value)
}

const formatPercent = (value: number): string => {
  return new Intl.NumberFormat('sv-SE', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

const getWinner = (record: HistoryRecord): 'ISK' | 'VP' => {
  const iskMedian = record.statistics.median.realWithdrawalISK
  const vpMedian = record.statistics.median.realWithdrawalVP
  return iskMedian > vpMedian ? 'ISK' : 'VP'
}

const getWinnerClass = (winner: 'ISK' | 'VP'): string => {
  return winner === 'ISK' ? 'text-primary' : 'text-warning'
}

const loadRecord = (record: HistoryRecord) => {
  calculatorStore.loadParameters(record.parameters)
  // Scroll to top to show the loaded parameters
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<template>
  <div class="card mb-4" v-if="records.length > 0">
    <div class="card-header d-flex justify-content-between align-items-center">
      <div>
        <h3>Simuleringshistorik</h3>
        <p class="mb-0 text-muted">Tidigare simuleringar ({{ records.length }} st)</p>
      </div>
      <button class="btn btn-sm btn-outline-danger" @click="historyStore.clearAll">
        Rensa alla
      </button>
    </div>
    <div class="card-body">
      <div class="history-grid">
        <div v-for="record in records" :key="record.id" class="history-card">
          <div class="history-card-header">
            <div v-if="editingId === record.id" class="edit-title-form">
              <input
                type="text"
                class="form-control form-control-sm"
                v-model="editingTitle"
                @keyup.enter="saveEdit(record.id)"
                @keyup.escape="cancelEdit"
                autofocus
              />
              <button class="btn btn-sm btn-success" @click="saveEdit(record.id)">✓</button>
              <button class="btn btn-sm btn-secondary" @click="cancelEdit">✕</button>
            </div>
            <div v-else class="title-display">
              <h6 class="mb-0" @dblclick="startEdit(record)">{{ record.title }}</h6>
              <div class="header-actions">
                <button
                  class="btn btn-sm btn-link p-0 text-primary"
                  @click="loadRecord(record)"
                  title="Ladda parametrar"
                >
                  ↻
                </button>
                <button
                  class="btn btn-sm btn-link p-0"
                  @click="startEdit(record)"
                  title="Redigera titel"
                >
                  ✎
                </button>
                <button
                  class="btn btn-sm btn-link p-0 text-danger"
                  @click="historyStore.removeRecord(record.id)"
                  title="Ta bort"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
          <div class="history-card-body">
            <div class="result-summary">
              <strong>Vinnare (median reellt uttag):</strong>
              <span :class="['winner-badge', getWinnerClass(getWinner(record))]">
                {{ getWinner(record) }}
              </span>
            </div>
            <div class="parameters-summary">
              <div class="param-row">
                <span class="param-label">Startkapital:</span>
                <span class="param-value"
                  >{{ formatNumber(record.parameters.initialCapital) }} kr</span
                >
              </div>
              <div class="param-row">
                <span class="param-label">Uttag:</span>
                <span class="param-value">
                  ISK {{ formatPercent(record.parameters.withdrawalISK) }}, VP
                  {{ formatPercent(record.parameters.withdrawalVP) }}
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Avkastning:</span>
                <span class="param-value">
                  {{ formatPercent(record.parameters.development) }}, SD
                  {{ formatPercent(record.parameters.developmentStdDev) }}
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">ISK-skatt:</span>
                <span class="param-value">{{ formatPercent(record.parameters.iskTaxRate) }}</span>
              </div>
              <div class="param-row">
                <span class="param-label">Beskattningsgrad (median):</span>
                <span class="param-value">
                  ISK {{ formatPercent(record.statistics.median.taxationDegreeISK) }}, VP
                  {{ formatPercent(record.statistics.median.taxationDegreeVP) }}
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Period:</span>
                <span class="param-value">
                  {{ record.parameters.startYear }} -
                  {{ record.parameters.startYear + record.parameters.yearsLater }} ({{
                    record.parameters.yearsLater
                  }}
                  år)
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Simuleringar:</span>
                <span class="param-value">{{
                  formatNumber(record.parameters.simulationCount)
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

@media (min-width: 768px) {
  .history-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (min-width: 1200px) {
  .history-grid {
    grid-template-columns: 1fr 1fr 1fr;
  }
}

.history-card {
  border: 1px solid #dee2e6;
  border-radius: 0.375rem;
  background: #fff;
  overflow: hidden;
}

.history-card-header {
  background: #f8f9fa;
  padding: 0.75rem;
  border-bottom: 1px solid #dee2e6;
}

.title-display {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title-display h6 {
  cursor: pointer;
  flex: 1;
}

.title-display h6:hover {
  color: #0d6efd;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.header-actions .btn {
  font-size: 1rem;
  line-height: 1;
  text-decoration: none;
}

.edit-title-form {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.edit-title-form input {
  flex: 1;
}

.history-card-body {
  padding: 0.75rem;
}

.result-summary {
  margin-bottom: 0.75rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.winner-badge {
  font-weight: 600;
  font-size: 1rem;
}

.parameters-summary {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.param-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.param-label {
  color: #6c757d;
  white-space: nowrap;
}

.param-value {
  font-weight: 500;
  text-align: right;
}
</style>
