"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DASHBOARD_OVERVIEW_RUN_FILTER_V1 } from "../lib/dashboard-overview";
import {
  admitRunListViewResponseV2,
  type RunListViewEnvelopeV2,
} from "../lib/run-list-view-contract";
import {
  visibleAsyncReadAvailabilityV1,
  type AsyncReadAvailability,
} from "./ui/async-read-state";

type DashboardOverviewRunsState = Readonly<{
  availability: AsyncReadAvailability;
  projection: RunListViewEnvelopeV2 | null;
  reason: string | null;
}>;

const INITIAL_STATE: DashboardOverviewRunsState = {
  availability: "idle",
  projection: null,
  reason: null,
};

export function useDashboardOverviewRuns(enabled: boolean) {
  const [state, setState] = useState<DashboardOverviewRunsState>(INITIAL_STATE);
  const generation = useRef(0);

  const read = useCallback(async () => {
    if (!enabled) return;
    const current = generation.current + 1;
    generation.current = current;
    setState({ availability: "loading", projection: null, reason: null });
    try {
      const query = new URLSearchParams({
        kind: "runs",
        state: "all",
        search: "",
        duration: "any",
        pageSize: "50",
        page: "1",
      });
      const response = await fetch(`/api/operations/runs/?${query}`, {
        method: "GET",
        cache: "no-store",
      });
      const projection = admitRunListViewResponseV2(await response.json(), {
        response_ok: response.ok,
        filter_cut: DASHBOARD_OVERVIEW_RUN_FILTER_V1,
      });
      if (generation.current !== current) return;
      if (!projection || projection.availability !== "available") {
        setState({
          availability: "unavailable",
          projection: null,
          reason: projection?.unavailable_reason ?? "RUN_STORE_RESPONSE_UNAVAILABLE",
        });
        return;
      }
      setState({ availability: "available", projection, reason: null });
    } catch {
      if (generation.current === current) {
        setState({
          availability: "unavailable",
          projection: null,
          reason: "RUN_STORE_TRANSPORT_UNAVAILABLE",
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

  return {
    ...state,
    availability: visibleAsyncReadAvailabilityV1(enabled, state.availability),
    read,
  };
}
