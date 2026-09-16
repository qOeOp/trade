"use client";

import Link from "next/link";

import type { ResearchQuestionDirectoryV1 } from "../lib/research-question-directory";
import { researchQuestionForReadbackV1 } from "../lib/research-question-directory";
import { ResearchReadbackContent } from "./research-readback-content";
import { Button } from "./ui/button";
import { InterfaceIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import { useResearchReadback } from "./use-research-readback";

export function ResearchReadbackDrilldown({
  requestIdentity,
  questions,
  onBack,
}: {
  requestIdentity: string;
  questions: ResearchQuestionDirectoryV1 | null;
  onBack?: () => void;
}) {
  const readback = useResearchReadback(requestIdentity);
  const question = researchQuestionForReadbackV1(questions, readback.projection);

  return (
    <PageStack gap="compact">
      {onBack ? <div>
        <Button autoFocus type="button" variant="ghost" size="tool" onClick={onBack} data-research-readback-back>
          <InterfaceIcons.previous aria-hidden="true" /> Back to request summary
        </Button>
      </div> : null}
      <ResearchReadbackContent
        status={readback.status}
        projection={readback.projection}
        question={question}
        requestIdentity={requestIdentity}
      />
      {readback.status === "available" && readback.projection ? (
        <div>
          <Button asChild variant="outline" size="tool">
            <Link href={`/rd/research/${encodeURIComponent(requestIdentity)}`} data-research-full-workspace>
              Open full research workspace <InterfaceIcons.next aria-hidden="true" />
            </Link>
          </Button>
        </div>
      ) : null}
    </PageStack>
  );
}
