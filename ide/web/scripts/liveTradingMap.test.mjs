import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

const mod = new SourceTextModule(ts.transpileModule(readFileSync(new URL("../src/model/liveTradingMap.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
await mod.link(() => { throw new Error("the projection needs no runtime dependency"); });
await mod.evaluate();
const { liveRunPresentation, liveHomePresentation } = mod.namespace;
const run = () => ({
  run_id: "run-fixture", source: { source_sha256: "actual", entry_class: "Actual" }, origin_candidate: { strategy_id: "retest", revision: "1", source_sha256: "origin" },
  runtime: { digest: "sha256:fixture", platform: "linux/amd64" }, symbols: null,
  config: { budget_usdt: "90.000000000000000001", max_notional_per_order: "90", max_loss_usdt: "2", duration_seconds: "8100" },
  host: { state: "running", mode: "run", account_owned: null, exit_code: null }, stop_requested: false,
  terminal: { event: "clean_stop", observed_ns: "1000000000000000001", source_failed: true, event_ref: { source: "native", cursor: "n:1" } },
  custody: { released: false, release_reason: null, archived: null }, account: null,
  orders: null, positions: [], event_limit: 200, evidence: [{ source: "native", cursor: "n", observed_ns: null, read_ns: "1000000000000000002", complete: false, state: "invalid" }], complete: false,
});

test("Live purpose requires exact catalog hash and entry class; a legacy source remains unknown", () => {
  const source = { source_id: "s", source_sha256: "actual", entry_class: "Actual", purpose: "controlled", origin_candidate: "retest@1", available: true, code: null };
  assert.equal(liveRunPresentation(run(), [source]).purpose, "controlled");
  assert.equal(liveRunPresentation(run(), [{ ...source, source_sha256: "other" }]).purpose, "unknown");
  assert.equal(liveRunPresentation(run(), [{ ...source, entry_class: "Other" }]).purpose, "unknown");
  assert.equal(liveRunPresentation(run(), []).purpose, "unknown");
});

test("native terminal, unknown account, released custody and decimal declarations remain independent", () => {
  const mapped = liveRunPresentation(run(), []);
  assert.equal(mapped.account.length, 0);
  assert.equal(mapped.symbols, null);
  assert.equal(mapped.orders, null);
  assert.equal(mapped.positions.length, 0);
  assert.equal(mapped.config[0].value, "90.000000000000000001");
  assert.equal(mapped.host.find((v) => v.label === "Account custody held").value, null);
  assert.equal(mapped.ending.find((v) => v.label === "Custody released").value, "No");
  assert.equal(mapped.execution.find((v) => v.label === "Source failed").value, "Yes");
  assert.equal(mapped.evidence[0].readNs, "1000000000000000002");
  assert.equal(mapped.evidence[0].complete, false);
});

test("venue-flat terminal and custody retain their identity without inventing native fills or source success", () => {
  const native = run();
  native.host = { state: "venue_flat", mode: "reconcile", account_owned: false, exit_code: 0 };
  native.terminal = { ...native.terminal, event: "venue_flat", source_failed: null };
  native.custody = { released: true, release_reason: "venue_flat", archived: true };
  const mapped = liveRunPresentation(native, []);
  assert.equal(mapped.host.find((v) => v.label === "State").value, "venue_flat");
  assert.equal(mapped.execution.find((v) => v.label === "Native terminal").value, "venue_flat");
  assert.equal(mapped.execution.find((v) => v.label === "Source failed").value, null);
  assert.equal(mapped.ending.find((v) => v.label === "Release reason").value, "venue_flat");
  assert.equal(mapped.orders, null);
  assert.deepEqual(mapped.positions, []);
  assert.deepEqual(mapped.account, []);
});

test("fill events stay events and never become total fill status or aggregated positions", () => {
  const native = run();
  native.orders = [{ event_type: "OrderFilled", last_qty: "0.001000000000000001", last_px: "72000.1", event_ref: { source: "native", cursor: "n:2" }, observed_ns: null }];
  const mapped = liveRunPresentation(native, []);
  assert.equal(mapped.orders, native.orders);
  assert.equal(mapped.orders[0].event_type, "OrderFilled");
  assert.equal(mapped.orders[0].status, undefined);
  assert.equal(mapped.positions.length, 0);
});

test("credential metadata and a failed research review do not become successful validation", () => {
  const native = run(), home = {
    availability: "ready", write_enabled: true, maintenance_enabled: true, write_reason: null, sources: [], runs: [native],
    credentials: [{ credential_ref: "ref", observed_ns: "1000000000000000001", selected: false, removed: true, available: false, referenced_runs: [native.run_id] }],
    defaults: { budget_usdt: "90", max_notional_per_order: "90", max_loss_usdt: "2", duration_seconds: 8100 },
  };
  const mapped = liveHomePresentation(home, new Map([[native.run_id, { ...native, review_error: { code: "LIVE_REVIEW_UNAVAILABLE" } }]]));
  assert.equal(mapped.credentials[0].removed, true);
  assert.equal(mapped.credentials[0].savedAt, "1000000000000000001");
  assert.equal(mapped.runs[0].review, null);
  assert.equal(mapped.runs[0].reviewError, "LIVE_REVIEW_UNAVAILABLE");
});


test("an account check is derived only from the preflight process exit, never an effect receipt", () => {
  const native = run();
  for (const [mode, state, exit_code, expected] of [
    ["preflight", "running", null, "running"], ["preflight", "preflight_complete", 0, "passed"],
    ["preflight", "preflight_complete", null, "unknown"], ["preflight", "preflight_complete", 1, "unknown"],
    ["preflight", "preflight_failed", 1, "failed"], ["run", "preflight_complete", 0, null],
  ]) {
    native.host = { ...native.host, mode, state, exit_code };
    assert.equal(liveRunPresentation(native, []).accountCheck?.state ?? null, expected);
  }
});
