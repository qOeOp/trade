function activeScrollHost(row: HTMLTableRowElement): HTMLElement | null {
  let current = row.parentElement;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function preserveRowViewportPosition(row: HTMLTableRowElement): void {
  const before = row.getBoundingClientRect().top;
  const stabilize = (frame: number) => {
    if (!row.isConnected) return;
    const delta = row.getBoundingClientRect().top - before;
    if (Math.abs(delta) > 0.5) {
      const scrollHost = activeScrollHost(row);
      if (scrollHost) scrollHost.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
    // Browser scroll anchoring can settle after React has already committed the
    // disclosure height change, especially while collapsing a long detail row.
    if (frame < 5) requestAnimationFrame(() => stabilize(frame + 1));
  };
  requestAnimationFrame(() => stabilize(0));
}
