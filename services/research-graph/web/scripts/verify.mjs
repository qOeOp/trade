// Verifies a rendered page in headless Chrome over CDP (Node's built-in WebSocket; no dependency):
// screenshots in light and dark, and the layout invariants of the Islands shell and VersionLine
// (fixed gaps between its parts; each badge number the same padding from the edges and the divider),
// and that a narrow window keeps every island inside it and still while the pointer moves.
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
      return { islands, lines, offCentre: Math.max(0, ...offCentre) };
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
