import { useLayoutEffect, useRef, useState } from "react";

const BORDER = 2;  // px: a card's border, top and bottom

/** Which of a scrolling column's cards are open (Section): at first, and whenever the cards present or
 *  the column's height change, as many as fit without scrolling, folding them in `order` (the first to
 *  fold first) while the column overflows; once the user opens or closes one, theirs. `column` takes the
 *  ref of the column's content (inside the scroll viewport), `card(key)` each card's; `control(key)` is
 *  a card's state for Section. */
export function useFold(order: readonly string[]) {
  const column = useRef<HTMLDivElement>(null), cards = useRef(new Map<string, HTMLElement>()), full = useRef(new Map<string, number>());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(order));
  const [manual, setManual] = useState(false);
  const present = order.join();

  // A card that arrives opens, to be measured, unless the user has taken over.
  useLayoutEffect(() => { if (!manual) setOpen(new Set(order)); }, [present]);
  useLayoutEffect(() => {
    const content = column.current, view = content?.parentElement;
    if (!content || !view || manual) return;
    const fit = () => {
      for (const [k, el] of cards.current) if (open.has(k)) full.current.set(k, el.offsetHeight);
      const saves = (k: string) => {
        const el = cards.current.get(k), head = el?.firstElementChild instanceof HTMLElement ? el.firstElementChild.offsetHeight + BORDER : 0;
        return Math.max(0, (full.current.get(k) ?? head) - head);
      };
      // How far the column would overflow with every card open, folded in turn until it does not.
      let over = content.offsetHeight - view.clientHeight + order.filter((k) => !open.has(k)).reduce((sum, k) => sum + saves(k), 0);
      const next = new Set(order);
      for (const k of order) { if (over <= 0) break; next.delete(k); over -= saves(k); }
      // Then any folded card that fits in what is left after all reopens, from the top.
      for (const k of [...order].reverse()) if (!next.has(k) && saves(k) <= -over) { next.add(k); over += saves(k); }
      if (next.size !== open.size || [...next].some((k) => !open.has(k))) setOpen(next);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(view);
    watch.observe(content);
    return () => watch.disconnect();
  }, [open, manual, present]);

  return {
    column,
    card: (key: string) => (el: HTMLElement | null) => { if (el) cards.current.set(key, el); else cards.current.delete(key); },
    control: (key: string): [boolean, (o: boolean) => void] => [open.has(key), (o) => {
      setManual(true);
      setOpen((now) => { const next = new Set(now); if (o) next.add(key); else next.delete(key); return next; });
    }],
  };
}
