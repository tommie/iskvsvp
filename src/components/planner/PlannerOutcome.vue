<script setup lang="ts">
import { computed, ref } from 'vue'
import * as d3 from 'd3'
import { storeToRefs } from 'pinia'

import { usePlannerStore } from '../../stores/planner'
import type { PropagationRun } from '../../planner/types'
import { densityBins } from '../../planner/density'
import { formatKr, formatPercent, formatRelative } from '../../planner/format'
import D3Chart from '../D3Chart.vue'

const store = usePlannerStore()
const { results, cashflow, initialCapital } = storeToRefs(store)

const FLOOR_COLOR = '#0d6efd'
const OPTIONAL_COLOR = '#fd7e14'
const ADAPTIVE_COLOR = '#6f42c1'
const CHART_HEIGHT = 320

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

/**
 * Svenska skrivregler puts a space before the percent sign, and a non-breaking
 * one so the number and its unit never split across a line. This matches what
 * Intl's own sv-SE percent style emits.
 */
const NBSP = '\u00a0'

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
  return [
    resolve(results.value.floorRun, FLOOR_COLOR, false),
    resolve(results.value.adaptiveRun, ADAPTIVE_COLOR, false),
    resolve(results.value.optionalRun, OPTIONAL_COLOR, true),
  ]
})

/** Total real cash taken out over the horizon, for context on the trade-off. */
function totalWithdrawn(includeOptional: boolean): number {
  return cashflow.value.reduce(
    (sum, year) => sum + year.floor + (includeOptional ? year.optional : 0),
    0,
  )
}

const summary = computed(() => {
  if (!results.value) return null
  const build = (entry: (typeof runs.value)[number], includeOptional: boolean) => {
    const final = entry.outcomes[entry.outcomes.length - 1]!
    return {
      label: entry.run.label,
      survival: (1 - final.ruinProbability) * 100,
      median: final.median,
      percentile10: final.percentile10,
      percentile90: final.percentile90,
      withdrawn: totalWithdrawn(includeOptional),
      actualWithdrawn: entry.run.expectedWithdrawn,
    }
  }
  return [build(runs.value[0]!, false), build(runs.value[1]!, true), build(runs.value[2]!, true)]
})

/** Whether any run actually carries deferred tax, i.e. whether the toggle does anything. */
const hasDeferredTax = computed(
  () =>
    !!results.value &&
    (results.value.floorRun.liquidOutcomes !== undefined ||
      results.value.optionalRun.liquidOutcomes !== undefined),
)

/** Warns when the grid could not hold the upper tail; see PropagationRun.clippedMass. */
const gridWarning = computed(() => {
  if (!results.value) return null
  const worst = Math.max(results.value.floorRun.clippedMass, results.value.optionalRun.clippedMass)
  return worst > 1e-6 ? worst : null
})

function axes(
  svgEl: SVGSVGElement,
  container: HTMLDivElement,
  margin: { top: number; right: number; bottom: number; left: number },
) {
  const width = Math.max(320, container.clientWidth)
  const height = CHART_HEIGHT
  const svg = d3.select(svgEl)
  svg.selectAll('*').remove()
  svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)
  const plot = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)
  return {
    plot,
    innerWidth: width - margin.left - margin.right,
    innerHeight: height - margin.top - margin.bottom,
  }
}

// --- Fan chart --------------------------------------------------------

const chartData = computed(() => ({
  results: results.value,
  logScale: logScale.value,
  netOfTax: netOfTax.value,
}))

const renderFan = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value) return
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    right: 16,
    bottom: 36,
    left: 84,
  })

  const outcomes = runs.value[0]!.outcomes
  const x = d3
    .scaleLinear()
    .domain([outcomes[0]!.age, outcomes[outcomes.length - 1]!.age])
    .range([0, innerWidth])

  const upper = d3.max(runs.value, (entry) => d3.max(entry.outcomes, (o) => o.percentile90)) ?? 1

  // A log axis cannot show ruin, which sits at exactly zero. The floor is set
  // to a small fraction of the top of the range so a collapsing plan still
  // reads as "falls off the chart" rather than being clipped invisibly.
  const floor = Math.max(1, upper * 1e-4)
  const y = logScale.value
    ? d3.scaleLog().domain([floor, upper]).range([innerHeight, 0]).clamp(true)
    : d3.scaleLinear().domain([0, upper]).range([innerHeight, 0])

  plot
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format('d')))

  // A log scale ignores ticks() and emits every minor tick, which collapses
  // into an unreadable block of overlapping labels over four decades. Pin the
  // ticks to the decades instead.
  const leftAxis = d3.axisLeft(y).tickFormat((value) => formatKr(Number(value)))
  if (logScale.value) {
    leftAxis.tickValues(
      d3
        .range(Math.ceil(Math.log10(floor)), Math.floor(Math.log10(upper)) + 1)
        .map((exponent) => Math.pow(10, exponent)),
    )
  } else {
    leftAxis.ticks(6)
  }
  plot.append('g').call(leftAxis)

  for (const { outcomes: series, color, dashed } of runs.value) {
    const band = d3
      .area<(typeof series)[number]>()
      .x((o) => x(o.age))
      .y0((o) => y(Math.max(floor, o.percentile10)))
      .y1((o) => y(Math.max(floor, o.percentile90)))

    plot.append('path').datum(series).attr('d', band).attr('fill', color).attr('fill-opacity', 0.15)

    const line = d3
      .line<(typeof series)[number]>()
      .x((o) => x(o.age))
      .y((o) => y(Math.max(floor, o.median)))

    plot
      .append('path')
      .datum(series)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', dashed ? '6 4' : null)
  }
}

// --- Survival probability ---------------------------------------------

const renderSurvival = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value) return
  // The wider right margin holds the end-of-horizon labels.
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    right: 58,
    bottom: 36,
    left: 60,
  })

  const outcomes = results.value.floorRun.outcomes
  const x = d3
    .scaleLinear()
    .domain([outcomes[0]!.age, outcomes[outcomes.length - 1]!.age])
    .range([0, innerWidth])
  // The full probability scale, not a zoomed one: truncating the axis would
  // exaggerate the distance between two plans that both mostly hold.
  const y = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0])

  plot
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format('d')))
  plot.append('g').call(
    d3
      .axisLeft(y)
      .ticks(5)
      .tickFormat((value) => `${Math.round(Number(value) * 100)}${NBSP}%`),
  )

  const survival = (outcome: { ruinProbability: number }) => 1 - outcome.ruinProbability
  const endLabels: { y: number; text: string; color: string }[] = []

  for (const { outcomes: series, color, dashed } of runs.value) {
    const line = d3
      .line<(typeof series)[number]>()
      .x((o) => x(o.age))
      .y((o) => y(survival(o)))
    plot
      .append('path')
      .datum(series)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', dashed ? '6 4' : null)

    const final = survival(series[series.length - 1]!)
    endLabels.push({ y: y(final), text: formatPercent(final * 100), color })
  }

  // Two plans that both hold would otherwise print their labels on top of each
  // other, so separate them once they come within a line height.
  const MIN_LABEL_GAP = 13
  endLabels.sort((a, b) => a.y - b.y)
  for (let i = 1; i < endLabels.length; i++) {
    const gap = endLabels[i]!.y - endLabels[i - 1]!.y
    if (gap < MIN_LABEL_GAP) endLabels[i]!.y = endLabels[i - 1]!.y + MIN_LABEL_GAP
  }

  for (const label of endLabels) {
    plot
      .append('text')
      .attr('x', innerWidth + 6)
      .attr('y', label.y)
      .attr('dy', '0.32em')
      .attr('font-size', 12)
      .attr('font-weight', 600)
      // A style, not an attribute: D3Chart's stylesheet forces text to
      // currentColor, and a presentation attribute would lose to it.
      .style('fill', label.color)
      .text(label.text)
  }
}

// --- Final capital distribution ---------------------------------------

const renderFinal = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value) return
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    // Wide enough for the peak labels in the right margin.
    right: 66,
    bottom: 36,
    left: 60,
  })

  const series = runs.value.map(({ distribution, color, dashed }) => ({
    color,
    dashed,
    bins: densityBins(distribution, 160),
  }))

  const all = series.flatMap((s) => s.bins).filter((bin) => bin.density > 0)
  if (all.length === 0) return

  const x = d3
    .scaleLog()
    .domain([d3.min(all, (bin) => bin.value)!, d3.max(all, (bin) => bin.value)!])
    .range([0, innerWidth])
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(all, (bin) => bin.density)!])
    .range([innerHeight, 0])

  plot
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(6)
        .tickFormat((value) => formatKr(Number(value))),
    )
  plot.append('g').call(
    d3
      .axisLeft(y)
      .ticks(5)
      .tickFormat((value) => `${Math.round(Number(value) * 100)}${NBSP}%`),
  )

  const labels: { y: number; text: string; color: string }[] = []

  for (const s of series) {
    const line = d3
      .line<(typeof s.bins)[number]>()
      .x((bin) => x(bin.value))
      .y((bin) => y(bin.density))
      .curve(d3.curveMonotoneX)
    plot
      .append('path')
      .datum(s.bins.filter((bin) => bin.value > 0))
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', s.color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', s.dashed ? '6 4' : null)

    const peak = s.bins.reduce((best, bin) => (bin.density > best.density ? bin : best), s.bins[0]!)
    if (!(peak.density > 0)) continue

    // A dot on the crest, so "topp" in the margin has something to point at.
    plot
      .append('circle')
      .attr('cx', x(peak.value))
      .attr('cy', y(peak.density))
      .attr('r', 3)
      .attr('fill', s.color)

    labels.push({ y: y(peak.density), text: formatKr(peak.value), color: s.color })
  }

  const MIN_LABEL_GAP = 13
  labels.sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) {
    const gap = labels[i]!.y - labels[i - 1]!.y
    if (gap < MIN_LABEL_GAP) labels[i]!.y = labels[i - 1]!.y + MIN_LABEL_GAP
  }

  for (const label of labels) {
    plot
      .append('text')
      .attr('x', innerWidth + 6)
      .attr('y', label.y)
      .attr('dy', '0.32em')
      .attr('font-size', 11)
      .attr('font-weight', 600)
      // A style, not an attribute: D3Chart's stylesheet forces text to
      // currentColor, and a presentation attribute would lose to it.
      .style('fill', label.color)
      .text(label.text)
  }
}
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
        <div class="card h-100">
          <div
            class="card-header d-flex justify-content-between align-items-center flex-wrap gap-3"
          >
            <span>Kapital över tid i dagens penningvärde</span>
            <div class="form-check form-switch mb-0">
              <input
                id="planner-log-scale"
                v-model="logScale"
                class="form-check-input"
                type="checkbox"
                role="switch"
              />
              <label class="form-check-label small" for="planner-log-scale"
                >Logaritmisk skala</label
              >
            </div>
          </div>
          <div class="card-body">
            <D3Chart :render-chart="renderFan" :data="chartData" />
            <!-- Named, coloured and dashed from the runs themselves, so a curve
                 here and a column in the table beside it can never end up with
                 different names for the same run. -->
            <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
              <span v-for="entry in runs" :key="entry.run.label">
                <span
                  class="line"
                  :class="{ dashed: entry.dashed }"
                  :style="{ '--line-color': entry.color }"
                ></span>
                {{ entry.run.label }}
              </span>
            </div>
          </div>
        </div>
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
                    <th v-for="row in summary" :key="row.label" class="text-end">
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
            <p class="form-text mb-0">
              Det planerade uttaget är vad planen begär över hela horisonten, inte vad en plan som
              spruckit hann ta ut. För den anpassade körningen är det dessutom bara ett tak:
              tillvalet tas i den mån överskottet över golvets reserv räcker till. Det förväntade
              faktiska uttaget väger in båda sakerna — uteblivna tillval och år som aldrig inträffar
              för att planen sprack — och är därför måttet som går att jämföra mellan kolumnerna.
              Percentilerna är ovillkorade: en plan som spricker räknas som noll kronor, inte som
              bortfall. Därför kan 10:e percentilen vara noll när risken att planen spricker
              överstiger 10&nbsp;%.
              <template v-if="relative">
                Uttaget visas som förändring mot kolumnens planerade uttag, kapitalet som förändring
                mot startkapitalet ({{ formatKr(initialCapital) }}) — båda i dagens penningvärde, så
                förändringen är real. Det planerade uttaget står kvar i kronor: det är vad du själv
                angett, och det de andra räknas mot.
              </template>
              <template v-if="hasDeferredTax">
                Beloppen är
                <template v-if="netOfTax">efter</template><template v-else>före</template> den
                uppskjutna kapitalvinstskatten. Ett AF-konto skjuter upp skatten snarare än slipper
                den, så först efter avdrag är slutkapitalet jämförbart med uttagen och med ett ISK,
                som inte är skyldigt något vid horisontens slut.
              </template>
            </p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="gridWarning" class="alert alert-warning">
      {{ formatPercent(gridWarning * 100) }} av sannolikhetsmassan nådde toppen av rutnätet. De övre
      percentilerna är underskattade — öka horisontens rutnät eller sänk avkastningen.
    </div>

    <div class="row g-3">
      <div class="col-12 col-lg-6">
        <div class="card h-100">
          <div class="card-header">Sannolikhet att planen håller</div>
          <div class="card-body">
            <D3Chart :render-chart="renderSurvival" :data="chartData" />
            <p class="form-text mb-0">
              Sannolikheten att portföljen fortfarande klarar hela golvuttaget. Tillståndet är
              absorberande — en senare insättning räddar inte en plan som redan spruckit.
            </p>
          </div>
        </div>
      </div>
      <div class="col-12 col-lg-6">
        <div class="card h-100">
          <div class="card-header">Fördelning av slutkapital (dagens penningvärde)</div>
          <div class="card-body">
            <D3Chart :render-chart="renderFinal" :data="chartData" />
            <p class="form-text mb-0">
              Y-axeln är sannolikhet per tiopotens kapital: ytan under kurvan över en tiopotens är
              chansen att hamna där. Markeringen visar toppen, det mest sannolika utfallet. Massan
              som hamnat i ruin ritas inte ut.
            </p>
          </div>
        </div>
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
