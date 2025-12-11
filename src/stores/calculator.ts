import { defineStore } from 'pinia'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type {
  InputParameters,
  SimulationResult,
  SimulationStatistics,
  TimeSeriesPoint,
  Portfolio,
} from '../types'
import { calculateStatistics, extractTimeSeriesData } from '../simulation'
import { useHistoryStore } from './history'
import { encodeParamsToUrl, decodeParamsFromUrl } from '../utils/url-params'
import SimulationWorker from '../simulation.worker?worker'

export const useCalculatorStore = defineStore('calculator', () => {
  // Input parameters
  const initialCapital = ref(5000000)

  // Default portfolio: Single asset (Swedbank Robur Globalfond A)
  const portfolio = ref<Portfolio>({
    assets: [
      {
        name: 'Global Equity',
        weight: 1.0,
        expectedReturn: 0.1299,
        volatility: 0.202,
      },
    ],
    correlationMatrix: [],
  })

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
  const seed = ref<string | undefined>(undefined)

  // Simulation state
  const isRunning = ref(false)
  const progress = ref(0)
  const results = shallowRef<SimulationResult[]>([])
  const statistics = shallowRef<SimulationStatistics | null>(null)
  const timeSeriesData = shallowRef<TimeSeriesPoint[]>([])
  const representativeSimulationId = ref<number | null>(null)
  const showDetailedStatistics = ref(false)

  // Computed parameters object
  const parameters = computed<Omit<InputParameters, 'seed'>>(() => ({
    initialCapital: initialCapital.value,
    startYear: startYear.value,
    yearsLater: yearsLater.value,
    simulationCount: simulationCount.value,
    portfolio: portfolio.value,
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
    const worker = new SimulationWorker()

    isRunning.value = true
    progress.value = 0

    try {
      const params = {
        ...parameters.value,
        seed: seed.value ?? Math.random().toString(36).substring(2, 15),
      }

      // Create a plain object copy to ensure it can be cloned for the worker
      const plainParams = JSON.parse(JSON.stringify(params))

      interface SimulationWorkerResult {
        results: SimulationResult[]
        statistics: SimulationStatistics
        timeseries: TimeSeriesPoint[]
      }

      // Wait for results from worker
      const workerResults = await new Promise<SimulationWorkerResult>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'progress') {
            progress.value = e.data.progress * 0.6
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
        worker.postMessage({ params: plainParams })
      })

      results.value = workerResults.results
      progress.value = 70
      statistics.value = workerResults.statistics
      progress.value = 80
      timeSeriesData.value = workerResults.timeseries
      progress.value = 90

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
        historyStore.addRecord(params, statistics.value)
      }
    } finally {
      worker.terminate()
      isRunning.value = false
      progress.value = 100
      // Remove seed from URL after simulation completes
      seed.value = undefined
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
    portfolio.value = params.portfolio
    inflationRate.value = params.inflationRate
    inflationStdDev.value = params.inflationStdDev
    seed.value = params.seed

    const firstScenario = params.scenarios[0]!
    balanceWithdrawalRate.value = firstScenario.balanceWithdrawalRate
    profitWithdrawalRate.value = firstScenario.profitWithdrawalRate
    profitLookbackYears.value = firstScenario.profitLookbackYears
    capitalGainsTax.value = firstScenario.capitalGainsTax

    const iskScenario = params.scenarios.find((s) => s.isISK)!
    iskTaxRate.value = iskScenario.iskTaxRate!
    iskTaxRateStdDev.value = iskScenario.iskTaxRateStdDev!
  }

  /**
   * Initialize URL synchronization.
   * This should be called from App.vue after router is ready.
   */
  function initUrlSync() {
    const router = useRouter()
    const route = useRoute()
    let isUpdatingFromUrl = false

    // Load from URL on init
    watch(
      route,
      (route) => {
        const urlParams = decodeParamsFromUrl(route.query)
        if (urlParams && Object.keys(urlParams).length > 0) {
          isUpdatingFromUrl = true

          try {
            if (urlParams.initialCapital !== undefined)
              initialCapital.value = urlParams.initialCapital
            if (urlParams.startYear !== undefined) startYear.value = urlParams.startYear
            if (urlParams.yearsLater !== undefined) yearsLater.value = urlParams.yearsLater
            if (urlParams.simulationCount !== undefined)
              simulationCount.value = urlParams.simulationCount
            if (urlParams.portfolio !== undefined) portfolio.value = urlParams.portfolio
            if (urlParams.inflationRate !== undefined) inflationRate.value = urlParams.inflationRate
            if (urlParams.inflationStdDev !== undefined)
              inflationStdDev.value = urlParams.inflationStdDev
            if (urlParams.seed !== undefined) seed.value = urlParams.seed

            if (urlParams.scenarios && urlParams.scenarios.length > 0) {
              const firstScenario = urlParams.scenarios[0]
              if (firstScenario) {
                balanceWithdrawalRate.value = firstScenario.balanceWithdrawalRate
                profitWithdrawalRate.value = firstScenario.profitWithdrawalRate
                profitLookbackYears.value = firstScenario.profitLookbackYears
                capitalGainsTax.value = firstScenario.capitalGainsTax
              }

              const iskScenario = urlParams.scenarios.find((s) => s.isISK)
              if (iskScenario?.iskTaxRate !== undefined) iskTaxRate.value = iskScenario.iskTaxRate
              if (iskScenario?.iskTaxRateStdDev !== undefined)
                iskTaxRateStdDev.value = iskScenario.iskTaxRateStdDev
            }
          } finally {
            nextTick(() => (isUpdatingFromUrl = false))
          }
        }
      },
      { deep: true, immediate: true },
    )

    // Watch parameters and update URL (debounced)
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    watch(
      [parameters, seed],
      ([newParams, seed]) => {
        if (isUpdatingFromUrl) return

        if (timeoutId) clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          const query = encodeParamsToUrl({ ...newParams, seed })
          router.replace({ query })
        }, 500)
      },
      { deep: true },
    )
  }

  return {
    // Input parameters
    initialCapital,
    portfolio,
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
    showDetailedStatistics,
    parameters,

    // Actions
    runSimulation,
    resetResults,
    loadParameters,
    initUrlSync,
  }
})
