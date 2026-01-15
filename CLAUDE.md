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
- Generic multi-scenario support: uses index-based access to SimulationResults.statistics[] and labels[]
- Color-coded cells using COLORS array (hex with 20% opacity) for best-performing scenario in each metric
- Helper functions: getValue(), getBestScenario(), getCellStyle() for dynamic scenario access
- Sections: Likvid värde, Totalt värde, Betald skatt, Beskattningsgrad, Uttag (sista året), Ackumulerat uttag, Max drawdown, Längsta drawdown-period
- Average parameters across all simulations (development, inflation, ISK tax rate when applicable)
- Supports both "higher is better" (value, withdrawal) and "lower is better" (tax, drawdown) metrics

**TimeSeriesVisualization.vue**
- D3.js scatter plot with logarithmic y-axis
- Shows all simulation points (semi-transparent)
- Median lines for ISK and VP
- Filters invalid data (NaN, Infinity, negative/zero values)
- Responsive chart with window resize handling

**SimulationHistory.vue**
- Displays past simulations with key results for winning scenario only
- Winner determined by highest total value (median) across all scenarios
- Shows winner label with color coding (from COLORS array) and lists other scenario labels ("vs X, Y")
- Displays percentage comparison between winner and second-best scenario for each metric
- Color-coded percentages: green for favorable differences, red for unfavorable
- Helper functions: getWinnerIndex(), getSecondBestIndex(), getWinnerStats(), getPercentDiff()
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

**COLORS Array**:
- Shared color palette: `['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']`
- Used consistently across all visualization components
- Scenario colors assigned by index (scenario 0 = first color, etc.)
- Applied with opacity variations (e.g., 20% opacity for cell backgrounds, full opacity for chart lines)

**Time Series Chart**:
- X-axis: Year (age)
- Y-axis: Value in SEK (logarithmic scale)
- Each scenario rendered with its corresponding color from COLORS array
- Dots for individual simulations (semi-transparent) and solid lines for medians
- Opacity creates density visualization
- Invalid data filtered before rendering

**Summary Statistics**:
- Best-performing scenario in each metric highlighted with background color (20% opacity)
- Color corresponds to scenario's index in COLORS array

**Distribution Charts** (SummaryVisualization.vue):
- Vertical density lines showing value distributions
- Median lines with labels for each scenario
- Colors assigned by scenario index from COLORS array

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

- **Multi-Scenario Architecture**: Components use index-based access to support arbitrary number of scenarios, not hard-coded ISK/VP. SimulationResults contains `labels: string[]` and `statistics: SimulationStatistics[]` arrays accessed by index.
- **COLORS Array**: Shared constant defining color palette, used across all components for consistent scenario coloring
- **HTML Popover API**: Used for confirmation dialogs with manual JavaScript positioning via `beforetoggle` event
- **D3 Data Filtering**: Essential to filter out NaN/Infinity/negative values before rendering
- **Log Scale**: Better visualizes the wide range of simulation outcomes
- **Median vs Mean**: Chart shows median to be robust against outliers
- **Central Limit Theorem**: Output stddev is smaller than input stddev because it's averaging over multiple years
- **Real Values**: All withdrawal and comparison values adjusted for cumulative inflation
- **Metric Direction**: Components distinguish between "higher is better" (values, withdrawals) and "lower is better" (taxes, drawdowns) metrics for proper color coding
