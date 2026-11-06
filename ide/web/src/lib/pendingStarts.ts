// Only unresolved user commands live here. The server owns run and account state.
export type Scope = { symbols?: string[]; universe?: "pool" };
export type PendingStart = { op_id: string; candidate: string; scope: Scope };
const PREFIX = "trade.paper.pending.";
const memory = new Map<string, PendingStart>();
const identity = (candidate: string, scope: Scope) => JSON.stringify([candidate, scope.symbols ?? null, scope.universe ?? null]);

function store(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function unconfirmedStarts(): PendingStart[] {
  const storage = store();
  if (storage) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        let value: PendingStart | null;
        try { value = JSON.parse(storage.getItem(key) ?? "null") as PendingStart | null; } catch { continue; }
        if (value && typeof value.op_id === "string" && typeof value.candidate === "string" && value.scope &&
          (value.scope.symbols === undefined || (Array.isArray(value.scope.symbols) && value.scope.symbols.every((s) => typeof s === "string"))) &&
          (value.scope.universe === undefined || value.scope.universe === "pool")) memory.set(value.op_id, value);
      }
    } catch { /* blocked storage keeps this page's in-memory pending commands */ }
  }
  return [...memory.values()];
}

export function pendingStart(candidate: string, scope: Scope): PendingStart {
  const prior = unconfirmedStarts().find((p) => identity(p.candidate, p.scope) === identity(candidate, scope));
  if (prior) return prior;
  const next = { op_id: `paper-web:${crypto.randomUUID()}`, candidate, scope };
  memory.set(next.op_id, next);
  try { store()?.setItem(PREFIX + next.op_id, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}

export function confirmStart(op: string): void {
  memory.delete(op);
  try { store()?.removeItem(PREFIX + op); } catch { /* storage unavailable */ }
}
