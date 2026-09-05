import * as d3 from 'd3'

import type { PropagationRun, WealthDistribution, YearOutcome } from '../../../planner/types'

/**
 * One run as the charts draw it: the run itself, how it is drawn, and the
 * series resolved against the net-of-tax toggle.
 *
 * Resolved once by `PlannerOutcome` and passed down rather than resolved per
 * chart, because the toggle lives in the Slutkapital table's header and the fan
 * chart follows it — the two must not disagree about which basis they are on.
 */
export interface RunSeries {
  run: PropagationRun
  color: string
  dashed: boolean
  outcomes: YearOutcome[]
  distribution: WealthDistribution
}

/**
 * The three runs' colours, and the dash that separates a bound from an outcome.
 *
 * Minimum and Maximum are dashed and Dynamisk solid, so the stroke says what
 * kind of line it is while colour tells the three apart. Shared here because
 * four charts, a legend and a table all have to agree on them.
 */
export const NEED_COLOR = '#0d6efd'
export const EXTRA_COLOR = '#6f42c1'
export const ADAPTIVE_COLOR = '#fd7e14'

export const CHART_HEIGHT = 320

/**
 * Svenska skrivregler puts a space before the percent sign, and a non-breaking
 * one so the number and its unit never split across a line. This matches what
 * Intl's own sv-SE percent style emits.
 */
export const NBSP = ' '

/**
 * Nudges labels apart, in place, so two series that land on the same height do
 * not print on top of each other.
 *
 * Sorted first, then each one pushed below its predecessor if it is inside a
 * line height. Only ever moves labels *down*, which keeps the topmost one on
 * the value it actually marks — the reader is more likely to be looking for the
 * best outcome than the worst.
 */
const MIN_LABEL_GAP = 13

export function spreadLabels(labels: { y: number }[]): void {
  labels.sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) {
    const gap = labels[i]!.y - labels[i - 1]!.y
    if (gap < MIN_LABEL_GAP) labels[i]!.y = labels[i - 1]!.y + MIN_LABEL_GAP
  }
}

/** Sizes the SVG to its container and returns the plotting area inside the margins. */
export function axes(
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
