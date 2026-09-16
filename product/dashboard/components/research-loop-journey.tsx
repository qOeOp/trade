"use client";

import { useEffect, useState } from "react";

import { parseRdFormationCatalogDirectEnvelopeV1 } from "../lib/rd-formation-catalog-client";
import { parseRdIterationTimelineDirectEnvelopeV1 } from "../lib/rd-iteration-timeline-client";
import { projectRdLoopJourneyV1, type RdLoopJourneyV1 } from "../lib/rd-loop-journey";
import { JourneyProgress } from "./ui/journey-progress";

export function ResearchLoopJourney({ refreshKey }: { refreshKey: number }) {
  const [journey, setJourney] = useState<RdLoopJourneyV1 | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setJourney(null);
    void (async () => {
      try {
        const catalogResponse = await fetch("/api/rd/formation-catalog/", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!catalogResponse.ok) return;
        const catalog = parseRdFormationCatalogDirectEnvelopeV1(await catalogResponse.json());
        const family = catalog?.families.find(
          (candidate) => candidate.research.viewAvailability === "AVAILABLE",
        );
        if (!family) return;
        const timelineResponse = await fetch(
          `/api/rd/trial-families/${encodeURIComponent(family.trialFamilyIdentity)}/iterations/`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!timelineResponse.ok) return;
        const timeline = parseRdIterationTimelineDirectEnvelopeV1(
          await timelineResponse.json(), family.trialFamilyIdentity,
        );
        if (!timeline || controller.signal.aborted) return;
        setJourney(projectRdLoopJourneyV1(family, timeline));
      } catch {
        if (!controller.signal.aborted) setJourney(null);
      }
    })();
    return () => controller.abort();
  }, [refreshKey]);

  return journey ? <JourneyProgress
    eyebrow="R&D loop"
    summary={journey.summary}
    stages={journey.stages}
    aria-label="Current verified R&D loop"
  /> : null;
}
