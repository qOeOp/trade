import { MarkerType, type Edge, type Node } from '@xyflow/react';
import architectureContract from './architecture-contract.json' with { type: 'json' };

export type ScenarioId = 'overview' | 'research' | 'backtest' | 'scan' | 'paper' | 'live' | 'recovery';
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

type ContractModule = {
  id: string;
  label: string;
  kind: NodeKind;
  emphasis: NodeEmphasis;
  scenarios: ScenarioId[];
  description: { en: string; zh: string };
};

type ContractGroup = {
  id: string;
  groupId: string;
  label: string;
  badge?: OwnerBadge;
  role?: OwnerNodeData['role'];
  authorityOwnerId?: string;
  memberGroupIds?: string[];
  docsRoute: string;
  modules: ContractModule[];
};

const groupSemanticIdentity = (current: ContractGroup) => {
  const role = current.role ?? 'authority';
  if (role === 'authority') {
    return { sourceRole: current.id, objectAuthority: current.id };
  }
  if (role === 'stage') {
    return { sourceRole: `${current.id}-stage`, objectAuthority: current.authorityOwnerId ?? 'none' };
  }
  if (role === 'factory') {
    return { sourceRole: `${current.id}-value-stream`, objectAuthority: 'none' };
  }
  if (role === 'channel') {
    return { sourceRole: `${current.id}-custodian`, objectAuthority: 'none' };
  }
  return { sourceRole: current.id, objectAuthority: current.id };
};

type RecoveryTriggerBranch = {
  id: string;
  applicability: string;
  admissionDispositionObjectId?: string;
  caseCreationRule?: string;
  forbiddenEvidenceAssumptions: string[];
  primaryRelationIds: string[];
  supportingRelationIds: string[];
};

type ContractScenario = (typeof architectureContract.scenarios)[number] & {
  primaryRelationIds: string[];
  supportingRelationIds: string[];
  triggerBranchSelectionRule?: string;
  triggerBranches?: RecoveryTriggerBranch[];
};

export const scenarios = (architectureContract.scenarios as ContractScenario[]).map((scenario) => ({
  id: scenario.id as ScenarioId,
  label: scenario.label,
  description: scenario.description,
  entry: scenario.entry,
  proof: scenario.proof,
  primaryRelationIds: scenario.primaryRelationIds,
  supportingRelationIds: scenario.supportingRelationIds,
  triggerBranchSelectionRule: scenario.triggerBranchSelectionRule ?? null,
  triggerBranches: scenario.triggerBranches ?? [],
}));

const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

export const relationVisibleInScenario = (
  relation: { id: string; scenarios: ScenarioId[]; overview: boolean },
  scenario: ScenarioId,
) => {
  const projection = scenarioById.get(scenario);
  if (!projection) throw new Error(`Unknown architecture scenario: ${scenario}`);
  return projection.primaryRelationIds.includes(relation.id)
    || projection.supportingRelationIds.includes(relation.id);
};

export const relationRoleInScenario = (
  relationId: string,
  scenario: ScenarioId,
): ScenarioRelationRole => {
  const projection = scenarioById.get(scenario);
  if (!projection) throw new Error(`Unknown architecture scenario: ${scenario}`);
  if (projection.primaryRelationIds.includes(relationId)) return 'primary';
  if (projection.supportingRelationIds.includes(relationId)) return 'supporting';
  throw new Error(`Relation is not projected in scenario: ${scenario}:${relationId}`);
};

const architectureDetailsMutable = new Map<string, ArchitectureNodeData>();
const contractGroups = [
  ...architectureContract.authorityOwners,
  ...architectureContract.boundaries,
] as ContractGroup[];
const authorityLabelById = new Map(architectureContract.authorityOwners.map((owner) => [owner.id, owner.label]));
const authorityLocalInvariants = architectureContract.developmentChunkContract.authorityLocalInvariants;
const invariantIdsBySurface = new Map<string, string[]>();
const surfaceDocsRouteById = new Map([
  ...contractGroups.map((surface) => [surface.id, surface.docsRoute] as const),
  ...architectureContract.channels.map((surface) => [surface.id, surface.docsRoute] as const),
]);
const scenarioDocsRouteById = new Map(architectureContract.scenarios.map((scenario) => [scenario.id, scenario.docsRoute]));
for (const invariant of authorityLocalInvariants) {
  const surfaceId = 'authorityId' in invariant ? invariant.authorityId : invariant.custodianId;
  if (!surfaceId) throw new Error(`Authority-local invariant has no authority or custodian: ${invariant.id}`);
  if (typeof invariant.docsRoute !== 'string' || invariant.docsRoute.length === 0) {
    throw new Error(`Authority-local invariant has no canonical docs route: ${invariant.id}`);
  }
  if (
    surfaceDocsRouteById.get(surfaceId) !== invariant.docsRoute
    && scenarioDocsRouteById.get(invariant.scenarioId) !== invariant.docsRoute
  ) {
    throw new Error(`Authority-local invariant docs route diverges from its surface: ${invariant.id}`);
  }
  const ids = invariantIdsBySurface.get(surfaceId) ?? [];
  ids.push(invariant.id);
  invariantIdsBySurface.set(surfaceId, ids);
}

for (const currentGroup of contractGroups) {
  const ownerLabel = currentGroup.authorityOwnerId
    ? authorityLabelById.get(currentGroup.authorityOwnerId)
    : currentGroup.label;
  if (!ownerLabel) throw new Error(`Unknown authority owner for boundary: ${currentGroup.id}`);
  const semanticIdentity = groupSemanticIdentity(currentGroup);
  for (const current of currentGroup.modules) {
    const zhLines = current.description.zh.split('\n');
    if (
      current.description.zh.length < 12
      || current.description.zh.length > 150
      || zhLines.length > 3
      || zhLines.some((line) => line.length > 50)
    ) {
      throw new Error(`Chinese node description must contain 12-150 characters across at most three 50-character lines: ${current.id}`);
    }
    architectureDetailsMutable.set(current.id, {
      nodeType: 'architecture',
      title: current.label,
      owner: ownerLabel,
      kind: current.kind,
      emphasis: current.emphasis,
      scenarios: current.scenarios,
      description: current.description,
      docsRoute: currentGroup.docsRoute,
      ...semanticIdentity,
      canonicalInvariantIds: [...(invariantIdsBySurface.get(currentGroup.id) ?? [])],
    });
  }
}

for (const channel of architectureContract.channels) {
  architectureDetailsMutable.set(channel.id, {
    nodeType: 'architecture',
    title: channel.label,
    owner: 'CHANNEL',
    kind: channel.kind as NodeKind,
    emphasis: channel.emphasis as NodeEmphasis,
    variant: 'bus',
    scenarios: channel.scenarios as ScenarioId[],
    description: channel.description,
    docsRoute: channel.docsRoute,
    sourceRole: `${channel.id}-custodian`,
    objectAuthority: channel.id,
    canonicalInvariantIds: [...(invariantIdsBySurface.get(channel.id) ?? [])],
    displayRole: 'CHANNEL · NOT AN OWNER',
    eventLines: channel.eventLines,
  });
}

export const architectureDetails = architectureDetailsMutable;

type FullPlacement = {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  variant: NonNullable<ArchitectureNodeData['variant']>;
};

const place = (id: string, x: number, y: number, width: number, height: number, variant: FullPlacement['variant']): FullPlacement => ({
  id,
  position: { x, y },
  width,
  height,
  variant,
});
const fullPlacements: FullPlacement[] = [
  place('workspace', 50, 25, 210, 52, 'client'),
  place('agent-shell', 50, 92, 210, 52, 'client'),

  place('strategy-registry', 348, 45, 145, 68, 'engine'),
  place('lifecycle', 503, 45, 145, 68, 'engine'),
  place('capital-tier', 658, 45, 145, 68, 'strategy'),

  place('portfolio', 891, 25, 235, 52, 'engine'),
  place('exposure', 1141, 25, 230, 52, 'engine'),
  place('performance', 891, 92, 235, 52, 'engine'),
  place('capacity', 1141, 92, 230, 52, 'client'),

  place('telemetry-gateway', 1451, 30, 267, 52, 'client'),
  place('status-projection', 1728, 30, 267, 52, 'store'),
  place('alert-routing', 1451, 94, 267, 52, 'client'),
  place('dashboard-api', 1728, 94, 267, 52, 'client'),

  place('data-clients', 50, 325, 140, 65, 'client'),
  place('data-engine', 205, 325, 135, 65, 'engine'),
  place('pit-catalog', 50, 410, 140, 65, 'engine'),
  place('instrument-master', 205, 410, 135, 65, 'engine'),

  place('source-intake', 428, 325, 330, 65, 'client'),
  place('research-intent', 428, 410, 330, 65, 'engine'),

  place('artifact', 846, 325, 330, 65, 'engine'),
  place('code-sandbox', 846, 410, 330, 65, 'strategy'),

  place('native-replay', 1264, 325, 270, 65, 'engine'),
  place('sim-exchange', 1264, 410, 128, 65, 'client'),
  place('run-result', 1406, 410, 128, 65, 'engine'),

  place('candidate', 1622, 325, 145, 65, 'strategy'),
  place('protected-test', 1782, 325, 165, 65, 'strategy'),
  place('eligibility', 1622, 410, 325, 65, 'engine'),

  place('event-rail', 408, 594, 1146, 104, 'bus'),

  place('strategy-loader', 50, 815, 190, 58, 'client'),
  place('market-snapshot', 255, 815, 195, 58, 'store'),
  place('strategy-matcher', 50, 895, 190, 52, 'engine'),
  place('proposal-builder', 255, 895, 195, 52, 'store'),

  place('native-strategy', 538, 815, 390, 58, 'engine'),
  place('runtime-readiness', 538, 895, 390, 52, 'strategy'),

  place('headroom', 1016, 895, 360, 52, 'client'),
  place('risk-engine', 1206, 815, 170, 58, 'engine'),
  place('kill-switch', 1016, 815, 175, 58, 'strategy'),

  place('effect-record', 1464, 815, 142, 58, 'strategy'),
  place('order-engine', 1619, 815, 145, 58, 'engine'),
  place('trade-clients', 1779, 815, 150, 58, 'client'),
  place('reconcile', 1464, 895, 460, 52, 'store'),
];

const group = (
  id: string,
  label: string,
  badge: OwnerBadge | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  tone: OwnerNodeData['tone'] = 'neutral',
  role: OwnerNodeData['role'] = 'authority',
  docsRoute: string,
  sourceRole: string,
  objectAuthority: string,
  moduleCount: number,
  canonicalInvariantIds: string[],
  memberGroupIds: string[],
): Node<OwnerNodeData> => ({
  id,
  type: 'ownerGroup',
  position: { x, y },
  data: {
    nodeType: role === 'authority' ? 'owner' : 'boundary',
    label,
    count: moduleCount,
    tone,
    badge,
    role,
    roleLabel: role === 'authority'
      ? 'OWNER'
      : role === 'stage'
        ? 'STAGE · RESEARCH'
        : role === 'factory'
          ? 'VALUE STREAM · NOT AN OWNER'
          : role === 'channel'
            ? 'CHANNEL'
            : 'BOUNDARY',
    docsRoute,
    sourceRole,
    objectAuthority,
    canonicalInvariantIds,
    memberGroupIds,
  },
  width,
  height,
  style: { width, height },
  selectable: true,
  draggable: false,
  zIndex: role === 'factory' ? 1 : 3,
});

type GroupLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  tone: OwnerNodeData['tone'];
};

const groupLayouts = new Map<string, GroupLayout>([
  ['group-factory', { x: 388, y: 250, width: 1600, height: 290, tone: 'violet' }],
  ['group-product', { x: 30, y: -10, width: 250, height: 170, tone: 'neutral' }],
  ['group-governance', { x: 328, y: -10, width: 495, height: 170, tone: 'violet' }],
  ['group-portfolio', { x: 871, y: -10, width: 520, height: 170, tone: 'cyan' }],
  ['group-observability', { x: 1439, y: -10, width: 569, height: 170, tone: 'neutral' }],
  ['group-data', { x: 30, y: 280, width: 330, height: 240, tone: 'cyan' }],
  ['group-rd', { x: 408, y: 280, width: 788, height: 240, tone: 'violet' }],
  ['group-backtest', { x: 1244, y: 280, width: 310, height: 240, tone: 'cyan' }],
  ['group-qualification', { x: 1602, y: 280, width: 365, height: 240, tone: 'violet' }],
  ['group-program', { x: 30, y: 770, width: 440, height: 215, tone: 'violet' }],
  ['group-runtime', { x: 518, y: 770, width: 430, height: 215, tone: 'cyan' }],
  ['group-risk', { x: 996, y: 770, width: 400, height: 215, tone: 'amber' }],
  ['group-execution', { x: 1444, y: 770, width: 500, height: 215, tone: 'amber' }],
]);

type Rect = Pick<GroupLayout, 'x' | 'y' | 'width' | 'height'>;

const containsRect = (outer: Rect, inner: Rect, minimumPadding: number) => (
  inner.x - outer.x >= minimumPadding
  && inner.y - outer.y >= minimumPadding
  && outer.x + outer.width - (inner.x + inner.width) >= minimumPadding
  && outer.y + outer.height - (inner.y + inner.height) >= minimumPadding
);

const overlapsRect = (a: Rect, b: Rect) => (
  a.x < b.x + b.width
  && a.x + a.width > b.x
  && a.y < b.y + b.height
  && a.y + a.height > b.y
);

const factoryBoundaries = contractGroups.filter((current) => current.role === 'factory');
if (factoryBoundaries.length !== 1) throw new Error('Architecture must declare exactly one Strategy Factory');
const [factoryBoundary] = factoryBoundaries;
if (!factoryBoundary?.memberGroupIds?.length) {
  throw new Error('Strategy Factory must declare memberGroupIds');
}
const factoryLayout = groupLayouts.get(factoryBoundary.groupId);
if (!factoryLayout) throw new Error('Missing Strategy Factory visual layout');
const declaredFactoryMembers = new Set(factoryBoundary.memberGroupIds);
if (declaredFactoryMembers.size !== factoryBoundary.memberGroupIds.length) {
  throw new Error('Strategy Factory memberGroupIds must be unique');
}
const geometricFactoryMembers = new Set<string>();
for (const [groupId, layout] of groupLayouts) {
  if (groupId === factoryBoundary.groupId) continue;
  if (containsRect(factoryLayout, layout, 16)) geometricFactoryMembers.add(groupId);
  if (overlapsRect(factoryLayout, layout) && !declaredFactoryMembers.has(groupId)) {
    throw new Error(`Non-member overlaps Strategy Factory: ${groupId}`);
  }
}
if (
  geometricFactoryMembers.size !== declaredFactoryMembers.size
  || [...geometricFactoryMembers].some((groupId) => !declaredFactoryMembers.has(groupId))
) {
  throw new Error('Strategy Factory geometry diverges from memberGroupIds');
}

const fullGroups: Node<OwnerNodeData>[] = contractGroups.map((current) => {
  const layout = groupLayouts.get(current.groupId);
  if (!layout) throw new Error(`Missing visual layout for architecture group: ${current.groupId}`);
  const role = current.role ?? 'authority';
  const semanticIdentity = groupSemanticIdentity(current);
  return group(
    current.groupId,
    current.label,
    current.badge,
    layout.x,
    layout.y,
    layout.width,
    layout.height,
    layout.tone,
    role,
    current.docsRoute,
    semanticIdentity.sourceRole,
    semanticIdentity.objectAuthority,
    current.modules.length,
    [...(invariantIdsBySurface.get(current.id) ?? [])],
    [...(current.memberGroupIds ?? [])],
  );
});

const parentByNode = new Map<string, string>(contractGroups.flatMap((current) => (
  current.modules.map((module) => [module.id, current.groupId] as const)
)));
const groupById = new Map(fullGroups.map((node) => [node.id, node]));

const fullItemNodes = fullPlacements.map<Node<ArchitectureNodeData>>((placement) => {
  const data = architectureDetails.get(placement.id);
  if (!data) throw new Error(`Unknown full architecture node: ${placement.id}`);
  const parentId = parentByNode.get(placement.id);
  const parent = parentId ? groupById.get(parentId) : undefined;
  return {
    id: placement.id,
    type: 'architectureNode',
    position: parent ? {
      x: placement.position.x - parent.position.x,
      y: placement.position.y - parent.position.y,
    } : placement.position,
    parentId,
    extent: parent ? 'parent' : undefined,
    data: { ...data, variant: placement.variant },
    width: placement.width,
    height: placement.height,
    style: { width: placement.width, height: placement.height },
    draggable: false,
    zIndex: 4,
  };
});

type RelationKind = 'request' | 'proposal' | 'policy' | 'intent' | 'command' | 'handoff' | 'fact' | 'effect' | 'event' | 'read-model';
type EdgeWeight = 'standard' | 'light';

const edgeVisuals = new Map<string, { sourceHandle: string; targetHandle: string; laneOffset?: number }>([
  ['product-rd', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['rd-product-request-receipt', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['product-governance', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['governance-product-lifecycle-receipt', { sourceHandle: 'source-left', targetHandle: 'target-right' }],
  ['rd-product', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['governance-product', { sourceHandle: 'source-left', targetHandle: 'target-right' }],
  ['backtest-product', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['qualification-product-intake-receipt', { sourceHandle: 'source-top', targetHandle: 'target-bottom', laneOffset: -24 }],
  ['qualification-product', { sourceHandle: 'source-top', targetHandle: 'target-bottom', laneOffset: -8 }],
  ['program-product', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['execution-product', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['data-rd', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['data-rd-successor-feedback', { sourceHandle: 'source-right', targetHandle: 'target-left', laneOffset: 24 }],
  ['rd-data-snapshot-request', { sourceHandle: 'source-left', targetHandle: 'target-right', laneOffset: -16 }],
  ['rd-data-repair', { sourceHandle: 'source-left', targetHandle: 'target-right', laneOffset: 16 }],
  ['product-qualification', { sourceHandle: 'source-bottom', targetHandle: 'target-top', laneOffset: 8 }],
  ['qualification-backtest', { sourceHandle: 'source-left', targetHandle: 'target-right' }],
  ['data-backtest', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['backtest-qualification', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['qualification-governance', { sourceHandle: 'source-top', targetHandle: 'target-bottom', laneOffset: 24 }],
  ['portfolio-governance', { sourceHandle: 'source-left', targetHandle: 'target-right' }],
  ['portfolio-governance-capacity-scope', { sourceHandle: 'source-left', targetHandle: 'target-right', laneOffset: 16 }],
  ['portfolio-governance-interaction', { sourceHandle: 'source-left', targetHandle: 'target-right', laneOffset: -16 }],
  ['data-program', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['governance-program', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['program-governance', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['governance-runtime', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['runtime-governance-application', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['runtime-product-application', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['governance-risk', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['portfolio-program', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['data-runtime', { sourceHandle: 'source-bottom', targetHandle: 'target-left' }],
  ['data-portfolio', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['portfolio-risk', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['runtime-risk', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['risk-runtime', { sourceHandle: 'source-left', targetHandle: 'target-right' }],
  ['runtime-execution', { sourceHandle: 'source-top', targetHandle: 'target-top' }],
  ['execution-risk', { sourceHandle: 'source-left', targetHandle: 'target-right' }],
  ['execution-risk-recovery', { sourceHandle: 'source-left', targetHandle: 'target-right' }],
  ['risk-execution-claim', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['runtime-risk-fence', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['runtime-risk-incident-fence', { sourceHandle: 'source-bottom', targetHandle: 'target-top', laneOffset: -20 }],
  ['execution-risk-drift-fence', { sourceHandle: 'source-left', targetHandle: 'target-right', laneOffset: 20 }],
  ['risk-execution-fence', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['risk-execution-recovery-facts', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['runtime-execution-readiness', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['runtime-execution-incident', { sourceHandle: 'source-right', targetHandle: 'target-left', laneOffset: 16 }],
  ['portfolio-execution-closure', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['execution-governance-closed', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['execution-governance-adapter-binding', { sourceHandle: 'source-top', targetHandle: 'target-bottom', laneOffset: 32 }],
  ['execution-portfolio', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['execution-runtime', { sourceHandle: 'source-top', targetHandle: 'target-top' }],
  ['runtime-governance-incident', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['runtime-rd-successor-feedback', { sourceHandle: 'source-top', targetHandle: 'target-bottom', laneOffset: -24 }],
  ['runtime-rd-kernel-repair', { sourceHandle: 'source-top', targetHandle: 'target-bottom', laneOffset: 24 }],
  ['rd-runtime-native-repair-request', { sourceHandle: 'source-bottom', targetHandle: 'target-top', laneOffset: -24 }],
  ['execution-governance-drift', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['portfolio-product', { sourceHandle: 'source-top', targetHandle: 'target-top' }],
  ['portfolio-rd-successor-feedback', { sourceHandle: 'source-bottom', targetHandle: 'target-top', laneOffset: -16 }],
  ['execution-rd-successor-feedback', { sourceHandle: 'source-top', targetHandle: 'target-bottom', laneOffset: 16 }],
  ['runtime-events', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['execution-events', { sourceHandle: 'source-top', targetHandle: 'target-right' }],
  ['qualification-events', { sourceHandle: 'source-bottom', targetHandle: 'target-top' }],
  ['events-governance', { sourceHandle: 'source-top', targetHandle: 'target-bottom' }],
  ['events-observability', { sourceHandle: 'source-right', targetHandle: 'target-bottom' }],
  ['observability-product-status', { sourceHandle: 'source-left', targetHandle: 'target-right', laneOffset: -24 }],
  ['rd-backtest-artifact', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['backtest-rd-simulator-repair', { sourceHandle: 'source-left', targetHandle: 'target-right', laneOffset: 24 }],
  ['rd-backtest-native-repair-request', { sourceHandle: 'source-right', targetHandle: 'target-left', laneOffset: -24 }],
  ['rd-backtest-request', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
  ['backtest-rd', { sourceHandle: 'source-left', targetHandle: 'target-right' }],
  ['rd-qualification', { sourceHandle: 'source-right', targetHandle: 'target-left' }],
]);

export const architectureNodes: Node<DiagramNodeData>[] = [...fullGroups, ...fullItemNodes];
const architectureObjectCustody = new Map(
  architectureContract.architectureObjects.map((current) => [current.id, {
    authorityId: 'authorityId' in current ? current.authorityId : undefined,
    custodianId: 'custodianId' in current ? current.custodianId : undefined,
  }]),
);
export const fullArchitectureEdges: Edge[] = architectureContract.relations.map((contract) => {
  const visual = edgeVisuals.get(contract.id);
  if (!visual) throw new Error(`Missing visual route for architecture relation: ${contract.id}`);
  const custody = architectureObjectCustody.get(contract.objectId);
  if (!custody || Boolean(custody.authorityId) === Boolean(custody.custodianId) || !contract.docsRoute) {
    throw new Error(`Incomplete canonical binding for architecture relation: ${contract.id}`);
  }
  if (contract.description.zh.length > 50 || contract.description.zh.includes('\n')) {
    throw new Error(`Chinese edge description must be one line of at most 50 characters: ${contract.id}`);
  }
  const businessOutcomeOwnerId = 'businessOutcomeOwnerId' in contract && typeof contract.businessOutcomeOwnerId === 'string'
    ? contract.businessOutcomeOwnerId
    : undefined;
  const noBusinessOutcomeBasis = 'noBusinessOutcomeBasis' in contract && typeof contract.noBusinessOutcomeBasis === 'string'
    ? contract.noBusinessOutcomeBasis
    : undefined;
  if (Boolean(businessOutcomeOwnerId) === Boolean(noBusinessOutcomeBasis)) {
    throw new Error(`Architecture relation must declare one business outcome binding: ${contract.id}`);
  }
  const stage = contract.class === 'stage';
  return {
    id: contract.id,
    source: contract.sourceId,
    target: contract.targetId,
    sourceHandle: visual.sourceHandle,
    targetHandle: visual.targetHandle,
    type: 'architectureEdge',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: stage ? '#8b5cf6' : '#2563eb',
      width: stage ? 10 : 11,
      height: stage ? 10 : 11,
    },
    data: {
      relationKind: contract.class,
      relation: contract.relation as RelationKind,
      scenarios: contract.scenarios as ScenarioId[],
      overview: contract.overview,
      weight: contract.weight as EdgeWeight,
      description: contract.description,
      laneOffset: visual.laneOffset,
      authorityId: custody.authorityId,
      custodianId: custody.custodianId,
      objectId: contract.objectId,
      contractId: contract.id,
      docsRoute: contract.docsRoute,
      sourceRole: contract.sourceRole,
      objectAuthority: contract.objectAuthority,
      businessOutcomeOwnerId,
      noBusinessOutcomeBasis,
    },
    zIndex: stage ? 2 : undefined,
  };
});

const relationIds = new Set(fullArchitectureEdges.map((edge) => edge.id));
for (const scenario of scenarios) {
  const primaryIds = new Set(scenario.primaryRelationIds);
  const supportingIds = new Set(scenario.supportingRelationIds);
  if (primaryIds.size !== scenario.primaryRelationIds.length) {
    throw new Error(`Scenario primaryRelationIds must be unique: ${scenario.id}`);
  }
  if (supportingIds.size !== scenario.supportingRelationIds.length) {
    throw new Error(`Scenario supportingRelationIds must be unique: ${scenario.id}`);
  }
  if ([...primaryIds].some((relationId) => supportingIds.has(relationId))) {
    throw new Error(`Scenario primary and supporting relations must be disjoint: ${scenario.id}`);
  }
  const declaredIds = new Set([...primaryIds, ...supportingIds]);
  const metadataVisibleIds = new Set(fullArchitectureEdges.filter((relation) => {
    const visibility = relation.data as { scenarios?: ScenarioId[]; overview?: boolean } | undefined;
    return scenario.id === 'overview'
      ? visibility?.overview === true
      : visibility?.scenarios?.includes(scenario.id) === true;
  }).map((relation) => relation.id));
  if (
    declaredIds.size !== metadataVisibleIds.size
    || [...declaredIds].some((relationId) => !metadataVisibleIds.has(relationId))
  ) {
    throw new Error(`Scenario primary and supporting relations must completely partition visibility: ${scenario.id}`);
  }
  for (const relationId of declaredIds) {
    const relation = fullArchitectureEdges.find((edge) => edge.id === relationId);
    if (!relation || !relationIds.has(relationId)) {
      throw new Error(`Scenario references an unknown relation: ${scenario.id}:${relationId}`);
    }
    const visibility = relation.data as { scenarios?: ScenarioId[]; overview?: boolean } | undefined;
    if (!visibility?.scenarios || typeof visibility.overview !== 'boolean') {
      throw new Error(`Scenario relation lacks visibility metadata: ${scenario.id}:${relationId}`);
    }
  }
}

for (let index = 0; index < fullGroups.length; index += 1) {
  const a = fullGroups[index];
  if (a.data.role === 'factory') continue;
  const aWidth = Number(a.style?.width ?? 0);
  const aHeight = Number(a.style?.height ?? 0);
  for (const b of fullGroups.slice(index + 1)) {
    if (b.data.role === 'factory') continue;
    const bWidth = Number(b.style?.width ?? 0);
    const bHeight = Number(b.style?.height ?? 0);
    const sharesBand = a.position.y < b.position.y + bHeight
      && a.position.y + aHeight > b.position.y;
    if (!sharesBand) continue;
    const horizontalGap = a.position.x <= b.position.x
      ? b.position.x - (a.position.x + aWidth)
      : a.position.x - (b.position.x + bWidth);
    if (horizontalGap < 48) throw new Error(`Owner gap below 48px: ${a.id}, ${b.id}`);
  }
}

const fullIds = new Set(architectureNodes.map((node) => node.id));
for (const current of fullArchitectureEdges) {
  if (!fullIds.has(current.source) || !fullIds.has(current.target)) {
    throw new Error(`Dangling full architecture edge: ${current.id}`);
  }
}
for (let index = 0; index < fullPlacements.length; index += 1) {
  const a = fullPlacements[index];
  for (const b of fullPlacements.slice(index + 1)) {
    const overlaps = a.position.x < b.position.x + b.width
      && a.position.x + a.width > b.position.x
      && a.position.y < b.position.y + b.height
      && a.position.y + a.height > b.position.y;
    if (overlaps) throw new Error(`Overlapping full architecture nodes: ${a.id}, ${b.id}`);
  }
}
