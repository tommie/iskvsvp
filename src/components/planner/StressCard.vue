<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useDebounced } from '../../composables/useDebounced'
import { usePlannerStore } from '../../stores/planner'
import CollapsibleCard from './CollapsibleCard.vue'
import {
  isStressed,
  stressDimensionsFor,
  stressScenarios,
  STRESS_DIMENSIONS,
  type Scenario,
  type StressLevels,
  type StressResult,
} from '../../planner/stress'
import { formatKr, formatPercent, formatPointChange, formatRelative } from '../../planner/format'

const { parameters, results } = storeToRefs(usePlannerStore())

/**
 * Whether the card is open, and so whether it computes at all.
 *
 * Closed is the default and closed costs nothing. Open, it follows the rest of
 * the page, so the figures beside a plan are always that plan's.
 */
const open = ref(false)

/**
 * Slider positions, 0 to 1, per dimension. All start at zero: the card should
 * open on the plan as entered and let the household decide what it doubts,
 * rather than assert a stress nobody asked for.
 */
const levels = ref<StressLevels>(
  Object.fromEntries(STRESS_DIMENSIONS.map((dimension) => [dimension.id, 0])),
)

/** Show each scenario as its change from the plan rather than as amounts. */
const relative = ref(false)

const scenarios = ref<Record<Scenario, StressResult> | null>(null)
const running = ref(false)
const error = ref<string | null>(null)

/** Only the dimensions this account type can actually be stressed on. */
const dimensions = computed(() => stressDimensionsFor(parameters.value))

const stressed = computed(() => isStressed(parameters.value, levels.value))

function compute() {
  if (!open.value) return
  running.value = true
  error.value = null
  // Yield once so the busy state paints before the propagations take the
  // thread; an AF plan spends a second or so here.
  window.setTimeout(() => {
    try {
      scenarios.value = stressScenarios(parameters.value, levels.value)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      scenarios.value = null
    } finally {
      running.value = false
    }
  }, 0)
}

/**
 * Long enough that dragging a slider across its range computes once, at the
 * end. Deliberately slower than the store's own recompute: three propagations
 * is most of a second on an AF plan, and paying it mid-drag would make the
 * slider feel stuck.
 */
const RECOMPUTE_DELAY = 350

const { schedule, cancel, pending } = useDebounced(compute, RECOMPUTE_DELAY)

/**
 * Recomputes with the rest of the results, and whenever a slider moves.
 *
 * Keyed off `results` rather than the parameters, because the store publishes a
 * new results object exactly when something the engine reads has changed — the
 * same trigger, already debounced, and it leaves out `consumptionUnits`, which
 * relabels one line elsewhere and must not cost three propagations.
 */
watch(
  [open, results, levels],
  ([isOpen]) => {
    // Nothing stressed means the three columns would be one number printed
    // three times, and the card shows the prompt instead — so there is nothing
    // to compute, and nothing to call itself busy about either.
    if (!isOpen || !stressed.value) {
      cancel()
      scenarios.value = null
      return
    }
    // The previous figures are deliberately *kept* while the new ones are
    // computed, under a spinner that says so. Dropping them leaves the card
    // empty for most of a second on an AF plan, and a reader dragging a slider
    // loses the thing they were comparing against exactly when they need it.
    // The overlay is what makes that honest: stale figures under a spinner read
    // as being replaced, where stale figures alone read as current.
    schedule()
  },
  { deep: true, immediate: true },
)

const busy = computed(() => pending.value || running.value)

/** Percent for the slider, fraction for the model. */
function levelPercent(id: string): number {
  return Math.round((levels.value[id] ?? 0) * 100)
}

function setLevel(id: string, percent: number) {
  levels.value = { ...levels.value, [id]: percent / 100 }
}

function clearAll() {
  levels.value = Object.fromEntries(STRESS_DIMENSIONS.map((dimension) => [dimension.id, 0]))
}

/**
 * What a dimension does at its current position, as the two factors it reaches.
 *
 * Stated rather than left to the slider's per cent, because "50%" is not
 * self-explanatory on a geometric scale — half-way is 1.41x, not 1.5x.
 */
function levelHint(id: string): string {
  const level = levels.value[id] ?? 0
  if (level <= 0) return 'orörd'
  const factor = Math.pow(2, level)
  return `×${factor.toFixed(2).replace('.', ',')} / ×${(1 / factor).toFixed(2).replace('.', ',')}`
}

/**
 * Named for the risk the scenario represents rather than for the outcome. "Bra"
 * and "Dåligt" invite the columns to be read as forecasts of what will happen;
 * these say what they are, which is the plan seen under a kinder and a harsher
 * set of assumptions than the ones it was built on.
 */
const COLUMNS: { scenario: Scenario; label: string }[] = [
  { scenario: 'good', label: 'Lägre risk' },
  { scenario: 'base', label: 'Plan' },
  { scenario: 'bad', label: 'Högre risk' },
]

/**
 * The same rows the Slutkapital table uses, so the two can be read against each
 * other without translating between them.
 */
const ROWS = [
  {
    key: 'planned',
    label: 'Totalt planerat uttag',
    pick: (r: StressResult) => r.plannedWithdrawn,
    absolute: formatKr,
    change: formatRelative,
  },
  {
    key: 'withdrawn',
    label: 'Förväntat faktiskt uttag',
    pick: (r: StressResult) => r.expectedWithdrawn,
    absolute: formatKr,
    change: formatRelative,
  },
  {
    key: 'survival',
    label: 'Sannolikhet att planen håller',
    pick: (r: StressResult) => r.survival,
    absolute: (v: number) => formatPercent(v * 100),
    // Points, not a ratio: a probability that falls from 87% to 65% has fallen
    // 22 points, and calling that a quarter invites the two to be confused.
    change: formatPointChange,
  },
  {
    key: 'bequest',
    label: 'Sannolikhet att nå arvsmålet',
    pick: (r: StressResult) => r.bequestProbability,
    absolute: (v: number) => formatPercent(v * 100),
    change: formatPointChange,
  },
  {
    key: 'p10',
    label: '10:e percentilen',
    pick: (r: StressResult) => r.finalPercentile10,
    absolute: formatKr,
    change: formatRelative,
  },
  {
    key: 'median',
    label: 'Median slutkapital',
    pick: (r: StressResult) => r.finalMedian,
    absolute: formatKr,
    change: formatRelative,
  },
  {
    key: 'p90',
    label: '90:e percentilen',
    pick: (r: StressResult) => r.finalPercentile90,
    absolute: formatKr,
    change: formatRelative,
  },
] as const

/** A plan with no bequest target has no row to show for it. */
const rows = computed(() =>
  ROWS.filter(
    (row) => row.key !== 'bequest' || scenarios.value?.base.bequestProbability !== undefined,
  ),
)

function show(row: (typeof ROWS)[number], result: StressResult): string {
  const value = row.pick(result)
  if (value === undefined) return '—'
  const base = scenarios.value?.base
  if (relative.value && base && result.scenario !== 'base') {
    const reference = row.pick(base)
    if (reference === undefined) return '—'
    return row.change(value, reference)
  }
  return row.absolute(value)
}

/**
 * How a scenario's figure compares with the plan's, for the tint.
 *
 * Every row here is higher-is-better, so one rule covers them all. Blue for
 * better and red for worse rather than the usual green/red: the two are far
 * easier to tell apart with a colour vision deficiency, and blue is already the
 * page's own accent.
 */
const NEUTRAL_BAND = 0.005

function direction(row: (typeof ROWS)[number], result: StressResult): string | null {
  const base = scenarios.value?.base
  if (!base || result.scenario === 'base') return null
  const value = row.pick(result)
  const reference = row.pick(base)
  if (value === undefined || reference === undefined) return null
  const difference = value - reference
  if (Math.abs(difference) <= Math.abs(reference) * NEUTRAL_BAND) return null
  return difference > 0 ? 'up' : 'down'
}
</script>

<template>
  <CollapsibleCard
    v-if="results"
    v-model:open="open"
    title="Stresstest"
    body-id="planner-stress-body"
    class="mb-3"
  >
    <template #header>
      <div class="form-check form-switch mb-0">
        <input
          id="planner-stress-relative"
          v-model="relative"
          class="form-check-input"
          type="checkbox"
          role="switch"
        />
        <label class="form-check-label small" for="planner-stress-relative"
          >Förändring från planen</label
        >
      </div>
    </template>

    <div class="row g-4">
      <div class="col-12 col-lg-5">
        <!-- Capped and scrolled rather than dropped into a dropdown with a
             delete button: six dimensions fit, and a list that is always the
             same length is easier to scan than one the household has to
             assemble before it can ask anything. -->
        <div class="sliders">
          <div v-for="dimension in dimensions" :key="dimension.id" class="slider">
            <label class="form-label mb-0" :for="`stress-${dimension.id}`">
              {{ dimension.label }}
            </label>
            <span class="hint" :class="{ idle: !(levels[dimension.id] ?? 0) }">
              {{ levelHint(dimension.id) }}
            </span>
            <input
              :id="`stress-${dimension.id}`"
              type="range"
              class="form-range"
              min="0"
              max="100"
              step="5"
              :value="levelPercent(dimension.id)"
              @input="setLevel(dimension.id, Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary mt-2"
          :disabled="!stressed"
          @click="clearAll"
        >
          Nollställ
        </button>
      </div>

      <div class="col-12 col-lg-7">
        <p v-if="error" class="form-text text-danger mb-0">{{ error }}</p>
        <!-- Nothing to overlay yet: the first computation has no previous
             figures, so the spinner gets a box roughly the table's height and
             the card does not jump when they arrive. -->
        <div
          v-else-if="busy && !scenarios"
          class="d-flex align-items-center justify-content-center waiting"
        >
          <div class="spinner-border text-secondary" role="status">
            <span class="visually-hidden">Räknar…</span>
          </div>
        </div>
        <p v-else-if="!stressed" class="form-text mb-0">
          Dra ett reglage för att pröva planen mot att antagandet är fel. Full utslagning är dubbelt
          eller hälften; alla påslagna dimensioner dras åt samma håll samtidigt.
        </p>

        <div v-if="scenarios && stressed" class="results" :class="{ busy }" :aria-busy="busy">
          <!-- Indeterminate, because there is nothing honest to be determinate
               about: the three propagations are synchronous and hold the thread
               throughout, so a bar would have to invent its own progress. -->
          <div v-if="busy" class="overlay">
            <div class="spinner-border text-secondary" role="status">
              <span class="visually-hidden">Räknar…</span>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-sm align-middle mb-0 stress-table">
              <thead>
                <tr>
                  <th></th>
                  <th
                    v-for="column in COLUMNS"
                    :key="column.scenario"
                    class="text-center"
                    :class="column.scenario"
                  >
                    {{ column.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row.key">
                  <th>{{ row.label }}</th>
                  <td
                    v-for="column in COLUMNS"
                    :key="column.scenario"
                    class="text-end"
                    :class="direction(row, scenarios[column.scenario])"
                  >
                    {{ show(row, scenarios[column.scenario]) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </CollapsibleCard>
</template>

<style scoped>
/* Tall enough to hold the table that replaces it, so the card keeps its height
   while it recomputes rather than collapsing and springing back. */
.waiting {
  min-height: 14rem;
}

/* The previous figures stay put while the next ones are computed, dimmed under
   a spinner so they read as being replaced rather than as current. */
.results {
  position: relative;
}

.results.busy .table-responsive {
  opacity: 0.35;
  transition: opacity 0.15s ease-in-out;
}

.overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Six fit without scrolling; the cap is there so a seventh does not quietly
   make the card taller than the results above it. */
.sliders {
  max-height: 20rem;
  overflow-y: auto;
}

/* Label left, what the slider currently means right, the track under both. */
.slider {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  column-gap: 0.5rem;
}

.slider + .slider {
  margin-top: 0.25rem;
}

.slider .form-range {
  grid-column: 1 / -1;
}

.hint {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--bs-secondary-color);
}

.hint.idle {
  font-style: italic;
}

.stress-table tbody th {
  font-weight: 500;
  padding-left: 0;
}

.stress-table td {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* The plan as entered is the reference the other two are read against, so it
   is the column the eye should land on. */
.stress-table thead th.base {
  border-bottom: 3px solid var(--bs-primary);
}

/* Better or worse than the plan. Muted rather than the palette's own blue and
   red, which at full strength read as an alert across a whole table, and the
   warm one pushed off pure red towards terracotta. Both stay readable at
   5.3:1 and 5.1:1 on white against the 4.5:1 normal text needs, and their
   ratios are held within 0.2 so neither reads as louder. */
.stress-table td.up {
  color: #3a6ea5;
}

.stress-table td.down {
  color: #a35a4a;
}
</style>
