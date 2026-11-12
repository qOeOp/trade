import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { liveRunPresentation, liveHomePresentation, HELD_NOTICE } = await namespace("model/liveTradingMap.ts", { sources: [], packages: [] });
const run = () => ({
  run_id: "run-fixture", source: { source_sha256: "actual", entry_class: "Actual" }, candidate: { strategy_id: "retest", revision: "1" },
  runtime: { digest: "sha256:fixture", platform: "linux/amd64" }, symbols: null,
  config: { drawdown_brake: "0.150000000000000001", duration_seconds: "8100", leverage: "3" },
  host: { state: "running", mode: "run", account_owned: null, exit_code: null }, stop_requested: false,
  terminal: { event: "clean_stop", observed_ns: "1000000000000000001", source_failed: true, event_ref: { source: "native", cursor: "n:1" } },
  custody: { released: false, release_reason: null, archived: null }, account: null,
  orders: null, positions: [], event_limit: 200, evidence: [{ source: "native", cursor: "n", observed_ns: null, read_ns: "1000000000000000002", complete: false, state: "invalid" }], complete: false,
});

test("Live purpose requires exact catalog hash and entry class; a legacy source remains unknown", () => {
  const source = { source_id: "s", source_sha256: "actual", entry_class: "Actual", purpose: "controlled", candidate: "retest@1" };
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
  assert.equal(mapped.config[0].value, "0.150000000000000001");
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
    defaults: { drawdown_brake: "0.15", duration_seconds: 8100, leverage: "3" },
  };
  const mapped = liveHomePresentation(home, new Map([[native.run_id, { ...native, review_error: { code: "LIVE_REVIEW_UNAVAILABLE" } }]]));
  assert.equal(mapped.credentials[0].removed, true);
  assert.equal(mapped.credentials[0].savedAt, "1000000000000000001");
  assert.equal(mapped.runs[0].review, null);
  assert.equal(mapped.runs[0].reviewError, "LIVE_REVIEW_UNAVAILABLE");
  assert.deepEqual(mapped.planFields.at(-1), { id: "leverage", label: "Leverage", value: "3" });
  assert.deepEqual(mapped.runs[0].config.at(-1), { label: "Leverage", value: "3" });
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

test("a run is ended only in the host's ended states; an unresolved or unreported run can still be stopped", () => {
  const native = run();
  for (const [state, ended] of [["clean_stopped", true], ["reconciled_flat", true], ["venue_flat", true], ["not_armed", true],
    ["preflight_complete", true], ["preflight_failed", true], ["running", false], ["prepared", false], ["unresolved", false], [null, false]]) {
    native.host = { ...native.host, state };
    assert.equal(liveRunPresentation(native, []).ended, ended, String(state));
  }
});

test("minute results become the account on the equity the run armed with, unknowns kept, and nothing without them", () => {
  const results = [["60000000000", "-2.5"], ["120000000000", null], ["180000000000", "1.25"]];
  const brake = { start: "100", peak: "104", fired: null };
  assert.deepEqual(liveRunPresentation({ ...run(), brake, minute_results: results }, []).equity,
    { budget: 100, minutes: [[60, 97.5], [120, null], [180, 101.25]] });
  assert.equal(liveRunPresentation(run(), []).equity, null, "an older service sends none");
  assert.equal(liveRunPresentation({ ...run(), brake: { ...brake, start: null }, minute_results: results }, []).equity, null);
  assert.deepEqual(liveHomePresentation({ availability: "ready", write_enabled: true, maintenance_enabled: true, write_reason: null, sources: [],
    credentials: [], runs: [], defaults: { drawdown_brake: "0.15", duration_seconds: null, leverage: "3" } }, new Map()).planFields.slice(0, 2),
    [{ id: "drawdown_brake", label: "Drawdown brake", value: "15" }, { id: "duration_seconds", label: "Duration (seconds)", value: "" }],
    "the brake is typed as a percentage; no duration is an empty field");
});

test("notification status maps without any secret and is null from a control that does not report it", () => {
  const home = { availability: "ready", write_enabled: true, maintenance_enabled: true, write_reason: null, sources: [], credentials: [], runs: [],
    defaults: { drawdown_brake: "0.15", duration_seconds: 8100, leverage: "3" } };
  assert.equal(liveHomePresentation(home, new Map()).notify, null);
  const notify = { configured: true, last_sent_ns: "1794000000000000000", last_error: { code: "http_4xx", at_ns: "1794000060000000000" }, dropped: 1 };
  assert.deepEqual(liveHomePresentation({ ...home, notify }, new Map()).notify,
    { configured: true, lastSentNs: "1794000000000000000", lastError: { code: "http_4xx", atNs: "1794000060000000000" }, dropped: 1 });
});

test("a start holding around an inherited position says so until a later start or the account flat", () => {
  const held = (restarts, state = "running") => liveRunPresentation({ ...run(), host: { ...run().host, state }, restarts }, []).heldNotice;
  const resuming = (ns, isHeld) => ({ event: "resuming", observed_ns: ns, held: isHeld });
  assert.equal(held([resuming("1", true)]), HELD_NOTICE);
  assert.match(HELD_NOTICE, /protected only by its stop at Binance: the strategy no longer manages its exits/);
  assert.equal(held([resuming("1", true), { event: "held", observed_ns: "2", held: null }]), HELD_NOTICE);
  assert.equal(held([resuming("1", true), { event: "venue_flat_while_held", observed_ns: "2", held: null }]), null);
  assert.equal(held([resuming("1", true), resuming("3", false)]), null);
  assert.equal(held([resuming("1", true)], "clean_stopped"), null);
  assert.equal(held(undefined), null, "an older service sends no restarts");
});
