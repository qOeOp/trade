import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { Locale } from '@/lib/i18n';

export type Copy = Record<Locale, string>;
export type ScenarioId = 'overview' | 'replay' | 'research';
export type ServiceId = 'strategy' | 'catalog' | 'nautilus' | 'evidence';
export type FlowStep = { label: Copy; route: string };
export type Service = {
  id: ServiceId;
  label: string;
  summary: Copy;
  entrance: Copy;
  route: string;
  steps: FlowStep[];
  apis: Copy[];
};
const copy = (zh: string, en: string): Copy => ({ zh, en });
const step = (zh: string, en: string, route: string): FlowStep => ({ label: copy(zh, en), route });

export const services: Service[] = [
  {
    id: 'strategy', label: 'Strategy', route: 'architecture',
    summary: copy('版本化 Nautilus 原生策略源码', 'Versioned native Nautilus strategy source'),
    entrance: copy('Python API / 本地脚本', 'Python API / local scripts'),
    steps: [step('Agent 编辑 Strategy 源码', 'Agent edits Strategy source', 'architecture'), step('冻结版本与运行参数', 'Freeze version and run parameters', 'replay')],
    apis: [copy('策略是一等公民', 'Strategy is a first-class artifact')],
  },
  {
    id: 'catalog', label: 'Catalog', route: 'architecture',
    summary: copy('历史成交价、标记价、资金费率和合约假设', 'Historical trades, marks, funding and instrument assumptions'),
    entrance: copy('Nautilus Catalog / 数据适配', 'Nautilus Catalog / data adapter'),
    steps: [step('读取现有 37 币历史数据', 'Read existing 37-instrument history', 'replay'), step('记录覆盖、版本和限制', 'Record coverage, version and limitations', 'findings')],
    apis: [copy('数据留在外部 Catalog', 'Data remains in the external Catalog')],
  },
  {
    id: 'nautilus', label: 'Nautilus', route: 'architecture',
    summary: copy('原生数据、回测、风控、执行、组合与账户', 'Native data, backtest, risk, execution, portfolio and account'),
    entrance: copy('发布版 nautilus_trader Python API', 'Published nautilus_trader Python API'),
    steps: [step('共享账户原生回放', 'Native shared-account replay', 'replay'), step('订单、成交、费用与净值报告', 'Orders, fills, costs and equity reports', 'replay')],
    apis: [copy('不维护第二套撮合或账本', 'No parallel matching engine or ledger')],
  },
  {
    id: 'evidence', label: 'Research Evidence', route: 'findings',
    summary: copy('实验身份、配对结果、发现与边界', 'Experiment identities, paired results, findings and bounds'),
    entrance: copy('Git 文档与原生回放产物', 'Git documents and native replay artifacts'),
    steps: [step('保存配对回放证据', 'Keep paired replay evidence', 'replay'), step('Agent 诊断与提出下一假设', 'Agent diagnoses and proposes the next hypothesis', 'findings')],
    apis: [copy('RD MCP 仅在持久任务需要时添加', 'Add an RD MCP only when durable tasks require it')],
  },
];

export type NodeKind = 'authority' | 'adapter' | 'protected' | 'safety';
export type NodeEmphasis = 'core' | 'standard' | 'support';
export type OwnerBadge = 'SKILL' | 'MCP' | 'EXE';
export type ScenarioRelationRole = 'primary' | 'supporting';
export type ArchitectureNodeData = {
  nodeType: 'architecture'; title: string; owner: string; kind: NodeKind; emphasis: NodeEmphasis;
  variant?: 'client' | 'strategy' | 'engine' | 'bus' | 'store';
  scenarios: ScenarioId[]; description: Copy; docsRoute: string; sourceRole: string;
  objectAuthority: string; canonicalInvariantIds: string[]; activeHandles?: string[];
  displayRole?: 'CHANNEL · NOT AN OWNER'; eventLines?: string[];
};
export type OwnerNodeData = {
  nodeType: 'owner' | 'boundary'; label: string; count: number; tone: 'neutral' | 'cyan' | 'violet' | 'amber';
  badge?: OwnerBadge; role: 'authority' | 'shell' | 'channel' | 'factory' | 'stage';
  roleLabel: 'MODULE' | 'BOUNDARY' | 'CHANNEL' | 'VALUE STREAM · NOT AN OWNER' | 'STAGE · RESEARCH';
  docsRoute: string; sourceRole: string; objectAuthority: string; canonicalInvariantIds: string[];
  memberGroupIds: string[]; activeHandles?: string[];
};
export type DiagramNodeData = ArchitectureNodeData | OwnerNodeData;

export const scenarios: Array<{ id: ScenarioId; label: Copy; description: Copy }> = [
  { id: 'overview', label: copy('全景', 'Overview'), description: copy('当前可运行架构', 'Current runnable architecture') },
  { id: 'replay', label: copy('原生回放', 'Native replay'), description: copy('策略、数据和账户进入同一次回放', 'Strategy, data and account in one replay') },
  { id: 'research', label: copy('研究迭代', 'Research iteration'), description: copy('证据反馈给 Agent，形成下一次事前假设', 'Evidence informs the next prospective hypothesis') },
];
export const moduleActiveInScenario = (module: { scenarios: ScenarioId[] }, scenario: ScenarioId) => scenario === 'overview' || module.scenarios.includes(scenario);
export const ownerGroupActiveInScenario = (groupId: string, _role: OwnerNodeData['role'], _members: string[], active: Set<string>) => active.has(groupId);
export const relationVisibleInScenario = (relation: { id: string; scenarios: ScenarioId[]; overview: boolean }, scenario: ScenarioId) => scenario === 'overview' || relation.scenarios.includes(scenario);
export const relationRoleInScenario = (_id: string, _scenario: ScenarioId): 'primary' => 'primary';

const components: Record<ServiceId, Array<{ title: string; description: Copy; route: string }>> = {
  strategy: [
    { title: 'Nautilus Strategy', description: copy('原生信号与订单逻辑', 'Native signals and orders'), route: 'architecture' },
    { title: 'Replay inputs', description: copy('冻结参数、源码版本与账户金额', 'Frozen parameters, source version and capital'), route: 'replay' },
  ],
  catalog: [
    { title: 'LAST / MARK', description: copy('历史成交与标记价格', 'Historical trade and mark prices'), route: 'replay' },
    { title: 'Funding / rules', description: copy('资金费率与合约规则假设', 'Funding and instrument assumptions'), route: 'findings' },
  ],
  nautilus: [
    { title: 'Backtest', description: copy('原生逐事件回放与撮合', 'Native event replay and matching'), route: 'replay' },
    { title: 'Risk / Execution', description: copy('原生风险与订单生命周期', 'Native risk and order lifecycle'), route: 'architecture' },
    { title: 'Portfolio', description: copy('固定资金账户、费用与净值', 'Fixed-capital account, costs and equity'), route: 'replay' },
  ],
  evidence: [
    { title: 'Paired results', description: copy('订单、成交与经济结果配对', 'Paired orders, fills and economics'), route: 'replay' },
    { title: 'Findings', description: copy('研究机制与产品发现', 'Research mechanisms and product findings'), route: 'findings' },
  ],
};
const layout: Record<ServiceId, [number, number]> = {
  strategy: [480, 80], catalog: [480, 480], nautilus: [1260, 80], evidence: [1260, 480],
};
export const architectureNodes: Node<DiagramNodeData>[] = services.flatMap((service) => {
  const [x, y] = layout[service.id];
  const groupId = `group-${service.id}`;
  const parts = components[service.id];
  const group: Node<OwnerNodeData> = {
    id: groupId, type: 'ownerGroup', position: { x, y }, width: 650, height: 285,
    style: { width: 650, height: 285 },
    data: { nodeType: 'owner', label: service.label, count: parts.length,
      tone: service.id === 'evidence' ? 'violet' : 'cyan',
      badge: service.id === 'nautilus' ? 'EXE' : undefined,
      role: 'authority', roleLabel: 'MODULE', docsRoute: service.route,
      sourceRole: service.id, objectAuthority: service.id, canonicalInvariantIds: [], memberGroupIds: [] },
  };
  const children = parts.map((part, index): Node<ArchitectureNodeData> => ({
    id: `${service.id}-${index}`, parentId: groupId, type: 'architectureNode',
    position: { x: 25 + (index % 3) * 205, y: 95 }, width: 190, height: 75,
    style: { width: 190, height: 75 },
    data: { nodeType: 'architecture', title: part.title, owner: service.id,
      kind: 'authority', emphasis: 'standard', scenarios: ['replay', 'research'],
      description: part.description, docsRoute: part.route, sourceRole: service.id,
      objectAuthority: service.id, canonicalInvariantIds: [] },
  }));
  return [group, ...children];
});
architectureNodes.push({
  id: 'agent', type: 'architectureNode', position: { x: 0, y: 310 }, width: 330, height: 90,
  style: { width: 330, height: 90 },
  data: { nodeType: 'architecture', title: 'Agent', owner: 'user', kind: 'adapter',
    emphasis: 'support', variant: 'client', scenarios: ['replay', 'research'],
    description: copy('提出假设、编辑源码、运行回放并解释证据', 'Proposes hypotheses, edits source, runs replay and interprets evidence'),
    docsRoute: 'architecture', sourceRole: 'agent', objectAuthority: 'user', canonicalInvariantIds: [] },
});

const links: Array<{ id: string; source: string; target: string; label: Copy; scenarios: ScenarioId[]; from: string; to: string }> = [
  { id: 'agent-strategy', source: 'agent', target: 'group-strategy', label: copy('编写原生策略', 'Author native strategy'), scenarios: ['replay', 'research'], from: 'right', to: 'left' },
  { id: 'strategy-nautilus', source: 'group-strategy', target: 'group-nautilus', label: copy('策略与参数', 'Strategy and parameters'), scenarios: ['replay'], from: 'right', to: 'left' },
  { id: 'catalog-nautilus', source: 'group-catalog', target: 'group-nautilus', label: copy('历史数据', 'Historical inputs'), scenarios: ['replay'], from: 'right', to: 'bottom' },
  { id: 'nautilus-evidence', source: 'group-nautilus', target: 'group-evidence', label: copy('原生结果', 'Native results'), scenarios: ['replay', 'research'], from: 'bottom', to: 'top' },
  { id: 'evidence-agent', source: 'group-evidence', target: 'agent', label: copy('诊断与后继假设', 'Diagnosis and next hypothesis'), scenarios: ['research'], from: 'left', to: 'bottom' },
];
export const fullArchitectureEdges: Edge[] = links.map((link) => ({
  id: link.id, source: link.source, target: link.target, type: 'architectureEdge',
  sourceHandle: `out-${link.from}`, targetHandle: `in-${link.to}`,
  markerEnd: { type: MarkerType.ArrowClosed, color: '#2563eb', width: 11, height: 11 },
  data: { scenarios: link.scenarios, overview: true, relation: 'handoff', relationKind: 'owner',
    description: link.label, docsRoute: 'architecture' },
}));
