"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseArtifactHistoricalBrowserProjectionV1,
  type ArtifactHistoricalReadbackProjectionV1,
} from "../lib/artifact-readback-gateway";

export type ArtifactHistoricalReadbackStatus = "loading" | "available" | "unavailable";

export function useArtifactHistoricalReadback(
  buildRequestIdentity: string,
  attemptIdentity: string,
  enabled = true,
) {
  const [status, setStatus] = useState<ArtifactHistoricalReadbackStatus>("loading");
  const [projection, setProjection] = useState<ArtifactHistoricalReadbackProjectionV1 | null>(null);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const read = useCallback(async () => {
    if (!enabled) return;
    const current = ++generation.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus("loading");
    setProjection(null);
    try {
      const response = await fetch(
        `/api/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/readback/`,
        { method: "GET", cache: "no-store", signal: controller.signal },
      );
      const parsed = parseArtifactHistoricalBrowserProjectionV1(
        await response.json(),
        buildRequestIdentity,
        attemptIdentity,
      );
      if (generation.current !== current || controller.signal.aborted) return;
      if (!response.ok || !parsed || parsed.availability !== "available") {
        setProjection(parsed?.availability === "unavailable" ? parsed : null);
        setStatus("unavailable");
        return;
      }
      setProjection(parsed);
      setStatus("available");
    } catch {
      if (generation.current !== current || controller.signal.aborted) return;
      setProjection(null);
      setStatus("unavailable");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [attemptIdentity, buildRequestIdentity, enabled]);

  useEffect(() => {
    if (enabled) void read();
    return () => {
      generation.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [enabled, read]);

  return { status, projection, read };
}
