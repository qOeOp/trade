// Verifies a rendered page in headless Chrome over CDP (Node's built-in WebSocket; no dependency):
// screenshots in light and dark, and the layout invariants of the Islands shell (frame corners included) and VersionLine
// (fixed gaps between its parts; each badge number the same padding from the edges and the divider),
// that a narrow window keeps every island inside it and still while the pointer moves, the detail and
// the toolbar readings inside their bounds, and that
// scrollbars are thin overlay lines on the island edges; then the main interactions there (tree keys,
// the folded path, a version's context menu, a double-click opening its source, panning the canvas to its edges, a side
// closing without moving the canvas, focusing the earliest version without showing space before it, and a
// version's source opened from Sources: highlighted, growing inside the island's overlay scroll, opened once
// however often, and its diff); then the Runs page's islands in light and dark.
// Usage: node scripts/verify.mjs <page.html> <out-dir> [#version]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [page, outDir, hash = ""] = process.argv.slice(2);
if (!page || !outDir) { console.error("usage: verify.mjs <page.html> <out-dir> [#version]"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "rg-verify-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=9334", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const expect = (ok, what) => { if (!ok) failures.push(what); };

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(150); try { target = await (await fetch("http://127.0.0.1:9334/json/new?about:blank", { method: "PUT" })).json(); } catch { /* not up yet */ } }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const waiting = new Map();
  const send = (method, params = {}) => new Promise((ok) => { const n = ++id; waiting.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) waiting.get(d.id)(d.result); };
  await new Promise((ok) => (ws.onopen = ok));
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
  const report = {};
  for (const scheme of ["light", "dark"]) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await send("Page.navigate", { url: `file://${resolve(page)}${hash}` });
    await sleep(2500);
    const m = await evaluate(`(() => {
      const r = (e) => e.getBoundingClientRect();
      const islands = [...document.querySelectorAll("[data-island]")].map((e) => ({ id: e.dataset.island, radius: getComputedStyle(e).borderTopLeftRadius, ...r(e).toJSON() }));
      // per badge: the gap from each number to the badge's edges and to the divider (text box to box)
      const text = (e) => { const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect(); };
      const lines = [...document.querySelectorAll("[data-version-line]")].map((l) => {
        const at = (p) => l.querySelector('[data-part="' + p + '"]');
        const L = r(l).left, badge = at("badge"), ret = at("ret"), dd = at("dd"), mark = at("mark"), pred = at("pred"), name = at("name");
        // a version that lost eligibility has no badge; the rest of its line keeps the same gaps
        if (!badge) return { mark: +(r(mark).left - L).toFixed(1), name: +(r(name).left - r(pred).right).toFixed(1), gaps: null, sameFont: true };
        const B = r(badge), font = (e) => e && [getComputedStyle(e).fontFamily, getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight].join("|");
        const gaps = ret && dd ? (() => { const a = text(ret), b = text(dd), D = r(dd).left;
          return [a.left - B.left - 1, D - a.right, b.left - D - 1, B.right - 1 - b.right].map((x) => +x.toFixed(1)); })() : null;
        return { badge: +(B.left - L).toFixed(1), afterBadge: +(r(pred).left - B.right).toFixed(1), name: +(r(name).left - r(pred).right).toFixed(1),
                 mark: +(r(mark).left - L).toFixed(1), gaps, sameFont: !ret || font(ret) === font(dd) };
      });
      // a canvas node's content must sit at its wrapper's vertical centre (the selection fill is the wrapper)
      const offCentre = [...document.querySelectorAll(".react-flow__node")].map((n) => {
        const w = r(n.firstElementChild), l = r(n.querySelector("[data-version-line]"));
        return +Math.abs((w.top + w.bottom) / 2 - (l.top + l.bottom) / 2).toFixed(2);
      });
      // the frame's corners: stripe buttons, toolbar controls and status text share the window's edges
      const nav = (side) => [...document.querySelectorAll('nav[aria-label="' + side + '"] button')].map((e) => r(e).toJSON());
      const bar = [...document.querySelector("header").querySelectorAll("button")].map((e) => r(e).toJSON());
      const crumb = (() => { const b = document.querySelector('footer nav button'); const g = document.createRange(); g.selectNodeContents(b); return g.getBoundingClientRect(); })();
      const status = (() => { const e = document.querySelector("footer").lastElementChild.lastElementChild; const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect(); })();
      const frame = { left: nav("Left tool windows"), right: nav("Right tool windows"), bar: bar.map((b) => ({ left: b.left, right: b.right, height: b.height })),
                      crumb: crumb.left, status: innerWidth - status.right, island: r(document.querySelector("[data-island=left]")).toJSON() };
      return { islands, lines, offCentre: Math.max(0, ...offCentre), frame };
    })()`);
    report[scheme] = m;
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `${scheme}.png`), Buffer.from(shot.data, "base64"));
    for (const i of m.islands) expect(i.radius === "10px", `${scheme}: island ${i.id} radius ${i.radius}`);
    const by = Object.fromEntries(m.islands.map((i) => [i.id, i]));
    const GAP = 4; // --gap in tokens.css
    for (const id of ["editor", "left", "right", "bottom"]) expect(by[id], `${scheme}: no ${id} island`);
    if (by.editor && by.bottom) {
      expect(Math.abs(by.bottom.top - by.editor.bottom - GAP) < 0.6, `${scheme}: editor-bottom gap ${(by.bottom.top - by.editor.bottom).toFixed(1)}`);
      expect(Math.abs(by.bottom.left - by.editor.left) < 0.6 && Math.abs(by.bottom.width - by.editor.width) < 0.6, `${scheme}: editor and bottom differ in left edge or width`);
    }
    if (by.editor && by.right) expect(Math.abs(by.right.left - by.editor.right - GAP) < 0.6, `${scheme}: editor-right gap ${(by.right.left - by.editor.right).toFixed(1)}`);
    if (by.editor && by.left) expect(Math.abs(by.editor.left - by.left.right - GAP) < 0.6, `${scheme}: left-editor gap ${(by.editor.left - by.left.right).toFixed(1)}`);
    const f = m.frame, first = f.left[0], last = f.left.at(-1), near = (a, b) => Math.abs(a - b) < 0.6;
    expect(near((first.top + first.bottom) / 2, f.island.top + 20), `${scheme}: the first stripe button is off the island header's centre`);
    expect(near(f.island.bottom - last.bottom, first.top - f.island.top), `${scheme}: the stripe's last button is not inset from the island's foot as its first is from its top`);
    expect(near(f.bar[0].left, first.left) && near(f.bar.at(-1).right, f.right[0].right), `${scheme}: the toolbar's ends do not line up with the stripe buttons`);
    expect(f.bar.filter((b) => b.height !== first.height).length <= 1, `${scheme}: toolbar controls differ in height from the stripe buttons`);
    expect(near(f.crumb, f.status) && near(f.crumb, first.left + 8), `${scheme}: status bar text is ${f.crumb.toFixed(1)}px and ${f.status.toFixed(1)}px from the window's edges, not ${first.left + 8}`);
    expect(m.offCentre < 0.6, `${scheme}: a canvas node's content is ${m.offCentre}px off its vertical centre`);
    const unique = (k) => [...new Set(m.lines.filter((l) => k in l).map((l) => JSON.stringify(l[k])))];
    expect(m.lines.length > 0, `${scheme}: no VersionLine rendered`);
    for (const k of ["mark", "badge", "afterBadge", "name"]) expect(unique(k).length === 1, `${scheme}: VersionLine ${k} gaps differ: ${unique(k).join(" ")}`);
    const gaps = [...new Set(m.lines.flatMap((l) => l.gaps ?? []).map((g) => Math.round(g)))];
    expect(gaps.length === 1, `${scheme}: badge padding to edges and divider differs: ${gaps.join(" ")}`);
    expect(m.lines.every((l) => l.sameFont), `${scheme}: badge cells differ in font`);
  }
  // A narrow window: every island stays inside it, and hovering version after version in the tree
  // (which changes the status bar's readout) never moves an island.
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `file://${resolve(page)}${hash}` });
  await sleep(2500);
  const layout = `JSON.stringify({ page: document.documentElement.scrollWidth, islands: [...document.querySelectorAll("[data-island]")].map((e) => { const b = e.getBoundingClientRect(); return [e.dataset.island, Math.round(b.left), Math.round(b.right)]; }) })`;
  const narrow = JSON.parse(await evaluate(layout));
  expect(narrow.page <= 1000, `narrow: the page is ${narrow.page}px wide in a 1000px window`);
  for (const [id, , right] of narrow.islands) expect(right <= 1000, `narrow: island ${id} ends at ${right}px, past the 1000px window`);
  const rows = await evaluate(`[...document.querySelectorAll("[data-island=left] [data-version-line]")].slice(0, 30).map((e) => { const b = e.getBoundingClientRect(); return [b.left + 40, b.top + b.height / 2]; })`);
  const layouts = new Set([JSON.stringify(narrow)]);
  for (const [x, y] of rows) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await sleep(20); layouts.add(await evaluate(layout)); }
  expect(rows.length > 0, "narrow: no version tree rows to hover");
  expect(layouts.size === 1, `narrow: hovering ${rows.length} tree rows produced ${layouts.size} different layouts`);
  // Scrollbars are overlay lines on the island's edge: none native, and the tree's a 2px line at its right edge.
  const bars = await evaluate(`(() => {
    const isl = document.querySelector("[data-island=left]"), h = isl.querySelector(".os-scrollbar-vertical .os-scrollbar-handle");
    const native = [...document.querySelectorAll("[data-island] *")].filter((e) => e.offsetWidth - e.clientWidth > 2 && e.scrollHeight > e.clientHeight).length;
    return { native, edge: isl.getBoundingClientRect().right, right: h?.getBoundingClientRect().right, width: h?.getBoundingClientRect().width };
  })()`);
  expect(bars.native === 0, `scrollbars: ${bars.native} native scrollbars inside islands`);
  expect(bars.width === 2 && Math.abs(bars.right - bars.edge) < 0.6, `scrollbars: the tree's handle is ${bars.width}px wide, ${(bars.edge - bars.right).toFixed(1)}px from the island edge`);
  // Nothing spills: no detail content past its island's right edge, and every toolbar reading either
  // whole in the readout or wrapped out of sight, never cut.
  const spill = `(() => { const isl = document.querySelector("[data-island=right]"), edge = isl.getBoundingClientRect().right;
    return [...isl.querySelectorAll("*")].map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.right > edge + 0.5).length; })()`;
  const spilled = await evaluate(spill);
  expect(spilled === 0, `narrow: ${spilled} elements of the detail run past its island's edge`);
  const cut = await evaluate(`(() => { const box = document.querySelector("header .text-dense"); if (!box) return -1; const b = box.getBoundingClientRect();
    return [...box.children].map((e) => e.getBoundingClientRect()).filter((r) => r.top < b.bottom && r.right > b.right + 0.5).length; })()`);
  expect(cut === 0, `narrow: ${cut} toolbar readings cut at the readout's edge`);
  // Interactions, still in the narrow window.
  const key = async (k, code, vk) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); await sleep(200); };
  const click = async (x, y, button = "left", clickCount = 1) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount }); };
  // The version tree: the arrow keys move the selection.
  const before = await evaluate("location.hash");
  await evaluate(`document.querySelector('[data-island="left"] [role="treeitem"][data-selected]')?.focus()`);
  await key("ArrowDown", "ArrowDown", 40); await key("ArrowDown", "ArrowDown", 40); await sleep(300);
  expect((await evaluate("location.hash")) !== before, "tree: the arrow keys did not move the selection");
  // The header's Collapse all and Expand all act on the tree mounted under it.
  const treeRows = `document.querySelectorAll('[data-island="left"] [role="treeitem"]').length`;
  const headerAction = (label) => evaluate(`document.querySelector('[data-island="left"] button[aria-label="${label}"]')?.click()`);
  const open = await evaluate(treeRows);
  await headerAction("Collapse all"); await sleep(300);
  const collapsed = await evaluate(treeRows);
  await headerAction("Expand all"); await sleep(300);
  expect(collapsed < open && (await evaluate(treeRows)) === open, `tree: Collapse all and Expand all left ${open} rows at ${collapsed} and back`);
  // The status bar folds the middle of a long path into one step whose menu lists it.
  const fold = await evaluate(`(() => { const b = document.querySelector('nav[aria-label="Path"] [aria-label$="more levels"]')?.getBoundingClientRect(); return b && [b.left + b.width / 2, b.top + b.height / 2]; })()`);
  if (fold) {
    await click(fold[0], fold[1]); await sleep(300);
    expect((await evaluate(`document.querySelectorAll('[role="menuitem"]').length`)) > 0, "status bar: the folded step's menu is empty");
    await key("Escape", "Escape", 27);
  }
  // A canvas version: right-click gives its menu, double-click opens its source (Sources on the left, the file
  // in the editor) and ⌥1 brings the lineage back, the wheel pans. It is taken 60px clear of the canvas's top.
  const node = await evaluate(`(() => { const box = document.querySelector("[data-island=editor] .react-flow").getBoundingClientRect();
    const n = [...document.querySelectorAll(".react-flow__node [data-part=name]")].map((e) => e.getBoundingClientRect()).find((b) => b.left > box.left + 8 && b.left + 40 < box.right && b.top > box.top + 60 && b.bottom < box.bottom);
    return n && [n.left + 20, n.top + n.height / 2]; })()`);
  expect(node, "canvas: no version in view");
  if (node) {
    await click(node[0], node[1], "right"); await sleep(400);
    const items = await evaluate(`document.querySelectorAll('[role="menuitem"]').length`);
    expect(items === 6, `canvas: the context menu has ${items} items, not 6`);
    await key("Escape", "Escape", 27);
    await click(node[0], node[1], "left", 1); await click(node[0], node[1], "left", 2); await sleep(400);
    const opened = await evaluate(`({ left: document.querySelector("[data-island=left] h2")?.textContent,
      file: document.querySelector("[data-island=editor] [data-file]")?.textContent, tabs: document.querySelectorAll('[data-island=editor] [role="tab"]').length })`);
    expect(opened.left === "Sources" && opened.file?.endsWith(".py") && opened.tabs === 0,
           `canvas: double-click left ${opened.left} on the left, ${opened.file} in the editor's header and ${opened.tabs} tabs`);
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "1", code: "Digit1", modifiers: 1, windowsVirtualKeyCode: 49 });
    await sleep(400);
    expect(await evaluate(`!!document.querySelector("[data-island=editor] .react-flow")?.offsetParent && !document.querySelector("[data-island=editor] [data-file]")`),
           "canvas: ⌥1 did not bring the lineage back without the file's header");
    const at = `document.querySelector(".react-flow__viewport").style.transform`, from = await evaluate(at);
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: node[0], y: node[1], deltaX: 0, deltaY: 120 }); await sleep(300);
    expect((await evaluate(at)) !== from, "canvas: the wheel did not pan");
    // Panned as far as it goes, this line's content meets the canvas's top-left corner. The backdrop
    // starts at the line's content boundary, which may be hundreds of trials after trial 0.
    const edges = `(() => { const c = document.querySelector("[data-island=editor] .react-flow").getBoundingClientRect();
      const [x, y] = document.querySelector(".react-flow__viewport").style.transform.match(/-?[\\d.]+/g).map(Number);
      const backdrop = document.querySelector("[data-backdrop]"); if (!backdrop) return null;
      const rows = +backdrop.dataset.rows;
      return { left: x + parseFloat(backdrop.style.left), top: y - 15, bottom: c.height - (y + (rows - 0.5) * 30) }; })()`;
    const wheel = async (deltaX, deltaY) => { for (let i = 0; i < 40; i++) await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: node[0], y: node[1], deltaX, deltaY }); await sleep(300); };
    await wheel(-4000, -4000);
    const corner = await evaluate(edges) ?? { left: NaN, top: NaN };
    expect(Math.abs(corner.left) < 0.6 && Math.abs(corner.top) < 0.6, `canvas: at the start the line's content and first row are ${corner.left.toFixed(1)}px, ${corner.top.toFixed(1)}px from the top-left corner`);
    await wheel(0, 4000);
    const end = await evaluate(edges) ?? { bottom: NaN };
    expect(Math.abs(end.bottom) < 0.6, `canvas: at the end the last row is ${end.bottom.toFixed(1)}px from the bottom`);
    // Closing a side neither remounts nor moves the canvas.
    const canvas = `(() => { const rf = document.querySelector("[data-island=editor] .react-flow"); return { same: rf.dataset.probe === "1", at: rf.querySelector(".react-flow__viewport").style.transform }; })()`;
    await evaluate(`document.querySelector("[data-island=editor] .react-flow").dataset.probe = "1"`);
    const still = await evaluate(canvas);
    const stripe = await evaluate(`(() => { const b = document.querySelector('nav[aria-label="Left tool windows"] button[aria-pressed="true"]')?.getBoundingClientRect(); return b && [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    expect(stripe, "canvas: no open left tool window to close");
    if (stripe) {
      await click(stripe[0], stripe[1]); await sleep(500);
      const after = await evaluate(canvas);
      expect(after.same && after.at === still.at, `canvas: closing the left tool window ${after.same ? "" : "remounted the canvas and "}moved it from ${still.at} to ${after.at}`);
    }
    // Focusing the earliest version centres it only as far as the content allows: nothing before this line
    // or above the first row shows.
    const earliest = await evaluate(`[...document.querySelectorAll(".react-flow__node")].map((n) => [n.dataset.id, new DOMMatrix(getComputedStyle(n).transform).m41]).sort((a, b) => a[1] - b[1])[0]?.[0]`);
    await evaluate(`location.hash = ${JSON.stringify(earliest)}`); await sleep(600);
    const start = await evaluate(edges) ?? { left: NaN, top: NaN };
    expect(start.left < 0.6 && start.top < 0.6, `canvas: focusing ${earliest} leaves ${start.left.toFixed(1)}px before this line and ${start.top.toFixed(1)}px above the first row`);
  }
  // Sources (⌥7): a double-click opens a file as highlighted, read-only source that the island scrolls (no
  // native bar) under a header as tall as the other islands', and Compare with parent toggles its change as a
  // unified diff.
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "7", code: "Digit7", modifiers: 1, windowsVirtualKeyCode: 55 });
  await sleep(400);
  const file = await evaluate(`(() => { const r = [...document.querySelectorAll('[data-island="left"] [role="treeitem"]')].find((e) => e.textContent.endsWith(".py"))?.getBoundingClientRect(); return r && [r.left + 60, r.top + r.height / 2]; })()`);
  expect(file, "sources: no file in the Sources tool window");
  if (file) {
    await click(file[0], file[1], "left", 1); await click(file[0], file[1], "left", 2); await sleep(600);
    const code = await evaluate(`(() => { const e = document.querySelector("[data-island=editor] [data-code] .cm-editor"); if (!e) return null;
      return { tokens: e.querySelectorAll('[class*="tok-"]').length, lines: e.querySelectorAll(".cm-gutterElement").length,
               overflow: getComputedStyle(e.querySelector(".cm-scroller")).overflow, file: document.querySelector("[data-island=editor] [data-file]")?.textContent,
               header: document.querySelector("[data-island=editor] > :first-child").offsetHeight, left: document.querySelector("[data-island=left] > :first-child").offsetHeight }; })()`);
    expect(code && code.tokens > 0 && code.lines > 1, `sources: the double-click opened ${JSON.stringify(code)}, not highlighted source`);
    expect(code?.overflow === "visible", `sources: the source scrolls itself (${code?.overflow}), not inside the island`);
    expect(code?.file?.endsWith(".py"), `sources: the editor's header names ${code?.file}`);
    expect(code?.header === code?.left, `sources: the editor's header is ${code?.header}px, the left island's ${code?.left}px`);
    writeFileSync(join(outDir, "source.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    const toggle = `(() => { const b = [...document.querySelectorAll("[data-island=editor] button")].find((b) => b.textContent.trim() === "Compare with parent");
      return b && (b.click(), true); })()`;
    const state = `({ pressed: [...document.querySelectorAll("[data-island=editor] button")].find((b) => b.textContent.trim() === "Compare with parent")?.getAttribute("aria-pressed"),
      diff: !!document.querySelector("[data-island=editor] [data-code] .cm-merge-b") })`;
    if (await evaluate(toggle)) {
      await sleep(600);
      const on = await evaluate(state);
      expect(on.pressed === "true" && on.diff, `sources: Compare with parent on is ${JSON.stringify(on)}`);
      writeFileSync(join(outDir, "diff.png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      await evaluate(toggle); await sleep(400);
      const off = await evaluate(state);
      expect(off.pressed === "false" && !off.diff, `sources: Compare with parent off is ${JSON.stringify(off)}`);
    }
    // Locate in graph from a file's context menu brings Versions and the lineage back.
    await click(file[0], file[1], "right"); await sleep(400);
    await evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent.trim() === "Locate in graph")?.click()`); await sleep(400);
    const front = await evaluate(`document.querySelector("[data-island=left] h2")?.textContent + (document.querySelector("[data-island=editor] .react-flow")?.offsetParent ? " + lineage" : "")`);
    expect(front === "Versions + lineage", `sources: Locate in graph left ${front} in front`);
  }
  // The Runs page (⌥8), in light and dark: the left tool window closes and the editor island takes its
  // place a half gap from the stripe; the first time, Details opens at the right and Trades at the bottom,
  // both a gap from the editor, Trades under it at its left edge and width; ⌥1 brings Versions back.
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
  const alt = async (k, code, vk) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, modifiers: 1, windowsVirtualKeyCode: vk }); await sleep(500); };
  for (const scheme of ["light", "dark"]) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await send("Page.navigate", { url: `file://${resolve(page)}${hash}` });
    await sleep(2500);
    if (scheme === "light") await alt("8", "Digit8", 56);
    const runs = await evaluate(`(() => {
      const islands = Object.fromEntries([...document.querySelectorAll("[data-island]")].map((e) => [e.dataset.island, { radius: getComputedStyle(e).borderTopLeftRadius, ...e.getBoundingClientRect().toJSON() }]));
      const stripe = document.querySelector('nav[aria-label="Left tool windows"]').getBoundingClientRect().right;
      return { islands, stripe, pressed: document.querySelector('nav[aria-label="Left tool windows"] button[aria-pressed="true"]')?.getAttribute("aria-label"),
               bottom: document.querySelector("[data-island=bottom] h2, [data-island=bottom] [role=tab]")?.textContent, right: document.querySelector("[data-island=right] h2")?.textContent }; })()`);
    writeFileSync(join(outDir, `runs-${scheme}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    const { editor, right, bottom, left } = runs.islands, GAP = 4;
    expect(runs.pressed === "Runs" && !left, `runs ${scheme}: ${runs.pressed} pressed on the stripe, ${left ? "a" : "no"} left island`);
    expect(editor && right && bottom, `runs ${scheme}: islands ${Object.keys(runs.islands).join(", ")}, not editor, right and bottom`);
    expect(runs.bottom === "Trades" && runs.right === "Details", `runs ${scheme}: ${runs.bottom} at the bottom and ${runs.right} at the right, not Trades and Details`);
    for (const [id, i] of Object.entries(runs.islands)) expect(i.radius === "10px" && i.right <= 1600 && i.bottom <= 1000, `runs ${scheme}: island ${id} radius ${i.radius}, ends at ${i.right}, ${i.bottom}`);
    if (editor && bottom && right) {
      expect(Math.abs(editor.left - runs.stripe - GAP / 2) < 0.6, `runs ${scheme}: the editor is ${(editor.left - runs.stripe).toFixed(1)}px from the stripe, not ${GAP / 2}`);
      expect(Math.abs(bottom.top - editor.bottom - GAP) < 0.6 && Math.abs(bottom.left - editor.left) < 0.6 && Math.abs(bottom.width - editor.width) < 0.6,
             `runs ${scheme}: Trades is ${(bottom.top - editor.bottom).toFixed(1)}px under the editor, at ${bottom.left.toFixed(1)} and ${bottom.width.toFixed(1)} wide against ${editor.left.toFixed(1)} and ${editor.width.toFixed(1)}`);
      expect(Math.abs(right.left - editor.right - GAP) < 0.6, `runs ${scheme}: editor-right gap ${(right.left - editor.right).toFixed(1)}`);
    }
  }
  await alt("1", "Digit1", 49);
  const back = await evaluate(`document.querySelector("[data-island=left] h2")?.textContent + (document.querySelector("[data-island=editor] .react-flow")?.offsetParent ? " + lineage" : "")`);
  expect(back === "Versions + lineage", `runs: ⌥1 left ${back} in front`);
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
  const first = report.dark.lines.find((l) => l.gaps) ?? report.dark.lines[0];
  console.log(`verify: ${report.dark.islands.length} islands, ${report.dark.lines.length} version lines; badge at ${first?.badge}px, number padding ${first?.gaps}, name ${first?.name}px after the prediction slot`);
} finally {
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (failures.length) { console.error(`verify: ${failures.length} failure(s)\n  ${failures.join("\n  ")}`); process.exit(1); }
console.log("verify: all invariants hold");
