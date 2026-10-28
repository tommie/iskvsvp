# iskvsvp

ISK vs VP Monte Carlo simulator — compares the tax efficiency of Swedish ISK
(Investeringssparkonto) and VP (Vanlig depå) accounts using stochastic
simulations of correlated asset-class returns.

## Withdrawal rule (ARVA on the surplus)

The household enters a **need** and an **extra**, both annual and in today's
money. The need is paid whenever the portfolio can pay it. The extra is paid
only out of the balance above what the remaining needs and the bequest would
take. Each year:

1. Reserve the discounted value of the remaining need commitments, and of the
   bequest target.
2. Spread any surplus over the extra still to come, in the shape the household
   drew it.
3. Pay `need + clamp(surplus / annuity, 0, extra)`.

An extra of zero is a fixed, inflation-indexed withdrawal.

This is [Waring & Siegel's ARVA](https://www.cfapubs.org/doi/abs/10.2469/faj.v71.n1.3)
(annually recalculated virtual annuity) applied to the surplus alone. Plain
ARVA spends wealth divided by an annuity factor and has no floor; applied to
the surplus it gives a guaranteed need and a discretionary part that cannot run
dry.

**How it differs from Merton.** Merton derives both the spending share and the
risky share from one preference parameter, γ. ARVA keeps only the annuity form
and takes the allocation as given. Here the rate that discounts the need is not
a certainty-equivalent return, which would need a γ, but a *quantile* of the
portfolio's own compound return: safety-first pricing of a hard floor. At the
full horizon the 25th percentile is roughly what γ≈3 gives, but its haircut
shrinks as 1/√T with the distance to the payment, where γ's does not, so a
near payment is priced more cautiously than a distant one.

- Each commitment is discounted at the 25th percentile of the annualised
  compound return **over its own distance**, less the proportional tax drag.
- The bequest is discounted at the **median** instead. Missing it is not
  failure, so it is not priced as a floor.
- In a VP account a sale also pays tax on its gain, so the balance needed to
  deliver a krona of cash is `1 / (1 - g·r)`, with `g` the unrealised gain
  fraction and `r` the rate. Only the schablon drag goes in the discount rate;
  charging the gain tax in both would reserve a plan into never spending.

The rule depends on the balance and the years remaining alone. Rebuilding the
plan a year later from the balance actually reached therefore pays exactly what
the original plan would have paid in that state, which is what makes advancing
the start year a consistent way to get next year's budget.

The same rule, validated against a density-propagation engine on a 9 mkr, 40 year
plan, runs in the Kapitalplanerare on the `planner` branch: survival of the need
alone about 90%, of the dynamic rule about 86%, and expected spending 7.8 and
10.8 mkr from both engines.

## Age-Adjusted Spending

The need and extra can optionally be modulated by an
age-dependent spending curve. Retirement spending follows a well-documented
decline: real expenditures peak around age 45–50 and fall to roughly 65–70%
of peak by age 80+.

### Spending curve

A piecewise-linear curve through five nodes, chosen so that linear
interpolation exactly preserves the
[Eurostat HBS](https://ec.europa.eu/eurostat/databrowser/view/hbs_exp_t135/)
bucket averages for Sweden (average of segment endpoints = bucket mean):

| Age | Multiplier | Eurostat bucket preserved |
|-----|-----------|--------------------------|
| 30  | 0.84      | 30–44 avg = 0.96         |
| 45  | 1.08      | ↑                        |
| 50  | 1.08      | 45–59 avg = 1.00         |
| 60  | 0.84      | ↑ and 60+ avg = 0.77     |
| 80  | 0.70      | ↑                        |

Peak placement at age 50 is cross-validated by the
[BLS Consumer Expenditure Survey](https://fred.stlouisfed.org/series/CXUTOTALEXPLB0405M)
(US, 2024), which shows peak spending in the 45–54 bracket. The post-peak
decline rate is consistent with
[Blanchett (2014)](https://www.morningstar.com/content/dam/marketing/shared/research/foundational/677785-EstimatingTrueCostRetirement.pdf),
who finds ~1–2%/year real spending decline in US retirees.

The curve is applied as a multiplier on the need and the extra, which also
shapes how the surplus is spread over the extra. Values below 30 clamp
to f(30); values above 80 clamp to f(80). The "start year" field is
interpreted as the user's age when this feature is enabled.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd) 
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
yarn
```

### Compile and Hot-Reload for Development

```sh
yarn dev
```

### Type-Check, Compile and Minify for Production

```sh
yarn build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
yarn test:unit
```

### Lint with [ESLint](https://eslint.org/)

```sh
yarn lint
```
