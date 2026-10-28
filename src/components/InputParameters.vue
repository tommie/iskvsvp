<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import type { SimulationAsset } from '../types'
import { ASSET_CLASS_PRESETS, assetFromPreset, presetCorrelation } from '../assets'
import { cholesky } from '../returns'
import { spendingMultiplier } from '../simulation'

const store = useCalculatorStore()
const {
  accountType,
  initialCapital,
  assets,
  assetCorrelationMatrix,
  assetRebalanceFrequency,
  depositAmount,
  depositYears,
  ageAdjustedSpending,
  withdrawalNeed,
  withdrawalExtra,
  bequestAmount,
  iskTaxRate,
  iskTaxRateStdDev,
  inflationRate,
  inflationStdDev,
  vpFundTaxRate,
  capitalGainsTax,
  startYear,
  yearsLater,
  isRunning,
  progress,
  isAddToTableMode,
} = storeToRefs(store)

// Import ScenarioParameter type for parameter click handling
import type { ScenarioParameter } from '../types'

// Handle click on input field when in "add to table" mode
function handleParameterClick(paramKey: ScenarioParameter, event: Event) {
  if (!isAddToTableMode.value) return

  // Prevent default input behavior
  event.preventDefault()
  event.stopPropagation()

  // Add parameter to table
  store.addParameterToTable(paramKey)

  // Blur the input to prevent further interaction
  const target = event.target as HTMLInputElement
  target.blur()
}

// Check if parameter is disabled (controlled by table or simulation running)
function isFieldDisabled(paramKey: ScenarioParameter): boolean {
  return isRunning.value || store.isParameterControlled(paramKey)
}

// Get class for input field (add clickable styling when in add-to-table mode)
function getInputClass(paramKey: ScenarioParameter): string {
  const selectKeys = ['accountType']
  const baseClass = selectKeys.includes(paramKey) ? 'form-select' : 'form-control text-end'
  if (isAddToTableMode.value && !store.isParameterControlled(paramKey)) {
    return `${baseClass} clickable-input`
  }
  if (store.isParameterControlled(paramKey)) {
    return `${baseClass} table-controlled`
  }
  return baseClass
}

/**
 * Add an asset to the portfolio, from the catalogue or hand-rolled (no preset).
 * It starts at zero weight so adding it does not move the existing result.
 *
 * Its correlations with the existing assets come from the catalogue when both
 * sides are catalogue entries; anything else gets a visible, editable
 * placeholder rather than an implied independence.
 */
const addAsset = (presetId: string) => {
  const preset = ASSET_CLASS_PRESETS.find((candidate) => candidate.id === presetId)
  const newAsset: SimulationAsset = preset
    ? assetFromPreset(preset, 0)
    : { name: 'Egen tillgång', weight: 0, expectedReturn: 0.03, volatility: 0.1 }

  const toNew = assets.value.map((other) => presetCorrelation(newAsset.presetId, other.presetId))
  const newMatrix = assetCorrelationMatrix.value.map((row, i) => [...row, toNew[i]!])
  newMatrix.push([...toNew, 1])

  assets.value.push(newAsset)
  assetCorrelationMatrix.value = newMatrix
}

/**
 * Remove an asset from the portfolio
 */
const removeAsset = (index: number) => {
  if (assets.value.length <= 1) {
    return // Cannot remove last asset
  }

  assets.value.splice(index, 1)

  // Update correlation matrix - remove row and column
  const n = assets.value.length
  const newMatrix: number[][] = []

  for (let i = 0; i < n + 1; i++) {
    if (i === index) continue
    const newRow: number[] = []
    for (let j = 0; j < n + 1; j++) {
      if (j === index) continue
      newRow.push(assetCorrelationMatrix.value[i]![j]!)
    }
    newMatrix.push(newRow)
  }

  assetCorrelationMatrix.value = newMatrix
}

/**
 * Calculate total weight of all assets
 */
const totalWeight = computed(() => {
  return assets.value.reduce((sum, asset) => sum + asset.weight, 0)
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
    const equalWeight = 1.0 / assets.value.length
    assets.value.forEach((asset) => {
      asset.weight = equalWeight
    })
  } else {
    // Proportional normalization
    assets.value.forEach((asset) => {
      asset.weight = asset.weight / total
    })
  }
}

/**
 * Get correlation value for display (formatted)
 */
const getCorrelation = (i: number, j: number): string => {
  return assetCorrelationMatrix.value[i]?.[j]?.toFixed(2) ?? '0.00'
}

/**
 * Set one correlation, mirrored so the matrix stays symmetric. A new matrix
 * is assigned so the change is seen by the store and the URL.
 */
const setCorrelation = (i: number, j: number, value: number) => {
  if (!Number.isFinite(value)) return
  const clamped = Math.max(-1, Math.min(1, value))
  const next = assetCorrelationMatrix.value.map((row) => [...row])
  next[i]![j] = clamped
  next[j]![i] = clamped
  assetCorrelationMatrix.value = next
}

/**
 * Whether the correlations can describe real assets at all. Typing them by
 * hand makes it easy not to (three assets pairwise at -0.9 cannot exist), and
 * the simulation refuses such a matrix rather than quietly adjusting it.
 */
const correlationError = computed(() => {
  try {
    cholesky(assetCorrelationMatrix.value)
    return null
  } catch {
    return 'Korrelationerna är omöjliga tillsammans. Minska några av dem.'
  }
})

const handleRunSimulation = async () => {
  await store.runSimulation()
}

const getTargetValue = (event: Event) => {
  return parseFloat((event.target as HTMLInputElement)?.value)
}

// The most the rule will pay in the first year, as a share of the capital: the
// need plus the whole extra. What it actually pays is less
// whenever the surplus does not carry the extra.
const maxWithdrawalRate = computed(() => {
  if (initialCapital.value <= 0) return 0
  const multiplier = spendingMultiplier(
    startYear.value + depositYears.value,
    ageAdjustedSpending.value,
  )
  const asked = (withdrawalNeed.value + withdrawalExtra.value) * multiplier
  return asked / initialCapital.value
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
                <label class="form-label">Kontotyp</label>
                <select
                  :class="getInputClass('accountType')"
                  v-model="accountType"
                  :disabled="isFieldDisabled('accountType')"
                  @click="handleParameterClick('accountType', $event)"
                >
                  <option value="ISK">ISK (Investeringssparkonto)</option>
                  <option value="VP">VP (Värdepappersdepå)</option>
                </select>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Initialt kapital</label>
                <input
                  type="number"
                  :class="getInputClass('initialCapital')"
                  v-model.number="initialCapital"
                  :disabled="isFieldDisabled('initialCapital')"
                  @click="handleParameterClick('initialCapital', $event)"
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Arvsmål</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="10000"
                    min="0"
                    :class="getInputClass('bequestAmount')"
                    v-model.number="bequestAmount"
                    :disabled="isFieldDisabled('bequestAmount')"
                    @click="handleParameterClick('bequestAmount', $event)"
                  />
                  <span class="input-group-text">kr</span>
                </div>
                <small class="form-text text-muted">
                  Kapital att lämna kvar vid slutet, i dagens penningvärde. Bara det extra påverkas
                  av det. 0 = förbruka allt.
                </small>
              </div>
            </div>
          </div>

          <!-- Deposit Parameters -->
          <div class="param-section">
            <h5 class="section-title">Insättningar</h5>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <label class="form-label">Årlig insättning</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1000"
                    :class="getInputClass('depositAmount')"
                    v-model.number="depositAmount"
                    :disabled="isFieldDisabled('depositAmount')"
                    @click="handleParameterClick('depositAmount', $event)"
                  />
                  <span class="input-group-text">kr</span>
                </div>
                <small class="form-text text-muted">
                  Belopp som ökas med inflation varje år.
                </small>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Antal år med insättningar</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    :max="yearsLater"
                    :class="getInputClass('depositYears')"
                    v-model.number="depositYears"
                    :disabled="isFieldDisabled('depositYears')"
                    @click="handleParameterClick('depositYears', $event)"
                  />
                  <span class="input-group-text">år</span>
                </div>
                <small class="form-text text-muted"> Efter denna period börjar uttag. </small>
              </div>
            </div>
          </div>

          <!-- Withdrawal -->
          <div class="param-section">
            <h5 class="section-title">Uttag (per år)</h5>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <label class="form-label">Behov</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1000"
                    min="0"
                    :class="getInputClass('withdrawalNeed')"
                    v-model.number="withdrawalNeed"
                    :disabled="isFieldDisabled('withdrawalNeed')"
                    @click="handleParameterClick('withdrawalNeed', $event)"
                  />
                  <span class="input-group-text">kr</span>
                </div>
                <small class="form-text text-muted">
                  Tas ut så länge kapitalet räcker. I dagens penningvärde, räknas upp med inflation.
                </small>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Extra</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1000"
                    min="0"
                    :class="getInputClass('withdrawalExtra')"
                    v-model.number="withdrawalExtra"
                    :disabled="isFieldDisabled('withdrawalExtra')"
                    @click="handleParameterClick('withdrawalExtra', $event)"
                  />
                  <span class="input-group-text">kr</span>
                </div>
                <small class="form-text text-muted">
                  Tas bara ut av det kapital som överstiger vad återstående behov och arvsmål
                  kräver. 0 ger ett fast uttag.
                </small>
              </div>
              <div class="col-12" v-if="withdrawalNeed > 0 || withdrawalExtra > 0">
                <div class="form-check">
                  <input
                    type="checkbox"
                    class="form-check-input"
                    id="ageAdjustedSpending"
                    v-model="ageAdjustedSpending"
                    :disabled="isRunning"
                  />
                  <label class="form-check-label" for="ageAdjustedSpending">
                    Åldersjusterat uttag
                  </label>
                </div>
                <small class="form-text text-muted">
                  Justerar behov och extra efter åldersbaserad utgiftskurva (topp vid 45–50,
                  avtagande till ~65% vid 80+). Baserat på Eurostat HBS.
                </small>
              </div>
              <div class="col-12">
                <label class="form-label">Högsta uttagsgrad</label>
                <div class="input-group">
                  <input
                    type="text"
                    class="form-control text-end"
                    :value="(maxWithdrawalRate * 100).toFixed(1)"
                    readonly
                    disabled
                  />
                  <span class="input-group-text">%</span>
                </div>
                <small class="form-text text-muted">
                  Behov och extra i första året, i procent av startkapitalet.
                </small>
              </div>
            </div>
          </div>
        </div>

        <div class="params-column">
          <!-- Portfolio Assets -->
          <div class="param-section">
            <h5 class="section-title">Portfölj</h5>

            <div class="table-responsive">
              <table class="table table-sm portfolio-table">
                <thead>
                  <tr>
                    <th>Namn</th>
                    <th
                      class="text-end"
                      title="Förväntad real avkastning per år (aritmetiskt medel)"
                    >
                      Real avk. (%)
                    </th>
                    <th class="text-end">Stdavv (%)</th>
                    <th class="text-end">Vikt (%)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(asset, index) in assets" :key="index">
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
                        min="0"
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
                        :class="
                          'form-control-sm text-end ' + getInputClass(`assets.weight.${index}`)
                        "
                        :value="(asset.weight * 100).toFixed(1)"
                        @change="asset.weight = getTargetValue($event) / 100"
                        @click="handleParameterClick(`assets.weight.${index}`, $event)"
                        :disabled="isFieldDisabled(`assets.weight.${index}`)"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-danger"
                        @click="removeAsset(index)"
                        :disabled="isRunning || assets.length <= 1"
                        title="Ta bort tillgång"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="3" class="text-end fw-bold">Total vikt:</td>
                    <td class="text-end fw-bold" :class="{ 'text-danger': !weightsValid }">
                      {{ (totalWeight * 100).toFixed(1) }}%
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <select
              class="form-select form-select-sm d-inline-block w-auto"
              :disabled="isRunning"
              aria-label="Lägg till tillgång"
              @change="
                (event) => {
                  const select = event.target as HTMLSelectElement
                  if (select.value) addAsset(select.value)
                  select.value = ''
                }
              "
            >
              <option value="">+ Lägg till tillgång…</option>
              <option v-for="preset in ASSET_CLASS_PRESETS" :key="preset.id" :value="preset.id">
                {{ preset.name }}
              </option>
              <option value="custom">Egen tillgång</option>
            </select>
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

            <div v-if="assets.length > 1" class="mt-3">
              <label class="form-label">Ombalansering</label>
              <select
                class="form-select form-select-sm"
                :class="{
                  'table-controlled': store.isParameterControlled('assetRebalanceFrequency'),
                  'clickable-input':
                    isAddToTableMode && !store.isParameterControlled('assetRebalanceFrequency'),
                }"
                v-model="assetRebalanceFrequency"
                :disabled="isFieldDisabled('assetRebalanceFrequency')"
                @click="handleParameterClick('assetRebalanceFrequency', $event)"
              >
                <option value="never">Aldrig</option>
                <option value="annually">Årligen</option>
              </select>
            </div>

            <div v-if="assets.length > 1" class="mt-3">
              <label class="form-label">Korrelationsmatris</label>
              <small class="form-text text-muted d-block mb-1">
                Mellan tillgångarnas reala avkastning. Startvärdena är riktvärden och kan ändras.
              </small>
              <div class="table-responsive">
                <table class="table table-sm table-striped correlation-matrix-table">
                  <tbody>
                    <tr v-for="(assetRow, i) in assets" :key="i">
                      <td
                        v-for="(_assetCol, j) in assets.slice(0, i + 1)"
                        :key="j"
                        :class="{
                          'diagonal-cell': i === j,
                          'lower-triangle': i > j,
                          'last-column': j === assets.length - 1,
                        }"
                        :colspan="i === j ? assets.length - i : undefined"
                      >
                        <span v-if="i === j" class="asset-name" :title="assetRow.name">
                          {{ assetRow.name }}
                        </span>
                        <input
                          v-else-if="i > j"
                          type="number"
                          step="0.05"
                          min="-1"
                          max="1"
                          class="form-control form-control-sm text-center"
                          :value="getCorrelation(i, j)"
                          @change="setCorrelation(i, j, getTargetValue($event))"
                          :disabled="isRunning"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="correlationError" class="alert alert-danger mt-2 mb-0 py-2">
                <small>{{ correlationError }}</small>
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
                    :class="getInputClass('inflationRate')"
                    :value="(inflationRate * 100).toFixed(1)"
                    @change="inflationRate = getTargetValue($event) / 100"
                    :disabled="isFieldDisabled('inflationRate')"
                    @click="handleParameterClick('inflationRate', $event)"
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
                    :class="getInputClass('inflationStdDev')"
                    :value="(inflationStdDev * 100).toFixed(1)"
                    @change="inflationStdDev = getTargetValue($event) / 100"
                    :disabled="isFieldDisabled('inflationStdDev')"
                    @click="handleParameterClick('inflationStdDev', $event)"
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
              <div class="col-12 col-md-6">
                <label class="form-label">Vinstskatt</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    :class="getInputClass('capitalGainsTaxRate')"
                    :value="(capitalGainsTax * 100).toFixed(1)"
                    @change="capitalGainsTax = getTargetValue($event) / 100"
                    :disabled="isFieldDisabled('capitalGainsTaxRate')"
                    @click="handleParameterClick('capitalGainsTaxRate', $event)"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Fondskatt VP</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.01"
                    :class="getInputClass('vpWealthTaxRate')"
                    :value="(vpFundTaxRate * 100).toFixed(2)"
                    @change="vpFundTaxRate = getTargetValue($event) / 100"
                    :disabled="isFieldDisabled('vpWealthTaxRate')"
                    @click="handleParameterClick('vpWealthTaxRate', $event)"
                  />
                  <span class="input-group-text">%</span>
                </div>
                <small class="form-text text-muted"
                  >Andel av fondvärdet som beskattas årligen.</small
                >
              </div>
              <template v-if="accountType === 'ISK'">
                <div class="col-12 col-md-6">
                  <label class="form-label">Schabloninkomstsats</label>
                  <div class="input-group">
                    <input
                      type="number"
                      step="0.01"
                      :class="getInputClass('iskTaxRate')"
                      :value="(iskTaxRate! * 100).toFixed(2)"
                      @change="iskTaxRate = getTargetValue($event) / 100"
                      :disabled="isFieldDisabled('iskTaxRate')"
                      @click="handleParameterClick('iskTaxRate', $event)"
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
                      :class="getInputClass('iskTaxRateStdDev')"
                      :value="(iskTaxRateStdDev! * 100).toFixed(2)"
                      @change="iskTaxRateStdDev = getTargetValue($event) / 100"
                      :disabled="isFieldDisabled('iskTaxRateStdDev')"
                      @click="handleParameterClick('iskTaxRateStdDev', $event)"
                    />
                    <span class="input-group-text">%</span>
                  </div>
                  <small class="form-text text-muted"
                    >För årlig förändring av schabloninkomstsats.</small
                  >
                </div>
              </template>
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
                  :class="getInputClass('startYear')"
                  v-model.number="startYear"
                  :disabled="isFieldDisabled('startYear')"
                  @click="handleParameterClick('startYear', $event)"
                />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Antal år</label>
                <div class="input-group">
                  <input
                    type="number"
                    :class="getInputClass('yearsLater')"
                    v-model.number="yearsLater"
                    min="1"
                    max="100"
                    :disabled="isFieldDisabled('yearsLater')"
                    @click="handleParameterClick('yearsLater', $event)"
                  />
                  <span class="input-group-text">år</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4 d-flex align-items-center gap-2">
        <button
          class="btn btn-primary btn-lg"
          @click="handleRunSimulation"
          :disabled="isRunning || !!correlationError"
        >
          <span v-if="isRunning" class="spinner-border spinner-border-sm me-2"></span>
          <span v-else class="me-2">⏵</span>
          Kör simulering
        </button>

        <div class="ms-3">
          <slot name="actions"></slot>
        </div>

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
  margin-bottom: 1rem;
  padding: 0.5rem;
  background-color: var(--bs-primary-bg-subtle);
  border-bottom: 2px solid var(--bs-primary);
  border-top-left-radius: 0.5rem;
  border-top-right-radius: 0.5rem;
}

.portfolio-table {
  margin-bottom: 0.5rem;
}

.portfolio-table thead th {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--bs-secondary-color);
  border-bottom: 2px solid var(--bs-border-color);
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

.correlation-matrix-table .asset-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
}

.correlation-matrix-table .lower-triangle input {
  font-size: 0.875rem;
  width: 100%;
}

.correlation-matrix-table .diagonal-cell {
  font-weight: 500;
  padding: 0.5rem 0.25rem;
}

/* Scenario table styling */
.clickable-input {
  cursor: pointer;
  border-color: var(--bs-primary) !important;
  background-color: var(--bs-primary-bg-subtle) !important;
}

.clickable-input:hover {
  border-color: var(--bs-primary-border-subtle) !important;
  background-color: var(--bs-primary-bg-subtle) !important;
  filter: brightness(0.9);
}

.table-controlled {
  background-color: var(--bs-tertiary-bg) !important;
  cursor: not-allowed;
}
</style>
