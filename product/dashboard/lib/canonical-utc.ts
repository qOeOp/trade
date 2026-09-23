// Canonical UTC as `docs/guide/dashboard.md` defines it: RFC3339 with exactly nine fractional digits
// and a `Z` offset. One definition for every Dashboard projection that states time, so a report and
// a chart cannot disagree about what a valid timestamp is.
const CANONICAL_UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{9}Z$/u;

export function isCanonicalUtc(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) return false;
  // The shape does not reject a date that does not exist. Its millisecond prefix does: `Date`
  // normalizes 2025-02-30 to a different day, so the round trip no longer returns the same text.
  const milliseconds = `${value.slice(0, 23)}Z`;
  const epoch = Date.parse(milliseconds);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === milliseconds;
}

// Compared as text, not through `Date.parse`. Canonical timestamps are fixed width, so their order as
// strings is their order in time, and unlike `Date.parse` it keeps the nanoseconds: two instants a
// nanosecond apart parse to the same millisecond and would read as one.
export function isStrictlyOrderedUtc(points: readonly { at: string }[]): boolean {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1].at >= points[index].at) return false;
  }
  return true;
}
