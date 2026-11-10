// Whether the page draws for a phone (the same bundle, another shell), which tab it shows and what it has to say
// before a view. A phone in landscape stays a phone; "Desktop layout" asks for the IDE for as long as the browser tab
// lasts, through the page loads its links make, so a phone opened later is a phone again.
import { useLayoutEffect } from "react";
import { tabStorage } from "../lib/storage";
import { atom, useAtom } from "./atom";

const media = (query: string) => {
  const list = window.matchMedia(query), a = atom(list.matches);
  list.addEventListener("change", () => a.set(list.matches));
  return a;
};
const narrow = media("(max-width: 767px), (pointer: coarse) and (max-height: 500px)");
const landscape = media("(pointer: coarse) and (max-height: 500px)");
const DESKTOP_KEY = "rg-desktop-layout";
export const desktopLayout = atom(tabStorage.get(DESKTOP_KEY) !== null);
desktopLayout.subscribe(() => tabStorage.set(DESKTOP_KEY, desktopLayout.get() ? "1" : null));

export const useNarrow = () => useAtom(narrow);
export const useLandscape = () => useAtom(landscape);
export const usePhone = () => {
  const small = useAtom(narrow), asked = useAtom(desktopLayout);
  return small && !asked;
};
export const phoneNow = () => narrow.get() && !desktopLayout.get();

export type PhoneTab = "runs" | "research" | "market" | "live" | "agent";
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

type ViewStatus = { text: string; busy: boolean; choices?: { label: string; href: string }[]; next?: string[] };
export const viewStatus = atom<ViewStatus>({ text: "", busy: true });

const keyboard = atom(false);
export const useKeyboard = () => useAtom(keyboard);

/** Marks the page a phone's, for the sizes of theme/tokens.css, while this shell shows, and keeps the page on the
 *  part of the screen an open keyboard leaves (Safari leaves the layout the screen's size and scrolls it instead). */
export function usePhoneRoot(): void {
  useLayoutEffect(() => {
    const root = document.documentElement, screen = window.visualViewport;
    root.dataset.phone = "";
    root.dataset.islandActive = "";  // the one page there is: selections show as in the island in use
    // The tallest the page has been at this width: iOS 26 shrinks innerHeight with the keyboard, so only this tells.
    let wide = 0, tall = 0;
    const fit = () => {
      if (screen && screen.width !== wide) { wide = screen.width; tall = 0; }
      tall = Math.max(tall, screen?.height ?? 0);
      const typing = !!screen && screen.scale < 1.01 && tall - screen.height > 150 && !!document.activeElement?.matches("input, textarea");
      keyboard.set(typing);
      root.style.setProperty("--page-h", typing ? `${screen.height}px` : "100dvh");
      root.style.setProperty("--page-top", typing ? `${screen.offsetTop}px` : "0px");
    };
    fit();
    screen?.addEventListener("resize", fit);
    screen?.addEventListener("scroll", fit);
    return () => {
      delete root.dataset.phone;
      delete root.dataset.islandActive;
      screen?.removeEventListener("resize", fit);
      screen?.removeEventListener("scroll", fit);
    };
  }, []);
}
