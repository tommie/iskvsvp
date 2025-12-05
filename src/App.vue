<script setup lang="ts">
import { useCalculatorStore } from './stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import InputParameters from './components/InputParameters.vue'
import SummaryStatistics from './components/SummaryStatistics.vue'
import SummaryVisualization from './components/SummaryVisualization.vue'
import TimeSeriesVisualization from './components/TimeSeriesVisualization.vue'
import ParameterVisualization from './components/ParameterVisualization.vue'
import SimulationHistory from './components/SimulationHistory.vue'

const store = useCalculatorStore()
const { simulationCount, statistics, showDetailedStatistics } = storeToRefs(store)

const activeTab = ref('statistics')

// Auto-switch to statistics tab when results are available
watch(statistics, (newStats) => {
  if (newStats && activeTab.value === 'statistics') {
    // Already on the right tab, keep it
  } else if (newStats) {
    activeTab.value = 'statistics'
  }
})
</script>

<template>
  <div class="container my-4">
    <header class="mb-4">
      <h1 class="display-4">ISK vs VP Monte Carlo-simulator</h1>
      <p class="lead text-muted">
        Stokastisk simulering som jämför ISK (Investeringssparkonto) och VP (Värdepappersdepå) över
        tid
      </p>
    </header>

    <InputParameters />

    <div v-if="statistics" class="mt-4">
      <div class="d-flex align-items-center border-bottom">
        <ul class="nav nav-tabs border-0 flex-grow-1" role="tablist">
          <li class="nav-item" role="presentation">
            <button
              class="nav-link"
              :class="{ active: activeTab === 'statistics' }"
              @click="activeTab = 'statistics'"
              type="button"
              role="tab"
            >
              Sammanfattning
            </button>
          </li>
          <li class="nav-item" role="presentation">
            <button
              class="nav-link"
              :class="{ active: activeTab === 'charts' }"
              @click="activeTab = 'charts'"
              type="button"
              role="tab"
            >
              Grafer
            </button>
          </li>
          <li class="nav-item" role="presentation">
            <button
              class="nav-link"
              :class="{ active: activeTab === 'timeseries' }"
              @click="activeTab = 'timeseries'"
              type="button"
              role="tab"
            >
              Över tid
            </button>
          </li>
          <li class="nav-item" role="presentation">
            <button
              class="nav-link"
              :class="{ active: activeTab === 'parameters' }"
              @click="activeTab = 'parameters'"
              type="button"
              role="tab"
            >
              Parametrar
            </button>
          </li>
          <li class="nav-item" role="presentation">
            <button
              class="nav-link"
              :class="{ active: activeTab === 'history' }"
              @click="activeTab = 'history'"
              type="button"
              role="tab"
            >
              Historik
            </button>
          </li>
        </ul>
        <div class="form-check form-switch mb-0 ms-3 me-2">
          <input
            class="form-check-input"
            type="checkbox"
            role="switch"
            id="show-detailed-statistics"
            v-model="showDetailedStatistics"
          />
          <label class="form-check-label" for="show-detailed-statistics">
            Detaljerat resultat
          </label>
        </div>
      </div>

      <div class="tab-content mt-3">
        <div v-show="activeTab === 'statistics'">
          <SummaryStatistics />
        </div>
        <div v-show="activeTab === 'charts'">
          <SummaryVisualization />
        </div>
        <div v-show="activeTab === 'timeseries'">
          <TimeSeriesVisualization />
        </div>
        <div v-show="activeTab === 'parameters'">
          <ParameterVisualization />
        </div>
        <div v-show="activeTab === 'history'">
          <SimulationHistory />
        </div>
      </div>
    </div>

    <SimulationHistory v-else />

    <footer class="mt-5 pt-4 border-top text-muted">
      <p class="small">
        <strong>Observera:</strong> Denna simulator använder Monte Carlo-metoder för att modellera
        osäkerhet i avkastning och inflation. Årlig avkastning och inflation modelleras som
        normalfördelningar. ISK-skattesatsen har ett minimum på 1,25% och ändras stokastiskt varje
        år. Resultaten visar statistik över
        {{ simulationCount.toLocaleString('sv-SE') }} simuleringar.
      </p>
    </footer>
  </div>
</template>

<style scoped>
header {
  border-bottom: 2px solid #dee2e6;
  padding-bottom: 1rem;
}

.display-4 {
  font-weight: 300;
}

footer {
  font-size: 0.875rem;
}
</style>
