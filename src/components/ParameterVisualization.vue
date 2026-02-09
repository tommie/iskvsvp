<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import * as d3 from 'd3'
import D3Chart from './D3Chart.vue'

const store = useCalculatorStore()
const { simulationResults, startYear } = storeToRefs(store)

// Generate distribution data from percentile statistics
interface DistributionPoint {
  year: number
  values: number[]
  densities: number[]
  median: number
}

// Create distribution data by generating density points from percentile statistics
const generateDistribution = (
  getPercentileValue: (
    percentile: 'percentile10' | 'median' | 'percentile90',
    periodIndex: number,
  ) => number,
): DistributionPoint[] => {
  if (!simulationResults.value || simulationResults.value.statistics.length === 0) return []

  const iskStats = simulationResults.value.statistics[0]!
  const numPeriods = iskStats.median.periodData.inflationRate.length
  const distributions: DistributionPoint[] = []

  // For each period, generate distribution from percentiles
  for (let periodIndex = 0; periodIndex < numPeriods; periodIndex++) {
    const year = startYear.value + periodIndex
    const p10 = getPercentileValue('percentile10', periodIndex)
    const median = getPercentileValue('median', periodIndex)
    const p90 = getPercentileValue('percentile90', periodIndex)

    // Create density distribution (more points near median, fewer at tails)
    const points: Array<{ value: number; density: number }> = []
    const numPoints = 30

    for (let i = 0; i < numPoints; i++) {
      const t = i / (numPoints - 1)
      let value: number
      let density: number

      if (t < 0.5) {
        const localT = t / 0.5
        value = p10 + (median - p10) * localT
        density = 0.5 + localT * 1.0
      } else {
        const localT = (t - 0.5) / 0.5
        value = median + (p90 - median) * localT
        density = 1.5 - localT * 1.0
      }

      points.push({ value, density })
    }

    distributions.push({
      year,
      values: points.map((p) => p.value),
      densities: points.map((p) => p.density),
      median,
    })
  }

  return distributions
}

const assetReturnsDistribution = computed<DistributionPoint[]>(() => {
  if (!simulationResults.value) return []
  return generateDistribution((percentile, periodIndex) => {
    const iskStats = simulationResults.value!.statistics[0]!
    const assetReturns = iskStats[percentile].periodData.assetReturnRates[periodIndex] ?? []
    return assetReturns.length > 0
      ? assetReturns.reduce((a, b) => a + b, 0) / assetReturns.length
      : 0
  })
})

const iskTaxDistribution = computed<DistributionPoint[]>(() => {
  if (!simulationResults.value) return []
  return generateDistribution((percentile, periodIndex) => {
    const iskStats = simulationResults.value!.statistics[0]!
    return iskStats[percentile].periodData.iskTaxRate[periodIndex] ?? 0
  })
})

const inflationDistribution = computed<DistributionPoint[]>(() => {
  if (!simulationResults.value) return []
  return generateDistribution((percentile, periodIndex) => {
    const iskStats = simulationResults.value!.statistics[0]!
    return iskStats[percentile].periodData.inflationRate[periodIndex] ?? 0
  })
})

// Combine data for reactivity tracking
const chartData = computed(() => ({
  assetReturnsDistribution: assetReturnsDistribution.value,
  iskTaxDistribution: iskTaxDistribution.value,
  inflationDistribution: inflationDistribution.value,
}))

const drawChart = (
  svgElement: SVGSVGElement,
  containerElement: HTMLDivElement,
  distributionData: DistributionPoint[],
  title: string,
  color: string,
) => {
  // Clear previous chart
  d3.select(svgElement).selectAll('*').remove()

  if (distributionData.length === 0) return

  // Get container dimensions
  const containerWidth = containerElement.clientWidth
  const margin = { top: 40, right: 30, bottom: 60, left: 80 }
  const width = containerWidth - margin.left - margin.right
  const height = 400 - margin.top - margin.bottom

  const svg = d3
    .select(svgElement)
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // Get data extent
  const xExtent = d3.extent(distributionData, (d) => d.year) as [number, number]
  const allValues = distributionData.flatMap((d) => d.values)
  const yExtent = d3.extent(allValues) as [number, number]

  // Create scales
  const xScale = d3.scaleLinear().domain(xExtent).range([0, width])
  const yScale = d3.scaleLinear().domain(yExtent).range([height, 0]).nice()

  // Add X axis
  svg
    .append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(xScale).tickFormat(d3.format('d')))
    .append('text')
    .attr('x', width / 2)
    .attr('y', 45)
    .attr('fill', 'currentColor')
    .attr('text-anchor', 'middle')
    .style('font-size', '14px')
    .text('År (ålder)')

  // Add Y axis
  svg
    .append('g')
    .call(d3.axisLeft(yScale).tickFormat((d) => d3.format('.1%')(d as number)))
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', -60)
    .attr('fill', 'currentColor')
    .attr('text-anchor', 'middle')
    .style('font-size', '14px')
    .text('Värde')

  // Add title
  svg
    .append('text')
    .attr('x', width / 2)
    .attr('y', -20)
    .attr('text-anchor', 'middle')
    .style('font-size', '16px')
    .style('font-weight', 'bold')
    .text(title)

  // Draw distributions for each year
  distributionData.forEach((dist) => {
    const maxDensity = Math.max(...dist.densities)

    // Draw vertical lines with varying height based on density
    dist.values.forEach((value, idx) => {
      const density = dist.densities[idx] ?? 0
      const normalizedDensity = density / maxDensity

      // Draw horizontal line at this value
      const lineHeight = normalizedDensity * 30 // Max 30px tall
      svg
        .append('line')
        .attr('x1', xScale(dist.year) - lineHeight / 2)
        .attr('x2', xScale(dist.year) + lineHeight / 2)
        .attr('y1', yScale(value))
        .attr('y2', yScale(value))
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('opacity', 0.3 + normalizedDensity * 0.4)
    })
  })

  // Draw median line connecting all medians
  const medianPoints = distributionData.map((d) => ({ year: d.year, value: d.median }))
  const line = d3
    .line<{ year: number; value: number }>()
    .x((d) => xScale(d.year))
    .y((d) => yScale(d.value))

  svg
    .append('path')
    .datum(medianPoints)
    .attr('class', 'line-median')
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 3)
    .attr('d', line)
}

// Individual render functions for each chart
const renderRorChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!assetReturnsDistribution.value.length) return
  drawChart(
    svg,
    container,
    assetReturnsDistribution.value,
    'Genomsnittlig tillgångsavkastning över tid',
    '#0d6efd',
  )
}

const renderIskTaxChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!iskTaxDistribution.value.length) return
  drawChart(svg, container, iskTaxDistribution.value, 'ISK-skattesats över tid', '#198754')
}

const renderInflationChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!inflationDistribution.value.length) return
  drawChart(svg, container, inflationDistribution.value, 'Inflation över tid', '#dc3545')
}
</script>

<template>
  <div v-if="assetReturnsDistribution.length > 0">
    <p class="text-muted mb-3">
      Fördelningar över tid baserade på percentiler från alla simuleringar (intensitet visar
      täthet). Heldragna linjer visar medianvärden.
    </p>

    <!-- ROR Chart -->
    <D3Chart :renderChart="renderRorChart" :data="chartData" />

    <!-- Inflation Chart -->
    <D3Chart :renderChart="renderInflationChart" :data="chartData" />

    <!-- ISK Tax Rate Chart -->
    <D3Chart :renderChart="renderIskTaxChart" :data="chartData" />
  </div>
</template>
