<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

import { useCalculatorStore } from '../stores/calculator'
import type { ScenarioParameter } from '../types'

const store = useCalculatorStore()
const { scenarioTable, controlledParameters } = storeToRefs(store)

// Convert controlled parameters Set to Array for rendering
const controlledParamsArray = computed(() => Array.from(controlledParameters.value))

// Generate unique popover IDs for each parameter
const getDeleteParamPopoverId = (param: ScenarioParameter) => `delete-param-popover-${param}`

// Generate unique popover IDs for each scenario
const getDeleteScenarioPopoverId = (scenarioIdx: number) => `delete-scenario-popover-${scenarioIdx}`

// Human-readable labels for parameters
const parameterLabels: Record<string, string> = {
  accountType: 'Kontotyp',
  initialCapital: 'Startkapital',
  startYear: 'Ålder vid start',
  yearsLater: 'Antal år',
  simulationCount: 'Antal simuleringar',
  assetRebalanceFrequency: 'Ombalansering',
  balanceWithdrawalRate: 'Balansuttag (%)',
  profitWithdrawalRate: 'Vinstuttag (%)',
  profitLookbackYears: 'Lookback år',
  inflationBasedWithdrawal: 'Inflationsjusterat uttag',
  vpWealthTaxRate: 'VP fondskatt (%)',
  capitalGainsTaxRate: 'Kapitalvinstskatt (%)',
  iskTaxRate: 'ISK skattesats (%)',
  iskTaxRateStdDev: 'ISK skattesats stddev',
  inflationRate: 'Inflation (%)',
  inflationStdDev: 'Inflation stddev',
}

function getParameterLabel(param: string): string {
  // Check if it's an asset property parameter
  if (/^assets\.(expectedReturn|volatility|weight)\.\d+$/.test(param)) {
    const match = param.match(/^assets\.(expectedReturn|volatility|weight)\.(\d+)$/)
    if (match) {
      const property = match[1]!
      const index = parseInt(match[2]!, 10)
      const assetName = store.assets[index]?.name ?? `Tillgång ${index + 1}`

      const propertyLabels: Record<string, string> = {
        expectedReturn: 'Avkastning (%)',
        volatility: 'Volatilitet (%)',
        weight: 'Vikt',
      }

      return `${assetName}: ${propertyLabels[property] ?? property}`
    }
  }

  return parameterLabels[param] ?? param
}

function formatValue(param: ScenarioParameter, value: any): string {
  if (value === undefined || value === null) return ''

  // Format account type
  if (param === 'accountType') {
    return value
  }

  // Check if it's an asset property parameter
  if (
    typeof param === 'string' &&
    /^assets\.(expectedReturn|volatility|weight)\.\d+$/.test(param)
  ) {
    const match = param.match(/^assets\.(expectedReturn|volatility|weight)\.(\d+)$/)
    if (match) {
      const property = match[1]!
      if (property === 'expectedReturn' || property === 'volatility') {
        // Percentages
        return (value * 100).toFixed(2)
      } else {
        // Weight (plain number)
        return String(value)
      }
    }
  }

  // Format percentages (convert to percentage and format)
  if (
    param === 'balanceWithdrawalRate' ||
    param === 'profitWithdrawalRate' ||
    param === 'vpWealthTaxRate' ||
    param === 'capitalGainsTaxRate' ||
    param === 'iskTaxRate' ||
    param === 'inflationRate' ||
    param === 'iskTaxRateStdDev' ||
    param === 'inflationStdDev'
  ) {
    return (value * 100).toFixed(2)
  }

  // Format rebalance frequency
  if (param === 'assetRebalanceFrequency') {
    return value === 'never' ? 'Aldrig' : 'Årligen'
  }

  // Format numbers
  if (typeof value === 'number') {
    return String(value)
  }

  return String(value)
}

function parseValue(param: ScenarioParameter, inputValue: string): any {
  // Check if it's an asset property parameter
  if (
    typeof param === 'string' &&
    /^assets\.(expectedReturn|volatility|weight)\.\d+$/.test(param)
  ) {
    const match = param.match(/^assets\.(expectedReturn|volatility|weight)\.(\d+)$/)
    if (match) {
      const property = match[1]!
      if (property === 'expectedReturn' || property === 'volatility') {
        // Percentages
        return parseFloat(inputValue) / 100
      } else {
        // Weight (plain number)
        return parseFloat(inputValue)
      }
    }
  }

  // Parse percentages
  if (
    param === 'balanceWithdrawalRate' ||
    param === 'profitWithdrawalRate' ||
    param === 'vpWealthTaxRate' ||
    param === 'capitalGainsTaxRate' ||
    param === 'iskTaxRate' ||
    param === 'inflationRate' ||
    param === 'iskTaxRateStdDev' ||
    param === 'inflationStdDev'
  ) {
    return parseFloat(inputValue) / 100
  }

  // Parse integers
  if (
    param === 'initialCapital' ||
    param === 'startYear' ||
    param === 'yearsLater' ||
    param === 'simulationCount' ||
    param === 'profitLookbackYears' ||
    param === 'inflationBasedWithdrawal'
  ) {
    return parseInt(inputValue, 10)
  }

  return inputValue
}

function handleUpdateValue(scenarioIdx: number, param: ScenarioParameter, event: Event) {
  const target = event.target as HTMLInputElement
  const value = parseValue(param, target.value)
  store.updateScenarioValue(scenarioIdx, param, value)
}

function handleUpdateLabel(scenarioIdx: number, event: Event) {
  const target = event.target as HTMLInputElement
  store.updateScenarioLabel(scenarioIdx, target.value)
}

// Handle input in the "new scenario" row
function handleNewScenarioInput(event: Event) {
  const target = event.target as HTMLInputElement
  const label = target.value.trim()

  if (label) {
    // Create new scenario with the entered label
    store.addScenario(label)
    // Clear the input (it will be replaced by a new empty row)
    target.value = ''
  }
}

// Position popover relative to anchor button
const positionPopover = (popoverId: string, anchorId: string) => {
  const popover = document.getElementById(popoverId)
  const anchor = document.getElementById(anchorId)

  if (!popover || !anchor) return

  const anchorRect = anchor.getBoundingClientRect()

  // Position popover below the anchor button
  popover.style.position = 'fixed'
  popover.style.top = `${anchorRect.bottom + 4}px`
  popover.style.left = `${anchorRect.left}px`
}

// Confirm parameter removal
const confirmRemoveParameter = (param: ScenarioParameter, event: Event) => {
  store.removeParameterFromTable(param)

  // Close the popover
  const popover = (event.target as HTMLElement).closest('[popover]') as HTMLElement
  if (popover) popover.hidePopover()
}

// Confirm scenario removal
const confirmRemoveScenario = (scenarioIdx: number, event: Event) => {
  store.removeScenario(scenarioIdx)

  // Close the popover
  const popover = (event.target as HTMLElement).closest('[popover]') as HTMLElement
  if (popover) popover.hidePopover()
}
</script>

<template>
  <div v-if="scenarioTable" class="scenario-table-container">
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h5 class="mb-0">Scenariotabell</h5>
      <div>
        <button
          type="button"
          class="btn btn-sm btn-outline-danger"
          @click="store.disableScenarioTable()"
        >
          Stäng tabell
        </button>
      </div>
    </div>

    <div
      v-if="store.isAddToTableMode"
      class="alert alert-info mb-3 d-flex justify-content-between align-items-center"
    >
      <span>Klicka på inmatningsfält i parametersektionen för att lägga till dem i tabellen.</span>
      <button type="button" class="btn btn-sm btn-primary" @click="store.toggleAddToTableMode()">
        Klar
      </button>
    </div>

    <div class="table-responsive">
      <table class="table table-bordered table-hover">
        <thead class="table-light">
          <tr>
            <th class="scenario-label-col">Scenario</th>
            <th v-for="param in controlledParamsArray" :key="param" class="param-col">
              <div class="d-flex align-items-center gap-2">
                <span>{{ getParameterLabel(param) }}</span>
                <button
                  :id="`delete-param-btn-${param}`"
                  type="button"
                  class="btn btn-sm btn-icon text-danger"
                  :popovertarget="getDeleteParamPopoverId(param)"
                  title="Ta bort parameter"
                >
                  ✕
                </button>
                <div
                  :id="getDeleteParamPopoverId(param)"
                  popover
                  class="confirm-popover-content"
                  @beforetoggle="
                    (e: any) =>
                      e.newState === 'open' &&
                      positionPopover(getDeleteParamPopoverId(param), `delete-param-btn-${param}`)
                  "
                >
                  <p class="mb-2 small">Ta bort {{ getParameterLabel(param) }} från tabellen?</p>
                  <div class="d-flex gap-2">
                    <button
                      class="btn btn-sm btn-danger"
                      @click="confirmRemoveParameter(param, $event)"
                    >
                      Ta bort
                    </button>
                    <button
                      class="btn btn-sm btn-secondary"
                      :popovertarget="getDeleteParamPopoverId(param)"
                    >
                      Avbryt
                    </button>
                  </div>
                </div>
              </div>
            </th>
            <th class="add-param-col">
              <button
                v-if="!store.isAddToTableMode"
                type="button"
                class="btn btn-primary btn-icon"
                @click="store.toggleAddToTableMode()"
                title="Lägg till parameter"
              >
                +
              </button>
            </th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(scenario, idx) in scenarioTable.scenarios" :key="idx">
            <td>
              <input
                type="text"
                class="form-control form-control-sm"
                :value="scenario.label"
                @input="handleUpdateLabel(idx, $event)"
              />
            </td>
            <td v-for="param in controlledParamsArray" :key="param">
              <select
                v-if="param === 'accountType'"
                class="form-select form-select-sm"
                :value="scenario.parameters[param] || 'ISK'"
                @change="handleUpdateValue(idx, param, $event)"
              >
                <option value="ISK">ISK</option>
                <option value="VP">VP</option>
              </select>
              <input
                v-else-if="param === 'assetRebalanceFrequency'"
                type="text"
                class="form-control form-control-sm"
                :value="formatValue(param, scenario.parameters[param])"
                disabled
                title="Ändra detta fält via parametersektionen"
              />
              <input
                v-else
                type="number"
                step="any"
                class="form-control form-control-sm"
                :value="formatValue(param, scenario.parameters[param])"
                @input="handleUpdateValue(idx, param, $event)"
              />
            </td>
            <td></td>
            <td>
              <button
                :id="`delete-scenario-btn-${idx}`"
                type="button"
                class="btn btn-sm btn-icon text-danger"
                :disabled="scenarioTable.scenarios.length <= 1"
                :popovertarget="getDeleteScenarioPopoverId(idx)"
                title="Ta bort scenario"
              >
                ✕
              </button>
              <div
                :id="getDeleteScenarioPopoverId(idx)"
                popover
                class="confirm-popover-content"
                @beforetoggle="
                  (e: any) =>
                    e.newState === 'open' &&
                    positionPopover(getDeleteScenarioPopoverId(idx), `delete-scenario-btn-${idx}`)
                "
              >
                <p class="mb-2 small">Ta bort scenario "{{ scenario.label }}"?</p>
                <div class="d-flex gap-2">
                  <button class="btn btn-sm btn-danger" @click="confirmRemoveScenario(idx, $event)">
                    Ta bort
                  </button>
                  <button
                    class="btn btn-sm btn-secondary"
                    :popovertarget="getDeleteScenarioPopoverId(idx)"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            </td>
          </tr>
          <!-- New scenario row -->
          <tr class="new-scenario-row">
            <td>
              <input
                type="text"
                class="form-control form-control-sm"
                placeholder="Name for new scenario"
                @change="handleNewScenarioInput"
              />
            </td>
            <td v-for="param in controlledParamsArray" :key="param"></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="controlledParamsArray.length === 0" class="alert alert-warning">
      Inga parametrar har lagts till i tabellen ännu. Klicka på "Lägg till parametrar" och klicka
      sedan på inmatningsfält för att lägga till dem.
    </div>
  </div>
</template>

<style scoped>
/* Icon button - link style without underline, zero padding */
.btn-icon {
  border: none;
  font-size: 1rem;
  line-height: 1;
  text-decoration: none;
}

.btn-icon:hover {
  text-decoration: none;
}

.btn-icon:focus {
  outline: none;
  box-shadow: none;
}

.scenario-table-container {
  margin-bottom: 2rem;
}

.scenario-label-col {
  width: 100%;
}

.param-col {
  min-width: 100px;
}

.add-param-col {
  width: 50px;
}

.actions-col {
  width: 40px;
}

.confirm-popover-content {
  padding: 1rem;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 0.375rem;
  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
  max-width: 300px;
  inset: unset;
}

.confirm-popover-content::backdrop {
  background: rgba(0, 0, 0, 0.1);
}

.confirm-popover-content p {
  margin: 0;
}

.new-scenario-row {
  background-color: #f8f9fa;
}

.new-scenario-row input::placeholder {
  font-style: italic;
  opacity: 0.6;
}
</style>
