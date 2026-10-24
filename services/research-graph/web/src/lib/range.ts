/** Multiples of `step` from `lo` to `hi`, inclusive. */
export function steps(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
  return out;
}

/** Consecutive runs of items sharing a key, in order. */
export function runs<T, K>(items: readonly T[], key: (item: T) => K, adjacent: (a: T, b: T) => boolean): T[][] {
  const out: T[][] = [];
  for (const item of items) {
    const last = out.at(-1);
    const prev = last?.at(-1);
    if (last && prev !== undefined && key(prev) === key(item) && adjacent(prev, item)) last.push(item);
    else out.push([item]);
  }
  return out;
}
