import { useRunData } from "../../state/runData";
import { useShown } from "../../state/shown";
import { CardGroup, Section } from "../../components/Section";
import { Calendar } from "../paper/Calendar";
import { PnlFlow } from "../paper/Flow";
import { Performance } from "../paper/Performance";

/** The Performance group of the selected version's detail, on either page: the stage the Runs page shows
 *  (state/shown.ts), named at the right. For a paper run, its trades and what they say, its calendar and
 *  what moved its equity (folded at first). None while the stage has nothing to show here. */
export function StagePerformance({ className }: { className?: string }) {
  const { stage, run, name } = useShown(), data = useRunData();
  const shown = stage === "paper" && data && data.run.paper_id === run?.paper_id ? data : null;
  if (!shown?.a || !shown.stats) return null;
  return (
    <CardGroup title="Performance" actions={<span className="min-w-0 truncate text-fg-faint">{name}</span>} className={className}>
      <Performance a={shown.a} stats={shown.stats} />
      <Calendar s={shown.s} a={shown.a} />
      {shown.flows && <Section title="Profit and loss" open={false}><PnlFlow a={shown.a} f={shown.flows} /></Section>}
    </CardGroup>
  );
}
