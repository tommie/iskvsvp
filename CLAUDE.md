# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an ISK vs VP calculator - a Swedish financial comparison tool that calculates the tax efficiency of ISK (Investeringssparkonto) versus VP (Vanlig depå) investment accounts over time.

## Architecture

The project consists of a single-page application built with:
- **Vue 3** (CDN) - Reactive framework for UI and calculations
- **Bootstrap 5** (CDN) - Styling framework
- **Vanilla JavaScript** - All computation logic in computed properties

### Key Components

**index.html** - Single HTML file containing:
1. **Input Section** - 9 editable parameters that drive all calculations
2. **Summary Section** - 4-row comparison table showing final outcomes (rows 11-15 from Excel)
3. **Year-by-Year Table** - Detailed annual breakdown showing progression over time (row 18+ from Excel)

### Data Flow

The application uses Vue's reactive computed properties:
1. User modifies input parameters (initialCapital, development, withdrawalISK, etc.)
2. `yearlyData` computed property recalculates year-by-year values iteratively
3. `summary` computed property derives final comparison from last year's data
4. Vue automatically updates the DOM

### Calculation Logic

The core financial model in `yearlyData` computed property:
- Iterates from year 0 to `yearsLater`
- For each year:
  - Calculates ISK amount: `amount * (1 + dev - withdrawal - taxRate)`
  - Calculates VP amount: `amount * (1 + dev - withdrawal)`
  - Tracks cumulative taxes, inflation adjustments
  - Computes real (inflation-adjusted) values

Key insight: ISK has ongoing tax but no capital gains tax; VP defers tax until liquidation.

## Source Data

- **xlsx/** - Original Excel workbook extracted as XML
- **sheet1-fmt.xml** - Formatted version of worksheet with line breaks for readability
- **xlsx/xl/sharedStrings.xml** - Contains Swedish labels for all fields

The Excel structure maps to HTML as:
- Rows 1-10: Input parameters
- Rows 11-15: Summary comparison table
- Row 18+: Year-by-year detail table with 26 columns

## Localization

- UI labels are in Swedish (matching original Excel)
- Code variables are in English
- Number formatting uses Swedish locale (`sv-SE`)
- Percentages and currency formatted with Swedish conventions

## Running the Application

Open `index.html` directly in any modern browser. No build step or server required.
