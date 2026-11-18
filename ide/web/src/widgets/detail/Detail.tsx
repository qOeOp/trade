import { useTimeZone } from "../../state/timeZone";
import type { Candidate, DetailWidget, Targets } from "../../model/types";
import { when, plural } from "../../lib/format";
import { useView } from "../../model/view";
import { Icon } from "../../icons/Icon";
import { useAtom } from "../../state/atom";
import { useSelection } from "../../state/selection";
import { useComparison } from "../../state/comparison";
import { useOnMarketPage, useOnRunsPage } from "../../state/shell";
import { useShown } from "../../state/shown";
import { viewStatus } from "../../state/update";
import { KeyValues } from "../../components/KeyValues";
import { Missing, Skeleton, SkeletonLines } from "../../components/Missing";
import { Prose } from "../../components/Prose";
import { CardGroup, Section } from "../../components/Section";
import { Tip } from "../../components/Tip";
import { Token } from "../../components/Token";
import { Header } from "./Header";
import { Readings } from "./Readings";
import { ReplayTable } from "./ReplayTable";
import { measureLabel } from "../../model/measures";
import { StagePerformance, useStageReading } from "./StagePerformance";
import { TranslatedCardGroup } from "../../components/TranslatedCardGroup";
import { MarketDetails } from "../market/MarketDetails";
import { LiveRunDetails } from "../live/LiveRunDetails";

const OUTCOME: Record<string, [string, string]> = {
  held: ["Held", "text-meets-fg"], failed: ["Failed", "text-misses-fg"], untestable: ["Untestable", "text-fg-faint"],
};
const VERDICT: Record<string, [string, string]> = { passed: ["Passed", "text-meets-fg"], failed: ["Failed", "text-fail-fg"] };
/** A review check's status; any other (no opportunity, unresolved) reads faint, as written. */
const CHECK: Record<string, [string, string]> = { passed: ["passed", "text-meets-fg"], failed: ["failed", "text-fail-fg"] };
const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
/** A mean daily log difference as the daily percent it compounds to, signed: +0.012%. */
const daily = (log: number) => Math.expm1(log).toLocaleString("en-US", { style: "percent", minimumFractionDigits: 3, maximumFractionDigits: 3, signDisplay: "exceptZero" }).replace("-", "\u2212");

// Where the inspector is widened past 48rem, the groups sit in two columns: what changed and the
// conclusion on the left, the performance and evidence on the right; narrower, one column in order.
// Columns never grow past the region for their content.
const SIDE = "@3xl:pt-0";

const PLACEHOLDER: Candidate = { id: "", status: null, prediction_class: "none" };

/** One version's detail, as the inspector shows the selected one. */
function VersionDetail({ c, targets, loading = false }: { c: Candidate; targets: Targets | null; loading?: boolean }) {
  const zone = useTimeZone(), stageReading = useStageReading();
  const busy = loading || stageReading;
  const runs = (c.trials ?? []).filter((t) => t.purpose === "research");
  const compared = useComparison(c);
  const cmp = !busy && compared.kind === "ready" ? compared.comparison : null;
  const comparing = busy || compared.kind === "reading";
  return (
    <div className="@container space-y-3 px-2 pb-3 text-dense">
      <Header c={c} loading={loading}><Readings c={c} targets={targets} loading={loading} /></Header>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-4 @3xl:grid-cols-[repeat(2,minmax(0,1fr))]">
      <TranslatedCardGroup title="Change and hypothesis" loading={busy} sections={[
        { title: "What changed", text: c.change }, { title: "Hypothesis", text: c.hypothesis },
      ]} className={SIDE}>
      {!!c.predictions?.length && (
        <Section title="Predictions" aside={busy ? <Skeleton className="w-4" /> : `${c.predictions.length}`}>
          <table className="w-full"><tbody>
            {c.predictions.map((p, i) => {
              const [label, cls] = OUTCOME[p.outcome ?? ""] ?? ["Not judged", "text-fg-faint"];
              const named = p.measure ? measureLabel(p.measure) : null;
              return (
                <tr key={i} className="border-b border-line align-top last:border-0">
                  <td className="py-1 pr-2">{named
                    ? <Tip content={<span className="font-mono">{p.measure}</span>}><span>{named.measure}{named.slice && <span className="text-fg-faint"> · {named.slice}</span>}</span></Tip>
                    : <Missing />}
                    {!busy && p.reason && <span title={p.reason} className="line-clamp-2 text-small text-fg-faint">{p.reason}</span>}</td>
                  <td className="py-1 pr-2 text-fg-muted">
                    {busy ? <Skeleton className="w-8" />
                      : p.direction === "up" ? <span className="inline-flex items-center gap-1"><Icon name="arrow-up" size={12} />Up</span>
                      : p.direction === "down" ? <span className="inline-flex items-center gap-1"><Icon name="arrow-down" size={12} />Down</span>
                      : p.direction ?? <Missing />}
                  </td>
                  <td className={`whitespace-nowrap py-1 text-right ${cls}`}>{busy ? <Skeleton className="w-10" /> : label}</td>
                </tr>
              );
            })}
          </tbody></table>
        </Section>
      )}
      </TranslatedCardGroup>
      <TranslatedCardGroup title="Conclusion" loading={busy} sections={[{ title: "Interpretation and decision", text: c.interpretation }]} className="@3xl:col-start-1">
      <Section title="Registration" open={false}>
        <KeyValues items={[
          ["Registration", busy ? <Skeleton className="w-20" /> : c.registration ? <Token value={c.registration} /> : null],
          ["Duties", busy ? <Skeleton className="w-28" /> : (c.duties ?? []).join(" ") || null],
        ]} />
      </Section>
      </TranslatedCardGroup>
      <div className={`${SIDE} @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1`}>
      <StagePerformance />
      <CardGroup title="Evidence">
      <Section title="Replays" aside={busy ? <Skeleton className="w-24" /> : `${plural(runs.length, "research run")} · ${plural((c.trials ?? []).length, "trial")} in all`}>
        <ReplayTable trials={c.trials ?? []} targets={targets} busy={busy} />
      </Section>
      <Section title="Versus control">
        {cmp || comparing ? (
          <KeyValues items={[
            ["Control", cmp ? (cmp.vs_trial != null ? <span>trial {cmp.vs_trial}</span> : null) : <Skeleton />],
            ["Mean daily difference", cmp ? (cmp.mean_daily_log_difference != null
              ? <Tip content="The mean of the daily log return differences over the control, as a daily percent"><span>{daily(cmp.mean_daily_log_difference)}</span></Tip> : null) : <Skeleton />],
            ["Detectable annual difference", cmp ? <Tip content="The annual return difference over the control this sample detects with 80% power: a power reading, not a threshold"><span>{cmp.detectable?.toLocaleString("en-US", percent) ?? <Missing />}</span></Tip> : <Skeleton />],
            ["Difference intervals", cmp ? (cmp.intervals_cross_zero == null ? null : <Tip content="The basic and studentized intervals of the mean daily log difference, the annual return difference interval and the maximum drawdown difference interval: candidate and control are told apart when any of them excludes zero"><span>{cmp.intervals_cross_zero ? "All cross zero" : "Some exclude zero"}</span></Tip>) : <Skeleton />],
          ]} />
        ) : <p className="text-fg-faint">{compared.kind === "failed" ? `The comparison could not be computed. ${compared.message}`
          : "No control to compare against"}</p>}
      </Section>
      {!!c.reviews?.length && (
        <Section title="Source reviews" open={c.reviews.some((r) => r.verdict !== "passed")}
                 aside={busy ? <Skeleton className="w-4" /> : `${c.reviews.every((r) => r.verdict === "passed") ? "Passed · " : ""}${c.reviews.length}`}>
          <div className="space-y-1.5">
            {c.reviews.map((r, i) => {
              const [label, cls] = VERDICT[r.verdict ?? ""] ?? ["-", "text-fg-faint"];
              return (
                <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-x-2">
                  <span className={cls}>{busy ? <Skeleton className="w-12" /> : label}</span>
                  <div className="min-w-0 space-y-2"><div className="text-fg-faint">{busy ? <Skeleton className="w-24" /> : when(r.at, zone)}</div>
                    {busy ? <SkeletonLines /> : (r.checks ?? []).map((ch) => {
                      const [status, tone] = CHECK[ch.status ?? ""] ?? [(ch.status ?? "-").replaceAll("_", " "), "text-fg-faint"];
                      return (
                        <div key={ch.name} className="space-y-0.5">
                          <div><span className="text-fg">{ch.name === "api" ? "API" : ch.name[0]!.toUpperCase() + ch.name.slice(1)}</span>
                            <span className={`ml-2 ${tone}`}>{status}</span></div>
                          {ch.note && <div className="text-fg-muted"><Prose text={ch.note} /></div>}
                        </div>
                      );
                    })}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
      </CardGroup>
      </div>
      </div>
    </div>
  );
}

/** The selected version in full: what changed, why, what was predicted and found, how the stage the
 *  Runs page shows performed, and its records. On the Runs page a paper run that declares no version of
 *  this line has none to show; the Market page has its own details. */
export function Detail({ widget }: { widget: DetailWidget }) {
  const market = useOnMarketPage(), runs = useOnRunsPage(), { stage } = useShown();
  return market ? <MarketDetails /> : runs && stage === "live" ? <LiveRunDetails /> : <SelectedDetail widget={widget} />;
}

function SelectedDetail({ widget }: { widget: DetailWidget }) {
  const selected = useSelection();
  const { line, targets } = useView(), status = useAtom(viewStatus), waiting = !line.name && status.busy;
  const runsPage = useOnRunsPage(), { run } = useShown();
  const loose = !waiting && runsPage && run !== null && selected === null;
  const c = loose ? undefined : widget.items.find((item) => item.id === (selected ?? widget.default));
  if (c) return <VersionDetail c={c} targets={targets} />;
  if (waiting) return <VersionDetail c={{ ...PLACEHOLDER, id: run?.candidate ?? selected ?? "" }} targets={targets} loading />;
  return <p className="p-4 text-fg-faint">{loose ? "No version of this line declared for this run" : "Pick a version in the lineage, the table or the scatter."}</p>;
}
