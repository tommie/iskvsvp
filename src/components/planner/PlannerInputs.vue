<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { usePlannerStore } from '../../stores/planner'
import type { PlannerAsset } from '../../planner/types'
import { ASSET_CLASS_PRESETS } from '../../planner/assets'
import { formatKr, formatPercent } from '../../planner/format'

const store = usePlannerStore()
const {
  initialCapital,
  startAge,
  years,
  assets,
  correlations,
  accountType,
  iskTaxRate,
  capitalGainsTaxRate,
  iskAllowance,
  afSchablonRate,
  initialCostBasisRatio,
  inflationRate,
  results,
} = storeToRefs(store)

const isAF = computed(() => accountType.value === 'AF')

/** The cost basis in kronor that the ratio implies, which is what a tax return states. */
const costBasisAmount = computed(() => initialCapital.value * initialCostBasisRatio.value)

const weightSum = computed(() => assets.value.reduce((sum, asset) => sum + asset.weight, 0))

/** Replaces one asset, creating a new array so nested edits stay reactive. */
function updateAsset(index: number, patch: Partial<PlannerAsset>) {
  assets.value = assets.value.map((asset, i) => (i === index ? { ...asset, ...patch } : asset))
}

// Bootstrap's dropdown is the right component for a menu of actions, but the
// project loads Bootstrap's CSS without its JS, so the open state is driven
// from Vue — the same way the tab strips elsewhere in the app work. The
// menu carries data-bs-popper="static" because Bootstrap gates the dropdown's
// positioning rules behind that attribute, which Popper would otherwise set.
const menuOpen = ref(false)
const menu = ref<HTMLElement | null>(null)

function addPreset(presetId?: string) {
  store.addAsset(presetId)
  menuOpen.value = false
}

function closeMenuOnOutsideClick(event: MouseEvent) {
  if (!menuOpen.value) return
  const target = event.target
  if (target instanceof Node && menu.value?.contains(target)) return
  menuOpen.value = false
}

function closeMenuOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', closeMenuOnOutsideClick)
  document.addEventListener('keydown', closeMenuOnEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeMenuOnOutsideClick)
  document.removeEventListener('keydown', closeMenuOnEscape)
})

function onNumber(event: Event, apply: (value: number) => void, scale = 1) {
  const raw = parseFloat((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  apply(raw / scale)
}

const portfolioSummary = computed(() => {
  const moments = results.value?.portfolio
  if (!moments) return null
  return {
    expectedReturn: moments.expectedReturn * 100,
    volatility: moments.volatility * 100,
    // The median compound rate the plan actually grows at, which is what the
    // arithmetic mean overstates and what most withdrawal rules of thumb are
    // implicitly quoting.
    geometric: (Math.exp(moments.logMean) - 1) * 100,
    turnover: moments.rebalancingTurnover * 100,
  }
})
</script>

<template>
  <div class="row g-3 mb-3">
    <div class="col-12 col-md-6">
      <div class="card h-100">
        <div class="card-header">Utgångsläge</div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-6">
              <label class="form-label" for="planner-capital">Startkapital (kr)</label>
              <input
                id="planner-capital"
                v-model.number="initialCapital"
                type="number"
                min="0"
                step="100000"
                class="form-control"
              />
            </div>
            <div class="col-6">
              <label class="form-label" for="planner-account">Kontotyp</label>
              <select id="planner-account" v-model="accountType" class="form-select">
                <option value="ISK">ISK</option>
                <option value="AF">Aktie- och fondkonto (AF)</option>
              </select>
            </div>
            <div class="col-6">
              <label class="form-label" for="planner-age">Startålder</label>
              <input
                id="planner-age"
                v-model.number="startAge"
                type="number"
                min="0"
                max="120"
                class="form-control"
              />
            </div>
            <div class="col-6">
              <label class="form-label" for="planner-years">Tidsperiod (år)</label>
              <input
                id="planner-years"
                v-model.number="years"
                type="number"
                min="1"
                max="100"
                class="form-control"
              />
            </div>
            <div v-if="isAF" class="col-6">
              <label class="form-label" for="planner-basis">Omkostnadsbelopp (%)</label>
              <input
                id="planner-basis"
                type="number"
                step="5"
                min="0"
                class="form-control"
                :value="(initialCostBasisRatio * 100).toFixed(0)"
                @change="onNumber($event, (v) => (initialCostBasisRatio = v), 100)"
              />
              <div class="form-text">
                {{ formatKr(costBasisAmount) }} av startkapitalet. 100&nbsp;% betyder att inget är
                orealiserad vinst.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="col-12 col-md-6">
      <div class="card h-100">
        <div class="card-header">Antaganden</div>
        <div class="card-body">
          <div class="row g-3">
            <div class="col-6">
              <label class="form-label" for="planner-inflation">Inflation (%)</label>
              <input
                id="planner-inflation"
                type="number"
                step="0.1"
                class="form-control"
                :value="(inflationRate * 100).toFixed(1)"
                @change="onNumber($event, (v) => (inflationRate = v), 100)"
              />
            </div>
            <div v-if="!isAF" class="col-6">
              <label class="form-label" for="planner-isk-rate">ISK schablonränta (%)</label>
              <input
                id="planner-isk-rate"
                type="number"
                step="0.01"
                class="form-control"
                :value="(iskTaxRate * 100).toFixed(2)"
                @change="onNumber($event, (v) => (iskTaxRate = v), 100)"
              />
            </div>
            <div v-else class="col-6">
              <label class="form-label" for="planner-vp-rate">Schablonintäkt fonder (%)</label>
              <input
                id="planner-vp-rate"
                type="number"
                step="0.1"
                class="form-control"
                :value="(afSchablonRate * 100).toFixed(2)"
                @change="onNumber($event, (v) => (afSchablonRate = v), 100)"
              />
            </div>
            <div class="col-6">
              <label class="form-label" for="planner-cgt">Kapitalskatt (%)</label>
              <input
                id="planner-cgt"
                type="number"
                step="0.5"
                class="form-control"
                :value="(capitalGainsTaxRate * 100).toFixed(1)"
                @change="onNumber($event, (v) => (capitalGainsTaxRate = v), 100)"
              />
            </div>
            <div v-if="!isAF" class="col-6">
              <label class="form-label" for="planner-allowance">Fribelopp ISK (kr)</label>
              <input
                id="planner-allowance"
                v-model.number="iskAllowance"
                type="number"
                min="0"
                step="50000"
                class="form-control"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card mb-3">
    <div class="card-header d-flex justify-content-between align-items-center gap-2">
      <span>Portfölj (tillgångsslag, reala avkastningar)</span>
      <div ref="menu" class="dropdown">
        <button
          class="btn btn-sm btn-outline-primary dropdown-toggle"
          type="button"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          Lägg till tillgångsslag
        </button>
        <ul
          class="dropdown-menu dropdown-menu-end"
          :class="{ show: menuOpen }"
          data-bs-popper="static"
        >
          <li v-for="preset in ASSET_CLASS_PRESETS" :key="preset.id">
            <button class="dropdown-item" type="button" @click="addPreset(preset.id)">
              {{ preset.name }}
            </button>
          </li>
          <li><hr class="dropdown-divider" /></li>
          <li>
            <button class="dropdown-item" type="button" @click="addPreset()">Egen tillgång</button>
          </li>
        </ul>
      </div>
    </div>
    <div class="card-body">
      <div class="table-responsive">
        <table class="table table-sm align-middle mb-2">
          <thead>
            <tr>
              <th class="col-number">Vikt (%)</th>
              <th class="col-number">Avkastning (%)</th>
              <th class="col-number">Volatilitet (%)</th>
              <th class="col-name">Tillgångsslag</th>
              <th class="col-action"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(asset, index) in assets" :key="asset.id">
              <td class="col-number">
                <input
                  type="number"
                  step="1"
                  min="0"
                  class="form-control form-control-sm text-end"
                  :value="(asset.weight * 100).toFixed(0)"
                  @change="onNumber($event, (v) => updateAsset(index, { weight: v }), 100)"
                />
              </td>
              <td class="col-number">
                <input
                  type="number"
                  step="0.1"
                  class="form-control form-control-sm text-end"
                  :value="(asset.expectedRealReturn * 100).toFixed(2)"
                  @change="
                    onNumber($event, (v) => updateAsset(index, { expectedRealReturn: v }), 100)
                  "
                />
              </td>
              <td class="col-number">
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  class="form-control form-control-sm text-end"
                  :value="(asset.volatility * 100).toFixed(1)"
                  @change="onNumber($event, (v) => updateAsset(index, { volatility: v }), 100)"
                />
              </td>
              <td>
                <input
                  type="text"
                  class="form-control form-control-sm"
                  :value="asset.name"
                  @change="updateAsset(index, { name: ($event.target as HTMLInputElement).value })"
                />
              </td>
              <td class="col-action">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger"
                  :disabled="assets.length <= 1"
                  @click="store.removeAsset(index)"
                >
                  Ta bort
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="portfolioSummary" class="form-text mt-0 mb-2">
        Portföljen ger {{ formatPercent(portfolioSummary.expectedReturn) }} real aritmetisk
        avkastning, {{ formatPercent(portfolioSummary.geometric) }} median-CAGR och
        {{ formatPercent(portfolioSummary.volatility) }} volatilitet. Tillgångarna glider isär så
        pass att ombalanseringen omsätter {{ formatPercent(portfolioSummary.turnover) }} av
        portföljen per år<template v-if="isAF">, vilket realiserar vinst i ett AF-konto</template>.
      </p>

      <p v-if="Math.abs(weightSum - 1) > 0.005" class="small text-warning mb-3">
        Vikterna summerar till {{ formatPercent(weightSum * 100) }} och normaliseras innan
        beräkning.
      </p>

      <h6 class="mt-3">Korrelationer</h6>
      <div class="table-responsive">
        <table class="table table-sm table-bordered align-middle mb-0 correlation-table">
          <thead>
            <tr>
              <th></th>
              <th v-for="asset in assets" :key="asset.id" class="text-center small">
                {{ asset.name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(rowAsset, i) in assets" :key="rowAsset.id">
              <th class="small">{{ rowAsset.name }}</th>
              <td v-for="(colAsset, j) in assets" :key="colAsset.id" class="p-1">
                <span v-if="i === j" class="text-muted small d-block text-center">1,00</span>
                <span v-else-if="j < i" class="text-muted small d-block text-center">·</span>
                <input
                  v-else
                  type="number"
                  step="0.05"
                  min="-1"
                  max="1"
                  class="form-control form-control-sm text-center"
                  :value="(correlations[i]?.[j] ?? 0).toFixed(2)"
                  @change="onNumber($event, (v) => store.setCorrelation(i, j, v))"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="form-text mt-3 mb-0">
        Reala korrelationer. Avkastningarna ovan är aritmetiska medelvärden — variansdraget beräknas
        av modellen, så mata inte in geometriska medelvärden.
      </p>
    </div>
  </div>
</template>

<style scoped>
.correlation-table input {
  min-width: 4.5rem;
}

/* width:1% with nowrap is the shrink-to-fit idiom for table columns: the
   browser cannot honour 1%, so it falls back to the content's minimum width.
   The name column is left at auto and absorbs everything left over. */
.col-number,
.col-action {
  width: 1%;
  white-space: nowrap;
}

/* Without this the number inputs stretch and drag their columns wide again;
   four digits and a decimal is all any of these fields holds. */
.col-number input {
  width: 5rem;
}
</style>
