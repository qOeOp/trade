import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PUBLISHED_DOC_ROOTS } from './lib/publication-contract.mjs';
import {
  materializeCanonicalDevelopmentChunkRecord,
  materializeCanonicalInvariantDevelopmentChunkRecord,
  resolveEffectiveRelationSemantics,
} from './lib/development-chunk-record.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(siteRoot, '..');
const sourceRoot = join(repositoryRoot, 'docs');
const targetRoot = join(siteRoot, 'content', 'docs');
const sourceIcon = join(repositoryRoot, 'icon.svg');
const targetIcon = join(siteRoot, 'public', 'icon.svg');
const targetDarkIcon = join(siteRoot, 'public', 'icon-dark.svg');
const productSections = [...PUBLISHED_DOC_ROOTS];
const architectureContract = JSON.parse(
  await readFile(join(siteRoot, 'lib', 'architecture-contract.json'), 'utf8'),
);

async function findJupytextPages(directory) {
  const pages = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...(await findJupytextPages(path)));
    } else if (entry.name.endsWith('.py')) {
      const source = await readFile(path, 'utf8');
      if (source.startsWith('# %%')) pages.push(path);
    }
  }

  return pages.sort();
}

async function findMarkdownPages(directory) {
  const pages = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...(await findMarkdownPages(path)));
    } else if (entry.name.endsWith('.md')) {
      pages.push(path);
    }
  }

  return pages.sort();
}

function titleFromHeading(heading) {
  return heading
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

const surfaces = [
  ...architectureContract.authorityOwners,
  ...architectureContract.boundaries,
  ...architectureContract.channels,
];
const architectureObjects = new Map(
  architectureContract.architectureObjects.map((object) => [object.id, object]),
);

function canonicalRouteFromPage(path) {
  return relative(targetRoot, path)
    .replace(/\.zh\.mdx?$/, '')
    .replace(/\.mdx?$/, '')
    .split('\\').join('/');
}

function localized(value, locale) {
  if (typeof value === 'string') return value;
  return value?.[locale] ?? value?.en ?? '';
}

function inlineList(values) {
  return values?.length ? values.map((value) => `\`${value}\``).join(', ') : 'none';
}

const branchNames = ['accepted', 'rejected', 'unknown', 'replay'];
const recoveryTriggerBranchBaseFields = [
  'id',
  'applicability',
  'forbiddenEvidenceAssumptions',
  'primaryRelationIds',
  'supportingRelationIds',
];
const recoveryTriggerBranchOptionalFields = ['sourceObjectId', 'admissionDispositionObjectId', 'caseCreationRule'];
const recoveryAdmissionSourceBranches = Object.freeze({
  RUNTIME_INCIDENT: Object.freeze({
    sourceObjectId: 'runtime-incident-fact',
    sourceRelationIds: Object.freeze(['runtime-risk-incident-fence', 'runtime-execution-incident']),
    primaryRelationIds: Object.freeze(['runtime-risk-incident-fence', 'runtime-execution-incident', 'risk-execution-fence']),
  }),
  RECONCILIATION_DRIFT: Object.freeze({
    sourceObjectId: 'reconciliation-drift-fact',
    sourceRelationIds: Object.freeze(['execution-risk-drift-fence']),
    primaryRelationIds: Object.freeze(['execution-risk-drift-fence', 'risk-execution-fence']),
  }),
});
const authorityLocalInvariants = architectureContract.developmentChunkContract.authorityLocalInvariants;
const projectionContract = architectureContract.documentationProjection;

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Canonical projection requires nonempty ${field}`);
  }
  return value;
}

function nonEmptyArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Canonical projection requires nonempty ${field}`);
  }
  return value;
}

function assertOnlyProjectedFields(record, allowedFields, context, syntheticFields = []) {
  const allowed = new Set([...allowedFields, ...syntheticFields]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Canonical projection has unregistered fields for ${context}: ${unknown.sort().join(', ')}`);
  }
}

function projectedRecord(record, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(record, field)).map((field) => [field, record[field]]));
}

function surfaceRole(surface) {
  if (architectureContract.authorityOwners.some((owner) => owner.id === surface.id)) return 'OWNER';
  if (architectureContract.channels.some((channel) => channel.id === surface.id)) return 'CHANNEL';
  if (surface.role === 'channel') return 'CHANNEL';
  if (surface.role === 'factory') return 'VALUE STREAM · NOT AN OWNER';
  if (surface.role === 'stage') return 'STAGE · RESEARCH';
  return 'BOUNDARY';
}

function projectionValue(value) {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return inlineList(value);
  return `\`${JSON.stringify(value)}\``;
}

function objectFacetLabel(key, text) {
  if (key === 'identityBinds') return text.identity;
  if (key === 'states') return text.states;
  if (key === 'invariants') return text.invariants;
  if (/bind|equality|ref/i.test(key)) return text.crossBindings;
  if (/transition|precedence|priority|operation|requirement|rule|chain/i.test(key)) return text.transitions;
  if (/state|disposition|kind|category|mode|dimension|condition|outcome|variant|class|type/i.test(key)) return text.stateFamilies;
  return text.contractFacets;
}

export function validateCanonicalProjectionContract(contract) {
  const allSurfaces = [...contract.authorityOwners, ...contract.boundaries, ...contract.channels];
  const surfaceById = new Map();
  for (const surface of allSurfaces) {
    nonEmptyString(surface.id, 'surface.id');
    nonEmptyString(surface.label, `${surface.id}.label`);
    nonEmptyString(surface.docsRoute, `${surface.id}.docsRoute`);
    if (surfaceById.has(surface.id)) throw new Error(`Duplicate canonical surface id: ${surface.id}`);
    surfaceById.set(surface.id, surface);
    const surfaceKind = contract.authorityOwners.includes(surface)
      ? 'authorityOwner'
      : contract.channels.includes(surface) ? 'channel' : 'boundary';
    assertOnlyProjectedFields(
      surface,
      contract.documentationProjection.surfaceProjectionFields[surfaceKind],
      `${surfaceKind}:${surface.id}`,
    );
    const modules = surface.modules ?? [];
    if (contract.boundaries.some((boundary) => boundary.id === surface.id)
      && !['shell', 'channel', 'factory', 'stage'].includes(surface.role)) {
      throw new Error(`Unknown canonical boundary role: ${surface.id}:${surface.role}`);
    }
    if (modules.length > contract.limits.maxModulesPerGroup) {
      throw new Error(`Surface exceeds canonical module ceiling: ${surface.id}`);
    }
    for (const module of modules) {
      nonEmptyString(module.id, `${surface.id}.module.id`);
      nonEmptyString(module.label, `${surface.id}.${module.id}.label`);
      assertOnlyProjectedFields(
        module,
        contract.documentationProjection.moduleProjectionFields,
        `module:${surface.id}:${module.id}`,
      );
    }
  }

  for (const object of contract.architectureObjects) {
    nonEmptyString(object.id, 'architectureObject.id');
    nonEmptyString(object.label, `${object.id}.label`);
    if (Boolean(object.authorityId) === Boolean(object.custodianId)) {
      throw new Error(`Architecture object must declare exactly one authority or custodian: ${object.id}`);
    }
    const objectAuthority = object.authorityId ?? object.custodianId;
    if (!surfaceById.has(objectAuthority)) {
      throw new Error(`Architecture object references unknown authority or custodian: ${object.id}:${objectAuthority}`);
    }
    nonEmptyArray(object.identityBinds, `${object.id}.identityBinds`);
    nonEmptyArray(object.invariants, `${object.id}.invariants`);
    assertOnlyProjectedFields(
      object,
      contract.documentationProjection.objectProjectionFields,
      `architecture-object:${object.id}`,
    );
    if (object.id === 'protected-run-result') {
      const setContract = object.diagnosticSetContract;
      assertOnlyProjectedFields(setContract, [
        'membershipRule',
        'noExecutionDefectRule',
        'unresolvedRule',
        'setValidationBeforeDispositionRule',
        'qualificationPrecedence',
        'missingDuplicateUnknownOrContradictoryDisposition',
      ], 'protected-run-result.diagnosticSetContract');
      if (!/first validates.*finite non-empty duplicate-free subset/i.test(setContract.setValidationBeforeDispositionRule)
        || !/empty duplicate unknown NO_EXECUTION_DEFECT-mixed or UNRESOLVED_FAILURE-mixed.*DIAGNOSTIC_UNRESOLVED/i.test(setContract.setValidationBeforeDispositionRule)) {
        throw new Error('Protected diagnostic set must validate structure before category disposition');
      }
      if (!/structurally valid set only/i.test(setContract.qualificationPrecedence)) {
        throw new Error('Protected diagnostic precedence must apply only after set validation');
      }
      const expectedDisposition = {
        NO_EXECUTION_DEFECT: 'ROBUSTNESS_ASSESSMENT_ALLOWED',
        MARKET_DATA: 'DIAGNOSTIC_INVALID',
        ARTIFACT: 'DIAGNOSTIC_INVALID',
        RUNTIME_KERNEL: 'DIAGNOSTIC_INVALID',
        BACKTEST_OPERATIONAL: 'DIAGNOSTIC_INVALID',
        SIMULATOR: 'DIAGNOSTIC_INVALID',
        REPLAY_CONFIGURATION: 'DIAGNOSTIC_INVALID',
        VALID_ECONOMIC_FAILURE: 'ROBUSTNESS_ASSESSMENT_FORCED_FAIL',
        UNRESOLVED_FAILURE: 'DIAGNOSTIC_UNRESOLVED',
      };
      if (JSON.stringify(object.qualificationDispositionByDiagnosticCategory) !== JSON.stringify(expectedDisposition)) {
        throw new Error('Protected diagnostic category disposition map is incomplete or mutated');
      }
    }
    if (object.id === 'recovery-fence') {
      const contention = object.concurrentDecreaseOnlyIntentContract;
      assertOnlyProjectedFields(contention, [
        'ordinaryIntentKind',
        'hardStopPriorityRule',
        'causePreservationRule',
        'admissionFirstRule',
        'effectDeduplicationRule',
        'arrivalOrderRule',
      ], 'recovery-fence.concurrentDecreaseOnlyIntentContract');
      if (contention.ordinaryIntentKind !== 'DECREASE_ONLY_STRATEGY_PROTECTIVE'
        || !/RISK_HARD_STOP fence activation precedes and suppresses/i.test(contention.hardStopPriorityRule)
        || !/at most one external decrease effect/i.test(contention.effectDeduplicationRule)
        || !/preserves both causes.*no duplicate reduction invocation/i.test(contention.arrivalOrderRule)) {
        throw new Error('Recovery hard-stop and protective-stop contention contract is incomplete');
      }
    }
  }

  const relationIds = new Set(contract.relations.map((relation) => relation.id));
  for (const relation of contract.relations) {
    nonEmptyString(relation.docsRoute, `${relation.id}.docsRoute`);
    nonEmptyString(relation.description?.en, `${relation.id}.description.en`);
    nonEmptyString(relation.description?.zh, `${relation.id}.description.zh`);
    const semantics = resolveEffectiveRelationSemantics(relation, contract, 'en');
    for (const branch of branchNames) nonEmptyString(semantics.localized[branch], `${relation.id}.${branch}`);
    relationBusinessOutcome(relation);
    assertOnlyProjectedFields(
      relation,
      contract.documentationProjection.relationProjectionFields.filter((field) => field !== 'effectiveSemantics'),
      `relation:${relation.id}`,
      contract.documentationProjection.relationOptionalSourceFields,
    );
  }

  for (const scenario of contract.scenarios) {
    assertOnlyProjectedFields(
      scenario,
      contract.documentationProjection.scenarioProjectionFields,
      `scenario:${scenario.id}`,
    );
    nonEmptyString(scenario.docsRoute, `${scenario.id}.docsRoute`);
    const primary = nonEmptyArray(scenario.primaryRelationIds, `${scenario.id}.primaryRelationIds`);
    const supporting = nonEmptyArray(scenario.supportingRelationIds, `${scenario.id}.supportingRelationIds`);
    if (primary.some((id) => supporting.includes(id))) {
      throw new Error(`Scenario repeats relation across PRIMARY and SUPPORTING: ${scenario.id}`);
    }
    for (const relationId of [...primary, ...supporting]) {
      if (!relationIds.has(relationId)) throw new Error(`Scenario references unknown relation: ${scenario.id}:${relationId}`);
    }
    const visible = contract.relations
      .filter((relation) => scenario.id === 'overview' ? relation.overview === true : relation.scenarios.includes(scenario.id))
      .map((relation) => relation.id);
    if (visible.length !== primary.length + supporting.length || visible.some((id) => !primary.includes(id) && !supporting.includes(id))) {
      throw new Error(`Scenario PRIMARY and SUPPORTING do not completely partition visibility: ${scenario.id}`);
    }
    if (scenario.id === 'recovery') {
      nonEmptyString(scenario.triggerBranchSelectionRule, 'recovery.triggerBranchSelectionRule');
      const triggerBranches = nonEmptyArray(scenario.triggerBranches, 'recovery.triggerBranches');
      const triggerIds = new Set();
      for (const trigger of triggerBranches) {
        assertOnlyProjectedFields(
          trigger,
          [...recoveryTriggerBranchBaseFields, ...recoveryTriggerBranchOptionalFields],
          `recovery-trigger:${trigger.id}`,
        );
        for (const field of recoveryTriggerBranchBaseFields) {
          if (!Object.hasOwn(trigger, field)) throw new Error(`Recovery trigger omits canonical field ${field}: ${trigger.id}`);
        }
        nonEmptyString(trigger.id, 'recovery.trigger.id');
        if (triggerIds.has(trigger.id)) throw new Error(`Duplicate Recovery trigger branch: ${trigger.id}`);
        triggerIds.add(trigger.id);
        if (typeof trigger.applicability === 'string') {
          nonEmptyString(trigger.applicability, `${trigger.id}.applicability`);
        } else {
          nonEmptyString(trigger.applicability?.en, `${trigger.id}.applicability.en`);
          nonEmptyString(trigger.applicability?.zh, `${trigger.id}.applicability.zh`);
        }
        const forbidden = nonEmptyArray(trigger.forbiddenEvidenceAssumptions, `${trigger.id}.forbiddenEvidenceAssumptions`);
        for (const [index, assumption] of forbidden.entries()) {
          if (typeof assumption === 'string') {
            nonEmptyString(assumption, `${trigger.id}.forbiddenEvidenceAssumptions.${index}`);
          } else {
            nonEmptyString(assumption?.en, `${trigger.id}.forbiddenEvidenceAssumptions.${index}.en`);
            nonEmptyString(assumption?.zh, `${trigger.id}.forbiddenEvidenceAssumptions.${index}.zh`);
          }
        }
        const triggerPrimary = nonEmptyArray(trigger.primaryRelationIds, `${trigger.id}.primaryRelationIds`);
        const triggerSupporting = nonEmptyArray(trigger.supportingRelationIds, `${trigger.id}.supportingRelationIds`);
        if (new Set(triggerPrimary).size !== triggerPrimary.length || new Set(triggerSupporting).size !== triggerSupporting.length) {
          throw new Error(`Recovery trigger repeats a relation within one role: ${trigger.id}`);
        }
        if (triggerPrimary.some((id) => triggerSupporting.includes(id))) {
          throw new Error(`Recovery trigger repeats relation across PRIMARY and SUPPORTING: ${trigger.id}`);
        }
        for (const relationId of [...triggerPrimary, ...triggerSupporting]) {
          if (!primary.includes(relationId) && !supporting.includes(relationId)) {
            throw new Error(`Recovery trigger references relation outside Recovery visibility: ${trigger.id}:${relationId}`);
          }
        }
        const admissionSource = recoveryAdmissionSourceBranches[trigger.id];
        if (admissionSource) {
          nonEmptyString(trigger.sourceObjectId, `${trigger.id}.sourceObjectId`);
          nonEmptyString(trigger.admissionDispositionObjectId, `${trigger.id}.admissionDispositionObjectId`);
          nonEmptyString(trigger.caseCreationRule, `${trigger.id}.caseCreationRule`);
          if (trigger.sourceObjectId !== admissionSource.sourceObjectId) {
            throw new Error(`Recovery trigger source object mismatch: ${trigger.id}:${trigger.sourceObjectId}`);
          }
          if (JSON.stringify(triggerPrimary) !== JSON.stringify(admissionSource.primaryRelationIds)) {
            throw new Error(`Recovery trigger source relation path mismatch: ${trigger.id}`);
          }
          for (const sourceRelationId of admissionSource.sourceRelationIds) {
            const sourceRelation = contract.relations.find((relation) => relation.id === sourceRelationId);
            if (sourceRelation?.objectId !== admissionSource.sourceObjectId) {
              throw new Error(`Recovery trigger source relation object mismatch: ${trigger.id}:${sourceRelationId}`);
            }
          }
          if (!contract.architectureObjects.some((object) => object.id === trigger.admissionDispositionObjectId)) {
            throw new Error(`Recovery trigger references unknown admission disposition: ${trigger.id}:${trigger.admissionDispositionObjectId}`);
          }
        } else if (recoveryTriggerBranchOptionalFields.some((field) => Object.hasOwn(trigger, field))) {
          throw new Error(`Recovery trigger carries incident-only admission semantics: ${trigger.id}`);
        }
      }
    }
  }

  for (const invariant of contract.developmentChunkContract.authorityLocalInvariants) {
    const authority = invariant.authorityId ?? invariant.custodianId;
    const surface = surfaceById.get(authority);
    if (!surface) throw new Error(`Authority-local invariant references unknown surface: ${invariant.id}`);
    nonEmptyString(invariant.docsRoute, `${invariant.id}.docsRoute`);
    const scenarioRoute = contract.scenarios.find((scenario) => scenario.id === invariant.scenarioId)?.docsRoute;
    if (invariant.docsRoute !== surface.docsRoute && invariant.docsRoute !== scenarioRoute) {
      throw new Error(`Authority-local invariant docs route diverges from its surface: ${invariant.id}`);
    }
    nonEmptyString(invariant.observableConsumerId, `${invariant.id}.observableConsumerId`);
    nonEmptyArray(invariant.requiredGuarantees, `${invariant.id}.requiredGuarantees`);
    nonEmptyArray(invariant.requiredRelatedObjectIds, `${invariant.id}.requiredRelatedObjectIds`);
    for (const objectId of [invariant.objectId, ...invariant.requiredRelatedObjectIds]) {
      if (!contract.architectureObjects.some((object) => object.id === objectId)) {
        throw new Error(`Authority-local invariant references unknown object: ${invariant.id}:${objectId}`);
      }
    }
    for (const branch of branchNames) nonEmptyString(invariant.semantics?.[branch], `${invariant.id}.${branch}`);
    if (invariant.businessOwnerDisposition === 'OWNER') {
      nonEmptyString(invariant.authorityId, `${invariant.id}.authorityId`);
      if (invariant.noBusinessOutcomeBasis !== null && invariant.noBusinessOutcomeBasis !== undefined) throw new Error(`Owner invariant carries no-business basis: ${invariant.id}`);
    } else if (invariant.businessOwnerDisposition === 'NONE_NON_BUSINESS_BOUNDARY') {
      nonEmptyString(invariant.custodianId, `${invariant.id}.custodianId`);
      nonEmptyString(invariant.noBusinessOutcomeBasis, `${invariant.id}.noBusinessOutcomeBasis`);
      if (invariant.authorityId !== null && invariant.authorityId !== undefined) throw new Error(`Non-business invariant carries business authority: ${invariant.id}`);
    } else {
      throw new Error(`Unknown authority-local invariant business disposition: ${invariant.id}`);
    }
    assertOnlyProjectedFields(
      invariant,
      contract.documentationProjection.authorityLocalInvariantProjectionFields,
      `authority-local-invariant:${invariant.id}`,
    );
  }

  const objectIds = new Set(contract.architectureObjects.map((object) => object.id));
  for (const routeProjection of contract.documentationProjection.objectRouteProjections ?? []) {
    nonEmptyString(routeProjection.docsRoute, 'objectRouteProjection.docsRoute');
    for (const objectId of nonEmptyArray(routeProjection.objectIds, `${routeProjection.docsRoute}.objectIds`)) {
      if (!objectIds.has(objectId)) throw new Error(`Object route projection references unknown object: ${routeProjection.docsRoute}:${objectId}`);
    }
  }

  const observabilityProjection = contract.documentationProjection.observabilityProjection;
  nonEmptyString(observabilityProjection.docsRoute, 'observabilityProjection.docsRoute');
  assertOnlyProjectedFields(contract.observabilityContract, observabilityProjection.fields, 'observability-contract');
  for (const field of observabilityProjection.fields) {
    if (!Object.hasOwn(contract.observabilityContract, field)) {
      throw new Error(`Canonical projection omits observability field ${field}`);
    }
  }

  const capabilityProjection = contract.documentationProjection.capabilityAdoptionProjection;
  nonEmptyString(capabilityProjection.docsRoute, 'capabilityAdoptionProjection.docsRoute');
  for (const [records, fields, label] of [
    [contract.capabilityAdoptionContract.workspaceCapabilityPorts, capabilityProjection.workspaceCapabilityPortFields, 'workspace-capability-port'],
    [contract.capabilityAdoptionContract.workspaceMemberInventory, capabilityProjection.workspaceMemberInventoryFields, 'workspace-member-inventory'],
    [contract.capabilityAdoptionContract.strategyFactoryMappings, capabilityProjection.strategyFactoryMappingFields, 'strategy-factory-mapping'],
  ]) {
    for (const record of records) {
      assertOnlyProjectedFields(record, fields, `${label}:${record.capabilityId ?? record.inventoryId}`);
      for (const field of fields) {
        if (!Object.hasOwn(record, field)) throw new Error(`Canonical projection omits ${label} field ${field}: ${record.capabilityId ?? record.inventoryId}`);
      }
    }
  }
}

validateCanonicalProjectionContract(architectureContract);

function relationBusinessOutcome(relation) {
  const owner = typeof relation.businessOutcomeOwnerId === 'string' && relation.businessOutcomeOwnerId.length > 0
    ? relation.businessOutcomeOwnerId
    : undefined;
  const basis = typeof relation.noBusinessOutcomeBasis === 'string' && relation.noBusinessOutcomeBasis.length > 0
    ? relation.noBusinessOutcomeBasis
    : undefined;
  if (Boolean(owner) === Boolean(basis)) {
    throw new Error(`Relation ${relation.id} must declare exactly one business outcome owner or no-outcome basis`);
  }
  return owner ? { owner } : { basis };
}

function projectionLabels(locale) {
  if (locale !== 'zh') return {
    route: 'route', modules: 'modules', scenario: 'scenario', relation: 'relation', class: 'class', weight: 'weight',
    sourceRole: 'source role', actionKind: 'action kind', carriedObject: 'carried object', objectAuthority: 'object authority', semanticsAuthority: 'semantics authority',
    businessOutcomeOwner: 'business outcome owner', noBusinessOutcome: 'no business outcome', scenarios: 'scenarios', overview: 'overview',
    object: 'object', authority: 'authority or custodian', states: 'states', quickstart: 'quickstart sequence',
    role: 'role', moduleCount: 'module count', identity: 'identity binds', stateFamilies: 'state families',
    canonicalFields: 'canonical fields', moduleRecord: 'module record',
    crossBindings: 'cross bindings', transitions: 'transitions and controls', invariants: 'invariants', contractFacets: 'contract facets',
    visibility: 'visibility', invariant: 'authority-local invariant', consumer: 'consumer', guarantees: 'guarantees', relatedObjects: 'related objects',
    businessDisposition: 'business outcome disposition', migrationSurface: 'migration surface',
    capabilityPort: 'workspace capability port', workspaceInventory: 'workspace member inventory', strategyFactoryMapping: 'Strategy Factory mapping',
    ownerProfile: 'owner operational profile fields', timeEvidence: 'shared time evidence fields',
    chunkFields: 'required structured chunk fields', validatorOutcomes: 'validator outcomes', validatorCommand: 'validator command',
    relationChunkExample: 'copyable RELATION example', invariantChunkExample: 'copyable AUTHORITY_LOCAL_INVARIANT example',
    primaryRelations: 'PRIMARY relations', supportingRelations: 'SUPPORTING relations',
    aggregatePrimaryCoverage: 'aggregate Flow PRIMARY coverage (not one conjunctive executable path)',
    aggregateSupportingCoverage: 'aggregate Flow SUPPORTING coverage (not one conjunctive executable path)',
    branchPrimaryRelations: 'branch executable PRIMARY path', branchSupportingRelations: 'branch SUPPORTING context',
    admissionDisposition: 'admission disposition', caseCreationRule: 'case creation rule',
    triggerSelectionRule: 'trigger selection rule', triggerBranch: 'trigger branch', applicability: 'applicability',
    forbiddenEvidenceAssumptions: 'forbidden evidence assumptions',
    accepted: 'accepted', rejected: 'rejected', unknown: 'unknown', replay: 'replay',
  };
  return {
    route: '文档路由', modules: '模块', scenario: '场景', relation: '关系', class: '类别', weight: '线权重',
    sourceRole: '来源角色', actionKind: '动作类型', carriedObject: '承载对象', objectAuthority: '对象权威', semanticsAuthority: '语义权威',
    businessOutcomeOwner: '业务结果权威', noBusinessOutcome: '无业务结果', scenarios: '适用场景', overview: '全景可见',
    object: '对象', authority: '权威或托管方', states: '状态', quickstart: '快速开始序列',
    role: '角色', moduleCount: '模块数量', identity: '身份绑定', stateFamilies: '状态族',
    canonicalFields: '规范字段', moduleRecord: '模块记录',
    crossBindings: '跨对象绑定', transitions: '转换与控制', invariants: '不变量', contractFacets: '契约维度',
    visibility: '可见性', invariant: 'Owner 本地不变量', consumer: '消费者', guarantees: '保证', relatedObjects: '关联对象',
    businessDisposition: '业务结果归属', migrationSurface: '迁移面',
    capabilityPort: '工作区能力端口', workspaceInventory: '工作区成员清单', strategyFactoryMapping: 'Strategy Factory 映射',
    ownerProfile: 'Owner 运行配置字段', timeEvidence: '共享时间证据字段',
    chunkFields: '结构化开发块必填字段', validatorOutcomes: '校验结果', validatorCommand: '校验命令',
    relationChunkExample: '可复制的 RELATION 示例', invariantChunkExample: '可复制的 AUTHORITY_LOCAL_INVARIANT 示例',
    primaryRelations: 'PRIMARY 关系', supportingRelations: 'SUPPORTING 关系',
    aggregatePrimaryCoverage: 'Flow 聚合 PRIMARY 覆盖（不是一条全部必经的可执行路径）',
    aggregateSupportingCoverage: 'Flow 聚合 SUPPORTING 覆盖（不是一条全部必经的可执行路径）',
    branchPrimaryRelations: '分支可执行 PRIMARY 路径', branchSupportingRelations: '分支 SUPPORTING 上下文',
    admissionDisposition: '准入结论', caseCreationRule: 'Recovery Case 创建规则',
    triggerSelectionRule: '触发分支选择规则', triggerBranch: '触发分支', applicability: '适用条件',
    forbiddenEvidenceAssumptions: '禁止的证据假设',
    accepted: '接受', rejected: '拒绝', unknown: '未知', replay: '重放',
  };
}

function canonicalContractProjection(route, locale) {
  const routeSurfaces = surfaces.filter((surface) => surface.docsRoute === route);
  const routeScenarios = architectureContract.scenarios.filter((scenario) => scenario.docsRoute === route);
  const routeRelations = architectureContract.relations.filter((relation) => relation.docsRoute === route);
  const routeInvariants = authorityLocalInvariants.filter((invariant) => invariant.docsRoute === route);
  const routeObjectProjection = projectionContract.objectRouteProjections?.find((projection) => projection.docsRoute === route);
  const routeObjectIds = new Set(routeRelations.map((relation) => relation.objectId));

  for (const surface of routeSurfaces) {
    for (const object of architectureContract.architectureObjects) {
      if (object.custodianId === surface.id || object.authorityId === surface.id) routeObjectIds.add(object.id);
    }
  }
  for (const invariant of routeInvariants) {
    routeObjectIds.add(invariant.objectId);
    for (const objectId of invariant.requiredRelatedObjectIds) routeObjectIds.add(objectId);
  }
  for (const objectId of routeObjectProjection?.objectIds ?? []) routeObjectIds.add(objectId);

  const isQuickstart = route === 'guide/quickstart';
  const isArchitectureRules = route === 'guide/architecture-rules';
  const isDevelopmentChunk = route === 'guide/development-chunk-contract';
  const isCapabilityAdoption = route === projectionContract.capabilityAdoptionProjection.docsRoute;
  const isObservability = route === projectionContract.observabilityProjection.docsRoute;
  if (
    routeSurfaces.length === 0
    && routeScenarios.length === 0
    && routeRelations.length === 0
    && routeInvariants.length === 0
    && routeObjectIds.size === 0
    && !isQuickstart
    && !isArchitectureRules
    && !isDevelopmentChunk
    && !isCapabilityAdoption
    && !isObservability
  ) return '';

  const label = locale === 'zh' ? '规范契约投影' : 'Canonical contract';
  const sourceNote = locale === 'zh'
    ? '由 architecture-contract.json 生成 请勿在本页手工修改 四分支保留规范英文正文以避免翻译副本成为第二权威'
    : 'Generated from architecture-contract.json; do not edit this projection by hand.';
  const text = projectionLabels(locale);
  const lines = [
    '',
    '',
    '<Accordions>',
    `<Accordion title=${JSON.stringify(label)}>`,
    '',
    `> ${sourceNote}`,
  ];

  for (const surface of routeSurfaces) {
    const role = surfaceRole(surface);
    const modules = surface.modules ?? [];
    lines.push('', `- **${surface.label}** — \`${surface.id}\` · ${text.role} \`${role}\` · ${text.route} \`${route}\``);
    lines.push(`  - ${text.moduleCount}: \`${modules.length}\``);
    const surfaceKind = architectureContract.authorityOwners.includes(surface)
      ? 'authorityOwner'
      : architectureContract.channels.includes(surface) ? 'channel' : 'boundary';
    lines.push(`  - ${text.canonicalFields}: ${projectionValue(projectedRecord(surface, projectionContract.surfaceProjectionFields[surfaceKind].filter((field) => field !== 'modules')))}`);
    lines.push(`  - ${text.modules}: ${modules.length > 0
      ? modules.map((module) => `\`${module.label}\` (\`${module.id}\`)`).join(', ')
      : 'none'}`);
    for (const module of modules) {
      lines.push(`  - ${text.moduleRecord} \`${module.id}\`: ${projectionValue(projectedRecord(module, projectionContract.moduleProjectionFields))}`);
    }
  }

  for (const scenario of routeScenarios) {
    if (!Array.isArray(scenario.primaryRelationIds) || !Array.isArray(scenario.supportingRelationIds)) {
      throw new Error(`Scenario ${scenario.id} must declare PRIMARY and SUPPORTING relation lists`);
    }
    const overlap = scenario.primaryRelationIds.filter((id) => scenario.supportingRelationIds.includes(id));
    if (overlap.length > 0) throw new Error(`Scenario ${scenario.id} repeats relations across PRIMARY and SUPPORTING: ${overlap.join(', ')}`);
    lines.push('', `- **${localized(scenario.label, locale)}** — ${text.scenario} \`${scenario.id}\``);
    lines.push(`  - ${localized(scenario.description, locale)}`);
    lines.push(`  - ${locale === 'zh' ? '入口' : 'entry'}: ${localized(scenario.entry, locale)}`);
    lines.push(`  - ${locale === 'zh' ? '证明' : 'proof'}: ${localized(scenario.proof, locale)}`);
    if (scenario.id === 'recovery') {
      lines.push(`  - ${text.triggerSelectionRule}: ${localized(scenario.triggerBranchSelectionRule, locale)}`);
      for (const trigger of scenario.triggerBranches) {
        const forbidden = trigger.forbiddenEvidenceAssumptions
          .map((assumption) => localized(assumption, locale));
        lines.push(`  - **${text.triggerBranch} \`${trigger.id}\`**`);
        lines.push(`    - ${text.applicability}: ${localized(trigger.applicability, locale)}`);
        if (trigger.sourceObjectId) {
          lines.push(`    - ${locale === 'zh' ? '来源对象' : 'source object'}: \`${trigger.sourceObjectId}\``);
        }
        if (trigger.admissionDispositionObjectId) {
          lines.push(`    - ${text.admissionDisposition}: \`${trigger.admissionDispositionObjectId}\``);
          lines.push(`    - ${text.caseCreationRule}: ${localized(trigger.caseCreationRule, locale)}`);
        }
        lines.push(`    - ${text.forbiddenEvidenceAssumptions}: ${forbidden.join(' | ')}`);
        lines.push(`    - ${text.branchPrimaryRelations}: ${inlineList(trigger.primaryRelationIds)}`);
        lines.push(`    - ${text.branchSupportingRelations}: ${inlineList(trigger.supportingRelationIds)}`);
      }
      lines.push(`  - ${text.aggregatePrimaryCoverage}: ${inlineList(scenario.primaryRelationIds)}`);
      lines.push(`  - ${text.aggregateSupportingCoverage}: ${inlineList(scenario.supportingRelationIds)}`);
    } else {
      lines.push(`  - ${text.primaryRelations}: ${inlineList(scenario.primaryRelationIds)}`);
      lines.push(`  - ${text.supportingRelations}: ${inlineList(scenario.supportingRelationIds)}`);
    }
  }

  for (const relation of routeRelations) {
    const semantics = resolveEffectiveRelationSemantics(relation, architectureContract, locale);
    const carriedObject = architectureObjects.get(relation.objectId);
    if (!carriedObject) throw new Error(`Unknown architecture object ${relation.objectId} projected by ${relation.id}`);
    const carriedObjectAuthority = carriedObject.authorityId ?? carriedObject.custodianId;
    if (carriedObjectAuthority !== relation.objectAuthority) {
      throw new Error(
        `Relation ${relation.id} declares ${relation.objectAuthority} for ${relation.objectId}; canonical authority is ${carriedObjectAuthority}`,
      );
    }
    const businessOutcome = relationBusinessOutcome(relation);
    lines.push('', `- **${text.relation} \`${relation.id}\`** — \`${relation.sourceId}\` → \`${relation.targetId}\``);
    lines.push(`  - ${text.class} \`${relation.class}\` · ${text.weight} \`${relation.weight}\` · ${text.route} \`${relation.docsRoute}\``);
    lines.push(`  - ${text.sourceRole} \`${relation.sourceRole}\` · ${text.actionKind} \`${relation.relation}\` · ${text.carriedObject} \`${relation.objectId}\` · ${text.objectAuthority} \`${relation.objectAuthority}\` · ${text.semanticsAuthority} \`RELATION_LOCAL\``);
    lines.push(businessOutcome.owner
      ? `  - ${text.businessOutcomeOwner} \`${businessOutcome.owner}\``
      : `  - ${text.noBusinessOutcome}: ${businessOutcome.basis}`);
    lines.push(`  - ${text.scenarios} ${inlineList(relation.scenarios)} · ${text.overview} \`${Boolean(relation.overview)}\``);
    lines.push(`  - ${localized(relation.description, locale)}`);
    lines.push(`  - **${text.accepted}**: ${semantics.localized.accepted}`);
    lines.push(`  - **${text.rejected}**: ${semantics.localized.rejected}`);
    lines.push(`  - **${text.unknown}**: ${semantics.localized.unknown}`);
    lines.push(`  - **${text.replay}**: ${semantics.localized.replay}`);
  }

  for (const objectId of [...routeObjectIds].sort()) {
    const object = architectureObjects.get(objectId);
    if (!object) throw new Error(`Unknown architecture object ${objectId} projected by ${route}`);
    const authority = object.authorityId ?? object.custodianId;
    if (!authority) throw new Error(`Architecture object ${object.id} has no authority or custodian`);
    lines.push('', `- **${text.object} \`${object.id}\`** — \`${object.label}\` · ${text.authority} \`${authority}\``);
    if (object.visibility) lines.push(`  - ${text.visibility}: \`${object.visibility}\``);
    const baseFields = new Set(['id', 'label', 'authorityId', 'custodianId', 'visibility']);
    for (const [key, value] of Object.entries(object).filter(([key]) => !baseFields.has(key)).sort(([left], [right]) => left.localeCompare(right))) {
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        throw new Error(`Architecture object projection cannot omit empty canonical facet: ${object.id}.${key}`);
      }
      lines.push(`  - ${objectFacetLabel(key, text)} \`${key}\`: ${projectionValue(value)}`);
    }
  }

  for (const invariant of routeInvariants) {
    const authority = invariant.authorityId ?? invariant.custodianId;
    lines.push('', `- **${text.invariant} \`${invariant.id}\`** — ${text.authority} \`${authority}\` · ${text.route} \`${invariant.docsRoute}\``);
    lines.push(`  - ${text.consumer}: \`${invariant.observableConsumerId}\` · ${text.scenario} \`${invariant.scenarioId}\``);
    lines.push(`  - ${text.object}: \`${invariant.objectId}\` · ${text.relatedObjects}: ${inlineList(invariant.requiredRelatedObjectIds)}`);
    lines.push(`  - ${text.guarantees}: ${inlineList(invariant.requiredGuarantees)}`);
    lines.push(`  - ${text.businessDisposition}: \`${invariant.businessOwnerDisposition}\``);
    if (invariant.businessOwnerDisposition === 'OWNER') {
      lines.push(`  - ${text.businessOutcomeOwner} \`${invariant.authorityId}\``);
    } else {
      lines.push(`  - ${text.noBusinessOutcome}: ${invariant.noBusinessOutcomeBasis}`);
    }
    lines.push(`  - ${text.migrationSurface}: ${invariant.migrationSurfaceId ? `\`${invariant.migrationSurfaceId}\`` : 'not applicable'}`);
    for (const branch of branchNames) {
      lines.push(`  - **${text[branch]}**: ${invariant.semantics[branch]}`);
    }
  }

  if (isCapabilityAdoption) {
    const capability = architectureContract.capabilityAdoptionContract;
    const capabilityProjection = projectionContract.capabilityAdoptionProjection;
    for (const port of capability.workspaceCapabilityPorts) {
      lines.push('', `- **${text.capabilityPort} \`${port.capabilityId}\`**: ${projectionValue(projectedRecord(port, capabilityProjection.workspaceCapabilityPortFields))}`);
    }
    for (const inventory of capability.workspaceMemberInventory) {
      lines.push('', `- **${text.workspaceInventory} \`${inventory.inventoryId}\`**: ${projectionValue(projectedRecord(inventory, capabilityProjection.workspaceMemberInventoryFields))}`);
    }
    for (const mapping of capability.strategyFactoryMappings) {
      lines.push('', `- **${text.strategyFactoryMapping} \`${mapping.capabilityId}\`**: ${projectionValue(projectedRecord(mapping, capabilityProjection.strategyFactoryMappingFields))}`);
    }
  }

  if (isObservability) {
    lines.push('', `- **${locale === 'zh' ? 'Observability 规范' : 'Observability contract'}**: ${projectionValue(projectedRecord(
      architectureContract.observabilityContract,
      projectionContract.observabilityProjection.fields,
    ))}`);
  }

  if (isQuickstart) {
    lines.push('', `- **${text.quickstart}**: ${inlineList(architectureContract.quickstartContract.canonicalActivationSequence)}`);
    const proofRules = locale === 'zh'
      ? architectureContract.quickstartContract.proofRulesZh
      : architectureContract.quickstartContract.proofRules;
    for (const rule of proofRules) lines.push(`  - ${rule}`);
  }

  if (isArchitectureRules) {
    lines.push('', `- **${text.ownerProfile}**: ${inlineList(architectureContract.operationalContract.requiredOwnerLocalProfileFields)}`);
    lines.push(`- **${text.timeEvidence}**: ${inlineList(architectureContract.operationalContract.requiredTimeEvidenceFields)}`);
  }

  if (isDevelopmentChunk) {
    lines.push('', `- **${text.chunkFields}**: ${inlineList(architectureContract.developmentChunkContract.requiredFields)}`);
    lines.push(`- **${text.validatorOutcomes}**: ${inlineList(architectureContract.developmentChunkContract.validator.validationOutcomes)}`);
    lines.push(`- **${text.validatorCommand}**: \`npm run validate:development-chunk -- <record.json>\` ${locale === 'zh' ? '或通过 stdin 输入 JSON' : 'or pipe JSON on stdin'}`);
    lines.push(
      '',
      `**${text.relationChunkExample}**`,
      '',
      '```json',
      JSON.stringify(materializeCanonicalDevelopmentChunkRecord(architectureContract), null, 2),
      '```',
      '',
      `**${text.invariantChunkExample}**`,
      '',
      '```json',
      JSON.stringify(materializeCanonicalInvariantDevelopmentChunkRecord(architectureContract), null, 2),
      '```',
    );
  }

  lines.push('', '</Accordion>', '</Accordions>', '');
  return lines.join('\n');
}

async function checkCanonicalContractComponents(pages) {
  const localizedRoutes = new Map();
  for (const page of pages) {
    const source = await readFile(page, 'utf8');
    const route = canonicalRouteFromPage(page);
    const locale = /\.zh\.mdx?$/.test(page) ? 'zh' : 'en';
    const locales = localizedRoutes.get(route) ?? new Set();
    if (locales.has(locale)) throw new Error(`Duplicate ${locale} document route: ${route}`);
    locales.add(locale);
    localizedRoutes.set(route, locales);
    if (/<\/?(?:details|summary)(?:\s|>)/.test(source)) {
      throw new Error(`Raw details/summary is unsupported in ${relative(targetRoot, page)}`);
    }

    const hasProjection = source.includes('architecture-contract.json');
    if (!hasProjection) continue;
    if (!page.endsWith('.mdx')) {
      throw new Error(`Canonical contract projection requires MDX in ${relative(targetRoot, page)}`);
    }
    const accordionCount = source.match(/<Accordion title=/g)?.length ?? 0;
    const accordionCloseCount = source.match(/<\/Accordion>/g)?.length ?? 0;
    if (
      accordionCount !== 1
      || accordionCloseCount !== 1
      || !source.includes('<Accordions>')
      || !source.includes('</Accordions>')
    ) {
      throw new Error(`Canonical contract must use one registered Accordion in ${relative(targetRoot, page)}`);
    }
  }

  const requiredRoutes = new Set([
    ...surfaces.map((surface) => surface.docsRoute),
    ...architectureContract.relations.map((relation) => relation.docsRoute),
    ...architectureContract.scenarios.map((scenario) => scenario.docsRoute),
    ...authorityLocalInvariants.map((invariant) => invariant.docsRoute),
    ...(projectionContract.objectRouteProjections ?? []).map((projection) => projection.docsRoute),
    projectionContract.capabilityAdoptionProjection.docsRoute,
    'guide/quickstart',
    'guide/architecture-rules',
    'guide/development-chunk-contract',
  ]);
  for (const route of requiredRoutes) {
    const locales = localizedRoutes.get(route);
    if (!locales || locales.size !== 2 || !locales.has('en') || !locales.has('zh')) {
      throw new Error(`Canonical projection route must resolve exactly once in English and Chinese: ${route}`);
    }
  }
}

async function addFrontmatter(path) {
  const source = await readFile(path, 'utf8');
  const route = canonicalRouteFromPage(path);
  const locale = /\.zh\.mdx?$/.test(path) ? 'zh' : 'en';
  const projection = canonicalContractProjection(route, locale);
  const outputPath = projection ? path.replace(/\.md$/, '.mdx') : path;
  let output;
  if (source.startsWith('---\n')) {
    output = `${source.trimEnd()}${projection}\n`;
  } else {
    const heading = source.match(/^#\s+(.+)$/m);
    if (!heading || heading.index === undefined) {
      throw new Error(`No level-one heading found in ${relative(targetRoot, path)}`);
    }

    const title = titleFromHeading(heading[1]);
    const body = `${source.slice(0, heading.index)}${source.slice(heading.index + heading[0].length)}`
      .replace(/^\n+/, '')
      .trimEnd();
    output = `---\ntitle: ${JSON.stringify(title)}\n---\n\n${body}${projection}\n`;
  }

  await writeFile(outputPath, output);
  if (outputPath !== path) await rm(path);
  return outputPath;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function prepareContent() {
await rm(targetRoot, { recursive: true, force: true });
await mkdir(dirname(targetRoot), { recursive: true });
await cp(sourceRoot, targetRoot, {
  recursive: true,
  filter: (path) => {
    const sourcePath = relative(sourceRoot, path);
    if (sourcePath === '') return true;
    return productSections.includes(sourcePath.split('/')[0]);
  },
});
await cp(sourceIcon, targetIcon);
const lightIcon = await readFile(sourceIcon, 'utf8');
const darkIcon = lightIcon.replace('fill="#111111"', 'fill="#ffffff"');
if (darkIcon === lightIcon) throw new Error('Icon dark-mode color token was not found');
await writeFile(targetDarkIcon, darkIcon);

const pages = (await Promise.all(
  productSections.map((section) => findJupytextPages(join(sourceRoot, section))),
)).flat().sort();
for (const sourcePath of pages) {
  const relativePath = relative(sourceRoot, sourcePath).replace(/\.py$/, '.md');
  const outputPath = join(targetRoot, relativePath);
  await mkdir(dirname(outputPath), { recursive: true });

  const result = spawnSync(
    'uvx',
    ['--from', 'jupytext==1.19.5', 'jupytext', '--to', 'md', '--output', outputPath, sourcePath],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`Jupytext conversion failed for ${relativePath}`);
  }
}

const markdownPages = await findMarkdownPages(targetRoot);
const preparedMarkdownPages = [];
for (const page of markdownPages) preparedMarkdownPages.push(await addFrontmatter(page));
await checkCanonicalContractComponents(preparedMarkdownPages);

await writeJson(join(targetRoot, 'meta.json'), {
  title: 'Vibe Trader Documentation',
  pages: productSections,
});
await writeJson(join(targetRoot, 'meta.zh.json'), {
  title: 'Vibe Trader 文档',
  pages: productSections,
});
await writeJson(join(targetRoot, 'guide', 'meta.json'), {
  title: 'Guide',
  pages: ['index', 'install', 'quickstart', 'product-loop', 'architecture-rules', 'development-chunk-contract', 'agent-implementation', 'source-intake', 'market-data-intake', 'observability', 'design-evidence'],
});
await writeJson(join(targetRoot, 'guide', 'meta.zh.json'), {
  title: '开始使用',
  pages: ['index', 'install', 'quickstart', 'product-loop', 'architecture-rules', 'development-chunk-contract', 'agent-implementation', 'source-intake', 'market-data-intake', 'observability', 'design-evidence'],
});
await writeJson(join(targetRoot, 'architecture', 'meta.json'), {
  title: 'Architecture',
  pages: ['index', 'capability-adoption', 'product-edge', 'strategy-factory', 'event-rail', 'observability'],
});
await writeJson(join(targetRoot, 'architecture', 'meta.zh.json'), {
  title: '架构边界',
  pages: ['index', 'capability-adoption', 'product-edge', 'strategy-factory', 'event-rail', 'observability'],
});
const ownerPages = architectureContract.authorityOwners.map((owner) => owner.docsRoute.split('/').at(-1));
await writeJson(join(targetRoot, 'owners', 'meta.json'), {
  title: 'Owners',
  pages: ['index', ...ownerPages],
});
await writeJson(join(targetRoot, 'owners', 'meta.zh.json'), {
  title: 'Owner 职责',
  pages: ['index', ...ownerPages],
});
const scenarioPages = architectureContract.scenarios.map((scenario) => scenario.id);
await writeJson(join(targetRoot, 'scenarios', 'meta.json'), {
  title: 'Scenarios',
  pages: ['index', ...scenarioPages],
});
await writeJson(join(targetRoot, 'scenarios', 'meta.zh.json'), {
  title: '端到端场景',
  pages: ['index', ...scenarioPages],
});

console.log(
  `Prepared ${markdownPages.length} docs pages, including ${pages.length} Jupytext pages.`,
);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await prepareContent();
}
