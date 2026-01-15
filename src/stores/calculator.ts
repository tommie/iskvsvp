import { defineStore } from 'pinia'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type {
  InputParameters,
  SimulationAsset,
  SimulationResults,
  RebalanceFrequency,
} from '../types'
import { useHistoryStore } from './history'
import { encodeParamsToUrl, decodeParamsFromUrl } from '../utils/url-params'
import SimulationWorker from '../simulation.worker?worker'

export const useCalculatorStore = defineStore('calculator', () => {
  // Input parameters
  const initialCapital = ref(5000000)

  // Default assets: Single asset (Swedbank Robur Globalfond A)
  const assets = ref<SimulationAsset[]>([
    {
      name: 'Global Equity',
      weight: 1.0,
      expectedReturn: 0.1299,
      volatility: 0.202,
    },
  ])
  const assetCorrelationMatrix = ref<number[][]>([[1.0]])
  const assetRebalanceFrequency = ref<RebalanceFrequency>('never')

  const balanceWithdrawalRate = ref(0.015)
  const profitWithdrawalRate = ref(0.15)
  const profitLookbackYears = ref(5)
  const inflationBasedWithdrawal = ref(0)
  const iskTaxRate = ref(0.0296)
  const iskTaxRateStdDev = ref(0.005)
  const inflationRate = ref(0.02)
  const inflationStdDev = ref(0.009) // Barely any negative years
  const vpFundTaxRate = ref(0.004) // VP fund tax rate (0.4%)
  const capitalGainsTax = ref(0.3)
  const startYear = ref(45)
  const yearsLater = ref(36)
  const simulationCount = ref(1000)
  const seed = ref<string | undefined>(undefined)

  // Simulation state
  const isRunning = ref(false)
  const progress = ref(0)
  const simulationResults = shallowRef<SimulationResults | null>(null)
  const showDetailedStatistics = ref(false)

  // Helper to create base parameters (common to both ISK and VP)
  const createBaseParameters = (): Omit<
    InputParameters,
    'iskTaxRate' | 'iskTaxRateStdDev' | 'seed'
  > => ({
    initialCapital: initialCapital.value,
    startYear: startYear.value,
    yearsLater: yearsLater.value,
    simulationCount: simulationCount.value,
    assets: assets.value,
    assetCorrelationMatrix: assetCorrelationMatrix.value,
    assetRebalanceFrequency: assetRebalanceFrequency.value,
    balanceWithdrawalRate: balanceWithdrawalRate.value,
    profitWithdrawalRate: profitWithdrawalRate.value,
    profitLookbackYears: profitLookbackYears.value,
    inflationBasedWithdrawal: inflationBasedWithdrawal.value,
    vpWealthTaxRate: vpFundTaxRate.value,
    capitalGainsTaxRate: capitalGainsTax.value,
    inflationRate: inflationRate.value,
    inflationStdDev: inflationStdDev.value,
  })

  /**
   * Run the Monte Carlo simulation for both ISK and VP scenarios.
   */
  async function runSimulation() {
    const worker = new SimulationWorker()

    isRunning.value = true
    progress.value = 0

    try {
      const baseSeed = seed.value ?? Math.random().toString(36).substring(2, 15)
      const baseParams = createBaseParameters()

      // Create ISK parameters
      const iskParams: InputParameters = {
        ...baseParams,
        iskTaxRate: iskTaxRate.value,
        iskTaxRateStdDev: iskTaxRateStdDev.value,
        seed: baseSeed,
      }

      // Create VP parameters
      const vpParams: InputParameters = {
        ...baseParams,
        seed: baseSeed,
      }

      const paramSets = [iskParams, vpParams]
      const labels = ['ISK', 'VP']

      // Create plain object copy for worker
      const plainParamSets = JSON.parse(JSON.stringify(paramSets))

      // Wait for results from worker
      const results = await new Promise<SimulationResults>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'progress') {
            progress.value = e.data.progress
          } else if (e.data.type === 'complete') {
            resolve(e.data.results as SimulationResults)
          } else if (e.data.type === 'error') {
            console.error('Worker error:', e.data.error.message)
            console.error('Stack:', e.data.error.stack)
            const error = new Error(e.data.error.message)
            error.stack = e.data.error.stack
            reject(error)
          }
        }

        worker.onerror = (error) => {
          console.error('Worker onerror:', error)
          reject(error)
        }

        // Start simulation
        worker.postMessage({ paramSets: plainParamSets, labels })
      })

      simulationResults.value = results

      // Save to history (save ISK params as the representative parameters)
      const historyStore = useHistoryStore()
      historyStore.addRecord(iskParams, results)
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
    simulationResults.value = null
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
    assets.value = params.assets
    assetCorrelationMatrix.value = params.assetCorrelationMatrix
    assetRebalanceFrequency.value = params.assetRebalanceFrequency
    balanceWithdrawalRate.value = params.balanceWithdrawalRate
    profitWithdrawalRate.value = params.profitWithdrawalRate
    profitLookbackYears.value = params.profitLookbackYears
    inflationBasedWithdrawal.value = params.inflationBasedWithdrawal
    inflationRate.value = params.inflationRate
    inflationStdDev.value = params.inflationStdDev
    vpFundTaxRate.value = params.vpWealthTaxRate
    capitalGainsTax.value = params.capitalGainsTaxRate
    seed.value = params.seed

    // ISK-specific parameters (may be undefined for VP)
    if (params.iskTaxRate !== undefined) {
      iskTaxRate.value = params.iskTaxRate
    }
    if (params.iskTaxRateStdDev !== undefined) {
      iskTaxRateStdDev.value = params.iskTaxRateStdDev
    }
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
            if (urlParams.assets !== undefined) assets.value = urlParams.assets
            if (urlParams.assetCorrelationMatrix !== undefined)
              assetCorrelationMatrix.value = urlParams.assetCorrelationMatrix
            if (urlParams.assetRebalanceFrequency !== undefined)
              assetRebalanceFrequency.value = urlParams.assetRebalanceFrequency
            if (urlParams.balanceWithdrawalRate !== undefined)
              balanceWithdrawalRate.value = urlParams.balanceWithdrawalRate
            if (urlParams.profitWithdrawalRate !== undefined)
              profitWithdrawalRate.value = urlParams.profitWithdrawalRate
            if (urlParams.profitLookbackYears !== undefined)
              profitLookbackYears.value = urlParams.profitLookbackYears
            if (urlParams.inflationBasedWithdrawal !== undefined)
              inflationBasedWithdrawal.value = urlParams.inflationBasedWithdrawal
            if (urlParams.inflationRate !== undefined) inflationRate.value = urlParams.inflationRate
            if (urlParams.inflationStdDev !== undefined)
              inflationStdDev.value = urlParams.inflationStdDev
            if (urlParams.vpWealthTaxRate !== undefined)
              vpFundTaxRate.value = urlParams.vpWealthTaxRate
            if (urlParams.capitalGainsTaxRate !== undefined)
              capitalGainsTax.value = urlParams.capitalGainsTaxRate
            if (urlParams.iskTaxRate !== undefined) iskTaxRate.value = urlParams.iskTaxRate
            if (urlParams.iskTaxRateStdDev !== undefined)
              iskTaxRateStdDev.value = urlParams.iskTaxRateStdDev
            if (urlParams.seed !== undefined) seed.value = urlParams.seed
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
      [
        initialCapital,
        assets,
        assetCorrelationMatrix,
        assetRebalanceFrequency,
        balanceWithdrawalRate,
        profitWithdrawalRate,
        profitLookbackYears,
        inflationBasedWithdrawal,
        iskTaxRate,
        iskTaxRateStdDev,
        inflationRate,
        inflationStdDev,
        vpFundTaxRate,
        capitalGainsTax,
        startYear,
        yearsLater,
        simulationCount,
        seed,
      ],
      () => {
        if (isUpdatingFromUrl) return

        if (timeoutId) clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          const params: InputParameters = {
            ...createBaseParameters(),
            iskTaxRate: iskTaxRate.value,
            iskTaxRateStdDev: iskTaxRateStdDev.value,
            seed: seed.value ?? '',
          }
          const query = encodeParamsToUrl(params)
          router.replace({ query })
        }, 500)
      },
      { deep: true },
    )
  }

  // Computed helper to extract final period statistics in a component-friendly format
  const summaryData = computed(() => {
    if (!simulationResults.value) return null

    const { statistics, medianSamples } = simulationResults.value
    if (statistics.length < 2) return null

    const iskStats = statistics[0]!
    const vpStats = statistics[1]!
    const iskSample = medianSamples[0]!

    // Get final period index
    const finalPeriod = iskSample.snapshots.liquidValue.length - 1

    return {
      isk: {
        median: {
          liquidValue: iskStats.median.snapshots.liquidValue[finalPeriod] ?? 0,
          paidTax: iskStats.median.snapshots.tax[finalPeriod] ?? 0,
          taxationDegree: iskStats.median.snapshots.taxationDegree[finalPeriod] ?? 0,
          realWithdrawal: iskStats.median.periodData.withdrawalReal[finalPeriod] ?? 0,
          accumulatedRealWithdrawal: iskStats.median.snapshots.withdrawalReal[finalPeriod] ?? 0,
        },
        mean: {
          liquidValue: iskStats.mean.snapshots.liquidValue[finalPeriod] ?? 0,
        },
      },
      vp: {
        median: {
          liquidValue: vpStats.median.snapshots.liquidValue[finalPeriod] ?? 0,
          paidTax: vpStats.median.snapshots.tax[finalPeriod] ?? 0,
          taxationDegree: vpStats.median.snapshots.taxationDegree[finalPeriod] ?? 0,
          realWithdrawal: vpStats.median.periodData.withdrawalReal[finalPeriod] ?? 0,
          accumulatedRealWithdrawal: vpStats.median.snapshots.withdrawalReal[finalPeriod] ?? 0,
        },
        mean: {
          liquidValue: vpStats.mean.snapshots.liquidValue[finalPeriod] ?? 0,
        },
      },
    }
  })

  return {
    // Input parameters
    initialCapital,
    assets,
    assetCorrelationMatrix,
    assetRebalanceFrequency,
    balanceWithdrawalRate,
    profitWithdrawalRate,
    profitLookbackYears,
    inflationBasedWithdrawal,
    iskTaxRate,
    iskTaxRateStdDev,
    inflationRate,
    inflationStdDev,
    vpFundTaxRate,
    capitalGainsTax,
    startYear,
    yearsLater,
    simulationCount,
    seed,

    // State
    isRunning,
    progress,
    simulationResults,
    summaryData,
    showDetailedStatistics,

    // Actions
    runSimulation,
    resetResults,
    loadParameters,
    initUrlSync,
  }
})
