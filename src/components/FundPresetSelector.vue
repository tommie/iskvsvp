<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface FundData {
  isin: string
  name: string
  category: string
  mu: number
  sigma: number
  alpha: number
  beta: number
  avg_outperformance: number
  r_squared: number
}

interface FundDatabase {
  funds: FundData[]
  correlations: number[][]
}

interface GroupedFund {
  fund: FundData
  index: number
}

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [payload: { fund: FundData; index: number; correlations: number[] }]
  loaded: []
}>()

const selectedFund = ref('')
const fundDatabase = ref<FundDatabase | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

// Category translations
const categoryNames: Record<string, string> = {
  emerging: 'Tillväxtmarknader',
  europe: 'Europa',
  finance: 'Finans',
  global: 'Global',
  highyield: 'Högavkastning',
  metals: 'Metaller',
  nordics: 'Norden',
  nordicsinterest: 'Nordisk ränta',
  pe: 'Private Equity',
  property: 'Fastighet',
  sweden: 'Sverige',
  tech: 'Teknik',
  usa: 'USA',
}

// Load fund data on mount
onMounted(async () => {
  try {
    const response = await fetch('/funds.json')
    if (!response.ok) {
      throw new Error('Failed to load fund database')
    }
    fundDatabase.value = await response.json()
    emit('loaded')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unknown error'
  } finally {
    loading.value = false
  }
})

// Group funds by category and sort
const groupedFunds = computed(() => {
  if (!fundDatabase.value) return []

  const groups = new Map<string, GroupedFund[]>()

  fundDatabase.value.funds.forEach((fund, index) => {
    if (!groups.has(fund.category)) {
      groups.set(fund.category, [])
    }
    groups.get(fund.category)!.push({ fund, index })
  })

  // Sort funds within each category by name
  groups.forEach((funds) => {
    funds.sort((a, b) => a.fund.name.localeCompare(b.fund.name, 'sv'))
  })

  // Convert to array and sort categories by translated name
  const sortedGroups = Array.from(groups.entries())
    .map(([category, funds]) => ({
      category,
      displayName: categoryNames[category] || category,
      funds,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'sv'))

  return sortedGroups
})

// Handle preset selection
const handleSelection = () => {
  if (!selectedFund.value || !fundDatabase.value) return

  // Find the selected fund
  for (const group of groupedFunds.value) {
    const selected = group.funds.find((f) => f.fund.name === selectedFund.value)
    if (selected) {
      // Get correlation row for this fund (lower triangular matrix)
      const correlations = fundDatabase.value.correlations[selected.index] || []

      emit('select', {
        fund: selected.fund,
        index: selected.index,
        correlations,
      })
      break
    }
  }
}

// Get correlation between two preset fund indices
const getCorrelation = (index1: number, index2: number): number => {
  if (!fundDatabase.value) return 0.5

  // Diagonal is always 1
  if (index1 === index2) return 1.0

  // Correlation matrix is lower triangular: row i has correlations with funds 0..i-1
  // So we need larger index as row, smaller as column
  const [i, j] = index1 > index2 ? [index1, index2] : [index2, index1]

  return fundDatabase.value.correlations[i]?.[j] ?? 0.5
}

// Look up fund index by name
const getFundIndexByName = (name: string): number | undefined => {
  if (!fundDatabase.value) return undefined
  const index = fundDatabase.value.funds.findIndex((f) => f.name === name)
  return index >= 0 ? index : undefined
}

// Expose methods for parent component
defineExpose({
  getCorrelation,
  getFundIndexByName,
})
</script>

<template>
  <div>
    <label class="form-label">Förinställning för vald fond</label>
    <div class="input-group">
      <select
        class="form-select"
        v-model="selectedFund"
        @change="handleSelection"
        :disabled="disabled || loading || !!error"
      >
        <option value="">
          {{ loading ? 'Laddar...' : error ? 'Fel vid laddning' : '-- Välj fond --' }}
        </option>
        <optgroup v-for="group in groupedFunds" :key="group.category" :label="group.displayName">
          <option v-for="item in group.funds" :key="item.fund.isin" :value="item.fund.name">
            {{ item.fund.name }}
          </option>
        </optgroup>
      </select>
    </div>
    <small v-if="error" class="form-text text-danger">{{ error }}</small>
  </div>
</template>
