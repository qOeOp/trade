import type { Locale } from '@/lib/i18n';

// Home page map. Each chapter is a container (a component of the product); inside it sit the
// chapter's functions; edges connect functions across containers and say what is handed over.

export type Copy = Record<Locale, string>;
export type Accent = 'violet' | 'cyan' | 'slate' | 'amber';
export type Side = 't' | 'r' | 'b' | 'l';

export type MapFunction = { path: string; title: Copy };
export type MapContainer = {
  prefix: string;
  slug: string;
  title: Copy;
  accent: Accent;
  x: number;
  y: number;
  // 'column' stacks functions vertically; 'row' lays them out side by side (the foundation)
  layout?: 'column' | 'row';
  functions: MapFunction[];
};
export type MapEdge = { source: string; target: string; label: Copy; kind: 'loop' | 'flow'; from?: Side; to?: Side };

const c = (zh: string, en: string): Copy => ({ zh, en });
const f = (path: string, zh: string, en: string): MapFunction => ({ path, title: c(zh, en) });

export const FUNCTION_WIDTH = 200;
export const FUNCTION_HEIGHT = 40;
export const FUNCTION_GAP = 10;
export const CONTAINER_PAD = 16;
export const CONTAINER_HEADER = 38;

const X = (i: number) => i * 340;
const Y = { top: 0, middle: 380, bottom: 820 };

export const containers: MapContainer[] = [
  { prefix: 'L', slug: 'library', title: c('策略库', 'Strategy Library'), accent: 'slate', x: X(0), y: Y.top, functions: [
    f('L.1', '转写根文件', 'Transcribe a root'), f('L.2', '发布为根并出首份报告', 'Publish and first report')] },
  { prefix: 'T', slug: 'lineage', title: c('候选谱系', 'Candidate Lineage'), accent: 'cyan', x: X(1), y: Y.top, functions: [
    f('T.1', '认定候选', 'What a candidate is'), f('T.2', '连成谱系', 'Parents and branches')] },
  { prefix: 'E', slug: 'entry', title: c('入口', 'Entry'), accent: 'violet', x: X(2), y: Y.top, functions: [
    f('E.1', '恢复研究状态', 'Restore research state'), f('E.2', '记录研究判断', 'Record judgments'),
    f('E.3', '综合推荐与路线选项', 'Recommend and offer lines'), f('E.4', '用户选定研究路线', 'User picks a line')] },
  { prefix: 'H', slug: 'hypothesis', title: c('提假设', 'Hypothesis'), accent: 'violet', x: X(3), y: Y.top, functions: [
    f('H.1', '界定一个假设', 'Scope a hypothesis'), f('H.2', '先查来源并留存', 'Find and keep sources'),
    f('H.3', '写下五样', 'Write the five items'), f('H.4', '登记先于回放并锁定', 'Register and lock')] },
  { prefix: 'V', slug: 'comparison', title: c('比较证据', 'Comparison'), accent: 'violet', x: X(4), y: Y.top, functions: [
    f('V.1', '跑登记的网格', 'Run the grid'), f('V.2', '核可比资格', 'Check comparability'),
    f('V.3', '做配对检验', 'Paired test'), f('V.4', '出检验结果', 'Report the test result')] },
  { prefix: 'F', slug: 'feedback', title: c('反馈与研究优先级', 'Feedback and Priority'), accent: 'violet', x: X(5), y: Y.top, functions: [
    f('F.1', '读取反馈、拆到职责', 'Read feedback by duty'), f('F.2', '更新研究优先级', 'Update priority'),
    f('F.3', '复盘与推荐', 'Review and recommend')] },
  { prefix: 'X', slug: 'validation', title: c('样本外验证', 'Out-of-Sample'), accent: 'amber', x: X(6), y: Y.top, functions: [
    f('X.1', '发起、登记与准入', 'Start and admit'), f('X.2', '报告结果', 'Report the result')] },

  { prefix: 'C', slug: 'strategy-file', title: c('策略文件', 'Strategy File'), accent: 'slate', x: X(2), y: Y.middle, functions: [
    f('C.1', '可登记的单文件', 'A registrable file'), f('C.2', '交易事实交给引擎', 'Engine owns trades'),
    f('C.3', '只用已发生的信息', 'Only past information'), f('C.4', '每个持仓挂保护单', 'Protect every position'),
    f('C.5', '切成可计数的计划', 'Countable plans'), f('C.6', '原生预检与独立审查', 'Precheck and review')] },
  { prefix: 'W', slug: 'replay-environment', title: c('回放环境', 'Replay Environment'), accent: 'slate', x: X(3), y: Y.middle, functions: [
    f('W.1', '供给交易所数据', 'Supply exchange data'), f('W.2', '划定窗口', 'Set the window'),
    f('W.3', '产出共同可交易范围', 'Produce the universe'), f('W.4', '固定账户与条款', 'Fix account and terms'),
    f('W.5', '模拟撮合与结算', 'Simulated fills')] },
  { prefix: 'G', slug: 'audit', title: c('完整性审计与证据资格', 'Audit and Eligibility'), accent: 'cyan', x: X(4), y: Y.middle, functions: [
    f('G.1', '判定回放是否有效', 'Is the replay valid'), f('G.2', '核对输入与消费', 'Inputs consumed'),
    f('G.3', '回放后独立审计', 'Independent audit'), f('G.4', '判定经济证据资格', 'Economic eligibility')] },
  { prefix: 'R', slug: 'report', title: c('报告', 'Report'), accent: 'slate', x: X(5), y: Y.middle, functions: [
    f('R.1', '绩效指标分工', 'Who computes metrics'), f('R.2', '指标口径', 'Metric definitions'),
    f('R.3', '资金使用率与容量', 'Capital and capacity'), f('R.4', '检验结果与试验次数', 'Tests and trial counts'),
    f('R.5', '汇总与摘要', 'Summaries')] },
  { prefix: 'D', slug: 'changes', title: c('变化之后', 'After Changes'), accent: 'amber', x: X(6), y: Y.middle, functions: [
    f('D.1', '认定变化', 'Recognise a change'), f('D.2', '恢复可比性', 'Restore comparability'),
    f('D.3', '运行环境变更', 'Runtime change')] },
  { prefix: 'A', slug: 'principles', title: c('总则', 'Principles'), accent: 'violet', x: X(0), y: Y.middle, functions: [
    f('A.1', '循环怎么转', 'How the loop turns'), f('A.2', '谁决定什么', 'Who decides what'),
    f('A.4', '产品代码的范围', 'Where code stops')] },

  { prefix: 'J', slug: 'ledger-runtime', title: c('账本与运行环境', 'Ledger and Runtime'), accent: 'cyan', x: X(1), y: Y.bottom, layout: 'row', functions: [
    f('J.1', '唯一来源', 'Single source'), f('J.2', '账本装什么', 'What the ledger holds'),
    f('J.3', '写入保护', 'Write protection'), f('J.4', '登记先于回放', 'Registration first'),
    f('J.5', '运行环境钉死', 'Pinned runtime'), f('J.6', '回放身份与复现', 'Replay identity')] },
];

export const mapEdges: MapEdge[] = [
  { source: 'L.2', target: 'T.1', label: c('发布为根', 'published as roots'), kind: 'flow' },
  { source: 'T.2', target: 'E.1', label: c('候选清单', 'candidate list'), kind: 'flow' },
  { source: 'E.4', target: 'H.1', label: c('选定路线', 'line chosen'), kind: 'loop' },
  { source: 'H.4', target: 'V.1', label: c('登记锁定网格', 'locked grid'), kind: 'loop' },
  { source: 'V.4', target: 'F.1', label: c('检验结果', 'test result'), kind: 'loop' },
  { source: 'F.2', target: 'H.1', label: c('下一假设', 'next hypothesis'), kind: 'loop', from: 't', to: 't' },
  { source: 'F.3', target: 'E.3', label: c('推荐与换路线', 'recommend, change line'), kind: 'loop', from: 't', to: 't' },
  { source: 'F.3', target: 'X.1', label: c('用户认可后发起', 'user starts it'), kind: 'flow' },
  { source: 'T.1', target: 'C.1', label: c('每个候选一份源码', 'one file each'), kind: 'flow', from: 'b', to: 't' },
  { source: 'C.6', target: 'H.4', label: c('预检通过才可登记', 'precheck gates registration'), kind: 'flow', from: 'r', to: 'l' },
  { source: 'V.1', target: 'W.5', label: c('每点回放一次', 'replay each point'), kind: 'flow', from: 'l', to: 'r' },
  { source: 'W.5', target: 'G.3', label: c('原生报告', 'native reports'), kind: 'flow' },
  { source: 'G.1', target: 'R.1', label: c('有效运行', 'valid runs'), kind: 'flow' },
  { source: 'G.4', target: 'V.2', label: c('经济证据资格', 'eligibility'), kind: 'flow', from: 'r', to: 'r' },
  { source: 'R.1', target: 'V.3', label: c('日收益', 'daily returns'), kind: 'flow', from: 'l', to: 'r' },
  { source: 'X.1', target: 'W.5', label: c('只回放一次', 'replay once'), kind: 'flow', from: 'b', to: 'b' },
  { source: 'W.1', target: 'D.1', label: c('数据修正或新月份', 'data revised'), kind: 'flow', from: 't', to: 't' },
  { source: 'D.3', target: 'J.5', label: c('先证明引擎行为没变', 'prove behaviour unchanged'), kind: 'flow', from: 'b', to: 't' },
  { source: 'H.4', target: 'J.4', label: c('登记先后入账', 'registration recorded'), kind: 'flow', from: 'l', to: 't' },
  { source: 'E.2', target: 'J.2', label: c('判断只追加入账', 'judgments appended'), kind: 'flow', from: 'l', to: 't' },
  { source: 'J.5', target: 'W.5', label: c('钉死的镜像', 'pinned image'), kind: 'flow', from: 't', to: 'b' },
];
