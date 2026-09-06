"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseHistoricalCustodyBrowserEnvelopeV1,
  type HistoricalCustodyProjectionV1,
} from "../lib/rd-historical-custody-client";

type HistoricalCustodyDirectoryState = Readonly<{
  availability: "idle" | "loading" | "available" | "unavailable";
  projection: HistoricalCustodyProjectionV1 | null;
  reason: string | null;
}>;

const INITIAL_STATE: HistoricalCustodyDirectoryState = {
  availability: "idle",
  projection: null,
  reason: null,
};

export function useHistoricalCustodyDirectory(enabled: boolean) {
  const [state, setState] = useState<HistoricalCustodyDirectoryState>(INITIAL_STATE);
  const generation = useRef(0);

  const read = useCallback(async () => {
    if (!enabled) return;
    const current = generation.current + 1;
    generation.current = current;
    setState((previous) => ({ ...previous, availability: "loading", reason: null }));
    try {
      const response = await fetch("/api/rd/historical-custodies/", {
        method: "GET",
        cache: "no-store",
      });
      const projection = parseHistoricalCustodyBrowserEnvelopeV1(await response.json());
      if (generation.current !== current) return;
      if (!response.ok || !projection) {
        setState({
          availability: "unavailable",
          projection: null,
          reason: "CUSTODY_CANDIDATE_DIRECTORY_UNAVAILABLE",
        });
        return;
      }
      setState({ availability: "available", projection, reason: null });
    } catch {
      if (generation.current === current) {
        setState({
          availability: "unavailable",
          projection: null,
          reason: "CUSTODY_CANDIDATE_TRANSPORT_UNAVAILABLE",
        });
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled && state.availability === "idle") {
      void read();
      return;
    }
    if (!enabled && state.availability !== "idle") {
      generation.current += 1;
      setState(INITIAL_STATE);
    }
  }, [enabled, read, state.availability]);

  return { ...state, read };
}
