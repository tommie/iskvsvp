<script setup lang="ts">
import * as d3 from 'd3'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useCalculatorStore } from '../stores/calculator'
import type { SimulationResult, SimulationStatistics } from '../types'
import D3Chart from './D3Chart.vue'

const store = useCalculatorStore()
const { simulationResults, startYear, depositYears } = storeToRefs(store)

// Data structure for percentile-based distributions over time
interface TimeSeriesDistribution {
  year: number
  distributions: {
    scenarioName: string
    values: number[]
    densities: number[]
    median: number
  }[]
}

const COLORS = ['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']

// Generate distribution points from percentile statistics for each time period
const timeSeriesDistributions = computed<TimeSeriesDistribution[]>(() => {
  if (!simulationResults.value || simulationResults.value.statistics.length < 1) return []

  const labels = simulationResults.value.labels
  const numPeriods = simulationResults.value.statistics[0]!.median.snapshots.liquidValue.length

  return Array.from({ length: numPeriods }, (_, periodIndex) => {
    const year = startYear.value + periodIndex

    // Helper to get percentile value for a given field and period
    const getPercentileValue = (
      stats: SimulationStatistics<SimulationResult<number>>,
      percentile: 'percentile5' | 'percentile25' | 'median' | 'percentile75' | 'percentile95',
      field: 'liquidValue' | 'withdrawalReal',
      periodIndex: number,
    ) => {
      if (field === 'liquidValue') {
        return stats[percentile].snapshots.liquidValue[periodIndex] ?? 0
      } else {
        return stats[percentile].periodData.withdrawalReal[periodIndex] ?? 0
      }
    }

    // Create distribution from percentiles
    const createDistribution = (
      stats: SimulationStatistics<SimulationResult<number>>,
      field: 'liquidValue' | 'withdrawalReal',
    ) => {
      const p5 = getPercentileValue(stats, 'percentile5', field, periodIndex)
      const p25 = getPercentileValue(stats, 'percentile25', field, periodIndex)
      const median = getPercentileValue(stats, 'median', field, periodIndex)
      const p75 = getPercentileValue(stats, 'percentile75', field, periodIndex)
      const p95 = getPercentileValue(stats, 'percentile95', field, periodIndex)

      // Create density distribution (more points near median, fewer at tails)
      const points: Array<{ value: number; density: number }> = []
      const numPoints = 30

      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1)

        let value: number
        let density: number

        if (t < 0.25) {
          const localT = t / 0.25
          value = p5 + (p25 - p5) * localT
          density = 0.5 + localT * 0.5
        } else if (t < 0.5) {
          const localT = (t - 0.25) / 0.25
          value = p25 + (median - p25) * localT
          density = 1.0 + localT * 0.5
        } else if (t < 0.75) {
          const localT = (t - 0.5) / 0.25
          value = median + (p75 - median) * localT
          density = 1.5 - localT * 0.5
        } else {
          const localT = (t - 0.75) / 0.25
          value = p75 + (p95 - p75) * localT
          density = 1.0 - localT * 0.5
        }

        points.push({ value, density })
      }

      return {
        values: points.map((p) => p.value),
        densities: points.map((p) => p.density),
        median,
      }
    }

    return {
      year,
      distributions: simulationResults.value!.statistics.map((stats, i) => ({
        scenarioName: labels[i]!,
        ...createDistribution(stats, 'liquidValue'),
      })),
    }
  })
})

// Withdrawal distributions
const withdrawalDistributions = computed<TimeSeriesDistribution[]>(() => {
  if (!simulationResults.value || simulationResults.value.statistics.length < 1) return []

  const labels = simulationResults.value.labels
  const numPeriods = simulationResults.value.statistics[0]!.median.snapshots.liquidValue.length

  return Array.from({ length: numPeriods }, (_, periodIndex) => {
    const year = startYear.value + periodIndex

    const getPercentileValue = (
      stats: SimulationStatistics<SimulationResult<number>>,
      percentile: 'percentile5' | 'percentile25' | 'median' | 'percentile75' | 'percentile95',
    ) => {
      return stats[percentile].periodData.withdrawalReal[periodIndex] ?? 0
    }

    const createDistribution = (stats: SimulationStatistics<SimulationResult<number>>) => {
      const p5 = getPercentileValue(stats, 'percentile5')
      const p25 = getPercentileValue(stats, 'percentile25')
      const median = getPercentileValue(stats, 'median')
      const p75 = getPercentileValue(stats, 'percentile75')
      const p95 = getPercentileValue(stats, 'percentile95')

      const points: Array<{ value: number; density: number }> = []
      const numPoints = 30

      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1)
        let value: number
        let density: number

        if (t < 0.25) {
          const localT = t / 0.25
          value = p5 + (p25 - p5) * localT
          density = 0.5 + localT * 0.5
        } else if (t < 0.5) {
          const localT = (t - 0.25) / 0.25
          value = p25 + (median - p25) * localT
          density = 1.0 + localT * 0.5
        } else if (t < 0.75) {
          const localT = (t - 0.5) / 0.25
          value = median + (p75 - median) * localT
          density = 1.5 - localT * 0.5
        } else {
          const localT = (t - 0.75) / 0.25
          value = p75 + (p95 - p75) * localT
          density = 1.0 - localT * 0.5
        }

        points.push({ value, density })
      }

      return {
        values: points.map((p) => p.value),
        densities: points.map((p) => p.density),
        median,
      }
    }

    return {
      year,
      distributions: simulationResults.value!.statistics.map((stats, i) => ({
        scenarioName: labels[i]!,
        ...createDistribution(stats),
      })),
    }
  })
})

// Combine data for reactivity tracking
const chartData = computed(() => ({
  liquidValue: timeSeriesDistributions.value,
  withdrawalReal: withdrawalDistributions.value,
}))

const drawGenericChart = (
  svgElement: SVGSVGElement,
  containerElement: HTMLDivElement,
  data: TimeSeriesDistribution[],
  title: string,
  yAxisLabel: string,
  transitionYear?: number,
) => {
  // Clear previous chart
  d3.select(svgElement).selectAll('*').remove()

  if (data.length === 0) return

  // Get container dimensions
  const containerWidth = containerElement.clientWidth
  const margin = { top: 40, right: 120, bottom: 60, left: 80 }
  const width = containerWidth - margin.left - margin.right
  const height = 600 - margin.top - margin.bottom

  const svg = d3
    .select(svgElement)
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // Get data extents
  const xExtent = d3.extent(data, (d) => d.year) as [number, number]

  // Get y extent across all distributions
  const allValues = data.flatMap((d) =>
    d.distributions.flatMap((dist) => dist.values.filter((v) => isFinite(v) && v > 0)),
  )
  const yExtent = d3.extent(allValues) as [number, number]

  // Create scales
  const xScale = d3.scaleLinear().domain(xExtent).range([0, width])

  // Use log scale for y-axis
  const yMin = Math.max(yExtent[0], 1)
  const yMax = yExtent[1]
  const yScale = d3.scaleLog().domain([yMin, yMax]).range([height, 0]).nice()

  // Add X axis
  svg
    .append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(xScale).ticks(3).tickFormat(d3.format('d')))
    .append('text')
    .attr('x', width / 2)
    .attr('y', 45)
    .attr('fill', 'black')
    .attr('text-anchor', 'middle')
    .style('font-size', '14px')
    .text('År (ålder)')

  // Add Y axis
  svg
    .append('g')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('.2s')))
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', -60)
    .attr('fill', 'black')
    .attr('text-anchor', 'middle')
    .style('font-size', '14px')
    .text(yAxisLabel)

  // Add title
  svg
    .append('text')
    .attr('x', width / 2)
    .attr('y', -20)
    .attr('text-anchor', 'middle')
    .style('font-size', '16px')
    .style('font-weight', 'bold')
    .text(title)

  // Add horizontal line at initial value (first year median of first scenario)
  const initialValue = data[0]?.distributions[0]?.median
  if (initialValue && initialValue > 0 && isFinite(initialValue)) {
    svg
      .append('line')
      .attr('x1', 0)
      .attr('x2', width)
      .attr('y1', yScale(initialValue))
      .attr('y2', yScale(initialValue))
      .attr('stroke', '#999')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,5')
      .attr('opacity', 0.7)
  }

  // Add vertical line at deposit/withdrawal transition year
  if (transitionYear && transitionYear >= xExtent[0] && transitionYear <= xExtent[1]) {
    svg
      .append('line')
      .attr('x1', xScale(transitionYear))
      .attr('x2', xScale(transitionYear))
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#d63384')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '8,4')
      .attr('opacity', 0.6)

    // Add label for the transition line
    svg
      .append('text')
      .attr('x', xScale(transitionYear) + 5)
      .attr('y', 15)
      .attr('fill', '#d63384')
      .style('font-size', '12px')
      .style('font-weight', 'bold')
      .text('Uttag börjar')
  }

  // Draw distributions
  const scenarioNames = data[0]?.distributions.map((d) => d.scenarioName) ?? []
  const offsetRange = 0.8
  const offsetPerSeries = scenarioNames.length > 1 ? offsetRange / (scenarioNames.length - 1) : 0

  data.forEach((yearData) => {
    yearData.distributions.forEach((dist, scenarioIndex) => {
      const color = COLORS[scenarioIndex % COLORS.length] ?? '#999'
      const xOffset = scenarioIndex * offsetPerSeries - offsetRange / 2

      // Find max density for normalization
      const maxDensity = Math.max(...dist.densities)

      // Draw density lines
      dist.values.forEach((value, idx) => {
        if (!isFinite(value) || value <= 0) return

        const density = dist.densities[idx] ?? 0
        const normalizedDensity = density / maxDensity

        // Draw vertical line at this position
        const lineWidth = normalizedDensity * 8 // Max 8px wide
        svg
          .append('line')
          .attr('x1', xScale(yearData.year + xOffset) - lineWidth / 2)
          .attr('x2', xScale(yearData.year + xOffset) + lineWidth / 2)
          .attr('y1', yScale(value))
          .attr('y2', yScale(value))
          .attr('stroke', color)
          .attr('stroke-width', 1)
          .attr('opacity', 0.3 + normalizedDensity * 0.4)
      })

      // Draw median marker
      if (isFinite(dist.median) && dist.median > 0) {
        svg
          .append('circle')
          .attr('cx', xScale(yearData.year + xOffset))
          .attr('cy', yScale(dist.median))
          .attr('r', 2)
          .attr('fill', color)
          .attr('stroke', 'white')
          .attr('stroke-width', 0.5)
      }
    })
  })

  // Draw median lines connecting the medians
  scenarioNames.forEach((scenarioName, scenarioIndex) => {
    const color = COLORS[scenarioIndex % COLORS.length] ?? '#999'
    const xOffset = scenarioIndex * offsetPerSeries - offsetRange / 2

    const medianPoints = data
      .map((yearData) => {
        const dist = yearData.distributions.find((d) => d.scenarioName === scenarioName)
        return dist && isFinite(dist.median) && dist.median > 0
          ? { year: yearData.year, value: dist.median }
          : null
      })
      .filter((d): d is { year: number; value: number } => d !== null)

    if (medianPoints.length > 0) {
      const medianLine = d3
        .line<{ year: number; value: number }>()
        .x((d) => xScale(d.year + xOffset))
        .y((d) => yScale(d.value))

      svg
        .append('path')
        .datum(medianPoints)
        .attr('class', `line-${scenarioName}-median`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('d', medianLine)
    }
  })

  // Add legend
  const legend = svg
    .append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${width + 10}, 0)`)

  scenarioNames.forEach((scenarioName, i) => {
    const color = COLORS[i % COLORS.length] ?? '#999'
    const yOffset = i * 24

    // Distribution area
    legend
      .append('rect')
      .attr('x', -6)
      .attr('y', yOffset - 6)
      .attr('width', 12)
      .attr('height', 12)
      .attr('fill', color)
      .attr('opacity', 0.4)

    legend
      .append('text')
      .attr('x', 15)
      .attr('y', yOffset + 5)
      .style('font-size', '11px')
      .text(scenarioName)
  })
}

// Render functions for D3Chart component
const renderValueChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!timeSeriesDistributions.value.length) return
  const transitionYear = depositYears.value > 0 ? startYear.value + depositYears.value : undefined
  drawGenericChart(
    svg,
    container,
    timeSeriesDistributions.value,
    'Värde över tid (logaritmisk skala)',
    'Värde (SEK)',
    transitionYear,
  )
}

const renderWithdrawalChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!withdrawalDistributions.value.length) return
  const transitionYear = depositYears.value > 0 ? startYear.value + depositYears.value : undefined
  drawGenericChart(
    svg,
    container,
    withdrawalDistributions.value,
    'Uttag per år (reellt, logaritmisk skala)',
    'Uttag reellt (SEK)',
    transitionYear,
  )
}
</script>

<template>
  <div v-if="timeSeriesDistributions.length > 0">
    <p class="text-muted mb-3">
      Fördelningar över tid baserade på percentiler från alla simuleringar (intensitet visar
      täthet). Heldragna linjer visar medianvärden, horisontell grå linje visar initialt värde.
    </p>
    <div class="mb-4">
      <D3Chart :renderChart="renderValueChart" :data="chartData" />
    </div>
    <div>
      <D3Chart :renderChart="renderWithdrawalChart" :data="chartData" />
    </div>
  </div>
</template>
