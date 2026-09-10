"use client";

import { useEffect, useState } from "react";

const DEFAULT_PENDING_DELAY_MS = 160;

export function useDelayedPending(pending: boolean, delayMs = DEFAULT_PENDING_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return undefined;
    }

    const timeout = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, pending]);

  return pending && visible;
}
