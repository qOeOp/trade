"use client";

import { ArtifactHistoricalReadbackContent } from "./artifact-historical-readback-content";
import { FilterButton, FilterLink } from "./ui/filter-toolbar";
import { InterfaceIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { useArtifactHistoricalReadback } from "./use-artifact-historical-readback";
import styles from "./research-readback-workspace.module.css";

export function ArtifactHistoricalReadbackWorkspace({
  buildRequestIdentity,
  attemptIdentity,
}: {
  buildRequestIdentity: string;
  attemptIdentity: string;
}) {
  const readback = useArtifactHistoricalReadback(buildRequestIdentity, attemptIdentity);

  return (
    <PanelFrame className={styles.panel} aria-labelledby="artifact-readback-title">
      <PanelFrameHeader
        eyebrow="Artifact"
        title="Build result"
        titleId="artifact-readback-title"
        actions={<>
          <FilterLink density="compact" variant="ghost" href="/rd/artifacts">
            <InterfaceIcons.previous aria-hidden="true" size={14} /> Back to artifacts
          </FilterLink>
          <FilterButton
            density="compact"
            variant="secondary"
            type="button"
            onClick={() => void readback.read()}
            disabled={readback.status === "loading"}
          >
            <InterfaceIcons.refresh aria-hidden="true" size={14} />
            {readback.status === "loading" ? "Reading…" : "Refresh"}
          </FilterButton>
          <PanelFrameInfo label="View Artifact custody details">
            <PanelFrameInfoList>
              <PanelFrameInfoFact label="Build request"><code>{buildRequestIdentity}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Attempt"><code>{attemptIdentity}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Owner receipt">
                <code>{readback.projection?.technical?.ownerReceiptIdentity ?? "Not available"}</code>
              </PanelFrameInfoFact>
              <PanelFrameInfoFact label="Raw result">
                <code>{readback.projection?.outcome?.historicalDisposition ?? "Not available"}</code>
              </PanelFrameInfoFact>
              <PanelFrameInfoFact label="Raw reason">
                <code>{readback.projection?.outcome?.failureCode ?? "Not available"}</code>
              </PanelFrameInfoFact>
            </PanelFrameInfoList>
          </PanelFrameInfo>
        </>}
      />
      <PanelFrameBody className={styles.body}>
        <ArtifactHistoricalReadbackContent
          status={readback.status}
          projection={readback.projection}
        />
      </PanelFrameBody>
    </PanelFrame>
  );
}
