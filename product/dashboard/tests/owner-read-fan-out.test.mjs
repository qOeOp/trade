import assert from "node:assert/strict";
import test from "node:test";

import { ownerReadFanOutLimitV1, withBoundedOwnerFanOutV1 } from "../lib/owner-read-fan-out.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

test("the fan-out admits its limit at once and queues the rest", async () => {
  const limit = ownerReadFanOutLimitV1();
  assert.ok(Number.isInteger(limit) && limit >= 1);
  const gates = Array.from({ length: limit + 3 }, () => deferred());
  let started = 0;
  let peak = 0;
  let active = 0;
  const reads = gates.map((gate) => withBoundedOwnerFanOutV1(async () => {
    started += 1;
    active += 1;
    peak = Math.max(peak, active);
    await gate.promise;
    active -= 1;
    return started;
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, limit, "only the limit may run before any read finishes");

  for (const gate of gates) gate.resolve();
  await Promise.all(reads);
  assert.equal(started, gates.length, "every queued read runs");
  assert.equal(peak, limit, "the limit is never exceeded");
  assert.equal(active, 0);
});

test("a failed read returns its place in the queue", async () => {
  const limit = ownerReadFanOutLimitV1();
  const failures = Array.from({ length: limit }, () => withBoundedOwnerFanOutV1(async () => {
    throw new Error("owner read failed");
  }).catch((error) => error.message));
  assert.deepEqual(await Promise.all(failures), Array.from({ length: limit }, () => "owner read failed"));

  // The budget a failed read held has to come back, or the next view never reads at all.
  let ran = false;
  await withBoundedOwnerFanOutV1(async () => {
    ran = true;
  });
  assert.equal(ran, true);
});

test("reads queued behind the limit all observe their own result", async () => {
  const limit = ownerReadFanOutLimitV1();
  const values = Array.from({ length: limit * 3 }, (unused, index) => index);
  const observed = await Promise.all(values.map((value) => withBoundedOwnerFanOutV1(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return value * 2;
  })));
  assert.deepEqual(observed, values.map((value) => value * 2));
});
