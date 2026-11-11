// Whether the page draws for a phone (the same bundle, another shell), which tab it shows, which run's page is
// open and what it has to say before a view. A phone in landscape stays a phone; "Desktop layout" asks for the IDE
// for as long as the browser tab lasts, through the page loads its links make, so a phone opened later is a phone
// again. What a phone shows: docs/plans/ide-phone-scope-20261111.zh.md.
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

export type PhoneTab = "runs" | "market" | "research";
/** A run's page over the Runs tab: a Live run by its id, a paper run by its number. */
export type PhoneRun = { kind: "live"; id: string } | { kind: "paper"; id: number };

const address = new URLSearchParams(window.location.search);
const linked = (): PhoneRun | null => {
  const live = address.get("live"), paper = Number(address.get("paper"));
  return live ? { kind: "live", id: live } : paper > 0 ? { kind: "paper", id: paper } : null;
};
/** Runs when it opens; Research when the address names a line or asks for the lines. */
export const phoneTab = atom<PhoneTab>(!linked() && (address.has("line") || window.location.hash === "#lines") ? "research" : "runs");
/** The run page open, as the address names it (a Telegram message's link: ?live=<run id>). */
export const phoneRun = atom<PhoneRun | null>(linked());
export const usePhoneRun = () => useAtom(phoneRun);

let pushed = false;
/** Opens a run's page as a step the browser's back returns from. */
export function openRun(run: PhoneRun): void {
  history.pushState(null, "");
  pushed = true;
  phoneTab.set("runs");
  phoneRun.set(run);
}
export function closeRun(): void {
  if (pushed) history.back();
  else {
    phoneRun.set(null);
    // A link's run, closed: the address no longer names it, so a reload opens the Runs tab.
    const url = new URL(window.location.href);
    url.searchParams.delete("live");
    url.searchParams.delete("paper");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
}
window.addEventListener("popstate", () => { pushed = false; phoneRun.set(null); });

/** The address of what a phone shows, for the desktop: the run, else the line, else the page. */
export function desktopHref(href: string, run: PhoneRun | null, line: string | null): string {
  const url = new URL(href), keep = new URL(url.pathname, url.origin);
  if (run?.kind === "live") keep.searchParams.set("live", run.id);
  else if (run?.kind === "paper") keep.searchParams.set("run", String(run.id));
  else if (line) keep.searchParams.set("line", line);
  return keep.href;
}

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
