import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  InputParameters,
  SimulationResult,
  SimulationStatistics,
  TimeSeriesPoint,
} from '../types'
import { calculateStatistics, extractTimeSeriesData } from '../simulation'
import { useHistoryStore } from './history'
import SimulationWorker from '../simulation.worker?worker'

export const useCalculatorStore = defineStore('calculator', () => {
  // Input parameters
  const initialCapital = ref(5000000)
  const development = ref(0.1299) // Swedbank Robur Globalfond A
  const developmentStdDev = ref(0.202) // Swedbank Robur Globalfond A
  const balanceWithdrawalRate = ref(0.015)
  const profitWithdrawalRate = ref(0.15)
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
  const representativeSimulationId = ref<number | null>(null)
  const showStochasticParameters = ref(false)
  const showDetailedStatistics = ref(false)

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
   * Find the simulation that is closest to the median across multiple metrics.
   */
  function findRepresentativeSimulation(
    simResults: SimulationResult[],
    stats: SimulationStatistics,
  ): number | null {
    if (!simResults.length || !stats.median.scenarios) return null

    const scenarioNames = Object.keys(stats.median.scenarios)
    if (!scenarioNames.length) return null

    // For each metric, collect values across all scenarios
    const metrics: Array<{ values: number[]; median: number; mean: number; stdDev: number }> = []

    // Metric 1: Final liquidation value (sum across scenarios)
    const liquidValues = simResults.map((r) =>
      scenarioNames.reduce((sum, name) => sum + (r.summary.scenarios[name]?.liquidValue ?? 0), 0),
    )
    const liquidMedian = scenarioNames.reduce(
      (sum, name) => sum + (stats.median.scenarios?.[name]?.liquidValue ?? 0),
      0,
    )
    const liquidMean = scenarioNames.reduce(
      (sum, name) => sum + (stats.mean.scenarios?.[name]?.liquidValue ?? 0),
      0,
    )
    const liquidStdDev = Math.sqrt(
      scenarioNames.reduce(
        (sum, name) => sum + Math.pow(stats.stdDev.scenarios?.[name]?.liquidValue ?? 0, 2),
        0,
      ),
    )
    metrics.push({
      values: liquidValues,
      median: liquidMedian,
      mean: liquidMean,
      stdDev: liquidStdDev,
    })

    // Metric 2: Final year withdrawals (sum across scenarios)
    const withdrawalValues = simResults.map((r) =>
      scenarioNames.reduce(
        (sum, name) => sum + (r.summary.scenarios[name]?.realWithdrawal ?? 0),
        0,
      ),
    )
    const withdrawalMedian = scenarioNames.reduce(
      (sum, name) => sum + (stats.median.scenarios?.[name]?.realWithdrawal ?? 0),
      0,
    )
    const withdrawalMean = scenarioNames.reduce(
      (sum, name) => sum + (stats.mean.scenarios?.[name]?.realWithdrawal ?? 0),
      0,
    )
    const withdrawalStdDev = Math.sqrt(
      scenarioNames.reduce(
        (sum, name) => sum + Math.pow(stats.stdDev.scenarios?.[name]?.realWithdrawal ?? 0, 2),
        0,
      ),
    )
    metrics.push({
      values: withdrawalValues,
      median: withdrawalMedian,
      mean: withdrawalMean,
      stdDev: withdrawalStdDev,
    })

    // Metric 3: Average annual withdrawals (sum across scenarios)
    const avgWithdrawalValues = simResults.map((r) =>
      scenarioNames.reduce(
        (sum, name) => sum + (r.summary.scenarios[name]?.accumulatedRealWithdrawal ?? 0),
        0,
      ),
    )
    const avgWithdrawalMedian = scenarioNames.reduce(
      (sum, name) => sum + (stats.median.scenarios?.[name]?.accumulatedRealWithdrawal ?? 0),
      0,
    )
    const avgWithdrawalMean = scenarioNames.reduce(
      (sum, name) => sum + (stats.mean.scenarios?.[name]?.accumulatedRealWithdrawal ?? 0),
      0,
    )
    const avgWithdrawalStdDev = Math.sqrt(
      scenarioNames.reduce(
        (sum, name) =>
          sum + Math.pow(stats.stdDev.scenarios?.[name]?.accumulatedRealWithdrawal ?? 0, 2),
        0,
      ),
    )
    metrics.push({
      values: avgWithdrawalValues,
      median: avgWithdrawalMedian,
      mean: avgWithdrawalMean,
      stdDev: avgWithdrawalStdDev,
    })

    // Metric 4: Max drawdown (sum across scenarios)
    const drawdownValues = simResults.map((r) =>
      scenarioNames.reduce((sum, name) => sum + (r.summary.scenarios[name]?.maxDrawdown ?? 0), 0),
    )
    const drawdownMedian = scenarioNames.reduce(
      (sum, name) => sum + (stats.median.scenarios?.[name]?.maxDrawdown ?? 0),
      0,
    )
    const drawdownMean = scenarioNames.reduce(
      (sum, name) => sum + (stats.mean.scenarios?.[name]?.maxDrawdown ?? 0),
      0,
    )
    const drawdownStdDev = Math.sqrt(
      scenarioNames.reduce(
        (sum, name) => sum + Math.pow(stats.stdDev.scenarios?.[name]?.maxDrawdown ?? 0, 2),
        0,
      ),
    )
    metrics.push({
      values: drawdownValues,
      median: drawdownMedian,
      mean: drawdownMean,
      stdDev: drawdownStdDev,
    })

    // Calculate distance for each simulation
    let minDistance = Infinity
    let representativeId: number | null = null

    simResults.forEach((result, idx) => {
      let distance = 0
      metrics.forEach((metric) => {
        const value = metric.values[idx]!
        // Normalize using z-score: (value - median) / stdDev
        const stdDev = metric.stdDev > 0 ? metric.stdDev : 1
        const normalized = (value - metric.median) / stdDev
        distance += normalized * normalized
      })
      distance = Math.sqrt(distance)

      if (distance < minDistance) {
        minDistance = distance
        representativeId = idx
      }
    })

    return representativeId
  }

  /**
   * Run the Monte Carlo simulation.
   */
  async function runSimulation() {
    isRunning.value = true
    progress.value = 0

    try {
      // Create worker
      const worker = new SimulationWorker()

      interface SimulationWorkerResult {
        results: SimulationResult[]
        statistics: SimulationStatistics
        timeseries: TimeSeriesPoint[]
      }

      // Wait for results from worker
      const workerResults = await new Promise<SimulationWorkerResult>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'progress') {
            progress.value = Math.min(90, e.data.progress)
          } else if (e.data.type === 'complete') {
            resolve({
              results: e.data.results,
              statistics: calculateStatistics(e.data.results),
              timeseries: extractTimeSeriesData(e.data.results),
            })
          }
        }

        worker.onerror = (error) => {
          reject(error)
        }

        // Start simulation
        worker.postMessage({ params: parameters.value })
      })

      // Terminate worker
      worker.terminate()

      results.value = workerResults.results
      statistics.value = workerResults.statistics
      timeSeriesData.value = workerResults.timeseries

      // Find representative simulation
      if (statistics.value) {
        representativeSimulationId.value = findRepresentativeSimulation(
          results.value,
          statistics.value,
        )
      }

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
    representativeSimulationId.value = null
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
    representativeSimulationId,
    showStochasticParameters,
    showDetailedStatistics,
    parameters,

    // Actions
    runSimulation,
    resetResults,
    loadParameters,
  }
})
