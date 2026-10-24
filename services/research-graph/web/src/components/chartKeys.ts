import type { KeyboardEvent } from "react";

// Keyboard reading of a chart (Chartability): Tab reaches the chart, the arrow keys step from mark to
// mark, Enter acts on the current one and Escape lets go. Left and right step through `along`, up and
// down through `across` (else `along`); `at` is the current mark's index in a list, or -1 before the first step.
export function chartKeys<T>({ along, across, at, move, enter, leave }: {
  along: readonly T[]; across?: readonly T[]; at: (list: readonly T[]) => number;
  move: (mark: T) => void; enter: (mark: T) => void; leave: () => void;
}) {
  return (e: KeyboardEvent) => {
    const step = { ArrowRight: [along, 1], ArrowLeft: [along, -1], ArrowUp: [across ?? along, 1], ArrowDown: [across ?? along, -1] } as const;
    const key = e.key as keyof typeof step;
    if (key in step) {
      const [list, d] = step[key], i = at(list);
      const next = list[i < 0 ? (d > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + d))];
      if (next !== undefined) { e.preventDefault(); move(next); }
    } else if (e.key === "Enter") {
      const current = along[at(along)];
      if (current !== undefined) { e.preventDefault(); enter(current); }
    } else if (e.key === "Escape") leave();
  };
}
