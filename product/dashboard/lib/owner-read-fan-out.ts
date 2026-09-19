// One queue for every Owner read the Dashboard issues per listed candidate.
//
// Some views are composed from one Owner point read per row: the research outcome inventory reads
// each candidate request, the artifact review inventory reads each attempt, and a single page can
// ask for both at once alongside its directory reads. Each adapter behind the Owner read API holds
// a small connection pool, so two views bounding themselves separately still oversubscribe it, and
// a directory read sharing that adapter waits behind a dozen point reads until its own operation
// budget expires. The surface then reports the whole source as unavailable, which reads as a
// broken Owner rather than as contention the Dashboard created.
//
// Bounding the fan-out in one place keeps that from happening and keeps the remaining failures
// honest: a read that still outlives its operation budget after waiting here is a real budget
// breach worth treating as a defect.
//
// This is a bound on concurrency, not a fix for the shape. A view whose Owner reads grow with the
// number of rows it shows is missing a bounded Owner read; see the Dashboard guide's Recent
// outcomes section.

// One. The adapter behind these point reads also answers the page's directory and question reads,
// and a page composes all of them at once: measured against a real Owner, a fan-out of two still
// took every single read with it, and the surface reported its sources unavailable while every row
// it held was fine.
//
// What serializing costs, so the trade is visible from here: a point read answers in roughly 30 to
// 70 ms against a local Owner, and a page of this size asks for about twenty of them, so its rows
// arrive over something near a second instead of in a few hundred milliseconds. Parallelism was
// worth having for exactly that second; it is not worth having at the price of the page reporting
// its sources unavailable. Anyone restoring it needs the point reads to stop sharing a pool with
// the reads that must answer alongside them.
//
// This is a bound, not the shape. A view whose Owner reads grow with its row count needs a bounded
// Owner read; see the Dashboard guide's Recent outcomes section.
const OWNER_READ_FAN_OUT_LIMIT = 1;

let active = 0;
const waiting: (() => void)[] = [];

function release(): void {
  const next = waiting.shift();
  if (next) {
    next();
    return;
  }
  active -= 1;
}

async function acquire(): Promise<void> {
  if (active < OWNER_READ_FAN_OUT_LIMIT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

/**
 * Runs one per-candidate Owner read, waiting until the shared fan-out budget admits it.
 *
 * The read runs to completion even when it fails; the budget is always returned.
 */
export async function withBoundedOwnerFanOutV1<T>(read: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await read();
  } finally {
    release();
  }
}

/** The number of per-candidate Owner reads that may be in flight across every view at once. */
export function ownerReadFanOutLimitV1(): number {
  return OWNER_READ_FAN_OUT_LIMIT;
}
