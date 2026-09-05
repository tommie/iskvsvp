<script setup lang="ts">
import { computed } from 'vue'
import * as d3 from 'd3'

import D3Chart from '../../D3Chart.vue'
import { formatPercent } from '../../../planner/format'
import { axes, spreadLabels, NBSP, type RunSeries } from './shared'

const props = defineProps<{ runs: RunSeries[] }>()

const chartData = computed(() => ({ runs: props.runs }))

const renderSurvival = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  // The wider right margin holds the end-of-horizon labels.
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    right: 58,
    bottom: 36,
    left: 60,
  })

  const outcomes = props.runs[0]!.outcomes
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

  for (const { outcomes: series, color, dashed } of props.runs) {
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

  spreadLabels(endLabels)

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
</script>

<template>
  <div class="card h-100">
    <div class="card-header">Sannolikhet att planen håller</div>
    <div class="card-body">
      <D3Chart :render-chart="renderSurvival" :data="chartData" />
      <p class="form-text mt-3 mb-0">
        Sannolikheten att portföljen fortfarande klarar hela behovsuttaget. Tillståndet är
        absorberande — en senare insättning räddar inte en plan som redan spruckit.
      </p>
    </div>
  </div>
</template>
