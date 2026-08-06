<script setup lang="ts">
import { computed, ref } from 'vue'
import * as d3 from 'd3'
import { storeToRefs } from 'pinia'

import { usePlannerStore } from '../../stores/planner'
import type { PropagationRun } from '../../planner/types'
import { densityBins } from '../../planner/density'
import D3Chart from '../D3Chart.vue'

const store = usePlannerStore()
const { results, cashflow } = storeToRefs(store)

const FLOOR_COLOR = '#0d6efd'
const OPTIONAL_COLOR = '#fd7e14'
const CHART_HEIGHT = 320

const logScale = ref(true)

const kronor = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 })
const percent = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1 })

function formatKr(value: number): string {
  if (!Number.isFinite(value)) return '–'
  if (value >= 1e6)
    return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(value / 1e6)} mkr`
  return `${kronor.format(value)} kr`
}

const runs = computed(() => {
  if (!results.value) return []
  return [
    { run: results.value.floorRun, color: FLOOR_COLOR, dashed: false },
    { run: results.value.optionalRun, color: OPTIONAL_COLOR, dashed: true },
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
  const build = (run: PropagationRun, includeOptional: boolean) => {
    const final = run.outcomes[run.outcomes.length - 1]!
    return {
      label: run.label,
      survival: (1 - final.ruinProbability) * 100,
      median: final.median,
      percentile10: final.percentile10,
      percentile90: final.percentile90,
      mean: final.mean,
      withdrawn: totalWithdrawn(includeOptional),
      clipped: run.clippedMass,
    }
  }
  return [build(results.value.floorRun, false), build(results.value.optionalRun, true)]
})

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

const fanData = computed(() => ({ results: results.value, logScale: logScale.value }))

const renderFan = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value) return
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    right: 16,
    bottom: 36,
    left: 84,
  })

  const outcomes = results.value.floorRun.outcomes
  const x = d3
    .scaleLinear()
    .domain([0, outcomes[outcomes.length - 1]!.age])
    .range([0, innerWidth])
  x.domain([outcomes[0]!.age, outcomes[outcomes.length - 1]!.age])

  const upper = d3.max(runs.value, ({ run }) => d3.max(run.outcomes, (o) => o.percentile90)) ?? 1

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

  for (const { run, color, dashed } of runs.value) {
    const band = d3
      .area<(typeof run.outcomes)[number]>()
      .x((o) => x(o.age))
      .y0((o) => y(Math.max(floor, o.percentile10)))
      .y1((o) => y(Math.max(floor, o.percentile90)))

    plot
      .append('path')
      .datum(run.outcomes)
      .attr('d', band)
      .attr('fill', color)
      .attr('fill-opacity', 0.15)

    const line = d3
      .line<(typeof run.outcomes)[number]>()
      .x((o) => x(o.age))
      .y((o) => y(Math.max(floor, o.median)))

    plot
      .append('path')
      .datum(run.outcomes)
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
  plot.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')))

  const survival = (outcome: { ruinProbability: number }) => 1 - outcome.ruinProbability
  const endLabels: { y: number; text: string; color: string }[] = []

  for (const { run, color, dashed } of runs.value) {
    const line = d3
      .line<(typeof run.outcomes)[number]>()
      .x((o) => x(o.age))
      .y((o) => y(survival(o)))
    plot
      .append('path')
      .datum(run.outcomes)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', dashed ? '6 4' : null)

    const final = survival(run.outcomes[run.outcomes.length - 1]!)
    endLabels.push({ y: y(final), text: `${percent.format(final * 100)} %`, color })
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

  const series = runs.value.map(({ run, color, dashed }) => ({
    color,
    dashed,
    bins: densityBins(run.finalDistribution, 160),
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
  plot.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')))

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
    <div class="card mb-3">
      <div class="card-header">Slutkapital</div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="table table-sm align-middle mb-0">
            <thead>
              <tr>
                <th></th>
                <th v-for="row in summary" :key="row.label" class="text-end">{{ row.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Sannolikhet att planen håller</th>
                <td v-for="row in summary" :key="row.label" class="text-end">
                  {{ percent.format(row.survival) }} %
                </td>
              </tr>
              <tr>
                <th>Median slutkapital</th>
                <td v-for="row in summary" :key="row.label" class="text-end">
                  {{ formatKr(row.median) }}
                </td>
              </tr>
              <tr>
                <th>10:e percentilen</th>
                <td v-for="row in summary" :key="row.label" class="text-end">
                  {{ formatKr(row.percentile10) }}
                </td>
              </tr>
              <tr>
                <th>90:e percentilen</th>
                <td v-for="row in summary" :key="row.label" class="text-end">
                  {{ formatKr(row.percentile90) }}
                </td>
              </tr>
              <tr>
                <th>Totalt uttaget (realt)</th>
                <td v-for="row in summary" :key="row.label" class="text-end">
                  {{ formatKr(row.withdrawn) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="form-text mb-0">
          Percentilerna är ovillkorade: en plan som spricker räknas som noll kronor, inte som
          bortfall. Därför kan 10:e percentilen vara noll när risken att planen spricker överstiger
          10 %.
        </p>
      </div>
    </div>

    <div v-if="gridWarning" class="alert alert-warning">
      {{ percent.format(gridWarning * 100) }} % av sannolikhetsmassan nådde toppen av rutnätet. De
      övre percentilerna är underskattade — öka horisontens rutnät eller sänk avkastningen.
    </div>

    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span>Realt kapital över tid (median och 10–90 %)</span>
        <div class="form-check form-switch mb-0">
          <input
            id="planner-log-scale"
            v-model="logScale"
            class="form-check-input"
            type="checkbox"
            role="switch"
          />
          <label class="form-check-label small" for="planner-log-scale">Logaritmisk skala</label>
        </div>
      </div>
      <div class="card-body">
        <D3Chart :render-chart="renderFan" :data="fanData" />
        <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
          <span><span class="line" :style="{ background: FLOOR_COLOR }"></span> Golv</span>
          <span
            ><span class="line dashed" :style="{ background: OPTIONAL_COLOR }"></span> Golv +
            tillval</span
          >
        </div>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-12 col-lg-6">
        <div class="card h-100">
          <div class="card-header">Sannolikhet att planen håller</div>
          <div class="card-body">
            <D3Chart :render-chart="renderSurvival" :data="fanData" />
            <p class="form-text mb-0">
              Sannolikheten att portföljen fortfarande klarar hela golvuttaget. Tillståndet är
              absorberande — en senare insättning räddar inte en plan som redan spruckit.
            </p>
          </div>
        </div>
      </div>
      <div class="col-12 col-lg-6">
        <div class="card h-100">
          <div class="card-header">Fördelning av slutkapital</div>
          <div class="card-body">
            <D3Chart :render-chart="renderFinal" :data="fanData" />
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
.line {
  display: inline-block;
  width: 1.5rem;
  height: 3px;
  vertical-align: 3px;
  margin-right: 0.25rem;
}

.line.dashed {
  background-image: linear-gradient(90deg, currentColor 60%, transparent 0);
}
</style>
