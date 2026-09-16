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
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!row.isConnected) return;
      const delta = row.getBoundingClientRect().top - before;
      if (Math.abs(delta) <= 0.5) return;
      const scrollHost = activeScrollHost(row);
      if (scrollHost) scrollHost.scrollTop += delta;
      else window.scrollBy(0, delta);
    });
  });
}
