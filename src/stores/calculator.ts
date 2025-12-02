import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  InputParameters,
  SimulationResult,
  SimulationStatistics,
  TimeSeriesPoint,
} from '../types'
import { runMonteCarloSimulation, calculateStatistics, extractTimeSeriesData } from '../simulation'

export const useCalculatorStore = defineStore('calculator', () => {
  // Input parameters
  const initialCapital = ref(5000000)
  const development = ref(0.08)
  const developmentStdDev = ref(0.15)
  const withdrawalISK = ref(0.03)
  const withdrawalVP = ref(0.03)
  const iskTaxRate = ref(0.0296)
  const iskTaxRateStdDev = ref(0.005)
  const inflationRate = ref(0.02)
  const inflationStdDev = ref(0.01)
  const capitalGainsTax = ref(0.3)
  const startYear = ref(45)
  const yearsLater = ref(36)
  const simulationCount = ref(1000)

  // Simulation state
  const isRunning = ref(false)
  const progress = ref(0)
  const results = ref<SimulationResult[]>([])
  const statistics = ref<SimulationStatistics | null>(null)
  const timeSeriesData = ref<TimeSeriesPoint[]>([])

  // Computed parameters object
  const parameters = computed<InputParameters>(() => ({
    initialCapital: initialCapital.value,
    development: development.value,
    developmentStdDev: developmentStdDev.value,
    withdrawalISK: withdrawalISK.value,
    withdrawalVP: withdrawalVP.value,
    iskTaxRate: iskTaxRate.value,
    iskTaxRateStdDev: iskTaxRateStdDev.value,
    inflationRate: inflationRate.value,
    inflationStdDev: inflationStdDev.value,
    capitalGainsTax: capitalGainsTax.value,
    startYear: startYear.value,
    yearsLater: yearsLater.value,
    simulationCount: simulationCount.value,
  }))

  /**
   * Run the Monte Carlo simulation.
   */
  async function runSimulation() {
    isRunning.value = true
    progress.value = 0

    try {
      // Use setTimeout to allow UI to update
      await new Promise((resolve) => setTimeout(resolve, 0))

      results.value = runMonteCarloSimulation(parameters.value, (p) => {
        progress.value = p
      })

      statistics.value = calculateStatistics(results.value)
      timeSeriesData.value = extractTimeSeriesData(results.value)
    } finally {
      isRunning.value = false
      progress.value = 100
    }
  }

  /**
   * Reset simulation results.
   */
  function resetResults() {
    results.value = []
    statistics.value = null
    timeSeriesData.value = []
    progress.value = 0
  }

  return {
    // Input parameters
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

    // State
    isRunning,
    progress,
    results,
    statistics,
    timeSeriesData,
    parameters,

    // Actions
    runSimulation,
    resetResults,
  }
})
