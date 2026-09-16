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
  const scrollHost = activeScrollHost(row);
  const beforeScrollPosition = scrollHost?.scrollTop ?? window.scrollY;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!row.isConnected) return;
      const currentScrollPosition = scrollHost?.scrollTop ?? window.scrollY;
      if (Math.abs(currentScrollPosition - beforeScrollPosition) > 0.5) return;
      const delta = row.getBoundingClientRect().top - before;
      if (Math.abs(delta) <= 0.5) return;
      if (scrollHost) scrollHost.scrollTop += delta;
      else window.scrollBy(0, delta);
    });
  });
}
