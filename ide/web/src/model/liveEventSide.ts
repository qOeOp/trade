import type { LiveEventRow } from "../lib/liveTradingDto";

const orderKey = (row: LiveEventRow) => row.instrument_id && row.client_order_id
  ? JSON.stringify([row.instrument_id, row.client_order_id]) : null;

/** Direction is immutable for one order. This is display context, never reconstructed order state. */
export function eventSideReader(kind: "Order" | "Position", rows: readonly LiveEventRow[]) {
  const sides = new Map<string, "BUY" | "SELL" | null>();
  if (kind === "Order") for (const row of rows) {
    const key = orderKey(row);
    if (key === null || row.order_side == null) continue;
    sides.set(key, sides.has(key) && sides.get(key) !== row.order_side ? null : row.order_side);
  }
  return (row: LiveEventRow): string | null | undefined => {
    // Explicit invalid/null values remain unknown; only absent native fields use order context.
    if (row.order_side !== undefined) return row.order_side;
    if (row.side !== undefined) return row.side;
    const key = orderKey(row);
    return kind === "Order" && key !== null ? sides.get(key) : undefined;
  };
}
