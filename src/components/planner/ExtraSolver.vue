<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useDebounced } from '../../composables/useDebounced'
import { usePlannerStore } from '../../stores/planner'
import {
  isNegligibleScale,
  solveExtraScale,
  NEGLIGIBLE_SCALE_CHANGE,
  type ExtraScaleSolution,
} from '../../planner/solve'
import { floorToSignificant, formatPercent, formatRelative } from '../../planner/format'
import { encodePlan } from '../../planner/url'

const { parameters, results } = storeToRefs(usePlannerStore())

/** Nothing below this is worth offering: it is the model's own best guess. */
const MIN_TARGET = 50

/**
 * Mid-range of what practitioners target for a fixed spending plan — Blanchett,
 * Vanguard and Schwab all cite 85–90%, Kitces and J.P. Morgan 80–90%. Applied
 * here to the need, which is the part that must not fail, so the strict end of
 * the band is the defensible one. Clamped down when the need cannot reach it.
 */
const DEFAULT_TARGET = 85

/**
 * The most the plan can reach, which is what it survives taking no extra at
 * all. Bounding the slider by it means the target can never be one the need
 * cannot deliver — declining discretionary spending buys safety only up to
 * here, and past it the need itself is what has to change.
 */
const ceiling = computed(() => {
  const run = results.value?.needRun
  if (!run) return null
  const final = run.outcomes[run.outcomes.length - 1]!
  return Math.floor((1 - final.ruinProbability) * 100)
})

const usable = computed(() => ceiling.value !== null && ceiling.value > MIN_TARGET)

const targetPercent = ref(DEFAULT_TARGET)
const solution = ref<ExtraScaleSolution | null>(null)
const solving = ref(false)
const error = ref<string | null>(null)

// A solved multiplier belongs to the plan it was solved for, so any edit to the
// plan invalidates it rather than leaving a stale number next to an apply
// button.
watch(parameters, () => (solution.value = null), { deep: true })

// A target the need cannot deliver is not a target, so keep the value inside
// the slider's range whenever the plan moves the ceiling.
watch(
  ceiling,
  (top) => {
    if (top === null) return
    targetPercent.value = Math.min(top, Math.max(MIN_TARGET, targetPercent.value))
  },
  { immediate: true },
)

/**
 * The multiplier as the change it makes, "+11 %" rather than "1,11×".
 *
 * It is the same number, but the household reads its own spending in the
 * schedule above; what it needs from the solver is how much that has to move.
 * A multiplier is a value against a reference of 1, which is exactly what
 * formatRelative states.
 */
function formatChange(scale: number): string {
  return formatRelative(scale, 1)
}

function solve() {
  solving.value = true
  error.value = null
  solution.value = null
  // Yield once so the button can render its busy state before the search takes
  // the thread; an AF plan spends a couple of seconds here.
  window.setTimeout(() => {
    try {
      solution.value = solveExtraScale(parameters.value, targetPercent.value / 100)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      solving.value = false
    }
  }, 0)
}

/**
 * Long enough that dragging the slider across its range solves once, at the end,
 * rather than at every step. Deliberately slower than the store's own recompute:
 * a search is ~13 propagations, so on an AF plan it costs seconds of main
 * thread, and paying that mid-drag would make the control feel stuck.
 */
const SOLVE_DELAY = 400

const { schedule: scheduleSolve, pending: solveQueued } = useDebounced(solve, SOLVE_DELAY)

/**
 * Runs the search after the slider settles.
 *
 * Driven from the slider's own input event rather than from a watcher on the
 * value, so a programmatic clamp against a new ceiling never starts a search the
 * user did not ask for — notably on load, where it would freeze the page before
 * anyone has touched anything. `solve` reads the target when it finally runs, so
 * it does not matter whether v-model has updated it yet.
 */
function onTargetInput() {
  // Drop the previous answer immediately: it was solved for a target the slider
  // no longer shows, and leaving it up next to the new one reads as current.
  solution.value = null
  scheduleSolve()
}

// Busy from the moment the slider moves, not from the moment the search starts:
// the wait and the work look the same from outside, and only covering the second
// makes letting go of the slider look like nothing happened.
const busy = computed(() => solveQueued.value || solving.value)

const applicable = computed(
  () => solution.value?.status === 'solved' || solution.value?.status === 'capped',
)

/** The plan is already at the level the target asks for; see the threshold. */
const nearTarget = computed(() => {
  const scale = solution.value?.scale
  if (!applicable.value || scale === undefined) return false
  return isNegligibleScale(scale)
})

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
  if (!applicable.value || nearTarget.value || scale === undefined) return null
  const rescaled = {
    ...parameters.value,
    cashflow: parameters.value.cashflow.map((year) => ({
      ...year,
      // Down to two significant digits: the schedule is written back into the
      // plan, and rounding down can only underspend the target the solver was
      // given. It also keeps the numbers round enough to reason about.
      extra: Math.max(0, floorToSignificant(year.extra * scale)),
    })),
  }
  return `${window.location.pathname}?${encodePlan(rescaled)}`
})
</script>

<template>
  <!--
    Hidden entirely unless the need alone clears the slider's lower bound.
    Below that there is no target worth offering — the need is what fails, and
    no amount of discretionary restraint changes that. Gating the whole card
    also means the range input is never mounted before its bounds are known,
    which would let the browser clamp its value and leave the control disagreeing
    with the number beside it.
  -->
  <div v-if="usable" class="card mb-3">
    <div class="card-header">Skala det extra uttaget till en önskad sannolikhet</div>
    <div class="card-body">
      <!-- Centred: the slider column is taller than the others because of its
           label and its two end markers, and aligning on the bottom edge leaves
           the buttons and the figure sitting level with that stray text rather
           than with the control they belong to. -->
      <div class="row g-3 align-items-center">
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
            @input="onTargetInput"
          />
          <div class="d-flex justify-content-between form-text mt-0">
            <span>{{ formatPercent(MIN_TARGET) }}</span>
            <span>{{ formatPercent(ceiling!) }} utan extra</span>
          </div>
        </div>

        <!--
          The slider solves itself, so this is only for the other way the answer
          goes stale: an edit to the plan. Those are not solved automatically
          because the search is seconds of main thread on an AF plan, and every
          drag in the cash flow editor would pay it.
        -->
        <div class="col-6 col-md-2">
          <button
            type="button"
            class="btn btn-outline-primary w-100"
            :disabled="busy"
            @click="solve"
          >
            {{ busy ? 'Räknar…' : 'Beräkna' }}
          </button>
        </div>

        <div class="col-6 col-md-2">
          <div v-if="solution?.status === 'solved' || solution?.status === 'capped'">
            <div class="form-label mb-1">Ändring av extrauttaget</div>
            <div class="fs-4 lh-1">{{ formatChange(solution.scale) }}</div>
          </div>
        </div>

        <div class="col-12 col-md-3">
          <a v-if="scaledHref" class="btn btn-primary w-100" :href="scaledHref">
            Skala extrauttaget
          </a>
          <button v-else type="button" class="btn btn-primary w-100" disabled>
            Skala extrauttaget
          </button>
        </div>
      </div>

      <!-- What the card always does comes first, so it stays in the same place
           whether or not there is anything to say about the current answer; the
           situational notes below it are what move. -->
      <p class="form-text mb-0 mt-3">
        Söker hur mycket hela extrakurvan behöver ändras. Formen du ritat behålls — bara nivån
        ändras. Länken går till den omskalade planen, så bakåtknappen tar dig tillbaka till den här.
      </p>

      <p v-if="error" class="form-text text-danger mb-0 mt-3">{{ error }}</p>

      <p v-else-if="solution?.status === 'nothing-to-scale'" class="form-text mb-0 mt-3">
        Planen har inget extrauttag att skala. Ange ett extra uttag i diagrammet ovan först.
      </p>

      <!-- Takes precedence over the 'capped' and 'unreachable' branches below: a
           multiplier this close to 1 means the plan already sits at the target,
           which is the useful thing to say, not how the search ended. -->
      <p v-else-if="nearTarget" class="form-text mb-0 mt-3">
        Planen ligger redan på den nivån. Extrauttaget skulle ändras med mindre än
        {{ formatPercent(NEGLIGIBLE_SCALE_CHANGE * 100) }}, vilket är mindre än modellens egen
        osäkerhet — det är inte värt att skala om.
      </p>

      <p v-else-if="solution?.status === 'capped'" class="form-text mb-0 mt-3">
        Målet nås med marginal. Multiplikatorn är begränsad till sökområdets tak; extrauttaget
        skulle kunna vara ännu större.
      </p>

      <!-- The slider cannot ask for more than the need delivers, so this should
           not occur. It is here so the card explains itself rather than falling
           silent if the bound and the solver ever disagree. -->
      <p v-else-if="solution?.status === 'unreachable'" class="form-text text-warning mb-0 mt-3">
        Målet ligger över vad behovet ensamt klarar ({{ formatPercent(solution.ceiling * 100) }}),
        så det är behovet som inte bär. Att avstå det extra hjälper inte.
      </p>
    </div>
  </div>
</template>
