// A poll that stops while the page is hidden: a tab in the background or a locked phone reads nothing.
/** Calls `tick` every `ms` while the page shows, and at once on showing again when a call is due. */
export function whileVisible(tick: () => void, ms: number): void {
  let last = Date.now();
  const run = () => { last = Date.now(); tick(); };
  window.setInterval(() => { if (!document.hidden) run(); }, ms);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - last >= ms) run(); });
}
