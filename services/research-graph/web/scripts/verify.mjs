// Verifies a rendered page in headless Chrome over CDP (Node's built-in WebSocket; no dependency):
// screenshots in light and dark, and the layout invariants of the Islands shell and VersionLine.
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
      const lines = [...document.querySelectorAll("[data-version-line]")].map((l) => {
        const at = (p) => l.querySelector('[data-part="' + p + '"]');
        const L = r(l).left, badge = at("badge"), ret = at("ret"), dd = at("dd"), name = at("name");
        const font = (e) => e && [getComputedStyle(e).fontFamily, getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight].join("|");
        return { badge: +(r(badge).left - L).toFixed(1), width: +r(badge).width.toFixed(1), name: +(r(name).left - L).toFixed(1),
                 cells: ret && dd ? [+r(ret).width.toFixed(1), +r(dd).width.toFixed(1)] : null, sameFont: !ret || font(ret) === font(dd),
                 rightAligned: !ret || (getComputedStyle(ret).textAlign === "right" && getComputedStyle(dd).textAlign === "right") };
      });
      return { islands, lines };
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
    const unique = (k) => [...new Set(m.lines.map((l) => JSON.stringify(l[k])))];
    expect(m.lines.length > 0, `${scheme}: no VersionLine rendered`);
    for (const k of ["badge", "width", "name"]) expect(unique(k).length === 1, `${scheme}: VersionLine ${k} offsets differ: ${unique(k).join(" ")}`);
    expect(unique("cells").filter((c) => c !== "null").length <= 1, `${scheme}: badge cells differ: ${unique("cells").join(" ")}`);
    expect(m.lines.every((l) => l.sameFont && l.rightAligned), `${scheme}: badge cells differ in font or alignment`);
  }
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
  const first = report.dark.lines.find((l) => l.cells) ?? report.dark.lines[0];
  console.log(`verify: ${report.dark.islands.length} islands, ${report.dark.lines.length} version lines; badge ${first?.badge}px, width ${first?.width}px, name ${first?.name}px, cells ${first?.cells}`);
} finally {
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (failures.length) { console.error(`verify: ${failures.length} failure(s)\n  ${failures.join("\n  ")}`); process.exit(1); }
console.log("verify: all invariants hold");
