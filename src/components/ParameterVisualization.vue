<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import * as d3 from 'd3'
import D3Chart from './D3Chart.vue'

const store = useCalculatorStore()
const { results } = storeToRefs(store)

// Combine data for reactivity tracking
const chartData = computed(() => ({
  results: results.value,
}))

interface ParameterPoint {
  simulationId: number
  year: number
  development: number
  iskTaxRate: number
  inflationRate: number
}

const drawChart = (
  svgElement: SVGSVGElement,
  containerElement: HTMLDivElement,
  parameterData: ParameterPoint[],
  valueAccessor: (d: ParameterPoint) => number,
  medianAccessor: (d: { year: number; medianValue: number }) => number,
  title: string,
  color: string,
) => {
  // Clear previous chart
  d3.select(svgElement).selectAll('*').remove()

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
  const xExtent = d3.extent(parameterData, (d) => d.year) as [number, number]
  const yExtent = d3.extent(parameterData, valueAccessor) as [number, number]

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
    .attr('fill', 'black')
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
    .attr('fill', 'black')
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

  // Draw points
  svg
    .selectAll('.dot')
    .data(parameterData)
    .enter()
    .append('circle')
    .attr('class', 'dot')
    .attr('cx', (d) => xScale(d.year))
    .attr('cy', (d) => yScale(valueAccessor(d)))
    .attr('r', 1.5)
    .attr('fill', color)
    .attr('opacity', 0.03)

  // Calculate median values by year
  const yearGroups = d3.group(parameterData, (d) => d.year)
  const medianData = Array.from(yearGroups, ([year, values]) => ({
    year,
    medianValue: d3.median(values, valueAccessor) ?? 0,
  })).sort((a, b) => a.year - b.year)

  // Create line generator
  const line = d3
    .line<{ year: number; medianValue: number }>()
    .x((d) => xScale(d.year))
    .y((d) => yScale(medianAccessor(d)))

  // Draw median line
  svg
    .append('path')
    .datum(medianData)
    .attr('class', 'line-median')
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 3)
    .attr('d', line)
}

// Helper to extract parameter data
const getParameterData = (): ParameterPoint[] => {
  const parameterData: ParameterPoint[] = []
  results.value.forEach((result, simulationId) => {
    result.yearlyData.forEach((yearData) => {
      // Get ISK scenario data
      const iskScenario = yearData.scenarios['ISK']
      if (!iskScenario) return

      parameterData.push({
        simulationId,
        year: yearData.year,
        development: iskScenario.development,
        iskTaxRate: iskScenario.taxRate,
        inflationRate: iskScenario.inflationRate,
      })
    })
  })
  return parameterData
}

// Individual render functions for each chart
const renderRorChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  const parameterData = getParameterData()
  drawChart(
    svg,
    container,
    parameterData,
    (d) => d.development,
    (d) => d.medianValue,
    'Avkastning över tid',
    '#0d6efd',
  )
}

const renderIskTaxChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  const parameterData = getParameterData()
  drawChart(
    svg,
    container,
    parameterData,
    (d) => d.iskTaxRate,
    (d) => d.medianValue,
    'ISK-skattesats över tid',
    '#198754',
  )
}

const renderInflationChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  const parameterData = getParameterData()
  drawChart(
    svg,
    container,
    parameterData,
    (d) => d.inflationRate,
    (d) => d.medianValue,
    'Inflation över tid',
    '#dc3545',
  )
}
</script>

<template>
  <div v-if="results.length > 0">
    <p class="text-muted mb-3">
      Punktdiagram som visar stokastiska parametervärden över tid för alla simuleringar.
    </p>

    <!-- ROR Chart -->
    <D3Chart :renderChart="renderRorChart" :data="chartData" />

    <!-- Inflation Chart -->
    <D3Chart :renderChart="renderInflationChart" :data="chartData" />

    <!-- ISK Tax Rate Chart -->
    <D3Chart :renderChart="renderIskTaxChart" :data="chartData" />
  </div>
</template>
