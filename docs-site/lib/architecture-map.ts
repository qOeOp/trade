import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { Locale } from '@/lib/i18n';

export type Copy = Record<Locale, string>;
export type ServiceId = 'market-data' | 'backtest' | 'rd' | 'qualification' | 'governance' | 'native';
export type ScenarioId = 'overview' | 'research' | 'r1' | 'discovery' | 'trial' | 'improvement' | 'recovery';
export type FlowStep = { label: Copy; route: string };
export type Service = {
  id: ServiceId;
  label: string;
  summary: Copy;
  entrance: Copy;
  route: string;
  steps: FlowStep[];
  apis: Copy[];
  boundary: Copy;
};
const copy = (zh: string, en: string): Copy => ({ zh, en });
const step = (zh: string, en: string, route: string): FlowStep => ({ label: copy(zh, en), route });

// A presentation of the product blueprint; these labels do not create Owner or wire identities.
export const services: Service[] = [
  {
    id: 'market-data', label: 'Market Data', route: 'owners/market-data',
    summary: copy('行情、标的与输入准备', 'Markets, instruments and input preparation'),
    entrance: copy('数据 MCP / 内部 API', 'Data MCP / internal API'),
    steps: [
      step('来源与标的准入', 'Admit source and instruments', 'owners/market-data'),
      step('原生类型、DataClient/DataEngine 与 Catalog 接入', 'Native types, DataClient/DataEngine and Catalog integration', 'owners/market-data'),
      step('按冻结需求准备原生或派生输入', 'Prepare native or derived inputs under frozen requirements', 'owners/market-data'),
      step('绑定准确版本、可得截面与缺口', 'Bind exact versions, availability cuts and gaps', 'owners/market-data'),
      step('Agent 按需读取；策略实时订阅', 'Agent queries; strategy streams', 'owners/market-data'),
    ],
    apis: [copy('来源/标的、导入、准备与任务读回', 'Sources/instruments, imports, preparation and job readback'), copy('覆盖、修订、成员时间线与保护读取', 'Coverage, revisions, membership timelines and protected reads')],
    boundary: copy('接入并扩展原生 DataClient/DataEngine/Catalog；节点保留数据引擎，不经 MCP 逐根取 K。', 'Integrates native DataClient/DataEngine/Catalog; nodes retain DataEngine without per-bar MCP calls.'),
  },
  {
    id: 'rd', label: 'R&D', route: 'owners/rd',
    summary: copy('研究、策略编写与知识', 'Research, authoring and knowledge'),
    entrance: copy('research / authoring / knowledge / scan', 'research / authoring / knowledge / scan'),
    steps: [
      step('项目、来源与冻结边界', 'Project, sources and frozen bounds', 'owners/rd'),
      step('记录 Agent 实验方案与比较目标', 'Record Agent experiments and comparison goals', 'owners/rd'),
      step('原生源码包与封存 Artifact', 'Native source package and sealed Artifact', 'owners/rd'),
      step('资源准入、数据绑定与回测任务', 'Resource admission, data binding and replay jobs', 'owners/rd'),
      step('记录 Agent 结论；目标达成则停止', 'Record Agent conclusions; stop on goal completion', 'owners/rd'),
      step('知识沉淀、复核与代理接管', 'Knowledge, review and Agent takeover', 'owners/rd'),
    ],
    apis: [copy('项目、家族、编写、实验与迭代', 'Projects, families, authoring, experiments and iteration'), copy('知识检索、按需发现与接管', 'Knowledge retrieval, on-demand discovery and takeover')],
    boundary: copy('Agent 负责模型判断，R&D 持有事实；不撮合、不读取保护详情。', 'Agents provide model judgments; R&D owns facts, not matching or protected details.'),
  },
  {
    id: 'backtest', label: 'Backtest', route: 'owners/backtest',
    summary: copy('原生回放、撮合与报告', 'Native replay, matching and reports'),
    entrance: copy('回测 MCP / 内部 API', 'Backtest MCP / internal API'),
    steps: [
      step('接纳单策略或冻结组合、实验与输入', 'Admit a strategy or frozen composition, experiment and inputs', 'owners/backtest'),
      step('校验覆盖与执行配置', 'Validate coverage and execution configuration', 'owners/backtest'),
      step('Nautilus 共享账户回放与订单撮合', 'Nautilus shared-account replay and order matching', 'owners/backtest'),
      step('费用、资金费、保证金与组合计量', 'Fees, funding, margin and portfolio measurement', 'owners/backtest'),
      step('封存结果、逐交易证据与报告', 'Seal results, trade evidence and reports', 'owners/backtest'),
    ],
    apis: [copy('运行、状态、报告与确定差值', 'Runs, status, reports and deterministic differences'), copy('取消、未知解析与后继回放', 'Cancellation, unknown resolution and successor replay')],
    boundary: copy('扩展 Nautilus 回放；Agent 作研究判断，Qualification 判资格。', 'Extends Nautilus replay; Agents judge research and Qualification owns eligibility.'),
  },
  {
    id: 'qualification', label: 'Qualification', route: 'owners/qualification',
    summary: copy('隔离评估与资格', 'Isolated assessment and eligibility'),
    entrance: copy('资格 MCP / 有界视图', 'Qualification MCP / bounded views'),
    steps: [
      step('用户请求后接纳冻结策略或组合候选', 'Admit a frozen strategy or composition on user request', 'owners/qualification'),
      step('冻结保护协议与隔离输入', 'Bind protected protocol and isolated inputs', 'owners/qualification'),
      step('用同一原生回测语义评估', 'Assess with the same native replay semantics', 'owners/qualification'),
      step('提交资格或有界公开负结论', 'Commit eligibility or bounded public negative conclusion', 'owners/qualification'),
    ],
    apis: [copy('候选接纳、状态、资格与撤销', 'Candidate admission, status, eligibility and revocation'), copy('二级公开结论与适用边界', 'Binary public outcomes and eligibility scope')],
    boundary: copy('保护数值与内部原因留在私有域；不部署或分配资金。', 'Protected values and private reasons stay isolated; no deployment or allocation.'),
  },
  {
    id: 'governance', label: 'Governance', route: 'owners/strategy-governance',
    summary: copy('阶段、上下架与两池分配', 'Stages, lifecycle and two-pool allocation'),
    entrance: copy('Dashboard 确认 / 治理 API', 'Dashboard confirmation / governance API'),
    steps: [
      step('核验成员及共享账户组合资格', 'Check member and shared-account composition eligibility', 'owners/strategy-governance'),
      step('用户确认试盘条件与资金政策', 'User confirms trial conditions and capital policy', 'owners/strategy-governance'),
      step('额度不满足则排队；满足后统一分配并授权', 'Queue until usage fits; then apply allocation and authorize', 'owners/strategy-governance'),
      step('按真实表现自动转正或下架', 'Promote or unload from actual performance', 'owners/strategy-governance'),
      step('记录下架；新用户指令才启动改进', 'Record unload; a new user instruction starts improvement', 'scenarios/research'),
    ],
    apis: [copy('合格目录、阶段、条件模板与资金政策', 'Eligible catalog, stages, condition templates and capital policy'), copy('生命周期请求、决定与授权读回', 'Lifecycle requests, decisions and authority readback')],
    boundary: copy('授权不证明 Runtime 已应用，更不证明实际成交。', 'Authorization proves neither Runtime application nor actual fills.'),
  },
  {
    id: 'native', label: 'Trading Node', route: 'architecture',
    summary: copy('原生交易节点：运行、风险、执行、组合', 'Runtime, risk, execution and portfolio'),
    entrance: copy('portfolio / operations 只读', 'Read-only portfolio / operations'),
    steps: [
      step('Runtime 应用授权并产生信号', 'Runtime applies authority and produces signals', 'owners/runtime'),
      step('Risk 准入资金、额度与新增风险', 'Risk admits funds, bounds and new exposure', 'owners/risk'),
      step('Execution 执行、成交、对账与恢复', 'Execution owns orders, fills, reconciliation and recovery', 'owners/execution'),
      step('Portfolio 计量净值、暴露与表现', 'Portfolio measures NAV, exposure and performance', 'owners/portfolio'),
      step('表现与运行事实返回 Governance', 'Return operation and performance facts to Governance', 'owners/strategy-governance'),
    ],
    apis: [copy('内部：应用、风险准入、执行与恢复', 'Internal: application, risk admission, execution and recovery'), copy('外部只读：账户、表现、实例、订单与告警', 'External reads: account, performance, instances, orders and alerts')],
    boundary: copy('四种职责共享同一原生节点，各自保留写权；没有第二账户或订单簿。', 'Four responsibilities share one native node with separate write authority, never a second account or order book.'),
  },
];

export type Handoff = { id: string; source: string; target: string; label: Copy };
const handoff = (id: string, source: string, target: string, zh: string, en: string): Handoff => ({ id, source, target, label: copy(zh, en) });
export const handoffs: Handoff[] = [
  handoff('agent-rd', 'agent', 'rd', '领域 MCP', 'Domain MCP'),
  handoff('agent-data', 'agent', 'market-data', '数据 MCP', 'Data MCP'),
  handoff('agent-backtest', 'agent', 'backtest', '回测 MCP', 'Replay MCP'),
  handoff('dashboard-governance', 'dashboard', 'governance', '确认、配置与控制', 'Confirm, configure, control'),
  handoff('dashboard-native', 'dashboard', 'native', '只读运行与账户', 'Read-only operation/account'),
  handoff('rd-data', 'rd', 'market-data', '核对获准数据绑定', 'Verify authorized data binding'),
  handoff('rd-backtest', 'rd', 'backtest', '已登记实验', 'Registered experiment'),
  handoff('data-backtest', 'market-data', 'backtest', '已验证输入', 'Verified inputs'),
  handoff('backtest-rd', 'backtest', 'rd', '结果与证据', 'Results/evidence'),
  handoff('rd-qualification', 'rd', 'qualification', '用户请求评估的冻结候选', 'User-requested frozen candidate'),
  handoff('qualification-backtest', 'qualification', 'backtest', '隔离评估', 'Isolated assessment'),
  handoff('qualification-governance', 'qualification', 'governance', '资格事实', 'Eligibility facts'),
  handoff('data-native', 'market-data', 'native', '实时行情', 'Live data'),
  handoff('governance-native', 'governance', 'native', '授权与资金边界', 'Authority/capital bounds'),
  handoff('native-governance', 'native', 'governance', '真实表现与状态', 'Actual performance/status'),
  handoff('governance-rd', 'governance', 'rd', '下架与后继来源', 'Unload/successor sources'),
];

export type Scenario = { id: ScenarioId; label: Copy; summary: Copy; relations: string[]; steps: FlowStep[] };
export const productScenarios: Scenario[] = [
  { id: 'overview', label: copy('全景', 'Overview'), summary: copy('六组后端职责。点击服务展开内部流程；MCP 和 API 是入口，不是新部门。', 'Six backend responsibility groups. Select a service for its flow; MCP/API are entrances, not departments.'), relations: handoffs.map((edge) => edge.id), steps: [] },
  { id: 'research', label: copy('研究迭代', 'Research'), summary: copy('Agent 在冻结边界内提案，服务持久执行，R&D 保留完整实验与决定。', 'Agents propose within frozen bounds; services execute durably and R&D retains complete trials and decisions.'), relations: ['agent-rd', 'agent-data', 'rd-data', 'data-backtest', 'rd-backtest', 'backtest-rd'], steps: [step('主题、来源与预登记', 'Theme, sources and registration', 'owners/rd'), step('Agent 准备或复用数据', 'Agent prepares or reuses data', 'owners/market-data'), step('原生策略版本与封存 Artifact', 'Native strategy version and sealed Artifact', 'owners/rd'), step('原生回测与结果读回', 'Native replay and result readback', 'scenarios/research'), step('诊断、知识与后继或停止', 'Diagnosis, knowledge, successor or stop', 'owners/rd'), step('目标达成，交付结论并停止', 'Reach the goal, deliver conclusions and stop', 'owners/rd')] },
  { id: 'r1', label: copy('R-1 回测', 'R-1 replay'), summary: copy('冻结挂单与分段退出，用原生订单、成本与实际输入顺序验证。', 'Freeze limits and staged exits; verify native orders, costs and actual input chronology.'), relations: ['agent-rd', 'agent-data', 'rd-data', 'data-backtest', 'rd-backtest', 'backtest-rd'], steps: [step('声明挂单、撤单、止损止盈与窗口', 'Declare entries, cancellation, stops, exits and windows', 'owners/rd'), step('准备信号、预热与 fill 输入', 'Prepare signals, warmup and fill inputs', 'owners/market-data'), step('原生撮合与逐笔退出', 'Native matching and per-entry exits', 'owners/backtest'), step('按 1m 执行，记录原生成交假设', 'Execute at 1m and record native fill assumptions', 'scenarios/research'), step('组合报告与实现忠实性对照', 'Portfolio reports and fidelity checks', 'scenarios/research')] },
  { id: 'discovery', label: copy('按需找币', 'Discovery'), summary: copy('Agent 直接查询数据；有状态策略观察复用原生回放，R&D 保存研究引用。', 'Agents query data directly; stateful observation reuses native replay and R&D retains references.'), relations: ['agent-data', 'agent-rd', 'rd-data', 'rd-backtest', 'data-backtest', 'backtest-rd'], steps: [step('Agent 选择查询条件或准确策略版本', 'Agent chooses filters or exact strategy version', 'scenarios/scan'), step('数据查询返回截面、覆盖与缺口', 'Data queries return cuts, coverage and gaps', 'owners/market-data'), step('需状态暖机时复用原生回放', 'Reuse native replay for state and warmup', 'owners/backtest'), step('Agent 解释结果；按需保存研究引用', 'Agent interprets; retain research references as needed', 'owners/rd')] },
  { id: 'trial', label: copy('试盘转正', 'Trial promotion'), summary: copy('成员及适用组合资格有效后用户确认试盘；达到冻结条件且组合证据覆盖时自动转正。', 'User confirms trial after member and composition eligibility; frozen conditions and composition coverage govern promotion.'), relations: ['rd-qualification', 'qualification-backtest', 'qualification-governance', 'dashboard-governance', 'governance-native', 'data-native', 'native-governance'], steps: [step('准确成员版本与共享账户组合资格', 'Exact member versions and shared-account composition eligibility', 'owners/qualification'), step('Dashboard 确认条件模板与两池政策', 'Confirm condition template and two-pool policy', 'owners/strategy-governance'), step('治理授权，Runtime 应用', 'Governance authorizes; Runtime applies', 'owners/runtime'), step('真实试盘、费用与表现计量', 'Real trial, costs and performance measurement', 'owners/portfolio'), step('达标转正；到期未达标下架回 R&D', 'Promote on passing; unload to R&D on expiry without passing', 'owners/strategy-governance')] },
  { id: 'improvement', label: copy('下架改进', 'Improvement'), summary: copy('有效策略也可主动下架；内容 hash 变更后重新走完整生命周期。', 'Valid strategies may be unloaded for improvement; changed content hashes repeat the complete lifecycle.'), relations: ['dashboard-governance', 'governance-native', 'native-governance', 'governance-rd', 'rd-backtest', 'backtest-rd'], steps: [step('用户主动下架，记录真实原因', 'User unloads with the actual reason', 'owners/strategy-governance'), step('停止新入场、撤入场挂单、归还未占用额度', 'Stop new entries, cancel entry orders, return unused allocation', 'owners/strategy-governance'), step('剩余持仓继续原保护，实际风险仍计入', 'Residual positions retain protection and actual exposure', 'owners/execution'), step('记录表现；用户请求后开展改进', 'Record performance; improve on user request', 'owners/rd'), step('新 hash 重新回测并由用户确认试盘', 'New hash requalifies and receives user-confirmed trial', 'scenarios/research')] },
  { id: 'recovery', label: copy('故障恢复', 'Recovery'), summary: copy('未知结果先围栏并按原身份读回；对账完成不会复活旧授权。', 'Fence unknown outcomes and resolve original identities; reconciliation does not revive old authority.'), relations: ['governance-native', 'native-governance'], steps: [step('Runtime/Risk 限制新增风险', 'Runtime/Risk restrict new exposure', 'owners/risk'), step('Execution 回读订单、成交与账户并对账', 'Execution resolves orders, fills and account facts', 'owners/execution'), step('核对当前治理授权与资金边界', 'Check current governance authority and capital bounds', 'owners/strategy-governance'), step('由原生应用与恢复回执证明闭合', 'Native application and recovery receipts prove closure', 'scenarios/recovery')] },
];

export type NodeKind = 'authority' | 'adapter' | 'protected' | 'safety';
export type NodeEmphasis = 'core' | 'standard' | 'support';
export type OwnerBadge = 'SKILL' | 'MCP' | 'EXE';
export type ScenarioRelationRole = 'primary' | 'supporting';

export const moduleActiveInScenario = (
  module: { scenarios: ScenarioId[] },
  scenario: ScenarioId,
) => scenario === 'overview' || module.scenarios.includes(scenario);

export const ownerGroupActiveInScenario = (
  groupId: string,
  role: OwnerNodeData['role'],
  memberGroupIds: string[],
  activeGroupIds: Set<string>,
) => activeGroupIds.has(groupId)
  || (role === 'factory' && memberGroupIds.some((memberGroupId) => activeGroupIds.has(memberGroupId)));

export type ArchitectureNodeData = {
  nodeType: 'architecture';
  title: string;
  owner: string;
  kind: NodeKind;
  emphasis: NodeEmphasis;
  variant?: 'client' | 'strategy' | 'engine' | 'bus' | 'store';
  scenarios: ScenarioId[];
  description: { en: string; zh: string };
  docsRoute: string;
  sourceRole: string;
  objectAuthority: string;
  canonicalInvariantIds: string[];
  displayRole?: 'CHANNEL · NOT AN OWNER';
  eventLines?: string[];
  activeHandles?: string[];
};

export type OwnerNodeData = {
  nodeType: 'owner' | 'boundary';
  label: string;
  count: number;
  tone: 'neutral' | 'cyan' | 'violet' | 'amber';
  badge?: OwnerBadge;
  role: 'authority' | 'shell' | 'channel' | 'factory' | 'stage';
  roleLabel: 'OWNER' | 'BOUNDARY' | 'CHANNEL' | 'VALUE STREAM · NOT AN OWNER' | 'STAGE · RESEARCH';
  docsRoute: string;
  sourceRole: string;
  objectAuthority: string;
  canonicalInvariantIds: string[];
  memberGroupIds: string[];
  activeHandles?: string[];
};

export type DiagramNodeData = ArchitectureNodeData | OwnerNodeData;


// The product blueprint uses the existing workflow renderer and visual primitives.
export const scenarios = productScenarios.map((entry) => ({ ...entry, description: entry.summary, entry: entry.steps[0]?.label ?? entry.label, proof: entry.steps.at(-1)?.label ?? entry.label }));
export const relationVisibleInScenario = (relation: { id: string; scenarios: ScenarioId[]; overview: boolean }, scenario: ScenarioId) => scenario === 'overview' || relation.scenarios.includes(scenario);
export const relationRoleInScenario = (_id: string, _scenario: ScenarioId): 'primary' => 'primary';
type Component = { label: string; description: Copy; route?: string };
const component = (label: string, zh: string, en: string, route?: string): Component => ({ label, description: copy(zh, en), route });
// Internal responsibilities, not new services or deployment units.
export const serviceComponents: Record<ServiceId, Component[]> = {
  'market-data': [
    component('Sources', '来源准入、外部导入与来源依据', 'Source admission, imports and provenance'),
    component('Instruments', '标的语义与点时成员时间线', 'Instrument semantics and point-in-time membership'),
    component('Catalog', '原生存储、覆盖、版本与修订', 'Native storage, coverage, versions and revisions'),
    component('Preparation', '按冻结需求准备、聚合和绑定输入', 'Prepare, aggregate and bind inputs under frozen requirements'),
    component('Streams', '运行策略消费原生实时行情；Agent 按需读取', 'Native live data for running strategies; on-demand reads for agents'),
  ],
  rd: [
    component('Projects', '主题、来源、授权、预算与接管', 'Themes, sources, authority, budget and takeover'),
    component('Authoring', 'Agent 编写原生 Strategy；服务封存内容与环境', 'Agent authored native Strategy; sealed content and environment'),
    component('Experiments', '实验、任务、完整试验台账及 Agent 决定', 'Experiments, jobs, complete trial census and Agent decisions'),
    component('Knowledge', '构件与机制的证据、检索、复用和复核', 'Construct and mechanism evidence, retrieval, reuse and review'),
  ],
  backtest: [
    component('Admission', '冻结请求、工件、输入与执行配置准入', 'Admit frozen requests, artifacts, inputs and execution configuration'),
    component('Replay', 'Nautilus 原生回放、撮合、费用与账户语义', 'Native Nautilus replay, matching, costs and account semantics'),
    component('Results', '任务终态、取消、未知解析与不可变证据', 'Run completion, cancellation, unknown resolution and immutable evidence'),
    component('Reports', '从封存结果生成逐交易报告；Agent 比较实验', 'Trade reports from sealed results; Agents compare experiments'),
  ],
  qualification: [
    component('Intake', '接纳独立选定的准确冻结候选', 'Admit the exact independently selected frozen candidate'),
    component('Protocol', '保护协议、样本隔离与暴露限制', 'Protected protocol, sample isolation and exposure bounds'),
    component('Assessment', '调度隔离回测并核验保护证据', 'Request isolated replay and verify protected evidence'),
    component('Eligibility', '资格、撤销与有界公开结论', 'Eligibility, revocation and bounded public conclusions'),
  ],
  governance: [
    component('Policy', '用户确认、有限条件模板与冻结政策', 'User confirmation, finite condition templates and frozen policies'),
    component('Lifecycle', '阶段、上线、转正、下架与运行授权', 'Stages, activation, promotion, unloading and runtime authority'),
    component('Allocation', '账户两池、逐策略额度与分配事实', 'Account pools, per-strategy limits and allocation facts'),
  ],
  native: [
    component('Runtime', '应用有效授权，运行与停止策略实例', 'Apply current authority, run and stop strategy instances', 'owners/runtime'),
    component('Risk', '资金与风险准入、预留和新增风险围栏', 'Capital and risk admission, reservations and exposure fences', 'owners/risk'),
    component('Execution', '订单、成交、重试、对账与恢复', 'Orders, fills, retries, reconciliation and recovery', 'owners/execution'),
    component('Portfolio', '真实净值、资金占用、暴露与表现', 'Actual NAV, capital use, exposure and performance', 'owners/portfolio'),
  ],
};
const layout: Record<ServiceId, [number, number]> = {
  'market-data': [0, 230], rd: [760, 230], backtest: [1520, 230],
  qualification: [0, 790], governance: [760, 790], native: [1520, 790],
};
export const architectureNodes: Node<DiagramNodeData>[] = services.flatMap((service) => {
  const [x, y] = layout[service.id];
  const groupId = `group-${service.id}`;
  const components = serviceComponents[service.id];
  const serviceScenarios = productScenarios.filter((scenario) => handoffs.some((edge) => scenario.relations.includes(edge.id) && [edge.source, edge.target].includes(service.id))).map((scenario) => scenario.id);
  const group: Node<OwnerNodeData> = {
    id: groupId, type: 'ownerGroup', position: { x, y }, width: 660, height: 360, style: { width: 660, height: 360 },
    data: { nodeType: 'owner', label: service.label, count: components.length, tone: ['rd', 'qualification', 'governance'].includes(service.id) ? 'violet' : 'cyan', badge: ['market-data', 'backtest', 'rd', 'qualification'].includes(service.id) ? 'MCP' : 'EXE', role: 'authority', roleLabel: 'OWNER', docsRoute: service.route, sourceRole: service.id, objectAuthority: service.id, canonicalInvariantIds: [], memberGroupIds: [] },
  };
  const children = components.map((entry, index): Node<ArchitectureNodeData> => ({
    id: `${service.id}-${entry.label.toLowerCase()}`, parentId: groupId, type: 'architectureNode',
    position: { x: 25 + (index % 3) * 210, y: 65 + Math.floor(index / 3) * 95 }, width: 190, height: 65, style: { width: 190, height: 65 },
    data: { nodeType: 'architecture', title: entry.label, owner: service.id, kind: service.id === 'qualification' ? 'protected' : 'authority', emphasis: 'standard', scenarios: serviceScenarios, description: entry.description, docsRoute: entry.route ?? service.route, sourceRole: service.id, objectAuthority: service.id, canonicalInvariantIds: [] },
  }));
  return [group, ...children];
});
architectureNodes.push(...[
  { id: 'agent', title: 'Agent', position: { x: 30, y: 0 }, description: { en: 'Codex / Claude: admitted domain MCPs', zh: 'Codex / Claude：获准的领域 MCP' } },
  { id: 'dashboard', title: 'Dashboard', position: { x: 1790, y: 0 }, description: { en: 'Same domain APIs, user confirmation and readback', zh: '同一套领域 API、用户确认与读回' } },
].map((client): Node<ArchitectureNodeData> => ({ id: client.id, type: 'architectureNode', position: client.position, width: 360, height: 80, style: { width: 360, height: 80 }, data: { nodeType: 'architecture', title: client.title, owner: 'none', kind: 'adapter', emphasis: 'support', variant: 'client', scenarios: productScenarios.filter((story) => handoffs.some((edge) => story.relations.includes(edge.id) && edge.source === client.id)).map((story) => story.id), description: client.description, docsRoute: 'architecture', sourceRole: client.id, objectAuthority: 'none', canonicalInvariantIds: [] } })));
const pinSides: Record<string, [string, string]> = {
  'agent-rd': ['right', 'top'], 'agent-data': ['bottom', 'top'], 'agent-backtest': ['right', 'top'],
  'dashboard-governance': ['left', 'top'], 'dashboard-native': ['right', 'right'],
  'rd-data': ['left', 'right'], 'rd-backtest': ['right', 'left'], 'data-backtest': ['bottom', 'bottom'],
  'backtest-rd': ['left', 'right'], 'rd-qualification': ['bottom', 'top'],
  'qualification-backtest': ['right', 'bottom'], 'qualification-governance': ['right', 'left'],
  'data-native': ['left', 'bottom'], 'governance-native': ['right', 'left'],
  'native-governance': ['top', 'top'], 'governance-rd': ['top', 'bottom'],
};
export const fullArchitectureEdges: Edge[] = handoffs.map((entry) => ({
  id: entry.id, source: entry.source === 'agent' || entry.source === 'dashboard' ? entry.source : `group-${entry.source}`,
  target: `group-${entry.target}`, type: 'architectureEdge', sourceHandle: `out-${pinSides[entry.id][0]}`, targetHandle: `in-${pinSides[entry.id][1]}`,
  markerEnd: { type: MarkerType.ArrowClosed, color: '#2563eb', width: 11, height: 11 },
  data: { scenarios: productScenarios.filter((story) => story.relations.includes(entry.id)).map((story) => story.id), overview: true, relation: 'handoff', relationKind: 'owner', description: entry.label, docsRoute: 'architecture', laneOffset: entry.id === 'backtest-rd' ? 42 : entry.id === 'data-native' ? 80 : 0 },
}));
