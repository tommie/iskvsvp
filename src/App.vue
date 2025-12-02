<script setup lang="ts">
import { useCalculatorStore } from './stores/calculator'
import { storeToRefs } from 'pinia'
import InputParameters from './components/InputParameters.vue'
import SummaryStatistics from './components/SummaryStatistics.vue'
import TimeSeriesVisualization from './components/TimeSeriesVisualization.vue'

const store = useCalculatorStore()
const { simulationCount } = storeToRefs(store)
</script>

<template>
  <div class="container my-4">
    <header class="mb-4">
      <h1 class="display-4">ISK vs VP Monte Carlo Simulator</h1>
      <p class="lead text-muted">
        Stochastic simulation comparing ISK (Investeringssparkonto) and VP (Vanlig depå) over time
      </p>
    </header>

    <InputParameters />
    <SummaryStatistics />
    <TimeSeriesVisualization />

    <footer class="mt-5 pt-4 border-top text-muted">
      <p class="small">
        <strong>Note:</strong> This simulator uses Monte Carlo methods to model uncertainty in
        returns and inflation. Annual returns and inflation are modeled as normal distributions. The
        ISK tax rate has a minimum of 1.25% and changes stochastically each year. Results show
        statistics across {{ simulationCount.toLocaleString('sv-SE') }} simulations.
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
