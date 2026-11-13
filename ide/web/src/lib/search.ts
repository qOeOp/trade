// Binary search over values sorted oldest first, each read through `key` (index to time), so one search
// serves times, candles, points and bars alike.

/** The index of the last of the `n` values at or before `t`; -1 when none is. */
export function lastAtOrBefore(n: number, key: (i: number) => number, t: number): number {
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (key(mid) <= t) lo = mid + 1; else hi = mid; }
  return lo - 1;
}

/** The index of the first of the `n` values at or after `t`; `n` when none is. */
export function firstAtOrAfter(n: number, key: (i: number) => number, t: number): number {
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (key(mid) < t) lo = mid + 1; else hi = mid; }
  return lo;
}
