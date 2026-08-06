import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import {
  ASSET_CLASS_PRESETS,
  assetFromPreset,
  buildCashflow,
  defaultPlannerParameters,
  presetCorrelation,
  resizeCashflow,
} from '../planner/assets'
import { runPlanner } from '../planner/propagate'
import { decodePlan, encodePlan } from '../planner/url'
import type {
  CashflowYear,
  PlannerAccountType,
  PlannerAsset,
  PlannerParameters,
  PlannerResults,
} from '../planner/types'

/** Debounce for recomputing and for pushing the URL, in milliseconds. */
const RECOMPUTE_DELAY = 150

export const usePlannerStore = defineStore('planner', () => {
  const defaults = defaultPlannerParameters()

  const initialCapital = ref(defaults.initialCapital)
  const startAge = ref(defaults.startAge)
  const years = ref(defaults.years)
  const assets = ref<PlannerAsset[]>(defaults.assets)
  const correlations = ref<number[][]>(defaults.correlations)
  const accountType = ref<PlannerAccountType>(defaults.accountType)
  const iskTaxRate = ref(defaults.iskTaxRate)
  const capitalGainsTaxRate = ref(defaults.capitalGainsTaxRate)
  const iskAllowance = ref(defaults.iskAllowance)
  const inflationRate = ref(defaults.inflationRate)
  const cashflow = ref<CashflowYear[]>(defaults.cashflow)
  const gridNodes = ref(defaults.gridNodes)
  const quadratureNodes = ref(defaults.quadratureNodes)

  const results = ref<PlannerResults | null>(null)
  const error = ref<string | null>(null)

  // Internal, not part of the store's public surface.
  const _internal = {
    recomputeTimer: null as ReturnType<typeof setTimeout> | null,
    urlTimer: null as ReturnType<typeof setTimeout> | null,
    urlSyncActive: false,
  }

  const parameters = computed<PlannerParameters>(() => ({
    initialCapital: initialCapital.value,
    startAge: startAge.value,
    years: years.value,
    assets: assets.value,
    correlations: correlations.value,
    accountType: accountType.value,
    iskTaxRate: iskTaxRate.value,
    capitalGainsTaxRate: capitalGainsTaxRate.value,
    iskAllowance: iskAllowance.value,
    inflationRate: inflationRate.value,
    cashflow: cashflow.value,
    gridNodes: gridNodes.value,
    quadratureNodes: quadratureNodes.value,
  }))

  function loadParameters(params: PlannerParameters) {
    initialCapital.value = params.initialCapital
    startAge.value = params.startAge
    years.value = params.years
    assets.value = params.assets.map((asset) => ({ ...asset }))
    correlations.value = params.correlations.map((row) => [...row])
    accountType.value = params.accountType
    iskTaxRate.value = params.iskTaxRate
    capitalGainsTaxRate.value = params.capitalGainsTaxRate
    iskAllowance.value = params.iskAllowance
    inflationRate.value = params.inflationRate
    cashflow.value = params.cashflow.map((entry) => ({ ...entry }))
  }

  function run() {
    try {
      results.value = runPlanner(parameters.value)
      error.value = null
    } catch (cause) {
      // Surface the failure instead of leaving a stale chart on screen, which
      // would look like a valid answer to an invalid plan.
      results.value = null
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function scheduleRun() {
    if (_internal.recomputeTimer !== null) clearTimeout(_internal.recomputeTimer)
    _internal.recomputeTimer = setTimeout(() => {
      _internal.recomputeTimer = null
      run()
    }, RECOMPUTE_DELAY)
  }

  // --- Cash flow editing -----------------------------------------------

  /** Sets floor and/or optional across an inclusive range of year indices. */
  function setCashflowRange(
    from: number,
    to: number,
    values: { floor?: number; optional?: number },
  ) {
    const start = Math.max(0, Math.min(from, to))
    const end = Math.min(cashflow.value.length - 1, Math.max(from, to))
    if (end < start) return

    // A new array reference, because Vue does not track in-place mutation of
    // nested objects deeply enough for the chart watchers to fire reliably.
    const next = cashflow.value.map((entry, index) => {
      if (index < start || index > end) return entry
      return {
        floor: values.floor ?? entry.floor,
        // The optional top-up is defined as an amount above the floor, so a
        // negative one would silently mean "withdraw less than the floor".
        optional: Math.max(0, values.optional ?? entry.optional),
      }
    })
    cashflow.value = next
  }

  function setFlatCashflow(floor: number, optional: number) {
    cashflow.value = buildCashflow(years.value, floor, Math.max(0, optional))
  }

  // --- Portfolio editing ------------------------------------------------

  /** Instance ids must stay unique even when the same preset is added twice. */
  function uniqueAssetId(base: string): string {
    const taken = new Set(assets.value.map((asset) => asset.id))
    if (!taken.has(base)) return base
    for (let suffix = 2; ; suffix++) {
      const candidate = `${base}-${suffix}`
      if (!taken.has(candidate)) return candidate
    }
  }

  /**
   * Adds a class from the catalogue, or a blank asset when `presetId` names
   * nothing. New correlations come from the catalogue rather than a flat
   * placeholder, so a class removed and added back returns with the same
   * relationships it started with.
   */
  function addAsset(presetId?: string) {
    const preset = ASSET_CLASS_PRESETS.find((candidate) => candidate.id === presetId)
    const existing = assets.value
    const added = preset
      ? assetFromPreset(preset, uniqueAssetId(preset.id), 0)
      : {
          id: uniqueAssetId('egen'),
          name: 'Egen tillgång',
          weight: 0,
          expectedRealReturn: 0.04,
          volatility: 0.12,
        }

    assets.value = [...existing, added]
    correlations.value = [
      ...correlations.value.map((row, index) => [
        ...row,
        presetCorrelation(existing[index]?.presetId, added.presetId),
      ]),
      [...existing.map((asset) => presetCorrelation(asset.presetId, added.presetId)), 1],
    ]
  }

  function removeAsset(index: number) {
    if (assets.value.length <= 1) return
    assets.value = assets.value.filter((_, i) => i !== index)
    correlations.value = correlations.value
      .filter((_, i) => i !== index)
      .map((row) => row.filter((_, j) => j !== index))
  }

  function setCorrelation(i: number, j: number, value: number) {
    if (i === j) return
    const clamped = Math.max(-1, Math.min(1, value))
    const next = correlations.value.map((row) => [...row])
    next[i]![j] = clamped
    next[j]![i] = clamped
    correlations.value = next
  }

  // --- URL synchronisation ----------------------------------------------

  function pushUrl() {
    if (!_internal.urlSyncActive) return
    if (_internal.urlTimer !== null) clearTimeout(_internal.urlTimer)
    _internal.urlTimer = setTimeout(() => {
      _internal.urlTimer = null
      const encoded = encodePlan(parameters.value)
      window.history.replaceState(null, '', `${window.location.pathname}?${encoded}`)
    }, RECOMPUTE_DELAY * 2)
  }

  function initUrlSync() {
    loadParameters(decodePlan(window.location.search))
    _internal.urlSyncActive = true
    run()
  }

  // Keeping the schedule the same length as the horizon is an invariant the
  // engine enforces by throwing, so fix it up here rather than letting an
  // in-progress edit produce an error banner.
  watch(years, (next) => {
    if (cashflow.value.length !== next) {
      cashflow.value = resizeCashflow(cashflow.value, next)
    }
  })

  watch(
    parameters,
    () => {
      scheduleRun()
      pushUrl()
    },
    { deep: true },
  )

  return {
    // State
    initialCapital,
    startAge,
    years,
    assets,
    correlations,
    accountType,
    iskTaxRate,
    capitalGainsTaxRate,
    iskAllowance,
    inflationRate,
    cashflow,
    gridNodes,
    quadratureNodes,
    results,
    error,
    // Derived
    parameters,
    // Actions
    run,
    setCashflowRange,
    setFlatCashflow,
    addAsset,
    removeAsset,
    setCorrelation,
    initUrlSync,
  }
})
