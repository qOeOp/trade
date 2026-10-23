import type { Prediction, Status } from "./types";

export const pct = (v?: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
export const ratio = (v?: number | null) => (v == null ? "—" : v.toFixed(2));
export const when = (v?: string | null) => (v ? v.slice(0, 16).replace("T", " ") : "");

export const STATUS: Record<Status, { label: string; color: string }> = {
  recommended: { label: "当前推荐", color: "var(--s-recommended)" },
  meets_targets: { label: "达标", color: "var(--s-meets)" },
  below_targets: { label: "未达标", color: "var(--s-below)" },
  masked: { label: "失去资格", color: "var(--s-masked)" },
  precheck_failed: { label: "预检或审阅失败", color: "var(--s-failed)" },
  unrun: { label: "未回放", color: "var(--surface-1)" },
};

export const PREDICTION: Record<Prediction, { glyph: string; label: string; color: string }> = {
  held: { glyph: "✓", label: "预测全部成立", color: "var(--s-meets)" },
  failed: { glyph: "✗", label: "预测全部失败", color: "var(--s-failed)" },
  mixed: { glyph: "±", label: "预测部分成立", color: "var(--s-recommended)" },
  none: { glyph: "", label: "预测未判定", color: "var(--ink-3)" },
};
