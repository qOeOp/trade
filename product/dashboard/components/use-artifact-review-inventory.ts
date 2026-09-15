"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseArtifactReviewInventoryBrowserProjectionV1,
  type ArtifactReviewInventoryProjectionV1,
} from "../lib/artifact-review-inventory";

type ArtifactReviewInventoryState = Readonly<{
  availability: "idle" | "loading" | "available" | "unavailable";
  projection: ArtifactReviewInventoryProjectionV1 | null;
  reason: string | null;
}>;

const INITIAL_STATE: ArtifactReviewInventoryState = {
  availability: "idle",
  projection: null,
  reason: null,
};

export function useArtifactReviewInventory(enabled: boolean) {
  const [state, setState] = useState<ArtifactReviewInventoryState>(INITIAL_STATE);
  const generation = useRef(0);

  const read = useCallback(async () => {
    if (!enabled) return;
    const current = generation.current + 1;
    generation.current = current;
    setState((previous) => ({ ...previous, availability: "loading", reason: null }));
    try {
      const response = await fetch("/api/rd/artifacts/review-inventory/", {
        method: "GET",
        cache: "no-store",
      });
      const projection = parseArtifactReviewInventoryBrowserProjectionV1(await response.json());
      if (generation.current !== current) return;
      if (!response.ok || !projection || projection.availability !== "available") {
        setState({
          availability: "unavailable",
          projection: null,
          reason: projection?.reason ?? "ARTIFACT_REVIEW_INVENTORY_UNAVAILABLE",
        });
        return;
      }
      setState({ availability: "available", projection, reason: null });
    } catch {
      if (generation.current === current) {
        setState({
          availability: "unavailable",
          projection: null,
          reason: "ARTIFACT_REVIEW_INVENTORY_TRANSPORT_UNAVAILABLE",
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
