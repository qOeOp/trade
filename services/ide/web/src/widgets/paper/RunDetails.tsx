import type { ReactNode } from "react";
import { pct, shortSha } from "../../lib/format";
import { utc } from "../../model/paper";
import { KeyValues } from "../../components/KeyValues";
import { health } from "../../components/RunCard";
import { Section } from "../../components/Section";
import { useAtom } from "../../state/atom";
import { selectedRun, usePaperRuns } from "../../state/paper";
import { useStream } from "../../state/paperStream";
import { useNow } from "./RunStrip";

const mono = (value: ReactNode) => <span className="break-all font-mono">{value}</span>;

/** The selected paper run's record: how it was configured (what the ledger declared at its start), its
 *  health now, and once sealed, its outcome and reasons. */
export function RunDetails() {
  const listing = usePaperRuns();
  const id = useAtom(selectedRun);
  const s = useStream();
  const now = useNow();
  const run = listing?.runs.find((r) => r.paper_id === id);
  if (!run) return <p className="p-3 text-dense text-fg-faint">Open a paper run in the Paper panel</p>;
  const config = run.config as { execution?: string; fees?: { maker: string; taker: string }; universe_rule?: string; memory?: string; duration_seconds?: number | null };
  const live = s?.paperId === run.paper_id ? s.readings ?? run.live : run.live;
  const seal = run.seal;
  const digest = run.image_ref.split("@")[1] ?? run.image_ref;
  const started = seal?.started_ns ?? live?.started_ns ?? null;
  const state = health(run, now);
  return (
    <div className="space-y-2 p-2 text-dense">
      <Section title="Run" aside={`run ${run.paper_id}`}>
        <KeyValues items={[
          ["Version", mono(run.candidate)],
          ["State", <span className={state.tone === "fail" ? "text-fail" : state.tone === "misses" ? "text-misses" : ""}>{state.text}</span>],
          ["Started", started ? `${utc(started / 1e6)} UTC` : null],
          ["Contracts", run.symbols.length > 8 ? `${run.symbols.length} contracts` : run.symbols.join(", ")],
          ["Execution", config.execution === "paper-bars" ? "One-minute bars, Sandbox fills" : config.execution],
          ["Fees", config.fees ? `maker ${config.fees.maker} · taker ${config.fees.taker}` : null],
          ["Universe rule", config.universe_rule],
          ["Memory", config.memory],
        ]} />
      </Section>
      <Section title="Identity">
        <KeyValues items={[
          ["Image", mono(shortSha(digest.replace("sha256:", "")))],
          ["Source", mono(shortSha(run.source_sha256))],
          ["Market commit", mono(shortSha(run.market_commit))],
        ]} />
      </Section>
      <Section title="Health">
        <KeyValues items={[
          ["Bars", live?.bars],
          ["Missing bars", live?.missing_bars],
          ["Late bars", live?.late_bars],
          ["Protection gaps", live?.protection_gaps],
          ["Funding", live?.funding_usdt ? `${Number(live.funding_usdt).toFixed(2)} USDT` : null],
        ]} />
      </Section>
      {seal && (
        <Section title="Seal" aside={seal.status}>
          <KeyValues items={[
            ["Return", pct(seal.total_return)], ["Max drawdown", pct(seal.max_drawdown)], ["Stopped by", seal.stop_reason],
            ["Reasons", seal.reasons.length ? <span className="text-fail">{seal.reasons.join(", ")}</span> : "none"],
          ]} />
        </Section>
      )}
      <Section title="Replay reconciliation" open={false}>
        <p className="text-fg-muted">Once the run's days reach the market from Binance's archives, a replay of the same
          source over the same window is compared fill by fill. Not available yet.</p>
      </Section>
    </div>
  );
}
