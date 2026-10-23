import type { Candidate, DetailWidget } from "../types";
import { pct, PREDICTION, ratio, STATUS, when } from "../format";

const OUTCOME: Record<string, string> = { held: "✓ 成立", failed: "✗ 失败", untestable: "无法检验" };
const VERDICT: Record<string, string> = { passed: "✓ 通过", failed: "✗ 失败" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--rule)", background: "var(--surface-2)" }}>
      <h4 className="border-b px-3 py-1.5 text-[11px] font-semibold tracking-wider faint"
          style={{ borderColor: "var(--rule)", background: "var(--surface-0)" }}>{title}</h4>
      <div className="px-3 py-2.5 text-[12.5px] leading-relaxed">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead><tr>{head.map((h) => <th key={h} className="border-b py-1 pr-2 text-left font-medium faint" style={{ borderColor: "var(--rule)" }}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}>{r.map((c, j) => <td key={j} className="border-b py-1 pr-2 align-top" style={{ borderColor: "var(--rule)" }}>{c}</td>)}</tr>
      ))}</tbody>
    </table>
  );
}

function Card({ c }: { c: Candidate }) {
  const runs = (c.trials ?? []).filter((t) => t.purpose === "research");
  const last = runs[runs.length - 1] ?? {};
  const cmp = c.comparison ?? {};
  const compared = [
    cmp.vs_trial != null && `对照 trial ${cmp.vs_trial}`,
    cmp.interval_crosses_zero === true ? "差值区间跨零" : cmp.interval_crosses_zero === false ? "差值区间不跨零" : null,
    cmp.mean_daily_log_difference != null && `日均对数差 ${cmp.mean_daily_log_difference.toPrecision(3)}（可检出 ${cmp.detectable?.toPrecision(3) ?? "—"}）`,
    cmp.summary,
  ].filter(Boolean).join(" · ") || "—";
  const status = STATUS[c.status_class];
  return (
    <div className="space-y-3">
      <section className="rounded-xl border p-3" style={{ borderColor: "var(--rule)", background: "var(--surface-2)" }}>
        <h3 className="mono text-[15px] font-semibold break-all">{c.id}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11.5px] muted">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2" style={{ borderColor: "var(--rule-strong)" }}>
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: status.color, border: "1px solid var(--ink-2)" }} />{status.label}
          </span>
          <span className="rounded-full border px-2" style={{ borderColor: "var(--rule-strong)" }}>{PREDICTION[c.prediction_class].label}</span>
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="faint">父版本</dt><dd className="mono break-all">{c.parent ?? "无（根）"}</dd>
          <dt className="faint">发布</dt><dd>{when(c.created_at) || "—"}</dd>
          <dt className="faint">职责</dt><dd>{(c.duties ?? []).join(" ") || "—"}</dd>
          {c.registration && <><dt className="faint">登记</dt><dd className="mono break-all">{c.registration}</dd></>}
        </dl>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {[["年化", pct(last.annual_return)], ["最大回撤", pct(last.max_drawdown)], ["夏普", ratio(last.sharpe)], ["胜率", pct(last.win_rate)]].map(([k, v]) => (
            <div key={k} className="rounded-lg px-2 py-1.5" style={{ background: "var(--surface-0)" }}>
              <div className="text-[11px] faint">{k}</div><div className="text-sm font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </section>
      <Section title="改了什么"><p>{c.change ?? "—"}</p></Section>
      <Section title="假设"><p>{c.hypothesis ?? "—"}</p></Section>
      {!!c.predictions?.length && (
        <Section title="预测">
          <Table head={["度量", "方向", "结果"]} rows={c.predictions.map((p) => [<span className="mono">{p.measure}</span>, p.direction, OUTCOME[p.outcome ?? ""] ?? "—"])} />
        </Section>
      )}
      <Section title="回放">
        <Table head={["trial", "用途", "年化", "回撤", "夏普", "资格"]} rows={(c.trials ?? []).map((t) => [
          <span className="mono">{t.trial_id}</span>, t.purpose, pct(t.annual_return), pct(t.max_drawdown), ratio(t.sharpe),
          t.eligible === false ? `✗ ${t.ineligible_reason ?? ""}` : t.eligible ? "✓" : "—"])} />
      </Section>
      <Section title="与对照比较"><p>{compared}</p></Section>
      {!!c.reviews?.length && (
        <Section title="源码审阅">
          <Table head={["结论", "失败项", "时间", "说明"]} rows={c.reviews.map((r) => [VERDICT[r.verdict ?? ""] ?? "—", (r.failed_items ?? []).join(","), when(r.at), r.note])} />
        </Section>
      )}
      <Section title="解释与决策"><p>{c.interpretation ?? "—"}</p></Section>
    </div>
  );
}

export function Detail({ widget, selected }: { widget: DetailWidget; selected: string | null }) {
  const c = widget.items.find((item) => item.id === (selected ?? widget.default));
  return c ? <Card c={c} /> : <p className="faint">在谱系或散点图里点一个版本。</p>;
}
