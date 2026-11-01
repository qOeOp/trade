import type { Candidate, DetailWidget, Targets } from "../../model/types";
import { when, plural } from "../../lib/format";
import { useView } from "../../model/view";
import { Icon } from "../../icons/Icon";
import { useSelection } from "../../state/selection";
import { useOnRunsPage } from "../../state/shell";
import { useShown } from "../../state/shown";
import { KeyValues } from "../../components/KeyValues";
import { Missing } from "../../components/Missing";
import { Prose } from "../../components/Prose";
import { CardGroup, Section } from "../../components/Section";
import { Tip } from "../../components/Tip";
import { Token } from "../../components/Token";
import { Header } from "./Header";
import { Readings } from "./Readings";
import { ReplayTable } from "./ReplayTable";
import { StagePerformance } from "./StagePerformance";
import { TranslatedCardGroup } from "../../components/TranslatedCardGroup";

const OUTCOME: Record<string, [string, string]> = {
  held: ["Held", "text-meets"], failed: ["Failed", "text-misses"], untestable: ["Untestable", "text-fg-faint"],
};
const VERDICT: Record<string, [string, string]> = { passed: ["Passed", "text-meets"], failed: ["Failed", "text-fail"] };
const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

// Where the inspector is widened past 48rem, the groups sit in two columns: what changed and the
// conclusion on the left, the performance and evidence on the right; narrower, one column in order.
// Columns never grow past the region for their content.
const SIDE = "@3xl:pt-0";

/** One version's detail, as the inspector shows the selected one. */
function VersionDetail({ c, targets }: { c: Candidate; targets: Targets | null }) {
  const runs = (c.trials ?? []).filter((t) => t.purpose === "research");
  const cmp = c.comparison;
  return (
    <div className="@container space-y-3 px-2 pb-3 text-dense">
      <Header c={c}><Readings c={c} targets={targets} /></Header>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-5 @3xl:grid-cols-[repeat(2,minmax(0,1fr))]">
      <TranslatedCardGroup title="Change and hypothesis" sections={[
        { title: "What changed", text: c.change }, { title: "Hypothesis", text: c.hypothesis },
      ]} className={SIDE}>
      {!!c.predictions?.length && (
        <Section title="Predictions" aside={`${c.predictions.length}`}>
          <table className="w-full"><tbody>
            {c.predictions.map((p, i) => {
              const [label, cls] = OUTCOME[p.outcome ?? ""] ?? ["Not judged", "text-fg-faint"];
              return (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2 font-mono">{p.measure ?? <Missing />}</td>
                  <td className="py-1 pr-2 text-fg-muted">
                    {p.direction === "up" ? <span className="inline-flex items-center gap-1"><Icon name="arrow-up" size={12} />Up</span>
                      : p.direction === "down" ? <span className="inline-flex items-center gap-1"><Icon name="arrow-down" size={12} />Down</span>
                      : p.direction ?? <Missing />}
                  </td>
                  <td className={`py-1 text-right ${cls}`}>{label}</td>
                </tr>
              );
            })}
          </tbody></table>
        </Section>
      )}
      </TranslatedCardGroup>
      <div className={`${SIDE} @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1`}>
      <StagePerformance />
      <CardGroup title="Evidence">
      <Section title="Replays" aside={`${plural(runs.length, "research run")} · ${plural((c.trials ?? []).length, "trial")} in all`}>
        <ReplayTable trials={c.trials ?? []} targets={targets} />
      </Section>
      <Section title="Versus control">
        {cmp ? (
          <KeyValues items={[
            ["Control", cmp.vs_trial != null ? <span>trial {cmp.vs_trial}</span> : null],
            ["Mean daily log diff.", cmp.mean_daily_log_difference != null ? <span>{cmp.mean_daily_log_difference.toPrecision(3)}</span> : null],
            ["Detectable annual diff.", <Tip content="The annual return difference over the control this sample detects with 80% power: a power reading, not a threshold"><span>{cmp.detectable?.toLocaleString("en-US", percent) ?? "-"}</span></Tip>],
            ["Difference interval", cmp.interval_crosses_zero == null ? null : cmp.interval_crosses_zero
              ? <span className="text-misses">Crosses zero</span> : <span className="text-meets">Excludes zero</span>],
          ]} />
        ) : <p className="text-fg-faint">No control to compare against</p>}
      </Section>
      {!!c.reviews?.length && (
        <Section title="Source reviews" aside={`${c.reviews.length}`}>
          <div className="space-y-1.5">
            {c.reviews.map((r, i) => {
              const [label, cls] = VERDICT[r.verdict ?? ""] ?? ["-", "text-fg-faint"];
              return (
                <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-x-2">
                  <span className={cls}>{label}</span>
                  <div className="min-w-0 space-y-1"><div className="text-fg-faint">{when(r.at)}
                    {!!r.failed_items?.length && <span className="ml-2">Failed items {r.failed_items.join(", ")}</span>}
                    </div>
                    {r.note && <div className="text-fg-muted"><Prose text={r.note} /></div>}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
      </CardGroup>
      </div>
      <TranslatedCardGroup title="Conclusion" sections={[{ title: "Interpretation and decision", text: c.interpretation }]} className="@3xl:col-start-1">
      <Section title="Registration" open={false}>
        <KeyValues items={[
          ["Registration", c.registration ? <Token value={c.registration} /> : null],
          ["Duties", (c.duties ?? []).join(" ") || null],
        ]} />
      </Section>
      </TranslatedCardGroup>
      </div>
    </div>
  );
}

/** The selected version in full: what changed, why, what was predicted and found, how the stage the
 *  Runs page shows performed, and its records. On the Runs page a paper run that declares no version of
 *  this line has none to show. */
export function Detail({ widget }: { widget: DetailWidget }) {
  const selected = useSelection();
  const { targets } = useView();
  const runsPage = useOnRunsPage(), { run } = useShown();
  const loose = runsPage && run !== null && selected === null;
  const c = loose ? undefined : widget.items.find((item) => item.id === (selected ?? widget.default));
  if (c) return <VersionDetail c={c} targets={targets} />;
  return <p className="p-4 text-fg-faint">{loose ? "No version of this line declared for this run" : "Pick a version in the lineage, the table or the scatter."}</p>;
}
