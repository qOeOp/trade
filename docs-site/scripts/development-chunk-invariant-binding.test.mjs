import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  computeImplementationReferenceVerificationContextDigest,
  materializeCanonicalDevelopmentChunkRecord as materializeRawDevelopmentChunkRecord,
  materializeCanonicalInvariantDevelopmentChunkRecord as materializeRawInvariantDevelopmentChunkRecord,
  resolveEffectiveRelationSemantics,
  validateDevelopmentChunkRecord as validateRawDevelopmentChunkRecord,
} from './lib/development-chunk-record.mjs';

const contract = JSON.parse(readFileSync(new URL('../lib/architecture-contract.json', import.meta.url), 'utf8'));
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const bindingField = 'authority-local-invariant-binding-or-not-applicable-with-basis';
const migrationField = 'owner-migration-binding-or-not-applicable-with-basis';
const idsField = 'canonical-owner-object-relation-or-invariant-and-doc-route-ids';

const git = (args, encoding = 'utf8') => {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], { encoding, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString?.('utf8') ?? result.stderr);
  return result.stdout;
};

const exampleCandidateTree = git(['rev-parse', 'HEAD^{tree}']).trim();
const exampleCommit = git(['rev-parse', 'HEAD']).trim();
const exampleLocator = 'docs/developer_guide/testing.md';
const exampleGitBlob = git(['rev-parse', `${exampleCandidateTree}:${exampleLocator}`]).trim();
const exampleBytes = git(['cat-file', 'blob', exampleGitBlob], null);
const exampleContentDigest = `sha256:${createHash('sha256').update(exampleBytes).digest('hex')}`;

const typedVerificationReceipt = (candidateRevision, locator) => ({
  resolvedCandidateRevision: candidateRevision,
  resolvedLocatorIdentity: `tree-path:${locator}@git-blob:${exampleGitBlob}@content-sha256:${exampleContentDigest.slice(7)}`,
  contentSha256: exampleContentDigest,
  checkResults: ['PATHS', 'SYMBOLS', 'COMMANDS', 'PREREQUISITES'].map((kind) => ({
    kind,
    outcome: 'PASS',
    evidence: `${kind} resolved against immutable source content at the frozen candidate revision`,
    basis: null,
  })),
  verificationContextDigest: null,
});

const finalizeVerificationReceipt = (verificationReceipt) => {
  verificationReceipt.verificationContextDigest = computeImplementationReferenceVerificationContextDigest(verificationReceipt);
  return verificationReceipt;
};

const bindCanonicalImplementationReference = (record) => {
  const candidateRevision = `git-tree:${exampleCandidateTree}`;
  const receipt = record['evidence-receipt'];
  receipt.candidateRevision = candidateRevision;
  receipt.implementationReferenceBindings = [{
    candidateRevision,
    locator: exampleLocator,
    classification: 'CURRENT_IMPLEMENTATION_REFERENCE',
    verificationResult: 'VERIFIED_AT_CANDIDATE_REVISION',
    verificationReceipt: finalizeVerificationReceipt(typedVerificationReceipt(candidateRevision, exampleLocator)),
    mismatchDisposition: null,
  }];
  return record;
};

const materializeCanonicalDevelopmentChunkRecord = (candidateContract) => (
  bindCanonicalImplementationReference(materializeRawDevelopmentChunkRecord(candidateContract))
);

const materializeCanonicalInvariantDevelopmentChunkRecord = (candidateContract, invariantId) => (
  bindCanonicalImplementationReference(materializeRawInvariantDevelopmentChunkRecord(candidateContract, invariantId))
);

const validationContextFor = (record) => ({
  candidateTree: exampleCandidateTree,
  verificationContextDigests: Object.fromEntries(
    record['evidence-receipt'].implementationReferenceBindings.map((binding) => [
      binding.locator,
      binding.verificationReceipt?.verificationContextDigest,
    ]),
  ),
  resolveLocator: (locator) => {
    if (locator !== exampleLocator) throw new Error(`unknown fixture locator: ${locator}`);
    return { blobId: exampleGitBlob, bytes: exampleBytes };
  },
});

const validateDevelopmentChunkRecord = (record, candidateContract, resolutionContext = validationContextFor(record)) => (
  validateRawDevelopmentChunkRecord(record, candidateContract, resolutionContext)
);

const withInvariantBindingShape = () => {
  const candidate = structuredClone(contract);
  for (const required of [
    candidate.developmentChunkContract.requiredFields,
    candidate.developmentChunkContract.recordShape.requiredFields,
  ]) {
    if (!required.includes(bindingField)) required.push(bindingField);
  }
  candidate.developmentChunkContract.exampleRecord[bindingField] = {
    applicable: false,
    basis: 'The example selects a canonical relation rather than an authority-local invariant',
  };
  return candidate;
};

const canonicalRelationRecord = (relationId) => {
  const relation = contract.relations.find(({ id }) => id === relationId);
  const object = contract.architectureObjects.find(({ id }) => id === relation.objectId);
  const target = [...contract.authorityOwners, ...contract.boundaries, ...contract.channels]
    .find((surface) => (surface.groupId ?? surface.id) === relation.targetId);
  const record = materializeCanonicalDevelopmentChunkRecord(contract);
  record['selection-mode'] = 'RELATION';
  record['consumer-and-scenario'] = { consumerId: target.id, scenarioId: relation.scenarios[0] };
  record['request-or-object-producer-authority'] = object.authorityId ?? object.custodianId;
  record['business-outcome-owner-or-none-with-basis'] = {
    ownerId: relation.businessOutcomeOwnerId ?? null,
    noneBasis: relation.noBusinessOutcomeBasis ?? null,
  };
  record[idsField] = {
    ownerId: relation.objectAuthority,
    objectId: relation.objectId,
    relationId: relation.id,
    invariantId: null,
    docsRoute: relation.docsRoute,
  };
  record['carried-object-authority'] = relation.objectAuthority;
  record['relation-source-role'] = relation.sourceRole;
  record['relation-action-kind'] = relation.relation;
  record['accepted-rejected-unknown-and-replay-semantics'] = structuredClone(relation.semantics);
  return record;
};

const canonicalInvariantRecord = (candidateContract) => {
  const invariant = candidateContract.developmentChunkContract.authorityLocalInvariants
    .find(({ id }) => id === 'agent-shell-cutover');
  const surface = candidateContract.ownerMigrationEnvelope.surfaceClasses
    .find(({ id }) => id === invariant.migrationSurfaceId);
  const record = materializeCanonicalDevelopmentChunkRecord(candidateContract);
  record['selection-mode'] = 'AUTHORITY_LOCAL_INVARIANT';
  record['consumer-and-scenario'] = {
    consumerId: invariant.observableConsumerId,
    scenarioId: invariant.scenarioId,
  };
  record['request-or-object-producer-authority'] = invariant.custodianId;
  record['business-outcome-owner-or-none-with-basis'] = {
    ownerId: null,
    noneBasis: invariant.noBusinessOutcomeBasis,
  };
  record[idsField] = {
    ownerId: invariant.custodianId,
    objectId: invariant.objectId,
    relationId: null,
    invariantId: invariant.id,
    docsRoute: 'architecture/product-edge',
  };
  record['carried-object-authority'] = invariant.custodianId;
  record['relation-source-role'] = 'authority-local-invariant';
  record['relation-action-kind'] = null;
  record['accepted-rejected-unknown-and-replay-semantics'] = structuredClone(invariant.semantics);
  record[bindingField] = {
    applicable: true,
    invariantId: invariant.id,
    migrationSurfaceId: invariant.migrationSurfaceId,
    requiredRelatedObjectIds: structuredClone(invariant.requiredRelatedObjectIds),
    requiredGuarantees: structuredClone(invariant.requiredGuarantees),
  };
  record[migrationField] = {
    applicable: true,
    'migration-slice-identity': 'agent-shell-openclaw-to-codex-v1',
    'surface-class-id': invariant.migrationSurfaceId,
    'current-stage': 'SHADOW_READ_ONLY',
    'next-adjacent-stage': 'PREDECESSOR_FENCED',
    'predecessor-revision': 'openclaw-binding-v1',
    'successor-revision': 'codex-binding-v1',
    'common-evidence-cut': {
      domain: surface.requiredCommonEvidenceCutDomain,
      identity: `${surface.requiredCommonEvidenceCutDomain}:42`,
    },
    'surface-specific-evidence-bindings': structuredClone(surface.requiredEvidenceBindingIds),
    'rollback-or-forward-recovery-disposition': surface.requiredRollbackDispositionId,
    'incident-authority': surface.incidentAuthorityId,
    'kill-observations': structuredClone(surface.requiredKillObservationIds),
  };
  return record;
};

test('relation records retain an explicit non-applicable invariant binding', () => {
  const candidateContract = withInvariantBindingShape();
  const record = materializeCanonicalDevelopmentChunkRecord(candidateContract);
  assert.equal(validateDevelopmentChunkRecord(record, candidateContract).outcome, 'VALID');

  const partial = structuredClone(record);
  partial[bindingField] = { applicable: false };
  assert.equal(validateDevelopmentChunkRecord(partial, candidateContract).outcome, 'INVALID');
});

test('selection mode is a JSON-roundtrip-safe exact discriminant', () => {
  const relationRecord = materializeCanonicalDevelopmentChunkRecord(contract);
  assert.equal(relationRecord['selection-mode'], 'RELATION');
  assert.equal(validateDevelopmentChunkRecord(JSON.parse(JSON.stringify(relationRecord)), contract).outcome, 'VALID');

  const mismatchedRelation = structuredClone(relationRecord);
  mismatchedRelation['selection-mode'] = 'AUTHORITY_LOCAL_INVARIANT';
  assert.equal(validateDevelopmentChunkRecord(mismatchedRelation, contract).outcome, 'INVALID');

  const mismatchedActionKind = structuredClone(relationRecord);
  mismatchedActionKind['relation-action-kind'] = relationRecord['relation-action-kind'] === 'fact' ? 'command' : 'fact';
  assert.equal(validateDevelopmentChunkRecord(mismatchedActionKind, contract).outcome, 'INVALID');

  const invariantRecord = materializeCanonicalInvariantDevelopmentChunkRecord(
    contract,
    'governance-set-wide-capital-allocation',
  );
  assert.equal(invariantRecord['selection-mode'], 'AUTHORITY_LOCAL_INVARIANT');
  assert.equal(invariantRecord[bindingField].migrationSurfaceId, null);
  assert.deepEqual(
    validateDevelopmentChunkRecord(JSON.parse(JSON.stringify(invariantRecord)), contract),
    { outcome: 'VALID', reasons: [] },
  );

  const omittedNull = structuredClone(invariantRecord);
  delete omittedNull[bindingField].migrationSurfaceId;
  assert.equal(validateDevelopmentChunkRecord(omittedNull, contract).outcome, 'INVALID');
});

test('D-only repair serializes the terminal disposition as one closed public Development Chunk', () => {
  const invariantId = 'rd-attended-d-only-strategy-repair';
  const invariant = contract.developmentChunkContract.authorityLocalInvariants
    .find((candidate) => candidate.id === invariantId);
  assert.ok(invariant);
  assert.equal(invariant.objectId, 'd-only-repair-disposition');
  assert.ok(invariant.requiredRelatedObjectIds.includes('strategy-artifact'));
  assert.ok(invariant.requiredGuarantees.includes('D1-build-or-security-admission-failure-terminal-before-validation'));
  assert.match(invariant.semantics.accepted, /D1_BUILD_FAILED closes build package or security admission before Artifact validation/);

  const record = materializeCanonicalInvariantDevelopmentChunkRecord(contract, invariantId);
  assert.deepEqual(Object.keys(record).sort(), [...contract.developmentChunkContract.recordShape.requiredFields].sort());
  assert.deepEqual(record[idsField], {
    ownerId: 'rd',
    objectId: 'd-only-repair-disposition',
    relationId: null,
    invariantId,
    docsRoute: 'owners/rd',
  });
  assert.deepEqual(record[bindingField], {
    applicable: true,
    invariantId,
    migrationSurfaceId: null,
    requiredRelatedObjectIds: invariant.requiredRelatedObjectIds,
    requiredGuarantees: invariant.requiredGuarantees,
  });
  assert.deepEqual(
    validateDevelopmentChunkRecord(JSON.parse(JSON.stringify(record)), contract),
    { outcome: 'VALID', reasons: [] },
  );

  const artifactAsTerminal = structuredClone(record);
  artifactAsTerminal[idsField].objectId = 'strategy-artifact';
  artifactAsTerminal['carried-object-authority'] = 'rd';
  assert.equal(validateDevelopmentChunkRecord(artifactAsTerminal, contract).outcome, 'INVALID');

  const omittedDispositionGuarantee = structuredClone(record);
  omittedDispositionGuarantee[bindingField].requiredGuarantees = omittedDispositionGuarantee[bindingField].requiredGuarantees.slice(1);
  assert.equal(validateDevelopmentChunkRecord(omittedDispositionGuarantee, contract).outcome, 'INVALID');

  const widenedDOnlyMeaning = structuredClone(record);
  widenedDOnlyMeaning['accepted-rejected-unknown-and-replay-semantics'].accepted += ' and deploys the repaired strategy';
  assert.equal(validateDevelopmentChunkRecord(widenedDOnlyMeaning, contract).outcome, 'INVALID');

  const wrongConsumer = structuredClone(record);
  wrongConsumer['consumer-and-scenario'].consumerId = 'backtest';
  assert.equal(validateDevelopmentChunkRecord(wrongConsumer, contract).outcome, 'INVALID');
});

test('incident-only Recovery admission serializes its terminal no-case outcomes without a conjunctive trigger', () => {
  const invariantId = 'execution-recovery-admission-disposition';
  const invariant = contract.developmentChunkContract.authorityLocalInvariants
    .find((candidate) => candidate.id === invariantId);
  assert.ok(invariant);
  assert.equal(invariant.objectId, 'recovery-admission-disposition');
  assert.equal(invariant.docsRoute, 'scenarios/recovery');

  const record = materializeCanonicalInvariantDevelopmentChunkRecord(contract, invariantId);
  assert.deepEqual(record[idsField], {
    ownerId: 'execution',
    objectId: 'recovery-admission-disposition',
    relationId: null,
    invariantId,
    docsRoute: 'scenarios/recovery',
  });
  assert.deepEqual(
    validateDevelopmentChunkRecord(JSON.parse(JSON.stringify(record)), contract),
    { outcome: 'VALID', reasons: [] },
  );
  assert.match(record['accepted-rejected-unknown-and-replay-semantics'].rejected, /NO_RECOVERY_REQUIRED with no Recovery Case/);
  assert.match(record['accepted-rejected-unknown-and-replay-semantics'].unknown, /UNRESOLVED_NO_CASE/);

  const fabricatedCase = structuredClone(record);
  fabricatedCase['accepted-rejected-unknown-and-replay-semantics'].unknown += ' and creates a Recovery Case';
  assert.equal(validateDevelopmentChunkRecord(fabricatedCase, contract).outcome, 'INVALID');

  const wrongRoute = structuredClone(record);
  wrongRoute[idsField].docsRoute = 'owners/execution';
  assert.equal(validateDevelopmentChunkRecord(wrongRoute, contract).outcome, 'INVALID');

  const conjunctiveTrigger = structuredClone(record);
  conjunctiveTrigger[bindingField].requiredGuarantees.push('runtime-not-ready-is-always-required');
  assert.equal(validateDevelopmentChunkRecord(conjunctiveTrigger, contract).outcome, 'INVALID');
});

test('every relation owns complete local semantics with no fallback registry', () => {
  assert.equal(Object.hasOwn(contract, 'protocolProfiles'), false);
  for (const relation of contract.relations) {
    const resolved = resolveEffectiveRelationSemantics(relation, contract);
    assert.equal(resolved.source, 'RELATION_LOCAL');
    assert.deepEqual(Object.keys(resolved.canonical), ['accepted', 'rejected', 'unknown', 'replay']);
    assert.equal(Object.hasOwn(relation, 'profileId'), false);
  }

  const missing = structuredClone(contract.relations[0]);
  delete missing.semantics;
  assert.throws(
    () => resolveEffectiveRelationSemantics(missing, contract),
    /No complete relation-local semantics/,
  );
});

test('relation selection accepts non-business channel handoffs without inventing an Owner outcome', () => {
  const record = canonicalRelationRecord('runtime-events');
  assert.equal(record['consumer-and-scenario'].consumerId, 'event-rail');
  assert.equal(record['business-outcome-owner-or-none-with-basis'].ownerId, null);
  assert.match(record['business-outcome-owner-or-none-with-basis'].noneBasis, /transport/i);
  assert.deepEqual(validateDevelopmentChunkRecord(record, contract), { outcome: 'VALID', reasons: [] });
});

test('public validator accepts a file or stdin and rejects malformed JSON', () => {
  const record = materializeCanonicalDevelopmentChunkRecord(contract);
  const validator = fileURLToPath(new URL('./validate-development-chunk.mjs', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'trade-development-chunk-'));
  try {
    const path = join(directory, 'record.json');
    const contextPath = join(directory, 'verification-context.json');
    writeFileSync(path, JSON.stringify(record));
    writeFileSync(contextPath, JSON.stringify({
      candidateTree: exampleCandidateTree,
      verificationContextDigests: validationContextFor(record).verificationContextDigests,
    }));
    const common = [
      validator,
      '--candidate-tree',
      exampleCandidateTree,
      '--repo',
      repositoryRoot,
      '--verification-context',
      contextPath,
    ];
    const viaStdin = spawnSync(process.execPath, common, {
      encoding: 'utf8',
      input: JSON.stringify(record),
    });
    assert.equal(viaStdin.status, 0, viaStdin.stderr || viaStdin.stdout);
    assert.deepEqual(JSON.parse(viaStdin.stdout), { outcome: 'VALID', reasons: [] });

    const viaFile = spawnSync(process.execPath, [...common, path], { encoding: 'utf8' });
    assert.equal(viaFile.status, 0, viaFile.stderr || viaFile.stdout);
    assert.deepEqual(JSON.parse(viaFile.stdout), { outcome: 'VALID', reasons: [] });

    const missingTreeAuthority = spawnSync(process.execPath, [validator, path], { encoding: 'utf8' });
    assert.equal(missingTreeAuthority.status, 1);
    assert.match(JSON.parse(missingTreeAuthority.stdout).reasons.join('\n'), /candidate-tree/);

    const commitIsNotTree = spawnSync(process.execPath, [
      validator,
      '--candidate-tree',
      exampleCommit,
      '--repo',
      repositoryRoot,
      '--verification-context',
      contextPath,
      path,
    ], { encoding: 'utf8' });
    assert.equal(commitIsNotTree.status, 1);
    assert.match(JSON.parse(commitIsNotTree.stdout).reasons.join('\n'), /does not resolve to a Git tree/);

    const malformed = spawnSync(process.execPath, common, {
      encoding: 'utf8',
      input: '{',
    });
    assert.equal(malformed.status, 1);
    assert.equal(JSON.parse(malformed.stdout).outcome, 'INVALID');
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('implementation references bind every locator to the exact candidate revision', () => {
  const current = materializeCanonicalDevelopmentChunkRecord(contract);
  current['evidence-receipt'].implementationReferenceBindings = [
    {
      candidateRevision: current['evidence-receipt'].candidateRevision,
      locator: 'docs/developer_guide/testing.md',
      classification: 'CURRENT_IMPLEMENTATION_REFERENCE',
      verificationResult: 'VERIFIED_AT_CANDIDATE_REVISION',
      verificationReceipt: finalizeVerificationReceipt(typedVerificationReceipt(
        current['evidence-receipt'].candidateRevision,
        'docs/developer_guide/testing.md',
      )),
      mismatchDisposition: null,
    },
  ];
  assert.deepEqual(validateDevelopmentChunkRecord(current, contract), { outcome: 'VALID', reasons: [] });
  assert.equal(validateRawDevelopmentChunkRecord(current, contract).outcome, 'INVALID');

  const missingResolver = validationContextFor(current);
  delete missingResolver.resolveLocator;
  assert.equal(validateRawDevelopmentChunkRecord(current, contract, missingResolver).outcome, 'INVALID');

  const wrongTree = validationContextFor(current);
  wrongTree.candidateTree = 'f'.repeat(40);
  assert.equal(validateRawDevelopmentChunkRecord(current, contract, wrongTree).outcome, 'INVALID');

  const wrongExternalDigest = validationContextFor(current);
  wrongExternalDigest.verificationContextDigests[exampleLocator] = `sha256:${'f'.repeat(64)}`;
  assert.equal(validateRawDevelopmentChunkRecord(current, contract, wrongExternalDigest).outcome, 'INVALID');

  const legacy = structuredClone(current);
  legacy['evidence-receipt'].implementationReferenceBindings[0] = {
    candidateRevision: legacy['evidence-receipt'].candidateRevision,
    locator: 'docs/developer_guide/testing.md',
    classification: 'LEGACY_REFERENCE',
    verificationResult: 'MISMATCHED_OR_SUPERSEDED',
    verificationReceipt: finalizeVerificationReceipt(typedVerificationReceipt(
      legacy['evidence-receipt'].candidateRevision,
      'docs/developer_guide/testing.md',
    )),
    mismatchDisposition: 'DO_NOT_USE_AND_REPLAN',
  };
  legacy['evidence-receipt'].implementationReferenceBindings[0]
    .verificationReceipt.checkResults[2].evidence =
      'The COMMANDS check resolved a documented command to a removed entrypoint at the frozen candidate revision';
  finalizeVerificationReceipt(legacy['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt);
  assert.deepEqual(validateDevelopmentChunkRecord(legacy, contract), { outcome: 'VALID', reasons: [] });
  assert.equal(validateRawDevelopmentChunkRecord(legacy, contract).outcome, 'INVALID');
});

test('immutable Git resolution rejects self-consistent fabricated stale or mutated reference receipts', () => {
  const record = materializeCanonicalDevelopmentChunkRecord(contract);
  const binding = record['evidence-receipt'].implementationReferenceBindings[0];
  const fabricatedBytes = Buffer.from('fabricated implementation reference\n');
  const fabricatedBlob = createHash('sha1')
    .update(Buffer.from(`blob ${fabricatedBytes.length}\0`))
    .update(fabricatedBytes)
    .digest('hex');
  const fabricatedSha = `sha256:${createHash('sha256').update(fabricatedBytes).digest('hex')}`;
  binding.verificationReceipt.resolvedLocatorIdentity = `tree-path:${binding.locator}@git-blob:${fabricatedBlob}@content-sha256:${fabricatedSha.slice(7)}`;
  binding.verificationReceipt.contentSha256 = fabricatedSha;
  finalizeVerificationReceipt(binding.verificationReceipt);
  assert.equal(validateDevelopmentChunkRecord(record, contract).outcome, 'INVALID');

  const stale = materializeCanonicalDevelopmentChunkRecord(contract);
  const staleRevision = `git-tree:${'e'.repeat(40)}`;
  stale['evidence-receipt'].candidateRevision = staleRevision;
  stale['evidence-receipt'].implementationReferenceBindings[0].candidateRevision = staleRevision;
  stale['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.resolvedCandidateRevision = staleRevision;
  finalizeVerificationReceipt(stale['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt);
  assert.equal(validateDevelopmentChunkRecord(stale, contract).outcome, 'INVALID');

  const mutatedBytes = materializeCanonicalDevelopmentChunkRecord(contract);
  const mutatedContext = validationContextFor(mutatedBytes);
  mutatedContext.resolveLocator = () => ({ blobId: exampleGitBlob, bytes: Buffer.from('mutated bytes') });
  assert.equal(validateRawDevelopmentChunkRecord(mutatedBytes, contract, mutatedContext).outcome, 'INVALID');

  const absent = materializeCanonicalDevelopmentChunkRecord(contract);
  const absentContext = validationContextFor(absent);
  absentContext.resolveLocator = () => { throw new Error('locator absent from immutable tree'); };
  assert.equal(validateRawDevelopmentChunkRecord(absent, contract, absentContext).outcome, 'INVALID');

  const reboundChecks = materializeCanonicalDevelopmentChunkRecord(contract);
  const mainSuppliedContext = validationContextFor(reboundChecks);
  reboundChecks['evidence-receipt'].implementationReferenceBindings[0]
    .verificationReceipt.checkResults[0].evidence = 'Different record-local prose claiming the same check';
  finalizeVerificationReceipt(
    reboundChecks['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt,
  );
  assert.equal(
    validateRawDevelopmentChunkRecord(reboundChecks, contract, mainSuppliedContext).outcome,
    'INVALID',
  );
});

test('implementation-reference bindings fail closed on absence ambiguity staleness or shape drift', () => {
  const record = materializeCanonicalDevelopmentChunkRecord(contract);
  const binding = record['evidence-receipt'].implementationReferenceBindings[0];
  binding.locator = 'docs/developer_guide/testing.md';
  binding.verificationReceipt = finalizeVerificationReceipt(
    typedVerificationReceipt(record['evidence-receipt'].candidateRevision, binding.locator),
  );
  delete binding.verificationEvidence;
  const canonicalResolutionContext = validationContextFor(record);
  const mutations = [
    (candidate) => { candidate['evidence-receipt'].candidateRevision = ''; },
    (candidate) => { candidate['evidence-receipt'].focusedTestResult = ''; },
    (candidate) => { candidate['evidence-receipt'].rootGateResult = ''; },
    (candidate) => { delete candidate['evidence-receipt'].implementationReferenceBindings; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings = []; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].classification = 'REFERENCE'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].candidateRevision = 'candidate:stale-revision'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationResult = 'MISMATCHED_OR_SUPERSEDED'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt = 'checked'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.resolvedCandidateRevision = 'candidate:stale-revision'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.contentSha256 = `sha256:${'b'.repeat(64)}`; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.contentSha256 = 'sha256:checked'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.resolvedLocatorIdentity = 'git-blob:not-an-object-id'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].locator = 'docs/developer_guide/stale.md'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.checkResults.pop(); },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.checkResults[3].kind = 'PATHS'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.checkResults[3].kind = 'FILES'; },
    (candidate) => {
      candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.checkResults.push({
        kind: 'FILES',
        outcome: 'PASS',
        evidence: 'unexpected fifth check',
        basis: null,
      });
    },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.checkResults[0].evidence = 'TODO'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.checkResults[0].basis = 'contradictory'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt.checkResults[0].extra = 'not canonical'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].mismatchDisposition = 'DO_NOT_USE_AND_REPLAN'; },
    (candidate) => { candidate['evidence-receipt'].implementationReferenceBindings[0].extra = 'not canonical'; },
    (candidate) => { candidate['evidence-receipt'].extra = 'not canonical'; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(record);
    mutate(candidate);
    assert.equal(
      validateRawDevelopmentChunkRecord(candidate, contract, canonicalResolutionContext).outcome,
      'INVALID',
    );
  }

  const legacyWithoutNoUse = structuredClone(record);
  legacyWithoutNoUse['evidence-receipt'].implementationReferenceBindings[0] = {
    candidateRevision: legacyWithoutNoUse['evidence-receipt'].candidateRevision,
    locator: 'docs/developer_guide/testing.md',
    classification: 'LEGACY_REFERENCE',
    verificationResult: 'MISMATCHED_OR_SUPERSEDED',
    verificationReceipt: finalizeVerificationReceipt(typedVerificationReceipt(
      legacyWithoutNoUse['evidence-receipt'].candidateRevision,
      'docs/developer_guide/testing.md',
    )),
    mismatchDisposition: null,
  };
  assert.equal(validateDevelopmentChunkRecord(legacyWithoutNoUse, contract).outcome, 'INVALID');

  const explicitNotApplicable = structuredClone(record);
  explicitNotApplicable['evidence-receipt'].implementationReferenceBindings[0]
    .verificationReceipt.checkResults[1] = {
      kind: 'SYMBOLS',
      outcome: 'NOT_APPLICABLE_WITH_BASIS',
      evidence: null,
      basis: 'This locator contains repository command guidance and names no source symbol',
    };
  finalizeVerificationReceipt(
    explicitNotApplicable['evidence-receipt'].implementationReferenceBindings[0].verificationReceipt,
  );
  assert.deepEqual(validateDevelopmentChunkRecord(explicitNotApplicable, contract), { outcome: 'VALID', reasons: [] });

  for (const mutate of [
    (result) => { result.basis = ''; },
    (result) => { result.evidence = 'Not applicable'; },
    (result) => { result.outcome = 'SKIPPED'; },
  ]) {
    const invalidNotApplicable = structuredClone(explicitNotApplicable);
    mutate(invalidNotApplicable['evidence-receipt'].implementationReferenceBindings[0]
      .verificationReceipt.checkResults[1]);
    assert.equal(validateDevelopmentChunkRecord(invalidNotApplicable, contract).outcome, 'INVALID');
  }

  const duplicateLocator = structuredClone(record);
  duplicateLocator['evidence-receipt'].implementationReferenceBindings.push(
    structuredClone(duplicateLocator['evidence-receipt'].implementationReferenceBindings[0]),
  );
  assert.equal(validateDevelopmentChunkRecord(duplicateLocator, contract).outcome, 'INVALID');
});

test('authority-local invariant records bind exact invariant and applicable migration evidence', () => {
  const candidateContract = withInvariantBindingShape();
  const record = canonicalInvariantRecord(candidateContract);
  assert.deepEqual(validateDevelopmentChunkRecord(record, candidateContract), { outcome: 'VALID', reasons: [] });

  const contradictoryBasis = structuredClone(record);
  contradictoryBasis['business-outcome-owner-or-none-with-basis'].noneBasis = 'Cutover itself commits the receiving Owner business outcome';
  assert.equal(validateDevelopmentChunkRecord(contradictoryBasis, candidateContract).outcome, 'INVALID');

  const withoutBinding = structuredClone(record);
  delete withoutBinding[bindingField];
  assert.equal(validateDevelopmentChunkRecord(withoutBinding, candidateContract).outcome, 'INVALID');

  const nonApplicable = structuredClone(record);
  nonApplicable[migrationField] = { applicable: false, basis: 'No migration required' };
  assert.equal(validateDevelopmentChunkRecord(nonApplicable, candidateContract).outcome, 'INVALID');

  for (const [field, replacement] of [
    ['invariantId', 'different-invariant'],
    ['migrationSurfaceId', 'order-and-external-effect-facts'],
    ['requiredRelatedObjectIds', ['research-request']],
    ['requiredGuarantees', ['all-in-flight-request-identities-resolvable']],
  ]) {
    const mismatch = structuredClone(record);
    mismatch[bindingField][field] = replacement;
    assert.equal(validateDevelopmentChunkRecord(mismatch, candidateContract).outcome, 'INVALID', field);
  }

  for (const [field, replacement] of [
    ['surface-class-id', 'order-and-external-effect-facts'],
    ['surface-specific-evidence-bindings', ['successor-binding-activation']],
    ['kill-observations', ['dual-shell-writer']],
    ['incident-authority', 'execution'],
    ['next-adjacent-stage', 'VERIFIED'],
  ]) {
    const mismatch = structuredClone(record);
    mismatch[migrationField][field] = replacement;
    assert.equal(validateDevelopmentChunkRecord(mismatch, candidateContract).outcome, 'INVALID', field);
  }

  const partialMigration = structuredClone(record);
  delete partialMigration[migrationField]['common-evidence-cut'];
  assert.equal(validateDevelopmentChunkRecord(partialMigration, candidateContract).outcome, 'INVALID');
});

test('R57 critical owner-local decisions are selectable as one bounded development chunk', () => {
  const requiredInvariantIds = [
    'governance-set-wide-capital-allocation',
    'rd-research-iteration-and-selection',
    'risk-recovery-safety-envelope',
    'execution-recovery-effect-attempt',
    'scanner-due-slot-attempt',
    'portfolio-degradation-attribution',
    'risk-intent-sequence-and-rejection',
    'rd-external-source-trust',
  ];
  const registry = new Map(contract.developmentChunkContract.authorityLocalInvariants.map((invariant) => [invariant.id, invariant]));
  for (const id of requiredInvariantIds) {
    const invariant = registry.get(id);
    assert.ok(invariant, `${id} is not selectable`);
    assert.ok(invariant.requiredRelatedObjectIds.length > 0, `${id} has no related object binding`);
    assert.ok(invariant.requiredGuarantees.length >= 4, `${id} has no focused oracle set`);
    assert.deepEqual(Object.keys(invariant.semantics), ['accepted', 'rejected', 'unknown', 'replay']);
  }

  const candidateContract = withInvariantBindingShape();
  const invariant = registry.get('governance-set-wide-capital-allocation');
  const record = materializeCanonicalDevelopmentChunkRecord(candidateContract);
  record['selection-mode'] = 'AUTHORITY_LOCAL_INVARIANT';
  record['consumer-and-scenario'] = { consumerId: invariant.observableConsumerId, scenarioId: invariant.scenarioId };
  record['request-or-object-producer-authority'] = invariant.authorityId;
  record['business-outcome-owner-or-none-with-basis'] = { ownerId: invariant.authorityId, noneBasis: null };
  record[idsField] = {
    ownerId: invariant.authorityId,
    objectId: invariant.objectId,
    relationId: null,
    invariantId: invariant.id,
    docsRoute: 'owners/strategy-governance',
  };
  record['carried-object-authority'] = invariant.authorityId;
  record['relation-source-role'] = 'authority-local-invariant';
  record['relation-action-kind'] = null;
  record['accepted-rejected-unknown-and-replay-semantics'] = structuredClone(invariant.semantics);
  record[bindingField] = {
    applicable: true,
    invariantId: invariant.id,
    migrationSurfaceId: invariant.migrationSurfaceId ?? null,
    requiredRelatedObjectIds: structuredClone(invariant.requiredRelatedObjectIds),
    requiredGuarantees: structuredClone(invariant.requiredGuarantees),
  };
  record[migrationField] = { applicable: false, basis: 'No authority migration is part of this chunk' };
  assert.deepEqual(validateDevelopmentChunkRecord(record, candidateContract), { outcome: 'VALID', reasons: [] });

  const widened = structuredClone(record);
  widened[bindingField].requiredGuarantees = [...invariant.requiredGuarantees, 'implement-the-whole-scenario'];
  assert.equal(validateDevelopmentChunkRecord(widened, candidateContract).outcome, 'INVALID');
});

const canonicalRelationMigrationRecord = (relationId, surfaceId) => {
  const relation = contract.relations.find(({ id }) => id === relationId);
  const surface = contract.ownerMigrationEnvelope.surfaceClasses.find(({ id }) => id === surfaceId);
  const object = contract.architectureObjects.find(({ id }) => id === relation.objectId);
  const target = [...contract.authorityOwners, ...contract.boundaries].find(({ groupId }) => groupId === relation.targetId);
  const record = materializeCanonicalDevelopmentChunkRecord(contract);
  record['consumer-and-scenario'] = { consumerId: target.id, scenarioId: relation.scenarios[0] };
  record['request-or-object-producer-authority'] = object.authorityId ?? object.custodianId;
  record['business-outcome-owner-or-none-with-basis'] = {
    ownerId: relation.businessOutcomeOwnerId,
    noneBasis: relation.noBusinessOutcomeBasis ?? null,
  };
  record[idsField] = {
    ownerId: relation.objectAuthority,
    objectId: relation.objectId,
    relationId: relation.id,
    invariantId: null,
    docsRoute: relation.docsRoute,
  };
  record['carried-object-authority'] = relation.objectAuthority;
  record['relation-source-role'] = relation.sourceRole;
  record['relation-action-kind'] = relation.relation;
  record['accepted-rejected-unknown-and-replay-semantics'] = structuredClone(
    resolveEffectiveRelationSemantics(relation, contract).canonical,
  );
  record[migrationField] = {
    applicable: true,
    'migration-slice-identity': `${surfaceId}-slice-v1`,
    'surface-class-id': surface.id,
    'current-stage': 'SHADOW_READ_ONLY',
    'next-adjacent-stage': 'PREDECESSOR_FENCED',
    'predecessor-revision': `${surfaceId}-predecessor-v1`,
    'successor-revision': `${surfaceId}-successor-v1`,
    'common-evidence-cut': {
      domain: surface.requiredCommonEvidenceCutDomain,
      identity: `${surface.requiredCommonEvidenceCutDomain}:42`,
    },
    'surface-specific-evidence-bindings': structuredClone(surface.requiredEvidenceBindingIds),
    'rollback-or-forward-recovery-disposition': surface.requiredRollbackDispositionId,
    'incident-authority': surface.incidentAuthorityId,
    'kill-observations': structuredClone(surface.requiredKillObservationIds),
  };
  return record;
};

test('R58 migration chunks keep Runtime checkpoint readiness separate from Execution Recovery closure', () => {
  const runtime = canonicalRelationMigrationRecord(
    'runtime-execution-readiness',
    'strategy-generation-checkpoint-readiness',
  );
  const execution = canonicalRelationMigrationRecord(
    'execution-governance-closed',
    'recovery-case-closure',
  );
  assert.deepEqual(validateDevelopmentChunkRecord(runtime, contract), { outcome: 'VALID', reasons: [] });
  assert.deepEqual(validateDevelopmentChunkRecord(execution, contract), { outcome: 'VALID', reasons: [] });

  const executionOnRuntimeSurface = structuredClone(execution);
  executionOnRuntimeSurface[migrationField] = structuredClone(runtime[migrationField]);
  assert.equal(validateDevelopmentChunkRecord(executionOnRuntimeSurface, contract).outcome, 'INVALID');

  const runtimeOnRecoverySurface = structuredClone(runtime);
  runtimeOnRecoverySurface[migrationField] = structuredClone(execution[migrationField]);
  assert.equal(validateDevelopmentChunkRecord(runtimeOnRecoverySurface, contract).outcome, 'INVALID');

  const incompleteRecoveryCut = structuredClone(execution);
  incompleteRecoveryCut[migrationField]['surface-specific-evidence-bindings'] = [
    'runtime-readiness-source-frontier',
    'active-risk-fence-and-frontier',
  ];
  assert.equal(validateDevelopmentChunkRecord(incompleteRecoveryCut, contract).outcome, 'INVALID');
});
