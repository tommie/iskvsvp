# iskvsvp

ISK vs VP Monte Carlo simulator — compares the tax efficiency of Swedish ISK
(Investeringssparkonto) and VP (Vanlig depå) accounts using stochastic
simulations with historical block bootstrap.

## Amortized Withdrawal (Merton's Rule)

The simulator supports PMT-based amortized withdrawals as an alternative to
fixed-rate withdrawals. Each year, the withdrawal is computed using the
annuity formula PMT(r, n, -PV, FV), where:

- **PV** = current portfolio value
- **FV** = bequest goal × initial capital × cumulative inflation (adjusted for tax drag)
- **n** = remaining withdrawal years
- **r** = certainty-equivalent return (CER)

An inflation-indexed spending floor guarantees a minimum withdrawal regardless
of portfolio performance.

### Certainty-Equivalent Return

The PMT's discount rate uses [Merton's certainty-equivalent return](https://elmwealth.com/spending-like-youll-live-forever/)
rather than the raw geometric mean:

```
r_ce = geometric_mean − (γ − 1) × σ² / 2
```

The geometric mean and variance are estimated by Monte Carlo sampling from
the same block bootstrap process the simulation uses, ensuring the PMT is
calibrated to the actual return distribution (including profile weighting and
Jensen's inequality from multi-asset portfolios).

**Why not just the geometric mean?** With γ=1 (geometric mean only), the PMT
assumes risk-neutral preferences. When the portfolio underperforms, the PMT
still plans optimistically, and the inflation floor forces withdrawals that
the PMT would rather skip. This asymmetry systematically erodes capital in
bad paths — volatile portfolios saw ~36% breakeven probability instead of the
theoretical 50%.

**Why γ=3?** Empirical estimates of CRRA risk aversion cluster around 2–4
([French, Schwert & Stambaugh 1987](https://doi.org/10.1016/0304-405X(87)90026-2): γ≈2.4;
[Tödter 2008](https://www.tandfonline.com/doi/full/10.1080/23322039.2014.990742): γ≈3.5).
We use γ=3 as a slightly conservative round value. The effect scales with
portfolio variance: low-volatility portfolios see minimal adjustment, while
volatile portfolios get a meaningful reduction that keeps the floor from
dominating.

**Limitations of the Merton framework:** γ is an exogenous preference
parameter that individuals cannot reliably self-assess.
[Risk tolerance questionnaires](https://pmc.ncbi.nlm.nih.gov/articles/PMC2856097/)
exist but produce noisy mappings to γ. The model assumes constant relative
risk aversion, while real preferences are
[state-dependent](https://www.advisorperspectives.com/articles/2025/02/10/merton-share-why-dont-use-retirement-calculators)
(risk aversion increases during crashes). Despite these limitations, the CER
adjustment is the theoretically grounded way to translate return uncertainty
into a conservative spending rate, and γ=3 produces reasonable behavior
across the portfolio configurations we tested.

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
