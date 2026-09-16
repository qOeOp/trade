"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  admitRunListViewResponseV2,
  type RunListFilterCutV2,
  type RunListViewEnvelopeV2,
} from "../lib/run-list-view-contract";
import {
  visibleAsyncReadAvailabilityV1,
  type AsyncReadAvailability,
} from "./ui/async-read-state";

type RunListViewState = Readonly<{
  availability: AsyncReadAvailability;
  projection: RunListViewEnvelopeV2 | null;
  reason: string | null;
}>;

const INITIAL_STATE: RunListViewState = {
  availability: "idle",
  projection: null,
  reason: null,
};

export function useRunListView(enabled: boolean, filter: RunListFilterCutV2) {
  const [state, setState] = useState<RunListViewState>(INITIAL_STATE);
  const generation = useRef(0);
  const {
    duration,
    kind,
    page,
    page_size: pageSize,
    search,
    state: runState,
  } = filter;

  const read = useCallback(async () => {
    if (!enabled) return;
    const current = generation.current + 1;
    generation.current = current;
    setState({ availability: "loading", projection: null, reason: null });
    const filterCut: RunListFilterCutV2 = {
      schema_version: 1,
      kind,
      state: runState,
      search,
      duration,
      page_size: pageSize,
      page,
    };
    try {
      const query = new URLSearchParams({
        kind,
        state: runState,
        search,
        duration,
        pageSize: String(pageSize),
        page: String(page),
      });
      const response = await fetch(`/api/operations/runs/?${query}`, {
        method: "GET",
        cache: "no-store",
      });
      const projection = admitRunListViewResponseV2(await response.json(), {
        response_ok: response.ok,
        filter_cut: filterCut,
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
  }, [duration, enabled, kind, page, pageSize, runState, search]);

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
