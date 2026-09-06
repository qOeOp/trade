"use client";

import { useCallback, useEffect, useState } from "react";

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

export function ArtifactSourceWorkspace({
  buildRequestIdentity,
  attemptIdentity,
}: {
  buildRequestIdentity: string;
  attemptIdentity: string;
}) {
  const [projection, setProjection] = useState<StrategyCodeViewerProjection>(loadingProjection);

  const refresh = useCallback(async () => {
    setProjection(loadingProjection);
    try {
      const response = await fetch(
        `/api/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/source/`,
        { method: "GET", cache: "no-store" },
      );
      setProjection(normalizeStrategyCodeViewerProjection(await response.json()));
    } catch {
      setProjection(unavailableStrategyCodeViewer("ARTIFACT_SOURCE_TRANSPORT_UNAVAILABLE"));
    }
  }, [attemptIdentity, buildRequestIdentity]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <StrategyCodeViewer
      projection={projection}
      eyebrow="Verified Artifact custody"
      title="Strategy source"
    />
  );
}
