<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import * as d3 from 'd3'
import D3Chart from './D3Chart.vue'

const store = useCalculatorStore()
const { results, yearsLater, showDetailedStatistics } = storeToRefs(store)

// Combine data for reactivity tracking
const chartData = computed(() => ({
  results: results.value,
  yearsLater: yearsLater.value,
  showDetailedStatistics: showDetailedStatistics.value,
}))

interface DataSeries {
  label: string
  values: number[]
  median: number
  color: string
  firstYearMedian?: number
}

const drawChart = (
  svgElement: SVGSVGElement,
  containerElement: HTMLDivElement,
  series: DataSeries[],
  title: string,
  formatValue: (d: number) => string,
  tickCount: number = 4,
  rowHeight: number = 60,
  useLinearScale: boolean = false,
) => {
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

  // Get x extent across all series, filtering out invalid values
  const allValues = series
    .flatMap((s) => s.values)
    .filter((v) => isFinite(v) && (useLinearScale ? v >= 0 : v > 0))

  if (allValues.length === 0) return // No valid data to display

  const xExtent = d3.extent(allValues) as [number, number]

  // Create scale (linear or log)
  let xScale: any
  if (useLinearScale) {
    const xMin = Math.max(xExtent[0], 0)
    const xMax = xExtent[1]
    xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, width]).nice()
  } else {
    // Ensure positive values for log scale
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

    // Add label
    svg
      .append('text')
      .attr('x', -10)
      .attr('y', yPosition)
      .attr('text-anchor', 'end')
      .attr('alignment-baseline', 'middle')
      .style('font-size', '13px')
      .style('font-weight', '500')
      .text(s.label)

    // Draw histogram (filter out invalid values)
    const validValues = s.values.filter((v) => isFinite(v) && (useLinearScale ? v >= 0 : v > 0))

    if (validValues.length > 0) {
      const numBins = 100
      const xMin = d3.min(validValues)!
      const xMax = d3.max(validValues)!

      // Create bins (exponential for log scale, linear for linear scale)
      const binEdges: number[] = []
      if (useLinearScale) {
        for (let j = 0; j <= numBins; j++) {
          binEdges.push(xMin + (j / numBins) * (xMax - xMin))
        }
      } else {
        const logMin = Math.log(Math.max(xMin, 0.0001))
        const logMax = Math.log(xMax)
        for (let j = 0; j <= numBins; j++) {
          binEdges.push(Math.exp(logMin + (j / numBins) * (logMax - logMin)))
        }
      }

      // Count values in each bin
      const binCounts = new Array(numBins).fill(0)
      validValues.forEach((value) => {
        for (let b = 0; b < numBins; b++) {
          if (value >= binEdges[b]! && value < binEdges[b + 1]!) {
            binCounts[b]++
            break
          }
        }
      })

      const maxCount = d3.max(binCounts) ?? 1
      const histogramData = binCounts
        .map((count, binIndex) => ({ binIndex, count }))
        .filter((d) => d.count > 0)

      // Draw histogram rectangles
      const barHeight = 16
      svg
        .selectAll(`.hist-series-${i}`)
        .data(histogramData)
        .enter()
        .append('rect')
        .attr('class', `hist-series-${i}`)
        .attr('x', (d) => xScale(binEdges[d.binIndex]!))
        .attr('y', yPosition - barHeight / 2)
        .attr('width', (d) =>
          Math.max(1, xScale(binEdges[d.binIndex + 1]!) - xScale(binEdges[d.binIndex]!)),
        )
        .attr('height', barHeight)
        .attr('fill', s.color)
        .attr('opacity', (d) => 0.1 + (d.count / maxCount) * 0.5)
    }

    // Draw median line (last year) - only if valid
    if (isFinite(s.median) && (useLinearScale ? s.median >= 0 : s.median > 0)) {
      svg
        .append('line')
        .attr('x1', xScale(s.median))
        .attr('x2', xScale(s.median))
        .attr('y1', yPosition - 16)
        .attr('y2', yPosition + 16)
        .attr('stroke', s.color)
        .attr('stroke-width', 3)

      // Draw median label (last year)
      svg
        .append('text')
        .attr('x', xScale(s.median))
        .attr('y', yPosition - 25)
        .attr('text-anchor', 'middle')
        .style('font-size', '11px')
        .style('font-weight', 'bold')
        .style('fill', s.color)
        .text(formatValue(s.median))
    }

    // Draw first year median line if provided (dashed) - only if valid
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
        .attr('stroke-dasharray', '5,5')
        .attr('opacity', 0.7)

      // Draw first year median label
      svg
        .append('text')
        .attr('x', xScale(s.firstYearMedian))
        .attr('y', yPosition + 35)
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .style('font-style', 'italic')
        .style('fill', s.color)
        .text(formatValue(s.firstYearMedian))
    }
  })
}

// Helper functions for building series data
const getSummaries = () => results.value.map((r) => r.summary)
const getScenarioNames = () => Object.keys(getSummaries()[0]?.scenarios ?? {})
const colors = ['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']

const buildSeries = (field: string) => {
  const summaries = getSummaries()
  const scenarioNames = getScenarioNames()
  return scenarioNames.map((name, i) => {
    const values = summaries.map((s) => (s.scenarios[name] as any)?.[field] ?? 0)
    return {
      label: name,
      values,
      median: d3.median(values) ?? 0,
      color: colors[i % colors.length]!,
    }
  })
}

// Individual render functions for each chart
const renderLiquidValueChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  const summaries = getSummaries()
  const scenarioNames = getScenarioNames()
  const liquidValueSeries = scenarioNames.map((name, i) => {
    const lastYearValues = summaries.map((s) => s.scenarios[name]?.liquidValue ?? 0)
    const firstYearValues = summaries.map((s) => s.scenarios[name]?.firstYearLiquidValue ?? 0)
    return {
      label: name,
      values: lastYearValues,
      median: d3.median(lastYearValues) ?? 0,
      firstYearMedian: d3.median(firstYearValues) ?? 0,
      color: colors[i % colors.length]!,
    }
  })
  drawChart(
    svg,
    container,
    liquidValueSeries,
    'Likvidvärde',
    (d) => d3.format(',.0f')(d) + ' kr',
    4,
    90,
  )
}

const renderWithdrawalChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  const summaries = getSummaries()
  const scenarioNames = getScenarioNames()
  const withdrawalSeries = scenarioNames.map((name, i) => {
    const realValues = summaries.map((s) => s.scenarios[name]?.realWithdrawal ?? 0)
    const firstYearValues = summaries.map((s) => s.scenarios[name]?.firstYearWithdrawal ?? 0)
    return {
      label: name,
      values: realValues,
      median: d3.median(realValues) ?? 0,
      firstYearMedian: d3.median(firstYearValues) ?? 0,
      color: colors[i % colors.length]!,
    }
  })
  drawChart(
    svg,
    container,
    withdrawalSeries,
    'Uttag reellt (sista året)',
    (d) => d3.format(',.0f')(d) + ' kr',
    4,
    90,
  )
}

const renderAccumulatedWithdrawalChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  const summaries = getSummaries()
  const scenarioNames = getScenarioNames()
  const years = yearsLater.value
  const avgWithdrawalSeries = scenarioNames.map((name, i) => {
    const values = summaries.map((s) => (s.scenarios[name]?.accumulatedRealWithdrawal ?? 0) / years)
    const firstYearValues = summaries.map((s) => s.scenarios[name]?.firstYearWithdrawal ?? 0)
    return {
      label: name,
      values,
      median: d3.median(values) ?? 0,
      firstYearMedian: d3.median(firstYearValues) ?? 0,
      color: colors[i % colors.length]!,
    }
  })
  drawChart(
    svg,
    container,
    avgWithdrawalSeries,
    'Genomsnittligt uttag reellt per år',
    (d) => d3.format(',.0f')(d) + ' kr',
    3,
    90,
  )
}

const renderMaxDrawdownChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  drawChart(
    svg,
    container,
    buildSeries('maxDrawdown'),
    'Maximalt drawdown',
    (d) => d3.format('.1%')(d),
    3,
    60,
    true,
  )
}

const renderMaxDrawdownPeriodChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  drawChart(
    svg,
    container,
    buildSeries('maxDrawdownPeriod'),
    'Längsta drawdown-period',
    (d) => d3.format('.0f')(d) + ' år',
    3,
    60,
    true,
  )
}

const renderPaidTaxChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  drawChart(
    svg,
    container,
    buildSeries('paidTax'),
    'Betald skatt',
    (d) => d3.format(',.0f')(d) + ' kr',
  )
}

const renderTaxationDegreeChart = (svg: SVGSVGElement, container: HTMLDivElement) => {
  if (!results.value.length) return
  drawChart(
    svg,
    container,
    buildSeries('taxationDegree'),
    'Beskattningsgrad',
    (d) => d3.format('.1%')(d),
    3,
  )
}
</script>

<template>
  <div v-if="results.length > 0">
    <p class="text-muted mb-3">
      Histogram som visar fördelningen av resultat över alla simuleringar (intensitet visar täthet).
      Heldragna linjer visar medianvärden för sista året, streckade linjer visar första året.
    </p>

    <!-- Liquid Value -->
    <div class="mb-4">
      <D3Chart :renderChart="renderLiquidValueChart" :data="chartData" />
    </div>

    <!-- Withdrawal (Last and First Year) -->
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
