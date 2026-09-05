<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useDebounced } from '../../composables/useDebounced'
import { usePlannerStore } from '../../stores/planner'
import CollapsibleCard from './CollapsibleCard.vue'
import {
  sensitivityGrid,
  SENSITIVITY_FACTORS,
  type SensitivityAxis,
  type SensitivityCell,
} from '../../planner/sensitivity'
import { formatKr, formatPercent, formatPointChange, formatRelative } from '../../planner/format'

const props = defineProps<{
  title: string
  /** Ties the disclosure button to its region. Unique per page. */
  bodyId: string
  /** Varied down the grid. */
  rowAxis: SensitivityAxis
  /** Varied across it. */
  colAxis: SensitivityAxis
}>()

const { parameters, results } = storeToRefs(usePlannerStore())

const grid = ref<SensitivityCell[][] | null>(null)

/**
 * Whether the card is open, and so whether it computes at all.
 *
 * Closed is the default and closed costs nothing: nine propagations is a couple
 * of seconds on an AF plan, which is not a price to pay for a reader who has
 * not asked the question. Open, it follows the rest of the page — the figures
 * beside a plan are always that plan's.
 */
const open = ref(false)

/**
 * Show each cell as its change from the plan as entered, rather than as amounts.
 *
 * Nine sets of three figures is a lot to hold at once, and the question the card
 * answers is comparative — the amounts are only ever read against the middle
 * cell. Off by default, because kronor are what a household budgets against.
 */
const relative = ref(false)
const running = ref(false)
const error = ref<string | null>(null)

function compute() {
  if (!open.value) return
  running.value = true
  error.value = null
  // Yield once so the busy state paints before nine propagations take the
  // thread; an AF plan spends a couple of seconds here.
  window.setTimeout(() => {
    try {
      grid.value = sensitivityGrid(parameters.value, props.rowAxis, props.colAxis)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      grid.value = null
    } finally {
      running.value = false
    }
  }, 0)
}

/**
 * Long enough that a burst of edits recomputes once. The store's own recompute
 * is already debounced, so `results` only changes when the plan has settled —
 * this is the second line of defence against paying nine propagations for a
 * drag, not the first.
 */
const RECOMPUTE_DELAY = 300

const { schedule, cancel, pending } = useDebounced(compute, RECOMPUTE_DELAY)

/**
 * Recomputes with the rest of the results.
 *
 * Keyed off `results` rather than the parameters, because the store publishes a
 * new results object exactly when something the engine reads has changed — that
 * is the same trigger, already debounced, and it leaves out `consumptionUnits`,
 * which relabels one line and must not cost nine propagations.
 *
 * The grid is dropped the moment the trigger fires, not when the new one
 * arrives: nine figures for a plan that no longer exists read as current.
 */
watch(
  [open, results],
  ([isOpen]) => {
    grid.value = null
    if (!isOpen) {
      cancel()
      return
    }
    schedule()
  },
  { immediate: true },
)

/**
 * Busy from the moment the plan moves, not from the moment the work starts. The
 * wait and the work look the same from outside, and covering only the second
 * would make an edit look like it had done nothing.
 */
const busy = computed(() => pending.value || running.value)

/**
 * The three figures a cell carries, in the order they answer the question.
 *
 * How much does the plan hand over, how likely is it to hold, and what is left
 * at the end — spending first because it is what the household is buying, risk
 * second because it is what it costs, and the bequest last because it is the
 * residual. Short labels: they repeat nine times.
 */
const METRICS = [
  {
    key: 'withdrawn',
    label: 'Uttag',
    pick: (c: SensitivityCell) => c.expectedWithdrawn,
    absolute: formatKr,
    change: formatRelative,
  },
  {
    key: 'survival',
    label: 'Håller',
    pick: (c: SensitivityCell) => c.survival,
    absolute: (v: number) => formatPercent(v * 100),
    // Points, not a relative change: a probability that falls from 87% to 65%
    // has fallen 22 points, and calling that a quarter invites the two readings
    // to be confused.
    change: formatPointChange,
  },
  {
    key: 'final',
    label: 'Slutkapital',
    pick: (c: SensitivityCell) => c.finalMedian,
    absolute: formatKr,
    change: formatRelative,
  },
] as const

/** The plan as entered, which every other cell is stated against. */
const base = computed(() => grid.value?.flat().find((cell) => cell.base) ?? null)

/**
 * A cell's figure, as an amount or as its change from the middle cell.
 *
 * The middle cell itself stays in its own units even in relative mode: it is the
 * reference the other eight are measured against, and turning it into three
 * zeroes would delete the anchor. Same reasoning as the Slutkapital table, which
 * keeps its planned total in kronor for the same reason.
 */
function show(metric: (typeof METRICS)[number], cell: SensitivityCell): string {
  const value = metric.pick(cell)
  if (relative.value && base.value && !cell.base) {
    return metric.change(value, metric.pick(base.value))
  }
  return metric.absolute(value)
}

/**
 * How far a figure has to move from the middle tile before the tint means
 * anything. Half a per cent is under the grid's own resolution, so tinting
 * inside it would colour quantisation.
 */
const NEUTRAL_BAND = 0.005

/**
 * Whether a figure is better or worse than the plan as entered.
 *
 * Higher is better for all three: more cash handed over, more chance of
 * holding, more left at the end. Blue for better and red for worse rather than
 * the usual green/red — the two are far easier to tell apart with a colour
 * vision deficiency, and blue is already the page's own accent.
 *
 * Shown in both modes, not only the relative one. The comparison is the point
 * of the grid whether or not the figures are printed as changes.
 */
function direction(metric: (typeof METRICS)[number], cell: SensitivityCell): string | null {
  if (!base.value || cell.base) return null
  const reference = metric.pick(base.value)
  const difference = metric.pick(cell) - reference
  if (Math.abs(difference) <= Math.abs(reference) * NEUTRAL_BAND) return null
  return difference > 0 ? 'up' : 'down'
}

/** "×0,5", "×1", "×2" — Swedish decimal comma, and no stray trailing zero. */
function factorLabel(factor: number): string {
  return `×${factor.toLocaleString('sv-SE')}`
}
</script>

<template>
  <CollapsibleCard v-if="results" v-model:open="open" :title="title" :body-id="bodyId" class="mb-3">
    <template #header>
      <div class="form-check form-switch mb-0">
        <input
          :id="`${bodyId}-relative`"
          v-model="relative"
          class="form-check-input"
          type="checkbox"
          role="switch"
        />
        <label class="form-check-label small" :for="`${bodyId}-relative`"
          >Förändring från mitten</label
        >
      </div>
    </template>

    <p v-if="error" class="form-text text-danger mb-0">{{ error }}</p>
    <p v-else-if="busy" class="form-text mb-0">Räknar nio genomräkningar av planen…</p>

    <!-- A grid of tiles rather than a table. The axes are still the point, so
         they are labelled down the side and across the top from lg up; below
         that the tiles stack one per row and carry their own coordinates
         instead, which is the only thing that survives losing the columns. -->
    <div v-if="grid" class="matrix">
      <div class="axis-corner" aria-hidden="true"></div>
      <div v-for="factor in SENSITIVITY_FACTORS" :key="`col-${factor}`" class="axis axis-col">
        {{ colAxis.label }} {{ factorLabel(factor) }}
      </div>

      <template v-for="(row, rowIndex) in grid" :key="rowIndex">
        <div class="axis axis-row">
          {{ rowAxis.label }} {{ factorLabel(SENSITIVITY_FACTORS[rowIndex]!) }}
        </div>
        <div v-for="cell in row" :key="cell.colScale" class="tile" :class="{ base: cell.base }">
          <p class="eyebrow">
            {{ rowAxis.label }} {{ factorLabel(cell.rowScale) }} · {{ colAxis.label }}
            {{ factorLabel(cell.colScale) }}
          </p>
          <span v-if="cell.base" class="badge text-bg-primary tag">Din plan</span>
          <dl class="metrics mb-0">
            <div
              v-for="metric in METRICS"
              :key="metric.key"
              class="metric"
              :class="direction(metric, cell)"
            >
              <dt>{{ metric.label }}</dt>
              <dd>{{ show(metric, cell) }}</dd>
            </div>
          </dl>
        </div>
      </template>
    </div>
  </CollapsibleCard>
</template>

<style scoped>
/* One tile per row on a narrow screen, and the full matrix from lg up. The
   axis labels only exist in the second case: with a single column there are no
   rows or columns to name, and each tile says where it sits instead. */
.matrix {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.axis {
  display: none;
}

.axis-corner {
  display: none;
}

@media (min-width: 992px) {
  .matrix {
    grid-template-columns: auto repeat(3, 1fr);
    align-items: stretch;
    column-gap: 0.75rem;
  }

  .axis,
  .axis-corner {
    display: flex;
    align-items: center;
  }

  .axis-col {
    justify-content: center;
  }

  .eyebrow {
    display: none;
  }
}

.axis {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bs-secondary-color);
  white-space: nowrap;
}

.tile {
  position: relative;
  height: 100%;
  padding: 1rem;
  border: 1px solid var(--bs-border-color);
  border-radius: var(--bs-border-radius-xl);
  background-color: var(--bs-body-bg);
}

/* The plan as entered, given the treatment a pricing grid gives its featured
   column: it is the one every other tile is read against, so it should be the
   one the eye lands on first. */
.tile.base {
  border-color: var(--bs-primary);
  box-shadow: 0 0 0 1px var(--bs-primary);
}

.tag {
  position: absolute;
  top: -0.65rem;
  left: 1rem;
  font-size: 0.7rem;
  letter-spacing: 0.02em;
}

/* Only shown when the columns are gone and the tile has to place itself. */
.eyebrow {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--bs-secondary-color);
}

.metric {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

/* Better or worse than the plan as entered, in the figure itself.

   Muted rather than the palette's own blue and red, which at full strength read
   as an alert on nine tiles at once, and the warm one pushed off pure red
   towards terracotta so it sits beside the blue rather than shouting over it.
   Both stay readable: 5.3:1 and 5.1:1 on white, against the 4.5:1 that normal
   text needs — at 1.125rem these figures are just under what WCAG counts as
   large, so the looser threshold does not apply, and --bs-primary itself is
   only 3.7:1 and would not have done. Their ratios are held within 0.2 of each
   other so neither reads as louder, which is the failure mode of picking two
   colours by eye. */
.metric.up dd {
  color: #3a6ea5;
}

.metric.down dd {
  color: #a35a4a;
}

/* A hairline between the figures rather than around them: three numbers in a
   box read as a group, and ruling them into cells would make it a table again. */
.metric + .metric {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--bs-border-color-translucent);
}

.metric dt {
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--bs-secondary-color);
  white-space: nowrap;
}

.metric dd {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
