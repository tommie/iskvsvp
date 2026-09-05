<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { usePlannerStore } from '../../stores/planner'
import type { PropagationRun } from '../../planner/types'
import FanChart from './charts/FanChart.vue'
import SurvivalChart from './charts/SurvivalChart.vue'
import WithdrawalChart from './charts/WithdrawalChart.vue'
import FinalDistributionChart from './charts/FinalDistributionChart.vue'
import { ADAPTIVE_COLOR, EXTRA_COLOR, NEED_COLOR } from './charts/shared'
import { formatKr, formatPercent, formatRelative } from '../../planner/format'

const store = usePlannerStore()
const { results, cashflow, initialCapital, bequestRatio } = storeToRefs(store)

/** The bequest target as an amount; 0 when the plan sets none. */
const bequestTarget = computed(() => Math.max(0, bequestRatio.value) * initialCapital.value)

const logScale = ref(true)

/**
 * Report the final capital net of the capital gains tax still embedded in it.
 *
 * On by default, because it is the only basis on which the numbers are
 * comparable: an ISK owes nothing at the end, so its balance is already net,
 * and the withdrawals row is money that has actually been handed over. Showing
 * an AF balance gross alongside those flatters it by the deferred tax.
 */
const netOfTax = ref(true)

/**
 * Show each figure as its change from where that column started, rather than as
 * an amount.
 *
 * Read down a column, every figure has an obvious thing it is a change *from*:
 * the final capital from the capital paid in, and what the plan expects to hand
 * over from what it set out to. Both comparisons are otherwise a division the
 * reader has to do, and the answer to "did this preserve capital" is a
 * percentage, not two balances. Off by default, because kronor are what a
 * household budgets against.
 */
const relative = ref(false)

/** A figure as an amount, or as its change from the column's own reference. */
function amount(value: number, reference: number): string {
  return relative.value ? formatRelative(value, reference) : formatKr(value)
}

const runs = computed(() => {
  if (!results.value) return []
  const resolve = (run: PropagationRun, color: string, dashed: boolean) => {
    const net = netOfTax.value ? run.liquidOutcomes : undefined
    return {
      run,
      color,
      dashed,
      outcomes: net ?? run.outcomes,
      distribution:
        (netOfTax.value ? run.finalLiquidDistribution : undefined) ?? run.finalDistribution,
    }
  }
  // Both fixed runs are drawn dashed and the dynamic one solid. The dashes say
  // what kind of line it is rather than which run it is: Minimum and Maximum are
  // bounds the plan is read against, spending their amount whatever happens,
  // while Dynamisk is the outcome between them. Colour still tells the three
  // apart, so nothing is lost by the two bounds sharing a stroke style.
  return [
    resolve(results.value.needRun, NEED_COLOR, true),
    resolve(results.value.adaptiveRun, ADAPTIVE_COLOR, false),
    resolve(results.value.extraRun, EXTRA_COLOR, true),
  ]
})

const summary = computed(() => {
  if (!results.value) return null
  const build = (entry: (typeof runs.value)[number]) => {
    const final = entry.outcomes[entry.outcomes.length - 1]!
    return {
      label: entry.run.label,
      // Carried so the table's column headers can be tied to the series they
      // belong to, which is otherwise only findable via the chart legend.
      color: entry.color,
      dashed: entry.dashed,
      survival: (1 - final.ruinProbability) * 100,
      median: final.median,
      percentile10: final.percentile10,
      percentile90: final.percentile90,
      withdrawn: entry.run.plannedWithdrawn,
      actualWithdrawn: entry.run.expectedWithdrawn,
      bequest: entry.run.bequestProbability,
    }
  }
  return runs.value.map(build)
})

/** Whether any run actually carries deferred tax, i.e. whether the toggle does anything. */
const hasDeferredTax = computed(
  () =>
    !!results.value &&
    (results.value.needRun.liquidOutcomes !== undefined ||
      results.value.extraRun.liquidOutcomes !== undefined),
)

/** Warns when the grid could not hold the upper tail; see PropagationRun.clippedMass. */
const gridWarning = computed(() => {
  if (!results.value) return null
  const worst = Math.max(results.value.needRun.clippedMass, results.value.extraRun.clippedMass)
  return worst > 1e-6 ? worst : null
})
</script>

<template>
  <div v-if="summary">
    <!--
      Chart and table are one subject in two cards, side by side from lg up and
      stacked below it. Equal halves, matching the pair of cards further down, so
      the page reads as a grid rather than as four differently sized panels.
      Chart first: it is what the plan looks like, and the table is the reading
      of it.
    -->
    <div class="row g-3 mb-3">
      <div class="col-12 col-lg-6">
        <FanChart
          v-model:log-scale="logScale"
          :runs="runs"
          :bequest-target="bequestTarget"
          class="h-100"
        />
      </div>

      <div class="col-12 col-lg-6">
        <div class="card h-100">
          <div
            class="card-header d-flex justify-content-between align-items-center flex-wrap gap-3"
          >
            <span>Slutkapital och uttag</span>
            <div class="d-flex gap-3">
              <!-- Both switches change how this table reads, and the deferred-tax
                   one is explained in its footnote; the fan chart follows the
                   same basis because the two must not disagree. -->
              <div v-if="hasDeferredTax" class="form-check form-switch mb-0">
                <input
                  id="planner-net-of-tax"
                  v-model="netOfTax"
                  class="form-check-input"
                  type="checkbox"
                  role="switch"
                />
                <label class="form-check-label small" for="planner-net-of-tax"
                  >Efter latent skatt</label
                >
              </div>
              <div class="form-check form-switch mb-0">
                <input
                  id="planner-relative"
                  v-model="relative"
                  class="form-check-input"
                  type="checkbox"
                  role="switch"
                />
                <label class="form-check-label small" for="planner-relative"
                  >Förändring från start</label
                >
              </div>
            </div>
          </div>
          <div class="card-body">
            <div class="table-responsive">
              <!-- Full width of its card rather than sized to content: in half a row
               the columns would otherwise want more than they can have, and a
               wrapped row header beats a table that scrolls sideways. -->
              <table class="table table-sm table-hover align-middle mb-0 summary-table">
                <thead>
                  <tr>
                    <th></th>
                    <th
                      v-for="row in summary"
                      :key="row.label"
                      class="text-center series"
                      :class="{ dashed: row.dashed }"
                      :style="{ '--line-color': row.color }"
                    >
                      {{ row.label }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>Totalt planerat uttag</th>
                    <td v-for="row in summary" :key="row.label" class="text-end">
                      {{ formatKr(row.withdrawn) }}
                    </td>
                  </tr>
                  <!-- Against the planned total in the row above: the plan is what
                   the column set out to hand over, so falling short of it is
                   what the expected figure has to say. -->
                  <tr>
                    <th>Förväntat faktiskt uttag</th>
                    <td v-for="row in summary" :key="row.label" class="text-end">
                      {{ amount(row.actualWithdrawn, row.withdrawn) }}
                    </td>
                  </tr>
                  <tr>
                    <th>Sannolikhet att planen håller</th>
                    <td v-for="row in summary" :key="row.label" class="text-end">
                      {{ formatPercent(row.survival) }}
                    </td>
                  </tr>
                  <!-- Only the adaptive run aims at the target, but all three
                       are shown: what målet kostar is the difference between
                       columns, and a fast plan som råkar nå det ändå är värt
                       att se. -->
                  <tr v-if="bequestTarget > 0">
                    <th>Sannolikhet att nå arvsmålet</th>
                    <td v-for="row in summary" :key="row.label" class="text-end">
                      {{ row.bequest === undefined ? '—' : formatPercent(row.bequest * 100) }}
                    </td>
                  </tr>
                  <!-- Against the capital paid in. Both are in today's money, so the
                   change is real growth net of everything the plan withdrew. -->
                  <tr>
                    <th>10:e percentilen</th>
                    <td v-for="row in summary" :key="row.label" class="text-end">
                      {{ amount(row.percentile10, initialCapital) }}
                    </td>
                  </tr>
                  <tr>
                    <th>Median slutkapital</th>
                    <td v-for="row in summary" :key="row.label" class="text-end">
                      {{ amount(row.median, initialCapital) }}
                    </td>
                  </tr>
                  <tr>
                    <th>90:e percentilen</th>
                    <td v-for="row in summary" :key="row.label" class="text-end">
                      {{ amount(row.percentile90, initialCapital) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="form-text mt-3 mb-0">
              Det planerade uttaget är vad planen begär över hela tidsperioden, inte vad en plan som
              spruckit hann ta ut. För den dynamiska körningen är det dessutom bara ett tak: det
              extra tas i den mån överskottet över behovets reserv räcker till. Det förväntade
              faktiska uttaget väger in båda sakerna — uteblivna extrauttag och år som aldrig
              inträffar för att planen sprack — och är därför måttet som går att jämföra mellan
              kolumnerna. Percentilerna är ovillkorade: en plan som spricker räknas som noll kronor,
              inte som bortfall. Därför kan 10:e percentilen vara noll när risken att planen
              spricker överstiger 10&nbsp;%.
              <template v-if="bequestTarget > 0">
                Arvsmålet mäts i dagens penningvärde och efter eventuell latent skatt — det är vad
                som faktiskt blir kvar till någon annan. Bara den dynamiska körningen siktar på det:
                målet reserveras vid sidan av behovet, så det är det extra uttaget som betalar för
                det. Att missa målet är inte att planen spricker; det är fortfarande behovet som
                avgör den saken.
              </template>
              <template v-if="relative">
                Uttaget visas som förändring mot kolumnens planerade uttag, kapitalet som förändring
                mot startkapitalet — båda i dagens penningvärde, så förändringen är real. Det
                planerade uttaget står kvar i kronor: det är vad du själv angett, och det de andra
                räknas mot.
              </template>
              <template v-if="hasDeferredTax">
                Beloppen är
                <template v-if="netOfTax">efter</template><template v-else>före</template> den
                uppskjutna kapitalvinstskatten. Ett AF-konto skjuter upp skatten snarare än slipper
                den, så först efter avdrag är slutkapitalet jämförbart med uttagen och med ett ISK,
                som inte är skyldigt något vid tidsperiodens slut.
              </template>
            </p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="gridWarning" class="alert alert-warning">
      {{ formatPercent(gridWarning * 100) }} av sannolikhetsmassan nådde toppen av rutnätet. De övre
      percentilerna är underskattade — öka rutnätet eller sänk avkastningen.
    </div>

    <!-- Directly under the table that totals the withdrawals, because it is the
         same subject year by year: the table says how much the plan expects to
         hand over, this says when. Full width — forty yearly amounts need the
         room, and the band is only a few per cent of the axis tall. -->
    <WithdrawalChart v-if="results" :adaptive="results.adaptiveRun" :cashflow="cashflow" />

    <!-- Every block on the page carries its own bottom margin rather than
         relying on what follows it, so the sections keep an even rhythm whatever
         order they are in. -->
    <div class="row g-3 mb-3">
      <div class="col-12 col-lg-6">
        <SurvivalChart :runs="runs" class="h-100" />
      </div>
      <div class="col-12 col-lg-6">
        <FinalDistributionChart :runs="runs" :bequest-target="bequestTarget" class="h-100" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The figures are the point of the table, so the columns give them room and the
   row header gives up what it needs to. Bootstrap 5.3 hardcodes .table-sm
   padding rather than exposing a custom property, so this overrides the cells
   directly; the scoped attribute gives it the specificity to win. */
.summary-table th,
.summary-table td {
  padding-left: 0.5rem;
  padding-right: 0.5rem;
}

/* Ties each column to the series it is, using the same colour and the same
   3px rule as the chart legend — and the same dashes for the run the charts
   draw dashed, so the whole encoding survives the move into the table.

   An underline rather than coloured label text: the series palette is chosen to
   be told apart as strokes on white, and two of the three fall below the
   contrast a body-text colour needs (#fd7e14 is about 2.2:1). A rule carries
   the colour without asking anyone to read through it.

   Both rules are painted as backgrounds, and neither as a border. Mixing the
   two cannot line up: the table collapses its borders, so a border is centred
   on the grid line and hangs half its width below the cell edge, while a
   background stops at the edge. At 3px that left the dashed column's rule
   sitting 1.5px above the solid ones — its middle on their top edge. With no
   border in play the padding box and the border box coincide, and `bottom`
   means the same thing for both. */
.summary-table thead th.series {
  border-bottom: 0;
  padding-bottom: calc(0.25rem + 3px);
  background-image: linear-gradient(var(--line-color), var(--line-color));
  background-repeat: no-repeat;
  background-position: bottom;
  background-size: 100% 3px;
}

.summary-table thead th.series.dashed {
  background-image: repeating-linear-gradient(90deg, var(--line-color) 0 6px, transparent 6px 10px);
}

/* The row header and the column headers wrap; the figures never do. Breaking
   "7,8 mkr" across two lines costs a reader more than a two-line label does, and
   the labels are the only cells with slack to give. */
.summary-table tbody th {
  font-weight: 500;
  padding-left: 0;
}

.summary-table td {
  white-space: nowrap;
}

/* The series colour arrives as a custom property rather than as an inline
   background, so the dashed variant can paint with it too: an inline background
   shorthand would win over any stylesheet rule and flatten the dashes back to a
   solid bar. */
.line {
  display: inline-block;
  width: 1.5rem;
  height: 3px;
  vertical-align: 3px;
  margin-right: 0.25rem;
  background-color: var(--line-color);
}

/* Same 6-on, 4-off rhythm as the stroke-dasharray the chart draws with. */
.line.dashed {
  background-color: transparent;
  background-image: repeating-linear-gradient(90deg, var(--line-color) 0 6px, transparent 6px 10px);
}
</style>
