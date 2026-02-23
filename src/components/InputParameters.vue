<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, computed, onMounted, watch } from 'vue'
import type { SimulationAsset } from '../types'
import FundPresetSelector from './FundPresetSelector.vue'
import { loadBootstrapData, getCommonDateRange, filterProfilesByDateRange } from '../bootstrap'
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
  balanceWithdrawalRate,
  profitWithdrawalRate,
  profitLookbackYears,
  inflationBasedWithdrawal,
  amortizedWithdrawal,
  bequestGoal,
  ageAdjustedSpending,
  iskTaxRate,
  iskTaxRateStdDev,
  inflationRate,
  inflationStdDev,
  vpFundTaxRate,
  capitalGainsTax,
  startYear,
  yearsLater,
  simulationCount,
  simulationMethod,
  bootstrapProfileId,
  bootstrapWarning,
  bootstrapProfileList,
  stressPresetId,
  stressWarning,
  stressPresetList,
  isRunning,
  progress,
  isAddToTableMode,
} = storeToRefs(store)

onMounted(() => {
  store.initBootstrapData()
  store.initStressPresets()
})

// Disable bootstrap profiles whose events fall outside the fund data range
const disabledProfileIds = ref(new Set<string>())
watch(
  [assets, bootstrapProfileList],
  async () => {
    if (bootstrapProfileList.value.length === 0) return
    const assetNames = assets.value.map((a) => a.name)
    try {
      const { fundsDb } = await loadBootstrapData()
      const range = getCommonDateRange(assetNames, fundsDb)
      if (range) {
        const available = new Set(
          filterProfilesByDateRange(bootstrapProfileList.value, range.startDate, range.nMonths)
            .map((p) => p.id),
        )
        disabledProfileIds.value = new Set(
          bootstrapProfileList.value.filter((p) => !available.has(p.id)).map((p) => p.id),
        )
      } else {
        disabledProfileIds.value = new Set()
      }
    } catch {
      disabledProfileIds.value = new Set()
    }
  },
  { deep: true, immediate: true },
)

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
  const selectKeys = ['accountType', 'bootstrapProfileId', 'simulationMethod', 'stressPresetId']
  const baseClass = selectKeys.includes(paramKey)
    ? 'form-select'
    : 'form-control text-end'
  if (isAddToTableMode.value && !store.isParameterControlled(paramKey)) {
    return `${baseClass} clickable-input`
  }
  if (store.isParameterControlled(paramKey)) {
    return `${baseClass} table-controlled`
  }
  return baseClass
}

const selectedAssetIndex = ref(0)
const fundPresetSelector = ref<InstanceType<typeof FundPresetSelector> | null>(null)

/**
 * Get the next available fund name (Fond 1, Fond 2, etc.)
 */
const getNextFundName = (): string => {
  const usedNumbers = new Set<number>()

  assets.value.forEach((asset) => {
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
  const newAsset: SimulationAsset = {
    name: getNextFundName(),
    weight: 0,
    expectedReturn: 0.1,
    volatility: 0.2,
  }

  assets.value.push(newAsset)

  // Update correlation matrix - add new row and column with identity correlations
  const n = assets.value.length
  const newMatrix: number[][] = []

  for (let i = 0; i < n; i++) {
    newMatrix[i] = []
    for (let j = 0; j < n; j++) {
      if (i === n - 1 || j === n - 1) {
        // New asset: 1.0 on diagonal, 0.5 for off-diagonal (moderate correlation)
        newMatrix[i]![j] = i === j ? 1.0 : 0.5
      } else {
        // Copy existing correlations
        newMatrix[i]![j] = assetCorrelationMatrix.value[i]![j]!
      }
    }
  }

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

  // Adjust selected asset index if needed
  if (selectedAssetIndex.value >= assets.value.length) {
    selectedAssetIndex.value = assets.value.length - 1
  }
}

/**
 * Apply preset to selected asset
 */
const applyFundPreset = (payload: {
  fund: { name: string; mu: number; sigma: number }
  index: number
  correlations: number[]
}) => {
  const asset = assets.value[selectedAssetIndex.value]
  if (!asset) return

  // Update asset properties
  asset.name = payload.fund.name
  asset.expectedReturn = payload.fund.mu / 100 // Convert from percentage to decimal
  asset.volatility = payload.fund.sigma / 100 // Convert from percentage to decimal

  // Update correlation matrix for this asset
  updateCorrelationsForAsset(selectedAssetIndex.value)
}

/**
 * Update correlation matrix for a specific asset by looking up fund names in database
 */
const updateCorrelationsForAsset = (assetIndex: number) => {
  if (!fundPresetSelector.value) return

  const asset = assets.value[assetIndex]
  if (!asset) return

  const fundIndex = fundPresetSelector.value.getFundIndexByName(asset.name)
  if (fundIndex === undefined) return // Asset not in database

  const n = assets.value.length

  // Create a new matrix to ensure reactivity
  const newMatrix: number[][] = []

  for (let i = 0; i < n; i++) {
    newMatrix[i] = []
    for (let j = 0; j < n; j++) {
      if (i === j) {
        // Diagonal is always 1
        newMatrix[i]![j] = 1.0
      } else if (i === assetIndex || j === assetIndex) {
        // Row or column of the updated asset - look up correlation by name
        const otherIdx = i === assetIndex ? j : i
        const otherAsset = assets.value[otherIdx]!
        const otherFundIndex = fundPresetSelector.value!.getFundIndexByName(otherAsset.name)

        if (otherFundIndex !== undefined) {
          // Both assets are in database - use database correlation
          newMatrix[i]![j] = fundPresetSelector.value!.getCorrelation(fundIndex, otherFundIndex)
        } else {
          // Other asset not in database - use moderate default
          newMatrix[i]![j] = 0.5
        }
      } else {
        // Copy existing correlation
        newMatrix[i]![j] = assetCorrelationMatrix.value[i]?.[j] ?? 0.5
      }
    }
  }

  assetCorrelationMatrix.value = newMatrix
}

/**
 * Called when fund database is loaded - update correlations for all assets that match fund names
 */
const onFundDatabaseLoaded = () => {
  if (!fundPresetSelector.value) return

  // Check if any assets match database funds and update all correlations
  const n = assets.value.length
  const newMatrix: number[][] = []

  for (let i = 0; i < n; i++) {
    newMatrix[i] = []
    const fundIndexI = fundPresetSelector.value.getFundIndexByName(assets.value[i]!.name)

    for (let j = 0; j < n; j++) {
      if (i === j) {
        newMatrix[i]![j] = 1.0
      } else if (fundIndexI !== undefined) {
        const fundIndexJ = fundPresetSelector.value.getFundIndexByName(assets.value[j]!.name)
        if (fundIndexJ !== undefined) {
          // Both assets in database
          newMatrix[i]![j] = fundPresetSelector.value.getCorrelation(fundIndexI, fundIndexJ)
        } else {
          // Keep existing or use default
          newMatrix[i]![j] = assetCorrelationMatrix.value[i]?.[j] ?? 0.5
        }
      } else {
        // Keep existing or use default
        newMatrix[i]![j] = assetCorrelationMatrix.value[i]?.[j] ?? 0.5
      }
    }
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

const handleRunSimulation = async () => {
  await store.runSimulation()
}

const getTargetValue = (event: Event) => {
  return parseFloat((event.target as HTMLInputElement)?.value)
}

const expectedTotalWithdrawalRate = computed(() => {
  if (amortizedWithdrawal.value) {
    // Approximate first-year PMT rate using parametric expected returns.
    // The actual simulation uses bootstrap empirical returns with additional
    // corrections (volatility drag, post-tax FV targeting, PV timing).
    const withdrawalYears = yearsLater.value - depositYears.value
    if (withdrawalYears <= 0 || initialCapital.value <= 0) return 0
    const nominalReturn =
      assets.value.reduce((sum, asset) => sum + asset.weight * asset.expectedReturn, 0)
    const taxDrag =
      accountType.value === 'ISK'
        ? (iskTaxRate.value ?? 0) * capitalGainsTax.value
        : vpFundTaxRate.value * capitalGainsTax.value
    const r = nominalReturn - inflationRate.value - taxDrag
    const fv = bequestGoal.value * initialCapital.value
    let amortized: number
    if (Math.abs(r) < 1e-10) {
      amortized = (initialCapital.value - fv) / withdrawalYears
    } else {
      const disc = Math.pow(1 + r, -withdrawalYears)
      amortized = (r * (initialCapital.value - fv * disc)) / (1 - disc)
    }
    const floor = inflationBasedWithdrawal.value
    const withdrawal = Math.max(floor, amortized)
    return withdrawal / initialCapital.value
  }

  const b = balanceWithdrawalRate.value
  const p = profitWithdrawalRate.value
  // Use weighted average of fund database expected returns as growth estimate.
  const d = assets.value.reduce((sum, asset) => sum + asset.weight * asset.expectedReturn, 0)
  const n = profitLookbackYears.value

  // Age-adjusted scaling: the input rate is the average over the withdrawal
  // period; the first-year rate is higher when starting near peak spending age.
  let ageScale = 1
  if (ageAdjustedSpending.value) {
    const withdrawalYears = yearsLater.value - depositYears.value
    if (withdrawalYears > 0) {
      let sum = 0
      for (let t = 0; t < withdrawalYears; t++) {
        sum += spendingMultiplier(startYear.value + depositYears.value + t, true)
      }
      const avg = sum / withdrawalYears
      const firstYear = spendingMultiplier(startYear.value + depositYears.value, true)
      ageScale = avg > 0 ? firstYear / avg : 1
    }
  }

  // Balance-based component
  const balanceComponent = b * ageScale

  // Profit-based component (steady state approximation)
  // Net growth rate after balance withdrawals
  const netGrowth = d - b

  // Growth factor over lookback period with net growth
  // [(1 + netGrowth)^n - 1] / [n × (1 + netGrowth)^n]
  const growthFactor = Math.pow(1 + netGrowth, n)
  const profitComponent = (p * (growthFactor - 1)) / (n * growthFactor)

  const inflationComponent = inflationBasedWithdrawal.value / initialCapital.value

  return balanceComponent + profitComponent + inflationComponent
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
              <div class="col-12">
                <label class="form-label">Initialt kapital</label>
                <input
                  type="number"
                  :class="getInputClass('initialCapital')"
                  v-model.number="initialCapital"
                  :disabled="isFieldDisabled('initialCapital')"
                  @click="handleParameterClick('initialCapital', $event)"
                />
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

          <!-- Withdrawal Rates -->
          <div class="param-section">
            <h5 class="section-title">Uttag (per år)</h5>
            <div class="row g-3">
              <div class="col-12">
                <div class="form-check">
                  <input
                    type="checkbox"
                    class="form-check-input"
                    id="amortizedWithdrawal"
                    v-model="amortizedWithdrawal"
                    :disabled="isRunning"
                  />
                  <label class="form-check-label" for="amortizedWithdrawal">
                    Amorteringsbaserat uttag (Mertons regel)
                  </label>
                </div>
                <small class="form-text text-muted">
                  Beräknar uttag med PMT-formeln baserat på återstående år och förväntad avkastning.
                </small>
              </div>
              <div class="col-12 col-md-6" v-if="amortizedWithdrawal">
                <label class="form-label">Arvsmål</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    class="form-control text-end"
                    :value="(bequestGoal * 100).toFixed(0)"
                    @change="bequestGoal = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
                <small class="form-text text-muted">
                  Andel av initialt kapital (realt) att bevara. 0% = förbruka allt, 100% = bevara kapitalet.
                </small>
              </div>
              <div class="col-12 col-md-6" v-if="!amortizedWithdrawal">
                <label class="form-label">Värdebaserad uttagsgrad</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    :class="getInputClass('balanceWithdrawalRate')"
                    :value="(balanceWithdrawalRate * 100).toFixed(1)"
                    @change="balanceWithdrawalRate = getTargetValue($event) / 100"
                    :disabled="isFieldDisabled('balanceWithdrawalRate')"
                    @click="handleParameterClick('balanceWithdrawalRate', $event)"
                  />
                  <span class="input-group-text">%</span>
                  <small class="form-text text-muted"> Belopp baserat på kapitalets värde. </small>
                </div>
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label">Inflationsbaserat uttag</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1000"
                    :class="getInputClass('inflationBasedWithdrawal')"
                    v-model.number="inflationBasedWithdrawal"
                    :disabled="isFieldDisabled('inflationBasedWithdrawal')"
                    @click="handleParameterClick('inflationBasedWithdrawal', $event)"
                  />
                  <span class="input-group-text">kr</span>
                </div>
                <small class="form-text text-muted">
                  Fast belopp som ökas med inflation varje år. Kan användas t.ex. för nödvändiga
                  kostnader.
                </small>
              </div>
              <div class="col-12" v-if="inflationBasedWithdrawal > 0">
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
                  Justerar inflationsuttaget efter åldersbaserad utgiftskurva (topp vid 45–50,
                  avtagande till ~65% vid 80+). Baserat på Eurostat HBS.
                </small>
              </div>
              <div class="col-12 col-md-6" v-if="!amortizedWithdrawal">
                <label class="form-label">Vinstbaserad uttagsgrad</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    :class="getInputClass('profitWithdrawalRate')"
                    :value="(profitWithdrawalRate * 100).toFixed(1)"
                    @change="profitWithdrawalRate = getTargetValue($event) / 100"
                    :disabled="isFieldDisabled('profitWithdrawalRate')"
                    @click="handleParameterClick('profitWithdrawalRate', $event)"
                  />
                  <span class="input-group-text">%</span>
                </div>
                <small class="form-text text-muted">
                  Belopp baserat på medel av de senaste årens vinst.
                </small>
              </div>
              <div class="col-12 col-md-6" v-if="!amortizedWithdrawal">
                <label class="form-label">Lookback-period (vinst)</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1"
                    :class="getInputClass('profitLookbackYears')"
                    :value="profitLookbackYears"
                    @change="profitLookbackYears = getTargetValue($event)"
                    :disabled="isFieldDisabled('profitLookbackYears')"
                    @click="handleParameterClick('profitLookbackYears', $event)"
                  />
                  <span class="input-group-text">år</span>
                </div>
              </div>
              <div class="col-12">
                <label class="form-label">Total uttagsgrad</label>
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
                <small class="form-text text-muted"> Första åren. </small>
              </div>
            </div>
          </div>
        </div>

        <div class="params-column">
          <!-- Portfolio Assets -->
          <div class="param-section">
            <h5 class="section-title">Portfölj</h5>

            <div class="mb-3">
              <FundPresetSelector
                ref="fundPresetSelector"
                :disabled="isRunning"
                @select="applyFundPreset"
                @loaded="onFundDatabaseLoaded"
              />
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
                    v-for="(asset, index) in assets"
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
                        class="form-control-sm text-end form-control-plaintext"
                        :value="(asset.expectedReturn * 100).toFixed(1)"
                        disabled
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        class="form-control-sm text-end form-control-plaintext"
                        :value="(asset.volatility * 100).toFixed(1)"
                        disabled
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
                Från fonddatabasen.<template v-if="simulationMethod === 'bootstrap'"> Används inte i simuleringen.</template>
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
                          class="form-control form-control-sm text-center form-control-plaintext"
                          :value="getCorrelation(i, j)"
                          disabled
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
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
                  <label class="form-label">Schablonskattesats</label>
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
                  <small class="form-text text-muted">För årlig förändring av schablonskatt.</small>
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
              <div class="col-12">
                <label class="form-label">Antal simuleringar</label>
                <input
                  type="number"
                  :class="getInputClass('simulationCount')"
                  v-model.number="simulationCount"
                  min="100"
                  max="100000"
                  step="100"
                  :disabled="isFieldDisabled('simulationCount')"
                  @click="handleParameterClick('simulationCount', $event)"
                />
              </div>
              <div class="col-12">
                <label class="form-label">Simuleringsmetod</label>
                <select
                  :class="getInputClass('simulationMethod')"
                  v-model="simulationMethod"
                  :disabled="isFieldDisabled('simulationMethod')"
                  @click="handleParameterClick('simulationMethod', $event)"
                >
                  <option value="factormodel">Faktormodell (parametrisk)</option>
                  <option value="bootstrap">Blockbootstrap (historisk)</option>
                </select>
                <small v-if="simulationMethod === 'bootstrap'" class="form-text text-muted">
                  Samplar historiska block. Begränsas av fondernas historiklängd.
                </small>
              </div>
              <div class="col-12" v-if="simulationMethod === 'factormodel' && stressPresetList.length > 0">
                <label class="form-label">Stresstest</label>
                <select
                  :class="getInputClass('stressPresetId')"
                  v-model="stressPresetId"
                  :disabled="isFieldDisabled('stressPresetId')"
                  @click="handleParameterClick('stressPresetId', $event)"
                >
                  <option value="">Ingen</option>
                  <option
                    v-for="preset in stressPresetList"
                    :key="preset.id"
                    :value="preset.id"
                  >
                    {{ preset.label }}
                  </option>
                </select>
                <small class="form-text text-muted">
                  Applicerar faktormodellens stresscenario vid första uttagsåret.
                </small>
                <div v-if="stressWarning" class="alert alert-warning mt-2 mb-0 py-1 px-2 small">
                  {{ stressWarning }}
                </div>
              </div>
              <div class="col-12" v-if="simulationMethod === 'bootstrap' && bootstrapProfileList.length > 0">
                <label class="form-label">Stresstest</label>
                <select
                  :class="getInputClass('bootstrapProfileId')"
                  v-model="bootstrapProfileId"
                  :disabled="isFieldDisabled('bootstrapProfileId')"
                  @click="handleParameterClick('bootstrapProfileId', $event)"
                >
                  <option
                    v-for="profile in bootstrapProfileList"
                    :key="profile.id"
                    :value="profile.id"
                    :disabled="disabledProfileIds.has(profile.id)"
                  >
                    {{ profile.label }}
                  </option>
                </select>
                <small class="form-text text-muted">
                  Väljer vilka historiska perioder som viktas i simuleringen.
                </small>
                <div v-if="bootstrapWarning" class="alert alert-warning mt-2 mb-0 py-1 px-2 small">
                  {{ bootstrapWarning }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4 d-flex align-items-center gap-2">
        <button class="btn btn-primary btn-lg" @click="handleRunSimulation" :disabled="isRunning">
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
