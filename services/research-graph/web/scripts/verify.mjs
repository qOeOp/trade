// Verifies a rendered page in headless Chrome over CDP (Node's built-in WebSocket; no dependency):
// screenshots in light and dark, and the layout invariants of the Islands shell and VersionLine
// (fixed gaps between its parts; each badge number the same padding from the edges and the divider).
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
    if (by.editor && by.dock) {
      expect(Math.abs(by.dock.top - by.editor.bottom - 6) < 0.6, `${scheme}: editor-dock gap ${(by.dock.top - by.editor.bottom).toFixed(1)}`);
      expect(Math.abs(by.dock.left - by.editor.left) < 0.6 && Math.abs(by.dock.width - by.editor.width) < 0.6, `${scheme}: editor and dock differ in left edge or width`);
    }
    if (by.editor && by.inspector) expect(Math.abs(by.inspector.left - by.editor.right - 6) < 0.6, `${scheme}: editor-inspector gap ${(by.inspector.left - by.editor.right).toFixed(1)}`);
    expect(m.offCentre < 0.6, `${scheme}: a canvas node's content is ${m.offCentre}px off its vertical centre`);
    const unique = (k) => [...new Set(m.lines.map((l) => JSON.stringify(l[k])))];
    expect(m.lines.length > 0, `${scheme}: no VersionLine rendered`);
    for (const k of ["mark", "badge", "afterBadge", "name"]) expect(unique(k).length === 1, `${scheme}: VersionLine ${k} gaps differ: ${unique(k).join(" ")}`);
    const gaps = [...new Set(m.lines.flatMap((l) => l.gaps ?? []).map((g) => Math.round(g)))];
    expect(gaps.length === 1, `${scheme}: badge padding to edges and divider differs: ${gaps.join(" ")}`);
    expect(m.lines.every((l) => l.sameFont), `${scheme}: badge cells differ in font`);
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
