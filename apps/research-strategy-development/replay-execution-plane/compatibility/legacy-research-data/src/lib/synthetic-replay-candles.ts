import { writeFileSync } from "node:fs"
import { join } from "node:path"

export interface SyntheticReplayCandle {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function buildSyntheticReplayCandles(): SyntheticReplayCandle[] {
  const candles: SyntheticReplayCandle[] = []
  let close = 100
  for (let index = 0; index < 280; index += 1) {
    const trend = index < 240 ? 0.25 : 0.35
    const pullback = index > 220 && index % 8 === 0 ? -3 : 0
    const open = close
    close = close + trend + pullback
    const high = Math.max(open, close) + 0.5
    const low = Math.min(open, close) - (pullback < 0 ? Math.abs(pullback) + 0.5 : 0.4)
    candles.push({
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000 + index,
    })
  }
  return candles
}

export function writeSyntheticReplayManifest(
  directory: string,
  startTimestamp = 1_700_000_000_000,
): string {
  writeFileSync(join(directory, "4h.csv"), [
    "date,timestamp,open,high,low,close,volume",
    ...buildSyntheticReplayCandles().map((item, index) => [
      new Date(startTimestamp + index * 4 * 60 * 60 * 1000).toISOString(),
      startTimestamp + index * 4 * 60 * 60 * 1000,
      item.open,
      item.high,
      item.low,
      item.close,
      item.volume,
    ].join(",")),
  ].join("\n"))
  const manifestPath = join(directory, "manifest.json")
  writeFileSync(manifestPath, JSON.stringify({
    symbol: "BTCUSDT",
    timeframes: { "4h": { file: "4h.csv" } },
  }))
  return manifestPath
}
