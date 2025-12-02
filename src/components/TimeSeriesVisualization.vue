<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, watch, onMounted, nextTick } from 'vue'
import * as d3 from 'd3'

const store = useCalculatorStore()
const { timeSeriesData } = storeToRefs(store)

const svgRef = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)

const drawChart = () => {
  if (!svgRef.value || !timeSeriesData.value.length || !containerRef.value) return

  // Clear previous chart
  d3.select(svgRef.value).selectAll('*').remove()

  // Get container dimensions
  const containerWidth = containerRef.value.clientWidth
  const margin = { top: 40, right: 120, bottom: 60, left: 80 }
  const width = containerWidth - margin.left - margin.right
  const height = 600 - margin.top - margin.bottom

  const svg = d3
    .select(svgRef.value)
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // Get data extent
  const xExtent = d3.extent(timeSeriesData.value, (d) => d.year) as [number, number]
  const yExtentISK = d3.extent(timeSeriesData.value, (d) => d.iskValue) as [number, number]
  const yExtentVP = d3.extent(timeSeriesData.value, (d) => d.vpValue) as [number, number]
  const yExtent: [number, number] = [
    Math.min(yExtentISK[0], yExtentVP[0]),
    Math.max(yExtentISK[1], yExtentVP[1]),
  ]

  // Create scales
  const xScale = d3.scaleLinear().domain(xExtent).range([0, width])

  // Use log scale for y-axis to better show distribution
  // Ensure we have positive values for log scale
  const yMin = Math.max(yExtent[0], 1)
  const yMax = yExtent[1]
  const yScale = d3.scaleLog().domain([yMin, yMax]).range([height, 0]).nice()

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
    .call(d3.axisLeft(yScale).tickFormat(d3.format('.2s')))
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -height / 2)
    .attr('y', -60)
    .attr('fill', 'black')
    .attr('text-anchor', 'middle')
    .style('font-size', '14px')
    .text('Värde (SEK)')

  // Add title
  svg
    .append('text')
    .attr('x', width / 2)
    .attr('y', -20)
    .attr('text-anchor', 'middle')
    .style('font-size', '16px')
    .style('font-weight', 'bold')
    .text('Monte Carlo Simulation: ISK vs VP över tid (logaritmisk skala)')

  // Filter out invalid data points (NaN, Infinity, values <= 0)
  const validData = timeSeriesData.value.filter(
    (d) => isFinite(d.iskValue) && isFinite(d.vpValue) && d.iskValue > 0 && d.vpValue > 0,
  )

  // Draw ISK points
  svg
    .selectAll('.dot-isk')
    .data(validData)
    .enter()
    .append('circle')
    .attr('class', 'dot-isk')
    .attr('cx', (d) => xScale(d.year))
    .attr('cy', (d) => yScale(d.iskValue))
    .attr('r', 1.5)
    .attr('fill', '#0d6efd')
    .attr('opacity', 0.03)

  // Draw VP points
  svg
    .selectAll('.dot-vp')
    .data(validData)
    .enter()
    .append('circle')
    .attr('class', 'dot-vp')
    .attr('cx', (d) => xScale(d.year))
    .attr('cy', (d) => yScale(d.vpValue))
    .attr('r', 1.5)
    .attr('fill', '#dc3545')
    .attr('opacity', 0.03)

  // Calculate average values by year (using valid data only)
  const yearGroups = d3.group(validData, (d) => d.year)
  const averageData = Array.from(yearGroups, ([year, values]) => ({
    year,
    avgISK: d3.mean(values, (d) => d.iskValue) ?? 0,
    avgVP: d3.mean(values, (d) => d.vpValue) ?? 0,
  })).sort((a, b) => a.year - b.year)

  // Create line generators
  const iskLine = d3
    .line<{ year: number; avgISK: number; avgVP: number }>()
    .x((d) => xScale(d.year))
    .y((d) => yScale(d.avgISK))

  const vpLine = d3
    .line<{ year: number; avgISK: number; avgVP: number }>()
    .x((d) => xScale(d.year))
    .y((d) => yScale(d.avgVP))

  // Draw ISK average line
  svg
    .append('path')
    .datum(averageData)
    .attr('class', 'line-isk-avg')
    .attr('fill', 'none')
    .attr('stroke', '#0d6efd')
    .attr('stroke-width', 3)
    .attr('d', iskLine)

  // Draw VP average line
  svg
    .append('path')
    .datum(averageData)
    .attr('class', 'line-vp-avg')
    .attr('fill', 'none')
    .attr('stroke', '#dc3545')
    .attr('stroke-width', 3)
    .attr('d', vpLine)

  // Add legend
  const legend = svg
    .append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${width + 10}, 0)`)

  // ISK simulation dots
  legend
    .append('circle')
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('r', 4)
    .attr('fill', '#0d6efd')
    .attr('opacity', 0.3)

  legend.append('text').attr('x', 15).attr('y', 5).style('font-size', '11px').text('ISK (sim.)')

  // VP simulation dots
  legend
    .append('circle')
    .attr('cx', 0)
    .attr('cy', 25)
    .attr('r', 4)
    .attr('fill', '#dc3545')
    .attr('opacity', 0.3)

  legend.append('text').attr('x', 15).attr('y', 30).style('font-size', '11px').text('VP (sim.)')

  // ISK average line
  legend
    .append('line')
    .attr('x1', -8)
    .attr('x2', 8)
    .attr('y1', 50)
    .attr('y2', 50)
    .attr('stroke', '#0d6efd')
    .attr('stroke-width', 3)

  legend.append('text').attr('x', 15).attr('y', 55).style('font-size', '11px').text('ISK (medel)')

  // VP average line
  legend
    .append('line')
    .attr('x1', -8)
    .attr('x2', 8)
    .attr('y1', 75)
    .attr('y2', 75)
    .attr('stroke', '#dc3545')
    .attr('stroke-width', 3)

  legend.append('text').attr('x', 15).attr('y', 80).style('font-size', '11px').text('VP (medel)')
}

// Watch for data changes
watch(timeSeriesData, async () => {
  await nextTick()
  drawChart()
})

// Redraw on window resize
onMounted(() => {
  const handleResize = () => {
    drawChart()
  }
  window.addEventListener('resize', handleResize)

  // Initial draw
  nextTick(() => drawChart())

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
        Punktdiagram som visar kontovärden över tid för alla simuleringar (transparens visar täthet)
      </p>
    </div>
    <div class="card-body">
      <div ref="containerRef" class="chart-container">
        <svg ref="svgRef"></svg>
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
