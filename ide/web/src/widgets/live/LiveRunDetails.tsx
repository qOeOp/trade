import { LiveEvidenceList, LiveFacts } from "../../components/LiveFacts";
import { LiveRecovery } from "../../components/LiveRecovery";
import { LiveReview } from "../../components/LiveReview";
import { Section } from "../../components/Section";
import { useLiveRunView } from "../../state/liveRun";

/** The same selected Live run as the canvas and Trades, including without a research view. */
export function LiveRunDetails() {
  const { run, actions } = useLiveRunView();
  if (!run) return <p className="p-4 text-dense text-fg-faint">Select a live run to inspect its recorded observations.</p>;
  const active = !run.ended;
  const known = <T extends { label: string; value: string | null }>(rows: readonly T[], hideNull: readonly string[]) =>
    active ? rows.filter((f) => f.value !== null || !hideNull.includes(f.label)) : rows;
  const account = known(run.account, ["Recorded venue-flat check"]);
  const status = known([...run.host, ...run.continuity ?? []], ["Exit code", "Trading for", "Latest warm-up", "Last reconnect", "Replay"]);
  const ending = known(run.ending, ["Release reason", "Archived"]);
  const showCompletion = run.ended || run.execution.some((f) => f.value !== null);
  return <div className="space-y-3 px-3 pb-4 text-dense">
    <div className="pt-3"><h2 className="break-words font-semibold">{run.candidate}</h2><p className="mt-1 text-small text-fg-faint">{run.symbols?.join(", ")}</p></div>
    <LiveFacts title="Account observation" facts={account} />
    <LiveFacts title="Run status" facts={status} />
    {showCompletion && <LiveFacts title="Native completion" facts={run.execution} />}
    <LiveFacts title="Stopping and custody" facts={ending} />
    <LiveFacts title="Frozen plan" facts={run.config} />
    <Section title="Source and evidence" open={false}>
      <LiveFacts title="Run identity" facts={[{ label: "Run", value: run.id }, { label: "Actual source", value: run.sourceHash }, { label: "Entry class", value: run.entryClass }, { label: "Runtime", value: run.runtimeDigest }]} />
      <LiveReview run={run} inspect={actions.inspect} />
      <LiveEvidenceList evidence={run.evidence} />
    </Section>
    <Section title="Recovery" open={run.hostState === "unresolved"}><LiveRecovery runId={run.id} actions={actions} /></Section>
  </div>;
}
