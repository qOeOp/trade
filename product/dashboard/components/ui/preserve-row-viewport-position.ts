function outerScrollHost(row: HTMLTableRowElement): HTMLElement | null {
  let current = row.closest<HTMLElement>(".data-workspace-table")?.parentElement ?? null;
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
  const scrollHost = outerScrollHost(row);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!row.isConnected) return;
      const delta = row.getBoundingClientRect().top - before;
      if (!delta) return;
      if (scrollHost) scrollHost.scrollTop += delta;
      else window.scrollBy(0, delta);
    });
  });
}
