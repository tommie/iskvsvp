import { defineStore } from 'pinia'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type {
  InputParameters,
  SimulationAsset,
  SimulationResults,
  RebalanceFrequency,
  ScenarioTable,
  ScenarioParameter,
  AccountType,
  AssetPropertyParameter,
} from '../types'

// Union type for scenario parameter values
type ScenarioValue =
  | string
  | number
  | boolean
  | AccountType
  | RebalanceFrequency
  | SimulationAsset[]
  | number[][]
  | undefined
import { isAssetPropertyParameter, parseAssetPropertyParameter } from '../types'
import { useHistoryStore } from './history'
import {
  encodeParamsToUrl,
  decodeParamsFromUrl,
  encodeScenarioTableToUrl,
  decodeScenarioTableFromUrl,
} from '../utils/url-params'
import { DEFAULT_ASSET_CLASSES, DEFAULT_CORRELATIONS } from '../assets'
import SimulationWorker from '../simulation.worker?worker'

export const useCalculatorStore = defineStore('calculator', () => {
  // Input parameters
  const accountType = ref<'ISK' | 'VP'>('ISK') // UI-only state for account type dropdown
  const initialCapital = ref(5000000)

  // Default assets: the asset-class catalogue's own starting portfolio. Copied,
  // because the arrays are edited in place by the UI.
  const assets = ref<SimulationAsset[]>(DEFAULT_ASSET_CLASSES.map((asset) => ({ ...asset })))
  const assetCorrelationMatrix = ref<number[][]>(DEFAULT_CORRELATIONS.map((row) => [...row]))
  // Annual, matching the planner's assumption, so the two read alike.
  const assetRebalanceFrequency = ref<RebalanceFrequency>('annually')

  const depositAmount = ref(0)
  const depositYears = ref(0)
  // 2.2% of the capital as need and up to 3.3% with the extra, as in the
  // planner: a need the portfolio can carry is the premise the rule is built on.
  const withdrawalNeed = ref(110_000)
  const withdrawalExtra = ref(55_000)
  const bequestAmount = ref(0)
  const ageAdjustedSpending = ref(false)
  // Long-run level of the schablon basis rate (statslåneränta + 1 point), not
  // the current spot value: holding one year's rate for decades lets short-term
  // rate moves drive the answer. 4% implies a ~3% real long-run SLR.
  const iskTaxRate = ref<number | undefined>(0.04)
  const iskTaxRateStdDev = ref<number | undefined>(0.005)
  const inflationRate = ref(0.02)
  const inflationStdDev = ref(0.009) // Barely any negative years
  const vpFundTaxRate = ref(0.004) // VP fund tax rate (0.4%)
  const capitalGainsTax = ref(0.3)
  const startYear = ref(45)
  const yearsLater = ref(36)
  const simulationCount = ref(1000)
  const seed = ref<string | undefined>(undefined)

  // Scenario table state
  const scenarioTable = ref<ScenarioTable | null>(null)
  const isAddToTableMode = ref(false)

  // Simulation state
  const isRunning = ref(false)
  const progress = ref(0)
  const simulationResults = shallowRef<SimulationResults | null>(null)
  const showDetailedStatistics = ref(false)

  // Computed: get list of parameters controlled by the scenario table
  const controlledParameters = computed(() => {
    if (!scenarioTable.value || scenarioTable.value.scenarios.length === 0) {
      return new Set<ScenarioParameter>()
    }

    // Collect all parameter keys from all scenarios
    const params = new Set<ScenarioParameter>()
    for (const scenario of scenarioTable.value.scenarios) {
      for (const key of Object.keys(scenario.parameters) as ScenarioParameter[]) {
        params.add(key)
      }
    }
    return params
  })

  // Check if a parameter is controlled by the scenario table
  const isParameterControlled = (paramKey: ScenarioParameter): boolean => {
    return controlledParameters.value.has(paramKey)
  }

  // Scenario table actions
  function enableScenarioTable() {
    if (!scenarioTable.value) {
      scenarioTable.value = {
        scenarios: [
          { label: 'ISK', parameters: { accountType: 'ISK' } },
          { label: 'VP', parameters: { accountType: 'VP' } },
        ],
      }
    }
  }

  function disableScenarioTable() {
    scenarioTable.value = null
    isAddToTableMode.value = false
  }

  function generateSensitivityScenarios() {
    type ParamVariation = {
      key: ScenarioParameter
      upLabel: string
      downLabel: string
      upValue: number
      downValue: number
    }

    const variations: ParamVariation[] = []

    // Inflation: ±1 stddev (only if stddev > 0)
    if (inflationStdDev.value > 0) {
      variations.push({
        key: 'inflationRate',
        upLabel: 'Inflation +1σ',
        downLabel: 'Inflation -1σ',
        upValue: inflationRate.value + inflationStdDev.value,
        downValue: inflationRate.value - inflationStdDev.value,
      })
    }

    // Need: ×0.5/×2 (only if > 0)
    if (withdrawalNeed.value > 0) {
      variations.push({
        key: 'withdrawalNeed',
        upLabel: 'Behov ×2',
        downLabel: 'Behov ×½',
        upValue: withdrawalNeed.value * 2,
        downValue: withdrawalNeed.value * 0.5,
      })
    }

    // Extra: ×0.5/×2 (only if > 0)
    if (withdrawalExtra.value > 0) {
      variations.push({
        key: 'withdrawalExtra',
        upLabel: 'Extra ×2',
        downLabel: 'Extra ×½',
        upValue: withdrawalExtra.value * 2,
        downValue: withdrawalExtra.value * 0.5,
      })
    }

    // Capital gains tax: ×0.5/×2
    variations.push({
      key: 'capitalGainsTaxRate',
      upLabel: 'Vinstskatt ×2',
      downLabel: 'Vinstskatt ×½',
      upValue: capitalGainsTax.value * 2,
      downValue: capitalGainsTax.value * 0.5,
    })

    // NOTE: yearsLater is excluded because the display layer assumes all
    // scenarios have the same number of periods.

    // Build scenarios: base + up/down for each variation
    const baseScenario = {
      label: 'Bas',
      parameters: {} as Record<string, ScenarioValue>,
    }

    // Add all varied parameter keys to base with their base values
    for (const v of variations) {
      baseScenario.parameters[v.key] = getCurrentParameterValue(v.key)
    }

    const scenarios = [baseScenario]

    for (const v of variations) {
      // Down scenario
      const downParams: Record<string, ScenarioValue> = {}
      for (const v2 of variations) {
        downParams[v2.key] = getCurrentParameterValue(v2.key)
      }
      downParams[v.key] = v.downValue
      scenarios.push({ label: v.downLabel, parameters: downParams })

      // Up scenario
      const upParams: Record<string, ScenarioValue> = {}
      for (const v2 of variations) {
        upParams[v2.key] = getCurrentParameterValue(v2.key)
      }
      upParams[v.key] = v.upValue
      scenarios.push({ label: v.upLabel, parameters: upParams })
    }

    scenarioTable.value = { scenarios } as ScenarioTable
  }

  function toggleAddToTableMode() {
    if (!scenarioTable.value) {
      enableScenarioTable()
    }
    isAddToTableMode.value = !isAddToTableMode.value
  }

  function addParameterToTable(paramKey: ScenarioParameter) {
    if (!scenarioTable.value) {
      enableScenarioTable()
    }

    // Get current value of the parameter
    const currentValue = getCurrentParameterValue(paramKey)

    // Add the parameter with current value to all scenarios
    for (const scenario of scenarioTable.value!.scenarios) {
      if (!(paramKey in scenario.parameters)) {
        // Type assertion needed: dynamic property assignment
        ;(scenario.parameters as Record<string, ScenarioValue>)[paramKey] = currentValue
      }
    }
  }

  function removeParameterFromTable(paramKey: ScenarioParameter) {
    if (!scenarioTable.value) return

    // Remove the parameter from all scenarios
    for (const scenario of scenarioTable.value.scenarios) {
      delete scenario.parameters[paramKey]
    }
  }

  function addScenario(label?: string) {
    if (!scenarioTable.value) {
      enableScenarioTable()
    }

    const scenarioCount = scenarioTable.value!.scenarios.length
    const newScenario = {
      label: label ?? `Scenario ${scenarioCount + 1}`,
      parameters: {} as Partial<InputParameters>,
    }

    // Copy controlled parameters from the first scenario as defaults
    if (scenarioTable.value!.scenarios.length > 0) {
      const firstScenario = scenarioTable.value!.scenarios[0]!
      for (const key of Object.keys(firstScenario.parameters) as ScenarioParameter[]) {
        const value = firstScenario.parameters[key] as ScenarioValue
        if (value !== undefined) {
          ;(newScenario.parameters as Record<string, ScenarioValue>)[key] = value
        }
      }
    }

    scenarioTable.value!.scenarios.push(newScenario)
  }

  function removeScenario(index: number) {
    if (!scenarioTable.value) return
    if (scenarioTable.value.scenarios.length <= 1) {
      // Don't allow removing if only 1 scenario left
      return
    }

    scenarioTable.value.scenarios.splice(index, 1)
  }

  function updateScenarioLabel(index: number, label: string) {
    if (!scenarioTable.value) return
    if (index < 0 || index >= scenarioTable.value.scenarios.length) return

    scenarioTable.value.scenarios[index]!.label = label
  }

  function updateScenarioValue(
    scenarioIndex: number,
    paramKey: ScenarioParameter,
    value: ScenarioValue,
  ) {
    if (!scenarioTable.value) return
    if (scenarioIndex < 0 || scenarioIndex >= scenarioTable.value.scenarios.length)
      return // Type assertion needed: dynamic property assignment
    ;(scenarioTable.value.scenarios[scenarioIndex]!.parameters as Record<string, ScenarioValue>)[
      paramKey
    ] = value
  }

  // Helper to get current parameter value from the store
  function getCurrentParameterValue(paramKey: ScenarioParameter): ScenarioValue {
    // Check if it's an asset property parameter
    if (isAssetPropertyParameter(paramKey)) {
      const parsed = parseAssetPropertyParameter(paramKey)
      if (parsed && parsed.index < assets.value.length) {
        return assets.value[parsed.index]![parsed.property]
      }
      return undefined
    }

    const paramMap: Record<string, ScenarioValue> = {
      accountType: accountType.value,
      initialCapital: initialCapital.value,
      startYear: startYear.value,
      yearsLater: yearsLater.value,
      simulationCount: simulationCount.value,
      assets: assets.value,
      assetCorrelationMatrix: assetCorrelationMatrix.value,
      assetRebalanceFrequency: assetRebalanceFrequency.value,
      depositAmount: depositAmount.value,
      depositYears: depositYears.value,
      withdrawalNeed: withdrawalNeed.value,
      withdrawalExtra: withdrawalExtra.value,
      bequestAmount: bequestAmount.value,
      ageAdjustedSpending: ageAdjustedSpending.value,
      vpWealthTaxRate: vpFundTaxRate.value,
      capitalGainsTaxRate: capitalGainsTax.value,
      iskTaxRate: iskTaxRate.value,
      iskTaxRateStdDev: iskTaxRateStdDev.value,
      inflationRate: inflationRate.value,
      inflationStdDev: inflationStdDev.value,
    }
    return paramMap[paramKey]
  }

  // Helper to create base parameters
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
    depositAmount: depositAmount.value,
    depositYears: Math.min(depositYears.value, yearsLater.value),
    withdrawalNeed: withdrawalNeed.value,
    withdrawalExtra: withdrawalExtra.value,
    bequestAmount: bequestAmount.value,
    ageAdjustedSpending: ageAdjustedSpending.value,
    vpWealthTaxRate: vpFundTaxRate.value,
    capitalGainsTaxRate: capitalGainsTax.value,
    inflationRate: inflationRate.value,
    inflationStdDev: inflationStdDev.value,
  })

  /**
   * Run the Monte Carlo simulation.
   * If scenario table is enabled, runs scenarios from the table.
   * Otherwise, runs default ISK scenario.
   */
  async function runSimulation() {
    const worker = new SimulationWorker()

    isRunning.value = true
    isAddToTableMode.value = false
    progress.value = 0

    try {
      const baseSeed = seed.value ?? Math.random().toString(36).substring(2, 15)
      let paramSets: InputParameters[]
      let labels: string[]

      if (scenarioTable.value && scenarioTable.value.scenarios.length > 0) {
        // Use scenario table scenarios
        paramSets = []
        labels = []

        for (const scenario of scenarioTable.value.scenarios) {
          const baseParams = createBaseParameters()

          // Extract UI-only and asset property parameters
          const { accountType: scenarioAccountType, ...restParams } = scenario.parameters
          const actualParams: Record<string, unknown> = {}
          const assetPropertyOverrides: Record<number, Partial<SimulationAsset>> = {}

          // Separate asset property overrides from regular parameters
          for (const [key, value] of Object.entries(restParams)) {
            if (isAssetPropertyParameter(key)) {
              const parsed = parseAssetPropertyParameter(key as AssetPropertyParameter)
              if (parsed) {
                if (!assetPropertyOverrides[parsed.index]) {
                  assetPropertyOverrides[parsed.index] = {}
                }
                assetPropertyOverrides[parsed.index]![parsed.property] = value as number
              }
            } else {
              actualParams[key] = value
            }
          }

          // Merge scenario-specific parameters (excluding accountType and asset properties)
          const scenarioParams: InputParameters = {
            ...baseParams,
            ...actualParams,
            seed: baseSeed,
          }

          // Apply asset property overrides
          if (Object.keys(assetPropertyOverrides).length > 0) {
            scenarioParams.assets = scenarioParams.assets.map((asset, index) => {
              const overrides = assetPropertyOverrides[index]
              if (overrides) {
                return { ...asset, ...overrides }
              }
              return asset
            })
          }

          // If account type is ISK and iskTaxRate is not set, use default values
          const effectiveAccountType = scenarioAccountType || accountType.value
          if (effectiveAccountType === 'ISK' && scenarioParams.iskTaxRate === undefined) {
            scenarioParams.iskTaxRate = iskTaxRate.value
            scenarioParams.iskTaxRateStdDev = iskTaxRateStdDev.value
          }

          paramSets.push(scenarioParams)
          labels.push(scenario.label)
        }
      } else {
        // Default: single scenario based on selected account type
        const baseParams = createBaseParameters()

        const params: InputParameters = {
          ...baseParams,
          seed: baseSeed,
        }

        // Add ISK-specific parameters if ISK is selected
        if (accountType.value === 'ISK') {
          params.iskTaxRate = iskTaxRate.value
          params.iskTaxRateStdDev = iskTaxRateStdDev.value
        }

        paramSets = [params]
        labels = [accountType.value]
      }

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

      // Save to history (save first scenario params as the representative parameters)
      const historyStore = useHistoryStore()
      historyStore.addRecord(paramSets[0]!, results)
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
    depositAmount.value = params.depositAmount
    depositYears.value = params.depositYears
    withdrawalNeed.value = params.withdrawalNeed
    withdrawalExtra.value = params.withdrawalExtra
    bequestAmount.value = params.bequestAmount
    ageAdjustedSpending.value = params.ageAdjustedSpending ?? false
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
        // Always try to load scenario table first
        const urlScenarioTable = decodeScenarioTableFromUrl(route.query)

        // Always try to load base parameters
        const urlParams = decodeParamsFromUrl(route.query)

        if ((urlScenarioTable || urlParams) && Object.keys(route.query).length > 0) {
          isUpdatingFromUrl = true

          try {
            // Load base parameters (non-controlled parameters when table is enabled)
            if (urlParams && Object.keys(urlParams).length > 0) {
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
              if (urlParams.depositAmount !== undefined)
                depositAmount.value = urlParams.depositAmount
              if (urlParams.depositYears !== undefined) depositYears.value = urlParams.depositYears
              if (urlParams.withdrawalNeed !== undefined)
                withdrawalNeed.value = urlParams.withdrawalNeed
              if (urlParams.withdrawalExtra !== undefined)
                withdrawalExtra.value = urlParams.withdrawalExtra
              if (urlParams.bequestAmount !== undefined)
                bequestAmount.value = urlParams.bequestAmount
              if (urlParams.ageAdjustedSpending !== undefined)
                ageAdjustedSpending.value = urlParams.ageAdjustedSpending
              if (urlParams.inflationRate !== undefined)
                inflationRate.value = urlParams.inflationRate
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
            }

            // Load scenario table from URL
            if (urlScenarioTable) {
              scenarioTable.value = urlScenarioTable
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
      [
        scenarioTable,
        initialCapital,
        assets,
        assetCorrelationMatrix,
        assetRebalanceFrequency,
        depositAmount,
        depositYears,
        withdrawalNeed,
        withdrawalExtra,
        bequestAmount,
        ageAdjustedSpending,
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
          let query: Record<string, string | string[]>

          // Build base parameters
          const params: InputParameters = {
            ...createBaseParameters(),
            iskTaxRate: iskTaxRate.value,
            iskTaxRateStdDev: iskTaxRateStdDev.value,
            seed: seed.value ?? '',
          }

          if (scenarioTable.value) {
            // Encode scenario table to URL along with base parameters
            query = encodeScenarioTableToUrl(scenarioTable.value, params)
          } else {
            // Encode regular parameters to URL
            query = encodeParamsToUrl(params)
          }

          router.replace({ query })
        }, 500)
      },
      { deep: true },
    )
  }

  return {
    // Input parameters
    accountType,
    initialCapital,
    assets,
    assetCorrelationMatrix,
    assetRebalanceFrequency,
    depositAmount,
    depositYears,
    withdrawalNeed,
    withdrawalExtra,
    bequestAmount,
    ageAdjustedSpending,
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
    showDetailedStatistics,

    // Scenario table state
    scenarioTable,
    isAddToTableMode,
    controlledParameters,

    // Actions
    runSimulation,
    resetResults,
    loadParameters,
    initUrlSync,

    // Scenario table actions
    isParameterControlled,
    enableScenarioTable,
    disableScenarioTable,
    toggleAddToTableMode,
    addParameterToTable,
    removeParameterFromTable,
    addScenario,
    removeScenario,
    updateScenarioLabel,
    updateScenarioValue,
    generateSensitivityScenarios,
  }
})
