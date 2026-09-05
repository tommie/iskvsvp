<script setup lang="ts">
import { computed } from 'vue'
import * as d3 from 'd3'

import D3Chart from '../../D3Chart.vue'
import { formatKr } from '../../../planner/format'
import { axes, type RunSeries } from './shared'

const props = defineProps<{
  runs: RunSeries[]
  /** The target the dynamic run holds back for; 0 when the plan sets none. */
  bequestTarget: number
}>()

/** Owned by the page, because the axis basis is a property of the whole view. */
const logScale = defineModel<boolean>('logScale', { required: true })

/** Anything the renderer reads, so D3Chart redraws when it moves. */
const chartData = computed(() => ({
  runs: props.runs,
  bequestTarget: props.bequestTarget,
  logScale: logScale.value,
}))

const renderFan = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    right: 16,
    bottom: 36,
    left: 84,
  })

  const outcomes = props.runs[0]!.outcomes
  const x = d3
    .scaleLinear()
    .domain([outcomes[0]!.age, outcomes[outcomes.length - 1]!.age])
    .range([0, innerWidth])

  const upper = d3.max(props.runs, (entry) => d3.max(entry.outcomes, (o) => o.percentile90)) ?? 1

  // A log axis cannot show ruin, which sits at exactly zero. The bottom is set
  // to a small fraction of the top of the range so a collapsing plan still
  // reads as "falls off the chart" rather than being clipped invisibly.
  const lowerBound = Math.max(1, upper * 1e-4)
  const y = logScale.value
    ? d3.scaleLog().domain([lowerBound, upper]).range([innerHeight, 0]).clamp(true)
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
        .range(Math.ceil(Math.log10(lowerBound)), Math.floor(Math.log10(upper)) + 1)
        .map((exponent) => Math.pow(10, exponent)),
    )
  } else {
    leftAxis.ticks(6)
  }
  plot.append('g').call(leftAxis)

  // The target the adaptive run holds back for, so the fan can be read against
  // it: where the band sits at the horizon *is* the answer to whether it holds.
  // Drawn only when it is on the scale — a target above the 90th percentile
  // would otherwise pin itself to the top of the chart and misreport itself.
  if (props.bequestTarget > 0 && props.bequestTarget <= upper) {
    const at = y(Math.max(lowerBound, props.bequestTarget))
    plot
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', at)
      .attr('y2', at)
      .attr('stroke', '#6c757d')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 4')
    plot
      .append('text')
      .attr('x', 4)
      .attr('y', at - 4)
      .attr('font-size', 11)
      .style('fill', '#6c757d')
      .text('Arvsmål')
  }

  for (const { outcomes: series, color, dashed } of props.runs) {
    const band = d3
      .area<(typeof series)[number]>()
      .x((o) => x(o.age))
      .y0((o) => y(Math.max(lowerBound, o.percentile10)))
      .y1((o) => y(Math.max(lowerBound, o.percentile90)))

    plot.append('path').datum(series).attr('d', band).attr('fill', color).attr('fill-opacity', 0.15)

    const line = d3
      .line<(typeof series)[number]>()
      .x((o) => x(o.age))
      .y((o) => y(Math.max(lowerBound, o.median)))

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
</script>

<template>
  <div class="card h-100">
    <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-3">
      <span>Kapital över tid i dagens penningvärde</span>
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
      <D3Chart :render-chart="renderFan" :data="chartData" />
      <!-- Named, coloured and dashed from the runs themselves, so a curve here
           and a column in the table beside it can never end up with different
           names for the same run. -->
      <div class="run-legend d-flex flex-wrap gap-3 small text-muted mt-2">
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
</template>
