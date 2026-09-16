"use client";

import Link from "next/link";

import { ArtifactHistoricalReadbackContent } from "./artifact-historical-readback-content";
import { Button } from "./ui/button";
import { InterfaceIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import { PanelFrameInfo, PanelFrameInfoFact, PanelFrameInfoList } from "./ui/panel-frame";
import { useArtifactHistoricalReadback } from "./use-artifact-historical-readback";

export function ArtifactHistoricalReadbackDrilldown({
  buildRequestIdentity,
  attemptIdentity,
  onBack,
}: {
  buildRequestIdentity: string;
  attemptIdentity: string;
  onBack: () => void;
}) {
  const readback = useArtifactHistoricalReadback(buildRequestIdentity, attemptIdentity);

  return (
    <PageStack gap="compact">
      <div>
        <Button autoFocus type="button" variant="ghost" size="tool" onClick={onBack} data-artifact-readback-back>
          <InterfaceIcons.previous aria-hidden="true" /> Back to build summary
        </Button>
      </div>
      <ArtifactHistoricalReadbackContent status={readback.status} projection={readback.projection} />
      {readback.status === "available" && readback.projection ? <>
        <div>
          <Button asChild variant="outline" size="tool">
            <Link
              href={`/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}?custody=historical`}
              data-artifact-full-workspace
            >
              Open full build workspace <InterfaceIcons.next aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <PanelFrameInfo label="View build information">
          <PanelFrameInfoList>
            <PanelFrameInfoFact label="Build request"><code>{buildRequestIdentity}</code></PanelFrameInfoFact>
            <PanelFrameInfoFact label="Attempt"><code>{attemptIdentity}</code></PanelFrameInfoFact>
            <PanelFrameInfoFact label="Owner receipt">
              <code>{readback.projection.technical?.ownerReceiptIdentity ?? "Not available"}</code>
            </PanelFrameInfoFact>
            <PanelFrameInfoFact label="Raw result">
              <code>{readback.projection.outcome?.historicalDisposition ?? "Not available"}</code>
            </PanelFrameInfoFact>
            <PanelFrameInfoFact label="Raw reason">
              <code>{readback.projection.outcome?.failureCode ?? "Not available"}</code>
            </PanelFrameInfoFact>
          </PanelFrameInfoList>
        </PanelFrameInfo>
      </> : null}
    </PageStack>
  );
}
