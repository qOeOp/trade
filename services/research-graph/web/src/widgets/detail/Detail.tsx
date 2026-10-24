import type { Candidate, DetailWidget, Targets, Trial } from "../../model/types";
import { meets } from "../../model/semantics";
import { when } from "../../lib/format";
import { useView } from "../../model/view";
import { Icon } from "../../icons/Icon";
import { useSelection } from "../../state/selection";
import { KeyValues } from "../../components/KeyValues";
import { MetricStrip } from "../../components/MetricStrip";
import { Missing } from "../../components/Missing";
import { Prose } from "../../components/Prose";
import { CardGroup, Section } from "../../components/Section";
import { Tip } from "../../components/Tip";
import { Token } from "../../components/Token";
import { Header } from "./Header";
import { ReplayTable } from "./ReplayTable";

const OUTCOME: Record<string, [string, string]> = {
  held: ["成立", "text-meets"], failed: ["失败", "text-misses"], untestable: ["无法检验", "text-fg-faint"],
};
const VERDICT: Record<string, [string, string]> = { passed: ["通过", "text-meets"], failed: ["失败", "text-fail"] };
const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

// Where the region is wide (an editor tab), the groups sit in two columns: what changed and the
// conclusion on the left, the evidence on the right; narrower (the inspector), one column in order.
// Columns never grow past the region for their content.
const SIDE = "@3xl:pt-0";

/** One version's detail; the inspector shows the selected one, an editor tab a chosen one. */
export function VersionDetail({ c, targets }: { c: Candidate; targets: Targets | null }) {
  const runs = (c.trials ?? []).filter((t) => t.purpose === "research");
  const last: Partial<Trial> = runs.at(-1) ?? {};
  const cmp = c.comparison;
  return (
    <div className="@container space-y-3 px-2 pb-3 text-dense">
      <Header c={c}>
      <MetricStrip items={[
        { label: "年化", value: last.annual_return, format: percent, tone: meets(last.annual_return, targets?.annual_return, true) === false ? "misses" : "fg" },
        { label: "最大回撤", value: last.max_drawdown, format: percent, tone: meets(last.max_drawdown, targets?.max_drawdown, false) === false ? "misses" : "fg" },
        { label: "夏普", value: last.sharpe, format: two },
        { label: "胜率", value: last.win_rate, format: percent },
      ]} />
      </Header>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-5 @3xl:grid-cols-[repeat(2,minmax(0,1fr))]">
      <CardGroup title="改动与预期" className={SIDE}>
      <Section title="改了什么"><Prose text={c.change} /></Section>
      <Section title="假设"><Prose text={c.hypothesis} /></Section>
      {!!c.predictions?.length && (
        <Section title="预测" aside={`${c.predictions.length} 条`}>
          <table className="w-full"><tbody>
            {c.predictions.map((p, i) => {
              const [label, cls] = OUTCOME[p.outcome ?? ""] ?? ["未判定", "text-fg-faint"];
              return (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2 font-mono">{p.measure ?? <Missing />}</td>
                  <td className="py-1 pr-2 text-fg-muted">
                    {p.direction === "up" ? <span className="inline-flex items-center gap-1"><Icon name="arrow-up" size={12} />上升</span>
                      : p.direction === "down" ? <span className="inline-flex items-center gap-1"><Icon name="arrow-down" size={12} />下降</span>
                      : p.direction ?? <Missing />}
                  </td>
                  <td className={`py-1 text-right ${cls}`}>{label}</td>
                </tr>
              );
            })}
          </tbody></table>
        </Section>
      )}
      </CardGroup>
      <CardGroup title="证据" className={`${SIDE} @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1`}>
      <Section title="回放" aside={`${runs.length} 次研究运行 · 共 ${(c.trials ?? []).length} 次试验`}>
        <ReplayTable trials={c.trials ?? []} targets={targets} />
      </Section>
      <Section title="与对照比较">
        {cmp ? (
          <KeyValues items={[
            ["对照", cmp.vs_trial != null ? <span>trial {cmp.vs_trial}</span> : null],
            ["日均对数差", cmp.mean_daily_log_difference != null ? <span>{cmp.mean_daily_log_difference.toPrecision(3)}</span> : null],
            ["可检出差", <Tip content="按现有样本，80% 把握能检出的最小日均对数差"><span>{cmp.detectable?.toPrecision(3) ?? "-"}</span></Tip>],
            ["差值区间", cmp.interval_crosses_zero == null ? null : cmp.interval_crosses_zero
              ? <span className="text-misses">跨零：不能说明好于对照</span> : <span className="text-meets">不跨零</span>],
          ]} />
        ) : <p className="text-fg-faint">没有可比较的对照</p>}
      </Section>
      {!!c.reviews?.length && (
        <Section title="源码审阅" aside={`${c.reviews.length} 次`}>
          <div className="space-y-1.5">
            {c.reviews.map((r, i) => {
              const [label, cls] = VERDICT[r.verdict ?? ""] ?? ["-", "text-fg-faint"];
              return (
                <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-x-2">
                  <span className={cls}>{label}</span>
                  <span className="min-w-0"><span className="text-fg-faint">{when(r.at)}</span>
                    {!!r.failed_items?.length && <span className="ml-2">失败项 {r.failed_items.join("、")}</span>}
                    {r.note && <span className="block text-fg-muted">{r.note}</span>}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
      </CardGroup>
      <CardGroup title="结论" className="@3xl:col-start-1">
      <Section title="解释与决策"><Prose text={c.interpretation} /></Section>
      <Section title="登记" open={false}>
        <KeyValues items={[
          ["登记", c.registration ? <Token value={c.registration} /> : null],
          ["职责", (c.duties ?? []).join(" ") || null],
        ]} />
      </Section>
      </CardGroup>
      </div>
    </div>
  );
}

/** The selected version in full: what changed, why, what was predicted and found, and its records. */
export function Detail({ widget }: { widget: DetailWidget }) {
  const selected = useSelection();
  const { targets } = useView();
  const c = widget.items.find((item) => item.id === (selected ?? widget.default));
  return c ? <VersionDetail c={c} targets={targets} /> : <p className="p-4 text-fg-faint">在谱系、表格或散点图里点一个版本。</p>;
}
