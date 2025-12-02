import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  InputParameters,
  SimulationResult,
  SimulationStatistics,
  TimeSeriesPoint,
} from '../types'
import { runMonteCarloSimulation, calculateStatistics, extractTimeSeriesData } from '../simulation'
import { useHistoryStore } from './history'

export const useCalculatorStore = defineStore('calculator', () => {
  // Input parameters
  const initialCapital = ref(5000000)
  const development = ref(0.08)
  const developmentStdDev = ref(0.5) // 5%ile about -5%
  const withdrawalISK = ref(0.03)
  const withdrawalVP = ref(0.03)
  const badYearWithdrawalRate = ref(1.0)
  const iskTaxRate = ref(0.0296)
  const iskTaxRateStdDev = ref(0.005)
  const inflationRate = ref(0.02)
  const inflationStdDev = ref(0.07) // 5%ile slightly above zero
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
    badYearWithdrawalRate: badYearWithdrawalRate.value,
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

      // Save to history
      if (statistics.value) {
        const historyStore = useHistoryStore()
        historyStore.addRecord(parameters.value, statistics.value)
      }
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

  /**
   * Load parameters from a saved configuration.
   */
  function loadParameters(params: InputParameters) {
    initialCapital.value = params.initialCapital
    development.value = params.development
    developmentStdDev.value = params.developmentStdDev
    withdrawalISK.value = params.withdrawalISK
    withdrawalVP.value = params.withdrawalVP
    badYearWithdrawalRate.value = params.badYearWithdrawalRate
    iskTaxRate.value = params.iskTaxRate
    iskTaxRateStdDev.value = params.iskTaxRateStdDev
    inflationRate.value = params.inflationRate
    inflationStdDev.value = params.inflationStdDev
    capitalGainsTax.value = params.capitalGainsTax
    startYear.value = params.startYear
    yearsLater.value = params.yearsLater
    simulationCount.value = params.simulationCount
  }

  return {
    // Input parameters
    initialCapital,
    development,
    developmentStdDev,
    withdrawalISK,
    withdrawalVP,
    badYearWithdrawalRate,
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
    loadParameters,
  }
})
