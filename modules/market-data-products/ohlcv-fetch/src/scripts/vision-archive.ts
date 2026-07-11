import { createHash } from "node:crypto"
import { strFromU8, unzipSync } from "fflate"

type Point = { timestamp: string; value: number }
type VisionKind = "metrics" | "aggTrades" | "bookDepth"
type FetchText = (kind: VisionKind, symbol: string, date: string) => Promise<string | null>

interface VisionFeatures {
  openInterest: Point[]
  takerRatio: Point[]
  takerImbalance: Point[]
  tradeConcentration: Point[]
  depth1PctNotional: Point[]
  coverage: Record<string, unknown>
}

async function fetchVisionFeatures(symbol: string, start: number, end: number, timeframe: string, microstructureDays = 0, fetchText: FetchText = fetchVisionCsv): Promise<VisionFeatures> {
  const dates = utcDates(start, end)
  const metrics = { openInterest: [] as Point[], takerRatio: [] as Point[] }
  let metricsDays = 0
  for (let offset = 0; offset < dates.length; offset += 31) {
    const files = await mapConcurrent(dates.slice(offset, offset + 31), 12, (date) => fetchText("metrics", symbol, date))
    const available = files.filter((item): item is string => item !== null)
    const batch = aggregateMetrics(available, timeframe)
    metrics.openInterest.push(...batch.openInterest)
    metrics.takerRatio.push(...batch.takerRatio)
    metricsDays += available.length
  }
  const microDates = dates.slice(-Math.max(0, Math.min(7, microstructureDays)))
  const micro = { takerImbalance: [] as Point[], tradeConcentration: [] as Point[], depth1PctNotional: [] as Point[] }
  let aggtradesDays = 0
  let bookDepthDays = 0
  for (const date of microDates) {
    const [trades, depth] = await Promise.all([fetchText("aggTrades", symbol, date), fetchText("bookDepth", symbol, date)])
    const batch = aggregateMicrostructure(trades ? [trades] : [], depth ? [depth] : [], timeframe)
    micro.takerImbalance.push(...batch.takerImbalance)
    micro.tradeConcentration.push(...batch.tradeConcentration)
    micro.depth1PctNotional.push(...batch.depth1PctNotional)
    if (trades) aggtradesDays += 1
    if (depth) bookDepthDays += 1
  }
  return {
    ...metrics,
    ...micro,
    coverage: {
      provider: "binance-vision",
      requested_days: dates.length,
      metrics_days: metricsDays,
      microstructure_days: microDates.length,
      aggtrades_days: aggtradesDays,
      book_depth_days: bookDepthDays,
      archive_checksum_verified: true,
      raw_archives_retained: false,
    },
  }
}

function aggregateMetrics(files: string[], timeframe: string): Pick<VisionFeatures, "openInterest" | "takerRatio"> {
  const buckets = new Map<number, { last: number; oi: number; takerSum: number; takerCount: number }>()
  for (const csv of files) for (const row of rows(csv)) {
    const timestamp = Date.parse(`${row[0].replace(" ", "T")}Z`)
    const oi = Number(row[3])
    const taker = Number(row[7])
    if (!Number.isFinite(timestamp)) continue
    const key = bucket(timestamp, timeframe)
    const item = buckets.get(key) || { last: 0, oi: Number.NaN, takerSum: 0, takerCount: 0 }
    if (timestamp >= item.last && Number.isFinite(oi)) { item.last = timestamp; item.oi = oi }
    if (Number.isFinite(taker)) { item.takerSum += taker; item.takerCount += 1 }
    buckets.set(key, item)
  }
  return {
    openInterest: points(buckets, (item) => item.oi),
    takerRatio: points(buckets, (item) => item.takerCount > 0 ? item.takerSum / item.takerCount : Number.NaN),
  }
}

function aggregateMicrostructure(tradeFiles: string[], depthFiles: string[], timeframe: string): Pick<VisionFeatures, "takerImbalance" | "tradeConcentration" | "depth1PctNotional"> {
  const trades = new Map<number, { buy: number; sell: number; max: number }>()
  for (const csv of tradeFiles) for (const row of rows(csv)) {
    const timestamp = Number(row[5])
    const notional = Number(row[1]) * Number(row[2])
    if (!Number.isFinite(timestamp) || !Number.isFinite(notional)) continue
    const key = bucket(timestamp, timeframe)
    const item = trades.get(key) || { buy: 0, sell: 0, max: 0 }
    if (row[6] === "true") item.sell += notional
    else item.buy += notional
    item.max = Math.max(item.max, notional)
    trades.set(key, item)
  }
  const depth = new Map<number, { sum: number; count: number }>()
  for (const csv of depthFiles) for (const row of rows(csv)) {
    const timestamp = Date.parse(`${row[0].replace(" ", "T")}Z`)
    const percentage = Math.abs(Number(row[1]))
    const notional = Number(row[3])
    if (!Number.isFinite(timestamp) || percentage !== 1 || !Number.isFinite(notional)) continue
    const key = bucket(timestamp, timeframe)
    const item = depth.get(key) || { sum: 0, count: 0 }
    item.sum += notional; item.count += 1; depth.set(key, item)
  }
  return {
    takerImbalance: points(trades, (item) => (item.buy + item.sell) > 0 ? (item.buy - item.sell) / (item.buy + item.sell) : Number.NaN),
    tradeConcentration: points(trades, (item) => (item.buy + item.sell) > 0 ? item.max / (item.buy + item.sell) : Number.NaN),
    depth1PctNotional: points(depth, (item) => item.count > 0 ? item.sum / item.count : Number.NaN),
  }
}

async function fetchVisionCsv(kind: VisionKind, symbol: string, date: string): Promise<string | null> {
  const name = `${symbol}-${kind}-${date}.zip`
  const base = `https://data.binance.vision/data/futures/um/daily/${kind}/${symbol}/${name}`
  const [archiveResponse, checksumResponse] = await Promise.all([fetch(base), fetch(`${base}.CHECKSUM`)])
  if (archiveResponse.status === 404) return null
  if (!archiveResponse.ok || !checksumResponse.ok) throw new Error(`Binance Vision fetch failed: ${base}`)
  const bytes = new Uint8Array(await archiveResponse.arrayBuffer())
  const expected = (await checksumResponse.text()).trim().split(/\s+/)[0]
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (!expected || expected !== actual) throw new Error(`Binance Vision checksum mismatch: ${name}`)
  const files = unzipSync(bytes)
  const content = Object.values(files)[0]
  if (!content) throw new Error(`Binance Vision archive is empty: ${name}`)
  return strFromU8(content)
}

function rows(csv: string): string[][] {
  return csv.trim().split(/\r?\n/).map((line) => line.split(",")).filter((row) => Number.isFinite(Number(row[0])) || /^\d{4}-\d{2}-\d{2}/.test(row[0]))
}

function points<T>(values: Map<number, T>, read: (item: T) => number): Point[] {
  return [...values.entries()].sort(([a], [b]) => a - b).map(([timestamp, item]) => ({ timestamp: new Date(timestamp).toISOString(), value: read(item) })).filter((item) => Number.isFinite(item.value))
}

function bucket(timestamp: number, timeframe: string): number {
  const match = timeframe.match(/^(\d+)([hmd])$/)
  if (!match) throw new Error(`unsupported archive timeframe: ${timeframe}`)
  const unit = match[2] === "d" ? 86_400_000 : match[2] === "h" ? 3_600_000 : 60_000
  const size = Number(match[1]) * unit
  return Math.floor(timestamp / size) * size
}

function utcDates(start: number, end: number): string[] {
  const dates: string[] = []
  for (let cursor = Math.floor(start / 86_400_000) * 86_400_000; cursor <= end; cursor += 86_400_000) dates.push(new Date(cursor).toISOString().slice(0, 10))
  return dates
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const output = Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const index = cursor++; if (index >= items.length) return; output[index] = await task(items[index]) }
  }))
  return output
}

export { aggregateMetrics, aggregateMicrostructure, fetchVisionFeatures, utcDates, type Point, type VisionFeatures }
