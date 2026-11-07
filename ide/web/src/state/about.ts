// What this deployment runs, read each time the About panel opens.
import { paperApi } from "../lib/paperApi";
import type { About, PaperHealth } from "../model/about";
import { atom, useAtom } from "./atom";

export type Reading = { kind: "reading" } | { kind: "ready"; about: About } | { kind: "unavailable"; message: string };
const about = atom<Reading>({ kind: "reading" });
const paperHealth = atom<PaperHealth | null>(null);
export const useAbout = () => useAtom(about);
export const usePaperHealth = () => useAtom(paperHealth);

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
