"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  normalizeStrategyCodeViewerProjection,
  unavailableStrategyCodeViewer,
  type StrategyCodeViewerProjection,
} from "../lib/strategy-code-viewer-contract";
import { StrategyCodeViewer } from "./ui/strategy-code-viewer";

const loadingProjection: StrategyCodeViewerProjection = {
  availability: "loading",
  artifactIdentity: null,
  observedAt: null,
  source: null,
  wasmPreview: null,
  reason: null,
};

// A failed read answers with the gateway's own unavailable projection, whose reason already
// distinguishes an absent attempt (`ARTIFACT_SOURCE_UNAVAILABLE`) from a rejected Owner answer
// (`OWNER_RESPONSE_UNAVAILABLE`). That projection is kept as it is; only a body that is not such
// a projection collapses to the generic response reason.
function gatewayUnavailableProjection(raw: unknown, parsed: StrategyCodeViewerProjection): boolean {
  return typeof raw === "object" && raw !== null
    && (raw as { availability?: unknown }).availability === "unavailable"
    && parsed.availability === "unavailable"
    && parsed.reason !== null;
}

export function ArtifactSourceWorkspace({
  buildRequestIdentity,
  attemptIdentity,
}: {
  buildRequestIdentity: string;
  attemptIdentity: string;
}) {
  const [projection, setProjection] = useState<StrategyCodeViewerProjection>(loadingProjection);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setProjection(loadingProjection);
    try {
      const response = await fetch(
        `/api/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/source/`,
        { method: "GET", cache: "no-store", signal: controller.signal },
      );
      const raw: unknown = await response.json();
      const parsed = normalizeStrategyCodeViewerProjection(raw);
      if (generation.current !== current || controller.signal.aborted) return;
      setProjection(response.ok || gatewayUnavailableProjection(raw, parsed)
        ? parsed
        : unavailableStrategyCodeViewer("ARTIFACT_SOURCE_RESPONSE_UNAVAILABLE"));
    } catch {
      if (generation.current !== current || controller.signal.aborted) return;
      setProjection(unavailableStrategyCodeViewer("ARTIFACT_SOURCE_TRANSPORT_UNAVAILABLE"));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [attemptIdentity, buildRequestIdentity]);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [refresh]);

  return (
    <StrategyCodeViewer
      projection={projection}
      eyebrow="Verified Artifact custody"
      title="Strategy source"
    />
  );
}
