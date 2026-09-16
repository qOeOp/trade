import assert from "node:assert/strict";
import test from "node:test";

import { visibleAsyncReadAvailabilityV1 } from "../components/ui/async-read-state.ts";

test("an enabled first read is visible as loading instead of a false empty state", () => {
  assert.equal(visibleAsyncReadAvailabilityV1(true, "idle"), "loading");
  assert.equal(visibleAsyncReadAvailabilityV1(true, "loading"), "loading");
});

test("terminal read states and disabled idle state remain unchanged", () => {
  assert.equal(visibleAsyncReadAvailabilityV1(true, "available"), "available");
  assert.equal(visibleAsyncReadAvailabilityV1(true, "unavailable"), "unavailable");
  assert.equal(visibleAsyncReadAvailabilityV1(false, "idle"), "idle");
});
