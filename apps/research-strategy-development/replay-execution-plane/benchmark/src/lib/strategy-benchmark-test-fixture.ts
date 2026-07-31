import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export function writeRegimeManifest(
  root: string,
  asset: number,
  phase: number,
  startIndex = 0,
  length = 1_500,
): string {
  const directory = join(root, String(asset))
  mkdirSync(directory, { recursive: true })
  let close = 100 + asset * 20
  const rows = Array.from({ length }, (_, index) => {
    const actualIndex = startIndex + index
    const regime = Math.floor((actualIndex + phase) / 120) % 2 === 0 ? 1 : -1
    const previous = close
    close *= 1 + regime * (0.0015 + asset * 0.0001)
    const timestamp = 1_600_000_000_000 + actualIndex * 14_400_000
    return [
      new Date(timestamp).toISOString(),
      timestamp,
      previous,
      Math.max(previous, close),
      Math.min(previous, close),
      close,
      1000,
    ].join(",")
  })
  const csv = ["date,timestamp,open,high,low,close,volume", ...rows].join("\n")
  writeFileSync(join(directory, "4h.csv"), csv)
  const manifestPath = join(directory, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    schema_version: 2,
    source: { provider: "test", market: "synthetic" },
    closed_candles_only: true,
    symbol: `ASSET${asset}`,
    timeframes: {
      "4h": {
        file: "4h.csv",
        content_sha256: createHash("sha256").update(csv).digest("hex"),
      },
    },
  }))
  return manifestPath
}

export function writeFundingReport(root: string, asset: number, rate: number, count = 750): string {
  const directory = join(root, String(asset))
  mkdirSync(directory, { recursive: true })
  const events = Array.from({ length: count }, (_, index) => ({
    timestamp: new Date(1_600_000_000_000 + index * 28_800_000).toISOString(),
    value: rate,
  }))
  const path = join(directory, "factors.json")
  writeFileSync(path, JSON.stringify({ data: { market_events: { funding: events } } }))
  return path
}
