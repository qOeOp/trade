import type { Prediction, Role, Targets } from "./types";

export const pct = (v?: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
export const ratio = (v?: number | null) => (v == null ? "—" : v.toFixed(2));
export const when = (v?: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "");

// A version's role in the line, shown by shape first and colour second (see StatusMark).
export const ROLE: Record<Role, { label: string; hint: string }> = {
  recommended: { label: "当前推荐", hint: "最近一条推荐判断推荐的版本" },
  kept_reference: { label: "保留参照", hint: "最近一条推荐判断点名保留、作参照的版本" },
  superseded: { label: "已被取代", hint: "有经济证据，但最近的推荐判断没有点名" },
  masked: { label: "失去资格", hint: "源码审阅失败等原因，运行不再有经济证据" },
  precheck_failed: { label: "预检或审阅失败", hint: "没有研究运行，审阅失败" },
  unrun: { label: "未回放", hint: "没有研究运行" },
};

export const PREDICTION: Record<Prediction, { glyph: string; label: string; color: string }> = {
  held: { glyph: "✓", label: "预测全部成立", color: "var(--meet)" },
  failed: { glyph: "✗", label: "预测全部失败", color: "var(--miss)" },
  mixed: { glyph: "±", label: "预测部分成立", color: "var(--ink-2)" },
  none: { glyph: "", label: "预测未判定", color: "var(--ink-3)" },
};

/** Whether a reading meets its target: null when either is unknown. */
export function meets(value: number | null | undefined, target: number | null | undefined, higher: boolean): boolean | null {
  if (value == null || target == null) return null;
  return higher ? value >= target : value <= target;
}

export const readingColor = (ok: boolean | null) => (ok === false ? "var(--miss)" : "var(--ink-1)");

export function verdict(reading: { annual_return: number | null; max_drawdown: number | null }, targets: Targets | null) {
  return {
    ret: meets(reading.annual_return, targets?.annual_return, true),
    dd: meets(reading.max_drawdown, targets?.max_drawdown, false),
  };
}
