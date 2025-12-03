<script setup lang="ts">
import { useHistoryStore } from '../stores/history'
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, useId } from 'vue'
import type { HistoryRecord } from '../stores/history'

const historyStore = useHistoryStore()
const calculatorStore = useCalculatorStore()
const { records } = storeToRefs(historyStore)

const clearAllPopoverId = useId()
const getDeletePopoverId = (recordId: string) => `delete-popover-${recordId}`

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

const formatPercent = (value: number | undefined): string => {
  if (value == null) return 'N/A'
  return new Intl.NumberFormat('sv-SE', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

const getWinner = (record: HistoryRecord): string => {
  const scenarios = record.statistics.median.scenarios ?? {}
  const scenarioNames = Object.keys(scenarios)

  if (scenarioNames.length === 0) return 'N/A'

  let bestScenario = scenarioNames[0]!
  let bestValue = scenarios[bestScenario]?.realWithdrawal ?? 0

  for (const name of scenarioNames) {
    const value = scenarios[name]?.realWithdrawal ?? 0
    if (value > bestValue) {
      bestValue = value
      bestScenario = name
    }
  }

  return bestScenario
}

const getWinnerClass = (winner: string): string => {
  // Map specific scenario names to colors
  const colorMap: Record<string, string> = {
    ISK: 'text-primary',
    VP: 'text-warning',
  }
  return colorMap[winner] ?? 'text-success'
}

const loadRecord = (record: HistoryRecord) => {
  calculatorStore.loadParameters(record.parameters)
  // Scroll to top to show the loaded parameters
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

const confirmDelete = (recordId: string, event: Event) => {
  historyStore.removeRecord(recordId)
  // Close the popover
  const popover = (event.target as HTMLElement).closest('[popover]') as HTMLElement
  if (popover) popover.hidePopover()
}

const confirmClearAll = (event: Event) => {
  historyStore.clearAll()
  // Close the popover
  const popover = (event.target as HTMLElement).closest('[popover]') as HTMLElement
  if (popover) popover.hidePopover()
}

const positionPopover = (popoverId: string, anchorId: string) => {
  const popover = document.getElementById(popoverId)
  const anchor = document.getElementById(anchorId)

  if (!popover || !anchor) return

  const anchorRect = anchor.getBoundingClientRect()

  // Position below the anchor
  popover.style.position = 'fixed'
  popover.style.top = `${anchorRect.bottom + 4}px`
  popover.style.left = `${anchorRect.left}px`
}
</script>

<template>
  <div class="card mb-4" v-if="records.length > 0">
    <div class="card-header d-flex justify-content-between align-items-center">
      <div>
        <h3>Simuleringshistorik</h3>
        <p class="mb-0 text-muted">
          Tidigare simuleringar ({{ records.length }} st). Värden visar medianresultat.
        </p>
      </div>
      <div>
        <button
          :id="`clear-all-btn-${clearAllPopoverId}`"
          class="btn btn-sm btn-outline-danger"
          :popovertarget="clearAllPopoverId"
        >
          Rensa alla
        </button>
        <div
          :id="clearAllPopoverId"
          popover
          class="confirm-popover-content"
          @beforetoggle="
            (e: any) =>
              e.newState === 'open' &&
              positionPopover(clearAllPopoverId, `clear-all-btn-${clearAllPopoverId}`)
          "
        >
          <p class="mb-2 small">Ta bort alla {{ records.length }} simuleringar?</p>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-danger" @click="confirmClearAll">Ta bort</button>
            <button class="btn btn-sm btn-secondary" :popovertarget="clearAllPopoverId">
              Avbryt
            </button>
          </div>
        </div>
      </div>
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
                  :id="`delete-btn-${record.id}`"
                  class="btn btn-sm btn-link p-0 text-danger"
                  :popovertarget="getDeletePopoverId(record.id)"
                  title="Ta bort"
                >
                  ✕
                </button>
                <div
                  :id="getDeletePopoverId(record.id)"
                  popover
                  class="confirm-popover-content"
                  @beforetoggle="
                    (e: any) =>
                      e.newState === 'open' &&
                      positionPopover(getDeletePopoverId(record.id), `delete-btn-${record.id}`)
                  "
                >
                  <p class="mb-2 small">Ta bort denna simulering?</p>
                  <div class="d-flex gap-2">
                    <button class="btn btn-sm btn-danger" @click="confirmDelete(record.id, $event)">
                      Ta bort
                    </button>
                    <button
                      class="btn btn-sm btn-secondary"
                      :popovertarget="getDeletePopoverId(record.id)"
                    >
                      Avbryt
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="history-card-body">
            <div class="result-summary">
              <strong>Vinnare (reellt uttag):</strong>
              <span :class="['winner-badge', getWinnerClass(getWinner(record))]">
                {{ getWinner(record) }}
              </span>
            </div>
            <div class="parameters-summary">
              <div class="param-row">
                <span class="param-label">Genomsnittligt uttag reellt per år:</span>
                <span class="param-value">
                  <template
                    v-for="(scenarioName, idx) in Object.keys(
                      record.statistics.median.scenarios ?? {},
                    )"
                    :key="scenarioName"
                  >
                    <span v-if="idx > 0">, </span>
                    {{ scenarioName }}
                    {{
                      formatPercent(
                        (record.statistics.median.scenarios?.[scenarioName]
                          ?.accumulatedRealWithdrawal ?? 0) /
                          record.parameters.yearsLater /
                          record.parameters.initialCapital,
                      )
                    }}
                  </template>
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Likvidutveckling:</span>
                <span class="param-value">
                  <template
                    v-for="(scenarioName, idx) in Object.keys(
                      record.statistics.median.scenarios ?? {},
                    )"
                    :key="scenarioName"
                  >
                    <span v-if="idx > 0">, </span>
                    {{ scenarioName }}
                    {{
                      (
                        (record.statistics.median.scenarios?.[scenarioName]?.liquidValue ?? 0) /
                        record.parameters.initialCapital
                      ).toFixed(2)
                    }}x
                  </template>
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Beskattningsgrad:</span>
                <span class="param-value">
                  <template
                    v-for="(scenarioName, idx) in Object.keys(
                      record.statistics.median.scenarios ?? {},
                    )"
                    :key="scenarioName"
                  >
                    <span v-if="idx > 0">, </span>
                    {{ scenarioName }}
                    {{
                      formatPercent(
                        record.statistics.median.scenarios?.[scenarioName]?.taxationDegree,
                      )
                    }}
                  </template>
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Simulering:</span>
                <span class="param-value">
                  {{ record.parameters.yearsLater }} år,
                  {{ formatNumber(record.parameters.simulationCount) }} gånger
                </span>
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

.confirm-popover-content {
  border: 1px solid #dee2e6;
  border-radius: 0.375rem;
  padding: 0.75rem;
  box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.15);
  min-width: 200px;
  margin: 0.5rem 0 0 0;
  inset: unset;
}

.confirm-popover-content::backdrop {
  background: transparent;
}

.confirm-popover-content p {
  margin: 0;
  color: #212529;
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
