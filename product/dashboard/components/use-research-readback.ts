"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseResearchReadbackBrowserProjectionV1,
  type ResearchReadbackProjectionV1,
} from "../lib/research-readback-gateway";

export type ResearchReadbackStatus = "loading" | "available" | "unavailable";

export function useResearchReadback(requestIdentity: string, enabled = true) {
  const [status, setStatus] = useState<ResearchReadbackStatus>("loading");
  const [projection, setProjection] = useState<ResearchReadbackProjectionV1 | null>(null);
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
      const response = await fetch(`/api/rd/research/${encodeURIComponent(requestIdentity)}/`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      const parsed = parseResearchReadbackBrowserProjectionV1(await response.json(), requestIdentity);
      if (generation.current !== current || controller.signal.aborted) return;
      if (!response.ok || !parsed || parsed.requestIdentity !== requestIdentity
        || parsed.availability !== "available") {
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
  }, [enabled, requestIdentity]);

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
