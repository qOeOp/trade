// A poll that stops while the page is hidden: a tab in the background or a locked phone reads nothing. It stops for
// good once the page's sign-in expired: every answer would be the same 401.
import { signedOut } from "./transport";

/** Calls `tick` every `ms` while the page shows and is signed in, and at once on showing again when a call is due. */
export function whileVisible(tick: () => void, ms: number): void {
  let last = Date.now();
  const run = () => { last = Date.now(); tick(); };
  const timer = window.setInterval(() => {
    if (signedOut()) window.clearInterval(timer);
    else if (!document.hidden) run();
  }, ms);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !signedOut() && Date.now() - last >= ms) run(); });
}
