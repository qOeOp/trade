import type { ResearchQuestionItemV1 } from "../lib/research-question-directory";
import { SummaryItem, SummaryList } from "./ui/summary-list";

export function ResearchQuestionBrief({ item }: { item: ResearchQuestionItemV1 }) {
  if (item.availability !== "available" || !item.question) return null;
  return (
    <SummaryList aria-label="Research question">
      <SummaryItem eyebrow="Research question" title={item.question.hypothesis} />
      <SummaryItem eyebrow="Falsifier" title={item.question.falsificationQuestion} />
      <SummaryItem eyebrow="Expected observation" title={item.question.expectedObservation} />
    </SummaryList>
  );
}
