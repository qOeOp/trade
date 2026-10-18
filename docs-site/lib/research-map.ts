import type { Locale } from '@/lib/i18n';
import mapData from '@/lib/generated/rd-map.json';

// Home page map, read from the document itself (docs/rd/map.json, written with the chapters):
// a function (level 2) is a container of components (level 3), a component holds its
// capabilities (level 4). Chapters are column labels. Edges between functions show the main flow;
// hovering a capability shows its links to capabilities in other functions.

export type Side = 't' | 'r' | 'b' | 'l';
export type MapCapability = { path: string; title: string; kind: 'mechanism' | 'rule'; guarantee: string };
export type MapComponent = { path: string; title: string; caps: MapCapability[] };
export type MapFunction = { path: string; title: string; components: MapComponent[] };
export type MapChapter = { prefix: string; slug: string; title: string; functions: MapFunction[] };
export type FlowEdge = { source: string; target: string; label: Record<Locale, string>; kind: 'loop' | 'flow'; from?: Side; to?: Side };

export const data = mapData as { chapters: MapChapter[]; links: [string, string][] };

export const CAP_W = 236;
export const CAP_H = 40;
export const CAP_GAP = 6;
export const COMP_PAD = 8;
export const COMP_HEAD = 24;
export const COMP_GAP = 10;
export const FN_PAD = 10;
export const FN_HEAD = 32;
export const FN_GAP = 22;
export const FN_W = CAP_W + 2 * COMP_PAD + 2 * FN_PAD;
export const COL_GAP = 90;
export const ROW_GAP = 140;
export const LABEL_H = 34;

// Where each chapter's column sits: row 0 is the research loop, row 1 replay and evidence, row 2 the
// ledger and runtime (its functions laid out side by side).
export const grid: Record<string, { row: 0 | 1 | 2; col: number }> = {
  L: { row: 0, col: 0 }, T: { row: 0, col: 1 }, E: { row: 0, col: 2 }, H: { row: 0, col: 3 }, V: { row: 0, col: 4 }, P: { row: 0, col: 5 }, F: { row: 0, col: 6 }, X: { row: 0, col: 7 },
  A: { row: 1, col: 0 }, C: { row: 1, col: 2 }, W: { row: 1, col: 3 }, G: { row: 1, col: 4 }, R: { row: 1, col: 5 },
  J: { row: 2, col: 1 },
};

const c = (zh: string, en: string) => ({ zh, en });

// Main flow between functions; everything else appears on hover.
export const flowEdges: FlowEdge[] = [
  { source: 'L.2', target: 'T.1', label: c('发布为根', 'published as roots'), kind: 'flow' },
  { source: 'T.2', target: 'E.1', label: c('候选清单', 'candidate list'), kind: 'flow' },
  { source: 'E.4', target: 'H.1', label: c('选定路线', 'line chosen'), kind: 'loop' },
  { source: 'H.4', target: 'V.1', label: c('登记锁定网格', 'locked grid'), kind: 'loop' },
  { source: 'V.4', target: 'P.1', label: c('检验结果', 'test result'), kind: 'loop' },
  { source: 'P.4', target: 'F.2', label: c('按职责的解释', 'findings by duty'), kind: 'loop' },
  { source: 'F.2', target: 'H.1', label: c('下一假设', 'next hypothesis'), kind: 'loop', from: 't', to: 't' },
  { source: 'F.3', target: 'E.3', label: c('推荐与换路线', 'recommend, change line'), kind: 'loop', from: 't', to: 't' },
  { source: 'F.3', target: 'X.1', label: c('用户认可后发起', 'user starts it'), kind: 'flow' },
  { source: 'T.1', target: 'C.1', label: c('每个候选一份源码', 'one file each'), kind: 'flow', from: 'b', to: 'l' },
  { source: 'C.6', target: 'H.4', label: c('预检通过才可登记', 'precheck gates registration'), kind: 'flow', from: 'r', to: 'l' },
  { source: 'V.1', target: 'W.5', label: c('每点回放一次', 'replay each point'), kind: 'flow', from: 'l', to: 'r' },
  { source: 'W.5', target: 'G.3', label: c('原生报告', 'native reports'), kind: 'flow' },
  { source: 'G.1', target: 'R.1', label: c('有效运行', 'valid runs'), kind: 'flow' },
  { source: 'G.4', target: 'V.2', label: c('经济证据资格', 'eligibility'), kind: 'flow', from: 'r', to: 'r' },
  { source: 'R.1', target: 'V.3', label: c('日收益', 'daily returns'), kind: 'flow', from: 'l', to: 'r' },
  { source: 'X.1', target: 'W.5', label: c('只回放一次', 'replay once'), kind: 'flow', from: 'b', to: 'b' },
  { source: 'W.1', target: 'J.6', label: c('数据修正或新月份', 'data revised'), kind: 'flow', from: 'l', to: 't' },
  { source: 'H.4', target: 'J.4', label: c('登记先后入账', 'registration recorded'), kind: 'flow', from: 'l', to: 't' },
  { source: 'E.2', target: 'J.2', label: c('判断只追加入账', 'judgments appended'), kind: 'flow', from: 'l', to: 't' },
  { source: 'J.5', target: 'W.5', label: c('钉死的镜像', 'pinned image'), kind: 'flow', from: 't', to: 'b' },
];

// Flows split the map into local views: each tab lays out its functions left to right with their
// components and capabilities, and draws the capability links that stay inside the flow.
export type Flow = { id: string; title: Record<Locale, string>; functions: string[] };
export const flows: Flow[] = [
  { id: 'start', title: c('起步', 'Getting started'), functions: ['L.1', 'L.2', 'T.1', 'T.2', 'E.1', 'E.3', 'E.4'] },
  { id: 'register', title: c('提假设与登记', 'Hypothesis and registration'), functions: ['H.1', 'H.2', 'H.3', 'H.4', 'C.1', 'C.6'] },
  { id: 'replay', title: c('回放与证据', 'Replay and evidence'), functions: ['V.1', 'W.4', 'W.5', 'G.1', 'G.2', 'G.3', 'G.4', 'R.1', 'R.2'] },
  { id: 'compare', title: c('比较与归因', 'Comparison and attribution'), functions: ['V.2', 'V.3', 'V.4', 'P.1', 'P.2', 'P.3'] },
  { id: 'feedback', title: c('反馈与下一假设', 'Feedback and next hypothesis'), functions: ['P.4', 'F.1', 'F.2', 'F.3', 'E.2'] },
  { id: 'validation', title: c('样本外验证', 'Out-of-sample'), functions: ['F.3', 'X.1', 'X.2'] },
  { id: 'strategy', title: c('策略文件与数据', 'Strategy file and data'), functions: ['C.1', 'C.2', 'C.3', 'C.4', 'C.5', 'W.1', 'W.2', 'W.3'] },
  { id: 'ledger', title: c('账本与运行环境', 'Ledger and runtime'), functions: ['J.1', 'J.2', 'J.3', 'J.4', 'J.5', 'J.6'] },
];

export const mapCopy = {
  overview: c('总览', 'Overview'),
  outside: c('对外关联', 'links outside'),
  rule: c('skill 规则', 'skill rule'),
  hover: c('悬停能力或功能，高亮它的关联', 'Hover a capability or function to highlight its links'),
};
