import { atom } from "./atom";
import { sessionRequired } from "./session";
import { paperToken } from "../lib/paperApi";

export type ResearchSyncReply = {
  state: "idle" | "syncing" | "ready" | "error";
  ledger_commit: string; origin: string; changed?: boolean;
  error?: { code: string; message: string };
};
export const researchSync = atom<ResearchSyncReply | null>(null);
export const syncError = atom<string | null>(null);

export async function readResearchSync(start = false): Promise<void> {
  try {
    const response = await fetch("/api/research/sync", { cache: "no-store",
      ...(start ? { method: "POST", headers: { "x-trade-paper-token": paperToken() } } : {}),
    });
    if (response.status === 401) {
      sessionRequired.set(true);
      throw new Error("Sign in to sync research. Paper continues running.");
    }
    const body = await response.json();
    if (!response.ok) throw new Error(body.message ?? "Research sync is unavailable");
    syncError.set(null);
    if (start) researchSync.set({ ...researchSync.get()!, state: "syncing", error: undefined });
    else researchSync.set(body as ResearchSyncReply);
  } catch (error) {
    syncError.set(error instanceof Error ? error.message : String(error));
  }
}
