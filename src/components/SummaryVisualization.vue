<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, watch, onMounted, nextTick } from 'vue'
import * as d3 from 'd3'

const store = useCalculatorStore()
const { results, yearsLater, showDetailedStatistics } = storeToRefs(store)

const liquidValueSvgRef = ref<SVGSVGElement | null>(null)
const liquidValueContainerRef = ref<HTMLDivElement | null>(null)
const paidTaxSvgRef = ref<SVGSVGElement | null>(null)
const paidTaxContainerRef = ref<HTMLDivElement | null>(null)
const taxationDegreeSvgRef = ref<SVGSVGElement | null>(null)
const taxationDegreeContainerRef = ref<HTMLDivElement | null>(null)
const withdrawalSvgRef = ref<SVGSVGElement | null>(null)
const withdrawalContainerRef = ref<HTMLDivElement | null>(null)
const accumulatedWithdrawalSvgRef = ref<SVGSVGElement | null>(null)
const accumulatedWithdrawalContainerRef = ref<HTMLDivElement | null>(null)
const maxDrawdownSvgRef = ref<SVGSVGElement | null>(null)
const maxDrawdownContainerRef = ref<HTMLDivElement | null>(null)
const maxDrawdownPeriodSvgRef = ref<SVGSVGElement | null>(null)
const maxDrawdownPeriodContainerRef = ref<HTMLDivElement | null>(null)

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

const drawAllCharts = () => {
  if (!results.value.length) return
  if (!liquidValueSvgRef.value || !liquidValueContainerRef.value) return
  if (!withdrawalSvgRef.value || !withdrawalContainerRef.value) return
  if (!accumulatedWithdrawalSvgRef.value || !accumulatedWithdrawalContainerRef.value) return
  if (!maxDrawdownSvgRef.value || !maxDrawdownContainerRef.value) return

  // Extract data from results
  const summaries = results.value.map((r) => r.summary)

  // Get scenario names from first summary
  const scenarioNames = Object.keys(summaries[0]?.scenarios ?? {})
  const colors = ['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']

  // Helper to build series for a field
  const buildSeries = (field: string) => {
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

  // Liquid Value - Last Year and First Year
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
    liquidValueSvgRef.value,
    liquidValueContainerRef.value,
    liquidValueSeries,
    'Likvidvärde',
    (d) => d3.format(',.0f')(d) + ' kr',
    4, // tick count
    90, // Increased row height to fit first year labels
  )

  // Withdrawals (Real) - Last Year and First Year
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
    withdrawalSvgRef.value,
    withdrawalContainerRef.value,
    withdrawalSeries,
    'Uttag reellt (sista året)',
    (d) => d3.format(',.0f')(d) + ' kr',
    4, // tick count
    90, // Increased row height to fit first year labels
  )

  // Average Annual Real Withdrawal
  const years = yearsLater.value
  const avgWithdrawalSeries = scenarioNames.map((name, i) => {
    const values = summaries.map((s) => (s.scenarios[name]?.accumulatedRealWithdrawal ?? 0) / years)
    return {
      label: name,
      values,
      median: d3.median(values) ?? 0,
      color: colors[i % colors.length]!,
    }
  })

  drawChart(
    accumulatedWithdrawalSvgRef.value,
    accumulatedWithdrawalContainerRef.value,
    avgWithdrawalSeries,
    'Genomsnittligt uttag reellt per år',
    (d) => d3.format(',.0f')(d) + ' kr',
    3, // Fewer ticks for this chart with narrower range
  )

  // Max Drawdown
  drawChart(
    maxDrawdownSvgRef.value,
    maxDrawdownContainerRef.value,
    buildSeries('maxDrawdown'),
    'Maximalt drawdown',
    (d) => d3.format('.1%')(d),
    3,
    60,
    true, // Use linear scale
  )

  if (maxDrawdownPeriodSvgRef.value && maxDrawdownPeriodContainerRef.value) {
    // Max Drawdown Period
    drawChart(
      maxDrawdownPeriodSvgRef.value,
      maxDrawdownPeriodContainerRef.value,
      buildSeries('maxDrawdownPeriod'),
      'Längsta drawdown-period',
      (d) => d3.format('.0f')(d) + ' år',
      3,
      60,
      true, // Use linear scale
    )
  }

  if (paidTaxSvgRef.value && paidTaxContainerRef.value) {
    // Paid Tax
    drawChart(
      paidTaxSvgRef.value,
      paidTaxContainerRef.value,
      buildSeries('paidTax'),
      'Betald skatt',
      (d) => d3.format(',.0f')(d) + ' kr',
    )
  }
  if (taxationDegreeSvgRef.value && taxationDegreeContainerRef.value) {
    // Taxation Degree
    drawChart(
      taxationDegreeSvgRef.value,
      taxationDegreeContainerRef.value,
      buildSeries('taxationDegree'),
      'Beskattningsgrad',
      (d) => d3.format('.1%')(d),
      3, // Fewer ticks for percentage scale
    )
  }
}

// Watch for data changes
watch([results, showDetailedStatistics], async () => {
  await nextTick()
  console.log('drawall2', results.value.length)
  drawAllCharts()
})

// Redraw on window resize
onMounted(() => {
  const handleResize = () => {
    drawAllCharts()
  }
  window.addEventListener('resize', handleResize)

  // Initial draw
  console.log('drawall', results.value.length)
  nextTick(() => drawAllCharts())

  return () => {
    window.removeEventListener('resize', handleResize)
  }
})
</script>

<template>
  <div class="card mb-4" v-if="results.length > 0">
    <div class="card-header">
      <h3>Visualisering av resultat</h3>
      <p class="mb-0 text-muted">
        Histogram som visar fördelningen av resultat över alla simuleringar (intensitet visar
        täthet). Heldragna linjer visar medianvärden för sista året, streckade linjer visar första
        året.
      </p>
    </div>
    <div class="card-body">
      <!-- Liquid Value -->
      <div ref="liquidValueContainerRef" class="chart-container mb-4">
        <svg ref="liquidValueSvgRef"></svg>
      </div>

      <!-- Withdrawal (Last and First Year) -->
      <div ref="withdrawalContainerRef" class="chart-container mb-4">
        <svg ref="withdrawalSvgRef"></svg>
      </div>

      <!-- Accumulated Withdrawal -->
      <div ref="accumulatedWithdrawalContainerRef" class="chart-container mb-4">
        <svg ref="accumulatedWithdrawalSvgRef"></svg>
      </div>

      <!-- Max Drawdown -->
      <div ref="maxDrawdownContainerRef" class="chart-container mb-4">
        <svg ref="maxDrawdownSvgRef"></svg>
      </div>

      <!-- Max Drawdown Period -->
      <div
        v-if="showDetailedStatistics"
        ref="maxDrawdownPeriodContainerRef"
        class="chart-container"
      >
        <svg ref="maxDrawdownPeriodSvgRef"></svg>
      </div>

      <!-- Paid Tax -->
      <div v-if="showDetailedStatistics" ref="paidTaxContainerRef" class="chart-container mb-4">
        <svg ref="paidTaxSvgRef"></svg>
      </div>

      <!-- Taxation Degree -->
      <div
        v-if="showDetailedStatistics"
        ref="taxationDegreeContainerRef"
        class="chart-container mb-4"
      >
        <svg ref="taxationDegreeSvgRef"></svg>
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
}
</style>
