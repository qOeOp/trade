import { useLayoutEffect, useRef } from "react";

/** A one-line flex row (`ref`) that keeps its children whole: where they do not all fit its width, children
 *  are left out by their `data-rank`, the highest first and the later of equals first, until the rest fit;
 *  a child of rank 0 (or none) always stays. Never cut. A row that wraps (flex-wrap not nowrap) keeps every
 *  child. Laid out again after every render and whenever the row's width changes. */
export function useOmitByRank<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const fit = () => {
    const row = ref.current;
    if (!row) return;
    const kids = [...row.children].filter((k): k is HTMLElement => k instanceof HTMLElement);
    for (const k of kids) k.hidden = false;
    const style = getComputedStyle(row);
    if (style.flexWrap !== "nowrap") return;
    const gap = parseFloat(style.columnGap) || 0, room = row.clientWidth + 0.5, widths = kids.map((k) => k.getBoundingClientRect().width);
    const rank = (i: number) => Number(kids[i]!.dataset.rank ?? 0);
    let total = widths.reduce((n, w) => n + w, 0) + gap * Math.max(0, kids.length - 1);
    for (const i of kids.map((_, i) => i).sort((a, b) => rank(b) - rank(a) || b - a)) {
      if (total <= room || rank(i) <= 0) break;
      kids[i]!.hidden = true;
      total -= widths[i]! + gap;
    }
  };
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  return ref;
}
