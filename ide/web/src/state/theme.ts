// Light, dark or the system's; kept in storage and applied as html[data-theme].
import { useSyncExternalStore } from "react";
import { persistedAtom, useAtom } from "./atom";

export type ThemeChoice = "system" | "light" | "dark";
const CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];
export const THEME_LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

export const theme = persistedAtom<ThemeChoice>("rg-theme", "system", (v): v is ThemeChoice => CHOICES.includes(v as ThemeChoice));

function apply(choice: ThemeChoice) {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
}
apply(theme.get());
theme.subscribe(() => apply(theme.get()));

export const cycleTheme = () => theme.set(CHOICES[(CHOICES.indexOf(theme.get()) + 1) % CHOICES.length] ?? "system");
export const useTheme = () => useAtom(theme);

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
/** The theme actually shown: the choice, or the system's when following it. */
export function useResolvedTheme(): "light" | "dark" {
  const choice = useTheme();
  const systemDark = useSyncExternalStore(
    (l) => { darkQuery.addEventListener("change", l); return () => darkQuery.removeEventListener("change", l); },
    () => darkQuery.matches);
  return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}
