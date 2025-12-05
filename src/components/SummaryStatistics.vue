<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import type { Summary } from '../types'

const store = useCalculatorStore()
const { statistics, showDetailedStatistics, yearsLater } = storeToRefs(store)

// Get scenario names dynamically
const scenarioNames = computed(() => {
  if (!statistics.value?.median?.scenarios) return []
  return Object.keys(statistics.value.median.scenarios)
})

// Helper to get scenario value from a Summary
const getScenario = (summary: Summary | undefined, scenarioName: string, key: string): number => {
  if (!summary?.scenarios?.[scenarioName]) return 0
  return (summary.scenarios[scenarioName] as any)[key] ?? 0
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

// Helper to determine which scenario is best for a given metric
// Returns scenario name or null if tie/no clear winner
const getBestScenario = (
  summary: Summary | undefined,
  field: string,
  higherIsBetter: boolean,
): string | null => {
  if (!summary?.scenarios) return null

  const values = Object.entries(summary.scenarios).map(([name, data]) => ({
    name,
    value: (data as any)[field] ?? 0,
  }))

  if (values.length === 0) return null

  const sorted = values.sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value))

  // Check if there's a clear winner (not a tie)
  if (sorted.length > 1 && Math.abs(sorted[0]!.value - sorted[1]!.value) < 0.0001) {
    return null // Tie
  }

  return sorted[0]!.name
}

// Helper to get cell class based on whether this scenario is the best
const getCellClass = (
  summary: Summary | undefined,
  scenarioName: string,
  field: string,
  higherIsBetter: boolean,
): string => {
  const best = getBestScenario(summary, field, higherIsBetter)
  if (!best || best !== scenarioName) return ''

  // Color based on scenario name
  return scenarioName === 'ISK' ? 'bg-primary-subtle' : 'bg-warning-subtle'
}

const hasResults = computed(() => statistics.value !== null)
</script>

<template>
  <div v-if="hasResults">
    <p class="text-muted mb-3">
      Statistik över alla simuleringar. Bästa värden i varje kolumn är markerade.
    </p>
    <div class="table-responsive">
      <table class="table table-bordered table-hover">
        <thead class="table-light">
          <tr>
            <th rowspan="2" class="align-middle">Mått</th>
            <th rowspan="2" class="align-middle">Scenario</th>
            <th colspan="5">Percentiler</th>
            <th v-if="showDetailedStatistics" rowspan="2" class="align-middle">Medel</th>
            <th v-if="showDetailedStatistics" rowspan="2" class="align-middle">SD</th>
          </tr>
          <tr>
            <th>5%</th>
            <th>25%</th>
            <th>50%</th>
            <th>75%</th>
            <th>95%</th>
          </tr>
        </thead>
        <tbody>
          <!-- Liquid Value -->
          <template
            v-for="(scenarioName, index) in scenarioNames"
            :key="`liquidValue-${scenarioName}`"
          >
            <tr>
              <th
                v-if="index === 0"
                :rowspan="scenarioNames.length"
                class="align-middle"
                scope="row"
              >
                Likvidvärde
              </th>
              <th scope="row">{{ scenarioName }}</th>
              <td :class="getCellClass(statistics?.percentile5, scenarioName, 'liquidValue', true)">
                {{
                  formatNumber(getScenario(statistics?.percentile5, scenarioName, 'liquidValue'))
                }}
              </td>
              <td
                :class="getCellClass(statistics?.percentile25, scenarioName, 'liquidValue', true)"
              >
                {{
                  formatNumber(getScenario(statistics?.percentile25, scenarioName, 'liquidValue'))
                }}
              </td>
              <td :class="getCellClass(statistics?.median, scenarioName, 'liquidValue', true)">
                {{ formatNumber(getScenario(statistics?.median, scenarioName, 'liquidValue')) }}
              </td>
              <td
                :class="getCellClass(statistics?.percentile75, scenarioName, 'liquidValue', true)"
              >
                {{
                  formatNumber(getScenario(statistics?.percentile75, scenarioName, 'liquidValue'))
                }}
              </td>
              <td
                :class="getCellClass(statistics?.percentile95, scenarioName, 'liquidValue', true)"
              >
                {{
                  formatNumber(getScenario(statistics?.percentile95, scenarioName, 'liquidValue'))
                }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="getCellClass(statistics?.mean, scenarioName, 'liquidValue', true)"
              >
                {{ formatNumber(getScenario(statistics?.mean, scenarioName, 'liquidValue')) }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="getCellClass(statistics?.stdDev, scenarioName, 'liquidValue', true)"
              >
                {{ formatNumber(getScenario(statistics?.stdDev, scenarioName, 'liquidValue')) }}
              </td>
            </tr>
          </template>

          <!-- First Year Withdrawal -->
          <template
            v-for="(scenarioName, index) in scenarioNames"
            :key="`firstYearWithdrawal-${scenarioName}`"
          >
            <tr>
              <th
                v-if="index === 0"
                :rowspan="scenarioNames.length"
                class="align-middle"
                scope="row"
              >
                Uttag reellt (första året)
              </th>
              <th scope="row">{{ scenarioName }}</th>
              <td
                :class="
                  getCellClass(statistics?.percentile5, scenarioName, 'firstYearWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.percentile5, scenarioName, 'firstYearWithdrawal'),
                  )
                }}
              </td>
              <td
                :class="
                  getCellClass(statistics?.percentile25, scenarioName, 'firstYearWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.percentile25, scenarioName, 'firstYearWithdrawal'),
                  )
                }}
              </td>
              <td
                :class="getCellClass(statistics?.median, scenarioName, 'firstYearWithdrawal', true)"
              >
                {{
                  formatNumber(getScenario(statistics?.median, scenarioName, 'firstYearWithdrawal'))
                }}
              </td>
              <td
                :class="
                  getCellClass(statistics?.percentile75, scenarioName, 'firstYearWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.percentile75, scenarioName, 'firstYearWithdrawal'),
                  )
                }}
              </td>
              <td
                :class="
                  getCellClass(statistics?.percentile95, scenarioName, 'firstYearWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.percentile95, scenarioName, 'firstYearWithdrawal'),
                  )
                }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="getCellClass(statistics?.mean, scenarioName, 'firstYearWithdrawal', true)"
              >
                {{
                  formatNumber(getScenario(statistics?.mean, scenarioName, 'firstYearWithdrawal'))
                }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="getCellClass(statistics?.stdDev, scenarioName, 'firstYearWithdrawal', true)"
              >
                {{
                  formatNumber(getScenario(statistics?.stdDev, scenarioName, 'firstYearWithdrawal'))
                }}
              </td>
            </tr>
          </template>

          <!-- Real Withdrawal Last Year -->
          <template
            v-for="(scenarioName, index) in scenarioNames"
            :key="`realWithdrawal-${scenarioName}`"
          >
            <tr>
              <th
                v-if="index === 0"
                :rowspan="scenarioNames.length"
                class="align-middle"
                scope="row"
              >
                Uttag reellt (sista året)
              </th>
              <th scope="row">{{ scenarioName }}</th>
              <td
                :class="getCellClass(statistics?.percentile5, scenarioName, 'realWithdrawal', true)"
              >
                {{
                  formatNumber(getScenario(statistics?.percentile5, scenarioName, 'realWithdrawal'))
                }}
              </td>
              <td
                :class="
                  getCellClass(statistics?.percentile25, scenarioName, 'realWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.percentile25, scenarioName, 'realWithdrawal'),
                  )
                }}
              </td>
              <td :class="getCellClass(statistics?.median, scenarioName, 'realWithdrawal', true)">
                {{ formatNumber(getScenario(statistics?.median, scenarioName, 'realWithdrawal')) }}
              </td>
              <td
                :class="
                  getCellClass(statistics?.percentile75, scenarioName, 'realWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.percentile75, scenarioName, 'realWithdrawal'),
                  )
                }}
              </td>
              <td
                :class="
                  getCellClass(statistics?.percentile95, scenarioName, 'realWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.percentile95, scenarioName, 'realWithdrawal'),
                  )
                }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="getCellClass(statistics?.mean, scenarioName, 'realWithdrawal', true)"
              >
                {{ formatNumber(getScenario(statistics?.mean, scenarioName, 'realWithdrawal')) }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="getCellClass(statistics?.stdDev, scenarioName, 'realWithdrawal', true)"
              >
                {{ formatNumber(getScenario(statistics?.stdDev, scenarioName, 'realWithdrawal')) }}
              </td>
            </tr>
          </template>

          <!-- Average Annual Real Withdrawal -->
          <template
            v-for="(scenarioName, index) in scenarioNames"
            :key="`avgWithdrawal-${scenarioName}`"
          >
            <tr>
              <th
                v-if="index === 0"
                :rowspan="scenarioNames.length"
                class="align-middle"
                scope="row"
              >
                Genomsnittligt uttag reellt per år
              </th>
              <th scope="row">{{ scenarioName }}</th>
              <td
                :class="
                  getCellClass(
                    statistics?.percentile5,
                    scenarioName,
                    'accumulatedRealWithdrawal',
                    true,
                  )
                "
              >
                {{
                  formatNumber(
                    getScenario(
                      statistics?.percentile5,
                      scenarioName,
                      'accumulatedRealWithdrawal',
                    ) / yearsLater,
                  )
                }}
              </td>
              <td
                :class="
                  getCellClass(
                    statistics?.percentile25,
                    scenarioName,
                    'accumulatedRealWithdrawal',
                    true,
                  )
                "
              >
                {{
                  formatNumber(
                    getScenario(
                      statistics?.percentile25,
                      scenarioName,
                      'accumulatedRealWithdrawal',
                    ) / yearsLater,
                  )
                }}
              </td>
              <td
                :class="
                  getCellClass(statistics?.median, scenarioName, 'accumulatedRealWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.median, scenarioName, 'accumulatedRealWithdrawal') /
                      yearsLater,
                  )
                }}
              </td>
              <td
                :class="
                  getCellClass(
                    statistics?.percentile75,
                    scenarioName,
                    'accumulatedRealWithdrawal',
                    true,
                  )
                "
              >
                {{
                  formatNumber(
                    getScenario(
                      statistics?.percentile75,
                      scenarioName,
                      'accumulatedRealWithdrawal',
                    ) / yearsLater,
                  )
                }}
              </td>
              <td
                :class="
                  getCellClass(
                    statistics?.percentile95,
                    scenarioName,
                    'accumulatedRealWithdrawal',
                    true,
                  )
                "
              >
                {{
                  formatNumber(
                    getScenario(
                      statistics?.percentile95,
                      scenarioName,
                      'accumulatedRealWithdrawal',
                    ) / yearsLater,
                  )
                }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="
                  getCellClass(statistics?.mean, scenarioName, 'accumulatedRealWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.mean, scenarioName, 'accumulatedRealWithdrawal') /
                      yearsLater,
                  )
                }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="
                  getCellClass(statistics?.stdDev, scenarioName, 'accumulatedRealWithdrawal', true)
                "
              >
                {{
                  formatNumber(
                    getScenario(statistics?.stdDev, scenarioName, 'accumulatedRealWithdrawal') /
                      yearsLater,
                  )
                }}
              </td>
            </tr>
          </template>

          <!-- Max Drawdown -->
          <template
            v-for="(scenarioName, index) in scenarioNames"
            :key="`maxDrawdown-${scenarioName}`"
          >
            <tr>
              <th
                v-if="index === 0"
                :rowspan="scenarioNames.length"
                class="align-middle"
                scope="row"
              >
                Maximalt drawdown
              </th>
              <th scope="row">{{ scenarioName }}</th>
              <td
                :class="getCellClass(statistics?.percentile5, scenarioName, 'maxDrawdown', false)"
              >
                {{
                  formatPercent(getScenario(statistics?.percentile5, scenarioName, 'maxDrawdown'))
                }}
              </td>
              <td
                :class="getCellClass(statistics?.percentile25, scenarioName, 'maxDrawdown', false)"
              >
                {{
                  formatPercent(getScenario(statistics?.percentile25, scenarioName, 'maxDrawdown'))
                }}
              </td>
              <td :class="getCellClass(statistics?.median, scenarioName, 'maxDrawdown', false)">
                {{ formatPercent(getScenario(statistics?.median, scenarioName, 'maxDrawdown')) }}
              </td>
              <td
                :class="getCellClass(statistics?.percentile75, scenarioName, 'maxDrawdown', false)"
              >
                {{
                  formatPercent(getScenario(statistics?.percentile75, scenarioName, 'maxDrawdown'))
                }}
              </td>
              <td
                :class="getCellClass(statistics?.percentile95, scenarioName, 'maxDrawdown', false)"
              >
                {{
                  formatPercent(getScenario(statistics?.percentile95, scenarioName, 'maxDrawdown'))
                }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="getCellClass(statistics?.mean, scenarioName, 'maxDrawdown', false)"
              >
                {{ formatPercent(getScenario(statistics?.mean, scenarioName, 'maxDrawdown')) }}
              </td>
              <td
                v-if="showDetailedStatistics"
                :class="getCellClass(statistics?.stdDev, scenarioName, 'maxDrawdown', false)"
              >
                {{ formatPercent(getScenario(statistics?.stdDev, scenarioName, 'maxDrawdown')) }}
              </td>
            </tr>
          </template>

          <template v-if="showDetailedStatistics">
            <!-- Max Drawdown Period -->
            <template
              v-for="(scenarioName, index) in scenarioNames"
              :key="`maxDrawdownPeriod-${scenarioName}`"
            >
              <tr>
                <th
                  v-if="index === 0"
                  :rowspan="scenarioNames.length"
                  class="align-middle"
                  scope="row"
                >
                  Längsta drawdown-period
                </th>
                <th scope="row">{{ scenarioName }}</th>
                <td
                  :class="
                    getCellClass(statistics?.percentile5, scenarioName, 'maxDrawdownPeriod', false)
                  "
                >
                  {{
                    formatNumber(
                      getScenario(statistics?.percentile5, scenarioName, 'maxDrawdownPeriod'),
                    )
                  }}
                  år
                </td>
                <td
                  :class="
                    getCellClass(statistics?.percentile25, scenarioName, 'maxDrawdownPeriod', false)
                  "
                >
                  {{
                    formatNumber(
                      getScenario(statistics?.percentile25, scenarioName, 'maxDrawdownPeriod'),
                    )
                  }}
                  år
                </td>
                <td
                  :class="
                    getCellClass(statistics?.median, scenarioName, 'maxDrawdownPeriod', false)
                  "
                >
                  {{
                    formatNumber(getScenario(statistics?.median, scenarioName, 'maxDrawdownPeriod'))
                  }}
                  år
                </td>
                <td
                  :class="
                    getCellClass(statistics?.percentile75, scenarioName, 'maxDrawdownPeriod', false)
                  "
                >
                  {{
                    formatNumber(
                      getScenario(statistics?.percentile75, scenarioName, 'maxDrawdownPeriod'),
                    )
                  }}
                  år
                </td>
                <td
                  :class="
                    getCellClass(statistics?.percentile95, scenarioName, 'maxDrawdownPeriod', false)
                  "
                >
                  {{
                    formatNumber(
                      getScenario(statistics?.percentile95, scenarioName, 'maxDrawdownPeriod'),
                    )
                  }}
                  år
                </td>
                <td
                  v-if="showDetailedStatistics"
                  :class="getCellClass(statistics?.mean, scenarioName, 'maxDrawdownPeriod', false)"
                >
                  {{
                    formatNumber(getScenario(statistics?.mean, scenarioName, 'maxDrawdownPeriod'))
                  }}
                  år
                </td>
                <td
                  v-if="showDetailedStatistics"
                  :class="
                    getCellClass(statistics?.stdDev, scenarioName, 'maxDrawdownPeriod', false)
                  "
                >
                  {{
                    formatNumber(getScenario(statistics?.stdDev, scenarioName, 'maxDrawdownPeriod'))
                  }}
                  år
                </td>
              </tr>
            </template>

            <!-- Paid Tax -->
            <template
              v-for="(scenarioName, index) in scenarioNames"
              :key="`paidTax-${scenarioName}`"
            >
              <tr>
                <th
                  v-if="index === 0"
                  :rowspan="scenarioNames.length"
                  class="align-middle"
                  scope="row"
                >
                  Betald skatt
                </th>
                <th scope="row">{{ scenarioName }}</th>
                <td :class="getCellClass(statistics?.percentile5, scenarioName, 'paidTax', false)">
                  {{ formatNumber(getScenario(statistics?.percentile5, scenarioName, 'paidTax')) }}
                </td>
                <td :class="getCellClass(statistics?.percentile25, scenarioName, 'paidTax', false)">
                  {{ formatNumber(getScenario(statistics?.percentile25, scenarioName, 'paidTax')) }}
                </td>
                <td :class="getCellClass(statistics?.median, scenarioName, 'paidTax', false)">
                  {{ formatNumber(getScenario(statistics?.median, scenarioName, 'paidTax')) }}
                </td>
                <td :class="getCellClass(statistics?.percentile75, scenarioName, 'paidTax', false)">
                  {{ formatNumber(getScenario(statistics?.percentile75, scenarioName, 'paidTax')) }}
                </td>
                <td :class="getCellClass(statistics?.percentile95, scenarioName, 'paidTax', false)">
                  {{ formatNumber(getScenario(statistics?.percentile95, scenarioName, 'paidTax')) }}
                </td>
                <td
                  v-if="showDetailedStatistics"
                  :class="getCellClass(statistics?.mean, scenarioName, 'paidTax', false)"
                >
                  {{ formatNumber(getScenario(statistics?.mean, scenarioName, 'paidTax')) }}
                </td>
                <td
                  v-if="showDetailedStatistics"
                  :class="getCellClass(statistics?.stdDev, scenarioName, 'paidTax', false)"
                >
                  {{ formatNumber(getScenario(statistics?.stdDev, scenarioName, 'paidTax')) }}
                </td>
              </tr>
            </template>

            <!-- Taxation Degree -->
            <template
              v-for="(scenarioName, index) in scenarioNames"
              :key="`taxationDegree-${scenarioName}`"
            >
              <tr>
                <th
                  v-if="index === 0"
                  :rowspan="scenarioNames.length"
                  class="align-middle"
                  scope="row"
                >
                  Beskattningsgrad
                </th>
                <th scope="row">{{ scenarioName }}</th>
                <td
                  :class="
                    getCellClass(statistics?.percentile5, scenarioName, 'taxationDegree', false)
                  "
                >
                  {{
                    formatPercent(
                      getScenario(statistics?.percentile5, scenarioName, 'taxationDegree'),
                    )
                  }}
                </td>
                <td
                  :class="
                    getCellClass(statistics?.percentile25, scenarioName, 'taxationDegree', false)
                  "
                >
                  {{
                    formatPercent(
                      getScenario(statistics?.percentile25, scenarioName, 'taxationDegree'),
                    )
                  }}
                </td>
                <td
                  :class="getCellClass(statistics?.median, scenarioName, 'taxationDegree', false)"
                >
                  {{
                    formatPercent(getScenario(statistics?.median, scenarioName, 'taxationDegree'))
                  }}
                </td>
                <td
                  :class="
                    getCellClass(statistics?.percentile75, scenarioName, 'taxationDegree', false)
                  "
                >
                  {{
                    formatPercent(
                      getScenario(statistics?.percentile75, scenarioName, 'taxationDegree'),
                    )
                  }}
                </td>
                <td
                  :class="
                    getCellClass(statistics?.percentile95, scenarioName, 'taxationDegree', false)
                  "
                >
                  {{
                    formatPercent(
                      getScenario(statistics?.percentile95, scenarioName, 'taxationDegree'),
                    )
                  }}
                </td>
                <td
                  v-if="showDetailedStatistics"
                  :class="getCellClass(statistics?.mean, scenarioName, 'taxationDegree', false)"
                >
                  {{ formatPercent(getScenario(statistics?.mean, scenarioName, 'taxationDegree')) }}
                </td>
                <td
                  v-if="showDetailedStatistics"
                  :class="getCellClass(statistics?.stdDev, scenarioName, 'taxationDegree', false)"
                >
                  {{
                    formatPercent(getScenario(statistics?.stdDev, scenarioName, 'taxationDegree'))
                  }}
                </td>
              </tr>
            </template>

            <!-- Annual Averages -->
            <tr class="table-light">
              <th scope="row">Avkastning</th>
              <th scope="row"></th>
              <td>{{ formatPercent(statistics?.percentile5.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.median.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.averageDevelopment) }}</td>
              <td v-if="showDetailedStatistics">
                {{ formatPercent(statistics?.mean.averageDevelopment) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatPercent(statistics?.stdDev.averageDevelopment) }}
              </td>
            </tr>
            <tr class="table-light">
              <th scope="row">Inflationstakt</th>
              <th scope="row"></th>
              <td>{{ formatPercent(statistics?.percentile5.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.median.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.averageInflationRate) }}</td>
              <td v-if="showDetailedStatistics">
                {{ formatPercent(statistics?.mean.averageInflationRate) }}
              </td>
              <td v-if="showDetailedStatistics">
                {{ formatPercent(statistics?.stdDev.averageInflationRate) }}
              </td>
            </tr>
            <template
              v-for="(scenarioName, index) in scenarioNames.filter(
                (name) => getScenario(statistics?.percentile95, name, 'averageTaxRate') > 0,
              )"
              :key="`iskTax-${scenarioName}`"
            >
              <tr class="table-light">
                <th
                  v-if="index === 0"
                  :rowspan="scenarioNames.length"
                  class="align-middle"
                  scope="row"
                >
                  ISK-skattesats
                </th>
                <th scope="row">{{ scenarioName }}</th>
                <td>
                  {{
                    formatPercent(
                      getScenario(statistics?.percentile5, scenarioName, 'averageTaxRate'),
                    )
                  }}
                </td>
                <td>
                  {{
                    formatPercent(
                      getScenario(statistics?.percentile25, scenarioName, 'averageTaxRate'),
                    )
                  }}
                </td>
                <td>
                  {{
                    formatPercent(getScenario(statistics?.median, scenarioName, 'averageTaxRate'))
                  }}
                </td>
                <td>
                  {{
                    formatPercent(
                      getScenario(statistics?.percentile75, scenarioName, 'averageTaxRate'),
                    )
                  }}
                </td>
                <td>
                  {{
                    formatPercent(
                      getScenario(statistics?.percentile95, scenarioName, 'averageTaxRate'),
                    )
                  }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{ formatPercent(getScenario(statistics?.mean, scenarioName, 'averageTaxRate')) }}
                </td>
                <td v-if="showDetailedStatistics">
                  {{
                    formatPercent(getScenario(statistics?.stdDev, scenarioName, 'averageTaxRate'))
                  }}
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>
    <p class="small text-muted mt-3">
      <strong>Observera:</strong> Celler med bästa värdet för varje mått och percentil är markerade
      med färg.
    </p>
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
