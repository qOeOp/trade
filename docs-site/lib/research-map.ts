import type { Locale } from '@/lib/i18n';

// The home page map: one node per chapter, placed in three lanes plus a foundation,
// and the edges say what one chapter hands to the next.

export type Copy = Record<Locale, string>;
export type LaneId = 'loop' | 'replay' | 'origin';
export type Side = 't' | 'r' | 'b' | 'l';

export type MapChapter = {
  prefix: string;
  slug: string;
  title: Copy;
  role: Copy;
  lane: LaneId | 'foundation' | 'overview';
  x: number;
  y: number;
  width?: number;
};

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  from: Side;
  to: Side;
  label: Copy;
  kind: 'loop' | 'evidence' | 'user';
};

const c = (zh: string, en: string): Copy => ({ zh, en });

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 76;
const COL = [0, 320, 640, 960, 1280];
const ROW = { overview: -170, start: 0, replay: 220, outcome: 440, foundation: 640 };

// Three rows read left to right: choose a line and state a hypothesis; replay and judge the evidence;
// feed back, validate or absorb a change. Edges only run along the gaps between nodes.
export const lanes: Array<{ id: LaneId; title: Copy; y: number }> = [
  { id: 'loop', title: c('选路线与提假设', 'Choose a line, state a hypothesis'), y: ROW.start },
  { id: 'replay', title: c('回放与证据', 'Replay and evidence'), y: ROW.replay },
  { id: 'origin', title: c('反馈、验证与变化', 'Feedback, validation, change'), y: ROW.outcome },
];

export const LANE_SPAN = { x: -40, width: COL[4] + NODE_WIDTH + 80, height: NODE_HEIGHT + 84 };

export const mapChapters: MapChapter[] = [
  { prefix: 'A', slug: 'principles', title: c('总则', 'Principles'), role: c('谁决定什么、代码管到哪', 'Who decides what, where code stops'), lane: 'overview', x: COL[0], y: ROW.overview },
  { prefix: 'L', slug: 'library', title: c('策略库', 'Strategy Library'), role: c('模板与人造根', 'Templates and user roots'), lane: 'loop', x: COL[0], y: ROW.start },
  { prefix: 'T', slug: 'lineage', title: c('候选谱系', 'Candidate Lineage'), role: c('候选身份、父版本与森林', 'Identity, parents, the forest'), lane: 'loop', x: COL[1], y: ROW.start },
  { prefix: 'E', slug: 'entry', title: c('入口', 'Entry'), role: c('恢复研究状态，用户选路线', 'Restore state, user picks a line'), lane: 'loop', x: COL[2], y: ROW.start },
  { prefix: 'H', slug: 'hypothesis', title: c('假设与登记', 'Hypothesis'), role: c('写下假设，回放前登记锁定', 'State it, register before replay'), lane: 'loop', x: COL[3], y: ROW.start },
  { prefix: 'C', slug: 'strategy-file', title: c('策略文件', 'Strategy File'), role: c('单文件源码与 27 项职责文件头', 'One file, 27-duty header'), lane: 'replay', x: COL[0], y: ROW.replay },
  { prefix: 'W', slug: 'replay-environment', title: c('回放环境', 'Replay Environment'), role: c('数据、窗口、范围、账户、撮合', 'Data, window, universe, account'), lane: 'replay', x: COL[1], y: ROW.replay },
  { prefix: 'G', slug: 'audit', title: c('审计与资格', 'Audit and Eligibility'), role: c('回放有没有效，算不算证据', 'Is the run valid, does it count'), lane: 'replay', x: COL[2], y: ROW.replay },
  { prefix: 'R', slug: 'report', title: c('报告', 'Report'), role: c('绩效指标与口径', 'Performance metrics'), lane: 'replay', x: COL[3], y: ROW.replay },
  { prefix: 'V', slug: 'comparison', title: c('比较证据', 'Comparison'), role: c('配对检验：效应、区间、p', 'Paired test: effect, interval, p'), lane: 'replay', x: COL[4], y: ROW.replay },
  { prefix: 'D', slug: 'changes', title: c('变化之后', 'After Changes'), role: c('数据或环境变了，旧结论怎么办', 'When data or runtime change'), lane: 'origin', x: COL[0], y: ROW.outcome },
  { prefix: 'X', slug: 'validation', title: c('样本外验证', 'Out-of-Sample'), role: c('用户发起，只跑一次', 'User-initiated, run once'), lane: 'origin', x: COL[2], y: ROW.outcome },
  { prefix: 'F', slug: 'feedback', title: c('反馈与优先级', 'Feedback'), role: c('解释、排下一步、按节奏复盘', 'Interpret, rank, review on cadence'), lane: 'origin', x: COL[4], y: ROW.outcome },
  { prefix: 'J', slug: 'ledger-runtime', title: c('账本与运行环境', 'Ledger and Runtime'), role: c('所有记录只追加入账；回放在按摘要钉死的镜像里跑', 'Every record appended; replays run in a digest-pinned image'), lane: 'foundation', x: COL[0], y: ROW.foundation, width: COL[4] + NODE_WIDTH },
];

export const mapEdges: MapEdge[] = [
  { id: 'L-T', source: 'L', target: 'T', from: 'r', to: 'l', label: c('发布为根', 'published as roots'), kind: 'evidence' },
  { id: 'T-E', source: 'T', target: 'E', from: 'r', to: 'l', label: c('候选清单', 'candidate list'), kind: 'evidence' },
  { id: 'E-H', source: 'E', target: 'H', from: 'r', to: 'l', label: c('用户选定路线', 'line chosen'), kind: 'user' },
  { id: 'H-T', source: 'H', target: 'T', from: 't', to: 't', label: c('发布新候选', 'new candidates'), kind: 'loop' },
  { id: 'T-C', source: 'T', target: 'C', from: 'b', to: 't', label: c('每个候选一份源码', 'one file each'), kind: 'evidence' },
  { id: 'H-W', source: 'H', target: 'W', from: 'b', to: 't', label: c('登记后回放', 'replay after registration'), kind: 'loop' },
  { id: 'C-W', source: 'C', target: 'W', from: 'r', to: 'l', label: c('被回放的源码', 'source'), kind: 'evidence' },
  { id: 'W-G', source: 'W', target: 'G', from: 'r', to: 'l', label: c('原生报告', 'native reports'), kind: 'evidence' },
  { id: 'G-R', source: 'G', target: 'R', from: 'r', to: 'l', label: c('有效运行', 'valid runs'), kind: 'evidence' },
  { id: 'R-V', source: 'R', target: 'V', from: 'r', to: 'l', label: c('日收益', 'daily returns'), kind: 'evidence' },
  { id: 'V-F', source: 'V', target: 'F', from: 'b', to: 't', label: c('检验结果', 'test results'), kind: 'loop' },
  { id: 'F-H', source: 'F', target: 'H', from: 'r', to: 'r', label: c('下一假设', 'next hypothesis'), kind: 'loop' },
  { id: 'F-E', source: 'F', target: 'E', from: 'r', to: 't', label: c('换路线（用户选）', 'change line (user)'), kind: 'user' },
  { id: 'F-X', source: 'F', target: 'X', from: 'l', to: 'r', label: c('用户认可后发起', 'user starts it'), kind: 'user' },
  { id: 'X-W', source: 'X', target: 'W', from: 't', to: 'b', label: c('只回放一次', 'replayed once'), kind: 'user' },
  { id: 'D-W', source: 'D', target: 'W', from: 't', to: 'b', label: c('变化后重放', 'replay after a change'), kind: 'evidence' },
];

export const mapCopy = {
  title: c('研发长链', 'Research Chain'),
  intro: c(
    'Agent 在候选谱系上不停地提假设、登记、回放、比较、反馈；只有信任边界由代码强制，认不认可由用户看报告判断。',
    'The Agent keeps proposing, registering, replaying, comparing and learning on a candidate lineage; only trust boundaries are enforced in code, and acceptance is the user’s call.',
  ),
  read: c('阅读文档', 'Read the documentation'),
  concepts: c('核心概念', 'Core concepts'),
  legend: {
    loop: c('研究循环', 'Research loop'),
    evidence: c('证据传递', 'Evidence'),
    user: c('用户决定', 'User decision'),
  },
};
