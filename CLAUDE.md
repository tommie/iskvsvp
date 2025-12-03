# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an ISK vs VP Monte Carlo simulator - a Swedish financial comparison tool that uses stochastic simulations to compare the tax efficiency of ISK (Investeringssparkonto) versus VP (Vanlig depå) investment accounts over time.

## Architecture

The project is built with:
- **Vue 3** with Composition API and TypeScript
- **Vite** - Build tool and dev server
- **Pinia** - State management for calculator and simulation history
- **Bootstrap 5** - Styling framework
- **D3.js** - Data visualization for time series charts

### Project Structure

```
src/
├── components/
│   ├── InputParameters.vue      - Input form with fund presets
│   ├── SummaryStatistics.vue    - Statistical results table
│   ├── TimeSeriesVisualization.vue - D3 scatter plot with median lines
│   └── SimulationHistory.vue    - History of past simulations with load/delete
├── stores/
│   ├── calculator.ts            - Main simulation state and parameters
│   └── history.ts               - Simulation history with localStorage
├── simulation.ts                - Monte Carlo simulation logic
├── types.ts                     - TypeScript interfaces
├── App.vue                      - Main app component
└── main.ts                      - App entry point
```

### Key Components

**InputParameters.vue**
- Fund preset dropdown with Swedish funds (Swedbank, Carnegie, etc.)
- Three parameter sections: Grundinställningar, Avkastning, Uttag, ISK-skattesats, Inflation, Simulering
- Progress bar during simulation
- Disabled inputs while simulation is running

**SummaryStatistics.vue**
- Shows percentiles (5th, 25th, median, 75th, 95th) plus mean and stddev
- Color-coded difference cells (green for ISK advantage, red for disadvantage)
- Sections: Likvid värde, Betald skatt, Beskattningsgrad, Uttag (sista året), Uttag (första året), Ackumulerat uttag
- Average parameters across all simulations

**TimeSeriesVisualization.vue**
- D3.js scatter plot with logarithmic y-axis
- Shows all simulation points (semi-transparent)
- Median lines for ISK and VP
- Filters invalid data (NaN, Infinity, negative/zero values)
- Responsive chart with window resize handling

**SimulationHistory.vue**
- Displays past simulations with key results
- Load button (icon) to restore parameters
- Delete button with HTML popover confirmation
- Clear all button with HTML popover confirmation
- Manual popover positioning using `beforetoggle` event

### Data Flow

1. User modifies input parameters in `InputParameters.vue`
2. Parameters bound to `useCalculatorStore()` via `storeToRefs()`
3. User clicks "Kör Monte Carlo-simulering"
4. `runSimulation()` calls `runMonteCarloSimulation()` with progress callback
5. `runSingleSimulation()` called N times (default 1000):
   - Each year generates stochastic parameters (development, inflation, ISK tax rate)
   - Applies bad year withdrawal adjustment if portfolio didn't grow
   - Updates ISK and VP amounts with constraints (non-negative, tax rate ≤100%)
   - Tracks cumulative taxes and real withdrawals
6. `calculateStatistics()` computes percentiles across all simulations
7. `extractTimeSeriesData()` flattens yearly data for visualization
8. Results saved to history store (persisted in localStorage)
9. UI updates reactively

### Simulation Logic

**Stochastic Parameters** (Box-Muller transform for normal distributions):
- Annual return: N(mean, stdDev) - user configurable
- Inflation rate: N(mean, stdDev) - user configurable
- ISK tax rate: random walk with N(0, stdDev), clamped to [1.25%, 100%]

**ISK Calculation** (per year):
```
taxISK = amountISK × iskTaxRate × capitalGainsTax
amountISK = max(0, amountISK × (1 + return - withdrawal) - taxISK)
```

**VP Calculation** (per year):
```
capitalGain = amountVP × (1 + return) - initialCapital
taxVP = max(0, capitalGain) × withdrawal × capitalGainsTax
futureTaxVP = max(0, capitalGain) × capitalGainsTax
amountVP = max(0, amountVP × (1 + return - withdrawal))
vpLiquidValue = amountVP - futureTaxVP / (1 + return)
```

**Bad Year Adjustment**:
- If portfolio value didn't increase from previous year
- Multiply withdrawal rate by `badYearWithdrawalRate` (default 100%)

**Key Constraints**:
- Account balances cannot go negative
- ISK tax rate clamped to [1.25%, 100%]

### Visualization

**Time Series Chart**:
- X-axis: Year (age)
- Y-axis: Value in SEK (logarithmic scale)
- Blue dots/line: ISK simulations and median
- Red dots/line: VP simulations and median
- Opacity creates density visualization
- Invalid data filtered before rendering

## State Management

**calculator.ts**:
- Input parameters (refs)
- Simulation state (isRunning, progress, results, statistics, timeSeriesData)
- Actions: runSimulation(), resetResults(), loadParameters()

**history.ts**:
- Stores array of past simulations with timestamp
- Persisted to localStorage
- Actions: addRecord(), deleteRecord(), clearHistory()

## Localization

- UI labels in Swedish
- Code variables and comments in English
- Number formatting uses Swedish locale (`sv-SE`)
- Percentages shown with 1 decimal (e.g., "12.3%")
- Currency shown with no decimals (e.g., "50 000 000 kr")

## Key Dependencies

- `vue`: ^3.5.13
- `pinia`: ^2.3.0
- `d3`: ^7.9.0
- `bootstrap`: ^5.3.3
- `typescript`: ^5.7.3
- `vite`: ^6.0.7

## Development

```bash
npm install
npm run dev     # Start dev server on http://localhost:5173
npm run build   # Build for production
npm run preview # Preview production build
```

## Technical Notes

- **HTML Popover API**: Used for confirmation dialogs with manual JavaScript positioning via `beforetoggle` event
- **D3 Data Filtering**: Essential to filter out NaN/Infinity/negative values before rendering
- **Log Scale**: Better visualizes the wide range of simulation outcomes
- **Median vs Mean**: Chart shows median to be robust against outliers
- **Central Limit Theorem**: Output stddev is smaller than input stddev because it's averaging over multiple years
- **Real Values**: All withdrawal and comparison values adjusted for cumulative inflation
