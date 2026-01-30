<script setup lang="ts">
import * as d3 from 'd3'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useCalculatorStore } from '../stores/calculator'
import type { SimulationResult, SimulationStatistics } from '../types'
import D3Chart from './D3Chart.vue'

const store = useCalculatorStore()
const {
  simulationResults,
  yearsLater,
  showDetailedStatistics,
  depositYears,
  profitWithdrawalRate,
} = storeToRefs(store)

// Calculate the first withdrawal period (accounts for deposit years and profit lookback)
const firstWithdrawalPeriod = computed(() => {
  if (profitWithdrawalRate.value > 0) {
    return depositYears.value + 1
  }
  return depositYears.value
})

// Combine data for reactivity tracking
const chartData = computed(() => ({
  simulationResults: simulationResults.value,
  yearsLater: yearsLater.value,
  showDetailedStatistics: showDetailedStatistics.value,
  firstWithdrawalPeriod: firstWithdrawalPeriod.value,
}))

interface DataSeries {
  label: string
  values: number[]
  densities: number[]
  median: number
  color: string
  firstYearMedian?: number
}

const COLORS = ['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']

// Adapter: convert new data model to series format
const buildSeriesFromStats = (
  field:
    | 'totalValue'
    | 'liquidValue'
    | 'realWithdrawal'
    | 'accumulatedRealWithdrawal'
    | 'paidTax'
    | 'taxationDegree'
    | 'maxDrawdown'
    | 'maxDrawdownPeriod',
): DataSeries[] => {
  if (!simulationResults.value || simulationResults.value.statistics.length < 2) return []

  const labels = simulationResults.value.labels
  const finalPeriod = simulationResults.value.statistics[0]!.median.snapshots.liquidValue.length - 1

  const getFieldValue = (stats: SimulationStatistics<SimulationResult<number>>, field: string) => {
    switch (field) {
      case 'totalValue':
        return stats.median.snapshots.totalValue[finalPeriod] ?? 0
      case 'liquidValue':
        return stats.median.snapshots.liquidValue[finalPeriod] ?? 0
      case 'realWithdrawal':
        return stats.median.periodData.withdrawalReal[finalPeriod] ?? 0
      case 'accumulatedRealWithdrawal':
        return stats.median.snapshots.withdrawalReal[finalPeriod] ?? 0
      case 'paidTax':
        return stats.median.snapshots.tax[finalPeriod] ?? 0
      case 'taxationDegree':
        return stats.median.snapshots.taxationDegree[finalPeriod] ?? 0
      case 'maxDrawdown':
        return stats.median.snapshots.maxDrawdown[finalPeriod] ?? 0
      case 'maxDrawdownPeriod':
        return stats.median.snapshots.maxDrawdownPeriod[finalPeriod] ?? 0
      default:
        return 0
    }
  }

  // Create distribution points from percentile statistics
  const createDistributionFromStats = (
    stats: SimulationStatistics<SimulationResult<number>>,
    field: string,
  ) => {
    // Get percentile values for the field
    const getPercentileValue = (
      percentile: 'percentile5' | 'percentile25' | 'median' | 'percentile75' | 'percentile95',
      field: string,
    ) => {
      switch (field) {
        case 'totalValue':
          return stats[percentile].snapshots.totalValue[finalPeriod] ?? 0
        case 'liquidValue':
          return stats[percentile].snapshots.liquidValue[finalPeriod] ?? 0
        case 'realWithdrawal':
          return stats[percentile].periodData.withdrawalReal[finalPeriod] ?? 0
        case 'accumulatedRealWithdrawal':
          return stats[percentile].snapshots.withdrawalReal[finalPeriod] ?? 0
        case 'paidTax':
          return stats[percentile].snapshots.tax[finalPeriod] ?? 0
        case 'taxationDegree':
          return stats[percentile].snapshots.taxationDegree[finalPeriod] ?? 0
        case 'maxDrawdown':
          return stats[percentile].snapshots.maxDrawdown[finalPeriod] ?? 0
        case 'maxDrawdownPeriod':
          return stats[percentile].snapshots.maxDrawdownPeriod[finalPeriod] ?? 0
        default:
          return 0
      }
    }

    const p5 = getPercentileValue('percentile5', field)
    const p25 = getPercentileValue('percentile25', field)
    const median = getPercentileValue('median', field)
    const p75 = getPercentileValue('percentile75', field)
    const p95 = getPercentileValue('percentile95', field)

    // Create density distribution (more points near median, fewer at tails)
    const points: Array<{ value: number; density: number }> = []
    const numPoints = 50

    for (let i = 0; i < numPoints; i++) {
      const t = i / (numPoints - 1)

      // Map uniform t to percentile values with approximate bell curve density
      let value: number
      let density: number

      if (t < 0.25) {
        // 0-25%: p5 to p25
        const localT = t / 0.25
        value = p5 + (p25 - p5) * localT
        density = 0.5 + localT * 0.5 // Low to medium density
      } else if (t < 0.5) {
        // 25-50%: p25 to median
        const localT = (t - 0.25) / 0.25
        value = p25 + (median - p25) * localT
        density = 1.0 + localT * 0.5 // Medium to high density
      } else if (t < 0.75) {
        // 50-75%: median to p75
        const localT = (t - 0.5) / 0.25
        value = median + (p75 - median) * localT
        density = 1.5 - localT * 0.5 // High to medium density
      } else {
        // 75-100%: p75 to p95
        const localT = (t - 0.75) / 0.25
        value = p75 + (p95 - p75) * localT
        density = 1.0 - localT * 0.5 // Medium to low density
      }

      points.push({ value, density })
    }

    return points
  }

  return simulationResults.value.statistics.map((stats, i) => {
    const dist = createDistributionFromStats(stats, field)

    // For withdrawal chart, include first year median as reference
    const firstYearMedian =
      field === 'realWithdrawal'
        ? (stats.median.periodData.withdrawalReal[firstWithdrawalPeriod.value] ?? undefined)
        : undefined

    return {
      label: labels[i] ?? `${i + 1}`,
      values: dist.map((p) => p.value),
      densities: dist.map((p) => p.density),
      median: getFieldValue(stats, field),
      color: COLORS[i % COLORS.length]!,
      firstYearMedian,
    }
  })
}

const drawChart = (
  svgElement: SVGSVGElement,
  containerElement: HTMLDivElement,
  series: DataSeries[],
  title: string,
  formatValue: (d: number) => string,
  useLinearScale: boolean = false,
  referenceValue?: number,
) => {
  const tickCount = useLinearScale ? 4 : 2
  const rowHeight = 90

  // Clear previous chart
  d3.select(svgElement).selectAll('*').remove()

  // Get container dimensions
  const containerWidth = containerElement.clientWidth
  const margin = { top: 40, right: 80, bottom: 60, left: 150 }
  const height = series.length * rowHeight + margin.top + margin.bottom

  const svg = d3
    .select(svgElement)
    .attr('width', containerWidth)
    .attr('height', height)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  const width = containerWidth - margin.left - margin.right

  // Get x extent across all series, including reference value and firstYearMedian if provided
  const allValues = series
    .flatMap((s) => {
      const values = s.values.filter((v) => isFinite(v) && (useLinearScale ? v >= 0 : v > 0))
      // Include firstYearMedian in extent calculation
      if (s.firstYearMedian !== undefined && isFinite(s.firstYearMedian) && s.firstYearMedian > 0) {
        values.push(s.firstYearMedian)
      }
      return values
    })

  // Include reference value in extent calculation
  if (referenceValue !== undefined && isFinite(referenceValue) && referenceValue > 0) {
    allValues.push(referenceValue)
  }

  if (allValues.length === 0) return

  const xExtent = d3.extent(allValues) as [number, number]

  // Create scale
  let xScale: d3.ScaleLinear<number, number> | d3.ScaleLogarithmic<number, number>
  if (useLinearScale) {
    const xMin = Math.max(xExtent[0], 0)
    const xMax = xExtent[1]
    xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, width]).nice()
  } else {
    const xMin = Math.max(xExtent[0], 0.0001)
    const xMax = xExtent[1]
    xScale = d3.scaleLog().domain([xMin, xMax]).range([0, width]).nice()
  }

  // Add X axis
  svg
    .append('g')
    .attr('transform', `translate(0,${series.length * rowHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(tickCount)
        .tickFormat((d) => formatValue(d as number)),
    )
    .style('font-size', '12px')

  // Add title
  svg
    .append('text')
    .attr('x', width / 2)
    .attr('y', -20)
    .attr('text-anchor', 'middle')
    .style('font-size', '16px')
    .style('font-weight', 'bold')
    .text(title)

  // Draw each series
  series.forEach((s, i) => {
    const yPosition = i * rowHeight + rowHeight / 2

    // Draw distribution as vertical lines with varying opacity based on density
    s.values.forEach((value, idx) => {
      if (!isFinite(value) || (useLinearScale ? value < 0 : value <= 0)) return

      const density = s.densities[idx] ?? 0.5
      const maxDensity = Math.max(...s.densities)
      const normalizedDensity = density / maxDensity

      // Draw vertical line
      const lineHeight = normalizedDensity * 40 // Max 40px tall
      svg
        .append('line')
        .attr('x1', xScale(value))
        .attr('x2', xScale(value))
        .attr('y1', yPosition - lineHeight / 2)
        .attr('y2', yPosition + lineHeight / 2)
        .attr('stroke', s.color)
        .attr('stroke-width', 5)
        .attr('opacity', 0.3 + normalizedDensity * 0.4) // 0.3 to 0.7 opacity
    })

    // Draw median line (solid and prominent)
    if (isFinite(s.median) && (useLinearScale ? s.median >= 0 : s.median > 0)) {
      svg
        .append('line')
        .attr('x1', xScale(s.median))
        .attr('x2', xScale(s.median))
        .attr('y1', yPosition - 25)
        .attr('y2', yPosition + 25)
        .attr('stroke', s.color)
        .attr('stroke-width', 3)

      // Median label
      svg
        .append('text')
        .attr('x', xScale(s.median))
        .attr('y', yPosition - 30)
        .attr('text-anchor', 'middle')
        .style('font-size', '11px')
        .style('font-weight', 'bold')
        .style('fill', s.color)
        .text(formatValue(s.median))
    }

    // Draw first year reference line (dotted)
    if (
      s.firstYearMedian !== undefined &&
      isFinite(s.firstYearMedian) &&
      (useLinearScale ? s.firstYearMedian >= 0 : s.firstYearMedian > 0)
    ) {
      svg
        .append('line')
        .attr('x1', xScale(s.firstYearMedian))
        .attr('x2', xScale(s.firstYearMedian))
        .attr('y1', yPosition - 20)
        .attr('y2', yPosition + 20)
        .attr('stroke', s.color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,4')
        .attr('opacity', 0.6)

      // First year label
      svg
        .append('text')
        .attr('x', xScale(s.firstYearMedian))
        .attr('y', yPosition + 35)
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .style('fill', s.color)
        .style('opacity', 0.7)
        .text(formatValue(s.firstYearMedian))
    }

    // Series label
    svg
      .append('text')
      .attr('x', -10)
      .attr('y', yPosition + 5)
      .attr('text-anchor', 'end')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .style('fill', s.color)
      .text(s.label)
  })
}

// Individual render functions
const renderTotalValueChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!simulationResults.value) return
  const series = buildSeriesFromStats('totalValue')
  drawChart(svg, container, series, 'Totalt värde', (d) => d3.format('.3s')(d) + ' kr')
}

const renderLiquidValueChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!simulationResults.value) return
  const series = buildSeriesFromStats('liquidValue')
  drawChart(svg, container, series, 'Likvidvärde', (d) => d3.format('.3s')(d) + ' kr')
}

const renderWithdrawalChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!simulationResults.value) return
  const series = buildSeriesFromStats('realWithdrawal')
  drawChart(svg, container, series, 'Uttag reellt (sista året)', (d) => d3.format('.3s')(d) + ' kr')
}

const renderAccumulatedWithdrawalChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!simulationResults.value) return
  const series = buildSeriesFromStats('accumulatedRealWithdrawal')
  drawChart(svg, container, series, 'Ackumulerat uttag reellt', (d) => d3.format('.3s')(d) + ' kr')
}

const renderMaxDrawdownChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!simulationResults.value) return
  const series = buildSeriesFromStats('maxDrawdown')
  drawChart(svg, container, series, 'Maximalt drawdown', (d) => d3.format('.1%')(d), true)
}

const renderMaxDrawdownPeriodChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!simulationResults.value) return
  const series = buildSeriesFromStats('maxDrawdownPeriod')
  drawChart(
    svg,
    container,
    series,
    'Längsta drawdown-period',
    (d) => d3.format('.0f')(d) + ' år',
    true,
  )
}

const renderPaidTaxChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!simulationResults.value) return
  const series = buildSeriesFromStats('paidTax')
  drawChart(svg, container, series, 'Betald skatt', (d) => d3.format('.3s')(d) + ' kr')
}

const renderTaxationDegreeChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!simulationResults.value) return
  const series = buildSeriesFromStats('taxationDegree')
  drawChart(svg, container, series, 'Beskattningsgrad', (d) => d3.format('.1%')(d))
}
</script>

<template>
  <div v-if="simulationResults">
    <p class="text-muted mb-3">
      Fördelningen av värden från simuleringen. Heldragna linjer visar medianvärden.
    </p>

    <!-- Total Value -->
    <div class="mb-4">
      <D3Chart :renderChart="renderTotalValueChart" :data="chartData" />
    </div>

    <!-- Liquid Value -->
    <div class="mb-4">
      <D3Chart :renderChart="renderLiquidValueChart" :data="chartData" />
    </div>

    <!-- Withdrawal (Last Year) -->
    <div class="mb-4">
      <D3Chart :renderChart="renderWithdrawalChart" :data="chartData" />
    </div>

    <!-- Accumulated Withdrawal -->
    <div class="mb-4">
      <D3Chart :renderChart="renderAccumulatedWithdrawalChart" :data="chartData" />
    </div>

    <!-- Max Drawdown -->
    <div class="mb-4">
      <D3Chart :renderChart="renderMaxDrawdownChart" :data="chartData" />
    </div>

    <!-- Max Drawdown Period -->
    <div v-if="showDetailedStatistics" class="mb-4">
      <D3Chart :renderChart="renderMaxDrawdownPeriodChart" :data="chartData" />
    </div>

    <!-- Paid Tax -->
    <div v-if="showDetailedStatistics" class="mb-4">
      <D3Chart :renderChart="renderPaidTaxChart" :data="chartData" />
    </div>

    <!-- Taxation Degree -->
    <div v-if="showDetailedStatistics" class="mb-4">
      <D3Chart :renderChart="renderTaxationDegreeChart" :data="chartData" />
    </div>
  </div>
</template>
