/** `next` with each part deep-equal to `prev`'s being `prev`'s own object, so whatever reads a part (a memo,
 *  a chart) sees no change where a new read changed nothing. For plain JSON that is never mutated. */
export function shared<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next) || !prev || !next || typeof prev !== "object" || typeof next !== "object" || Array.isArray(prev) !== Array.isArray(next)) return next;
  const a = prev as Record<string, unknown>, b = next as Record<string, unknown>, keys = Object.keys(b);
  const out = (Array.isArray(next) ? [] : {}) as Record<string, unknown>;
  let same = keys.length === Object.keys(a).length;
  for (const k of keys) {
    out[k] = shared(a[k], b[k]);
    same &&= k in a && out[k] === a[k];
  }
  return (same ? prev : out) as T;
}
