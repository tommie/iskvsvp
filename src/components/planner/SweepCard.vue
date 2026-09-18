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
 * Everything stated in words or numbers reads from here rather than from
 * `points`: the table, its footnote, the note about the peak, and the chart's
 * own annotations. A curve growing a point at a time reads as progress, but a
 * table rewriting its figures seventeen times reads as flicker — and the early
 * rungs genuinely do give different answers, because a target the sweep has not
 * reached down to yet is reported as a bound and then firms up into a crossing.
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

/** Whether the chart has a peak to point at, which decides if its note shows. */
const peak = computed(() => peakDeliveryLevel(settled.value))

/**
 * The chart's annotations, withheld while a sweep is in flight.
 *
 * Dots and a marked level belong to a finished answer, and the curve under them
 * is being redrawn from the first rung — a dot left sitting on the previous
 * sweep's crossing would be pointing at a line that is no longer there. The
 * table can afford to go stale under a dim because it is read as text; a mark on
 * a moving curve cannot.
 */
const chartCrossings = computed(() => (busy.value ? [] : crossings.value))
const chartPeak = computed(() => (busy.value ? null : peak.value))

/**
 * The levels the payout chart rules off, and the name of the curve they came
 * from.
 *
 * Both probability curves fall monotonically in the level, so a threshold on
 * either names a level — which is what lets the payout chart be read against
 * the risk: *at the level where this holds 90% of the time, here is what you
 * get*. `levelMarks` picks one family; the label here is what the chart's
 * legend needs to say which, and it reuses `keepLabel` so the two charts cannot
 * disagree about what the kept-capital curve is.
 */
const levels = computed(() => levelMarks(settled.value))
const chartMarks = computed(() => (busy.value ? [] : levels.value.marks))

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
            :crossings="chartCrossings"
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
            :peak="chartPeak"
            :marks="chartMarks"
            :marks-label="marksLabel"
          />
        </div>
      </div>

      <!-- Determinate, unlike the stress card's spinner: here the work really
           is countable — one propagation per rung — so the bar can say where it
           has got to instead of inventing progress. The count rides on
           aria-valuenow/valuemax, which is where a screen reader looks for it,
           leaving the label to name the control and stay put. -->
      <div v-if="running" class="progress mt-3" style="height: 0.35rem">
        <div
          class="progress-bar progress-bar-striped progress-bar-animated"
          role="progressbar"
          :style="{ width: `${(points.length / total) * 100}%` }"
          :aria-valuenow="points.length"
          aria-valuemin="0"
          :aria-valuemax="total"
          aria-label="Räknar uttagsnivåer"
        ></div>
      </div>

      <!-- Only once a sweep has finished, and dimmed while the next one runs.
           There is nothing truthful to print from a half-finished sweep: a
           target it has not reached down to yet reads as a bound and would
           firm up into a crossing a second later. -->
      <div v-if="settled.length > 0" class="table-responsive mt-4" :aria-busy="busy">
        <table class="table table-sm align-middle mb-0 sweep-table" :class="{ stale: busy }">
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
        Den högsta uttagsnivå som fortfarande når respektive sannolikhet, interpolerad mellan de
        räknade punkterna. De två sista kolumnerna är behov plus extra per år — vad nivån ber om,
        och vad den faktiskt väntas ge — och är alltså direkt jämförbara med tumregler av typen
        ”fyra procent av startkapitalet”.
        <template v-if="missesSome">
          Ett streck betyder att behovsuttaget ensamt ligger under nivån, och då finns inget
          extrauttag som köper tillbaka den; kurvans vänstra ände visar var behovet hamnar.
        </template>
        <template v-else-if="rows.some((row) => row.crossing?.atLeast)">
          Ett ≥-tecken betyder att kurvan aldrig föll under nivån inom det räknade intervallet.
        </template>
      </p>

      <div class="mt-4">
        <p class="form-text mb-0">
          Kurvorna sätter extrauttaget till en fast andel av startkapitalet, bestämd vid start och
          därefter konstant realt genom hela planen — samma fråga som ligger bakom tumreglerna om
          ”fyra procent”. Behovsuttaget är planens eget, med sin form och sina insättningsår; det
          extrauttag du matat in används däremot inte här, utan ersätts av nivån på x-axeln. Vid
          0&nbsp;% är kurvan därför Minimum-körningen: enbart behovet. Att planen håller betyder som
          vanligt att hela behovsuttaget kunnat betalas varje år; att missa arvsmålet räknas inte
          som att planen spricker. X-axeln är genomgående <em>extrauttaget</em>, medan den högra
          grafens y-axel är behov plus extra — det totala uttaget per år, så att det går att läsa
          mot tumreglerna direkt. Dess andra axel visar samma belopp som andel av startkapitalet.
        </p>
        <p v-if="peak !== null" class="form-text mb-0 mt-2">
          Markeringen i den högra grafen visar den nivå som ger <em>mest</em> utbetalt. Över den får
          hushållet mindre, inte mer — det större uttaget kostar fler år än det köper, eftersom en
          plan som spruckit slutar betala ut helt. Att uttaget aldrig kan överstiga det planerade
          gäller år för år, så snittkurvan ligger under den streckade av konstruktion och bandets
          undre kant under snittet; bara bandets övre kant kan nå upp till den.
        </p>
        <p class="form-text mb-0 mt-2">
          Den andra kurvan i vänstra grafen är
          <template v-if="hasBequest"
            >sannolikheten att nå arvsmålet, alltså hushållets eget mål</template
          ><template v-else
            >sannolikheten att startkapitalet finns kvar realt vid periodens slut — samma mått som
            arvsmålet, med tröskeln satt vid hela startkapitalet eftersom planen inte angett
            något</template
          >. Måttet är efter latent skatt, som allt annat slutkapital här.
        </p>
        <p v-if="rule === 'adaptive'" class="form-text mb-0 mt-2">
          <strong>Med den dynamiska regeln är nivån ett tak, inte ett fast uttag.</strong> Ett år
          betalar bara så mycket av den som överskottet över det reserverade behovet — och ett
          eventuellt arvsmål — räcker till. Att hålla den kurvan platt är just vad regeln är till
          för, så sannolikheten att planen håller säger mest om behovsuttaget och nästan ingenting
          om nivån. Vad nivån kostar syns i stället på de två andra ställena: i kurvan för
          kvarvarande kapital, och i den högra grafen, där det förväntade uttaget slutar följa det
          planerade. Slå av regeln för att i stället ta ut nivån varje år oavsett saldo, vilket är
          den ursprungliga frågan bakom SAFEMAX.
        </p>
        <p v-else class="form-text mb-0 mt-2">
          <strong>Utan den dynamiska regeln tas nivån ut varje år oavsett saldo</strong>, tills
          planen inte längre klarar behovsuttaget — Bengens ursprungliga fråga, och den som
          tumreglerna om fyra procent besvarar. Sannolikhetskurvan faller därför hela vägen, och det
          förväntade uttaget viker av från det planerade av en annan orsak än ovan: en plan som
          spruckit slutar betala ut helt.
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

/* The previous sweep's figures, while the next one is being computed. Dimmed
   rather than dropped, so a reader dragging a slider keeps what they were
   comparing against — and dimmed rather than left alone, because stale figures
   at full strength read as current. */
.sweep-table.stale {
  opacity: 0.35;
  transition: opacity 0.15s ease-in-out;
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
