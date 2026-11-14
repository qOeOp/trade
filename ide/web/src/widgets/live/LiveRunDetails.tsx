import { LiveEvidenceList, LiveFacts } from "../../components/LiveFacts";
import { LiveRecovery } from "../../components/LiveRecovery";
import { LiveReview } from "../../components/LiveReview";
import { Section } from "../../components/Section";
import { livePurposeLabel } from "../../model/liveTrading";
import { useLiveRunView } from "../../state/liveRun";

/** The same selected Live run as the canvas and Trades, including without a research view. */
export function LiveRunDetails() {
  const { run, actions } = useLiveRunView();
  if (!run) return <p className="p-4 text-dense text-fg-faint">Select a live run to inspect its recorded observations.</p>;
  return <div className="space-y-3 px-3 pb-4 text-dense">
    <div className="pt-3"><h2 className="break-words font-semibold">{run.candidate}</h2><p className="mt-1 text-small text-fg-faint">{livePurposeLabel(run.purpose)}</p></div>
    <LiveFacts title="Account observation" facts={run.account} />
    <LiveFacts title="Run status" facts={[...run.host, ...run.continuity ?? []]} />
    <LiveFacts title="Native completion" facts={run.execution} />
    <LiveFacts title="Stopping and custody" facts={run.ending} />
    <LiveFacts title="Frozen plan" facts={run.config} />
    <Section title="Source and evidence" open={false}>
      <LiveFacts title="Run identity" facts={[{ label: "Run", value: run.id }, { label: "Actual source", value: run.sourceHash }, { label: "Entry class", value: run.entryClass }, { label: "Runtime", value: run.runtimeDigest }]} />
      <LiveReview run={run} inspect={actions.inspect} />
      <LiveEvidenceList evidence={run.evidence} />
    </Section>
    <Section title="Recovery" open={false}><LiveRecovery runId={run.id} actions={actions} /></Section>
  </div>;
}
