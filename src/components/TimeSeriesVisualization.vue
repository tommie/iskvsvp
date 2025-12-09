<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import * as d3 from 'd3'
import D3Chart from './D3Chart.vue'

const store = useCalculatorStore()
const { timeSeriesData, representativeSimulationId } = storeToRefs(store)

// Combine data for reactivity tracking
const chartData = computed(() => ({
  timeSeriesData: timeSeriesData.value,
  representativeSimulationId: representativeSimulationId.value,
}))

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

  // Create histogram bins (30 bins, exponentially spaced for log scale)
  const numBins = 30
  const logMin = Math.log(yMin)
  const logMax = Math.log(yMax)
  const binEdges: number[] = []
  for (let i = 0; i <= numBins; i++) {
    binEdges.push(Math.exp(logMin + (i / numBins) * (logMax - logMin)))
  }

  // Draw histograms and median lines for each scenario
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

    // Group by year and create 2D histogram
    const yearGroups = d3.group(validData, (d) => d.year)
    const years = Array.from(yearGroups.keys()).sort((a, b) => a - b)

    // Find max count for opacity scaling
    let maxCount = 0
    const histogramData: Array<{ year: number; binIndex: number; count: number }> = []

    years.forEach((year) => {
      const yearData = yearGroups.get(year)!
      const values = yearData.map((d) => dataExtractor(d, scenarioName))

      // Count values in each bin
      const binCounts = new Array(numBins).fill(0)
      values.forEach((value) => {
        // Find which bin this value belongs to
        for (let b = 0; b < numBins; b++) {
          if (value >= binEdges[b]! && value < binEdges[b + 1]!) {
            binCounts[b]++
            break
          }
        }
      })

      // Store histogram data
      binCounts.forEach((count, binIndex) => {
        if (count > 0) {
          histogramData.push({ year, binIndex, count })
          maxCount = Math.max(maxCount, count)
        }
      })
    })

    // Draw histogram rectangles
    const yearWidth = years.length > 1 ? Math.abs(xScale(years[1]!) - xScale(years[0]!)) : 10
    const rectWidth = (yearWidth * 0.4) / scenarioNames.length

    svg
      .selectAll(`.hist-${scenarioName}`)
      .data(histogramData)
      .enter()
      .append('rect')
      .attr('class', `hist-${scenarioName}`)
      .attr('x', (d) => xScale(d.year + xOffset) - rectWidth / 2)
      .attr('y', (d) => yScale(binEdges[d.binIndex + 1]!))
      .attr('width', rectWidth)
      .attr('height', (d) => yScale(binEdges[d.binIndex]!) - yScale(binEdges[d.binIndex + 1]!))
      .attr('fill', color)
      .attr('opacity', (d) => Math.pow(d.count / maxCount, 0.5) * 0.7 + 0.1)
  })

  // Draw representative simulation line if available
  if (representativeSimulationId.value !== null) {
    const repSimData = timeSeriesData.value.filter(
      (d) => d.simulationId === representativeSimulationId.value,
    )

    scenarioNames.forEach((scenarioName, i) => {
      const color = colors[i % colors.length]!
      const offsetRange = 0.3
      const offsetPerSeries = offsetRange / Math.max(1, scenarioNames.length - 1)
      const xOffset = i * offsetPerSeries - offsetRange / 2

      const repData = repSimData
        .map((d) => ({
          year: d.year,
          value: dataExtractor(d, scenarioName),
        }))
        .filter((d) => isFinite(d.value) && d.value > 0)
        .sort((a, b) => a.year - b.year)

      if (repData.length > 0) {
        const repLine = d3
          .line<{ year: number; value: number }>()
          .x((d) => xScale(d.year + xOffset))
          .y((d) => yScale(d.value))

        svg
          .append('path')
          .datum(repData)
          .attr('class', `line-${scenarioName}-representative`)
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '5,5')
          .attr('d', repLine)
      }
    })
  }

  // Add legend
  const legend = svg
    .append('g')
    .attr('class', 'legend')
    .attr('transform', `translate(${width + 10}, 0)`)

  scenarioNames.forEach((scenarioName, i) => {
    const color = colors[i % colors.length]!
    const yOffset = i * 50

    // Simulation histogram
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
      .text(`${scenarioName} (hist.)`)

    // Representative simulation line
    if (representativeSimulationId.value !== null) {
      legend
        .append('line')
        .attr('x1', -8)
        .attr('x2', 8)
        .attr('y1', yOffset + 25)
        .attr('y2', yOffset + 25)
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '5,5')

      legend
        .append('text')
        .attr('x', 15)
        .attr('y', yOffset + 30)
        .style('font-size', '11px')
        .text(`${scenarioName} (repr.)`)
    }
  })
}

// Render functions for D3Chart component
const renderValueChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!timeSeriesData.value.length) return
  drawGenericChart(
    svg,
    container,
    (d, scenarioName) => d.liquidValue[scenarioName] ?? 0,
    'Värde (logaritmisk skala)',
    'Värde (SEK)',
  )
}

const renderWithdrawalChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!timeSeriesData.value.length) return
  drawGenericChart(
    svg,
    container,
    (d, scenarioName) => d.withdrawalsReal[scenarioName] ?? 0,
    'Uttag per år (reellt, logaritmisk skala)',
    'Uttag reellt (SEK)',
  )
}
</script>

<template>
  <div v-if="timeSeriesData.length > 0">
    <p class="text-muted mb-3">
      Histogram som visar fördelningen av kontovärden och uttag över tid för alla simuleringar
      (intensitet visar täthet). Färgade streckade linjer visar ett representativt exempel (närmast
      median), horisontell grå linje visar initialt värde.
    </p>
    <div class="mb-4">
      <D3Chart :renderChart="renderValueChart" :data="chartData" />
    </div>
    <div>
      <D3Chart :renderChart="renderWithdrawalChart" :data="chartData" />
    </div>
  </div>
</template>
