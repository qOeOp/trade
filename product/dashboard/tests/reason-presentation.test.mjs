import assert from "node:assert/strict";
import test from "node:test";

import { humanizeReasonCode } from "../lib/reason-presentation.ts";

test("reason codes become readable copy without changing the exact source value", () => {
  assert.equal(humanizeReasonCode("INTENT_NOT_ELIGIBLE"), "Intent not eligible");
  assert.equal(humanizeReasonCode("BUILD_FAILED"), "Build failed");
  assert.equal(humanizeReasonCode("___"), "Reason unavailable");
});
