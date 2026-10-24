import NumberFlow from "@number-flow/react";
type Format = React.ComponentProps<typeof NumberFlow>["format"];
import type { Candidate, DetailWidget, Targets, Trial } from "../types";
import { meets, pct, PREDICTION, ratio, readingColor, ROLE, when } from "../format";
import { requestFocus } from "../store";
import { columns, DataTable, KeyValues, RoleMark, Section, Tip, type Column } from "../ui";

const OUTCOME: Record<string, [string, string]> = {
  held: ["✓ 成立", "var(--meet)"], failed: ["✗ 失败", "var(--miss)"], untestable: ["无法检验", "var(--ink-3)"],
};
const VERDICT: Record<string, [string, string]> = { passed: ["✓ 通过", "var(--meet)"], failed: ["✗ 失败", "var(--fail)"] };
const PURPOSE: Record<string, string> = { research: "研究", precheck: "预检", explore: "探索", validation: "验证" };
const col = columns<Trial>();

// One reading in the inspector's one-line strip: label and number share font, size and weight; only
// the number is highlighted (and marked when it misses its target).
function Metric({ label, value, ok, format }: { label: string; value?: number | null; ok: boolean | null; format: Format }) {
  return (
    <span className="whitespace-nowrap">
      <span className="faint">{label} </span>
      <span style={{ color: readingColor(ok) }}>{value == null ? "—" : <NumberFlow value={value} format={format} />}</span>
    </span>
  );
}

const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

function Inspector({ c, targets, onSelect }: { c: Candidate; targets: Targets | null; onSelect: (id: string) => void }) {
  const runs = (c.trials ?? []).filter((t) => t.purpose === "research");
  const last: Partial<Trial> = runs[runs.length - 1] ?? {};
  const cmp = c.comparison;
  const role = c.status ?? null;
  const trialColumns: Column<Trial>[] = [
    col.accessor("trial_id", { header: "trial", meta: { numeric: true } }) as Column<Trial>,
    col.accessor("purpose", { header: "用途", cell: (x) => PURPOSE[x.getValue() as string] ?? x.getValue() }) as Column<Trial>,
    col.accessor("annual_return", { header: "年化", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => <span style={{ color: readingColor(meets(x.getValue() as number, targets?.annual_return, true)) }}>{pct(x.getValue() as number)}</span> }) as Column<Trial>,
    col.accessor("max_drawdown", { header: "回撤", meta: { numeric: true }, sortUndefined: "last",
      cell: (x) => <span style={{ color: readingColor(meets(x.getValue() as number, targets?.max_drawdown, false)) }}>{pct(x.getValue() as number)}</span> }) as Column<Trial>,
    col.accessor("sharpe", { header: "夏普", meta: { numeric: true }, sortUndefined: "last", cell: (x) => ratio(x.getValue() as number) }) as Column<Trial>,
    col.accessor("eligible", { header: "资格", cell: (x) => {
      const t = x.row.original;
      if (t.eligible === false) return <Tip content={t.ineligible_reason ?? "失去资格"}><span style={{ color: "var(--fail)" }}>✗ 失去</span></Tip>;
      return t.eligible ? <span style={{ color: "var(--meet)" }}>✓</span> : <span className="ghost">—</span>;
    } }) as Column<Trial>,
  ];
  return (
    <div className="text-[12.5px]">
      <header className="sticky top-0 z-10 border-b px-3 pb-2 pt-2.5" style={{ borderColor: "var(--rule)", background: "var(--panel)" }}>
        <div className="flex items-center gap-2">
          <RoleMark role={role} size={16} />
          <h2 className="mono min-w-0 truncate text-[14px] font-semibold">{c.id}</h2>
          <button className="press ml-auto shrink-0 px-1.5 py-0.5 text-[11px] faint" onClick={() => requestFocus(c.id)}>在图中定位</button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] faint">
          <Tip content={role ? ROLE[role].hint : undefined}><span className="muted">{role ? ROLE[role].label : "—"}</span></Tip>
          <span style={{ color: PREDICTION[c.prediction_class].color }}>{PREDICTION[c.prediction_class].label}</span>
          <span className="mono">{when(c.created_at)}</span>
          {c.parent && (
            <button className="press mono px-1" onClick={() => { onSelect(c.parent!); requestFocus(c.parent!); }}>↑ {c.parent}</button>
          )}
        </div>
      </header>
      <div className="grid grid-cols-4 border-b px-3 py-1.5 text-center text-[12px]" style={{ borderColor: "var(--rule)" }}>
        <Metric label="年化" value={last.annual_return} ok={meets(last.annual_return, targets?.annual_return, true)} format={percent} />
        <Metric label="最大回撤" value={last.max_drawdown} ok={meets(last.max_drawdown, targets?.max_drawdown, false)} format={percent} />
        <Metric label="夏普" value={last.sharpe} ok={null} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />
        <Metric label="胜率" value={last.win_rate} ok={null} format={percent} />
      </div>
      <Section title="改了什么"><p className="leading-relaxed">{c.change ?? "—"}</p></Section>
      <Section title="假设"><p className="leading-relaxed">{c.hypothesis ?? "—"}</p></Section>
      {!!c.predictions?.length && (
        <Section title="预测" aside={`${c.predictions.length} 条`}>
          <table className="w-full text-[12px]"><tbody>
            {c.predictions.map((p, i) => {
              const [label, color] = OUTCOME[p.outcome ?? ""] ?? ["未判定", "var(--ink-3)"];
              return (
                <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--rule)" }}>
                  <td className="mono py-1 pr-2">{p.measure ?? "—"}</td>
                  <td className="py-1 pr-2 muted">{p.direction === "up" ? "↑ 上升" : p.direction === "down" ? "↓ 下降" : p.direction ?? "—"}</td>
                  <td className="py-1 text-right" style={{ color }}>{label}</td>
                </tr>
              );
            })}
          </tbody></table>
        </Section>
      )}
      <Section title="回放" aside={`${runs.length} 次研究运行 · 共 ${(c.trials ?? []).length} 次试验`}>
        <div className="-mx-2"><DataTable data={c.trials ?? []} columns={trialColumns} rowId={(t) => String(t.trial_id)} /></div>
      </Section>
      <Section title="与对照比较">
        {cmp ? (
          <KeyValues items={[
            ["对照", cmp.vs_trial != null ? <span className="mono">trial {cmp.vs_trial}</span> : "—"],
            ["日均对数差", <span className="mono">{cmp.mean_daily_log_difference?.toPrecision(3) ?? "—"}</span>],
            ["可检出差", <Tip content="按现有样本，80% 把握能检出的最小日均对数差"><span className="mono">{cmp.detectable?.toPrecision(3) ?? "—"}</span></Tip>],
            ["差值区间", cmp.interval_crosses_zero == null ? "—" : cmp.interval_crosses_zero
              ? <span style={{ color: "var(--miss)" }}>跨零：不能说明好于对照</span>
              : <span style={{ color: "var(--meet)" }}>不跨零</span>],
          ]} />
        ) : <p className="faint">没有可比较的对照</p>}
      </Section>
      {!!c.reviews?.length && (
        <Section title="源码审阅" aside={`${c.reviews.length} 次`}>
          <div className="space-y-1.5">
            {c.reviews.map((r, i) => {
              const [label, color] = VERDICT[r.verdict ?? ""] ?? ["—", "var(--ink-3)"];
              return (
                <div key={i} className="grid grid-cols-[4.5rem_1fr] gap-x-2 text-[12px]">
                  <span style={{ color }}>{label}</span>
                  <span className="min-w-0"><span className="mono faint">{when(r.at)}</span>
                    {!!r.failed_items?.length && <span className="ml-2">失败项 {r.failed_items.join("、")}</span>}
                    {r.note && <span className="block muted">{r.note}</span>}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
      <Section title="解释与决策"><p className="leading-relaxed">{c.interpretation ?? "—"}</p></Section>
      <Section title="登记" open={false}>
        <KeyValues items={[
          ["登记", c.registration ? <Tip content={c.registration}><span className="mono block truncate">{c.registration}</span></Tip> : "—"],
          ["职责", (c.duties ?? []).join(" ") || "—"],
        ]} />
      </Section>
    </div>
  );
}

export function Detail({ widget, selected, onSelect, targets }: {
  widget: DetailWidget; selected: string | null; onSelect: (id: string) => void; targets: Targets | null;
}) {
  const c = widget.items.find((item) => item.id === (selected ?? widget.default));
  return c ? <Inspector c={c} targets={targets} onSelect={onSelect} />
    : <p className="p-4 faint">在谱系、表格或散点图里点一个版本。</p>;
}
