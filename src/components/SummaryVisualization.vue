<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { ref, watch, onMounted, nextTick } from 'vue'
import * as d3 from 'd3'

const store = useCalculatorStore()
const { results, yearsLater } = storeToRefs(store)

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

  // Get x extent across all series
  const allValues = series.flatMap((s) => s.values)
  const xExtent = d3.extent(allValues) as [number, number]

  // Ensure positive values for log scale
  const xMin = Math.max(xExtent[0], 0.0001)
  const xMax = xExtent[1]

  // Create log scale
  const xScale = d3.scaleLog().domain([xMin, xMax]).range([0, width]).nice()

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

    // Draw dots
    svg
      .selectAll(`.dot-series-${i}`)
      .data(s.values)
      .enter()
      .append('circle')
      .attr('class', `dot-series-${i}`)
      .attr('cx', (d) => xScale(d))
      .attr('cy', yPosition)
      .attr('r', 2)
      .attr('fill', s.color)
      .attr('opacity', 0.1)

    // Draw median line (last year)
    svg
      .append('line')
      .attr('x1', xScale(s.median))
      .attr('x2', xScale(s.median))
      .attr('y1', yPosition - 20)
      .attr('y2', yPosition + 20)
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

    // Draw first year median line if provided (dashed)
    if (s.firstYearMedian !== undefined) {
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
  if (!paidTaxSvgRef.value || !paidTaxContainerRef.value) return
  if (!taxationDegreeSvgRef.value || !taxationDegreeContainerRef.value) return
  if (!withdrawalSvgRef.value || !withdrawalContainerRef.value) return
  if (!accumulatedWithdrawalSvgRef.value || !accumulatedWithdrawalContainerRef.value) return

  // Extract data from results
  const summaries = results.value.map((r) => r.summary)

  // Liquid Value
  const liquidValueISK = summaries.map((s) => s.liquidValueISK)
  const liquidValueVP = summaries.map((s) => s.liquidValueVP)
  const liquidValueMedianISK = d3.median(liquidValueISK) ?? 0
  const liquidValueMedianVP = d3.median(liquidValueVP) ?? 0

  drawChart(
    liquidValueSvgRef.value,
    liquidValueContainerRef.value,
    [
      { label: 'ISK', values: liquidValueISK, median: liquidValueMedianISK, color: '#0d6efd' },
      { label: 'VP', values: liquidValueVP, median: liquidValueMedianVP, color: '#dc3545' },
    ],
    'Likvidvärde',
    (d) => d3.format(',.0f')(d) + ' kr',
  )

  // Paid Tax
  const paidTaxISK = summaries.map((s) => s.paidTaxISK)
  const paidTaxVP = summaries.map((s) => s.paidTaxVP)
  const paidTaxMedianISK = d3.median(paidTaxISK) ?? 0
  const paidTaxMedianVP = d3.median(paidTaxVP) ?? 0

  drawChart(
    paidTaxSvgRef.value,
    paidTaxContainerRef.value,
    [
      { label: 'ISK', values: paidTaxISK, median: paidTaxMedianISK, color: '#0d6efd' },
      { label: 'VP', values: paidTaxVP, median: paidTaxMedianVP, color: '#dc3545' },
    ],
    'Betald skatt',
    (d) => d3.format(',.0f')(d) + ' kr',
  )

  // Taxation Degree
  const taxationDegreeISK = summaries.map((s) => s.taxationDegreeISK)
  const taxationDegreeVP = summaries.map((s) => s.taxationDegreeVP)
  const taxationDegreeMedianISK = d3.median(taxationDegreeISK) ?? 0
  const taxationDegreeMedianVP = d3.median(taxationDegreeVP) ?? 0

  drawChart(
    taxationDegreeSvgRef.value,
    taxationDegreeContainerRef.value,
    [
      {
        label: 'ISK',
        values: taxationDegreeISK,
        median: taxationDegreeMedianISK,
        color: '#0d6efd',
      },
      { label: 'VP', values: taxationDegreeVP, median: taxationDegreeMedianVP, color: '#dc3545' },
    ],
    'Beskattningsgrad',
    (d) => d3.format('.1%')(d),
  )

  // Withdrawals (Real) - Last Year and First Year
  const realWithdrawalISK = summaries.map((s) => s.realWithdrawalISK)
  const realWithdrawalVP = summaries.map((s) => s.realWithdrawalVP)
  const realWithdrawalMedianISK = d3.median(realWithdrawalISK) ?? 0
  const realWithdrawalMedianVP = d3.median(realWithdrawalVP) ?? 0

  const firstYearWithdrawalISK = summaries.map((s) => s.firstYearWithdrawalISK)
  const firstYearWithdrawalVP = summaries.map((s) => s.firstYearWithdrawalVP)
  const firstYearWithdrawalMedianISK = d3.median(firstYearWithdrawalISK) ?? 0
  const firstYearWithdrawalMedianVP = d3.median(firstYearWithdrawalVP) ?? 0

  drawChart(
    withdrawalSvgRef.value,
    withdrawalContainerRef.value,
    [
      {
        label: 'ISK',
        values: realWithdrawalISK,
        median: realWithdrawalMedianISK,
        firstYearMedian: firstYearWithdrawalMedianISK,
        color: '#0d6efd',
      },
      {
        label: 'VP',
        values: realWithdrawalVP,
        median: realWithdrawalMedianVP,
        firstYearMedian: firstYearWithdrawalMedianVP,
        color: '#dc3545',
      },
    ],
    'Uttag reellt (sista året)',
    (d) => d3.format(',.0f')(d) + ' kr',
    4, // tick count
    90, // Increased row height to fit first year labels
  )

  // Average Annual Real Withdrawal
  const years = yearsLater.value
  const averageAnnualWithdrawalISK = summaries.map((s) => s.accumulatedRealWithdrawalISK / years)
  const averageAnnualWithdrawalVP = summaries.map((s) => s.accumulatedRealWithdrawalVP / years)
  const averageAnnualWithdrawalMedianISK = d3.median(averageAnnualWithdrawalISK) ?? 0
  const averageAnnualWithdrawalMedianVP = d3.median(averageAnnualWithdrawalVP) ?? 0

  drawChart(
    accumulatedWithdrawalSvgRef.value,
    accumulatedWithdrawalContainerRef.value,
    [
      {
        label: 'ISK',
        values: averageAnnualWithdrawalISK,
        median: averageAnnualWithdrawalMedianISK,
        color: '#0d6efd',
      },
      {
        label: 'VP',
        values: averageAnnualWithdrawalVP,
        median: averageAnnualWithdrawalMedianVP,
        color: '#dc3545',
      },
    ],
    'Genomsnittligt uttag reellt per år',
    (d) => d3.format(',.0f')(d) + ' kr',
    3, // Fewer ticks for this chart with narrower range
  )
}

// Watch for data changes
watch(results, async () => {
  await nextTick()
  drawAllCharts()
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
  <div class="card mb-4" v-if="results.length > 0">
    <div class="card-header">
      <h3>Visualisering av resultat</h3>
      <p class="mb-0 text-muted">
        Punktdiagram som visar fördelningen av resultat över alla simuleringar. Heldragna linjer
        visar medianvärden för sista året, streckade linjer visar första året.
      </p>
    </div>
    <div class="card-body">
      <!-- Liquid Value -->
      <div ref="liquidValueContainerRef" class="chart-container mb-4">
        <svg ref="liquidValueSvgRef"></svg>
      </div>

      <!-- Paid Tax -->
      <div ref="paidTaxContainerRef" class="chart-container mb-4">
        <svg ref="paidTaxSvgRef"></svg>
      </div>

      <!-- Taxation Degree -->
      <div ref="taxationDegreeContainerRef" class="chart-container mb-4">
        <svg ref="taxationDegreeSvgRef"></svg>
      </div>

      <!-- Withdrawal (Last and First Year) -->
      <div ref="withdrawalContainerRef" class="chart-container mb-4">
        <svg ref="withdrawalSvgRef"></svg>
      </div>

      <!-- Accumulated Withdrawal -->
      <div ref="accumulatedWithdrawalContainerRef" class="chart-container">
        <svg ref="accumulatedWithdrawalSvgRef"></svg>
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
