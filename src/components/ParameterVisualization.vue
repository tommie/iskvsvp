<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, watch, onMounted, nextTick } from 'vue'
import * as d3 from 'd3'

const store = useCalculatorStore()
const { results, showStochasticParameters } = storeToRefs(store)

const rorSvgRef = ref<SVGSVGElement | null>(null)
const rorContainerRef = ref<HTMLDivElement | null>(null)
const iskTaxSvgRef = ref<SVGSVGElement | null>(null)
const iskTaxContainerRef = ref<HTMLDivElement | null>(null)
const inflationSvgRef = ref<SVGSVGElement | null>(null)
const inflationContainerRef = ref<HTMLDivElement | null>(null)

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
  legendLabel: string,
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

const drawAllCharts = () => {
  if (!results.value.length) return
  if (!rorSvgRef.value || !rorContainerRef.value) return
  if (!iskTaxSvgRef.value || !iskTaxContainerRef.value) return
  if (!inflationSvgRef.value || !inflationContainerRef.value) return

  // Extract parameter data
  const parameterData: ParameterPoint[] = []
  results.value.forEach((result, simulationId) => {
    result.yearlyData.forEach((yearData) => {
      parameterData.push({
        simulationId,
        year: yearData.year,
        development: yearData.development,
        iskTaxRate: yearData.iskTaxRate,
        inflationRate: yearData.inflationRate,
      })
    })
  })

  // Draw ROR chart
  drawChart(
    rorSvgRef.value,
    rorContainerRef.value,
    parameterData,
    (d) => d.development,
    (d) => d.medianValue,
    'Avkastning över tid',
    '#0d6efd',
    'Avkastning',
  )

  // Draw ISK tax rate chart
  drawChart(
    iskTaxSvgRef.value,
    iskTaxContainerRef.value,
    parameterData,
    (d) => d.iskTaxRate,
    (d) => d.medianValue,
    'ISK-skattesats över tid',
    '#198754',
    'ISK-skatt',
  )

  // Draw inflation chart
  drawChart(
    inflationSvgRef.value,
    inflationContainerRef.value,
    parameterData,
    (d) => d.inflationRate,
    (d) => d.medianValue,
    'Inflation över tid',
    '#dc3545',
    'Inflation',
  )
}

// Watch for data changes
watch(results, async () => {
  await nextTick()
  drawAllCharts()
})

// Watch for visibility changes
watch(showStochasticParameters, async (newValue) => {
  if (newValue) {
    // Wait for DOM to update with visible elements
    await nextTick()
    drawAllCharts()
  }
})

// Redraw on window resize
onMounted(() => {
  const handleResize = () => {
    drawAllCharts()
  }
  window.addEventListener('resize', handleResize)

  // Initial draw
  nextTick(() => drawAllCharts())

  return () => {
    window.removeEventListener('resize', handleResize)
  }
})
</script>

<template>
  <div v-if="results.length > 0 && showStochasticParameters">
    <!-- ROR Chart -->
    <div class="card mb-4">
      <div class="card-header">
        <h3>Avkastning över tid</h3>
        <p class="mb-0 text-muted">
          Punktdiagram som visar årlig avkastning över tid för alla simuleringar
        </p>
      </div>
      <div class="card-body">
        <div ref="rorContainerRef" class="chart-container">
          <svg ref="rorSvgRef"></svg>
        </div>
      </div>
    </div>

    <!-- ISK Tax Rate Chart -->
    <div class="card mb-4">
      <div class="card-header">
        <h3>ISK-skattesats över tid</h3>
        <p class="mb-0 text-muted">
          Punktdiagram som visar ISK-skattesats över tid för alla simuleringar
        </p>
      </div>
      <div class="card-body">
        <div ref="iskTaxContainerRef" class="chart-container">
          <svg ref="iskTaxSvgRef"></svg>
        </div>
      </div>
    </div>

    <!-- Inflation Chart -->
    <div class="card mb-4">
      <div class="card-header">
        <h3>Inflation över tid</h3>
        <p class="mb-0 text-muted">
          Punktdiagram som visar inflation över tid för alla simuleringar
        </p>
      </div>
      <div class="card-body">
        <div ref="inflationContainerRef" class="chart-container">
          <svg ref="inflationSvgRef"></svg>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-container {
  width: 100%;
  overflow-x: auto;
}

svg {
  display: block;
  margin: 0 auto;
}
</style>
