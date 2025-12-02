<script setup lang="ts">
import { useCalculatorStore } from '../stores/calculator'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const store = useCalculatorStore()
const { statistics } = storeToRefs(store)

const formatNumber = (value: number | undefined): string => {
  if (value == null || isNaN(value)) return '-'
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

const formatPercent = (value: number | undefined): string => {
  if (value == null || isNaN(value)) return '-'
  return new Intl.NumberFormat('sv-SE', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value)
}

const hasResults = computed(() => statistics.value !== null)
</script>

<template>
  <div class="card mb-4" v-if="hasResults">
    <div class="card-header">
      <h3>Summary Statistics</h3>
      <p class="mb-0 text-muted">Statistics across all simulations</p>
    </div>
    <div class="card-body">
      <div class="table-responsive">
        <table class="table table-bordered table-hover">
          <thead class="table-light">
            <tr>
              <th rowspan="2" class="align-middle">Metric</th>
              <th rowspan="2" class="align-middle">Account</th>
              <th colspan="5" class="text-center">Percentiles</th>
              <th rowspan="2" class="align-middle">Mean</th>
              <th rowspan="2" class="align-middle">Std Dev</th>
            </tr>
            <tr>
              <th class="text-center">5%</th>
              <th class="text-center">25%</th>
              <th class="text-center">50%</th>
              <th class="text-center">75%</th>
              <th class="text-center">95%</th>
            </tr>
          </thead>
          <tbody>
            <!-- Liquid Value -->
            <tr>
              <td rowspan="3" class="align-middle"><strong>Likvidbelopp</strong></td>
              <td>ISK</td>
              <td>{{ formatNumber(statistics?.percentile5.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.median.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.mean.liquidValueISK) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.liquidValueISK) }}</td>
            </tr>
            <tr>
              <td>VP</td>
              <td>{{ formatNumber(statistics?.percentile5.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.median.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.mean.liquidValueVP) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.liquidValueVP) }}</td>
            </tr>
            <tr class="table-info">
              <td><strong>Fördel ISK</strong></td>
              <td>{{ formatNumber(statistics?.percentile5.liquidValueDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.liquidValueDiff) }}</td>
              <td>{{ formatNumber(statistics?.median.liquidValueDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.liquidValueDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.liquidValueDiff) }}</td>
              <td>{{ formatNumber(statistics?.mean.liquidValueDiff) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.liquidValueDiff) }}</td>
            </tr>

            <!-- Paid Tax -->
            <tr>
              <td rowspan="3" class="align-middle"><strong>Betald skatt</strong></td>
              <td>ISK</td>
              <td>{{ formatNumber(statistics?.percentile5.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.median.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.mean.paidTaxISK) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.paidTaxISK) }}</td>
            </tr>
            <tr>
              <td>VP</td>
              <td>{{ formatNumber(statistics?.percentile5.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.median.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.mean.paidTaxVP) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.paidTaxVP) }}</td>
            </tr>
            <tr class="table-warning">
              <td><strong>Skillnad</strong></td>
              <td>{{ formatNumber(statistics?.percentile5.paidTaxDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.paidTaxDiff) }}</td>
              <td>{{ formatNumber(statistics?.median.paidTaxDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.paidTaxDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.paidTaxDiff) }}</td>
              <td>{{ formatNumber(statistics?.mean.paidTaxDiff) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.paidTaxDiff) }}</td>
            </tr>

            <!-- Taxation Degree -->
            <tr>
              <td rowspan="3" class="align-middle"><strong>Beskattningsgrad</strong></td>
              <td>ISK</td>
              <td>{{ formatPercent(statistics?.percentile5.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.median.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.mean.taxationDegreeISK) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.taxationDegreeISK) }}</td>
            </tr>
            <tr>
              <td>VP</td>
              <td>{{ formatPercent(statistics?.percentile5.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.median.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.mean.taxationDegreeVP) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.taxationDegreeVP) }}</td>
            </tr>
            <tr class="table-warning">
              <td><strong>Skillnad</strong></td>
              <td>{{ formatPercent(statistics?.percentile5.taxationDegreeDiff) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.taxationDegreeDiff) }}</td>
              <td>{{ formatPercent(statistics?.median.taxationDegreeDiff) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.taxationDegreeDiff) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.taxationDegreeDiff) }}</td>
              <td>{{ formatPercent(statistics?.mean.taxationDegreeDiff) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.taxationDegreeDiff) }}</td>
            </tr>

            <!-- Real Withdrawal -->
            <tr>
              <td rowspan="3" class="align-middle"><strong>Uttag reellt (sista året)</strong></td>
              <td>ISK</td>
              <td>{{ formatNumber(statistics?.percentile5.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.median.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.mean.realWithdrawalISK) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.realWithdrawalISK) }}</td>
            </tr>
            <tr>
              <td>VP</td>
              <td>{{ formatNumber(statistics?.percentile5.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.median.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.mean.realWithdrawalVP) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.realWithdrawalVP) }}</td>
            </tr>
            <tr class="table-info">
              <td><strong>Fördel ISK</strong></td>
              <td>{{ formatNumber(statistics?.percentile5.realWithdrawalDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile25.realWithdrawalDiff) }}</td>
              <td>{{ formatNumber(statistics?.median.realWithdrawalDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile75.realWithdrawalDiff) }}</td>
              <td>{{ formatNumber(statistics?.percentile95.realWithdrawalDiff) }}</td>
              <td>{{ formatNumber(statistics?.mean.realWithdrawalDiff) }}</td>
              <td>{{ formatNumber(statistics?.stdDev.realWithdrawalDiff) }}</td>
            </tr>

            <!-- Annual Averages -->
            <tr class="table-light">
              <td rowspan="3" class="align-middle"><strong>Genomsnitt per år</strong></td>
              <td>Avkastning</td>
              <td>{{ formatPercent(statistics?.percentile5.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.median.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.mean.averageDevelopment) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.averageDevelopment) }}</td>
            </tr>
            <tr class="table-light">
              <td>ISK-skattesats</td>
              <td>{{ formatPercent(statistics?.percentile5.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile25.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.median.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile75.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.percentile95.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.mean.averageISKTaxRate) }}</td>
              <td>{{ formatPercent(statistics?.stdDev.averageISKTaxRate) }}</td>
            </tr>
            <tr class="table-light">
              <td>Inflationstakt</td>
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
.table th {
  font-size: 0.9rem;
  font-weight: 600;
}

.table td {
  font-size: 0.85rem;
}

.table-info {
  background-color: rgba(13, 202, 240, 0.1);
}

.table-warning {
  background-color: rgba(255, 193, 7, 0.1);
}
</style>
