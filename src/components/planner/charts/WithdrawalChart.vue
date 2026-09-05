<script setup lang="ts">
import { computed } from 'vue'
import * as d3 from 'd3'

import D3Chart from '../../D3Chart.vue'
import { formatKr } from '../../../planner/format'
import type { CashflowYear, PropagationRun } from '../../../planner/types'
import { axes, ADAPTIVE_COLOR, EXTRA_COLOR, NEED_COLOR } from './shared'

const props = defineProps<{
  /** Only the dynamic run is drawn: a fixed schedule pays its amount or has failed. */
  adaptive: PropagationRun
  cashflow: CashflowYear[]
}>()

const chartData = computed(() => ({ adaptive: props.adaptive, cashflow: props.cashflow }))

/**
 * What the adaptive run actually pays out, year by year, against the schedule
 * that was asked for.
 *
 * Only the adaptive run is drawn as a band: a fixed schedule pays its amount or
 * has failed, so its spread carries nothing the survival chart does not already
 * say. The two planned amounts are drawn as the envelope instead, which is what
 * the band has to be read against — the distance to the upper line is extra
 * that was declined, and the distance below the lower one is a failed plan.
 */
const renderWithdrawals = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  const series = props.adaptive.withdrawals
  if (series.length === 0) return

  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    right: 16,
    bottom: 36,
    left: 84,
  })

  const planned = series.map((entry) => {
    const year = props.cashflow[entry.index]
    const need = year?.need ?? 0
    return { age: entry.age, need, total: need + Math.max(0, year?.extra ?? 0) }
  })

  // A year's amount covers the year, so the axis runs to the end of the last
  // one. Without the extra unit the final step would have no width to stand on.
  const x = d3
    .scaleLinear()
    .domain([series[0]!.age, series[series.length - 1]!.age + 1])
    .range([0, innerWidth])

  const highest = Math.max(
    d3.max(series, (o) => o.percentile90) ?? 0,
    d3.max(planned, (p) => p.total) ?? 0,
  )
  // Zero is always on the scale: it is what a failed year pays, and the lower
  // band reaching it is the whole point of looking at this chart.
  const lowest = Math.min(0, d3.min(series, (o) => o.percentile10) ?? 0)
  const y = d3
    .scaleLinear()
    .domain([lowest, highest === lowest ? lowest + 1 : highest])
    .nice()
    .range([innerHeight, 0])

  plot
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format('d')))
  plot.append('g').call(
    d3
      .axisLeft(y)
      .ticks(6)
      .tickFormat((value) => formatKr(Number(value))),
  )

  // Step curves, not smooth ones: the amount is constant through a year and
  // changes at its boundary, so an interpolated slope would draw payments that
  // were never scheduled.
  const band = d3
    .area<(typeof series)[number]>()
    .x((o) => x(o.age))
    .y0((o) => y(o.percentile10))
    .y1((o) => y(o.percentile90))
    .curve(d3.curveStepAfter)

  plot
    .append('path')
    .datum(series)
    .attr('d', band)
    .attr('fill', ADAPTIVE_COLOR)
    .attr('fill-opacity', 0.15)

  const stroke = <T,>(
    data: T[],
    value: (entry: T) => number,
    age: (entry: T) => number,
    width: number,
  ) => {
    const line = d3
      .line<T>()
      .x((entry) => x(age(entry)))
      .y((entry) => y(value(entry)))
      .curve(d3.curveStepAfter)
    return plot
      .append('path')
      .datum(data)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke-width', width)
  }

  stroke(
    series,
    (o) => o.median,
    (o) => o.age,
    2,
  ).attr('stroke', ADAPTIVE_COLOR)

  // The planned envelope goes on top, and thinner. A plan that can afford its
  // extra has a median sitting exactly on the upper line for decades, and drawn
  // underneath it would be a legend entry with nothing on the chart to find.
  stroke(
    planned,
    (p) => p.total,
    (p) => p.age,
    1.5,
  )
    .attr('stroke', EXTRA_COLOR)
    .attr('stroke-dasharray', '6 4')
  stroke(
    planned,
    (p) => p.need,
    (p) => p.age,
    1.5,
  )
    .attr('stroke', NEED_COLOR)
    .attr('stroke-dasharray', '6 4')
}
</script>

<template>
  <div class="card mb-3">
    <div class="card-header">Uttag per år (dagens penningvärde)</div>
    <div class="card-body">
      <D3Chart :render-chart="renderWithdrawals" :data="chartData" />
      <!-- Minimum, Dynamisk, Maximum — the order `runs` puts them in, so every
           legend on the page reads the same way even though this one names
           planned lines rather than runs and cannot be driven from `runs`
           directly. -->
      <div class="d-flex flex-wrap gap-3 small text-muted mt-2">
        <span>
          <span class="line dashed" :style="{ '--line-color': NEED_COLOR }"></span>
          Planerat minimum
        </span>
        <span>
          <span class="line" :style="{ '--line-color': ADAPTIVE_COLOR }"></span>
          Dynamisk: median, med 10–90-percentilen som band
        </span>
        <span>
          <span class="line dashed" :style="{ '--line-color': EXTRA_COLOR }"></span>
          Planerat maximum
        </span>
      </div>
      <p class="form-text mt-3 mb-0">
        Vad den dynamiska regeln faktiskt betalar ut, mot vad planen bett om. Avståndet upp till den
        streckade linjen är extra som avstods för att överskottet inte räckte; avståndet ned under
        behovslinjen är år planen inte nådde fram till. Percentilerna är ovillkorade — ett år i en
        plan som redan spruckit räknas som noll kronor, inte som bortfall — så det undre bandet når
        noll när risken att planen spruckit passerat 10&nbsp;%. Beloppen är reala.
      </p>
    </div>
  </div>
</template>
