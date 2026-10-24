// Verifies a rendered page in headless Chrome over CDP (Node's built-in WebSocket; no dependency):
// screenshots in light and dark, and the layout invariants of the Islands shell (frame corners included) and VersionLine
// (fixed gaps between its parts; each badge number the same padding from the edges and the divider),
// that a narrow window keeps every island inside it and still while the pointer moves, and that
// scrollbars are thin overlay lines on the island edges; then the main interactions there (tree keys,
// the folded path, a version's context menu, opening it in a tab, panning the canvas to its edges).
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
      const frame = { left: nav("左侧工具窗"), right: nav("右侧工具窗"), bar: bar.map((b) => ({ left: b.left, right: b.right, height: b.height })),
                      crumb: crumb.left, status: innerWidth - status.right, island: r(document.querySelector("[data-island=left]")).toJSON() };
      return { islands, lines, offCentre: Math.max(0, ...offCentre), frame };
    })()`);
    report[scheme] = m;
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `${scheme}.png`), Buffer.from(shot.data, "base64"));
    for (const i of m.islands) expect(i.radius === "10px", `${scheme}: island ${i.id} radius ${i.radius}`);
    const by = Object.fromEntries(m.islands.map((i) => [i.id, i]));
    for (const id of ["editor", "left", "right", "bottom"]) expect(by[id], `${scheme}: no ${id} island`);
    if (by.editor && by.bottom) {
      expect(Math.abs(by.bottom.top - by.editor.bottom - 6) < 0.6, `${scheme}: editor-bottom gap ${(by.bottom.top - by.editor.bottom).toFixed(1)}`);
      expect(Math.abs(by.bottom.left - by.editor.left) < 0.6 && Math.abs(by.bottom.width - by.editor.width) < 0.6, `${scheme}: editor and bottom differ in left edge or width`);
    }
    if (by.editor && by.right) expect(Math.abs(by.right.left - by.editor.right - 6) < 0.6, `${scheme}: editor-right gap ${(by.right.left - by.editor.right).toFixed(1)}`);
    if (by.editor && by.left) expect(Math.abs(by.editor.left - by.left.right - 6) < 0.6, `${scheme}: left-editor gap ${(by.editor.left - by.left.right).toFixed(1)}`);
    const f = m.frame, first = f.left[0], last = f.left.at(-1), near = (a, b) => Math.abs(a - b) < 0.6;
    expect(near((first.top + first.bottom) / 2, f.island.top + 20), `${scheme}: the first stripe button is off the island header's centre`);
    expect(near(f.island.bottom - last.bottom, first.top - f.island.top), `${scheme}: the stripe's last button is not inset from the island's foot as its first is from its top`);
    expect(near(f.bar[0].left, first.left) && near(f.bar.at(-1).right, f.right[0].right), `${scheme}: the toolbar's ends do not line up with the stripe buttons`);
    expect(f.bar.filter((b) => b.height !== first.height).length <= 1, `${scheme}: toolbar controls differ in height from the stripe buttons`);
    expect(near(f.crumb, f.status) && near(f.crumb, first.left + 8), `${scheme}: status bar text is ${f.crumb.toFixed(1)}px and ${f.status.toFixed(1)}px from the window's edges, not ${first.left + 8}`);
    expect(m.offCentre < 0.6, `${scheme}: a canvas node's content is ${m.offCentre}px off its vertical centre`);
    const unique = (k) => [...new Set(m.lines.map((l) => JSON.stringify(l[k])))];
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
  // Interactions, still in the narrow window.
  const key = async (k, code, vk) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); await sleep(200); };
  const click = async (x, y, button = "left", clickCount = 1) => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount }); };
  // The version tree: the arrow keys move the selection.
  const before = await evaluate("location.hash");
  await evaluate(`document.querySelector('[data-island="left"] [role="treeitem"][data-selected]')?.focus()`);
  await key("ArrowDown", "ArrowDown", 40); await key("ArrowDown", "ArrowDown", 40); await sleep(300);
  expect((await evaluate("location.hash")) !== before, "tree: the arrow keys did not move the selection");
  // The status bar folds the middle of a long path into one step whose menu lists it.
  const fold = await evaluate(`(() => { const b = document.querySelector('nav[aria-label="路径"] [aria-label^="另外"]')?.getBoundingClientRect(); return b && [b.left + b.width / 2, b.top + b.height / 2]; })()`);
  if (fold) {
    await click(fold[0], fold[1]); await sleep(300);
    expect((await evaluate(`document.querySelectorAll('[role="menuitem"]').length`)) > 0, "status bar: the folded step's menu is empty");
    await key("Escape", "Escape", 27);
  }
  // A canvas version: right-click gives its menu, double-click opens it in a tab, the wheel pans.
  const node = await evaluate(`(() => { const box = document.querySelector("[data-island=editor] .react-flow").getBoundingClientRect();
    const n = [...document.querySelectorAll(".react-flow__node [data-part=name]")].map((e) => e.getBoundingClientRect()).find((b) => b.left > box.left + 8 && b.left + 40 < box.right && b.top > box.top && b.bottom < box.bottom);
    return n && [n.left + 20, n.top + n.height / 2]; })()`);
  expect(node, "canvas: no version in view");
  if (node) {
    await click(node[0], node[1], "right"); await sleep(400);
    const items = await evaluate(`document.querySelectorAll('[role="menuitem"]').length`);
    expect(items === 5, `canvas: the context menu has ${items} items, not 5`);
    await key("Escape", "Escape", 27);
    await click(node[0], node[1], "left", 1); await click(node[0], node[1], "left", 2); await sleep(400);
    const tabs = await evaluate(`[...document.querySelectorAll('[data-island=editor] [role="tab"]')].map((t) => t.getAttribute("aria-selected"))`);
    expect(tabs.length === 2 && tabs[1] === "true", `canvas: double-click left the editor tabs at ${JSON.stringify(tabs)}`);
    await evaluate(`document.querySelector('[data-island=editor] [role="tab"]').click()`); await sleep(300);
    const at = `document.querySelector(".react-flow__viewport").style.transform`, from = await evaluate(at);
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: node[0], y: node[1], deltaX: 0, deltaY: 120 }); await sleep(300);
    expect((await evaluate(at)) !== from, "canvas: the wheel did not pan");
    // Panned as far as it goes, the content meets the canvas's corners: trial 0's cell and the first row at
    // the top-left (so the ruler starts at 0), the last row at the bottom. Read from the pan itself: the
    // canvas draws trial t's cell from (t - 0.5) * 32px and row r from (r - 0.5) * 30px.
    const edges = `(() => { const c = document.querySelector("[data-island=editor] .react-flow").getBoundingClientRect();
      const [x, y] = document.querySelector(".react-flow__viewport").style.transform.match(/-?[\\d.]+/g).map(Number);
      const backdrop = document.querySelector("[data-backdrop]"); if (!backdrop) return null;
      const rows = +backdrop.dataset.rows;
      return { left: x - 16, top: y - 15, bottom: c.height - (y + (rows - 0.5) * 30) }; })()`;
    const wheel = async (deltaX, deltaY) => { for (let i = 0; i < 40; i++) await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: node[0], y: node[1], deltaX, deltaY }); await sleep(300); };
    await wheel(-4000, -4000);
    const corner = await evaluate(edges) ?? { left: NaN, top: NaN };
    expect(Math.abs(corner.left) < 0.6 && Math.abs(corner.top) < 0.6, `canvas: at the start trial 0 and the first row are ${corner.left.toFixed(1)}px, ${corner.top.toFixed(1)}px from the top-left corner`);
    await wheel(0, 4000);
    const end = await evaluate(edges) ?? { bottom: NaN };
    expect(Math.abs(end.bottom) < 0.6, `canvas: at the end the last row is ${end.bottom.toFixed(1)}px from the bottom`);
  }
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
