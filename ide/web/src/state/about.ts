// What this deployment runs, read each time the About panel opens, and the public copy's fault for the status
// bar, read every minute. A research replica (the page's trade-research-sync mark) publishes nothing: it has neither.
import { paperApi } from "../lib/paperApi";
import { whileVisible } from "../lib/whileVisible";
import { publicCopyFault, type About, type PaperHealth } from "../model/about";
import { atom, useAtom } from "./atom";

type Reading = { kind: "reading" } | { kind: "ready"; about: About } | { kind: "unavailable"; message: string };
const about = atom<Reading>({ kind: "reading" });
const paperHealth = atom<PaperHealth | null>(null);
export const useAbout = () => useAtom(about);
export const usePaperHealth = () => useAtom(paperHealth);

type Fault = ReturnType<typeof publicCopyFault>;
const POLL_MS = 60_000;
const isReplica = () => !!document.querySelector('meta[name="trade-research-sync"]');
const publicCopy = atom<Fault>(null);
export const usePublicCopy = () => useAtom(publicCopy);
export const copyFault = (reading: About): Fault => isReplica() ? null : publicCopyFault(reading);

async function readPublicCopy(): Promise<void> {
  try {
    const response = await fetch("/api/about", { cache: "no-store" });
    if (response.ok) publicCopy.set(copyFault(await response.json() as About));
  } catch { /* the page's own connection is reported elsewhere; the last answer stands */ }
}

/** Follows the public copy, on a deployment that publishes. */
export function detectPublicCopy(): void {
  if (isReplica()) return;
  void readPublicCopy();
  whileVisible(() => void readPublicCopy(), POLL_MS);
}

export async function readAbout(): Promise<void> {
  about.set({ kind: "reading" });
  paperApi<PaperHealth>("/health").then(paperHealth.set, () => paperHealth.set(null));
  try {
    const response = await fetch("/api/about", { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    about.set({ kind: "ready", about: await response.json() as About });
  } catch (error) {
    about.set({ kind: "unavailable", message: String(error) });
  }
}
