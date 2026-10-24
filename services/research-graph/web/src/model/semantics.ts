// What the view model's states mean on the page: labels, hints and which colour role each takes.
// Colour roles are named, never valued, here (theme/roles.ts maps them).
import type { Prediction, Role, Targets } from "./types";

export const ROLE: Record<Role, { label: string; hint: string }> = {
  recommended: { label: "当前推荐", hint: "最近一条推荐判断推荐的版本" },
  kept_reference: { label: "保留参照", hint: "最近一条推荐判断点名保留、作参照的版本" },
  superseded: { label: "已被取代", hint: "有经济证据，但最近的推荐判断没有点名" },
  masked: { label: "失去资格", hint: "源码审阅失败等原因，运行不再有经济证据" },
  precheck_failed: { label: "预检或审阅失败", hint: "没有研究运行，审阅失败" },
  unrun: { label: "未回放", hint: "没有研究运行" },
};

export const PREDICTION: Record<Prediction, { label: string; tone: "meets" | "misses" | "fg-muted" | "fg-faint" }> = {
  held: { label: "预测全部成立", tone: "meets" },
  failed: { label: "预测全部失败", tone: "misses" },
  mixed: { label: "预测部分成立", tone: "fg-muted" },
  none: { label: "预测未判定", tone: "fg-faint" },
};

export type Reading = { annual_return: number | null; max_drawdown: number | null };

/** Whether a reading meets its target: null when either is unknown. */
export function meets(value: number | null | undefined, target: number | null | undefined, higher: boolean): boolean | null {
  if (value == null || target == null) return null;
  return higher ? value >= target : value <= target;
}

export function verdict(reading: Reading, targets: Targets | null) {
  return { ret: meets(reading.annual_return, targets?.annual_return, true), dd: meets(reading.max_drawdown, targets?.max_drawdown, false) };
}

/** A reading's text colour: marked only when it misses its target. */
export const tone = (ok: boolean | null): "misses" | "fg" => (ok === false ? "misses" : "fg");

export const PURPOSE: Record<string, string> = { research: "研究", precheck: "预检", explore: "探索", validation: "验证" };
