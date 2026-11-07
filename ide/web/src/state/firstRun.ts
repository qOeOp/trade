import type { Setup } from "../lib/setupApi";
import { atom } from "./atom";

/** The first start the page is asking about, with what to do once the ledger is up; null otherwise. */
export const firstRun = atom<{ setup: Setup; onReady: () => void } | null>(null);
