// Phone RunsTab offline states (IDE-F3) and Phone PaperPage sealed run facts + offline exit (IDE-F4).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader } from "./load.mjs";

const NOW = Date.UTC(2026, 10, 26, 12, 0), DAY_MS = 86_400_000, NS = 1_000_000;

async function renderRunsTab({ liveAvailability = "available", liveRuns = [], paperService = "present", paperListing = null } = {}) {
  const { namespace } = loader({ stubs: {
    "state/liveTrading": { useLiveTrading: () => ({ view: { availability: liveAvailability, runs: liveRuns, notify: null } }) },
    "state/paper": { usePaperRuns: () => paperListing, usePaperService: () => paperService },
    "state/phone": { usePhoneRun: () => null },
    "state/timeZone": { useTimeZone: () => "UTC" },
    "ui/hooks/useNow": { useNow: () => NOW },
    "ui/PhoneBar": { PhonePage: ({ children }) => createElement("div", null, children) },
    "shell/phone/PhoneTop": { PhoneTop: ({ title }) => createElement("header", null, title) },
    "shell/phone/RunCards": {
      clock: () => "12:00 UTC",
      LiveCard: ({ run }) => createElement("div", null, `LiveCard:${run.id}`),
      PaperCard: ({ run }) => createElement("div", null, `PaperCard:${run.paper_id}`),
      UnresolvedNotice: () => null,
    },
    "shell/phone/LivePage": { LivePage: () => null },
    "shell/phone/PaperPage": { PaperPage: () => null },
    "icons/Icon": { Icon: () => null },
  } });
  const { RunsTab } = await namespace("shell/phone/RunsTab.tsx");
  return renderToStaticMarkup(createElement(RunsTab));
}

async function renderPaperPage({ id = 42, listing = null, service = "present", targets = { max_drawdown: 0.15, annual_return: 0.40 } } = {}) {
  let capturedFacts = null;
  let capturedTop = null;
  const { namespace } = loader({ stubs: {
    "state/paper": { usePaperRuns: () => listing, usePaperService: () => service },
    "state/researchLines": { useResearchLines: () => ({ lines: [{ name: "line-a", start: "v@1", dev_start: "2026-01-01", dev_end: "2026-06-30", closed: false, candidates: ["rsi@3"], targets }] }) },
    "state/timeZone": { useTimeZone: () => "UTC" },
    "state/paperStream": { follow() {}, useStream: () => null },
    "state/phone": { closeRun() {}, openRun() {}, phoneNow: () => true },
    "state/market": { useSnapshot: () => null },
    "ui/hooks/useNow": { useNow: () => NOW },
    "ui/PhoneBar": { PhonePage: ({ children }) => createElement("div", null, children) },
    "shell/phone/PhoneTop": {
      PhoneTop: (props) => {
        capturedTop = props;
        return createElement("header", null, props.back?.label ?? "", " ", props.aside ?? "");
      },
    },
    "widgets/runs/RunTile": { health: () => ({ text: "Stopped", tone: "masked", late: false }) },
    "widgets/phone/EquityLine": { EquityLine: () => null },
    "widgets/detail/ReadingsBoard": {
      Track: () => null,
      Board: ({ f }) => {
        capturedFacts = f;
        return createElement("div", { "data-board": "1" }, f.reading ? "READING" : `mdd=${f.mdd};annual=${f.annual};short=${f.short};ended=${f.account?.ended};dd=${f.account?.dd};usdt=${f.account?.usdt}`);
      },
    },
    "icons/Icon": { Icon: () => null },
  } });
  const { PaperPage } = await namespace("shell/phone/PaperPage.tsx");
  const html = renderToStaticMarkup(createElement(PaperPage, { id }));
  return { html, facts: capturedFacts, top: capturedTop };
}

test("RunsTab offline with no prior listing reports offline truthfully without fabricating counts or empty-run copy", async () => {
  const html = await renderRunsTab({ liveAvailability: "unavailable", liveRuns: [], paperService: "offline", paperListing: null });
  assert.match(html, /Paper is not answering\./);
  assert.doesNotMatch(html, /These are its last facts/);
  assert.doesNotMatch(html, /0 running · 0 sealed/);
  assert.doesNotMatch(html, /No paper run/);
  assert.match(html, /Live is not answering\./);
  assert.doesNotMatch(html, /No Live run/);
});

test("RunsTab offline after a prior listing keeps the last facts notice and prior counts", async () => {
  const html = await renderRunsTab({
    liveAvailability: "available", liveRuns: [],
    paperService: "offline",
    paperListing: { runs: [{ paper_id: 1, state: "sealed" }], running: 0, memory: null, starting: [] },
  });
  assert.match(html, /Paper is not answering\. These are its last facts\./);
  assert.match(html, /0 running · 1 sealed/);
});

test("PaperPage on a sealed run reads run.seal metrics, duration, starting balance and bars instead of empty defaults", async () => {
  const startedMs = NOW - 45 * DAY_MS;
  const stoppedMs = NOW - 5 * DAY_MS;
  const sealedRun = {
    paper_id: 42, candidate: "rsi@3", source_sha256: "a".repeat(64), symbols: ["BTCUSDT"], state: "sealed",
    created_at: "2026-10-12T12:00:00Z", image_ref: "trade-runtime@sha256:" + "b".repeat(64), market_day: "2026-10-11", config: {},
    status: "complete", reasons: [], total_return: 0.08, max_drawdown: 0.035,
    seal: {
      status: "complete", reasons: [], total_return: 0.08, max_drawdown: 0.035,
      starting_balance_usdt: "25000", final_equity_usdt: "27000", fills: 12,
      started_ns: startedMs * NS, stopped_ns: stoppedMs * NS, stop_reason: "user",
      daily_returns: [], positions_closed: 6, bars: 57600,
    },
  };
  const { html, facts } = await renderPaperPage({ id: 42, listing: { runs: [sealedRun], running: 0, memory: null, starting: [] } });
  assert.equal(facts.mdd, 0.035);
  assert.equal(facts.short, undefined, "40-day sealed run is not marked too short");
  assert.ok(facts.annual > 0.9, `expected annualized return from 40-day +8% run, got ${facts.annual}`);
  assert.equal(facts.account.ret, 0.08);
  assert.equal(facts.account.ended, true);
  assert.equal(facts.account.dd, "stop");
  assert.ok(Math.abs(facts.account.usdt - (Math.round(0.08 * 1e4) / 1e4 - Math.round(((1.4 ** (40 / 365)) - 1) * 1e4) / 1e4) * 25000) < 1e-6,
    "pace USDT uses seal.starting_balance_usdt (25000), not default 100000");
  assert.match(html, /57600.*bars/);
  assert.doesNotMatch(html, /no bar yet/);
  assert.match(html, /since /);
});

test("PaperPage on a short sealed run computes duration from started_ns to stopped_ns, not 0 of 30 d", async () => {
  const startedMs = NOW - 20 * DAY_MS;
  const stoppedMs = NOW - 8 * DAY_MS;
  const sealedRun = {
    paper_id: 43, candidate: "rsi@3", source_sha256: "a".repeat(64), symbols: ["BTCUSDT"], state: "sealed",
    created_at: "2026-11-06T12:00:00Z", image_ref: "trade-runtime@sha256:" + "b".repeat(64), market_day: "2026-11-05", config: {},
    status: "complete", reasons: [], total_return: 0.02, max_drawdown: 0.015,
    seal: {
      status: "complete", reasons: [], total_return: 0.02, max_drawdown: 0.015,
      starting_balance_usdt: "10000", final_equity_usdt: "10200", fills: 2,
      started_ns: startedMs * NS, stopped_ns: stoppedMs * NS, stop_reason: "user",
      daily_returns: [], positions_closed: 1, bars: 17280,
    },
  };
  const { html, facts } = await renderPaperPage({ id: 43, listing: { runs: [sealedRun], running: 0, memory: null, starting: [] } });
  assert.equal(facts.mdd, 0.015);
  assert.equal(facts.short, 12, "12-day sealed run reports 12 days, not 0");
  assert.equal(facts.annual, null);
  assert.doesNotMatch(html, /no bar yet/);
});

test("PaperPage exits the loading skeleton with a back link when listing is null and Paper is offline", async () => {
  const { html, facts, top } = await renderPaperPage({ id: 42, listing: null, service: "offline" });
  assert.equal(facts, null, "Board skeleton is not rendered when Paper is offline");
  assert.equal(top.back?.label, "Runs");
  assert.match(html, /Paper is not answering\./);
  assert.doesNotMatch(html, /READING/);
});
