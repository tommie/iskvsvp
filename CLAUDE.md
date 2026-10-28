# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ISK vs VP Monte Carlo simulator - a Swedish financial comparison tool that uses stochastic simulations to compare the tax efficiency of ISK (Investeringssparkonto) versus VP (Vanlig depå) investment accounts over time.

## Architecture

- **Vue 3** with Composition API and TypeScript
- **Vite** - Build tool and dev server
- **Pinia** - State management for calculator and simulation history
- **Bootstrap 5** - Styling framework
- **D3.js** - Data visualization

### Project Structure

```
src/
├── components/
│   ├── InputParameters.vue      - Input form with the asset-class portfolio
│   ├── SummaryStatistics.vue    - Statistical results table
│   ├── SummaryVisualization.vue - D3 distribution charts
│   ├── TimeSeriesVisualization.vue - D3 scatter plot with median lines
│   └── SimulationHistory.vue    - History with load/delete
├── stores/
│   ├── calculator.ts            - Main simulation state and parameters
│   └── history.ts               - Simulation history with localStorage
├── assets.ts                    - Asset-class catalogue and its correlations
├── returns.ts                   - Correlated lognormal annual return sampling
├── arva.ts                      - Withdrawal rule: ARVA on the surplus
├── precision.ts                 - When enough paths have run: survival and scenario-difference intervals
├── simulation.ts                - Monte Carlo simulation logic
├── types.ts                     - TypeScript interfaces
└── utils/
    └── url-params.ts            - URL encoding/decoding for parameters
```

### Key Components

**InputParameters.vue**
- Portfolio management: add assets from the catalogue (or a hand-rolled one), remove them, edit real return, volatility, weights and the correlation matrix
- Adding a catalogue asset looks its correlations up by `presetId`; anything else gets 0.5, a visible placeholder
- An impossible correlation matrix (not positive semi-definite) disables the run button instead of being repaired

**SummaryVisualization.vue**
- D3 distribution charts with vertical density lines
- `drawChart()` accepts optional `referenceValue` to include in x-axis extent
- First year withdrawal shown as dashed reference line via `firstYearMedian` in series data

### Data Flow

1. User modifies input parameters in `InputParameters.vue`
2. Parameters bound to `useCalculatorStore()` via `storeToRefs()`
3. Simulation runs in web worker (`simulation.worker.ts`)
4. Results saved to history store (persisted in localStorage)
5. URL synced bidirectionally with parameters (search: `initUrlSync`)

### Asset Classes and Returns

- `assets.ts` holds the catalogue, following the Swedish Prognosstandard för pensioner; the reasoning for each figure is in that file's comments. No time series stand behind it, so there is no bootstrap or factor model: returns are drawn from a parametric law.
- **`expectedReturn` is a real, arithmetic mean** (`volatility` the standard deviation of the same). The catalogue's figures are the arithmetic means that reproduce the standard's compound rates, which a test pins.
- `returns.ts` draws one year at a time: correlated normals through the Cholesky factor of `assetCorrelationMatrix`, then per-asset lognormal moment-matched to the stated mean and volatility. Lognormal so a return cannot fall below -100%. Correlations apply to the underlying normals, which is slightly less than the correlation of the arithmetic returns.
- `simulation.ts` turns each real return into a nominal one with that year's inflation draw, since the portfolio, taxes and cost basis are nominal.
- `presetCorrelation` returns 1 for a class against itself, so holding a class twice gives a singular (semi-definite) matrix, which `cholesky` accepts.

### Withdrawal Rule (`arva.ts`)

- **Need** is paid whenever affordable; **extra** only out of the surplus over the reserved needs and bequest: `need + clamp(surplus / annuity, 0, extra)`. Extra 0 is the fixed inflation-indexed withdrawal, so there is no separate fixed mode. This is the Kapitalplanerare's rule (see `src/planner/propagate.ts` on the `planner` branch for the measurements behind each choice).
- Everything in `arva.ts` is real; `simulation.ts` divides the balance by cumulative inflation going in and multiplies back coming out.
- Need reserve discounts each commitment at the **p25 of the compound return over its own distance**; the bequest at the **median**. Quantile spread shrinks as 1/sqrt(T), so a single full-horizon rate prices near payments too optimistically.
- Valued at the instant of withdrawal, after that year's return: an annuity-due. The bequest discounts over `years - 1 - t` returns, so the last year's commitment is the target itself; a zero-return test cannot catch an off-by-one there, which is why the discount tests use 2%, 4% and 8%.
- VP: cash vs balance. Delivering cash W costs `W / (1 - g·r)` of balance (the gain-tax sale), so reserve and bequest are divided by `share = 1 - g·r`. Only the schablon drag belongs in the rate; charging the gain tax in both places reserves a plan into never spending. `g` is the netted, schablon-aware unrealised gain fraction.
- The schedule uses today's ISK rate for its tax drag, so the rule does not forecast how the random-walking rate moves.
- The surplus is spread in the shape drawn (`annuity[t]` = discounted remaining extra over year t's own), so a flat extra reduces to the plain count of discounted payments.
- Rebuilding a plan one year later from the balance reached pays what the original would have (tested). The bequest is therefore an absolute amount in today's money, not a share of initial capital, which would rescale on restart.
- Cross-checked against the planner's density propagation on its default plan (`simulation.spec.ts`, "agreement with the Kapitalplanerare"): need-only survival ~90%, dynamic ~86%, expected spending 7.8 and 10.8 mkr.

### Number of Simulations (`precision.ts`, `simulateAll`)

- There is no setting for the number of paths. `simulateAll` runs all scenarios path by path in batches of 250, and from 500 paths on stops as soon as survival is known to ±1 point in every scenario **and** each scenario's survival difference from the first is known to ±1 point. A wall-clock budget of 5 s (`DEFAULT_TIME_BUDGET_MS`) stops it regardless, so a limit on paths would only be a second way to stop short.
- **Survival** is the share of paths in which the need was paid in full every year (`needFunded`). Ending at zero having paid it is surviving, because the rule aims at that; the old "ended above zero" measure would have counted the rule's own target as failure.
- Intervals are for proportions, not a t-interval: Wilson for each scenario's survival (Wald collapses to zero at 0 and 1, where a comfortable plan sits), and for the difference the paired per-path outcomes (-1, 0, +1). Scenarios share seeds (`seed + i`), so path i meets the same returns in every scenario and the paired variance is far below the unpaired. One discordant path is added to the count before forming the variance, otherwise "none seen yet" reads as "perfectly measured".
- A t-test was considered and rejected for these outputs; it fits means and paired differences of continuous quantities (use log wealth), not 0/1 outcomes. Percentiles would need an order-statistic interval or a bootstrap; not done.
- The difference target is ±1 point, not ±0.5: half a point took more than 20 000 paths on a 3-point ISK/VP gap, for no change in what anyone would do. Default ISK vs VP stops at about 6 000 paths in 1.3 s; a harder plan (65% survival) at about 15 000 in 3 s.
- `convergence` on the results says how it stopped (`precision` | `time`) and the achieved half-widths; the statistics tab warns when `converged` is false. Stopping on precision is deterministic in the seed, so a shared link reproduces it; stopping on time is not.
- The budget covers the path loop; the percentile statistics computed afterwards are extra.

### Bengen Comparison (`bengenRate`)

- Each scenario also reports the **highest constant real withdrawal that survives at least 95% of paths**, with the extra, bequest and age curve switched off. It is Bengen's SAFEMAX put to the Monte Carlo: his is the highest rate that survived the worst historical sequence, and with sampled paths the worst case is a percentile (`BENGEN_SURVIVAL`). It says what the portfolio, tax and horizon can carry as a level amount, to read beside the plan's need.
- Bisection (10 halvings of 0 to 10% of the starting capital) on the first 1 000 paths of the main run, with the same seeds. Survival falls as the amount rises path by path, which is what makes bisection valid. A candidate stops at its first unfunded year (`stopAtFailure`), so only a yes/no is computed. About 0.4 s per scenario; it runs after the path loop and is not inside the 5 s budget.
- `atLeast` marks a result at the ceiling: even 10% survived, so the real figure is higher.
- Cross-checked against the planner's fixed-rule sweep: on its default plan 80% survival allows 252 000 kr/yr (200 000 need plus 52 000 extra); this gives 251 000 (2.79%).
- Tests pin the zero-return case (capital over years) and the certain-return case (the ordinary annuity, since withdrawals follow the year's return).

### Average Withdrawal Row (`withdrawalFailureAsZero`)

- The "Genomsnittligt uttag reellt per år" percentiles are over each path's total real withdrawal with a **failed plan counted as zero**, unconditional like the planner's percentiles. Counted as received, a plan that fails in year 38 of 40 keeps almost all of its average and is indistinguishable from a success, so P10 could not answer Bengen's question.
- The consequence is a cliff: the P10 is 0 whenever more than 10% of paths fail, and at least the need otherwise. That is the point: it reads "what you can count on at the 90% level". The history summary's "Genomsnittligt uttag reellt per år" uses the same figure (median), so the label means one thing everywhere. The chart of the same name (`renderAverageWithdrawalChart`) draws the same statistic, divided by the same years, under the same title: one label, one metric. Its spread is interpolated between P10, median and P90, and the scale is logarithmic, so a percentile at zero is replaced by the next one up (a zero cannot be drawn, and interpolating from it would invent positive values where the mass is at zero); if everything is zero it says so instead of rendering blank. `withdrawalFailureAsZero` is a separate statistic from `snapshots.withdrawalReal`, which stays as received; no label reads that any more.

### Tax Model (`simulation.ts`, step 5)

- **ISK**: schablon on the balance, `amount * iskTaxRate * capitalGainsTaxRate`. No CGT on withdrawals or rebalancing.
- **VP**: schablonintäkt (`amount * vpWealthTaxRate`) and all realized gains/losses are capital income in the same bucket and **net against each other before the rate is applied** (kvittning). Withdrawal and rebalancing sites therefore accumulate *signed gains* (`withdrawalGain`, `rebalancingGain`), never per-position tax.
- A net loss yields a skattereduktion: full rate on the first `LOSS_CREDIT_THRESHOLD` (100 000 kr, nominal in law and not inflation-indexed), `LOSS_CREDIT_UPPER_QUOTA` of the rate above. Modelled as a credit flowing back into the portfolio as new money (adds to value *and* cost basis), which assumes enough other final tax to absorb it.
- Paying a VP tax bill is itself a realization, so the sale is grossed up in closed form: `G = tax / (1 - u*r)`, `u` = unrealized gain fraction (floored at 0), `r` = CGT rate. This is the dominant correction over long horizons — it scales as `u` grows.
- Cost basis follows genomsnittsmetoden: every partial disposal scales `costBasis` by the same fraction as `value`.
- **Withdrawals are clamped to the balance.** The need would otherwise pay out of a depleted portfolio and produce negative balances or NaN.

### Tax Metrics

- `periodData.tax` — cash actually paid that year.
- `snapshots.tax` — cumulative cash paid **plus the CGT still embedded in the portfolio** (`capital - liquidValue`). Deliberately *not* the running sum of `periodData.tax`: a VP account defers its liability rather than escaping it (Swedish heirs inherit the acquisition cost), so counting only cash would make VP look cheap against ISK. Zero deferred component for ISK.
- `snapshots.taxationDegree` shares that numerator, over `liquidValue`.
- `liquidValue` is after-liquidation (VP subtracts embedded CGT); `capital` is the raw balance. For a "never liquidate" strategy `capital` is the relevant metric and the two can rank ISK/VP oppositely.

### Correlation Matrix

- Stored as symmetric matrix in `assetCorrelationMatrix`; diagonal always 1.0
- Editable in the UI; see "Asset Classes and Returns" for the defaults

### VP Capital Gains Tax

- `schablonGain(proceeds, basis)` is `proceeds - max(basis, 20% of proceeds)`, **signed**: schablonmetoden caps the gain per sale, but a loss stays a loss so it can net (kvittning) with gains and the schablonintäkt. A rational investor always picks the better basis.
- Withdrawals and rebalancing accumulate it into `withdrawalGain`/`rebalancingGain`. The gross-up for the sale that pays the bill and the latent tax in `liquidValue` both use the **netted sum across positions** (the gross-up floors it at 0; the liquidation does not, so a net unrealized loss is a deferred tax asset). The schablon floor is per position because it is per sale.
- `capitalGainsTax(proceeds, basis, rate)` is the unnetted, non-negative form of one sale, kept for single-sale checks.
- Whether the schablon applies to fund units (not just shares) is unverified.
- TODO: model deferred liquidation (heirs inherit basis) as a discounted/perpetuity terminal value instead of a full latent tax in `liquidValue`.

## State Management

**calculator.ts**:
- Input parameters as refs
- Scenario table support for multi-scenario comparisons
- URL synchronization (bidirectional, debounced)
- Actions: runSimulation(), loadParameters(), initUrlSync()

**history.ts**:
- Past simulations with timestamp
- Persisted to localStorage
- Actions: addRecord(), deleteRecord(), clearHistory()

## Localization

- UI labels in Swedish
- Code variables and comments in English
- Number formatting uses Swedish locale (`sv-SE`)

## Development

```bash
npm install
npm run dev     # Start dev server on http://localhost:5173
npm run build   # Build for production
npm run type-check  # TypeScript checking
```

Note: Symlink `public/data` to the fundcmp export directory before running.

## Commit Message Style

Short imperative sentences. Examples:
- "Adds fund preset selector with correlation matrix support."
- "Fixes the initial withdrawal not fitting in the chart."
- "Truncates the scenario table headers for asset parameters."

## Technical Notes

- **Multi-Scenario Architecture**: Components use index-based access to `SimulationResults.statistics[]` and `labels[]`
- **COLORS Array**: Shared palette `['#0d6efd', '#d1b101', '#6f42c1', '#fd7e14', '#dc3545', '#198754']`
- **Vue Reactivity**: Create new array/object references for nested mutations to trigger updates
- **URL Sync Cycle**: Modifying assets triggers URL encoding → decoding cycle; avoid storing derived state on assets
- **D3 Data Filtering**: Filter out NaN/Infinity/negative values before rendering
- **Log Scale**: Better visualizes wide range of simulation outcomes
