export interface FundingEvent {
  timestamp: string
  value: number
}

interface FundingEventIndex {
  timestamps: number[]
  prefixValues: number[]
}

const fundingEventIndexCache = new WeakMap<FundingEvent[], FundingEventIndex>()

export function indexFundingEvents(events: FundingEvent[]): FundingEventIndex {
  const cached = fundingEventIndexCache.get(events)
  if (cached) return cached
  const normalized = events
    .map((event) => ({ timestamp: Date.parse(event.timestamp), value: event.value }))
    .filter((event) => Number.isFinite(event.timestamp) && Number.isFinite(event.value))
    .sort((a, b) => a.timestamp - b.timestamp)
  const timestamps = normalized.map((event) => event.timestamp)
  const prefixValues = [0]
  for (const event of normalized) {
    prefixValues.push(prefixValues[prefixValues.length - 1] + event.value)
  }
  const index = { timestamps, prefixValues }
  fundingEventIndexCache.set(events, index)
  return index
}

export function fundingEventRangeSum(events: FundingEvent[], startExclusive: number, endInclusive: number): number {
  if (events.length === 0 || endInclusive <= startExclusive) return 0
  const index = indexFundingEvents(events)
  const start = upperBound(index.timestamps, startExclusive)
  const end = upperBound(index.timestamps, endInclusive)
  return index.prefixValues[end] - index.prefixValues[start]
}

export function trailingFundingAverage(events: FundingEvent[], timestampInclusive: number, count: number): { average: number; count: number } | null {
  if (events.length === 0 || count <= 0) return null
  const index = indexFundingEvents(events)
  const end = upperBound(index.timestamps, timestampInclusive)
  const start = Math.max(0, end - count)
  const actualCount = end - start
  if (actualCount < count) return null
  const sum = index.prefixValues[end] - index.prefixValues[start]
  return { average: sum / actualCount, count: actualCount }
}

function upperBound(values: number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (values[mid] <= target) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}
