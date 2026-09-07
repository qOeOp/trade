import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);

function mobileRule(css, selector) {
  const mobileStart = css.indexOf("@media (max-width: 767px)");
  const mobileEnd = css.indexOf("@media (prefers-reduced-motion", mobileStart);
  assert.ok(mobileStart >= 0 && mobileEnd > mobileStart, "mobile shell media block must exist");
  const mobile = css.slice(mobileStart, mobileEnd);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = mobile.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u"));
  assert.ok(match, `missing mobile rule ${selector}`);
  return match[1];
}

test("mobile shell keeps one bounded viewport instead of returning scroll to the document", async () => {
  const css = await readFile(cssUrl, "utf8");
  const shell = mobileRule(css, ".dashboard-shell");
  const main = mobileRule(css, ".main-column");
  const viewport = mobileRule(css, ".page-viewport");

  assert.match(shell, /height:\s*100vh;\s*height:\s*100dvh;/u);
  assert.match(shell, /overflow:\s*hidden;/u);
  assert.match(main, /min-height:\s*0;/u);
  assert.match(main, /overflow:\s*hidden;/u);
  assert.match(viewport, /overflow:\s*auto;/u);
  assert.match(viewport, /overscroll-behavior:\s*contain;/u);
  assert.doesNotMatch(viewport, /overflow:\s*visible/u);
});

test("mobile dock clearance scrolls with content and honors the device safe area", async () => {
  const css = await readFile(cssUrl, "utf8");
  const shell = mobileRule(css, ".dashboard-shell");
  const viewport = mobileRule(css, ".page-viewport");
  const dock = mobileRule(css, ".mobile-tab-dock");

  assert.match(shell, /--mobile-dock-clearance:\s*calc\(80px \+ env\(safe-area-inset-bottom, 0px\)\)/u);
  assert.match(viewport, /margin:\s*12px;/u);
  assert.match(viewport, /padding:\s*12px 12px var\(--mobile-dock-clearance\);/u);
  assert.doesNotMatch(viewport, /margin:[^;]*mobile-dock-clearance/u);
  assert.match(dock, /bottom:\s*max\(12px, env\(safe-area-inset-bottom, 0px\)\)/u);
});
