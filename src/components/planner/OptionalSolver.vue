<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { usePlannerStore } from '../../stores/planner'
import { solveOptionalScale, type OptionalScaleSolution } from '../../planner/solve'
import { floorToSignificant, formatPercent } from '../../planner/format'
import { encodePlan } from '../../planner/url'

const { parameters, results } = storeToRefs(usePlannerStore())

/** Nothing below this is worth offering: it is the model's own best guess. */
const MIN_TARGET = 50

/**
 * Mid-range of what practitioners target for a fixed spending plan — Blanchett,
 * Vanguard and Schwab all cite 85–90%, Kitces and J.P. Morgan 80–90%. Applied
 * here to the floor, which is the part that must not fail, so the strict end of
 * the band is the defensible one. Clamped down when the floor cannot reach it.
 */
const DEFAULT_TARGET = 85

/**
 * The most the plan can reach, which is what it survives taking no optional at
 * all. Bounding the slider by it means the target can never be one the floor
 * cannot deliver — declining discretionary spending buys safety only up to
 * here, and past it the floor itself is what needs changing.
 */
const ceiling = computed(() => {
  const run = results.value?.floorRun
  if (!run) return null
  const final = run.outcomes[run.outcomes.length - 1]!
  return Math.floor((1 - final.ruinProbability) * 100)
})

const usable = computed(() => ceiling.value !== null && ceiling.value > MIN_TARGET)

const targetPercent = ref(DEFAULT_TARGET)
const solution = ref<OptionalScaleSolution | null>(null)
const solving = ref(false)
const error = ref<string | null>(null)

// A solved multiplier belongs to the plan it was solved for, so any edit to the
// plan invalidates it rather than leaving a stale number next to an apply
// button.
watch(parameters, () => (solution.value = null), { deep: true })

// A target the floor cannot deliver is not a target, so keep the value inside
// the slider's range whenever the plan moves the ceiling.
watch(
  ceiling,
  (top) => {
    if (top === null) return
    targetPercent.value = Math.min(top, Math.max(MIN_TARGET, targetPercent.value))
  },
  { immediate: true },
)

const multiplier = new Intl.NumberFormat('sv-SE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function solve() {
  solving.value = true
  error.value = null
  solution.value = null
  // Yield once so the button can render its busy state before the search takes
  // the thread; an AF plan spends a couple of seconds here.
  window.setTimeout(() => {
    try {
      solution.value = solveOptionalScale(parameters.value, targetPercent.value / 100)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      solving.value = false
    }
  }, 0)
}

const applicable = computed(
  () => solution.value?.status === 'solved' || solution.value?.status === 'capped',
)

/**
 * The rescaled plan as an ordinary link.
 *
 * The whole plan lives in the query string, so applying the multiplier is just
 * navigating to a different plan — which means the browser records it and the
 * back button undoes it, with no history bookkeeping of our own. The shape the
 * household drew is preserved; only the level moves.
 */
const scaledHref = computed(() => {
  const scale = solution.value?.scale
  if (!applicable.value || scale === undefined) return null
  const rescaled = {
    ...parameters.value,
    cashflow: parameters.value.cashflow.map((year) => ({
      ...year,
      // Down to two significant digits: the schedule is written back into the
      // plan, and rounding down can only underspend the target the solver was
      // given. It also keeps the numbers round enough to reason about.
      optional: Math.max(0, floorToSignificant(year.optional * scale)),
    })),
  }
  return `${window.location.pathname}?${encodePlan(rescaled)}`
})
</script>

<template>
  <!--
    Hidden entirely unless the floor alone clears the slider's lower bound.
    Below that there is no target worth offering — the floor is what fails, and
    no amount of discretionary restraint changes that. Gating the whole card
    also means the range input is never mounted before its bounds are known,
    which would let the browser clamp its value and leave the control disagreeing
    with the number beside it.
  -->
  <div v-if="usable" class="card mb-3">
    <div class="card-header">Skala tillvalet till en önskad sannolikhet</div>
    <div class="card-body">
      <div class="row g-3 align-items-end">
        <div class="col-12 col-md-5">
          <label class="form-label d-flex justify-content-between" for="solver-target">
            <span>Sannolikhet att planen håller</span>
            <span class="fw-semibold">{{ formatPercent(targetPercent) }}</span>
          </label>
          <input
            id="solver-target"
            v-model.number="targetPercent"
            type="range"
            :min="MIN_TARGET"
            :max="ceiling!"
            step="1"
            class="form-range"
          />
          <div class="d-flex justify-content-between form-text mt-0">
            <span>{{ formatPercent(MIN_TARGET) }}</span>
            <span>{{ formatPercent(ceiling!) }} utan tillval</span>
          </div>
        </div>

        <div class="col-6 col-md-2">
          <button
            type="button"
            class="btn btn-outline-primary w-100"
            :disabled="solving"
            @click="solve"
          >
            {{ solving ? 'Räknar…' : 'Beräkna' }}
          </button>
        </div>

        <div class="col-6 col-md-2">
          <div v-if="solution?.status === 'solved' || solution?.status === 'capped'">
            <div class="form-label mb-1">Multiplikator</div>
            <div class="fs-4 lh-1">{{ multiplier.format(solution.scale) }}×</div>
          </div>
        </div>

        <div class="col-12 col-md-3">
          <a v-if="scaledHref" class="btn btn-primary w-100" :href="scaledHref">
            Skala tillvalet
          </a>
          <button v-else type="button" class="btn btn-primary w-100" disabled>
            Skala tillvalet
          </button>
        </div>
      </div>

      <p v-if="error" class="form-text text-danger mb-0 mt-2">{{ error }}</p>

      <p v-else-if="solution?.status === 'nothing-to-scale'" class="form-text mb-0 mt-2">
        Planen har inget tillval att skala. Ange ett tillval i diagrammet ovan först.
      </p>

      <p v-else-if="solution?.status === 'capped'" class="form-text mb-0 mt-2">
        Målet nås med marginal. Multiplikatorn är begränsad till sökområdets tak; tillvalet skulle
        kunna vara ännu större.
      </p>

      <!-- The slider cannot ask for more than the floor delivers, so this should
           not occur. It is here so the card explains itself rather than falling
           silent if the bound and the solver ever disagree. -->
      <p v-else-if="solution?.status === 'unreachable'" class="form-text text-warning mb-0 mt-2">
        Målet ligger över vad golvet ensamt klarar ({{ formatPercent(solution.ceiling * 100) }}), så
        det är golvet som inte bär. Att avstå tillvalet hjälper inte.
      </p>

      <p class="form-text mb-0 mt-2">
        Söker den faktor som hela tillvalskurvan ska multipliceras med. Formen du ritat behålls —
        bara nivån ändras. Länken går till den omskalade planen, så bakåtknappen tar dig tillbaka
        till den här.
      </p>
    </div>
  </div>
</template>
