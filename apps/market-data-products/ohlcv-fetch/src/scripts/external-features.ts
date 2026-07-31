import type { Point } from "./vision-archive"

type FetchJSON = (url: string) => Promise<unknown>

async function fetchDeribitDvol(currency: string, start: number, end: number, fetchJSON: FetchJSON = defaultFetch): Promise<Point[]> {
  if (currency !== "BTC" && currency !== "ETH") return []
  const values = new Map<number, number>()
  let cursor = end
  for (;;) {
    const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?${new URLSearchParams({ currency, start_timestamp: String(start), end_timestamp: String(cursor), resolution: "3600" })}`
    const payload = asRecord(await fetchJSON(url))
    const result = asRecord(payload.result)
    for (const raw of array(result.data)) {
      const row = array(raw)
      const timestamp = Number(row[0]); const close = Number(row[4])
      if (Number.isFinite(timestamp) && Number.isFinite(close)) values.set(timestamp, close)
    }
    const continuation = Number(result.continuation)
    if (!Number.isFinite(continuation) || continuation >= cursor || continuation <= start) break
    cursor = continuation
  }
  return [...values.entries()].sort(([a], [b]) => a - b).map(([timestamp, value]) => ({ timestamp: new Date(timestamp).toISOString(), value }))
}

async function fetchBrkFactors(start: number, end: number, fetchJSON: FetchJSON = defaultFetch): Promise<Record<string, Point[]>> {
  const series = ["mvrv", "sopr_24h", "active_addrs_average_24h"]
  const startDay = new Date(start).toISOString().slice(0, 10)
  const endExclusive = new Date(Math.floor(end / 86_400_000) * 86_400_000 + 86_400_000).toISOString().slice(0, 10)
  const results = await Promise.all(series.map(async (name) => {
    const url = `https://bitview.space/api/series/${name}/hour4?${new URLSearchParams({ start: startDay, end: endExclusive })}`
    const payload = asRecord(await fetchJSON(url))
    const data = array(payload.data)
    const first = Date.parse(`${startDay}T00:00:00Z`)
    const points = data.map((value, index) => ({ timestamp: new Date(first + index * 4 * 3_600_000).toISOString(), value: Number(value) }))
      .filter((item) => Number.isFinite(item.value) && Date.parse(item.timestamp) >= start && Date.parse(item.timestamp) <= end)
    return [`onchain.btc_${name}`, points] as const
  }))
  return Object.fromEntries(results)
}

async function defaultFetch(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url)
    const body = await response.text()
    if (response.ok) return JSON.parse(body)
    if (response.status < 500 || attempt === 2) throw new Error(`external feature HTTP ${response.status}: ${body.slice(0, 300)} (${url})`)
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }
  throw new Error(`external feature retry exhausted: ${url}`)
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }

export { fetchBrkFactors, fetchDeribitDvol }
