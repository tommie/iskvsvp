<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'

const store = useCalculatorStore()
const {
  initialCapital,
  development,
  developmentStdDev,
  withdrawalISK,
  withdrawalVP,
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

const handleRunSimulation = async () => {
  await store.runSimulation()
}
</script>

<template>
  <div class="card mb-4">
    <div class="card-header">
      <h3>Input Parameters</h3>
    </div>
    <div class="card-body">
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Initialt kapital</label>
          <input
            type="number"
            class="form-control"
            v-model.number="initialCapital"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-6">
          <label class="form-label">Vinstskatt (VP)</label>
          <input
            type="number"
            step="0.01"
            class="form-control"
            v-model.number="capitalGainsTax"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Utveckling (medelvärde per år)</label>
          <input
            type="number"
            step="0.01"
            class="form-control"
            v-model.number="development"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Utveckling (standardavvikelse)</label>
          <input
            type="number"
            step="0.01"
            class="form-control"
            v-model.number="developmentStdDev"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Uttag ISK (per år)</label>
          <input
            type="number"
            step="0.01"
            class="form-control"
            v-model.number="withdrawalISK"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Uttag VP (per år)</label>
          <input
            type="number"
            step="0.01"
            class="form-control"
            v-model.number="withdrawalVP"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">ISK-skattesats (initial)</label>
          <input
            type="number"
            step="0.0001"
            class="form-control"
            v-model.number="iskTaxRate"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">ISK-skattesats (stddev för ändringar)</label>
          <input
            type="number"
            step="0.0001"
            class="form-control"
            v-model.number="iskTaxRateStdDev"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Inflationstakt (medelvärde)</label>
          <input
            type="number"
            step="0.01"
            class="form-control"
            v-model.number="inflationRate"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Inflationstakt (standardavvikelse)</label>
          <input
            type="number"
            step="0.01"
            class="form-control"
            v-model.number="inflationStdDev"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Startår (ålder)</label>
          <input
            type="number"
            class="form-control"
            v-model.number="startYear"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Antal år</label>
          <input
            type="number"
            class="form-control"
            v-model.number="yearsLater"
            min="1"
            max="100"
            :disabled="isRunning"
          />
        </div>

        <div class="col-md-4">
          <label class="form-label">Antal simuleringar</label>
          <input
            type="number"
            class="form-control"
            v-model.number="simulationCount"
            min="100"
            max="100000"
            step="100"
            :disabled="isRunning"
          />
        </div>
      </div>

      <div class="mt-4">
        <button class="btn btn-primary btn-lg" @click="handleRunSimulation" :disabled="isRunning">
          <span v-if="isRunning" class="spinner-border spinner-border-sm me-2"></span>
          {{ isRunning ? 'Running simulation...' : 'Run Monte Carlo Simulation' }}
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
</style>
