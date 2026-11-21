import type { ReactNode } from "react";
import { MISSING, pct, plural } from "../../lib/format";
import type { HistoryLine } from "../../lib/historyApi";
import { priorGroups, priorTrials } from "../../model/history";
import { Tip } from "../../components/Tip";

/** What a line's `holdout_prior_trials` says in words: the holdout's earlier searches in this ledger, which the holdout
 *  verdict and the deflated Sharpe are to be read with. The deflated Sharpe counts only this line's participants. */
const priorWords = (line: HistoryLine) => {
  const n = priorTrials(line);
  return n == null ? "unknown" : n === 0 ? "none in this ledger" : plural(n, "earlier trial");
};
export function PriorTip({ line, lead }: { line: HistoryLine; lead?: string }) {
  const n = priorTrials(line), groups = priorGroups(line), p = line.holdout_prior_trials;
  return (
    <div className="space-y-0.5">
      {lead && <p>{lead}</p>}
      <p className="font-semibold">Earlier searches of this holdout</p>
      {n == null ? <p>Not read: the history test gave no count for this line</p>
        : <p>{n === 0 ? "No counted trial in this ledger overlapped the holdout" : `${plural(n, "counted trial")} on the line's instruments overlapped the holdout`}
            {p && p.instruments.length > 0 && ` (${p.instruments.join(", ")})`}; its own history trials are left out</p>}
      {groups.map((g) => <p key={g}>{g}</p>)}
      <p>Searches outside this ledger are not counted, so none here does not mean the holdout is unseen. The deflated Sharpe counts only this line's participants, not these searches.</p>
    </div>
  );
}

/** The participants a line's test leaves out for want of economic evidence now, with the reasons. */
function LeftOut({ left }: { left: NonNullable<HistoryLine["without_economic_evidence"]> }) {
  return (
    <div className="space-y-0.5">
      <p className="font-semibold">Left out: no economic evidence</p>
      <p>A participant whose latest research run has none now (a failed source review, no real activity) is not replayed or judged here: no row, no reading.</p>
      {left.map((l) => <p key={l.run}>{l.candidate ?? l.source_sha256.slice(0, 12)}: {l.reasons.join("; ") || MISSING}</p>)}
    </div>
  );
}

/** One fact of a line's header: its label small above its value, in a minimum width so short facts line up across
 *  lines while a long line name pushes the next column rather than drawing into it. */
function Field({ label, width, tip, children }: { label: string; width: string; tip?: ReactNode; children: ReactNode }) {
  const body = <div className={`${width} whitespace-nowrap`}><div className="text-small text-fg-faint">{label}</div><div className="text-dense">{children}</div></div>;
  return tip ? <Tip content={tip}>{body}</Tip> : body;
}

/** A line's header strip: its facts in the same columns for every line (label small above, value below), wrapping in two
 *  columns on a phone. The cell spans the whole table, so the strip is held to the visible width and sticks to the left:
 *  it wraps in view and stays there when the table scrolls sideways. */
export function LineHeader({ line, colSpan, hidden }: { line: HistoryLine; colSpan: number; hidden: { edge: number; cause: number } }) {
  const t = line.targets, left = line.without_economic_evidence ?? [];
  return (
    <tr className="bg-island-alt">
      <th colSpan={colSpan} className="sticky left-0 px-0 py-1.5 text-left font-normal">
        <div className="sticky left-0 flex max-w-[calc(100vw-6rem)] flex-wrap gap-x-6 gap-y-1.5 px-2">
          <Field label={line.closed ? "Closed" : "Closing"} width="w-full md:w-auto md:min-w-44"><span className="font-mono font-semibold">{line.line}</span></Field>
          <Field label="Participants" width="w-[calc(50%-0.75rem)] md:w-24">{line.participants}</Field>
          <Field label="Research trials" width="w-[calc(50%-0.75rem)] md:w-24">{line.research_trials}</Field>
          <Field label="Holdout searches" width="w-[calc(50%-0.75rem)] md:w-40" tip={<PriorTip line={line} />}>
            <span className={priorTrials(line) ? "text-fg" : "text-fg-muted"}>{priorWords(line)}</span></Field>
          <Field label="Sources left out" width="w-[calc(50%-0.75rem)] md:w-28" tip={left.length ? <LeftOut left={left} /> : undefined}>
            {line.without_economic_evidence === undefined ? MISSING : left.length ? plural(left.length, "source") : <span className="text-fg-muted">none</span>}</Field>
          <Field label="Target drawdown" width="w-[calc(50%-0.75rem)] md:w-28">{t ? `≤ ${pct(t.max_drawdown)}` : MISSING}</Field>
          <Field label="Target return" width="w-[calc(50%-0.75rem)] md:w-28">{t ? `≥ ${pct(t.annual_return)}` : MISSING}</Field>
          <Field label="Development" width="w-full md:w-52">{line.dev_start} to {line.dev_end}</Field>
          {hidden.edge + hidden.cause > 0 && <Field label="Hidden" width="w-full md:w-28">
            {[hidden.edge && `${hidden.edge} with no edge`, hidden.cause && `${hidden.cause} by cause`].filter(Boolean).join(" · ")}</Field>}
        </div>
      </th>
    </tr>
  );
}
