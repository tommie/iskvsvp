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
      <h1 class="display-4">ISK vs VP Monte Carlo-simulator</h1>
      <p class="lead text-muted">
        Stokastisk simulering som jämför ISK (Investeringssparkonto) och VP (Vanlig depå) över tid
      </p>
    </header>

    <InputParameters />
    <SummaryStatistics />
    <TimeSeriesVisualization />

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
