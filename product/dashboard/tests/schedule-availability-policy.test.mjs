import assert from "node:assert/strict";
import test from "node:test";

import { scheduleAvailabilityPresentationV1 } from "../lib/schedule-availability-policy.ts";

test("schedule availability presentation distinguishes missing configuration from expired evidence", () => {
  assert.deepEqual(scheduleAvailabilityPresentationV1("SCHEDULE_CONFIGURATION_UNAVAILABLE"), {
    title: "Schedule set not configured",
    summaryValue: "Not configured",
    detail: "No content-addressed zero-effect read schedule set is admitted for this Dashboard instance.",
  });
  assert.deepEqual(scheduleAvailabilityPresentationV1("SCHEDULE_COMPATIBILITY_UNAVAILABLE"), {
    title: "Schedule compatibility expired",
    summaryValue: "Expired",
    detail: "The configured read schedule set is retained, but its finite Owner compatibility evidence is unavailable or expired. An operator must supply a fresh evidence cut before another due cut can be enqueued.",
  });
});

test("schedule availability presentation fails closed for malformed and unknown reasons", () => {
  assert.equal(
    scheduleAvailabilityPresentationV1("MALFORMED_SCHEDULE_RESPONSE").title,
    "Schedule response rejected",
  );
  assert.deepEqual(scheduleAvailabilityPresentationV1("UNRECOGNIZED_REASON"), {
    title: "Schedule projection unavailable",
    summaryValue: "Unavailable",
    detail: "The schedule projection failed closed with an unrecognized bounded reason. No schedule state or action was inferred.",
  });
  assert.equal(scheduleAvailabilityPresentationV1(null).summaryValue, "Reading");
});
