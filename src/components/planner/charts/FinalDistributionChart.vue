<script setup lang="ts">
import { computed } from 'vue'
import * as d3 from 'd3'

import D3Chart from '../../D3Chart.vue'
import { formatKr } from '../../../planner/format'
import { densityAt, densityBins } from '../../../planner/density'
import { axes, spreadLabels, NBSP, type RunSeries } from './shared'

const props = defineProps<{
  runs: RunSeries[]
  bequestTarget: number
}>()

const chartData = computed(() => ({ runs: props.runs, bequestTarget: props.bequestTarget }))

const renderFinal = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    // Wide enough for the peak labels in the right margin.
    right: 66,
    bottom: 36,
    left: 60,
  })

  const series = props.runs.map(({ distribution, outcomes, color, dashed }) => ({
    color,
    dashed,
    bins: densityBins(distribution, 160),
    // The same median the Slutkapital table prints, on the same net-of-tax
    // basis, so the chart's marker and the table's row cannot disagree.
    median: outcomes[outcomes.length - 1]!.median,
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

  // The target, marked the same way the fan chart marks it. The adaptive run
  // leaves a point mass here — a whole band of balances is spent down to
  // exactly this number — so the spike beside this line is the thing the note
  // under the chart describes, and the line is what saves the note from having
  // to name an amount. Drawn only when it is on the scale.
  const [lowerValue, upperValue] = x.domain()
  if (props.bequestTarget >= lowerValue! && props.bequestTarget <= upperValue!) {
    const at = x(props.bequestTarget)
    plot
      .append('line')
      .attr('x1', at)
      .attr('x2', at)
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#6c757d')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 4')
    plot
      .append('text')
      .attr('x', at + 4)
      .attr('y', 10)
      .attr('font-size', 11)
      .style('fill', '#6c757d')
      .text('Arvsmål')
  }

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

    // The median, not the tallest bin.
    //
    // A mode is only a summary while the density is smooth, and this one is
    // not: the dynamic run leaves a point mass exactly on the bequest target,
    // because its final year pays `need + clamp(w − need − target, 0, extra)`
    // and maps a whole band of balances onto the target. That atom is the
    // tallest thing on the chart whenever a target is set, so marking the peak
    // labelled the target itself — a property of the rule rather than of the
    // outcome — and did so however unlikely the plan was to land there.
    //
    // Off the scale below when the plan is ruined or depleted more than half
    // the time: the median is then zero, which a log axis has no room for. No
    // marker is the honest answer, and the survival curve already says why.
    const density = densityAt(s.bins, s.median)
    if (density === null) continue

    plot
      .append('circle')
      .attr('cx', x(s.median))
      .attr('cy', y(density))
      .attr('r', 3)
      .attr('fill', s.color)

    labels.push({ y: y(density), text: formatKr(s.median), color: s.color })
  }

  spreadLabels(labels)

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
  <div class="card h-100">
    <div class="card-header">Fördelning av slutkapital (dagens penningvärde)</div>
    <div class="card-body">
      <D3Chart :render-chart="renderFinal" :data="chartData" />
      <p class="form-text mt-3 mb-0">
        Markeringen visar medianen, samma tal som i tabellen ovan. Massan som hamnat i ruin ritas
        inte ut, och saknas markeringen är medianen noll.
      </p>
      <p v-if="bequestTarget > 0" class="form-text mt-2 mb-0">
        Den dynamiska körningen har en topp vid arvsmålet: har avkastningen varit svag sänks
        extrauttaget precis så mycket att målet ändå nås, så ett helt band av utfall hamnar på exakt
        den summan. Har det gått ännu sämre missas målet och utfallet hamnar under.
      </p>
    </div>
  </div>
</template>
