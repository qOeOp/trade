import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
async function graph(entry, initial) {
  const kept = new Map(initial == null ? [] : [["rg-time-zone", initial]]), modules = new Map();
  globalThis.window = { localStorage: { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) } };
  function load(path) {
    if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText, { identifier: path }));
    return modules.get(path);
  }
  const root = load(resolve(src, entry));
  await root.link(async (specifier, from) => {
    if (specifier.startsWith(".")) {
      const stem = resolve(dirname(from.identifier), specifier);
      return load([`${stem}.ts`, `${stem}.tsx`].find(existsSync));
    }
    if (!modules.has(specifier)) {
      const exports = await import(specifier);
      modules.set(specifier, new SyntheticModule(Object.keys(exports), function () {
        for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
      }));
    }
    return modules.get(specifier);
  });
  await root.evaluate();
  return { value: root.namespace, kept };
}
const { value: t } = await graph("lib/time.ts");
const at = (s) => Date.parse(s), ny = "America/New_York";

test("default UTC and legacy UTC input do not inherit the host timezone", () => {
  const old = process.env.TZ;
  try {
    for (const host of ["UTC", ny, "Asia/Shanghai", "Asia/Tokyo"]) {
      process.env.TZ = host;
      assert.equal(t.utcInstant("2026-01-01 00:30:00.123456"), at("2026-01-01T00:30:00.123Z"));
      assert.equal(t.utcInstant("2026-01-01T09:30:00+09:00"), at("2026-01-01T00:30:00Z"));
      assert.equal(t.dateTime(at("2026-01-01T00:30:00Z")), "2026-01-01 00:30:00 UTC");
    }
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});

test("zones cross midnight and New York's winter/summer offsets use each event's date", () => {
  const ms = at("2026-01-01T00:30:00Z");
  assert.equal(t.dateTime(ms, ny), "2025-12-31 19:30:00 GMT-5");
  assert.equal(t.dateTime(ms, "Asia/Shanghai"), "2026-01-01 08:30:00 GMT+8");
  assert.equal(t.dateTime(ms, "Asia/Tokyo"), "2026-01-01 09:30:00 GMT+9");
  assert.equal(t.dateTime(at("2026-07-01T00:30:00Z"), ny), "2026-06-30 20:30:00 GMT-4");
});

test("New York spring gap and autumn repeated clocks retain distinct offsets", () => {
  assert.equal(t.dateTime(at("2026-03-08T06:59:59Z"), ny), "2026-03-08 01:59:59 GMT-5");
  assert.equal(t.dateTime(at("2026-03-08T07:00:00Z"), ny), "2026-03-08 03:00:00 GMT-4");
  assert.equal(t.dateTime(at("2026-11-01T05:30:00Z"), ny), "2026-11-01 01:30:00 GMT-4");
  assert.equal(t.dateTime(at("2026-11-01T06:30:00Z"), ny), "2026-11-01 01:30:00 GMT-5");
});

test("UTC business days remain 24-hour ranges even across a 25-hour New York day", async () => {
  const { value: p } = await graph("model/paper.ts");
  const ms = at("2026-11-01T00:00:00Z");
  assert.equal(p.utcDay(ms), "2026-11-01");
  assert.equal(t.utcDayRange("2026-11-01", ny), "2026-10-31 20:00 GMT-4 → 2026-11-01 19:00 GMT-5");
  for (const zone of t.TIME_ZONES) { t.dateTime(ms, zone); assert.equal(p.utcDay(ms), "2026-11-01"); }
  assert.equal(t.utcInstant("2026-11-01"), null, "date keys are not fabricated instants");
});

test("nanoseconds truncate after BigInt division; missing and invalid values never become epoch zero", async () => {
  const { value: e } = await graph("model/liveEventTime.ts");
  assert.equal(t.nsMilliseconds("1793511000123999999"), 1793511000123);
  assert.equal(t.nsMilliseconds("0"), 0);
  for (const v of [null, undefined, "", "bad", "1e18", "-1", "9999999999999999999999999999"]) assert.equal(t.nsMilliseconds(v), null);
  assert.equal(t.dateTime(t.nsMilliseconds("1793511000123999999"), ny, "millisecond"), "2026-11-01 01:30:00.123 GMT-4");
  assert.equal(e.liveEventTime({ ts_event: "0", observed_ns: "1793511000123999999" }).source, "event");
  assert.equal(e.liveEventTime({ ts_event: null, observed_ns: "1793511000123999999" }).source, "observed");
  assert.equal(e.liveEventTime({ ts_event: "bad", observed_ns: null }), null);
});

test("one stored IANA choice defaults safely, persists and notifies all subscribers", async () => {
  for (const raw of [undefined, "broken", '"US"', 'null', '480']) {
    const { value } = await graph("state/timeZone.ts", raw);
    assert.equal(value.timeZone.get(), "UTC");
  }
  const { value, kept } = await graph("state/timeZone.ts", '"America/New_York"');
  assert.equal(value.timeZone.get(), ny);
  const first = [], second = [];
  const off1 = value.timeZone.subscribe(() => first.push(value.timeZone.get()));
  const off2 = value.timeZone.subscribe(() => second.push(value.timeZone.get()));
  for (const zone of t.TIME_ZONES) value.timeZone.set(zone);
  assert.deepEqual(first, t.TIME_ZONES); assert.deepEqual(second, first);
  assert.equal(kept.get("rg-time-zone"), '"Asia/Tokyo"');
  off1(); off2();
  const reloaded = await graph("state/timeZone.ts", kept.get("rg-time-zone"));
  assert.equal(reloaded.value.timeZone.get(), "Asia/Tokyo");
});
