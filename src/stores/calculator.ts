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
  const development = ref(0.1299) // Swedbank Robur Globalfond A
  const developmentStdDev = ref(0.202) // Swedbank Robur Globalfond A
  const balanceWithdrawalRate = ref(0.015)
  const profitWithdrawalRate = ref(0.2)
  const profitLookbackYears = ref(5)
  const iskTaxRate = ref(0.0296)
  const iskTaxRateStdDev = ref(0.005)
  const inflationRate = ref(0.02)
  const inflationStdDev = ref(0.009) // Barely any negative years
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
  const showStochasticParameters = ref(false)

  // Computed parameters object
  const parameters = computed<InputParameters>(() => ({
    initialCapital: initialCapital.value,
    startYear: startYear.value,
    yearsLater: yearsLater.value,
    simulationCount: simulationCount.value,
    development: development.value,
    developmentStdDev: developmentStdDev.value,
    inflationRate: inflationRate.value,
    inflationStdDev: inflationStdDev.value,
    scenarios: [
      {
        name: 'ISK',
        balanceWithdrawalRate: balanceWithdrawalRate.value,
        profitWithdrawalRate: profitWithdrawalRate.value,
        profitLookbackYears: profitLookbackYears.value,
        capitalGainsTax: capitalGainsTax.value,
        iskTaxRate: iskTaxRate.value,
        iskTaxRateStdDev: iskTaxRateStdDev.value,
        isISK: true,
      },
      {
        name: 'VP',
        balanceWithdrawalRate: balanceWithdrawalRate.value,
        profitWithdrawalRate: profitWithdrawalRate.value,
        profitLookbackYears: profitLookbackYears.value,
        capitalGainsTax: capitalGainsTax.value,
        isISK: false,
      },
    ],
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
    startYear.value = params.startYear
    yearsLater.value = params.yearsLater
    simulationCount.value = params.simulationCount
    development.value = params.development
    developmentStdDev.value = params.developmentStdDev
    inflationRate.value = params.inflationRate
    inflationStdDev.value = params.inflationStdDev

    const firstScenario = params.scenarios[0]!
    balanceWithdrawalRate.value = firstScenario.balanceWithdrawalRate
    profitWithdrawalRate.value = firstScenario.profitWithdrawalRate
    profitLookbackYears.value = firstScenario.profitLookbackYears
    capitalGainsTax.value = firstScenario.capitalGainsTax

    const iskScenario = params.scenarios.find((s) => s.isISK)!
    iskTaxRate.value = iskScenario.iskTaxRate!
    iskTaxRateStdDev.value = iskScenario.iskTaxRateStdDev!
  }

  return {
    // Input parameters
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

    // State
    isRunning,
    progress,
    results,
    statistics,
    timeSeriesData,
    showStochasticParameters,
    parameters,

    // Actions
    runSimulation,
    resetResults,
    loadParameters,
  }
})
