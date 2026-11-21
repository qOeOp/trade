import { useEffect, useState } from "react";

/** The time now, read again every `ms`, for readings that age (a bar's lateness, a run's age). */
export function useNow(ms = 5000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}
