<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const store = useCalculatorStore()
const { statistics } = storeToRefs(store)

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

// Helper to determine cell class based on which account is better
// For most metrics, positive = ISK better (blue)
// For paidTax, negative = ISK paid less tax = ISK better (blue)
const getDiffClass = (value: number | undefined, invertSign: boolean = false): string => {
  if (value == null || isNaN(value) || value === 0) return ''
  const isBetter = invertSign ? value < 0 : value > 0
  return isBetter ? 'bg-primary-subtle' : 'bg-warning-subtle'
}

const hasResults = computed(() => statistics.value !== null)
</script>

<template>
  <div class="card mb-4" v-if="hasResults">
    <div class="card-header">
      <h3>Sammanfattande statistik</h3>
      <p class="mb-0 text-muted">Statistik över alla simuleringar</p>
    </div>
    <div class="card-body">
      <div class="table-responsive">
        <table class="table table-bordered table-hover">
          <thead class="table-light">
            <tr>
              <th rowspan="2" class="align-middle">Mått</th>
              <th rowspan="2" class="align-middle">Konto</th>
              <th colspan="5">Percentiler</th>
              <th rowspan="2" class="align-middle">Medel</th>
              <th rowspan="2" class="align-middle">Stdavv</th>
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
            <tr>
              <th rowspan="3" class="align-middle" scope="row">Likvidbelopp</th>
              <th scope="row">ISK</th>
              <td>{{ formatNumber(statistics?.percentile5.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.median.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.mean.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.liquidValueISK) }}</td>
            </tr>
            <tr>
              <th scope="row">VP</th>
              <td>{{ formatNumber(statistics?.percentile5.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.median.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.mean.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.liquidValueVP) }}</td>
            </tr>
            <tr>
              <th scope="row">Fördel ISK</th>
              <td :class="getDiffClass(statistics?.percentile5.liquidValueDiff)">
                {{ formatNumber(statistics?.percentile5.liquidValueDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile25.liquidValueDiff)">
                {{ formatNumber(statistics?.percentile25.liquidValueDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.median.liquidValueDiff)">
                {{ formatNumber(statistics?.median.liquidValueDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile75.liquidValueDiff)">
                {{ formatNumber(statistics?.percentile75.liquidValueDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile95.liquidValueDiff)">
                {{ formatNumber(statistics?.percentile95.liquidValueDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.mean.liquidValueDiff)">
                {{ formatNumber(statistics?.mean.liquidValueDiff) }}
              </td>
              <td>{{ formatNumber(statistics?.stdDev.liquidValueDiff) }}</td>
            </tr>

            <!-- Paid Tax -->
            <tr>
              <th rowspan="3" class="align-middle" scope="row">Betald skatt</th>
              <th scope="row">ISK</th>
              <td>{{ formatNumber(statistics?.percentile5.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.median.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.mean.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.paidTaxISK) }}</td>
            </tr>
            <tr>
              <th scope="row">VP</th>
              <td>{{ formatNumber(statistics?.percentile5.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.median.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.mean.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.paidTaxVP) }}</td>
            </tr>
            <tr>
              <th scope="row">Fördel ISK</th>
              <td :class="getDiffClass(statistics?.percentile5.paidTaxDiff, true)">
                {{ formatNumber(statistics?.percentile5.paidTaxDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile25.paidTaxDiff, true)">
                {{ formatNumber(statistics?.percentile25.paidTaxDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.median.paidTaxDiff, true)">
                {{ formatNumber(statistics?.median.paidTaxDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile75.paidTaxDiff, true)">
                {{ formatNumber(statistics?.percentile75.paidTaxDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile95.paidTaxDiff, true)">
                {{ formatNumber(statistics?.percentile95.paidTaxDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.mean.paidTaxDiff, true)">
                {{ formatNumber(statistics?.mean.paidTaxDiff) }}
              </td>
              <td>{{ formatNumber(statistics?.stdDev.paidTaxDiff) }}</td>
            </tr>

            <!-- Taxation Degree -->
            <tr>
              <th rowspan="3" class="align-middle" scope="row">Beskattningsgrad</th>
              <th scope="row">ISK</th>
              <td>{{ formatPercent(statistics?.percentile5.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.median.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.mean.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.taxationDegreeISK) }}</td>
            </tr>
            <tr>
              <th scope="row">VP</th>
              <td>{{ formatPercent(statistics?.percentile5.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.median.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.mean.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.taxationDegreeVP) }}</td>
            </tr>
            <tr>
              <th scope="row">Fördel ISK</th>
              <td :class="getDiffClass(statistics?.percentile5.taxationDegreeDiff, true)">
                {{ formatPercent(statistics?.percentile5.taxationDegreeDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile25.taxationDegreeDiff, true)">
                {{ formatPercent(statistics?.percentile25.taxationDegreeDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.median.taxationDegreeDiff, true)">
                {{ formatPercent(statistics?.median.taxationDegreeDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile75.taxationDegreeDiff, true)">
                {{ formatPercent(statistics?.percentile75.taxationDegreeDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile95.taxationDegreeDiff, true)">
                {{ formatPercent(statistics?.percentile95.taxationDegreeDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.mean.taxationDegreeDiff, true)">
                {{ formatPercent(statistics?.mean.taxationDegreeDiff) }}
              </td>
              <td>{{ formatPercent(statistics?.stdDev.taxationDegreeDiff) }}</td>
            </tr>

            <!-- Real Withdrawal -->
            <tr>
              <th rowspan="3" class="align-middle" scope="row">Uttag reellt (sista året)</th>
              <th scope="row">ISK</th>
              <td>{{ formatNumber(statistics?.percentile5.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.median.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.mean.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.realWithdrawalISK) }}</td>
            </tr>
            <tr>
              <th scope="row">VP</th>
              <td>{{ formatNumber(statistics?.percentile5.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.median.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.mean.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.realWithdrawalVP) }}</td>
            </tr>
            <tr>
              <th scope="row">Fördel ISK</th>
              <td :class="getDiffClass(statistics?.percentile5.realWithdrawalDiff)">
                {{ formatNumber(statistics?.percentile5.realWithdrawalDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile25.realWithdrawalDiff)">
                {{ formatNumber(statistics?.percentile25.realWithdrawalDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.median.realWithdrawalDiff)">
                {{ formatNumber(statistics?.median.realWithdrawalDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile75.realWithdrawalDiff)">
                {{ formatNumber(statistics?.percentile75.realWithdrawalDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.percentile95.realWithdrawalDiff)">
                {{ formatNumber(statistics?.percentile95.realWithdrawalDiff) }}
              </td>
              <td :class="getDiffClass(statistics?.mean.realWithdrawalDiff)">
                {{ formatNumber(statistics?.mean.realWithdrawalDiff) }}
              </td>
              <td>{{ formatNumber(statistics?.stdDev.realWithdrawalDiff) }}</td>
            </tr>

            <!-- Annual Averages -->
            <tr class="table-light">
              <th rowspan="3" class="align-middle" scope="row">Genomsnitt per år</th>
              <th scope="row">Avkastning</th>
              <td>{{ formatPercent(statistics?.percentile5.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.median.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.mean.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.averageDevelopment) }}</td>
            </tr>
            <tr class="table-light">
              <th scope="row">ISK-skattesats</th>
              <td>{{ formatPercent(statistics?.percentile5.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.median.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.mean.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.averageISKTaxRate) }}</td>
            </tr>
            <tr class="table-light">
              <th scope="row">Inflationstakt</th>
              <td>{{ formatPercent(statistics?.percentile5.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.median.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.mean.averageInflationRate) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.averageInflationRate) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
