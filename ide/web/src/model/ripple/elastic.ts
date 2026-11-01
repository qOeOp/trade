// One axis of the hover expansion: the hovered tile's two split lines move apart to the target size, the
// lines on each side close up by how much their stretches can give (intervals.ts), no tile goes under MIN
// unless it started smaller, and the lines keep their order (vibe-trading's elasticRedistribute).
import { region } from "./intervals";
import { MIN } from "./split";

type Spans = readonly [number, number][];
const at = (xs: readonly number[], i: number) => xs[i] as number;
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** The hovered tile's new edges: as far as the target asks, from the side that can give more. */
function expand(cans: readonly number[], idxLo: number, idxHi: number, target: number, vbLo: number, vbHi: number, spans: Spans): [number, number] {
  const hovLo = at(cans, idxLo), hovHi = at(cans, idxHi), need = target - (hovHi - hovLo);
  const pinnedLeft = idxLo === 0, pinnedRight = idxHi === cans.length - 1;
  if (pinnedLeft && pinnedRight) return [vbLo, vbHi];
  if (pinnedLeft) return [vbLo, Math.min(vbLo + target, vbHi)];
  if (pinnedRight) return [Math.max(vbHi - target, vbLo), vbHi];
  const spaceBefore = hovLo - vbLo, spaceAfter = vbHi - hovHi;
  const effBefore = Math.min(spaceBefore, region(cans, range(0, idxLo), spans, hovLo, hovHi).trueCapacity);
  const effAfter = Math.min(spaceAfter, region(cans, range(idxHi, cans.length - 1), spans, hovLo, hovHi).trueCapacity);
  const eff = effBefore + effAfter, space = spaceBefore + spaceAfter;
  let before = eff > 0.01 ? need * (effBefore / eff) : space > 0.01 ? need * (spaceBefore / space) : need / 2;
  let after = eff > 0.01 ? need * (effAfter / eff) : space > 0.01 ? need * (spaceAfter / space) : need / 2;
  if (before > effBefore && effBefore < spaceBefore) { after += before - effBefore; before = effBefore; }
  if (after > effAfter && effAfter < spaceAfter) { before += after - effAfter; after = effAfter; }
  if (before > spaceBefore) { after += before - spaceBefore; before = spaceBefore; }
  if (after > spaceAfter) { before += after - spaceAfter; after = spaceAfter; }
  let lo = hovLo - before, hi = hovHi + after;
  if (lo < vbLo) { hi += vbLo - lo; lo = vbLo; }
  if (hi > vbHi) { lo -= hi - vbHi; hi = vbHi; }
  return [Math.max(lo, vbLo), Math.min(hi, vbHi)];
}

/** Maps one side's lines into its new, shorter or longer, extent, squeezing the roomy stretches first. */
function mapSide(pos: Map<number, number>, cans: readonly number[], indices: number[], spans: Spans, hov: [number, number],
                 from: [number, number], to: [number, number]): void {
  if (!indices.length) return;
  const [origStart, origEnd] = from, [newStart, newEnd] = to, origRange = origEnd - origStart, newRange = newEnd - newStart;
  const linear = () => { for (const i of indices) pos.set(at(cans, i), newStart + ((at(cans, i) - origStart) / origRange) * newRange); };
  if (origRange < 0.01) { for (const i of indices) pos.set(at(cans, i), newStart); return; }
  if (newRange >= origRange - 0.5) return linear();
  const r = region(cans, indices, spans, hov[0], hov[1]);
  if (r.totalWeight < 0.01) return linear();
  const squeeze = origRange - newRange;
  const sizes = r.intervals.map((iv) => iv.size - Math.min(iv.weight > 0 ? squeeze * (iv.weight / r.totalWeight) : 0, Math.max(0, iv.size - iv.minSize)));
  const total = sizes.reduce((a, b) => a + b, 0);
  if (Math.abs(total - newRange) > 0.5 && total > 0.01) for (let k = 0; k < sizes.length; k++) sizes[k] = at(sizes, k) * (newRange / total);
  let cursor = newStart;
  pos.set(at(cans, at(indices, 0)), newStart);
  r.intervals.forEach((iv, k) => { cursor += at(sizes, k); pos.set(iv.hi, cursor); });
  pos.set(at(cans, at(indices, indices.length - 1)), newEnd);
}

/** Pushes lines apart until no tile is under MIN (or its own starting size), the hovered edges fixed. */
function keepMin(pos: Map<number, number>, spans: Spans, locked: ReadonlySet<number>, vbLo: number, vbHi: number): void {
  for (let iter = 0; iter < 50; iter++) {
    let moved = false;
    for (const [tLo, tHi] of spans) {
      const curLo = pos.get(tLo), curHi = pos.get(tHi);
      if (curLo === undefined || curHi === undefined) continue;
      const least = Math.min(MIN, tHi - tLo);
      if (curHi - curLo >= least - 0.5 || (locked.has(tLo) && locked.has(tHi))) continue;
      const mid = (curLo + curHi) / 2;
      let lo = mid - least / 2, hi = mid + least / 2;
      if (lo < vbLo) { lo = vbLo; hi = vbLo + least; }
      if (hi > vbHi) { hi = vbHi; lo = vbHi - least; }
      if (locked.has(tLo)) { lo = curLo; hi = Math.min(curLo + least, vbHi); }
      if (locked.has(tHi)) { hi = curHi; lo = Math.max(curHi - least, vbLo); }
      if (!locked.has(tLo) && Math.abs((pos.get(tLo) ?? curLo) - lo) > 0.5) { pos.set(tLo, lo); moved = true; }
      if (!locked.has(tHi) && Math.abs((pos.get(tHi) ?? curHi) - hi) > 0.5) { pos.set(tHi, hi); moved = true; }
    }
    if (!moved) return;
  }
}

/** Each split line's new position on one axis when the tile between hovLo and hovHi grows to `target`. */
export function redistribute(cans: readonly number[], hovLo: number, hovHi: number, target: number, vbLo: number, vbHi: number, spans: Spans): Map<number, number> {
  const pos = new Map<number, number>(), n = cans.length;
  const idxLo = cans.indexOf(hovLo), idxHi = cans.indexOf(hovHi);
  if (idxLo === -1 || idxHi === -1) { cans.forEach((c) => pos.set(c, c)); return pos; }
  const [newLo, newHi] = expand(cans, idxLo, idxHi, target, vbLo, vbHi, spans);
  mapSide(pos, cans, range(0, idxLo), spans, [hovLo, hovHi], [at(cans, 0), hovLo], [vbLo, newLo]);
  for (const i of range(idxLo, idxHi)) pos.set(at(cans, i), hovHi - hovLo < 0.01 ? newLo : newLo + ((at(cans, i) - hovLo) / (hovHi - hovLo)) * (newHi - newLo));
  mapSide(pos, cans, range(idxHi, n - 1), spans, [hovLo, hovHi], [hovHi, at(cans, n - 1)], [newHi, vbHi]);
  pos.set(hovLo, newLo);
  pos.set(hovHi, newHi);
  const locked = new Set([hovLo, hovHi]);
  keepMin(pos, spans, locked, vbLo, vbHi);
  let last = -Infinity;
  for (const c of cans) {
    const p = pos.get(c) ?? c;
    if (p < last && !locked.has(c)) pos.set(c, last);
    else last = p;
  }
  return pos;
}
