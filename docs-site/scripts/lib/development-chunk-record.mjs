import { createHash } from 'node:crypto';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value, allowed) => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
};

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

const exactStringList = (candidate, canonical) => (
  Array.isArray(candidate)
  && Array.isArray(canonical)
  && candidate.length === canonical.length
  && candidate.every((value, index) => nonEmpty(value) && value === canonical[index])
);

const INVARIANT_BINDING_FIELD = 'authority-local-invariant-binding-or-not-applicable-with-basis';
const MIGRATION_BINDING_FIELD = 'owner-migration-binding-or-not-applicable-with-basis';
const IDS_FIELD = 'canonical-owner-object-relation-or-invariant-and-doc-route-ids';
const EVIDENCE_RECEIPT_FIELD = 'evidence-receipt';

const IMPLEMENTATION_REFERENCE_CLASSIFICATIONS = Object.freeze([
  'CURRENT_IMPLEMENTATION_REFERENCE',
  'LEGACY_REFERENCE',
]);

const IMPLEMENTATION_REFERENCE_BINDING_FIELDS = Object.freeze([
  'candidateRevision',
  'locator',
  'classification',
  'verificationResult',
  'verificationReceipt',
  'mismatchDisposition',
]);

const IMPLEMENTATION_REFERENCE_VERIFICATION_RECEIPT_FIELDS = Object.freeze([
  'resolvedCandidateRevision',
  'resolvedLocatorIdentity',
  'contentSha256',
  'checkResults',
  'verificationContextDigest',
]);

const IMPLEMENTATION_REFERENCE_CHECK_FIELDS = Object.freeze([
  'kind',
  'outcome',
  'evidence',
  'basis',
]);

const IMPLEMENTATION_REFERENCE_CHECK_KINDS = Object.freeze([
  'PATHS',
  'SYMBOLS',
  'COMMANDS',
  'PREREQUISITES',
]);

export const SEMANTIC_BRANCHES = Object.freeze(['accepted', 'rejected', 'unknown', 'replay']);
export const SELECTION_MODES = Object.freeze(['RELATION', 'AUTHORITY_LOCAL_INVARIANT']);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const completeSemanticBlock = (value) => (
  isRecord(value)
  && SEMANTIC_BRANCHES.every((branch) => hasOwn(value, branch) && (
    nonEmpty(value[branch])
    || (
      isRecord(value[branch])
      && nonEmpty(value[branch].en)
      && nonEmpty(value[branch].zh)
    )
  ))
);

const localizedSemantic = (value, locale) => {
  if (typeof value === 'string') return value;
  if (isRecord(value)) return value[locale] ?? value.en;
  return undefined;
};

/**
 * Resolve the one canonical four-branch semantic block owned by a relation.
 * Missing or partial local semantics fail closed. There is no profile registry
 * or fallback authority.
 */
export function resolveEffectiveRelationSemantics(relation, _contract, locale = 'en') {
  if (!isRecord(relation)) throw new Error('Cannot resolve semantics for an unknown relation');
  if (!completeSemanticBlock(relation.semantics)) {
    throw new Error(`No complete relation-local semantics for ${relation.id}`);
  }

  const canonical = Object.fromEntries(SEMANTIC_BRANCHES.map((branch) => [branch, relation.semantics[branch]]));
  return {
    relationId: relation.id,
    source: 'RELATION_LOCAL',
    ...canonical,
    canonical,
    localized: Object.fromEntries(
      SEMANTIC_BRANCHES.map((branch) => [branch, localizedSemantic(relation.semantics[branch], locale)]),
    ),
  };
}

export function resolveEffectiveInvariantSemantics(invariant, locale = 'en') {
  if (!isRecord(invariant) || !completeSemanticBlock(invariant.semantics)) {
    throw new Error(`No complete invariant semantics for ${invariant?.id ?? 'unknown'}`);
  }
  const canonical = Object.fromEntries(SEMANTIC_BRANCHES.map((branch) => [branch, invariant.semantics[branch]]));
  return {
    invariantId: invariant.id,
    source: 'AUTHORITY_LOCAL_INVARIANT',
    ...canonical,
    canonical,
    localized: Object.fromEntries(
      SEMANTIC_BRANCHES.map((branch) => [branch, localizedSemantic(invariant.semantics[branch], locale)]),
    ),
  };
}

const exactSemanticValue = (candidate, canonical) => {
  if (typeof canonical === 'string') return candidate === canonical;
  if (!isRecord(candidate) || !isRecord(canonical)) return false;
  if (!exactKeys(candidate, Object.keys(canonical))) return false;
  return Object.keys(canonical).every((key) => candidate[key] === canonical[key]);
};

export function materializeCanonicalDevelopmentChunkRecord(contract) {
  const record = structuredClone(contract.developmentChunkContract.exampleRecord);
  const ids = record[IDS_FIELD];
  const relation = contract.relations.find((candidate) => candidate.id === ids?.relationId);
  const invariant = contract.developmentChunkContract.authorityLocalInvariants
    .find((candidate) => candidate.id === ids?.invariantId);
  const resolved = relation
    ? resolveEffectiveRelationSemantics(relation, contract)
    : invariant
      ? resolveEffectiveInvariantSemantics(invariant)
      : undefined;
  if (!resolved) throw new Error('Canonical development chunk example selects no resolvable relation or invariant');
  record['relation-action-kind'] = relation?.relation ?? null;
  record['accepted-rejected-unknown-and-replay-semantics'] = structuredClone(resolved.canonical);
  return record;
}

export function materializeCanonicalInvariantDevelopmentChunkRecord(contract, invariantId) {
  const chunk = contract.developmentChunkContract;
  const invariant = invariantId
    ? chunk.authorityLocalInvariants.find((candidate) => candidate.id === invariantId)
    : chunk.authorityLocalInvariants.find((candidate) => !nonEmpty(candidate.migrationSurfaceId));
  if (!invariant) throw new Error('No canonical authority-local invariant is available for the example');
  if (nonEmpty(invariant.migrationSurfaceId)) {
    throw new Error(`Invariant requires explicit migration evidence and cannot use the generated no-migration example: ${invariant.id}`);
  }
  const authority = invariant.authorityId ?? invariant.custodianId;
  const surface = [...contract.authorityOwners, ...contract.boundaries]
    .find((candidate) => candidate.id === authority);
  if (!authority || !surface) throw new Error(`Invariant has no resolvable authority surface: ${invariant.id}`);

  const record = materializeCanonicalDevelopmentChunkRecord(contract);
  record['selection-mode'] = 'AUTHORITY_LOCAL_INVARIANT';
  record['chunk-identity'] = `chunk:${invariant.id}:${invariant.scenarioId}:v1`;
  record['consumer-and-scenario'] = {
    consumerId: invariant.observableConsumerId,
    scenarioId: invariant.scenarioId,
  };
  record['request-or-object-producer-authority'] = authority;
  record['business-outcome-owner-or-none-with-basis'] = invariant.businessOwnerDisposition === 'OWNER'
    ? { ownerId: authority, noneBasis: null }
    : { ownerId: null, noneBasis: invariant.noBusinessOutcomeBasis };
  record[IDS_FIELD] = {
    ownerId: authority,
    objectId: invariant.objectId,
    relationId: null,
    invariantId: invariant.id,
    docsRoute: invariant.docsRoute,
  };
  record['carried-object-authority'] = authority;
  record['relation-action-kind'] = null;
  record['relation-source-role'] = 'authority-local-invariant';
  record['accepted-rejected-unknown-and-replay-semantics'] = structuredClone(invariant.semantics);
  record[INVARIANT_BINDING_FIELD] = {
    applicable: true,
    invariantId: invariant.id,
    migrationSurfaceId: invariant.migrationSurfaceId ?? null,
    requiredRelatedObjectIds: structuredClone(invariant.requiredRelatedObjectIds),
    requiredGuarantees: structuredClone(invariant.requiredGuarantees),
  };
  record[MIGRATION_BINDING_FIELD] = {
    applicable: false,
    basis: 'This authority-local invariant does not migrate an Owner or predecessor writer',
  };
  return record;
}

const validateExactShape = (value, template, path, reasons) => {
  if (isRecord(template)) {
    if (!exactKeys(value, Object.keys(template))) {
      reasons.push(`${path} fields must exactly match the canonical record shape`);
      return;
    }
    for (const key of Object.keys(template)) validateExactShape(value[key], template[key], `${path}.${key}`, reasons);
    return;
  }
  if (Array.isArray(template)) {
    if (!Array.isArray(value) || value.length === 0) reasons.push(`${path} must be a non-empty list`);
  }
};

const validateNonApplicableBinding = (binding, label, reasons) => {
  if (!exactKeys(binding, ['applicable', 'basis']) || binding.applicable !== false || !nonEmpty(binding.basis)) {
    reasons.push(`${label} non-applicable disposition must contain only applicable false and a concrete basis`);
    return false;
  }
  return true;
};

const validateInvariantBinding = (binding, invariant, reasons) => {
  if (!exactKeys(binding, [
    'applicable',
    'invariantId',
    'migrationSurfaceId',
    'requiredRelatedObjectIds',
    'requiredGuarantees',
  ]) || binding.applicable !== true) {
    reasons.push('authority-local invariant binding must be an exact applicable binding');
    return;
  }
  if (binding.invariantId !== invariant.id) reasons.push('authority-local invariant identity mismatch');
  if (binding.migrationSurfaceId !== (invariant.migrationSurfaceId ?? null)) reasons.push('authority-local invariant migration surface mismatch');
  if (!exactStringList(binding.requiredRelatedObjectIds, invariant.requiredRelatedObjectIds)) {
    reasons.push('authority-local invariant related object bindings must exactly match the canonical invariant');
  }
  if (!exactStringList(binding.requiredGuarantees, invariant.requiredGuarantees)) {
    reasons.push('authority-local invariant guarantees must exactly match the canonical invariant');
  }
};

const validateApplicableMigration = (migration, contract, producerAuthority, expectedSurfaceId, reasons) => {
  const policy = contract.developmentChunkContract.migrationBindingPolicy;
  const required = policy.applicableRequiredFields;
  if (!exactKeys(migration, ['applicable', ...required]) || migration.applicable !== true) {
    reasons.push('applicable migration evidence must exactly match the canonical migration binding shape');
    return;
  }

  for (const field of required) {
    const value = migration[field];
    if (Array.isArray(value) ? value.length === 0 || !value.every(nonEmpty) : isRecord(value) ? Object.keys(value).length === 0 : !nonEmpty(value)) {
      reasons.push(`applicable migration evidence ${field} is incomplete`);
    }
  }

  if (migration['surface-class-id'] !== expectedSurfaceId) {
    reasons.push('migration evidence does not bind the invariant migration surface');
  }
  const envelope = contract.ownerMigrationEnvelope;
  const surface = envelope.surfaceClasses.find((candidate) => candidate.id === migration['surface-class-id']);
  if (!surface) {
    reasons.push('migration evidence selects an unknown migration surface');
    return;
  }
  if (surface.targetAuthorityId !== producerAuthority) reasons.push('migration surface authority mismatch');
  if (migration['incident-authority'] !== surface.incidentAuthorityId) reasons.push('migration incident authority mismatch');

  const currentStage = envelope.stages.indexOf(migration['current-stage']);
  const nextStage = envelope.stages.indexOf(migration['next-adjacent-stage']);
  if (currentStage < 0 || nextStage !== currentStage + 1) reasons.push('migration evidence must advance exactly one adjacent stage');
  if (migration['predecessor-revision'] === migration['successor-revision']) {
    reasons.push('migration predecessor and successor revisions must differ');
  }

  const cut = migration['common-evidence-cut'];
  if (
    !exactKeys(cut, ['domain', 'identity'])
    || cut.domain !== surface.requiredCommonEvidenceCutDomain
    || !nonEmpty(cut.identity)
    || !cut.identity.startsWith(`${cut.domain}:`)
    || cut.identity.length === cut.domain.length + 1
  ) reasons.push('migration common evidence cut does not bind the canonical surface frontier');
  if (!exactStringList(migration['surface-specific-evidence-bindings'], surface.requiredEvidenceBindingIds)) {
    reasons.push('migration surface evidence bindings must exactly match the canonical surface');
  }
  if (migration['rollback-or-forward-recovery-disposition'] !== surface.requiredRollbackDispositionId) {
    reasons.push('migration rollback or forward-recovery disposition mismatch');
  }
  if (!exactStringList(migration['kill-observations'], surface.requiredKillObservationIds)) {
    reasons.push('migration kill observations must exactly match the canonical surface');
  }
};

const hasConcreteLeaves = (value) => {
  if (typeof value === 'string') return value.trim().length > 0 && !value.includes('TODO');
  if (value === null || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0 && value.every(hasConcreteLeaves);
  if (isRecord(value)) return Object.values(value).every(hasConcreteLeaves);
  return false;
};

const sha256Identity = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const gitBlobIdentity = (bytes) => createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes)
  .digest('hex');

export const computeImplementationReferenceVerificationContextDigest = (verificationReceipt) => {
  if (!isRecord(verificationReceipt)) return undefined;
  const payload = {
    resolvedCandidateRevision: verificationReceipt.resolvedCandidateRevision,
    resolvedLocatorIdentity: verificationReceipt.resolvedLocatorIdentity,
    contentSha256: verificationReceipt.contentSha256,
    checkResults: verificationReceipt.checkResults,
  };
  return sha256Identity(Buffer.from(JSON.stringify(payload), 'utf8'));
};

const resolveExternalVerificationContextDigest = (resolutionContext, locator) => {
  if (typeof resolutionContext?.getVerificationContextDigest === 'function') {
    return resolutionContext.getVerificationContextDigest(locator);
  }
  if (resolutionContext?.verificationContextDigests instanceof Map) {
    return resolutionContext.verificationContextDigests.get(locator);
  }
  if (isRecord(resolutionContext?.verificationContextDigests)) {
    return resolutionContext.verificationContextDigests[locator];
  }
  return undefined;
};

const validateImplementationReferenceBindings = (receipt, reasons, resolutionContext) => {
  if (!isRecord(receipt)) {
    reasons.push('evidence receipt must be a concrete record');
    return;
  }

  const candidateRevision = receipt.candidateRevision;
  const bindings = receipt.implementationReferenceBindings;
  if (!nonEmpty(candidateRevision) || !hasConcreteLeaves(candidateRevision)) {
    reasons.push('evidence receipt candidate revision is required');
  }
  if (!nonEmpty(receipt.focusedTestResult) || !hasConcreteLeaves(receipt.focusedTestResult)) {
    reasons.push('evidence receipt focused test result is required');
  }
  if (!nonEmpty(receipt.rootGateResult) || !hasConcreteLeaves(receipt.rootGateResult)) {
    reasons.push('evidence receipt root gate result is required');
  }
  if (!Array.isArray(bindings) || bindings.length === 0) {
    reasons.push('at least one implementation-reference binding is required');
    return;
  }

  const locators = new Set();
  for (const [index, binding] of bindings.entries()) {
    const label = `implementation-reference binding ${index}`;
    if (!exactKeys(binding, IMPLEMENTATION_REFERENCE_BINDING_FIELDS)) {
      reasons.push(`${label} fields must exactly match the canonical binding shape`);
      continue;
    }
    if (
      !nonEmpty(binding.locator)
      || !hasConcreteLeaves(binding.locator)
      || !/^[A-Za-z0-9._/-]+$/.test(binding.locator)
      || binding.locator.startsWith('/')
      || binding.locator.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) reasons.push(`${label} locator must be one normalized repository-relative path`);
    if (locators.has(binding.locator)) reasons.push(`${label} locator is duplicated`);
    locators.add(binding.locator);
    if (!nonEmpty(binding.candidateRevision) || binding.candidateRevision !== candidateRevision) {
      reasons.push(`${label} candidate revision must exactly match the evidence receipt candidate revision`);
    }

    const verification = binding.verificationReceipt;
    if (!exactKeys(verification, IMPLEMENTATION_REFERENCE_VERIFICATION_RECEIPT_FIELDS)) {
      reasons.push(`${label} verification receipt fields must exactly match the canonical receipt shape`);
    } else {
      if (
        !nonEmpty(verification.resolvedCandidateRevision)
        || verification.resolvedCandidateRevision !== candidateRevision
        || verification.resolvedCandidateRevision !== binding.candidateRevision
      ) reasons.push(`${label} resolved candidate revision must match both frozen revision fields`);

      const contentMatch = typeof verification.contentSha256 === 'string'
        ? verification.contentSha256.match(/^sha256:([0-9a-f]{64})$/)
        : null;
      if (!contentMatch) reasons.push(`${label} content SHA-256 identity is malformed`);
      const locatorPrefix = `tree-path:${binding.locator}@git-blob:`;
      const locatorMatch = typeof verification.resolvedLocatorIdentity === 'string'
        && verification.resolvedLocatorIdentity.startsWith(locatorPrefix)
        ? verification.resolvedLocatorIdentity.slice(locatorPrefix.length)
          .match(/^([0-9a-f]{40})@content-sha256:([0-9a-f]{64})$/)
        : null;
      if (!locatorMatch) {
        reasons.push(`${label} resolved locator identity must bind the exact path and immutable git blob`);
      } else if (!contentMatch || locatorMatch[2] !== contentMatch[1]) {
        reasons.push(`${label} resolved locator identity and content SHA-256 must match`);
      }

      const computedContextDigest = computeImplementationReferenceVerificationContextDigest(verification);
      if (
        !/^sha256:[0-9a-f]{64}$/.test(verification.verificationContextDigest)
        || verification.verificationContextDigest !== computedContextDigest
      ) reasons.push(`${label} verification context digest does not bind the exact typed receipt`);

      const candidateTree = resolutionContext?.candidateTree;
      const expectedCandidateRevision = typeof candidateTree === 'string' ? `git-tree:${candidateTree}` : undefined;
      if (
        !isRecord(resolutionContext)
        || !/^[0-9a-f]{40}$/.test(candidateTree ?? '')
        || typeof resolutionContext.resolveLocator !== 'function'
      ) {
        reasons.push(`${label} requires an immutable candidate Git tree resolver`);
      } else if (
        candidateRevision !== expectedCandidateRevision
        || binding.candidateRevision !== expectedCandidateRevision
        || verification.resolvedCandidateRevision !== expectedCandidateRevision
      ) {
        reasons.push(`${label} candidate revision does not match the supplied immutable Git tree`);
      } else {
        try {
          const resolved = resolutionContext.resolveLocator(binding.locator);
          const bytes = resolved?.bytes instanceof Uint8Array ? Buffer.from(resolved.bytes) : undefined;
          if (!bytes || !/^[0-9a-f]{40}$/.test(resolved?.blobId ?? '')) {
            reasons.push(`${label} locator did not resolve to an immutable Git blob`);
          } else {
            const recomputedBlobId = gitBlobIdentity(bytes);
            const recomputedContentSha256 = sha256Identity(bytes);
            const recomputedLocatorIdentity = `tree-path:${binding.locator}@git-blob:${recomputedBlobId}@content-sha256:${recomputedContentSha256.slice(7)}`;
            if (resolved.blobId !== recomputedBlobId) reasons.push(`${label} resolved Git blob bytes do not match the object id`);
            if (verification.resolvedLocatorIdentity !== recomputedLocatorIdentity) reasons.push(`${label} resolved locator identity differs from immutable Git bytes`);
            if (verification.contentSha256 !== recomputedContentSha256) reasons.push(`${label} content SHA-256 differs from immutable Git bytes`);
          }
        } catch (error) {
          reasons.push(`${label} locator resolution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const suppliedContextDigest = resolveExternalVerificationContextDigest(resolutionContext, binding.locator);
      if (
        !/^sha256:[0-9a-f]{64}$/.test(suppliedContextDigest ?? '')
        || suppliedContextDigest !== verification.verificationContextDigest
      ) reasons.push(`${label} Main-supplied verification context digest is missing or mismatched`);

      const results = verification.checkResults;
      if (!Array.isArray(results) || results.length !== IMPLEMENTATION_REFERENCE_CHECK_KINDS.length) {
        reasons.push(`${label} verification checks must contain exactly four typed results`);
      } else {
        const observedKinds = [];
        for (const [checkIndex, result] of results.entries()) {
          const checkLabel = `${label} verification check ${checkIndex}`;
          if (!exactKeys(result, IMPLEMENTATION_REFERENCE_CHECK_FIELDS)) {
            reasons.push(`${checkLabel} fields must exactly match the canonical check shape`);
            continue;
          }
          observedKinds.push(result.kind);
          if (!IMPLEMENTATION_REFERENCE_CHECK_KINDS.includes(result.kind)) {
            reasons.push(`${checkLabel} kind is unknown`);
          }
          if (result.outcome === 'PASS') {
            if (!nonEmpty(result.evidence) || !hasConcreteLeaves(result.evidence) || result.basis !== null) {
              reasons.push(`${checkLabel} PASS requires concrete evidence and a null basis`);
            }
          } else if (result.outcome === 'NOT_APPLICABLE_WITH_BASIS') {
            if (result.evidence !== null || !nonEmpty(result.basis) || !hasConcreteLeaves(result.basis)) {
              reasons.push(`${checkLabel} NOT_APPLICABLE_WITH_BASIS requires a null evidence field and concrete basis`);
            }
          } else {
            reasons.push(`${checkLabel} outcome is unknown`);
          }
        }
        if (!exactStringList(observedKinds, IMPLEMENTATION_REFERENCE_CHECK_KINDS)) {
          reasons.push(`${label} verification check kinds must exactly match the canonical ordered set`);
        }
      }
    }
    if (!IMPLEMENTATION_REFERENCE_CLASSIFICATIONS.includes(binding.classification)) {
      reasons.push(`${label} classification is unknown`);
      continue;
    }
    if (binding.classification === 'CURRENT_IMPLEMENTATION_REFERENCE') {
      if (binding.verificationResult !== 'VERIFIED_AT_CANDIDATE_REVISION') {
        reasons.push(`${label} CURRENT reference requires VERIFIED_AT_CANDIDATE_REVISION`);
      }
      if (binding.mismatchDisposition !== null) {
        reasons.push(`${label} CURRENT reference requires a null mismatch disposition`);
      }
    } else {
      if (binding.verificationResult !== 'MISMATCHED_OR_SUPERSEDED') {
        reasons.push(`${label} LEGACY reference requires MISMATCHED_OR_SUPERSEDED`);
      }
      if (binding.mismatchDisposition !== 'DO_NOT_USE_AND_REPLAN') {
        reasons.push(`${label} LEGACY reference requires DO_NOT_USE_AND_REPLAN`);
      }
    }
  }
};

export function validateDevelopmentChunkRecord(candidate, contract, resolutionContext) {
  const reasons = [];
  const chunk = contract.developmentChunkContract;
  const required = chunk.recordShape.requiredFields;
  if (!exactKeys(candidate, required)) {
    return { outcome: 'INVALID', reasons: ['top-level fields must exactly match the canonical record shape'] };
  }
  // These two bindings are discriminated unions. Their relation and invariant
  // variants are validated below instead of being compared to the example's
  // non-applicable variant.
  const shapeCandidate = structuredClone(candidate);
  const shapeTemplate = structuredClone(chunk.exampleRecord);
  delete shapeCandidate[INVARIANT_BINDING_FIELD];
  delete shapeTemplate[INVARIANT_BINDING_FIELD];
  delete shapeCandidate[MIGRATION_BINDING_FIELD];
  delete shapeTemplate[MIGRATION_BINDING_FIELD];
  validateExactShape(shapeCandidate, shapeTemplate, 'record', reasons);

  const ids = candidate[IDS_FIELD];
  const selectionMode = candidate['selection-mode'];
  const consumer = candidate['consumer-and-scenario'];
  const business = candidate['business-outcome-owner-or-none-with-basis'];
  const semantics = candidate['accepted-rejected-unknown-and-replay-semantics'];
  const invariantBinding = candidate[INVARIANT_BINDING_FIELD];
  const migration = candidate[MIGRATION_BINDING_FIELD];
  const evidenceReceipt = candidate[EVIDENCE_RECEIPT_FIELD];
  const ownerIds = new Set(contract.authorityOwners.map((owner) => owner.id));
  const allGroups = [...contract.authorityOwners, ...contract.boundaries];
  const groupById = new Map(allGroups.map((group) => [group.id, group]));
  const groupByFlowId = new Map([
    ...allGroups.map((group) => [group.groupId, group]),
    ...contract.channels.map((channel) => [channel.id, channel]),
  ]);
  const objects = new Map(contract.architectureObjects.map((object) => [object.id, object]));
  const relation = contract.relations.find((value) => value.id === ids?.relationId);
  const invariant = chunk.authorityLocalInvariants.find((value) => value.id === ids?.invariantId);

  if (!nonEmpty(candidate['chunk-identity'])) reasons.push('chunk identity is required');
  if (!exactKeys(consumer, ['consumerId', 'scenarioId'])) reasons.push('consumer and scenario shape is invalid');
  if (!SELECTION_MODES.includes(selectionMode)) reasons.push('selection mode is invalid');
  if (!exactKeys(ids, ['ownerId', 'objectId', 'relationId', 'invariantId', 'docsRoute'])) reasons.push('canonical ids shape is invalid');
  if (!exactKeys(business, ['ownerId', 'noneBasis']) || (Boolean(business?.ownerId) === Boolean(business?.noneBasis))) reasons.push('business outcome disposition must be exclusive');
  if (!exactKeys(semantics, chunk.recordShape.semanticBranches)) reasons.push('all four semantic branches are required');
  if (
    (selectionMode === 'RELATION' && (!nonEmpty(ids?.relationId) || ids?.invariantId !== null))
    || (selectionMode === 'AUTHORITY_LOCAL_INVARIANT' && (ids?.relationId !== null || !nonEmpty(ids?.invariantId)))
  ) reasons.push('selection mode must match exactly one relation or authority-local invariant');
  if (!objects.has(ids?.objectId)) reasons.push('object id is unknown');

  const object = objects.get(ids?.objectId);
  const objectAuthority = object?.authorityId ?? object?.custodianId;
  if (objectAuthority !== candidate['request-or-object-producer-authority']) reasons.push('producer authority does not own the object');
  if (objectAuthority !== candidate['carried-object-authority']) reasons.push('carried object authority mismatch');

  if (selectionMode === 'RELATION' && relation) {
    const target = groupByFlowId.get(relation.targetId);
    if (target?.id !== consumer?.consumerId || !relation.scenarios.includes(consumer?.scenarioId)) reasons.push('consumer or scenario mismatch');
    if (
      ids.ownerId !== relation.objectAuthority
      || ids.objectId !== relation.objectId
      || ids.docsRoute !== relation.docsRoute
    ) reasons.push('relation ids do not resolve exactly');
    if (candidate['relation-source-role'] !== relation.sourceRole) reasons.push('relation source role mismatch');
    if (candidate['relation-action-kind'] !== relation.relation) reasons.push('relation action kind mismatch');
    if (
      business.ownerId !== (relation.businessOutcomeOwnerId ?? null)
      || business.noneBasis !== (relation.noBusinessOutcomeBasis ?? null)
    ) reasons.push('business outcome disposition mismatch');
    try {
      const resolved = resolveEffectiveRelationSemantics(relation, contract);
      for (const branch of SEMANTIC_BRANCHES) {
        if (!exactSemanticValue(semantics?.[branch], resolved.canonical[branch])) {
          reasons.push(`${branch} semantics do not match canonical ${resolved.source} for ${relation.id}`);
        }
      }
    } catch (error) {
      reasons.push(error.message);
    }
    validateNonApplicableBinding(invariantBinding, 'authority-local invariant binding', reasons);
    if (migration?.applicable === false) {
      validateNonApplicableBinding(migration, 'migration binding', reasons);
    } else if (migration?.applicable === true) {
      validateApplicableMigration(migration, contract, candidate['request-or-object-producer-authority'], migration['surface-class-id'], reasons);
    } else {
      reasons.push('migration disposition is required');
    }
  } else if (selectionMode === 'AUTHORITY_LOCAL_INVARIANT' && invariant) {
    if (consumer?.consumerId !== invariant.observableConsumerId || consumer?.scenarioId !== invariant.scenarioId) reasons.push('invariant consumer or scenario mismatch');
    if (ids.objectId !== invariant.objectId) reasons.push('invariant object mismatch');
    const invariantOwner = invariant.authorityId ?? invariant.custodianId;
    const custodian = groupById.get(invariantOwner);
    if (
      !custodian
      || ids.ownerId !== invariantOwner
      || ids.docsRoute !== invariant.docsRoute
      || candidate['relation-action-kind'] !== null
      || candidate['relation-source-role'] !== 'authority-local-invariant'
    ) reasons.push('invariant ids do not resolve exactly');
    if (
      invariant.businessOwnerDisposition === 'NONE_NON_BUSINESS_BOUNDARY'
      && (business?.ownerId !== null || business?.noneBasis !== invariant.noBusinessOutcomeBasis)
    ) {
      reasons.push('invariant business outcome disposition or no-business basis mismatch');
    }
    if (
      invariant.businessOwnerDisposition === 'OWNER'
      && (business?.ownerId !== invariantOwner || business?.noneBasis !== null)
    ) reasons.push('invariant business outcome owner mismatch');
    try {
      const resolved = resolveEffectiveInvariantSemantics(invariant);
      for (const branch of SEMANTIC_BRANCHES) {
        if (!exactSemanticValue(semantics?.[branch], resolved.canonical[branch])) {
          reasons.push(`${branch} semantics do not match canonical ${resolved.source} for ${invariant.id}`);
        }
      }
    } catch (error) {
      reasons.push(error.message);
    }
    validateInvariantBinding(invariantBinding, invariant, reasons);
    if (nonEmpty(invariant.migrationSurfaceId)) {
      validateApplicableMigration(
        migration,
        contract,
        candidate['request-or-object-producer-authority'],
        invariant.migrationSurfaceId,
        reasons,
      );
    } else if (migration?.applicable === false) {
      validateNonApplicableBinding(migration, 'migration binding', reasons);
    } else {
      reasons.push('an invariant without a migration surface requires a non-applicable migration basis');
    }
  } else {
    reasons.push('selected relation or invariant is unknown');
  }

  if (business?.ownerId && !ownerIds.has(business.ownerId)) reasons.push('business outcome owner is not an authority Owner');
  validateImplementationReferenceBindings(evidenceReceipt, reasons, resolutionContext);
  for (const field of [
    'no-change-harm-and-bounded-outcome',
    'prerequisites-and-unavailable-evidence-stop',
    'allowed-inbound-dependencies-and-prohibited-writes',
    'docs-and-flow-disposition',
    'replan-authority-and-external-effect-escalation',
  ]) {
    if (!isRecord(candidate[field]) || Object.keys(candidate[field]).length === 0 || !hasConcreteLeaves(candidate[field])) reasons.push(`${field} must be a concrete record`);
  }
  for (const field of [
    'focused-owner-test',
    'boundary-consumer-test',
    'adversarial-negative-test',
    'replay-restart-and-concurrency-test-when-applicable',
    'repository-root-gate',
  ]) {
    if (!hasConcreteLeaves(candidate[field])) reasons.push(`${field} must be concrete`);
  }

  if (!hasConcreteLeaves(candidate['implementation-latitude'])) reasons.push('implementation latitude must be a concrete non-empty list');

  return { outcome: reasons.length === 0 ? 'VALID' : 'INVALID', reasons };
}
