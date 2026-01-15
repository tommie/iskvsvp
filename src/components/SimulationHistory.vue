<script setup lang="ts">
import { useHistoryStore } from '../stores/history'
import { storeToRefs } from 'pinia'
import { ref, useId, computed } from 'vue'
import { encodeParamsToUrl } from '../utils/url-params'
import type { HistoryRecord } from '../stores/history'

const historyStore = useHistoryStore()
const { records } = storeToRefs(historyStore)

const COLORS = ['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']

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

// Get the index of the winning scenario based on total value
const getWinnerIndex = (record: HistoryRecord): number => {
  if (!record.results || record.results.statistics.length === 0) return -1

  const finalPeriod = record.results.statistics[0]!.median.snapshots.liquidValue.length - 1

  let bestIdx = 0
  let bestValue = record.results.statistics[0]!.median.snapshots.totalValue[finalPeriod] ?? 0

  for (let i = 1; i < record.results.statistics.length; i++) {
    const value = record.results.statistics[i]!.median.snapshots.totalValue[finalPeriod] ?? 0
    if (value > bestValue) {
      bestValue = value
      bestIdx = i
    }
  }

  return bestIdx
}

// Get the index of the second-best scenario based on total value
const getSecondBestIndex = (record: HistoryRecord): number => {
  if (!record.results || record.results.statistics.length < 2) return -1

  const finalPeriod = record.results.statistics[0]!.median.snapshots.liquidValue.length - 1

  const winnerIdx = getWinnerIndex(record)

  let secondBestIdx = -1
  let secondBestValue = -Infinity

  for (let i = 0; i < record.results.statistics.length; i++) {
    if (i === winnerIdx) continue
    const value = record.results.statistics[i]!.median.snapshots.totalValue[finalPeriod] ?? 0
    if (value > secondBestValue) {
      secondBestValue = value
      secondBestIdx = i
    }
  }

  return secondBestIdx
}

// Get winner label
const getWinnerLabel = (record: HistoryRecord): string => {
  const winnerIdx = getWinnerIndex(record)
  if (winnerIdx === -1) return 'N/A'
  return record.results?.labels[winnerIdx] ?? 'N/A'
}

// Get color for winner
const getWinnerColor = (record: HistoryRecord): string => {
  const winnerIdx = getWinnerIndex(record)
  if (winnerIdx === -1) return '#198754'
  return COLORS[winnerIdx % COLORS.length]!
}

// Get other scenario labels (non-winners)
const getOtherLabels = (record: HistoryRecord): string[] => {
  if (!record.results) return []
  const winnerIdx = getWinnerIndex(record)
  return record.results.labels.filter((_, idx) => idx !== winnerIdx)
}

// Get winner's statistics
const getWinnerStats = (record: HistoryRecord) => {
  const winnerIdx = getWinnerIndex(record)
  if (winnerIdx === -1 || !record.results) return null

  const stats = record.results.statistics[winnerIdx]!
  const finalPeriod = stats.median.snapshots.liquidValue.length - 1

  return {
    totalValue: stats.median.snapshots.totalValue[finalPeriod] ?? 0,
    liquidValue: stats.median.snapshots.liquidValue[finalPeriod] ?? 0,
    accumulatedRealWithdrawal: stats.median.snapshots.withdrawalReal[finalPeriod] ?? 0,
    taxationDegree: stats.median.snapshots.taxationDegree[finalPeriod] ?? 0,
    maxDrawdown: stats.median.snapshots.maxDrawdown[finalPeriod] ?? 0,
  }
}

// Get second-best statistics
const getSecondBestStats = (record: HistoryRecord) => {
  const secondBestIdx = getSecondBestIndex(record)
  if (secondBestIdx === -1 || !record.results) return null

  const stats = record.results.statistics[secondBestIdx]!
  const finalPeriod = stats.median.snapshots.liquidValue.length - 1

  return {
    totalValue: stats.median.snapshots.totalValue[finalPeriod] ?? 0,
    liquidValue: stats.median.snapshots.liquidValue[finalPeriod] ?? 0,
    accumulatedRealWithdrawal: stats.median.snapshots.withdrawalReal[finalPeriod] ?? 0,
    taxationDegree: stats.median.snapshots.taxationDegree[finalPeriod] ?? 0,
    maxDrawdown: stats.median.snapshots.maxDrawdown[finalPeriod] ?? 0,
  }
}

// Calculate percentage difference between winner and second-best
const getPercentDiff = (winnerValue: number, secondBestValue: number): string => {
  if (secondBestValue === 0) return ''
  const diff = ((winnerValue - secondBestValue) / secondBestValue) * 100
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff.toFixed(0)}%`
}

const getRecordQueryParams = (record: HistoryRecord) => {
  return encodeParamsToUrl(record.parameters)
}

const handleLoadRecord = () => {
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
          Tidigare simuleringar ({{ records.length }} st). Värden visar medianresultat för vinnande
          scenario.
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
                <router-link
                  :to="{ path: '/', query: getRecordQueryParams(record) }"
                  class="btn btn-sm btn-link p-0 text-primary"
                  title="Ladda parametrar"
                  @click="handleLoadRecord"
                >
                  ↻
                </router-link>
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
              <strong>Vinnare (totalt värde):</strong>
              <span class="winner-badge" :style="{ color: getWinnerColor(record) }">
                {{ getWinnerLabel(record) }}
              </span>
              <span v-if="getOtherLabels(record).length > 0" class="text-muted small">
                vs {{ getOtherLabels(record).join(', ') }}
              </span>
            </div>
            <div v-if="getWinnerStats(record)" class="parameters-summary">
              <div class="param-row">
                <span class="param-label">Totalt värde:</span>
                <span class="param-value-group">
                  <span class="param-value">
                    {{ formatNumber(getWinnerStats(record)!.totalValue) }} kr
                  </span>
                  <span
                    v-if="getSecondBestStats(record)"
                    class="param-diff"
                    :class="{
                      positive:
                        getWinnerStats(record)!.totalValue > getSecondBestStats(record)!.totalValue,
                      negative:
                        getWinnerStats(record)!.totalValue < getSecondBestStats(record)!.totalValue,
                    }"
                  >
                    {{
                      getPercentDiff(
                        getWinnerStats(record)!.totalValue,
                        getSecondBestStats(record)!.totalValue,
                      )
                    }}
                  </span>
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Genomsnittligt uttag reellt per år:</span>
                <span class="param-value-group">
                  <span class="param-value">
                    {{
                      formatPercent(
                        getWinnerStats(record)!.accumulatedRealWithdrawal /
                          record.parameters.yearsLater /
                          record.parameters.initialCapital,
                      )
                    }}
                  </span>
                  <span
                    v-if="getSecondBestStats(record)"
                    class="param-diff"
                    :class="{
                      positive:
                        getWinnerStats(record)!.accumulatedRealWithdrawal >
                        getSecondBestStats(record)!.accumulatedRealWithdrawal,
                      negative:
                        getWinnerStats(record)!.accumulatedRealWithdrawal <
                        getSecondBestStats(record)!.accumulatedRealWithdrawal,
                    }"
                  >
                    {{
                      getPercentDiff(
                        getWinnerStats(record)!.accumulatedRealWithdrawal,
                        getSecondBestStats(record)!.accumulatedRealWithdrawal,
                      )
                    }}
                  </span>
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Likvidutveckling:</span>
                <span class="param-value-group">
                  <span class="param-value">
                    {{
                      (
                        getWinnerStats(record)!.liquidValue / record.parameters.initialCapital
                      ).toFixed(2)
                    }}x
                  </span>
                  <span
                    v-if="getSecondBestStats(record)"
                    class="param-diff"
                    :class="{
                      positive:
                        getWinnerStats(record)!.liquidValue >
                        getSecondBestStats(record)!.liquidValue,
                      negative:
                        getWinnerStats(record)!.liquidValue <
                        getSecondBestStats(record)!.liquidValue,
                    }"
                  >
                    {{
                      getPercentDiff(
                        getWinnerStats(record)!.liquidValue,
                        getSecondBestStats(record)!.liquidValue,
                      )
                    }}
                  </span>
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Beskattningsgrad:</span>
                <span class="param-value-group">
                  <span class="param-value">
                    {{ formatPercent(getWinnerStats(record)!.taxationDegree) }}
                  </span>
                  <span
                    v-if="getSecondBestStats(record)"
                    class="param-diff"
                    :class="{
                      positive:
                        getWinnerStats(record)!.taxationDegree <
                        getSecondBestStats(record)!.taxationDegree,
                      negative:
                        getWinnerStats(record)!.taxationDegree >
                        getSecondBestStats(record)!.taxationDegree,
                    }"
                  >
                    {{
                      getPercentDiff(
                        getWinnerStats(record)!.taxationDegree,
                        getSecondBestStats(record)!.taxationDegree,
                      )
                    }}
                  </span>
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Maximalt drawdown:</span>
                <span class="param-value-group">
                  <span class="param-value">
                    {{ formatPercent(getWinnerStats(record)!.maxDrawdown) }}
                  </span>
                  <span
                    v-if="getSecondBestStats(record)"
                    class="param-diff"
                    :class="{
                      positive:
                        getWinnerStats(record)!.maxDrawdown <
                        getSecondBestStats(record)!.maxDrawdown,
                      negative:
                        getWinnerStats(record)!.maxDrawdown >
                        getSecondBestStats(record)!.maxDrawdown,
                    }"
                  >
                    {{
                      getPercentDiff(
                        getWinnerStats(record)!.maxDrawdown,
                        getSecondBestStats(record)!.maxDrawdown,
                      )
                    }}
                  </span>
                </span>
              </div>
              <div class="param-row">
                <span class="param-label">Simulering:</span>
                <span class="param-value-group">
                  <span class="param-value">
                    {{ record.parameters.yearsLater }} år,
                    {{ formatNumber(record.parameters.simulationCount) }} gånger
                  </span>
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
  flex-wrap: wrap;
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

.param-value-group {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  justify-content: flex-end;
  min-width: 0;
}

.param-value {
  font-weight: 500;
  text-align: right;
}

.param-diff {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6c757d;
  min-width: 3rem;
  text-align: right;
}

.param-diff.positive {
  color: #198754;
}

.param-diff.negative {
  color: #dc3545;
}
</style>
