/**
 * Compute monthly returns from raw fund price data.
 *
 * Reads public/data/<category>/extract/index.json for ISIN mappings and
 * public/data/<category>/raw/fund_<id>.json for weekly prices, then
 * resamples to month-end and computes returns.
 *
 * Output: public/fund-returns.json
 *
 * Usage: npx tsx scripts/compute-fund-returns.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_DIR = path.join(__dirname, '..', 'public', 'data')
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'fund-returns.json')

interface IndexFund {
  fund_id: string
  isin: string
  name: string
}

interface IndexFile {
  funds: IndexFund[]
}

interface PricePoint {
  x: number // Unix timestamp in milliseconds
  y: number | null
}

interface RawFundFile {
  data: {
    chart: {
      content: {
        dataSerie: PricePoint[]
      }
    }
  }
}

interface FundReturn {
  name: string
  returns: (number | null)[]
}

interface OutputData {
  dates: string[] // "YYYY-MM" format
  funds: Record<string, FundReturn>
}

function getYearMonth(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/**
 * Resample weekly prices to month-end prices.
 * Returns a Map from "YYYY-MM" to the last non-null price in that month.
 */
function resampleToMonthEnd(dataSerie: PricePoint[]): Map<string, number> {
  const monthly = new Map<string, { ts: number; price: number }>()

  for (const point of dataSerie) {
    if (point.y == null) continue
    const ym = getYearMonth(point.x)
    const existing = monthly.get(ym)
    if (!existing || point.x > existing.ts) {
      monthly.set(ym, { ts: point.x, price: point.y })
    }
  }

  const result = new Map<string, number>()
  for (const [ym, { price }] of monthly) {
    result.set(ym, price)
  }
  return result
}

/**
 * Compute monthly returns from month-end prices.
 * Returns a Map from "YYYY-MM" to the return for that month.
 */
function computeMonthlyReturns(prices: Map<string, number>): Map<string, number> {
  const sorted = [...prices.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const returns = new Map<string, number>()

  for (let i = 1; i < sorted.length; i++) {
    const [ym, price] = sorted[i]!
    const [, prevPrice] = sorted[i - 1]!
    if (prevPrice > 0) {
      returns.set(ym, (price - prevPrice) / prevPrice)
    }
  }

  return returns
}

async function main() {
  // Step 1: Scan all category directories for index.json
  const categories = fs.readdirSync(DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)

  // Build ISIN → {category, fund_id, name} map
  const fundInfo = new Map<string, { category: string; fundId: string; name: string }>()

  for (const category of categories) {
    const indexPath = path.join(DATA_DIR, category, 'extract', 'index.json')
    if (!fs.existsSync(indexPath)) continue

    const indexData: IndexFile = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
    for (const fund of indexData.funds) {
      if (!fund.isin) continue
      fundInfo.set(fund.isin, {
        category,
        fundId: fund.fund_id,
        name: fund.name,
      })
    }
  }

  console.log(`Found ${fundInfo.size} funds across ${categories.length} categories`)

  // Step 2: Read raw price data and compute monthly returns
  const allFundReturns = new Map<string, { name: string; returns: Map<string, number> }>()
  const allDates = new Set<string>()
  let skipped = 0

  for (const [isin, info] of fundInfo) {
    const rawPath = path.join(DATA_DIR, info.category, 'raw', `fund_${info.fundId}.json`)
    if (!fs.existsSync(rawPath)) {
      skipped++
      continue
    }

    try {
      const rawData: RawFundFile = JSON.parse(fs.readFileSync(rawPath, 'utf-8'))
      const dataSerie = rawData.data?.chart?.content?.dataSerie
      if (!dataSerie || dataSerie.length === 0) {
        skipped++
        continue
      }

      const monthlyPrices = resampleToMonthEnd(dataSerie)
      if (monthlyPrices.size < 3) {
        skipped++
        continue
      }

      const returns = computeMonthlyReturns(monthlyPrices)
      if (returns.size < 2) {
        skipped++
        continue
      }

      allFundReturns.set(isin, { name: info.name, returns })
      for (const ym of returns.keys()) {
        allDates.add(ym)
      }
    } catch (e) {
      console.warn(`Failed to process ${isin} (${info.name}):`, e)
      skipped++
    }
  }

  console.log(`Processed ${allFundReturns.size} funds, skipped ${skipped}`)

  // Step 3: Build aligned output
  const sortedDates = [...allDates].sort()
  const dateIndex = new Map<string, number>()
  sortedDates.forEach((d, i) => dateIndex.set(d, i))

  const funds: Record<string, FundReturn> = {}

  for (const [isin, { name, returns }] of allFundReturns) {
    const aligned: (number | null)[] = new Array(sortedDates.length).fill(null)
    for (const [ym, ret] of returns) {
      const idx = dateIndex.get(ym)
      if (idx !== undefined) {
        aligned[idx] = Math.round(ret * 1e8) / 1e8 // 8 decimal places
      }
    }

    funds[isin] = { name, returns: aligned }
  }

  const output: OutputData = {
    dates: sortedDates,
    funds,
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output))
  console.log(`Written ${OUTPUT_PATH}`)
  console.log(`  ${sortedDates.length} months (${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]})`)
  console.log(`  ${Object.keys(funds).length} funds`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
