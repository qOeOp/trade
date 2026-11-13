// The Trades window's tables (Trades, Cycles, Exceptions, Reconciliation) and its event list: figures right,
// words left, the detail columns giving way first when the page is narrow; the row picked on the chart
// scrolled into view.
import { useEffect, useRef } from "react";

export const DETAIL = "@max-[1120px]/page:hidden";
export const CELL = "h-(--form-h) whitespace-nowrap px-3 border-t border-line";
export const HEAD = "sticky top-0 z-[1] h-(--form-h) whitespace-nowrap bg-island px-3 text-small font-normal text-fg-faint";

/** A row's ref that scrolls the row into view while it is `picked`. */
export function usePickedScroll<T extends HTMLElement>(picked: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => { if (picked) ref.current?.scrollIntoView({ block: "nearest" }); }, [picked]);
  return ref;
}
