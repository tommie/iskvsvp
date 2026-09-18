<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { useDebounced } from '../../composables/useDebounced'
import { usePlannerStore } from '../../stores/planner'
import CollapsibleCard from './CollapsibleCard.vue'
import SweepChart from './charts/SweepChart.vue'
import SweepWithdrawalChart from './charts/SweepWithdrawalChart.vue'
import { formatKr, formatPercent } from '../../planner/format'
import {
  canSweep,
  crossingFor,
  levelMarks,
  peakDeliveryLevel,
  planExtraRate,
  sweepLength,
  sweepPoints,
  SURVIVAL_TARGETS,
  SWEEP_MAX,
  type SweepPoint,
  type SweepRule,
} from '../../planner/sweep'

const { parameters, results } = storeToRefs(usePlannerStore())

/**
 * Whether the card is open, and so whether it computes at all.
 *
 * Closed is the default and closed costs nothing. The sweep is seventeen
 * propagations — five seconds on an AF plan — so paying for it on every edit
 * would make the cash flow editor unusable.
 */
const open = ref(false)

const points = ref<SweepPoint[]>([])

/**
 * The points of the last sweep that actually finished.
 *
 * Every conclusion reads from here rather than from `points`: the table, its
 * footnote, the note about the peak, and the charts' own annotations. A curve
 * growing a point at a time reads as progress, but a conclusion rewriting
 * itself seventeen times reads as flicker — and the early rungs genuinely do
 * give different answers, because a target the sweep has not reached down to
 * yet is reported as a bound and firms up into a crossing several rungs later.
 *
 * One source for all of them, so they change together at the instant the sweep
 * finishes. Gating the chart marks on `busy` instead left the marker vanishing
 * the moment a sweep started while the note explaining it stayed until the
 * sweep ended, which is the same fact told twice at two different times.
 *
 * Kept across a recompute rather than cleared, so a reader dragging a slider
 * keeps the figures they were comparing against; the block is dimmed and marked
 * `aria-busy` while the next sweep runs, which is what makes that honest. The
 * stress card holds its figures under a spinner for the same reason.
 */
const settled = ref<SweepPoint[]>([])
const running = ref(false)
const error = ref<string | null>(null)

/**
 * Whether the swept level is a ceiling the plan may decline, or a schedule it
 * takes regardless.
 *
 * Defaults to the planner's own rule, so the card agrees with every other
 * figure on the page. Off, it is Bengen's question instead — and the two are
 * worth putting beside each other, because the difference between them is what
 * being willing to adjust is worth.
 */
const adaptive = ref(true)
const rule = computed<SweepRule>(() => (adaptive.value ? 'adaptive' : 'fixed'))

const total = sweepLength()

/**
 * Identifies the sweep in flight.
 *
 * Bumped by every restart, and checked by each tick before it does anything:
 * the work is spread across timeouts, so a parameter change has to be able to
 * abandon a sweep that is halfway through rather than wait it out.
 */
let run = 0

const sweepable = computed(() => canSweep(parameters.value))

function start() {
  const mine = ++run
  points.value = []
  error.value = null
  running.value = false
  if (!open.value || !results.value || !sweepable.value) {
    settled.value = []
    return
  }

  const iterator = sweepPoints(parameters.value, rule.value)
  running.value = true

  // One rung per timeout, rather than the whole sweep in one call. Each
  // propagation holds the thread for as long as it takes — 17 ms on an ISK, 320
  // on an AF — but between them the page paints, the progress bar moves and the
  // curve grows a point. The alternative is a five-second freeze on an AF plan,
  // which is the same work with none of it visible.
  const tick = () => {
    if (mine !== run) return
    try {
      const next = iterator.next()
      if (next.done) {
        // The one place the stated figures are allowed to change.
        settled.value = points.value
        running.value = false
        return
      }
      points.value = [...points.value, next.value]
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      points.value = []
      settled.value = []
      running.value = false
      return
    }
    window.setTimeout(tick, 0)
  }
  window.setTimeout(tick, 0)
}

/**
 * Long enough that editing the plan does not start a sweep per keystroke.
 * Matches the stress card's, and for the same reason: this is work measured in
 * seconds, and paying for it mid-edit is worse than waiting a moment for it.
 */
const RECOMPUTE_DELAY = 350

const { schedule, cancel, pending } = useDebounced(start, RECOMPUTE_DELAY)

/** Waiting out the debounce counts as busy: to a reader the two are the same. */
const busy = computed(() => pending.value || running.value)

/**
 * Recomputes with the rest of the results, and whenever the card is opened.
 *
 * Keyed off `results` rather than the parameters, like the stress card: the
 * store publishes a new results object exactly when something the engine reads
 * has changed, already debounced, and it leaves out `consumptionUnits` — which
 * relabels one line elsewhere and must not cost seventeen propagations.
 */
watch(
  [open, results, rule],
  ([isOpen]) => {
    if (!isOpen) {
      // Closing stops the work rather than merely hiding it, which is the whole
      // reason `open` is a model on the card instead of internal state.
      cancel()
      run++
      points.value = []
      settled.value = []
      running.value = false
      return
    }
    schedule()
  },
  { immediate: true },
)

const planRate = computed(() => planExtraRate(parameters.value))

/** Whether the plan set a bequest target, which decides what the second curve is. */
const hasBequest = computed(() => parameters.value.bequestRatio > 0)

/**
 * What the second probability curve measures.
 *
 * The household's own target where there is one, and the starting capital
 * otherwise — the same measure at a different threshold, so the label has to
 * say which. Without a second curve the chart is one nearly flat line under the
 * adaptive rule, since holding survival flat is exactly what that rule does.
 *
 * Two fixed strings, and deliberately *not* "Arvsmålet nås (50 % av start)":
 * a legend names a series, and a legend that restates an input turns into a
 * second place the figure is written down — one that has to be kept in step
 * with the field it came from and that moves under the reader while they drag a
 * slider. The threshold itself is on the Utgångsläge card, where it was set.
 */
const keepLabel = computed(() => (hasBequest.value ? 'Arvsmålet nås' : 'Startkapitalet kvar realt'))

/** Where the curve meets each target. From the settled sweep, like every figure. */
const crossings = computed(() =>
  SURVIVAL_TARGETS.map((target) => crossingFor(settled.value, target)).filter(
    (crossing) => !!crossing,
  ),
)

/** The rows, including the targets the plan misses outright. */
const rows = computed(() =>
  SURVIVAL_TARGETS.map((target) => ({
    target,
    crossing: crossings.value.find((crossing) => crossing.target === target) ?? null,
  })),
)

const missesSome = computed(() => rows.value.some((row) => row.crossing === null))

/**
 * The settled rung that delivers the most, or `null`.
 *
 * The point rather than the level, because the chart places its mark by value
 * and looking that up among the points being drawn would tie the mark to the
 * sweep in flight instead of the finished one.
 */
const peak = computed(() => {
  const rate = peakDeliveryLevel(settled.value)
  return rate === null ? null : (settled.value.find((point) => point.rate === rate) ?? null)
})

/**
 * What the payout chart sizes its vertical scale from: the finished sweep where
 * there is one, so the axis holds still while the next curve grows into it and
 * the marks placed by value stay where they belong.
 */
const scalePoints = computed(() => (settled.value.length > 0 ? settled.value : points.value))

/**
 * The levels the payout chart rules off, and the name of the curve they came
 * from.
 *
 * Both probability curves fall monotonically in the level, so a threshold on
 * either names a level — which is what lets the payout chart be read against
 * the risk: *at the level where this holds 90% of the time, here is what you
 * get*. `levelMarks` picks one family; the label is what the chart's legend
 * needs to say which, and it reuses `keepLabel` so the two charts cannot
 * disagree about what the kept-capital curve is.
 */
const levels = computed(() => levelMarks(settled.value))

/**
 * The legend's whole phrase for those marks.
 *
 * Written out per family rather than assembled from a stem plus `keepLabel`.
 * The families are different clauses — the plan holding, a target being
 * reached, capital being kept — and gluing them onto one prefix produced
 * "Nivå där: Arvsmålet nås", which is not Swedish anybody would write. An
 * infinitive after *nivåer för* takes all three cleanly.
 */
const marksLabel = computed(() => {
  if (levels.value.family === 'survival') return 'Nivåer för att planen ska hålla'
  return hasBequest.value
    ? 'Nivåer för att nå arvsmålet'
    : 'Nivåer för att behålla startkapitalet realt'
})
</script>

<template>
  <CollapsibleCard
    v-if="results"
    v-model:open="open"
    title="Hållbart extrauttag"
    body-id="planner-sweep-body"
    class="mb-3"
  >
    <template #header>
      <div class="form-check form-switch mb-0">
        <input
          id="planner-sweep-adaptive"
          v-model="adaptive"
          class="form-check-input"
          type="checkbox"
          role="switch"
        />
        <label class="form-check-label small" for="planner-sweep-adaptive">Dynamisk regel</label>
      </div>
    </template>

    <p v-if="error" class="form-text text-danger mb-0">{{ error }}</p>

    <p v-else-if="!sweepable" class="form-text mb-0">
      Uttagsnivån anges som en andel av startkapitalet, så en plan som börjar på noll har ingen nivå
      att variera.
    </p>

    <template v-else>
      <!-- Side by side rather than stacked, because they are one answer in two
           units: what a level costs in risk, and what it is worth in kronor.
           Reading the survival curve alone overstates the level, which is the
           whole hazard of a rate that is only a ceiling. -->
      <div class="row g-4">
        <div class="col-12 col-lg-6">
          <!-- Not "Sannolikhet att planen håller": that is one of the two
               curves, and naming the chart after it would make the other look
               like a footnote to it rather than the one that moves. -->
          <h6 class="chart-title">Sannolikheter vid periodens slut</h6>
          <SweepChart
            :points="points"
            :max="SWEEP_MAX"
            :targets="SURVIVAL_TARGETS"
            :crossings="crossings"
            :plan-rate="planRate"
            :keep-label="keepLabel"
          />
        </div>
        <div class="col-12 col-lg-6">
          <!-- Spelled out because the x-axis is the *extra* alone while the y
               is behov plus extra, and a bare "Uttag per år" leaves a reader to
               guess which of the two a curve is in. -->
          <h6 class="chart-title">Totalt uttag per år (behov + extra)</h6>
          <SweepWithdrawalChart
            :points="points"
            :max="SWEEP_MAX"
            :plan-rate="planRate"
            :capital="parameters.initialCapital"
            :peak="peak"
            :scale-points="scalePoints"
            :marks="levels.marks"
            :marks-label="marksLabel"
          />
        </div>
      </div>

      <!-- The table and the space it will occupy, as one positioned block, so
           the progress indicator can sit over it instead of between the charts
           and the table where it would push everything down each time a sweep
           starts. The block keeps a floor height for the first sweep, when
           there is no table under the overlay yet. -->
      <div class="results mt-4" :class="{ busy }" :aria-busy="busy">
        <!-- Determinate, unlike the stress card's spinner, because here the
             work really is countable — one propagation per rung — so the bar
             reports rather than invents. The count rides on
             aria-valuenow/valuemax, which is where a screen reader looks for
             it, leaving the label to name the control and stay put. -->
        <div v-if="busy" class="overlay">
          <div
            class="progress"
            role="progressbar"
            :aria-valuenow="points.length"
            aria-valuemin="0"
            :aria-valuemax="total"
            aria-label="Räknar uttagsnivåer"
          >
            <div
              class="progress-bar progress-bar-striped progress-bar-animated"
              :style="{ width: `${(points.length / total) * 100}%` }"
            ></div>
          </div>
        </div>

        <!-- Only once a sweep has finished, and dimmed while the next one runs.
             There is nothing truthful to print from a half-finished sweep: a
             target it has not reached down to yet reads as a bound and would
             firm up into a crossing a second later. -->
        <div v-if="settled.length > 0" class="table-responsive">
          <table class="table table-sm align-middle mb-0 sweep-table">
            <thead>
              <tr>
                <th>Planen håller</th>
                <th class="text-end">Nivå</th>
                <th class="text-end">Extrauttag per år</th>
                <th class="text-end">Totalt uttag per år, förväntat</th>
                <th class="text-end">Totalt uttag per år, planerat</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.target">
                <th>{{ formatPercent(row.target * 100) }}</th>
                <template v-if="row.crossing">
                  <td class="text-end">
                    <span v-if="row.crossing.atLeast" class="bound">≥&nbsp;</span
                    >{{ formatPercent(row.crossing.rate * 100) }}
                  </td>
                  <td class="text-end">
                    <span v-if="row.crossing.atLeast" class="bound">≥&nbsp;</span
                    >{{ formatKr(row.crossing.extra) }}
                  </td>
                  <td class="text-end">{{ formatKr(row.crossing.expectedPerYear) }}</td>
                  <td class="text-end planned">{{ formatKr(row.crossing.plannedPerYear) }}</td>
                </template>
                <template v-else>
                  <td v-for="column in 4" :key="column" class="text-end">–</td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="settled.length > 0" class="form-text mt-2 mb-0">
          Den högsta uttagsnivå som når respektive sannolikhet, interpolerad mellan de räknade
          punkterna. De två sista kolumnerna är behov plus extra per år: vad nivån ber om, och vad
          den väntas ge.
          <template v-if="missesSome">
            Ett streck betyder att behovsuttaget ensamt ligger under nivån; inget extrauttag köper
            tillbaka den.
          </template>
          <template v-else-if="rows.some((row) => row.crossing?.atLeast)">
            Ett ≥-tecken betyder att kurvan aldrig föll under nivån inom det räknade intervallet.
          </template>
        </p>
      </div>

      <!-- Only what this card adds. What ruin means, what the dynamiska
           körningen does and what the runs are named are all established by the
           cards above and by Om metoden; repeating them here buries the one
           thing a reader has to know to read these two charts. -->
      <div class="mt-4">
        <p class="form-text mb-0">
          Extrauttaget sätts här till en fast andel av startkapitalet, bestämd vid start och
          konstant realt resten av planen — tumregeln om ”fyra procent” ställd som fråga.
          Behovsuttaget är planens eget; det extrauttag du matat in ersätts av nivån på x-axeln.
        </p>
        <p v-if="rule === 'adaptive'" class="form-text mb-0 mt-2">
          <strong>Med den dynamiska regeln är nivån ett tak, inte ett fast uttag.</strong> Att hålla
          sannolikheten att planen håller platt är just vad regeln är till för, så den kurvan säger
          nästan ingenting om nivån. Vad nivån kostar syns i stället i den andra kurvan och i
          avståndet mellan planerat och förväntat uttag. Slå av regeln för att i stället ta ut nivån
          varje år oavsett saldo — Bengens ursprungliga fråga.
        </p>
        <p v-else class="form-text mb-0 mt-2">
          <strong>Utan den dynamiska regeln tas nivån ut varje år oavsett saldo</strong>, tills
          planen inte längre klarar behovsuttaget — Bengens ursprungliga fråga, och den som
          tumreglerna om fyra procent besvarar.
        </p>
        <p v-if="peak !== null" class="form-text mb-0 mt-2">
          Markeringen visar nivån som ger <em>mest</em> utbetalt: över den får hushållet mindre,
          inte mer, eftersom uttaget kostar fler år än det köper.
        </p>
      </div>
    </template>
  </CollapsibleCard>
</template>

<style scoped>
/* The two charts are one answer in two units, so they are titled rather than
   given card headers of their own — they are not separate cards. */
.chart-title {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--bs-secondary-color);
}

.sweep-table tbody th {
  font-weight: 500;
  padding-left: 0;
}

.sweep-table td {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* The figures and the space they will occupy, as one block the progress
   indicator can be laid over. A floor height so the first sweep, which has no
   table to overlay yet, does not hand the card a different height the moment
   one arrives — the charts above must not move while a sweep runs. */
.results {
  position: relative;
  /* Tall enough to hold the table and its footnote, so the first sweep does not
     hand the card a different height the moment they arrive. The stress card
     reserves its waiting box the same way and for the same reason. A little
     over rather than under: extra sentences in the footnote are conditional, and
     a floor that grows is a jump where slack is only a few pixels of air. */
  min-height: 13rem;
}

/* The previous sweep's figures, while the next one is being computed. Dimmed
   rather than dropped, so a reader dragging a slider keeps what they were
   comparing against — and dimmed rather than left alone, because stale figures
   at full strength read as current. */
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

/* Sized rather than full width: over a table it reads as an indicator, where a
   rule spanning the card would read as part of the layout. */
.overlay .progress {
  width: 12rem;
  height: 0.4rem;
}

/* The bound marker is a qualifier on the figure, not part of it. */
.bound {
  color: var(--bs-secondary-color);
}

/* What the level asks for, muted against what it delivers: it is the reference
   the column beside it is read against, not an outcome of its own. */
.sweep-table td.planned {
  color: var(--bs-secondary-color);
}
</style>
