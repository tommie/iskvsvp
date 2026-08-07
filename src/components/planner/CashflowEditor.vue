<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import * as d3 from 'd3'
import { storeToRefs } from 'pinia'

import { usePlannerStore } from '../../stores/planner'
import D3Chart from '../D3Chart.vue'
import { formatCadences } from '../../planner/cadence'
import { formatKrExact } from '../../planner/format'

const store = usePlannerStore()
const { cashflow, startAge } = storeToRefs(store)

const FLOOR_COLOR = '#0d6efd'
const OPTIONAL_COLOR = '#9ec5fe'
const DEPOSIT_COLOR = '#198754'
const CHART_HEIGHT = 260

// The selection always covers at least one year. It stays put when focus moves
// elsewhere: the Behov and Extra fields write to whatever it covers, so
// clearing it on blur would leave those fields with nothing to act on.
const selection = ref({ from: 0, to: 0 })
const dragging = ref(false)

const kronor = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 })

const selectionLabel = computed(() => {
  const { from, to } = selection.value
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const ageLo = startAge.value + lo
  const ageHi = startAge.value + hi
  if (lo === hi) return `År ${lo + 1} (ålder ${ageLo})`
  return `År ${lo + 1}–${hi + 1} (ålder ${ageLo}–${ageHi})`
})

// The inputs show the first selected year's values. Editing one applies it to
// the whole selection, which is what makes "lower the floor from year 7
// onwards" a two-click operation rather than thirty edits.
const editedFloor = ref(0)
const editedOptional = ref(0)

watch(
  [selection, cashflow],
  () => {
    const entry = cashflow.value[Math.min(selection.value.from, selection.value.to)]
    if (!entry) return
    editedFloor.value = entry.floor
    editedOptional.value = entry.optional
  },
  { immediate: true, deep: true },
)

function applyToSelection(values: { floor?: number; optional?: number }) {
  store.setCashflowRange(selection.value.from, selection.value.to, values)
}

/**
 * Selects every year in the schedule.
 *
 * With the fields writing to whatever is selected, this is what "set every year
 * at once" means: select all, then type an amount. It sits by the chart because
 * it is a selection like any other, just one that is tedious to drag.
 */
function selectAll() {
  selection.value = { from: 0, to: cashflow.value.length - 1 }
}

/**
 * What the selected years actually pay out: floor plus optional.
 *
 * The two fields are entered separately because the plan treats them
 * differently, but nobody budgets in two halves — the figure to hold against a
 * household's outgoings is their sum, in the same cadences.
 */
const editedTotal = computed(() => editedFloor.value + editedOptional.value)

const chartData = computed(() => ({
  cashflow: cashflow.value,
  selection: selection.value,
  startAge: startAge.value,
}))

const renderChart = (svgEl: SVGSVGElement, container: HTMLDivElement) => {
  const width = Math.max(320, container.clientWidth)
  const height = CHART_HEIGHT
  // The top margin holds the selection bracket, which is drawn above the plot
  // area so it can never collide with a tall bar.
  const margin = { top: 26, right: 12, bottom: 36, left: 78 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  const entries = cashflow.value
  const svg = d3.select(svgEl)
  svg.selectAll('*').remove()
  svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)

  const plot = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const x = d3
    .scaleBand<number>()
    .domain(entries.map((_, index) => index))
    .range([0, innerWidth])
    .padding(0.15)

  // The domain always includes zero so deposits and withdrawals share a
  // baseline and can be told apart at a glance.
  const totals = entries.map((entry) => entry.floor + entry.optional)
  const low = Math.min(0, d3.min(entries, (entry) => entry.floor) ?? 0)
  const high = Math.max(0, d3.max(totals) ?? 0)
  const y = d3
    .scaleLinear()
    .domain([low, high === low ? low + 1 : high])
    .nice()
    .range([innerHeight, 0])

  plot
    .append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(entries.map((_, index) => index).filter((index) => index % 5 === 0))
        .tickFormat((index) => String(startAge.value + Number(index))),
    )

  plot.append('g').call(
    d3
      .axisLeft(y)
      .ticks(6)
      .tickFormat((value) => kronor.format(Number(value) / 1000) + 'k'),
  )

  plot
    .append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', y(0))
    .attr('y2', y(0))
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.4)

  // Selection bracket above the plot, with end ticks pointing down at the
  // years it covers.
  const lo = Math.min(selection.value.from, selection.value.to)
  const hi = Math.max(selection.value.from, selection.value.to)
  const bracketPadding = x.step() * x.padding() * 0.5
  const selectionStart = (x(lo) ?? 0) - bracketPadding
  const selectionEnd = (x(hi) ?? 0) + x.bandwidth() + bracketPadding
  const bracketY = -14
  const tickLength = 6

  plot
    .append('path')
    .attr(
      'd',
      `M${selectionStart},${bracketY + tickLength}` +
        `L${selectionStart},${bracketY}` +
        `L${selectionEnd},${bracketY}` +
        `L${selectionEnd},${bracketY + tickLength}`,
    )
    .attr('fill', 'none')
    .attr('stroke', 'currentColor')
    .attr('stroke-width', 1.5)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round')

  // Floor bars. Deposits go downwards from the baseline in their own colour.
  plot
    .append('g')
    .selectAll('rect')
    .data(entries)
    .join('rect')
    .attr('x', (_, index) => x(index) ?? 0)
    .attr('width', x.bandwidth())
    .attr('y', (entry) => y(Math.max(0, entry.floor)))
    .attr('height', (entry) => Math.abs(y(entry.floor) - y(0)))
    .attr('fill', (entry) => (entry.floor < 0 ? DEPOSIT_COLOR : FLOOR_COLOR))

  // Optional top-up, stacked from the floor upwards.
  plot
    .append('g')
    .selectAll('rect')
    .data(entries)
    .join('rect')
    .attr('x', (_, index) => x(index) ?? 0)
    .attr('width', x.bandwidth())
    .attr('y', (entry) => y(entry.floor + entry.optional))
    .attr('height', (entry) => Math.abs(y(entry.floor + entry.optional) - y(entry.floor)))
    .attr('fill', OPTIONAL_COLOR)

  const yearAt = (event: MouseEvent): number => {
    const [pointerX] = d3.pointer(event, plot.node())
    const index = Math.floor(pointerX / (innerWidth / entries.length))
    return Math.max(0, Math.min(entries.length - 1, index))
  }

  plot
    .append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .style('cursor', 'pointer')
    .on('mousedown', (event: MouseEvent) => {
      event.preventDefault()
      const year = yearAt(event)
      // Shift-click extends the current selection instead of replacing it, so
      // a long span can be picked without dragging across the whole chart.
      if (event.shiftKey) {
        selection.value = { from: selection.value.from, to: year }
      } else {
        selection.value = { from: year, to: year }
        dragging.value = true
      }
    })
    .on('mousemove', (event: MouseEvent) => {
      if (!dragging.value) return
      const year = yearAt(event)
      if (year !== selection.value.to) {
        selection.value = { from: selection.value.from, to: year }
      }
    })
}

function stopDragging() {
  dragging.value = false
}
</script>

<template>
  <div class="card mb-3">
    <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
      <span>Uttag och insättningar per år (dagens penningvärde)</span>
      <div class="d-flex align-items-center gap-3">
        <small class="text-muted"
          >Klicka, dra eller skift-klicka i diagrammet för att välja år</small
        >
        <button type="button" class="btn btn-outline-secondary btn-sm" @click="selectAll">
          Välj alla år
        </button>
      </div>
    </div>
    <div class="card-body">
      <!--
        The fields sit beside the chart, in one column, because they read as a
        panel for whatever the chart has selected: click a span, then work down
        Behov, Extra, Totalt. Below lg the column drops under the chart and
        keeps its stacking — the chart needs the full width more than the fields
        need to be adjacent, and a narrow screen cannot give both.

        Centred, because the field column is the taller of the two: aligned to
        the top, the chart would hang from the first label with its baseline
        floating above nothing.
      -->
      <div class="row g-3 align-items-center">
        <div class="col-12 col-lg-9">
          <div @mouseup="stopDragging" @mouseleave="stopDragging">
            <D3Chart :render-chart="renderChart" :data="chartData" />
          </div>

          <div class="d-flex flex-wrap gap-3 align-items-center small text-muted mt-2">
            <span
              ><span class="swatch" :style="{ background: FLOOR_COLOR }"></span> Behov (uttag)</span
            >
            <span><span class="swatch" :style="{ background: OPTIONAL_COLOR }"></span> Extra</span>
            <span
              ><span class="swatch" :style="{ background: DEPOSIT_COLOR }"></span> Insättning</span
            >
          </div>
        </div>

        <div class="col-12 col-lg-3 d-flex flex-column gap-3">
          <div>
            <label class="form-label mb-1">Markering</label>
            <div class="form-control-plaintext field-aligned py-0">{{ selectionLabel }}</div>
          </div>

          <div>
            <label class="form-label" for="cashflow-floor">Behov (kr/år)</label>
            <input
              id="cashflow-floor"
              v-model.number="editedFloor"
              type="number"
              step="10000"
              class="form-control"
              @change="applyToSelection({ floor: editedFloor })"
            />
            <div class="form-text">{{ formatCadences(editedFloor) }}</div>
          </div>

          <div>
            <label class="form-label" for="cashflow-optional">Extra (kr/år)</label>
            <input
              id="cashflow-optional"
              v-model.number="editedOptional"
              type="number"
              step="10000"
              min="0"
              class="form-control"
              @change="applyToSelection({ optional: editedOptional })"
            />
            <div class="form-text">{{ formatCadences(editedOptional) }}</div>
          </div>

          <div>
            <label class="form-label">Totalt uttag (kr/år)</label>
            <div class="form-control-plaintext field-aligned">
              {{ formatKrExact(editedTotal) }}
            </div>
            <div class="form-text">{{ formatCadences(editedTotal) }}</div>
          </div>
        </div>
      </div>

      <p class="form-text mt-3 mb-0">
        Beloppen är disponibla — det är detta du får ut. Skatten dras separat ur portföljen och
        minskar inte uttaget.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Read-only values in the field column start on the same left edge as the text
   inside the inputs above them, so the column reads as one list of figures.
   Bootstrap's plaintext control drops both the horizontal padding and the side
   borders that a .form-control has, so it needs the sum of the two back.

   0.75rem is $input-padding-x restated: Bootstrap 5.3 converted components like
   buttons and cards to custom properties but not forms, so .form-control still
   compiles that padding to a literal and there is no variable to read. */
.field-aligned {
  padding-left: calc(0.75rem + var(--bs-border-width));
}

.swatch {
  display: inline-block;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 2px;
  vertical-align: -1px;
  margin-right: 0.25rem;
}
</style>
