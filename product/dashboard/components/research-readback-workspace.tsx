"use client";

import { researchQuestionForReadbackV1 } from "../lib/research-question-directory";
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
import { ResearchReadbackContent } from "./research-readback-content";
import { useResearchReadback } from "./use-research-readback";
import { useResearchQuestionDirectory } from "./use-research-question-directory";
import styles from "./research-readback-workspace.module.css";

export function ResearchReadbackWorkspace({ requestIdentity }: { requestIdentity: string }) {
  const readback = useResearchReadback(requestIdentity);
  const questions = useResearchQuestionDirectory(true);
  const question = researchQuestionForReadbackV1(questions.projection, readback.projection);

  return (
    <PanelFrame className={styles.panel} aria-labelledby="research-readback-title">
      <PanelFrameHeader
        eyebrow="Research"
        title="Research outcome"
        titleId="research-readback-title"
        actions={<>
          <FilterLink density="compact" variant="ghost" href="/rd/research">
            <InterfaceIcons.previous aria-hidden="true" size={14} /> Back to requests
          </FilterLink>
          <FilterButton density="compact" variant="secondary" type="button" onClick={() => void Promise.all([readback.read(), questions.read()])} disabled={readback.status === "loading"}>
            <InterfaceIcons.refresh aria-hidden="true" size={14} /> {readback.status === "loading" ? "Reading…" : "Refresh"}
          </FilterButton>
          <PanelFrameInfo label="View Research custody details">
            <PanelFrameInfoList>
              <PanelFrameInfoFact label="Request"><code>{requestIdentity}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Owner receipt"><code>{readback.projection?.technical?.ownerReceiptIdentity ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Semantic digest"><code>{readback.projection?.technical?.semanticDigest ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Projection"><code>{readback.projection?.technical?.projectionIdentity ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Source cut"><code>{readback.projection?.technical?.sourceCut ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Trial family"><code>{readback.projection?.technical?.trialFamilyIdentity ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Raw outcome"><code>{readback.projection?.outcome?.resolution ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Raw reason"><code>{readback.projection?.outcome?.rejectionCode ?? "Not available"}</code></PanelFrameInfoFact>
            </PanelFrameInfoList>
          </PanelFrameInfo>
        </>}
      />
      <PanelFrameBody className={styles.body}>
        <ResearchReadbackContent
          status={readback.status}
          projection={readback.projection}
          question={question}
          requestIdentity={requestIdentity}
          allowFormation
        />
      </PanelFrameBody>
    </PanelFrame>
  );
}
