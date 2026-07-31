import { projectFixture, type DepthEvent, type L2Fixture, type Level, type Snapshot } from "./projector"

export const BINANCE_PUBLIC_DEPTH_BASE = "wss://fstream.binance.com/public/stream?streams="
export const BINANCE_DEPTH_SNAPSHOT_BASE = "https://fapi.binance.com/fapi/v1/depth"

interface CaptureOptions {
  symbol: string
  eventCount: number
  timeoutMs: number
  retries: number
}

interface BinanceSnapshotPayload {
  lastUpdateId: number
  bids: Level[]
  asks: Level[]
}

export class SequenceCaptureError extends Error {}

export async function capturePublicDepthFixture(options: CaptureOptions): Promise<L2Fixture> {
  validateOptions(options)
  let lastError: unknown
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      return await captureAttempt(options, attempt)
    } catch (error) {
      lastError = error
      if (attempt < options.retries) await Bun.sleep(Math.min(1_000 * attempt, 3_000))
    }
  }
  throw new Error(`public depth capture failed after ${options.retries} attempts`, { cause: lastError })
}

export function parseDepthMessage(raw: string, expectedSymbol: string, localReceiveTimeMs: number): DepthEvent {
  const outer: unknown = JSON.parse(raw)
  const outerRecord = requireRecord(outer, "websocket message")
  const payload = "data" in outerRecord ? requireRecord(outerRecord.data, "websocket message.data") : outerRecord
  if (payload.e !== "depthUpdate") throw new Error("websocket message is not a depthUpdate")
  if (payload.s !== expectedSymbol) throw new Error(`unexpected depth symbol: ${String(payload.s)}`)
  return {
    event_time_ms: requireInteger(payload.E, "depth.E"),
    transaction_time_ms: requireInteger(payload.T, "depth.T"),
    local_receive_time_ms: requireInteger(localReceiveTimeMs, "local_receive_time_ms"),
    first_update_id: requireInteger(payload.U, "depth.U"),
    final_update_id: requireInteger(payload.u, "depth.u"),
    previous_final_update_id: requireInteger(payload.pu, "depth.pu"),
    bids: parseLevels(payload.b, "depth.b"),
    asks: parseLevels(payload.a, "depth.a"),
  }
}

export function selectContinuousEvents(snapshotLastUpdateId: number, buffered: DepthEvent[], targetCount: number): DepthEvent[] | null {
  const eligible = buffered.filter((event) => event.final_update_id >= snapshotLastUpdateId)
  const bridgeIndex = eligible.findIndex((event) => (
    event.first_update_id <= snapshotLastUpdateId && event.final_update_id >= snapshotLastUpdateId
  ))
  if (bridgeIndex < 0) {
    const first = eligible[0]
    if (first != null && first.first_update_id > snapshotLastUpdateId) {
      throw new SequenceCaptureError(`snapshot bridge missed: first U ${first.first_update_id} > lastUpdateId ${snapshotLastUpdateId}`)
    }
    return null
  }
  const selected: DepthEvent[] = []
  let previousFinalUpdateId: number | undefined
  for (const event of eligible.slice(bridgeIndex)) {
    if (previousFinalUpdateId != null && event.previous_final_update_id !== previousFinalUpdateId) {
      throw new SequenceCaptureError(`depth sequence gap: pu ${event.previous_final_update_id} != previous u ${previousFinalUpdateId}`)
    }
    selected.push(event)
    previousFinalUpdateId = event.final_update_id
    if (selected.length === targetCount) return selected
  }
  return null
}

export function buildCapturedFixture(symbol: string, snapshot: Snapshot, events: DepthEvent[], capturedAt: Date): L2Fixture {
  const timestamp = capturedAt.toISOString().replace(/[^0-9]/g, "")
  const fixture: L2Fixture = {
    schema_version: "trade.l2-bakeoff-fixture.v1",
    fixture_id: `${symbol.toLowerCase()}-public-depth-${timestamp}`,
    stream_epoch: `${symbol.toLowerCase()}-capture-${timestamp}`,
    symbol,
    snapshot,
    events,
    expected: {
      status: "complete",
      last_update_id: snapshot.last_update_id,
      applied_event_count: 0,
      book_hash: "0".repeat(64),
      bids: [],
      asks: [],
    },
  }
  fixture.expected = projectFixture(fixture)
  if (fixture.expected.status !== "complete" || fixture.expected.applied_event_count !== events.length) {
    throw new SequenceCaptureError("captured fixture did not project as one complete epoch")
  }
  return fixture
}

async function captureAttempt(options: CaptureOptions, attempt: number): Promise<L2Fixture> {
  const stream = `${options.symbol.toLowerCase()}@depth@100ms`
  const websocketUrl = `${BINANCE_PUBLIC_DEPTH_BASE}${stream}`
  const socket = new WebSocket(websocketUrl)
  const buffered: DepthEvent[] = []
  let messageError: Error | undefined
  socket.onmessage = (message) => {
    try {
      buffered.push(parseDepthMessage(messageDataToString(message.data), options.symbol, Date.now()))
    } catch (error) {
      messageError = error instanceof Error ? error : new Error(String(error))
    }
  }
  try {
    await waitForOpen(socket, options.timeoutMs)
    socket.onclose = (event) => {
      if (!event.wasClean) messageError = new Error(`Binance public depth websocket closed: ${event.code}`)
    }
    const snapshot = await fetchSnapshot(options.symbol)
    const deadline = Date.now() + options.timeoutMs
    while (Date.now() < deadline) {
      if (messageError != null) throw messageError
      const selected = selectContinuousEvents(snapshot.last_update_id, buffered, options.eventCount)
      if (selected != null) return buildCapturedFixture(options.symbol, snapshot, selected, new Date())
      await Bun.sleep(20)
    }
    throw new SequenceCaptureError(`capture attempt ${attempt} timed out after ${options.timeoutMs}ms`)
  } finally {
    socket.close(1000, "fixture complete")
  }
}

async function fetchSnapshot(symbol: string): Promise<Snapshot> {
  const url = new URL(BINANCE_DEPTH_SNAPSHOT_BASE)
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("limit", "1000")
  const response = await fetch(url, { headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`Binance depth snapshot failed: HTTP ${response.status}`)
  const payload = requireRecord(await response.json(), "depth snapshot")
  const snapshot: BinanceSnapshotPayload = {
    lastUpdateId: requireInteger(payload.lastUpdateId, "snapshot.lastUpdateId"),
    bids: parseLevels(payload.bids, "snapshot.bids"),
    asks: parseLevels(payload.asks, "snapshot.asks"),
  }
  return {
    last_update_id: snapshot.lastUpdateId,
    bids: snapshot.bids,
    asks: snapshot.asks,
  }
}

function waitForOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`websocket open timed out after ${timeoutMs}ms`)), timeoutMs)
    socket.onopen = () => {
      clearTimeout(timeout)
      resolve()
    }
    socket.onerror = () => {
      clearTimeout(timeout)
      reject(new Error("Binance public depth websocket failed"))
    }
  })
}

function messageDataToString(value: string | ArrayBuffer | SharedArrayBuffer | Blob): string {
  if (typeof value === "string") return value
  if (value instanceof Blob) throw new Error("unexpected Blob websocket payload")
  return new TextDecoder().decode(value)
}

function parseLevels(value: unknown, path: string): Level[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value.map((level, index) => {
    if (!Array.isArray(level) || level.length < 2 || typeof level[0] !== "string" || typeof level[1] !== "string") {
      throw new Error(`${path}[${index}] must contain string price and quantity`)
    }
    return [level[0], level[1]]
  })
}

function validateOptions(options: CaptureOptions): void {
  if (!/^[A-Z0-9]{5,20}$/.test(options.symbol)) throw new Error("symbol must be an uppercase Binance symbol")
  if (!Number.isSafeInteger(options.eventCount) || options.eventCount < 2 || options.eventCount > 10_000) {
    throw new Error("eventCount must be an integer between 2 and 10000")
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 600_000) {
    throw new Error("timeoutMs must be an integer between 1000 and 600000")
  }
  if (!Number.isSafeInteger(options.retries) || options.retries < 1 || options.retries > 5) {
    throw new Error("retries must be an integer between 1 and 5")
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}

function requireInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${path} must be a non-negative safe integer`)
  return value as number
}
