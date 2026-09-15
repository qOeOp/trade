"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseResearchOutcomeInventoryBrowserProjectionV1,
  type ResearchOutcomeInventoryProjectionV1,
} from "../lib/research-outcome-inventory";

type ResearchOutcomeInventoryState = Readonly<{
  availability: "idle" | "loading" | "available" | "unavailable";
  projection: ResearchOutcomeInventoryProjectionV1 | null;
  reason: string | null;
}>;

const INITIAL_STATE: ResearchOutcomeInventoryState = {
  availability: "idle",
  projection: null,
  reason: null,
};

export function useResearchOutcomeInventory(enabled: boolean) {
  const [state, setState] = useState<ResearchOutcomeInventoryState>(INITIAL_STATE);
  const generation = useRef(0);

  const read = useCallback(async () => {
    if (!enabled) return;
    const current = generation.current + 1;
    generation.current = current;
    setState((previous) => ({ ...previous, availability: "loading", reason: null }));
    try {
      const response = await fetch("/api/rd/research/outcome-inventory/", {
        method: "GET",
        cache: "no-store",
      });
      const projection = parseResearchOutcomeInventoryBrowserProjectionV1(await response.json());
      if (generation.current !== current) return;
      if (!response.ok || !projection || projection.availability !== "available") {
        setState({
          availability: "unavailable",
          projection: null,
          reason: projection?.reason ?? "RESEARCH_OUTCOME_INVENTORY_UNAVAILABLE",
        });
        return;
      }
      setState({ availability: "available", projection, reason: null });
    } catch {
      if (generation.current === current) {
        setState({
          availability: "unavailable",
          projection: null,
          reason: "RESEARCH_OUTCOME_INVENTORY_TRANSPORT_UNAVAILABLE",
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
