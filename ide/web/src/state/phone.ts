// Whether the page draws for a phone (the same bundle, another shell), which tab it shows and what it has to say
// before a view. A phone in landscape stays a phone; "Desktop layout" asks for the IDE anyway and is remembered.
import { useLayoutEffect } from "react";
import { atom, persistedAtom, useAtom } from "./atom";

const media = (query: string) => {
  const list = window.matchMedia(query), a = atom(list.matches);
  list.addEventListener("change", () => a.set(list.matches));
  return a;
};
const narrow = media("(max-width: 767px), (pointer: coarse) and (max-height: 500px)");
const landscape = media("(pointer: coarse) and (max-height: 500px)");
export const desktopLayout = persistedAtom<boolean>("rg-desktop-layout@1", false, (v): v is boolean => typeof v === "boolean");

export const useNarrow = () => useAtom(narrow);
export const useLandscape = () => useAtom(landscape);
export const usePhone = () => {
  const small = useAtom(narrow), asked = useAtom(desktopLayout);
  return small && !asked;
};
export const phoneNow = () => narrow.get() && !desktopLayout.get();

export type PhoneTab = "runs" | "research" | "market" | "agent";
const address = new URLSearchParams(window.location.search);
const asked = address.has("line") || window.location.hash === "#lines";
/** Runs when it opens; Research when the address names a line or asks for the lines. */
export const phoneTab = atom<PhoneTab>(asked ? "research" : "runs");
/** A version's page open over its line's; the address opens it when it asks for a stage (state/stage.ts). */
export const versionOpen = atom(address.has("stage"));
let pushed = false;
/** Opens the version's page as a step the browser's back returns from. */
export function openVersion(): void {
  history.pushState(null, "");
  pushed = true;
  versionOpen.set(true);
}
export function closeVersion(): void {
  if (pushed) history.back(); else versionOpen.set(false);
}
window.addEventListener("popstate", () => { pushed = false; versionOpen.set(false); });

export type LineTab = "graph" | "versions" | "readings" | "table" | "gaps";
/** What a line's page shows under its recommendation, as it was on coming back from a version. */
export const lineTab = atom<LineTab>("graph");

export type ViewStatus = { text: string; busy: boolean; choices?: { label: string; href: string }[] };
export const viewStatus = atom<ViewStatus>({ text: "", busy: true });

/** Marks the page a phone's, for the sizes of theme/tokens.css, while this shell shows. */
export function usePhoneRoot(): void {
  useLayoutEffect(() => {
    document.documentElement.dataset.phone = "";
    return () => { delete document.documentElement.dataset.phone; };
  }, []);
}
