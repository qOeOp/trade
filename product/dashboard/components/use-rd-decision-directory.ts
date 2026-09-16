"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseRdFormationCatalogDirectEnvelopeV1,
  type RdFormationCatalogFamilyV1,
} from "../lib/rd-formation-catalog-client";
import {
  parseRdIterationTimelineDirectEnvelopeV1,
  type RdIterationTimelineProjectionV1,
} from "../lib/rd-iteration-timeline-client";
import {
  projectRdDecisionDirectoryV1,
  type RdDecisionDirectoryV1,
} from "../lib/rd-decision-directory";
import type { AsyncReadAvailability } from "./ui/async-read-state";

const MAX_TIMELINE_CONCURRENCY = 4;

async function readTimelines(
  families: readonly RdFormationCatalogFamilyV1[],
  signal: AbortSignal,
): Promise<RdIterationTimelineProjectionV1[] | null> {
  const timelines = new Array<RdIterationTimelineProjectionV1>(families.length);
  let nextIndex = 0;
  let unavailable = false;
  const consume = async () => {
    while (!unavailable && nextIndex < families.length) {
      const index = nextIndex;
      nextIndex += 1;
      const family = families[index];
      const response = await fetch(
        `/api/rd/trial-families/${encodeURIComponent(family.trialFamilyIdentity)}/iterations/`,
        { cache: "no-store", signal },
      );
      const parsed = response.ok
        ? parseRdIterationTimelineDirectEnvelopeV1(
          await response.json(), family.trialFamilyIdentity,
        )
        : null;
      if (!parsed) { unavailable = true; return; }
      timelines[index] = parsed;
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(MAX_TIMELINE_CONCURRENCY, families.length) },
    () => consume(),
  ));
  return unavailable ? null : timelines;
}

export function useRdDecisionDirectory() {
  const [projection, setProjection] = useState<RdDecisionDirectoryV1 | null>(null);
  const [availability, setAvailability] = useState<AsyncReadAvailability>("idle");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    const current = ++generation.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setProjection(null);
    setAvailability("loading");
    try {
      const catalogResponse = await fetch("/api/rd/formation-catalog/", {
        cache: "no-store",
        signal: nextController.signal,
      });
      const catalog = catalogResponse.ok
        ? parseRdFormationCatalogDirectEnvelopeV1(await catalogResponse.json())
        : null;
      if (!catalog) throw new Error("formation catalog unavailable");
      const timelines = await readTimelines(catalog.families, nextController.signal);
      const nextProjection = timelines ? projectRdDecisionDirectoryV1(catalog, timelines) : null;
      if (generation.current !== current || nextController.signal.aborted) return;
      setProjection(nextProjection);
      setAvailability(nextProjection ? "available" : "unavailable");
    } catch {
      if (generation.current === current && !nextController.signal.aborted) {
        setProjection(null);
        setAvailability("unavailable");
      }
    }
  }, []);
  useEffect(() => { if (availability === "idle") void read(); }, [availability, read]);
  useEffect(() => () => controller.current?.abort(), []);
  return { projection, availability, read };
}
