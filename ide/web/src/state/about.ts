// What this deployment runs, read each time the About panel opens, and for the status bar, read every minute, the
// public copy's fault and a newer released version. A research replica (the page's trade-research-sync mark)
// publishes nothing: it has no public copy fault.
import { paperApi } from "../lib/paperApi";
import { pageFetch } from "../lib/transport";
import { polled, type Answer } from "../lib/polled";
import { publicCopyFault, releaseBehind, type About, type PaperHealth } from "../model/about";
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
const behind = atom<ReturnType<typeof releaseBehind>>(null);
export const useReleaseBehind = () => useAtom(behind);

/** Follows the public copy and the released version for the status bar; a failed read leaves the last answer (the page's
 *  own connection is reported elsewhere). */
export function detectStatus(): void {
  polled("/api/about", POLL_MS, (answer: Answer) => {
    if (!answer?.ok || !answer.body) return;
    publicCopy.set(copyFault(answer.body as About));
    behind.set(releaseBehind(answer.body as About));
  });
}

export async function readAbout(): Promise<void> {
  about.set({ kind: "reading" });
  paperApi<PaperHealth>("/health").then(paperHealth.set, () => paperHealth.set(null));
  try {
    const response = await pageFetch("/api/about", { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    about.set({ kind: "ready", about: await response.json() as About });
  } catch (error) {
    about.set({ kind: "unavailable", message: String(error) });
  }
}
