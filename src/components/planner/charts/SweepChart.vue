<script setup lang="ts">
import { computed } from 'vue'
import * as d3 from 'd3'

import D3Chart from '../../D3Chart.vue'
import { formatPercent } from '../../../planner/format'
import ChartLegend from './ChartLegend.vue'
import { keepProbability, type SweepCrossing, type SweepPoint } from '../../../planner/sweep'
import { axes, ADAPTIVE_COLOR, EXTRA_COLOR, MARKER_COLOR, NBSP, type LegendEntry } from './shared'

const props = defineProps<{
  points: SweepPoint[]
  /** Full swept range, so the axis does not grow as the curve fills in. */
  max: number
  /** Survival levels to rule off, whether or not the curve reaches them. */
  targets: readonly number[]
  /** Where the curve meets those targets; a target it never reaches has none. */
  crossings: SweepCrossing[]
  /** The plan's own extra, when it is a constant rate; otherwise no marker. */
  planRate: number | null
  /**
   * What the second curve is measuring — the bequest target, or the starting
   * capital when the plan sets none. Named by the caller because the threshold
   * is the household's to choose and the label has to say which one it got.
   */
  keepLabel: string
}>()

const chartData = computed(() => ({
  // Length rather than the array itself: the points are appended one at a time
  // and only ever grow, so the count is enough to tell D3Chart something moved.
  count: props.points.length,
  max: props.max,
  targets: props.targets,
  crossings: props.crossings,
  planRate: props.planRate,
  keepLabel: props.keepLabel,
}))

const legendEntries = computed<LegendEntry[]>(() => [
  { label: 'Planen håller', color: ADAPTIVE_COLOR },
  { label: props.keepLabel, color: EXTRA_COLOR },
])

const renderSweep = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    // Room for the target labels, which sit outside the plot so they do not
    // land on the curve.
    right: 40,
    // Two rows at the bottom: the ticks and the axis title under them.
    bottom: 52,
    left: 52,
  })

  const x = d3.scaleLinear().domain([0, props.max]).range([0, innerWidth])
  // The full probability scale, for the same reason the survival-over-time
  // chart uses it: on a plan that mostly holds, the whole curve lives in the
  // top fifth, and zooming in on that would turn a few points of difference
  // into a cliff.
  const y = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0])

  plot
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    // Through the shared formatter, so a half-point tick reads as 0,5 % with
    // the locale's comma rather than as a bare `.1f`.
    .call(
      d3
        .axisBottom(x)
        .ticks(8)
        .tickFormat((value) => formatPercent(Number(value) * 100)),
    )
  plot.append('g').call(
    d3
      .axisLeft(y)
      .ticks(5)
      .tickFormat((value) => `${Math.round(Number(value) * 100)}${NBSP}%`),
  )

  // Both axes are percentages of quite different things, so both are named.
  plot
    .append('text')
    .attr('x', innerWidth / 2)
    .attr('y', innerHeight + 44)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .text('Extrauttag per år, andel av startkapitalet')

  // The targets the table beside the chart reports a rate for, so the two can
  // be read against each other. Ruled off whether or not the curve reaches
  // them: a target the plan misses outright is a fact about the plan, and a
  // missing line would look like a chart that had forgotten it.
  for (const target of props.targets) {
    const at = y(target)
    plot
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', at)
      .attr('y2', at)
      .attr('stroke', MARKER_COLOR)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 4')
    plot
      .append('text')
      .attr('x', innerWidth + 4)
      .attr('y', at)
      .attr('dy', '0.32em')
      .attr('font-size', 11)
      .style('fill', MARKER_COLOR)
      .text(formatPercent(target * 100))
  }

  // The crossings themselves, where there are any. A target the curve never
  // fell below has its rate reported as a bound instead, and a dot at the edge
  // of the chart would read as a crossing that happens to be just off the end.
  for (const crossing of props.crossings) {
    if (crossing.atLeast) continue
    plot
      .append('circle')
      .attr('cx', x(crossing.rate))
      .attr('cy', y(crossing.target))
      .attr('r', 3)
      .attr('fill', MARKER_COLOR)
  }

  // Where the plan itself sits on the curve. Drawn only when the entered extra
  // really is a constant rate, and only while it is on the scale.
  if (props.planRate !== null && props.planRate >= 0 && props.planRate <= props.max) {
    const at = x(props.planRate)
    plot
      .append('line')
      .attr('x1', at)
      .attr('x2', at)
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', MARKER_COLOR)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 4')
    plot
      .append('text')
      .attr('x', at + 4)
      .attr('y', 10)
      .attr('font-size', 11)
      .style('fill', MARKER_COLOR)
      .text('Planen')
  }

  if (props.points.length === 0) return

  const draw = (pick: (point: SweepPoint) => number | undefined, color: string) => {
    const drawable = props.points.filter((point) => pick(point) !== undefined)
    if (drawable.length === 0) return
    const line = d3
      .line<SweepPoint>()
      .x((point) => x(point.rate))
      .y((point) => y(pick(point)!))
    plot
      .append('path')
      .datum(drawable)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)

    // A single point is not a line, and a sweep in progress is a single point
    // for its first tick. The dot also marks the left end, which is the need
    // alone and the one value on the chart that is not a trade-off.
    const start = drawable[0]!
    plot
      .append('circle')
      .attr('cx', x(start.rate))
      .attr('cy', y(pick(start)!))
      .attr('r', 3)
      .attr('fill', color)
  }

  // Survival takes the dynamic run's colour: this is that run, swept.
  draw((point) => point.survival, ADAPTIVE_COLOR)
  // And the threshold curve the extra's colour, because the extra is what pays
  // for it. Under the adaptive rule this is the curve that actually moves —
  // survival is held flat by the rule, and what the spending costs lands here.
  draw(keepProbability, EXTRA_COLOR)
}
</script>

<template>
  <div>
    <D3Chart :render-chart="renderSweep" :data="chartData" />
    <ChartLegend :entries="legendEntries" />
  </div>
</template>
