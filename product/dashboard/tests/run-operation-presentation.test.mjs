import assert from "node:assert/strict";
import test from "node:test";

import { runListOperationIdsV1 } from "../lib/run-list-contract.ts";
import { runOperationLabel } from "../lib/run-operation-presentation.ts";

test("every retained run operation has one business-facing label", () => {
  const labels = runListOperationIdsV1.map(runOperationLabel);

  assert.equal(labels.length, runListOperationIdsV1.length);
  assert.equal(new Set(labels).size, labels.length);
  for (const [index, label] of labels.entries()) {
    assert.ok(label.length > 0);
    assert.notEqual(label, runListOperationIdsV1[index]);
    assert.doesNotMatch(label, /[._]/u);
  }
});
