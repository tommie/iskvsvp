<script setup lang="ts">
import { computed } from 'vue'
import * as d3 from 'd3'

import D3Chart from '../../D3Chart.vue'
import ChartLegend from './ChartLegend.vue'
import { formatKr, formatPercent } from '../../../planner/format'
import type { LevelMark, SweepPoint } from '../../../planner/sweep'
import { axes, ADAPTIVE_COLOR, MARK_COLOR, MARKER_COLOR, type LegendEntry } from './shared'

/**
 * What each swept rate asks for against what it actually hands over, **per
 * year**.
 *
 * The companion to the survival curve, and not optional beside it: a rate is
 * not income under either rule. The adaptive rule treats it as a ceiling and
 * declines whatever the surplus will not carry, so its planned line runs away
 * from its expected one as the rate rises; the fixed rule pays it in full until
 * the plan fails and then pays nothing, so its expected line bends over — and
 * eventually turns down — as ruin eats the later years. Reading survival
 * without this is reading the price without the goods.
 *
 * Annual rather than a total over the plan, because a rule of thumb about
 * withdrawal rates is stated per year and a forty-year total cannot be read
 * against one. The second axis restates the same scale as a share of the
 * starting capital, which is the unit SAFEMAX and "the 4% rule" are quoted in —
 * a pure unit conversion of one series, not a second quantity smuggled onto the
 * chart.
 */
const props = defineProps<{
  points: SweepPoint[]
  /** Full swept range, so the axis does not grow as the curves fill in. */
  max: number
  /** The plan's own extra, when it is a constant rate; otherwise no marker. */
  planRate: number | null
  /**
   * The points the vertical scale is sized from.
   *
   * The last finished sweep, where there is one, rather than the points being
   * drawn. A curve that grows a rung at a time would otherwise drag the axis up
   * with it — and every annotation placed by value would move under the reader
   * while it did, so a mark from the finished sweep could not stay on screen
   * during the next one without pointing somewhere false.
   */
  scalePoints: SweepPoint[]
  /** Starting capital, for the withdrawal-rate axis on the right. */
  capital: number
  /**
   * The rung that delivers the most, or `null` for none.
   *
   * The point itself, not just its level, so the mark can be placed without
   * looking it up among the points being drawn — which is what lets it belong
   * to the finished sweep, like every other conclusion on the card, instead of
   * blinking out the moment the next one starts.
   */
  peak: SweepPoint | null
  /**
   * Levels at which one of the probability curves passes its thresholds, so
   * what the plan delivers can be read off against the risk it carries. One
   * family only; the card decides which and names it.
   */
  marks: LevelMark[]
  /**
   * The legend's whole phrase for those marks, supplied by the card.
   *
   * A finished sentence rather than a name to glue onto a stem here: the
   * families read as different clauses — the plan holding, a target being
   * reached, capital being kept — and "Nivå där: Arvsmålet nås" is not Swedish
   * anybody would write.
   */
  marksLabel: string
}>()

const chartData = computed(() => ({
  count: props.points.length,
  max: props.max,
  planRate: props.planRate,
  capital: props.capital,
  peak: props.peak,
  marks: props.marks,
  // The scale is sized from the settled sweep, so a redraw is due when that
  // changes even though the points being drawn have not.
  scale: props.scalePoints.length,
}))

/** The two series' mid-lines, per year; the shaded ranges come off the points. */
const planned = (point: SweepPoint) => (point.years > 0 ? point.plannedWithdrawn / point.years : 0)
const expected = (point: SweepPoint) =>
  point.years > 0 ? point.expectedWithdrawn / point.years : 0

/**
 * Both series read the same way — a shaded range with its mid-line — so the
 * planned pair comes first and the delivered pair second, each in the order the
 * chart stacks them.
 *
 * The threshold marks carry the percentages themselves, so what the legend has
 * to supply for them is which probability those percentages are of.
 */
const legendEntries = computed<LegendEntry[]>(() => [
  { label: 'Planerat, snitt per år', color: MARKER_COLOR, kind: 'dashed' },
  { label: 'Planerat, lägsta–högsta år', color: MARKER_COLOR, kind: 'band' },
  { label: 'Förväntat, snitt per år', color: ADAPTIVE_COLOR },
  { label: 'Förväntat, lägsta–högsta år', color: ADAPTIVE_COLOR, kind: 'band' },
  ...(props.peak !== null
    ? [{ label: 'Nivån som ger mest', color: ADAPTIVE_COLOR, kind: 'dot' as const }]
    : []),
  ...(props.marks.length > 0
    ? [{ label: props.marksLabel, color: MARK_COLOR, kind: 'dotted' as const }]
    : []),
])

const renderWithdrawn = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  const { plot, innerWidth, innerHeight } = axes(svgEl, container, {
    top: 12,
    // The withdrawal-rate axis lives out here, so it needs room of its own.
    right: 52,
    bottom: 52,
    left: 62,
  })

  const x = d3.scaleLinear().domain([0, props.max]).range([0, innerWidth])
  // Sized to the planned amount, which is the largest of the series by
  // construction: the gap under it is the quantity the chart exists to show, so
  // it must not be scaled away. The floor goes below zero only if a deposit
  // year drags the envelope there.
  const top = d3.max(props.scalePoints, (point) => point.plannedMax) ?? 1
  const bottom = Math.min(0, d3.min(props.scalePoints, (point) => point.minWithdrawal) ?? 0)
  const y = d3
    .scaleLinear()
    .domain([bottom, top || 1])
    .nice()
    .range([innerHeight, 0])

  plot
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
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
      .tickFormat((value) => formatKr(Number(value))),
  )

  // The same scale as a share of the starting capital — the unit every
  // withdrawal rule of thumb is quoted in, so "is this plan near 4%?" can be
  // read straight off the chart rather than divided out by hand.
  //
  // Ticked on round *rates* rather than wherever the kronor axis put its own:
  // an axis whose job is to be compared against "4%" has to have a 4% mark on
  // it, and letting d3 subdivide the kronor domain gives 2,2 % and 8,9 %.
  if (props.capital > 0) {
    const [low, high] = y.domain() as [number, number]
    plot
      .append('g')
      .attr('transform', `translate(${innerWidth},0)`)
      .call(
        d3
          .axisRight(y)
          .tickValues(
            d3
              .ticks(low / props.capital, high / props.capital, 5)
              .map((rate) => rate * props.capital),
          )
          .tickFormat((value) => formatPercent((Number(value) / props.capital) * 100)),
      )
  }

  plot
    .append('text')
    .attr('x', innerWidth / 2)
    .attr('y', innerHeight + 44)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .text('Extrauttag per år, andel av startkapitalet')

  // Named, because the two axes are percentages of different things and the
  // x-axis already claims one of the readings. Without this the right-hand
  // scale reads as a second series rather than as the left one restated.
  if (props.capital > 0) {
    plot
      .append('text')
      .attr('transform', `translate(${innerWidth + 46},${innerHeight / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .text('Andel av startkapitalet')
  }

  // The levels at which the left chart's curve passes its thresholds, ruled off
  // here so what the plan delivers can be read against the risk it carries at
  // the same level.
  //
  // Given the palette's gold rather than the neutral grey, and drawn at full
  // strength: these are an answer the model worked out, not furniture the
  // reader supplied, and there are at most three of them. Dotted keeps them
  // apart from the plan's own dashed marker and the peak's.
  for (const mark of props.marks) {
    if (mark.rate < 0 || mark.rate > props.max) continue
    const at = x(mark.rate)
    plot
      .append('line')
      .attr('x1', at)
      .attr('x2', at)
      .attr('y1', 14)
      .attr('y2', innerHeight)
      .attr('stroke', MARK_COLOR)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3')
    plot
      .append('text')
      .attr('x', at)
      .attr('y', 10)
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('font-weight', 600)
      .style('fill', MARK_COLOR)
      .text(formatPercent(mark.target * 100))
  }

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
  }

  if (props.points.length === 0) return

  // The spread across the plan's own years, behind the average that summarises
  // it. An annual mean over forty years hides the shape entirely: under a fixed
  // schedule the first year pays in full and the last pays the survivors only,
  // and under the adaptive rule the payout climbs as a surplus accumulates.
  // Min and max rather than first and last, because only the fixed rule is
  // monotone — for the adaptive one the ends are not the extremes.
  // Both series are drawn the same way — a shaded range with a line through the
  // middle — so the comparison is like for like: what the plan asked for in its
  // leanest and richest year, against what it delivers in each.
  //
  // The planned range is shaded rather than outlined because its two edges
  // coincide whenever the need is the same every year, which is most plans; two
  // lines drawn on top of each other invite the question of why there are two.
  // A fill collapses to a hairline instead, and a shaped need opens it out.
  const shade = (
    low: (point: SweepPoint) => number,
    high: (point: SweepPoint) => number,
    color: string,
    opacity: number,
  ) => {
    const band = d3
      .area<SweepPoint>()
      .x((point) => x(point.rate))
      .y0((point) => y(low(point)))
      .y1((point) => y(high(point)))
    plot
      .append('path')
      .datum(props.points)
      .attr('d', band)
      .attr('fill', color)
      .attr('opacity', opacity)
  }

  const draw = (pick: (point: SweepPoint) => number, color: string, dashed: boolean) => {
    const line = d3
      .line<SweepPoint>()
      .x((point) => x(point.rate))
      .y((point) => y(pick(point)))
    plot
      .append('path')
      .datum(props.points)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', dashed ? '6 4' : null)
  }

  // Neutral for the plan and the run's own colour for what it delivers. The
  // planned side is a reference the other is read against rather than an
  // outcome, and the palette's purple already means the Maximum run on the
  // outcome charts and the kept-capital curve on the chart beside this one —
  // a third meaning here would be one too many.
  //
  // The delivered range nests inside the planned one by construction, so the
  // planned shading is the lighter of the two: where they overlap the fills
  // add, and an equal pair would leave the nested band barely distinguishable.
  shade(
    (point) => point.plannedMin,
    (point) => point.plannedMax,
    MARKER_COLOR,
    0.12,
  )
  shade(
    (point) => point.minWithdrawal,
    (point) => point.maxWithdrawal,
    ADAPTIVE_COLOR,
    0.18,
  )
  draw(planned, MARKER_COLOR, true)
  draw(expected, ADAPTIVE_COLOR, false)

  // The level that delivers the most. A real turning point, not a threshold:
  // past it the plan hands over less than it would have at a lower level,
  // because the extra spending costs more years than it buys. Absent under the
  // adaptive rule, whose curve is still climbing at the end of the range — that
  // rule declines rather than overspends, so there is no level to stay under.
  if (props.peak) {
    const at = x(props.peak.rate)
    const height = y(expected(props.peak))
    plot
      .append('line')
      .attr('x1', at)
      .attr('x2', at)
      .attr('y1', height)
      .attr('y2', innerHeight)
      .attr('stroke', ADAPTIVE_COLOR)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 3')
    plot
      .append('circle')
      .attr('cx', at)
      .attr('cy', height)
      .attr('r', 3.5)
      .attr('fill', ADAPTIVE_COLOR)
    plot
      .append('text')
      .attr('x', at + 5)
      .attr('y', height - 7)
      .attr('font-size', 11)
      .attr('font-weight', 600)
      .style('fill', ADAPTIVE_COLOR)
      .text(formatPercent(props.peak.rate * 100))
  }
}
</script>

<template>
  <div>
    <D3Chart :render-chart="renderWithdrawn" :data="chartData" />
    <ChartLegend :entries="legendEntries" />
  </div>
</template>
