<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

const store = useCalculatorStore()
const {
  initialCapital,
  development,
  developmentStdDev,
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
  showStochasticParameters,
} = storeToRefs(store)

const rorPreset = ref('')

interface RORPreset {
  label: string
  mean: number
  stdDev: number
}

const rorPresets: RORPreset[] = [
  { label: 'AMF Aktiefond Europa', mean: 0.077744, stdDev: 0.192562 },
  { label: 'Carnegie Sverigefond A', mean: 0.1446, stdDev: 0.2283 },
  { label: 'Handelsbanken Nordiska Småb (A1 SEK)', mean: 0.154126, stdDev: 0.30111 },
  { label: 'Länsförsäkringar Fastighetsfond A', mean: 0.184636, stdDev: 0.282252 },
  { label: 'Länsförsäkringar Lång Räntefond A', mean: 0.044307, stdDev: 0.05498 },
  { label: 'Storebrand USA A SEK', mean: 0.090752, stdDev: 0.168028 },
  { label: 'Swebank Robur Globalfond A', mean: 0.1299, stdDev: 0.202 },
]

const applyRORPreset = () => {
  const preset = rorPresets.find((p) => p.label === rorPreset.value)
  if (preset) {
    development.value = preset.mean
    developmentStdDev.value = preset.stdDev
  }
}

const handleRunSimulation = async () => {
  await store.runSimulation()
}

const getTargetValue = (event: UIEvent) => {
  return parseFloat((event.target as HTMLInputElement)?.value)
}
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
              <div class="col-12">
                <label class="form-label">Vinstskatt (VP)</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(capitalGainsTax * 100).toFixed(1)"
                    @input="capitalGainsTax = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Annual Return Distribution -->
          <div class="param-section">
            <h5 class="section-title">Avkastning (årlig fördelning)</h5>
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Förinställning</label>
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
              <div class="col-12">
                <label class="form-label">Medelvärde</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(development * 100).toFixed(1)"
                    @input="development = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12">
                <label class="form-label">Standardavvikelse</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(developmentStdDev * 100).toFixed(1)"
                    @input="developmentStdDev = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="params-column">
          <!-- Withdrawal Rates -->
          <div class="param-section">
            <h5 class="section-title">Uttag (per år)</h5>
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Värdebaserad uttagsgrad</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(balanceWithdrawalRate * 100).toFixed(1)"
                    @input="balanceWithdrawalRate = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12">
                <label class="form-label">Vinstbaserad uttagsgrad</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(profitWithdrawalRate * 100).toFixed(1)"
                    @input="profitWithdrawalRate = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12">
                <label class="form-label">Lookback-period (vinst)</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="1"
                    class="form-control text-end"
                    :value="profitLookbackYears"
                    @input="profitLookbackYears = getTargetValue($event)"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">år</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ISK Tax Rate Distribution -->
          <div class="param-section">
            <h5 class="section-title">ISK-skattesats</h5>
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Initial skattesats</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.01"
                    class="form-control text-end"
                    :value="(iskTaxRate * 100).toFixed(2)"
                    @input="iskTaxRate = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12">
                <label class="form-label">Standardavvikelse för årliga ändringar</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.01"
                    class="form-control text-end"
                    :value="(iskTaxRateStdDev * 100).toFixed(2)"
                    @input="iskTaxRateStdDev = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="params-column">
          <!-- Inflation Distribution -->
          <div class="param-section">
            <h5 class="section-title">Inflation (årlig fördelning)</h5>
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Medelvärde</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(inflationRate * 100).toFixed(1)"
                    @input="inflationRate = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
              <div class="col-12">
                <label class="form-label">Standardavvikelse</label>
                <div class="input-group">
                  <input
                    type="number"
                    step="0.1"
                    class="form-control text-end"
                    :value="(inflationStdDev * 100).toFixed(1)"
                    @input="inflationStdDev = getTargetValue($event) / 100"
                    :disabled="isRunning"
                  />
                  <span class="input-group-text">%</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Time Period and Simulation Settings -->
          <div class="param-section">
            <h5 class="section-title">Simulering</h5>
            <div class="row g-3">
              <div class="col-12">
                <label class="form-label">Startår (ålder)</label>
                <input
                  type="number"
                  class="form-control text-end"
                  v-model.number="startYear"
                  :disabled="isRunning"
                />
              </div>
              <div class="col-12">
                <label class="form-label">Antal år</label>
                <input
                  type="number"
                  class="form-control text-end"
                  v-model.number="yearsLater"
                  min="1"
                  max="100"
                  :disabled="isRunning"
                />
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
      </div>

      <div class="mt-4">
        <button class="btn btn-primary btn-lg" @click="handleRunSimulation" :disabled="isRunning">
          <span v-if="isRunning" class="spinner-border spinner-border-sm me-2"></span>
          {{ isRunning ? 'Kör simulering...' : 'Kör Monte Carlo-simulering' }}
        </button>

        <button
          class="btn btn-outline-secondary btn-lg ms-2"
          @click="showStochasticParameters = !showStochasticParameters"
          :disabled="isRunning"
        >
          {{ showStochasticParameters ? 'Dölj parametrar' : 'Visa parametrar' }}
        </button>

        <div v-if="isRunning" class="mt-3">
          <div class="progress">
            <div
              class="progress-bar progress-bar-striped progress-bar-animated"
              role="progressbar"
              :style="{ width: progress + '%' }"
              :aria-valuenow="progress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              {{ Math.round(progress) }}%
            </div>
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
  border-bottom: 1px solid #dee2e6;
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
</style>
