<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, computed } from 'vue'
import type { PortfolioAsset } from '../types'

const store = useCalculatorStore()
const {
  initialCapital,
  portfolio,
  balanceWithdrawalRate,
  profitWithdrawalRate,
  profitLookbackYears,
  iskTaxRate,
  iskTaxRateStdDev,
  inflationRate,
  inflationStdDev,
  capitalGainsTax,
  startYear,
  yearsLater,
  simulationCount,
  isRunning,
  progress,
} = storeToRefs(store)

const rorPreset = ref('')
const selectedAssetIndex = ref(0)

interface RORPreset {
  label: string
  mean: number
  stdDev: number
}

const rorPresets: RORPreset[] = [
  { label: 'AMF Aktiefond Europa', mean: 0.077744, stdDev: 0.192562 },
  { label: 'AMF Räntefond Lång', mean: 0.038397, stdDev: 0.043541 },
  { label: 'Carnegie Småbolagsfond A', mean: 0.177747, stdDev: 0.195878 },
  { label: 'Carnegie Sverigefond A', mean: 0.1446, stdDev: 0.2283 },
  { label: 'Handelsbanken Nordiska Småb (A1 SEK)', mean: 0.154126, stdDev: 0.30111 },
  { label: 'Länsförsäkringar Fastighetsfond A', mean: 0.184636, stdDev: 0.282252 },
  { label: 'Länsförsäkringar Lång Räntefond A', mean: 0.044307, stdDev: 0.05498 },
  { label: 'Storebrand USA A SEK', mean: 0.090752, stdDev: 0.168028 },
  { label: 'Swedbank Robur Access Europa A', mean: 0.06943, stdDev: 0.146178 },
  { label: 'Swedbank Robur Europafond A', mean: 0.085581, stdDev: 0.17472 },
  { label: 'Swedbank Robur Globalfond A', mean: 0.1299, stdDev: 0.202 },
]

/**
 * Get the next available fund name (Fond 1, Fond 2, etc.)
 */
const getNextFundName = (): string => {
  const usedNumbers = new Set<number>()

  portfolio.value.assets.forEach((asset) => {
    const match = asset.name.match(/^Fond (\d+)$/)
    if (match) {
      usedNumbers.add(parseInt(match[1]!))
    }
  })

  let nextNumber = 1
  while (usedNumbers.has(nextNumber)) {
    nextNumber++
  }

  return `Fond ${nextNumber}`
}

/**
 * Add a new asset to the portfolio
 */
const addAsset = () => {
  const newAsset: PortfolioAsset = {
    name: getNextFundName(),
    weight: 0,
    expectedReturn: 0.1,
    volatility: 0.2,
  }

  portfolio.value.assets.push(newAsset)

  // Update correlation matrix - add new row and column with identity correlations
  const n = portfolio.value.assets.length
  const newMatrix: number[][] = []

  for (let i = 0; i < n; i++) {
    newMatrix[i] = []
    for (let j = 0; j < n; j++) {
      if (i === n - 1 || j === n - 1) {
        // New asset: 1.0 on diagonal, 0.5 for off-diagonal (moderate correlation)
        newMatrix[i]![j] = i === j ? 1.0 : 0.5
      } else {
        // Copy existing correlations
        newMatrix[i]![j] = portfolio.value.correlationMatrix[i]![j]!
      }
    }
  }

  portfolio.value.correlationMatrix = newMatrix
}

/**
 * Remove an asset from the portfolio
 */
const removeAsset = (index: number) => {
  if (portfolio.value.assets.length <= 1) {
    return // Cannot remove last asset
  }

  portfolio.value.assets.splice(index, 1)

  // Update correlation matrix - remove row and column
  const n = portfolio.value.assets.length
  const newMatrix: number[][] = []

  for (let i = 0; i < n + 1; i++) {
    if (i === index) continue
    const newRow: number[] = []
    for (let j = 0; j < n + 1; j++) {
      if (j === index) continue
      newRow.push(portfolio.value.correlationMatrix[i]![j]!)
    }
    newMatrix.push(newRow)
  }

  portfolio.value.correlationMatrix = newMatrix

  // Adjust selected asset index if needed
  if (selectedAssetIndex.value >= portfolio.value.assets.length) {
    selectedAssetIndex.value = portfolio.value.assets.length - 1
  }
}

/**
 * Apply preset to selected asset
 */
const applyRORPreset = () => {
  const preset = rorPresets.find((p) => p.label === rorPreset.value)
  if (preset && portfolio.value.assets[selectedAssetIndex.value]) {
    portfolio.value.assets[selectedAssetIndex.value]!.name = preset.label
    portfolio.value.assets[selectedAssetIndex.value]!.expectedReturn = preset.mean
    portfolio.value.assets[selectedAssetIndex.value]!.volatility = preset.stdDev
  }
}

/**
 * Calculate total weight of all assets
 */
const totalWeight = computed(() => {
  return portfolio.value.assets.reduce((sum, asset) => sum + asset.weight, 0)
})

/**
 * Check if weights are valid (sum to approximately 1.0)
 */
const weightsValid = computed(() => {
  return Math.abs(totalWeight.value - 1.0) < 0.001
})

/**
 * Normalize weights to sum to 100%
 */
const normalizeWeights = () => {
  const total = totalWeight.value
  if (total === 0) {
    // Equal distribution if all weights are zero
    const equalWeight = 1.0 / portfolio.value.assets.length
    portfolio.value.assets.forEach((asset) => {
      asset.weight = equalWeight
    })
  } else {
    // Proportional normalization
    portfolio.value.assets.forEach((asset) => {
      asset.weight = asset.weight / total
    })
  }
}

/**
 * Calculate expected portfolio return (weighted average)
 */
const expectedPortfolioReturn = computed(() => {
  return portfolio.value.assets.reduce((sum, asset) => sum + asset.weight * asset.expectedReturn, 0)
})

/**
 * Update a correlation matrix cell
 */
const updateCorrelation = (i: number, j: number, value: string) => {
  const numValue = parseFloat(value)

  if (isNaN(numValue) || numValue < -1 || numValue > 1) {
    return
  }

  // Update both symmetric positions
  portfolio.value.correlationMatrix[i]![j] = numValue
  portfolio.value.correlationMatrix[j]![i] = numValue
}

/**
 * Get correlation value for display (formatted)
 */
const getCorrelation = (i: number, j: number): string => {
  return portfolio.value.correlationMatrix[i]?.[j]?.toFixed(2) ?? '0.00'
}

const handleRunSimulation = async () => {
  await store.runSimulation()
}

const getTargetValue = (event: Event) => {
  return parseFloat((event.target as HTMLInputElement)?.value)
}

const expectedTotalWithdrawalRate = computed(() => {
  const b = balanceWithdrawalRate.value
  const p = profitWithdrawalRate.value
  const d = expectedPortfolioReturn.value
  const n = profitLookbackYears.value

  // Balance-based component
  const balanceComponent = b

  // Profit-based component (steady state approximation)
  // Net growth rate after balance withdrawals
  const netGrowth = d - b

  // Growth factor over lookback period with net growth
  // [(1 + netGrowth)^n - 1] / [n × (1 + netGrowth)^n]
  const growthFactor = Math.pow(1 + netGrowth, n)
  const profitComponent = (p * (growthFactor - 1)) / (n * growthFactor)

  return balanceComponent + profitComponent
})
</script>

<template>
  <div class="card mb-4">
    <div class="card-header">
      <h3>Parametrar</h3>
    </div>
    <div class="card-body">
      <div class="params-grid">
        <div class="params-column">
          <!-- Basic Parameters -->
          <div class="param-section">
            <h5 class="section-title">Grundinställningar</h5>
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Initialt kapital</label>
                <input
                  type="number"
                  class="form-control text-end"
                  v-model.number="initialCapital"
                  :disabled="isRunning"
                />
              </div>
            </div>
          </div>

          <!-- Withdrawal Rates -->
          <div class="param-section">
            <h5 class="section-title">Uttag (per år)</h5>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <label class="form-label">Värdebaserad uttagsgrad</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(balanceWithdrawalRate * 100).toFixed(1)"
                    @change="balanceWithdrawalRate = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Förväntad total uttagsgrad</label>
                <div class="input-group">
                  <input
                    type="text"
                    class="form-control text-end"
                    :value="(expectedTotalWithdrawalRate * 100).toFixed(1)"
                    readonly
                    disabled
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Vinstbaserad uttagsgrad</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(profitWithdrawalRate * 100).toFixed(1)"
                    @change="profitWithdrawalRate = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Lookback-period (vinst)</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1"
                    class="form-control text-end"
                    :value="profitLookbackYears"
                    @change="profitLookbackYears = getTargetValue($event)"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">år</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="params-column">
          <!-- Portfolio Assets -->
          <div class="param-section">
            <h5 class="section-title">Portfölj</h5>

            <div class="mb-3">
              <label class="form-label">Förinställning för vald fond</label>
              <div class="input-group">
                <select
                  class="form-select"
                  v-model="rorPreset"
                  @change="applyRORPreset"
                  :disabled="isRunning"
                >
                  <option value="">-- Välj fond --</option>
                  <option v-for="preset in rorPresets" :key="preset.label" :value="preset.label">
                    {{ preset.label }}
                  </option>
                </select>
              </div>
            </div>

            <div class="table-responsive">
              <table class="table table-sm portfolio-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Namn</th>
                    <th class="text-end">Medelvärde (%)</th>
                    <th class="text-end">Stdavv (%)</th>
                    <th class="text-end">Vikt (%)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(asset, index) in portfolio.assets"
                    :key="index"
                    :class="{ 'table-active': index === selectedAssetIndex }"
                  >
                    <td>
                      <input
                        type="radio"
                        :value="index"
                        v-model="selectedAssetIndex"
                        :disabled="isRunning"
                        class="form-check-input"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        class="form-control form-control-sm"
                        v-model="asset.name"
                        :disabled="isRunning"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        class="form-control form-control-sm text-end"
                        :value="(asset.expectedReturn * 100).toFixed(1)"
                        @change="asset.expectedReturn = getTargetValue($event) / 100"
                        :disabled="isRunning"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        class="form-control form-control-sm text-end"
                        :value="(asset.volatility * 100).toFixed(1)"
                        @change="asset.volatility = getTargetValue($event) / 100"
                        :disabled="isRunning"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        class="form-control form-control-sm text-end"
                        :value="(asset.weight * 100).toFixed(1)"
                        @change="asset.weight = getTargetValue($event) / 100"
                        :disabled="isRunning"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-danger"
                        @click="removeAsset(index)"
                        :disabled="isRunning || portfolio.assets.length <= 1"
                        title="Ta bort fond"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="4" class="text-end fw-bold">Total vikt:</td>
                    <td class="text-end fw-bold" :class="{ 'text-danger': !weightsValid }">
                      {{ (totalWeight * 100).toFixed(1) }}%
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <button
              type="button"
              class="btn btn-sm btn-outline-primary"
              @click="addAsset"
              :disabled="isRunning"
            >
              + Lägg till fond
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary ms-2"
              @click="normalizeWeights"
              :disabled="isRunning || weightsValid"
              title="Normalisera vikter till 100%"
            >
              Normalisera
            </button>

            <div v-if="!weightsValid" class="alert alert-warning mt-2 mb-0 py-2">
              <small>⚠️ Vikterna måste summera till 100%</small>
            </div>

            <div v-if="portfolio.assets.length > 1" class="mt-3">
              <label class="form-label">Korrelationsmatris</label>
              <div class="table-responsive">
                <table class="table table-sm correlation-matrix-table">
                  <tbody>
                    <tr v-for="(assetRow, i) in portfolio.assets" :key="i">
                      <td
                        v-for="(assetCol, j) in portfolio.assets"
                        :key="j"
                        :class="{
                          'diagonal-cell': i === j,
                          'lower-triangle': i > j,
                          'upper-triangle': i < j,
                          'last-column': j === portfolio.assets.length - 1,
                        }"
                      >
                        <span v-if="i === j" class="asset-name" :title="assetRow.name">
                          {{ assetRow.name }}
                        </span>
                        <input
                          v-else-if="i > j"
                          type="number"
                          step="0.01"
                          min="-1"
                          max="1"
                          class="form-control form-control-sm text-center"
                          :value="getCorrelation(i, j)"
                          @change="
                            updateCorrelation(i, j, ($event.target as HTMLInputElement).value)
                          "
                          :disabled="isRunning"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <small class="form-text text-muted"> Korrelationer mellan -1 och 1. </small>
            </div>
          </div>

          <!-- Time Period and Simulation Settings -->
          <div class="param-section">
            <h5 class="section-title">Simulering</h5>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <label class="form-label">Startår (ålder)</label>
                <input
                  type="number"
                  class="form-control text-end"
                  v-model.number="startYear"
                  :disabled="isRunning"
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Antal år</label>
                <div class="input-group">
                  <input
                    type="number"
                    class="form-control text-end"
                    v-model.number="yearsLater"
                    min="1"
                    max="100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">år</span>
                </div>
              </div>
              <div class="col-12">
                <label class="form-label">Antal simuleringar</label>
                <input
                  type="number"
                  class="form-control text-end"
                  v-model.number="simulationCount"
                  min="100"
                  max="100000"
                  step="100"
                  :disabled="isRunning"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="params-column">
          <!-- Inflation Distribution -->
          <div class="param-section">
            <h5 class="section-title">Inflation (per år)</h5>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <label class="form-label">Medelvärde</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(inflationRate * 100).toFixed(1)"
                    @change="inflationRate = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Standardavvikelse</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(inflationStdDev * 100).toFixed(1)"
                    @change="inflationStdDev = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Tax Rate Distribution -->
          <div class="param-section">
            <h5 class="section-title">Skatt</h5>
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Vinstskatt</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(capitalGainsTax * 100).toFixed(1)"
                    @change="capitalGainsTax = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Schablonskattesats</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.01"
                    class="form-control text-end"
                    :value="(iskTaxRate * 100).toFixed(2)"
                    @change="iskTaxRate = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
                <small class="form-text text-muted">Första året.</small>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Standardavvikelse (ISK)</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.01"
                    class="form-control text-end"
                    :value="(iskTaxRateStdDev * 100).toFixed(2)"
                    @change="iskTaxRateStdDev = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
                <small class="form-text text-muted">För årlig förändring av schablonskatt.</small>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4 d-flex align-items-center">
        <button class="btn btn-primary btn-lg" @click="handleRunSimulation" :disabled="isRunning">
          <span v-if="isRunning" class="spinner-border spinner-border-sm me-2"></span>
          <span v-else class="me-2">⏵</span>
          Kör simulering
        </button>

        <div
          v-if="isRunning"
          class="progress flex-grow-1 ms-2"
          role="progressbar"
          :aria-valuenow="progress"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="progress-bar progress-bar-striped progress-bar-animated"
            :style="{ width: Math.round(progress) + '%' }"
          >
            {{ Math.round(progress) }}%
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-label {
  font-weight: 500;
  font-size: 0.9rem;
}

.params-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
}

@media (min-width: 768px) {
  .params-grid {
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }
}

@media (min-width: 1200px) {
  .params-grid {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 2rem;
  }
}

.params-column {
  display: flex;
  flex-direction: column;
}

.param-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1.5rem;
}

.param-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: #495057;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #e9ecef;
}

.portfolio-table {
  margin-bottom: 0.5rem;
}

.portfolio-table thead th {
  font-size: 0.85rem;
  font-weight: 600;
  color: #6c757d;
  border-bottom: 2px solid #dee2e6;
  padding: 0.5rem 0.25rem;
}

.portfolio-table tbody td {
  padding: 0.25rem;
  vertical-align: middle;
}

.portfolio-table input[type='text'],
.portfolio-table input[type='number'] {
  font-size: 0.875rem;
}

.portfolio-table .form-check-input {
  cursor: pointer;
}

.portfolio-table .table-active {
  background-color: rgba(13, 110, 253, 0.05);
}

.correlation-matrix-table {
  margin-bottom: 0.5rem;
  table-layout: fixed;
  width: 100%;
}

.correlation-matrix-table td {
  padding: 0.25rem;
  vertical-align: middle;
  width: 80px;
}

.correlation-matrix-table td.last-column {
  width: auto;
}

.correlation-matrix-table .diagonal-cell {
  background-color: #f8f9fa;
  font-weight: 500;
  padding: 0.5rem 0.25rem;
}

.correlation-matrix-table .asset-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
}

.correlation-matrix-table .upper-triangle {
  background-color: #f8f9fa;
}

.correlation-matrix-table .lower-triangle input {
  font-size: 0.875rem;
  width: 100%;
}
</style>
