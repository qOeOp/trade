"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { parseResearchQuestionBrowserProjectionV1, type ResearchQuestionDirectoryV1 } from "../lib/research-question-directory";

export function useResearchQuestionDirectory(enabled: boolean) {
  const [projection, setProjection] = useState<ResearchQuestionDirectoryV1 | null>(null);
  const [availability, setAvailability] = useState<"idle" | "loading" | "available" | "unavailable">("idle");
  const generation = useRef(0);
  const read = useCallback(async () => {
    if (!enabled) return;
    const current = ++generation.current;
    setAvailability("loading");
    try {
      const response = await fetch("/api/rd/research/questions/", { cache: "no-store" });
      const parsed = parseResearchQuestionBrowserProjectionV1(await response.json());
      if (generation.current !== current) return;
      setProjection(response.ok ? parsed : null);
      setAvailability(response.ok && parsed ? "available" : "unavailable");
    } catch {
      if (generation.current === current) { setProjection(null); setAvailability("unavailable"); }
    }
  }, [enabled]);
  useEffect(() => { if (enabled && availability === "idle") void read(); }, [availability, enabled, read]);
  return { projection, availability, read };
}
