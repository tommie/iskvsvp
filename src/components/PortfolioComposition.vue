<script setup lang="ts">
import * as d3 from 'd3'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useCalculatorStore } from '../stores/calculator'
import type { FinalAssetWeights } from '../types'
import D3Chart from './D3Chart.vue'

const store = useCalculatorStore()
const { simulationResults, assetRebalanceFrequency } = storeToRefs(store)

const COLORS = ['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']

// Check if rebalancing is disabled (composition drift is meaningful)
const showComposition = computed(() => assetRebalanceFrequency.value === 'never')

// Check if there are multiple assets
const hasMultipleAssets = computed(() => {
  if (!simulationResults.value?.finalAssetWeights?.[0]) return false
  return simulationResults.value.finalAssetWeights[0].assetNames.length > 1
})

// Combine data for reactivity tracking
const chartData = computed(() => ({
  simulationResults: simulationResults.value,
  assetRebalanceFrequency: assetRebalanceFrequency.value,
}))

const drawBoxPlotChart = (svgElement: SVGSVGElement, containerElement: HTMLDivElement) => {
  if (!simulationResults.value?.finalAssetWeights) return

  const finalWeights = simulationResults.value.finalAssetWeights
  const labels = simulationResults.value.labels

  // Clear previous chart
  d3.select(svgElement).selectAll('*').remove()

  // Get container dimensions
  const containerWidth = containerElement.clientWidth
  const margin = { top: 40, right: 30, bottom: 60, left: 120 }

  // Calculate height based on number of scenarios and assets
  const numScenarios = finalWeights.length
  const numAssets = finalWeights[0]?.assetNames.length ?? 0
  const boxHeight = 25
  const scenarioGap = 20
  const assetGap = 8
  const scenarioHeight = numAssets * (boxHeight + assetGap) - assetGap + scenarioGap
  const height = numScenarios * scenarioHeight + margin.top + margin.bottom - scenarioGap

  const svg = d3
    .select(svgElement)
    .attr('width', containerWidth)
    .attr('height', height)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  const width = containerWidth - margin.left - margin.right

  // X scale (weight percentage 0-100%)
  const xScale = d3.scaleLinear().domain([0, 1]).range([0, width])

  // Add X axis
  svg
    .append('g')
    .attr('transform', `translate(0,${height - margin.top - margin.bottom})`)
    .call(
      d3
        .axisBottom(xScale)
        .ticks(5)
        .tickFormat((d) => d3.format('.0%')(d as number)),
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
    .text('Slutlig portföljsammansättning')

  // Draw box plots for each scenario
  finalWeights.forEach((scenarioWeights: FinalAssetWeights, scenarioIdx: number) => {
    const scenarioY = scenarioIdx * scenarioHeight
    const scenarioColor = COLORS[scenarioIdx % COLORS.length]!

    // Scenario label
    svg
      .append('text')
      .attr('x', -10)
      .attr('y', scenarioY + scenarioHeight / 2 - scenarioGap / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .style('font-size', '14px')
      .style('font-weight', 'bold')
      .style('fill', scenarioColor)
      .text(labels[scenarioIdx] ?? `Scenario ${scenarioIdx + 1}`)

    // Draw box plot for each asset
    scenarioWeights.weights.forEach((stats, assetIdx) => {
      const assetY = scenarioY + assetIdx * (boxHeight + assetGap)
      const assetName = scenarioWeights.assetNames[assetIdx] ?? `Asset ${assetIdx + 1}`

      // Background for asset name (truncated if needed)
      const displayName = assetName.length > 12 ? assetName.slice(0, 12) + '...' : assetName

      // Asset label (inside the chart area)
      svg
        .append('text')
        .attr('x', 5)
        .attr('y', assetY + boxHeight / 2)
        .attr('dominant-baseline', 'middle')
        .style('font-size', '11px')
        .style('fill', '#666')
        .text(displayName)

      // Whiskers (p10 to p90)
      svg
        .append('line')
        .attr('x1', xScale(stats.percentile10))
        .attr('x2', xScale(stats.percentile90))
        .attr('y1', assetY + boxHeight / 2)
        .attr('y2', assetY + boxHeight / 2)
        .attr('stroke', scenarioColor)
        .attr('stroke-width', 1)

      // Left whisker cap (p10)
      svg
        .append('line')
        .attr('x1', xScale(stats.percentile10))
        .attr('x2', xScale(stats.percentile10))
        .attr('y1', assetY + boxHeight * 0.3)
        .attr('y2', assetY + boxHeight * 0.7)
        .attr('stroke', scenarioColor)
        .attr('stroke-width', 1)

      // Right whisker cap (p90)
      svg
        .append('line')
        .attr('x1', xScale(stats.percentile90))
        .attr('x2', xScale(stats.percentile90))
        .attr('y1', assetY + boxHeight * 0.3)
        .attr('y2', assetY + boxHeight * 0.7)
        .attr('stroke', scenarioColor)
        .attr('stroke-width', 1)

      // Box around median (visual representation)
      svg
        .append('rect')
        .attr('x', xScale(stats.median) - 3)
        .attr('y', assetY + boxHeight * 0.15)
        .attr('width', 6)
        .attr('height', boxHeight * 0.7)
        .attr('fill', scenarioColor)
        .attr('fill-opacity', 0.3)
        .attr('stroke', scenarioColor)
        .attr('stroke-width', 1.5)

      // Median line
      svg
        .append('line')
        .attr('x1', xScale(stats.median))
        .attr('x2', xScale(stats.median))
        .attr('y1', assetY + boxHeight * 0.15)
        .attr('y2', assetY + boxHeight * 0.85)
        .attr('stroke', scenarioColor)
        .attr('stroke-width', 2)

      // Median value label
      svg
        .append('text')
        .attr('x', xScale(stats.median))
        .attr('y', assetY - 2)
        .attr('text-anchor', 'middle')
        .style('font-size', '10px')
        .style('fill', scenarioColor)
        .text(d3.format('.1%')(stats.median))
    })

    // Add separator line between scenarios (except after the last one)
    if (scenarioIdx < finalWeights.length - 1) {
      svg
        .append('line')
        .attr('x1', 0)
        .attr('x2', width)
        .attr('y1', scenarioY + scenarioHeight - scenarioGap / 2)
        .attr('y2', scenarioY + scenarioHeight - scenarioGap / 2)
        .attr('stroke', 'var(--bs-border-color)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
    }
  })
}
</script>

<template>
  <div v-if="simulationResults">
    <div v-if="!showComposition" class="alert alert-info">
      <strong>Notera:</strong> Portföljsammansättningen visas endast när ombalansering är
      inaktiverad. Med årlig ombalansering behålls ursprungliga vikter.
    </div>

    <div v-else-if="!hasMultipleAssets" class="alert alert-info">
      <strong>Notera:</strong> Portföljsammansättningen visas endast när det finns flera tillgångar
      i portföljen.
    </div>

    <div v-else>
      <p class="text-muted mb-3">
        Fördelningen av slutliga tillgångsvikter. Linjen visar medianen, morrhår visar 10:e-90:e
        percentilen.
      </p>

      <div class="mb-4">
        <D3Chart :renderChart="drawBoxPlotChart" :data="chartData" />
      </div>
    </div>
  </div>
</template>
