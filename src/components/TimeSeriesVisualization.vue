<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, watch, onMounted, nextTick } from 'vue'
import * as d3 from 'd3'

const store = useCalculatorStore()
const { timeSeriesData } = storeToRefs(store)

const valueSvgRef = ref<SVGSVGElement | null>(null)
const valueContainerRef = ref<HTMLDivElement | null>(null)
const withdrawalSvgRef = ref<SVGSVGElement | null>(null)
const withdrawalContainerRef = ref<HTMLDivElement | null>(null)

const drawGenericChart = (
  svgElement: SVGSVGElement,
  containerElement: HTMLDivElement,
  dataExtractor: (d: any, scenarioName: string) => number,
  title: string,
  yAxisLabel: string,
) => {
  // Clear previous chart
  d3.select(svgElement).selectAll('*').remove()

  // Get scenario names from first data point
  const scenarioNames = Object.keys(timeSeriesData.value[0]?.liquidValue ?? {})
  if (scenarioNames.length === 0) return

  const colors = ['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']

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

  // Get data extent
  const xExtent = d3.extent(timeSeriesData.value, (d) => d.year) as [number, number]

  // Get y extent across all scenarios
  const allScenarioValues = timeSeriesData.value.flatMap((d) =>
    scenarioNames.map((name) => dataExtractor(d, name)),
  )
  const yExtent = d3.extent(allScenarioValues.filter((v) => isFinite(v) && v > 0)) as [
    number,
    number,
  ]

  // Create scales
  const xScale = d3.scaleLinear().domain(xExtent).range([0, width])

  // Use log scale for y-axis to better show distribution
  const yMin = Math.max(yExtent[0], 1)
  const yMax = yExtent[1]
  const yScale = d3.scaleLog().domain([yMin, yMax]).range([height, 0]).nice()

  // Add X axis
  svg
    .append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.format('d')))
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
    .call(d3.axisLeft(yScale).ticks(3).tickFormat(d3.format('.2s')))
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

  // Add horizontal line at initial value
  const initialValue = dataExtractor(timeSeriesData.value[0]!, scenarioNames[0]!)
  if (initialValue > 0 && isFinite(initialValue)) {
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

  // Draw points and median lines for each scenario
  scenarioNames.forEach((scenarioName, i) => {
    const color = colors[i % colors.length]!

    // Calculate offset for this series (distribute evenly across a small range)
    const offsetRange = 0.3 // Total year range for offsets
    const offsetPerSeries = offsetRange / Math.max(1, scenarioNames.length - 1)
    const xOffset = i * offsetPerSeries - offsetRange / 2

    // Filter valid data for this scenario
    const validData = timeSeriesData.value.filter((d) => {
      const value = dataExtractor(d, scenarioName)
      return isFinite(value) && value > 0
    })

    // Draw points
    svg
      .selectAll(`.dot-${scenarioName}`)
      .data(validData)
      .enter()
      .append('circle')
      .attr('class', `dot-${scenarioName}`)
      .attr('cx', (d) => xScale(d.year + xOffset))
      .attr('cy', (d) => yScale(dataExtractor(d, scenarioName)))
      .attr('r', 1.5)
      .attr('fill', color)
      .attr('opacity', 0.03)

    // Calculate median values by year
    const yearGroups = d3.group(validData, (d) => d.year)
    const medianData = Array.from(yearGroups, ([year, values]) => ({
      year,
      median: d3.median(values, (d) => dataExtractor(d, scenarioName)) ?? 0,
    }))
      .filter((d) => isFinite(d.median) && d.median > 0)
      .sort((a, b) => a.year - b.year)

    // Create line generator
    const line = d3
      .line<{ year: number; median: number }>()
      .x((d) => xScale(d.year + xOffset))
      .y((d) => yScale(d.median))

    // Draw median line
    svg
      .append('path')
      .datum(medianData)
      .attr('class', `line-${scenarioName}-median`)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 3)
      .attr('d', line)
  })

  // Add legend
  const legend = svg
    .append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${width + 10}, 0)`)

  scenarioNames.forEach((scenarioName, i) => {
    const color = colors[i % colors.length]!
    const yOffset = i * 50

    // Simulation dots
    legend
      .append('circle')
      .attr('cx', 0)
      .attr('cy', yOffset)
      .attr('r', 4)
      .attr('fill', color)
      .attr('opacity', 0.3)

    legend
      .append('text')
      .attr('x', 15)
      .attr('y', yOffset + 5)
      .style('font-size', '11px')
      .text(`${scenarioName} (sim.)`)

    // Median line
    legend
      .append('line')
      .attr('x1', -8)
      .attr('x2', 8)
      .attr('y1', yOffset + 25)
      .attr('y2', yOffset + 25)
      .attr('stroke', color)
      .attr('stroke-width', 3)

    legend
      .append('text')
      .attr('x', 15)
      .attr('y', yOffset + 30)
      .style('font-size', '11px')
      .text(`${scenarioName} (median)`)
  })
}

const drawCharts = () => {
  if (!timeSeriesData.value.length) return
  if (!valueSvgRef.value || !valueContainerRef.value) return
  if (!withdrawalSvgRef.value || !withdrawalContainerRef.value) return

  // Draw value chart
  drawGenericChart(
    valueSvgRef.value,
    valueContainerRef.value,
    (d, scenarioName) => d.liquidValue[scenarioName] ?? 0,
    'Värde över tid (logaritmisk skala)',
    'Värde (SEK)',
  )

  // Draw withdrawal chart
  drawGenericChart(
    withdrawalSvgRef.value,
    withdrawalContainerRef.value,
    (d, scenarioName) => d.withdrawalsReal[scenarioName] ?? 0,
    'Uttag över tid (reellt, logaritmisk skala)',
    'Uttag reellt (SEK)',
  )
}

// Watch for data changes
watch(timeSeriesData, async () => {
  await nextTick()
  drawCharts()
})

// Redraw on window resize
onMounted(() => {
  const handleResize = () => {
    drawCharts()
  }
  window.addEventListener('resize', handleResize)

  // Initial draw
  nextTick(() => drawCharts())

  return () => {
    window.removeEventListener('resize', handleResize)
  }
})
</script>

<template>
  <div class="card mb-4" v-if="timeSeriesData.length > 0">
    <div class="card-header">
      <h3>Över tid</h3>
      <p class="mb-0 text-muted">
        Punktdiagram som visar kontovärden och uttag över tid för alla simuleringar (transparens
        visar täthet). Heldragna linjer visar medianvärden, streckade linjer visar initiala värden.
      </p>
    </div>
    <div class="card-body">
      <div ref="valueContainerRef" class="chart-container mb-4">
        <svg ref="valueSvgRef"></svg>
      </div>
      <div ref="withdrawalContainerRef" class="chart-container">
        <svg ref="withdrawalSvgRef"></svg>
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
