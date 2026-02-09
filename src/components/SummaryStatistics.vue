<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const store = useCalculatorStore()
const {
  simulationResults,
  showDetailedStatistics,
  yearsLater,
  depositYears,
  profitWithdrawalRate,
} = storeToRefs(store)

const labels = computed(() => simulationResults.value?.labels ?? [])
const statistics = computed(() => simulationResults.value?.statistics ?? [])
const outcomeProbabilities = computed(() => simulationResults.value?.outcomeProbabilities ?? [])
const finalPeriod = computed(() => {
  if (statistics.value.length === 0) return 0
  return statistics.value[0]!.median.snapshots.liquidValue.length - 1
})

// Calculate the first withdrawal period (accounts for deposit years and profit lookback)
const firstWithdrawalPeriod = computed(() => {
  if (profitWithdrawalRate.value > 0) {
    return depositYears.value + 1
  }
  return depositYears.value
})

const COLORS = ['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']

// Helper to get a value from statistics for a specific scenario and percentile
const getValue = (
  scenarioIdx: number,
  statKey: 'mean' | 'stdDev' | 'percentile10' | 'median' | 'percentile90',
  field:
    | 'liquidValue'
    | 'totalValue'
    | 'tax'
    | 'taxationDegree'
    | 'withdrawalReal'
    | 'withdrawalRealSnapshot'
    | 'withdrawal'
    | 'maxDrawdown'
    | 'maxDrawdownPeriod'
    | 'iskTaxRate',
  periodIdx?: number,
): number => {
  if (!statistics.value[scenarioIdx]) return 0
  const stat = statistics.value[scenarioIdx]![statKey]
  const period = periodIdx ?? finalPeriod.value

  switch (field) {
    case 'liquidValue':
      return stat.snapshots.liquidValue[period] ?? 0
    case 'totalValue':
      return stat.snapshots.totalValue[period] ?? 0
    case 'tax':
      return stat.snapshots.tax[period] ?? 0
    case 'taxationDegree':
      return stat.snapshots.taxationDegree[period] ?? 0
    case 'withdrawalReal':
      return stat.periodData.withdrawalReal[period] ?? 0
    case 'withdrawalRealSnapshot':
      return stat.snapshots.withdrawalReal[period] ?? 0
    case 'withdrawal':
      return stat.snapshots.withdrawal[period] ?? 0
    case 'maxDrawdown':
      return stat.snapshots.maxDrawdown[period] ?? 0
    case 'maxDrawdownPeriod':
      return stat.snapshots.maxDrawdownPeriod[period] ?? 0
    case 'iskTaxRate':
      return stat.periodData.iskTaxRate[period] ?? 0
    default:
      return 0
  }
}

// Average values across periods
const getAverageInflation = (
  scenarioIdx: number,
  statKey: 'mean' | 'stdDev' | 'percentile10' | 'median' | 'percentile90',
): number => {
  if (!statistics.value[scenarioIdx]) return 0
  const rates = statistics.value[scenarioIdx]![statKey].periodData.inflationRate
  return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0
}

const getAverageDevelopment = (
  scenarioIdx: number,
  statKey: 'mean' | 'stdDev' | 'percentile10' | 'median' | 'percentile90',
): number => {
  if (!statistics.value[scenarioIdx]) return 0
  const assetReturns = statistics.value[scenarioIdx]![statKey].periodData.assetReturnRates
  if (assetReturns.length === 0) return 0
  return (
    assetReturns.reduce((sum, periodReturns) => {
      const periodAvg = periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length
      return sum + periodAvg
    }, 0) / assetReturns.length
  )
}

const getAverageIskTaxRate = (
  scenarioIdx: number,
  statKey: 'mean' | 'stdDev' | 'percentile10' | 'median' | 'percentile90',
): number => {
  if (!statistics.value[scenarioIdx]) return 0
  const rates = statistics.value[scenarioIdx]![statKey].periodData.iskTaxRate
  return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0
}

// Helper to determine best scenario for highlighting
const getBestScenario = (
  statKey: 'percentile10' | 'median' | 'percentile90',
  field:
    | 'liquidValue'
    | 'totalValue'
    | 'tax'
    | 'taxationDegree'
    | 'withdrawalReal'
    | 'withdrawalRealSnapshot'
    | 'maxDrawdown'
    | 'maxDrawdownPeriod',
  higherIsBetter: boolean,
): number | null => {
  if (labels.value.length === 0) return null

  let bestIdx = 0
  let bestValue = getValue(0, statKey, field)

  for (let i = 1; i < labels.value.length; i++) {
    const value = getValue(i, statKey, field)
    if (higherIsBetter ? value > bestValue : value < bestValue) {
      bestIdx = i
      bestValue = value
    }
  }

  return bestIdx
}

const formatNumber = (value: number | undefined): string => {
  if (value == null || isNaN(value)) return '-'

  // Round to 2 significant digits
  const absValue = Math.abs(value)
  if (absValue === 0) return '0'

  const magnitude = Math.floor(Math.log10(absValue))
  const scale = Math.pow(10, magnitude - 1)
  const rounded = Math.round(value / scale) * scale

  return new Intl.NumberFormat('sv-SE', {
    maximumSignificantDigits: 2,
    minimumSignificantDigits: 2,
  }).format(rounded)
}

const formatPercent = (value: number | undefined): string => {
  if (value == null || isNaN(value)) return '-'

  // Round to 2 significant digits
  const absValue = Math.abs(value)
  if (absValue === 0) return '0,0 %'

  const magnitude = Math.floor(Math.log10(absValue))
  const scale = Math.pow(10, magnitude - 1)
  const rounded = Math.round(value / scale) * scale

  return new Intl.NumberFormat('sv-SE', {
    style: 'percent',
    maximumSignificantDigits: 2,
    minimumSignificantDigits: 2,
  }).format(rounded)
}

// Helper to get cell style based on whether this scenario is the best
const getCellStyle = (
  statKey: 'percentile10' | 'median' | 'percentile90',
  scenarioIdx: number,
  field:
    | 'liquidValue'
    | 'totalValue'
    | 'tax'
    | 'taxationDegree'
    | 'withdrawalReal'
    | 'withdrawalRealSnapshot'
    | 'maxDrawdown'
    | 'maxDrawdownPeriod',
  higherIsBetter: boolean,
) => {
  // Don't highlight if only one scenario
  if (statistics.value.length < 2) return {}

  const best = getBestScenario(statKey, field, higherIsBetter)
  if (best === null || best !== scenarioIdx) return {}

  // Use color from palette with opacity for subtle effect
  const color = COLORS[scenarioIdx % COLORS.length]!
  return { backgroundColor: color + '33' } // Add 20% opacity (33 in hex)
}

const hasResults = computed(() => statistics.value.length > 0)
const hasMultipleScenarios = computed(() => statistics.value.length > 1)
</script>

<template>
  <div v-if="hasResults">
    <p class="text-muted mb-3">
      Statistik över alla simuleringar.<span v-if="hasMultipleScenarios">
        Celler med bästa värdet för varje mått och percentil är markerade med färg.</span
      >
    </p>

    <!-- Outcome Probabilities Table -->
    <div class="table-responsive mb-4">
      <table class="table table-bordered table-hover">
        <thead>
          <tr>
            <th>Sannolikhet</th>
            <th v-for="label in labels" :key="label">{{ label }}</th>
          </tr>
        </thead>
        <tbody class="table-group-divider">
          <tr>
            <th scope="row">Mer än noll</th>
            <td v-for="(_, idx) in labels" :key="idx">
              {{ formatPercent(outcomeProbabilities[idx]?.successRate ?? 0) }}
            </td>
          </tr>
          <tr>
            <th scope="row">Går bättre än jämnt upp (reellt)</th>
            <td v-for="(_, idx) in labels" :key="idx">
              {{ formatPercent(outcomeProbabilities[idx]?.breakEvenRate ?? 0) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="table-responsive">
      <table class="table table-bordered table-hover">
        <thead>
          <tr>
            <th rowspan="2" class="align-middle">Mått</th>
            <th rowspan="2" class="align-middle">Scenario</th>
            <th colspan="3">Percentiler</th>
            <th v-if="showDetailedStatistics" rowspan="2" class="align-middle">Medel</th>
            <th v-if="showDetailedStatistics" rowspan="2" class="align-middle">SD</th>
          </tr>
          <tr>
            <th>10%</th>
            <th>50%</th>
            <th>90%</th>
          </tr>
        </thead>
        <tbody class="table-group-divider">
          <!-- Total Value -->
          <template v-for="(label, idx) in labels" :key="`totalValue-${idx}`">
            <tr>
              <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                Totalt värde
              </th>
              <th scope="row">{{ label }}</th>
              <td :style="getCellStyle('percentile10', idx, 'totalValue', true)">
                {{ formatNumber(getValue(idx, 'percentile10', 'totalValue')) }}
              </td>
              <td :style="getCellStyle('median', idx, 'totalValue', true)">
                {{ formatNumber(getValue(idx, 'median', 'totalValue')) }}
              </td>
              <td :style="getCellStyle('percentile90', idx, 'totalValue', true)">
                {{ formatNumber(getValue(idx, 'percentile90', 'totalValue')) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'mean', 'totalValue')) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'stdDev', 'totalValue')) }}
              </td>
            </tr>
          </template>

          <!-- Liquid Value -->
          <template v-for="(label, idx) in labels" :key="`liquidValue-${idx}`">
            <tr>
              <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                Likvidvärde
              </th>
              <th scope="row">{{ label }}</th>
              <td :style="getCellStyle('percentile10', idx, 'liquidValue', true)">
                {{ formatNumber(getValue(idx, 'percentile10', 'liquidValue')) }}
              </td>
              <td :style="getCellStyle('median', idx, 'liquidValue', true)">
                {{ formatNumber(getValue(idx, 'median', 'liquidValue')) }}
              </td>
              <td :style="getCellStyle('percentile90', idx, 'liquidValue', true)">
                {{ formatNumber(getValue(idx, 'percentile90', 'liquidValue')) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'mean', 'liquidValue')) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'stdDev', 'liquidValue')) }}
              </td>
            </tr>
          </template>

          <!-- First Year Withdrawal -->
          <template v-for="(label, idx) in labels" :key="`firstYearWithdrawal-${idx}`">
            <tr>
              <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                Uttag reellt (första året)
              </th>
              <th scope="row">{{ label }}</th>
              <td :style="getCellStyle('percentile10', idx, 'withdrawalReal', true)">
                {{
                  formatNumber(
                    getValue(idx, 'percentile10', 'withdrawalReal', firstWithdrawalPeriod),
                  )
                }}
              </td>
              <td :style="getCellStyle('median', idx, 'withdrawalReal', true)">
                {{ formatNumber(getValue(idx, 'median', 'withdrawalReal', firstWithdrawalPeriod)) }}
              </td>
              <td :style="getCellStyle('percentile90', idx, 'withdrawalReal', true)">
                {{
                  formatNumber(
                    getValue(idx, 'percentile90', 'withdrawalReal', firstWithdrawalPeriod),
                  )
                }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'mean', 'withdrawalReal', firstWithdrawalPeriod)) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'stdDev', 'withdrawalReal', firstWithdrawalPeriod)) }}
              </td>
            </tr>
          </template>

          <!-- Real Withdrawal Last Year -->
          <template v-for="(label, idx) in labels" :key="`realWithdrawal-${idx}`">
            <tr>
              <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                Uttag reellt (sista året)
              </th>
              <th scope="row">{{ label }}</th>
              <td :style="getCellStyle('percentile10', idx, 'withdrawalReal', true)">
                {{ formatNumber(getValue(idx, 'percentile10', 'withdrawalReal')) }}
              </td>
              <td :style="getCellStyle('median', idx, 'withdrawalReal', true)">
                {{ formatNumber(getValue(idx, 'median', 'withdrawalReal')) }}
              </td>
              <td :style="getCellStyle('percentile90', idx, 'withdrawalReal', true)">
                {{ formatNumber(getValue(idx, 'percentile90', 'withdrawalReal')) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'mean', 'withdrawalReal')) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'stdDev', 'withdrawalReal')) }}
              </td>
            </tr>
          </template>

          <!-- Average Annual Real Withdrawal -->
          <template v-for="(label, idx) in labels" :key="`avgWithdrawal-${idx}`">
            <tr>
              <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                Genomsnittligt uttag reellt per år
              </th>
              <th scope="row">{{ label }}</th>
              <td :style="getCellStyle('percentile10', idx, 'withdrawalRealSnapshot', true)">
                {{
                  formatNumber(getValue(idx, 'percentile10', 'withdrawalRealSnapshot') / yearsLater)
                }}
              </td>
              <td :style="getCellStyle('median', idx, 'withdrawalRealSnapshot', true)">
                {{ formatNumber(getValue(idx, 'median', 'withdrawalRealSnapshot') / yearsLater) }}
              </td>
              <td :style="getCellStyle('percentile90', idx, 'withdrawalRealSnapshot', true)">
                {{
                  formatNumber(getValue(idx, 'percentile90', 'withdrawalRealSnapshot') / yearsLater)
                }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'mean', 'withdrawalRealSnapshot') / yearsLater) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatNumber(getValue(idx, 'stdDev', 'withdrawalRealSnapshot') / yearsLater) }}
              </td>
            </tr>
          </template>

          <!-- Max Drawdown -->
          <template v-for="(label, idx) in labels" :key="`maxDrawdown-${idx}`">
            <tr>
              <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                Maximalt drawdown
              </th>
              <th scope="row">{{ label }}</th>
              <td :style="getCellStyle('percentile10', idx, 'maxDrawdown', false)">
                {{ formatPercent(getValue(idx, 'percentile10', 'maxDrawdown')) }}
              </td>
              <td :style="getCellStyle('median', idx, 'maxDrawdown', false)">
                {{ formatPercent(getValue(idx, 'median', 'maxDrawdown')) }}
              </td>
              <td :style="getCellStyle('percentile90', idx, 'maxDrawdown', false)">
                {{ formatPercent(getValue(idx, 'percentile90', 'maxDrawdown')) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatPercent(getValue(idx, 'mean', 'maxDrawdown')) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatPercent(getValue(idx, 'stdDev', 'maxDrawdown')) }}
              </td>
            </tr>
          </template>

          <template v-if="showDetailedStatistics">
            <!-- Max Drawdown Period -->
            <template v-for="(label, idx) in labels" :key="`maxDrawdownPeriod-${idx}`">
              <tr>
                <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                  Längsta drawdown-period
                </th>
                <th scope="row">{{ label }}</th>
                <td :style="getCellStyle('percentile10', idx, 'maxDrawdownPeriod', false)">
                  {{ formatNumber(getValue(idx, 'percentile10', 'maxDrawdownPeriod')) }} år
                </td>
                <td :style="getCellStyle('median', idx, 'maxDrawdownPeriod', false)">
                  {{ formatNumber(getValue(idx, 'median', 'maxDrawdownPeriod')) }} år
                </td>
                <td :style="getCellStyle('percentile90', idx, 'maxDrawdownPeriod', false)">
                  {{ formatNumber(getValue(idx, 'percentile90', 'maxDrawdownPeriod')) }} år
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatNumber(getValue(idx, 'mean', 'maxDrawdownPeriod')) }} år
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatNumber(getValue(idx, 'stdDev', 'maxDrawdownPeriod')) }} år
                </td>
              </tr>
            </template>

            <!-- Paid Tax -->
            <template v-for="(label, idx) in labels" :key="`paidTax-${idx}`">
              <tr>
                <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                  Betald skatt
                </th>
                <th scope="row">{{ label }}</th>
                <td :style="getCellStyle('percentile10', idx, 'tax', false)">
                  {{ formatNumber(getValue(idx, 'percentile10', 'tax')) }}
                </td>
                <td :style="getCellStyle('median', idx, 'tax', false)">
                  {{ formatNumber(getValue(idx, 'median', 'tax')) }}
                </td>
                <td :style="getCellStyle('percentile90', idx, 'tax', false)">
                  {{ formatNumber(getValue(idx, 'percentile90', 'tax')) }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatNumber(getValue(idx, 'mean', 'tax')) }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatNumber(getValue(idx, 'stdDev', 'tax')) }}
                </td>
              </tr>
            </template>

            <!-- Taxation Degree -->
            <template v-for="(label, idx) in labels" :key="`taxationDegree-${idx}`">
              <tr>
                <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                  Beskattningsgrad
                </th>
                <th scope="row">{{ label }}</th>
                <td :style="getCellStyle('percentile10', idx, 'taxationDegree', false)">
                  {{ formatPercent(getValue(idx, 'percentile10', 'taxationDegree')) }}
                </td>
                <td :style="getCellStyle('median', idx, 'taxationDegree', false)">
                  {{ formatPercent(getValue(idx, 'median', 'taxationDegree')) }}
                </td>
                <td :style="getCellStyle('percentile90', idx, 'taxationDegree', false)">
                  {{ formatPercent(getValue(idx, 'percentile90', 'taxationDegree')) }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getValue(idx, 'mean', 'taxationDegree')) }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getValue(idx, 'stdDev', 'taxationDegree')) }}
                </td>
              </tr>
            </template>

            <!-- Asset Return (per scenario) -->
            <template v-for="(label, idx) in labels" :key="`assetReturn-${idx}`">
              <tr class="table-group-divider">
                <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                  Avkastning
                </th>
                <th scope="row">{{ label }}</th>
                <td>{{ formatPercent(getAverageDevelopment(idx, 'percentile10')) }}</td>
                <td>{{ formatPercent(getAverageDevelopment(idx, 'median')) }}</td>
                <td>{{ formatPercent(getAverageDevelopment(idx, 'percentile90')) }}</td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getAverageDevelopment(idx, 'mean')) }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getAverageDevelopment(idx, 'stdDev')) }}
                </td>
              </tr>
            </template>

            <!-- Inflation Rate (per scenario) -->
            <template v-for="(label, idx) in labels" :key="`inflation-${idx}`">
              <tr class="table-group-divider">
                <th v-if="idx === 0" :rowspan="labels.length" class="align-middle" scope="row">
                  Inflationstakt
                </th>
                <th scope="row">{{ label }}</th>
                <td>{{ formatPercent(getAverageInflation(idx, 'percentile10')) }}</td>
                <td>{{ formatPercent(getAverageInflation(idx, 'median')) }}</td>
                <td>{{ formatPercent(getAverageInflation(idx, 'percentile90')) }}</td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getAverageInflation(idx, 'mean')) }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getAverageInflation(idx, 'stdDev')) }}
                </td>
              </tr>
            </template>

            <!-- ISK Tax Rate (only for scenarios that have it) -->
            <template v-for="(label, idx) in labels" :key="`iskTax-${idx}`">
              <tr v-if="getAverageIskTaxRate(idx, 'percentile90') > 0" class="table-group-divider">
                <th scope="row">ISK-skattesats</th>
                <th scope="row">{{ label }}</th>
                <td>{{ formatPercent(getAverageIskTaxRate(idx, 'percentile10')) }}</td>
                <td>{{ formatPercent(getAverageIskTaxRate(idx, 'median')) }}</td>
                <td>{{ formatPercent(getAverageIskTaxRate(idx, 'percentile90')) }}</td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getAverageIskTaxRate(idx, 'mean')) }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getAverageIskTaxRate(idx, 'stdDev')) }}
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.table thead th {
  text-align: center;
}

.table th {
  font-size: 0.9rem;
  font-weight: 600;
}

.table td {
  font-size: 0.85rem;
}

.table td {
  text-align: right;
}
</style>
