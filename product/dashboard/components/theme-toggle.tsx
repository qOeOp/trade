"use client";

import * as React from "react";
import { InterfaceIcons } from "./ui/iconography";

type Theme = "light" | "dark";

const themeStorageKey = "trade-dashboard-theme";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<Theme>("light");

  React.useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const toggleTheme = () => {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(themeStorageKey, nextTheme);
    setTheme(nextTheme);
  };

  const dark = theme === "dark";

  return (
    <button
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark}
      className="theme-toggle"
      onClick={toggleTheme}
      title={dark ? "Light theme" : "Dark theme"}
      type="button"
    >
      {dark ? <InterfaceIcons.themeLight aria-hidden="true" size={16} /> : <InterfaceIcons.themeDark aria-hidden="true" size={16} />}
    </button>
  );
}
