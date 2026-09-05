import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trade Dashboard Foundations",
  description: "Read-only Trade Dashboard navigation and layout foundation",
};

const themeBootstrapScript = `(() => {
  try {
    const saved = window.localStorage.getItem("trade-dashboard-theme");
    const theme = saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
