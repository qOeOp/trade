import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRdOwnerViewRequestV1,
  projectRdOwnerViewLocatorV1,
} from "../lib/rd-owner-view.ts";

const requestIdentity = "replay-request-1";
const meaningDigest = `blake3:${"a".repeat(64)}`;
const fields = [
  { key: "request_identity", value: requestIdentity },
  { key: "meaning_digest", value: meaningDigest },
];
const href = `/backtest?replayRequestIdentity=${requestIdentity}&meaningDigest=${encodeURIComponent(meaningDigest)}`;

test("Replay operations point Run Detail at the canonical Backtest selector", () => {
  for (const operationId of [
    "exploratory_replay.submit_or_resolve.v2",
    "exploratory_replay.shadow_read.v2",
  ]) {
    assert.deepEqual(projectRdOwnerViewLocatorV1(operationId, fields), {
      schema_version: 1,
      source_owner: "exploratory_replay_owner",
      href,
      action_label: "Resolve same identity",
      identity_fields: fields,
    });
  }
});

test("Replay owner locator rejects malformed selectors before navigation", () => {
  assert.equal(projectRdOwnerViewLocatorV1("exploratory_replay.shadow_read.v2", [
    fields[0],
    { key: "meaning_digest", value: "not-a-digest" },
  ]), null);
  assert.equal(projectRdOwnerViewLocatorV1("exploratory_replay.shadow_read.v2", [
    fields[1],
    fields[0],
  ]), null);
});

test("Backtest parses the exact Replay selector and rejects former aliases", () => {
  const search = { replayRequestIdentity: requestIdentity, meaningDigest };
  assert.deepEqual(parseRdOwnerViewRequestV1("/backtest", search), {
    kind: "replay",
    requestIdentity,
    meaningDigest,
  });
  assert.equal(parseRdOwnerViewRequestV1("/backtest", { ...search, extra: "field" }), null);
  assert.equal(parseRdOwnerViewRequestV1("/rd/replay", search), null);
  assert.equal(parseRdOwnerViewRequestV1("/rd/decisions", {
    replayRequestIdentity: requestIdentity,
    replayMeaningDigest: meaningDigest,
  }), null);
});
