import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
  REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
  REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  assertReplaySpawnBoundaryRevalidationReceipt,
  createReplayAttemptLeaseObservationRegistryReadReceipt,
  createReplayAttemptLeaseObservationSnapshot,
  createReplayDispatchClockAttestation,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  createReplaySpawnBoundaryRevalidationReceipt,
  hashReplayAttemptLeaseSnapshot,
  hashTrialReservationSnapshot,
  replayDispatchClockAttestationIdentityHash,
  replaySpawnBoundaryRevalidationReceiptIdentityHash,
  type ReplayAttemptLeaseSnapshot,
  type ReplaySpawnBoundaryRevalidationRequest,
  type TrialReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  canonicalJson,
  createReplayDecisionHarnessBuildAttestation,
  createReplayDecisionInputSnapshot,
  createReplayDecisionHarnessContext,
  createReplayDecisionHarnessSourceBundle,
  createReplayDecisionMarketInputSnapshot,
  createReplayDecisionStateSnapshot,
  createReplayInstrumentStatusProvenance,
  replayDatasetHash,
  replayExecutionSpecHash,
  type ReplayDatasetManifest,
  type ReplayDecisionScheduleEntry,
  type ReplayExecutionRequest,
  type ReplayMarketBar,
  type ReplaySourceEvent,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
  REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
  createReplaySourceEventDecisionObservationHarnessContextBinding,
  createReplaySourceEventDecisionObservationHarnessContextBindingEntry,
  type ReplaySourceEventDecisionObservationHarnessContextBindingBody,
} from "../../../contracts/src/lib/replay-source-event-decision-observation-harness-context-binding"
import {
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION,
  REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION,
  createReplayDecisionWorkerInputAssemblyV2,
  createReplayDecisionWorkerInputAssemblyV2Entry,
  type ReplayDecisionWorkerInputAssemblyV2Body,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v2"
import {
  assertReplayDecisionWorkerInputAssemblyV3,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v3"
import {
  assertReplayDecisionWorkerInputAssemblyV4,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v4"
import {
  assertReplayDecisionHarnessCodeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-code-admission"
import {
  assertReplayDecisionHarnessInvocationIdentitySet,
  createReplayDecisionHarnessInvocationIdentityEntry,
  deriveReplayDecisionHarnessInvocationId,
} from "../../../contracts/src/lib/replay-decision-harness-invocation-identity"
import {
  REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
  assertReplayDecisionHarnessLogicalRequestIdentityUpgrade,
  createReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry,
  deriveReplayDecisionHarnessLogicalRequestId,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessWorkerRequestV10,
  assertReplayDecisionHarnessWorkerRequestV10Materialization,
} from "../../../contracts/src/lib/replay-decision-harness-worker-request-v10"
import {
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerResponseV10,
  assertReplayDecisionHarnessWorkerResponseV10Contract,
  type ReplayDecisionHarnessWorkerResponseV10Body,
} from "../../../contracts/src/lib/replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessDispatchLeaseAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-admission"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDecisionHarnessDispatchEvidenceRegistration,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-evidence-registration"
import {
  assertReplayDecisionHarnessDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapability,
  createReplayDecisionHarnessWorkerV10BuildCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import {
  assertReplayDecisionHarnessWorkerV10RequestFrame,
  assertReplayDecisionHarnessWorkerV10ResponseFrame,
  assertReplayDecisionHarnessWorkerV10TransportContract,
  createReplayDecisionHarnessWorkerV10RequestFrame,
  createReplayDecisionHarnessWorkerV10ResponseFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  assertReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  createReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  createReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS,
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import {
  assertReplayPositionOpenStateInputMaterialization,
} from "../../../contracts/src/lib/replay-position-open-state-input-materialization"
import {
  assertReplayPositionOpenStateInputMaterializationLineage,
  buildReplayPositionOpenStateInputMaterialization,
} from "../../../engine/src/lib/replay-position-open-state-input-materialization"
import {
  assertReplayDecisionWorkerInputAssemblyV3Lineage,
  buildReplayDecisionWorkerInputAssemblyV3,
} from "../../../engine/src/lib/replay-decision-worker-input-assembly-v3"
import { buildReplayDecisionHarness } from "./replay-decision-harness-build"
import { runReplayTrial } from "./replay-trial-runner"
import {
  createReplayDecisionHarnessCutoverRegistry,
  createReplayDecisionHarnessRegistry,
  executeReplayDecisionHarness,
} from "./replay-decision-harness"
import {
  assertReplayDecisionHarnessCodeAdmissionLineage,
  buildReplayDecisionHarnessCodeAdmission,
} from "./replay-decision-harness-code-admission"
import {
  readReplayDispatchEvidence,
  registerReplayDispatchEvidence,
} from "./replay-dispatch-evidence-registry"
import {
  claimReplayDispatch,
  readReplayDispatchClaim,
} from "./replay-dispatch-claim-registry"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapabilityLineage,
  buildReplayDecisionHarnessWorkerV10Capability,
} from "./replay-decision-harness-worker-v10-build"
import {
  readReplayWorkerV10BuildCapability,
  registerReplayWorkerV10BuildCapability,
} from "./replay-worker-v10-build-capability-registry"
import {
  assertReplayDecisionHarnessWorkerV10TransportContractLineage,
  buildReplayDecisionHarnessWorkerV10TransportContract,
} from "./replay-decision-harness-worker-v10-transport-contract"
import {
  readReplayWorkerV10TransportContract,
  registerReplayWorkerV10TransportContract,
} from "./replay-worker-v10-transport-contract-registry"
import {
  assertReplayDecisionHarnessWorkerV10StdioCapabilityLineage,
  buildReplayDecisionHarnessWorkerV10StdioCapability,
} from "./replay-decision-harness-worker-v10-stdio-build"
import {
  readReplayWorkerV10StdioCapability,
  registerReplayWorkerV10StdioCapability,
} from "./replay-worker-v10-stdio-capability-registry"
import {
  readReplayWorkerV10NegativeProbeReceipt,
  runReplayWorkerV10NegativeProbeSuite,
} from "./replay-worker-v10-negative-probe-registry"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContractLineage,
  buildReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "./replay-decision-harness-worker-v10-successor-transport-contract"
import {
  readReplayWorkerV10SuccessorTransportContract,
  registerReplayWorkerV10SuccessorTransportContract,
} from "./replay-worker-v10-successor-transport-contract-registry"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContractLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "./replay-decision-harness-worker-v10-execution-admission-contract"
import {
  readReplayWorkerV10ExecutionAdmissionContract,
  registerReplayWorkerV10ExecutionAdmissionContract,
} from "./replay-worker-v10-execution-admission-contract-registry"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "./replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import {
  readReplayWorkerV10ExecutionAdmissionPreIssueBundle,
  registerReplayWorkerV10ExecutionAdmissionPreIssueBundle,
} from "./replay-worker-v10-execution-admission-pre-issue-registry"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "./replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  readReplayWorkerV10ExecutionAdmissionRegistryProvenance,
  registerReplayWorkerV10ExecutionAdmissionRegistryProvenance,
} from "./replay-worker-v10-execution-admission-registry-provenance-registry"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
} from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  readReplayWorkerV10ExecutionAdmissionClockAttestation,
  registerReplayWorkerV10ExecutionAdmissionClockAttestation,
} from "./replay-worker-v10-execution-admission-clock-attestation-registry"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandLineage,
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "./replay-decision-harness-worker-v10-execution-admission-command"
import {
  issueReplayWorkerV10ExecutionAdmissionCommand,
  readReplayWorkerV10ExecutionAdmissionCommand,
} from "./replay-worker-v10-execution-admission-command-registry"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntentLineage,
  buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-process-launch-intent"
import {
  issueReplayWorkerV10ProcessLaunchIntent,
  readReplayWorkerV10ProcessLaunchIntent,
} from "./replay-worker-v10-process-launch-intent-registry"
import {
  readReplayWorkerV10ProcessLaunchReadinessGate,
  registerReplayWorkerV10ProcessLaunchReadinessGate,
} from "./replay-worker-v10-process-launch-readiness-gate-registry"
import {
  launchReplayWorkerV10AuthorityProcess,
  readReplayWorkerV10AuthorityProcessLaunchAttempt,
  readReplayWorkerV10AuthorityProcessLaunchReceipt,
} from "./replay-worker-v10-authority-process-launch-registry"
import {
  dispatchReplayWorkerV10AuthorityRequest,
  readReplayWorkerV10AuthorityRequestDispatchAttempt,
  readReplayWorkerV10AuthorityRequestDispatchReceipt,
} from "./replay-worker-v10-authority-request-dispatch-registry"
import {
  executeReplayWorkerV10Cutover,
  readReplayWorkerV10CutoverReceipt,
} from "./replay-worker-v10-cutover"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import {
  admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "./replay-worker-v10-successor-spawn-boundary-revalidation-registry"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  readReplayWorkerV10AuthorityFrameBuildContract,
  registerReplayWorkerV10AuthorityFrameBuildContract,
} from "./replay-worker-v10-authority-frame-build-contract-registry"
import {
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityLineage,
  buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "./replay-decision-harness-worker-v10-activated-stdio-build"
import {
  readReplayWorkerV10ActivatedStdioCapability,
  registerReplayWorkerV10ActivatedStdioCapability,
} from "./replay-worker-v10-activated-stdio-capability-registry"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContractLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "./replay-decision-harness-worker-v10-authority-transport-contract"
import {
  readReplayWorkerV10AuthorityTransportContract,
  registerReplayWorkerV10AuthorityTransportContract,
} from "./replay-worker-v10-authority-transport-contract-registry"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "./replay-decision-harness-worker-v10-authority-execution-admission-command"
import {
  issueReplayWorkerV10AuthorityExecutionAdmissionCommand,
  readReplayWorkerV10AuthorityExecutionAdmissionCommand,
} from "./replay-worker-v10-authority-execution-admission-command-registry"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-authority-process-launch-intent"
import {
  issueReplayWorkerV10AuthorityProcessLaunchIntent,
  readReplayWorkerV10AuthorityProcessLaunchIntent,
} from "./replay-worker-v10-authority-process-launch-intent-registry"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleLineage,
  buildReplayDecisionHarnessWorkerV10AuthorityCapsule,
} from "./replay-decision-harness-worker-v10-authority-capsule"
import {
  materializeReplayWorkerV10AuthorityCapsule,
  readReplayWorkerV10AuthorityCapsule,
} from "./replay-worker-v10-authority-capsule-registry"
import {
  buildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest,
} from "./replay-worker-v10-authority-spawn-boundary-revalidation-request"
import {
  issueReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest,
  readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest,
} from "./replay-worker-v10-authority-spawn-boundary-revalidation-request-registry"
import {
  buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "./replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import {
  readReplayWorkerV10AuthoritySpawnBoundaryRevalidation,
  registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "./replay-worker-v10-authority-spawn-boundary-revalidation-registry"
import {
  assertReplayDecisionHarnessInvocationIdentityLineage,
  buildReplayDecisionHarnessInvocationIdentitySet,
} from "./replay-decision-harness-invocation-identity"
import {
  assertReplayDecisionHarnessLogicalRequestIdentityUpgradeLineage,
  buildReplayDecisionHarnessLogicalRequestIdentityUpgrade,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessWorkerRequestV10MaterializationLineage,
  buildReplayDecisionHarnessWorkerRequestV10Materialization,
} from "./replay-decision-harness-worker-request-v10"
import {
  assertReplayDecisionHarnessWorkerResponseV10ContractLineage,
  buildReplayDecisionHarnessWorkerResponseV10Contract,
} from "./replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessExecutionEnvelopeLineage,
  buildReplayDecisionHarnessExecutionEnvelope,
} from "./replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessDispatchLeaseAdmissionLineage,
  buildReplayDecisionHarnessDispatchLeaseAdmission,
} from "./replay-decision-harness-dispatch-lease-admission"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBindingLineage,
  buildReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "./replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDecisionWorkerInputAssemblyV4Lineage,
  buildReplayDecisionWorkerInputAssemblyV4,
} from "./replay-decision-worker-input-assembly-v4"
import {
  expectAuthorityDispatch,
  expectAuthorityProcessLaunch,
  expectAuthoritySpawnBoundary,
} from "./replay-worker-v10-authority-stage.assertions"
import {
  expectFormalCutoverAdmission,
  expectWorkerV10Cutover,
} from "./replay-worker-v10-cutover-legacy-stage.assertions"
import { runReplayWorkerV10LegacyActivationStage } from "./replay-worker-v10-legacy-activation-stage"
import { runReplayWorkerV10SuccessorSpawnStage } from "./replay-worker-v10-successor-spawn-stage"
import { runReplayWorkerV10SuccessorCommandStage } from "./replay-worker-v10-successor-command-stage"
import { runReplayWorkerV10SuccessorIntentStage } from "./replay-worker-v10-successor-intent-stage"
import { runReplayWorkerV10SuccessorCapsuleStage } from "./replay-worker-v10-successor-capsule-stage"
import { runReplayWorkerV10SuccessorIntegrityStage } from "./replay-worker-v10-successor-integrity-stage"
import { runReplayWorkerV10UpstreamIntegrityStage } from "./replay-worker-v10-upstream-integrity-stage"
import { runReplayWorkerV10SuccessorExecutionStage } from "./replay-worker-v10-successor-execution-stage"
import { runReplayWorkerV10SuccessorLeaseStage } from "./replay-worker-v10-successor-lease-stage"
import { runReplayWorkerV10AuthorityResponseStage } from "./replay-worker-v10-authority-response-stage"

const HASH = "a".repeat(64)
const ACCOUNTING = {
  spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  product_type: "linear_derivative" as const,
  base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1",
  price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001",
}
const MAINTENANCE_TIER = {
  tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH,
  notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0,
}
const RISK_SNAPSHOT = {
  schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1,
  maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50,
}
const SPEC_SNAPSHOT = {
  schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT",
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:spec-1", source_hash: HASH,
}
const STATUS_SNAPSHOT = {
  schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const,
  effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:status-1", source_hash: HASH,
}
const PROVIDER_CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "status-provider-certification-r4-152",
  certification_ref: "certification://fixture-status-provider/v1",
  status: "certified",
  certified_at: "2026-07-13T00:00:00Z",
  valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane",
  certification_policy_version: "rd-status-provider-certification-v1",
  provider_capability_hash: HASH,
  producer_domain: "market-data-products",
  producer_id: "fixture-status-producer",
  producer_version: "v1",
  producer_build_hash: HASH,
  normalization_policy_version: "fixture-status-normalization-v1",
  normalization_policy_hash: HASH,
  allowed_source_kind: "venue_status_event_archive",
  allowed_completeness: "complete_history",
})
const STATUS_PROVENANCE = createReplayInstrumentStatusProvenance({
  producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1",
  producer_build_hash: HASH, source_owner: "binance-usdm", provider_capability_hash: HASH,
  provider_certification_ref: PROVIDER_CERTIFICATION.certification_ref,
  provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
  source_kind: "venue_status_event_archive", normalization_policy_version: "fixture-status-normalization-v1",
  normalization_policy_hash: HASH, completeness: "complete_history", coverage_start: "2020-01-01T00:00:00Z",
  coverage_end: "2030-01-01T00:00:00Z", source_observed_through: "2026-07-13T00:00:00Z",
  produced_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-source", source_hash: HASH,
  source_record_count: 1, status_epochs: [STATUS_SNAPSHOT],
})

const GOLDEN_REPLAY_BARS: ReplayMarketBar[] = [
  { open_time: "2026-07-14T00:00:00.000Z", close_time: "2026-07-14T04:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
  { open_time: "2026-07-14T04:00:00.000Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
  { open_time: "2026-07-14T08:00:00.000Z", close_time: "2026-07-14T12:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true },
]
const GOLDEN_REPLAY_DATASET_HASH = replayDatasetHash(GOLDEN_REPLAY_BARS)

function request(
  candidateHash = HASH,
  harnessHash = HASH,
  datasetHash = HASH,
): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T04:00:00Z",
    earliest_executable_time: "2026-07-14T08:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const schedule = {
    schema_version: "trade.rd-replay-decision-schedule.v13" as const,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [{
      decision_sequence: 1, decision_time: order.signal_time,
      expected_effect: "authorized_initial_order" as const,
      authorized_order_hash: canonicalHash(order), authorized_reduce_only_exit: null,
      authorized_protective_stop_replace: null, authorized_partial_reduce: null,
    }, {
      decision_sequence: 2, decision_time: "2026-07-14T12:00:00Z", expected_effect: "no_action" as const,
      authorized_order_hash: null, authorized_reduce_only_exit: null,
      authorized_protective_stop_replace: null, authorized_partial_reduce: null,
    }],
  }
  const marketRequirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const,
    source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const,
    lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const,
    undeclared_input_policy: "reject" as const,
  }
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "state-materialization-run", idempotency_key: "state-materialization-idem",
    experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH,
    trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: candidateHash,
    identity_hash_policy_version: "rd-identity-v1", experiment_contract_hash: HASH,
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://fixture", dataset_hash: datasetHash,
    supplemental_facts_hash: canonicalHash([]),
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: marketRequirement,
    decision_market_input_requirement_hash: canonicalHash(marketRequirement),
    decision_schedule: schedule, decision_schedule_hash: canonicalHash(schedule),
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]),
    instrument_spec_schedule_hash: canonicalHash({ epochs: [SPEC_SNAPSHOT], accounting: ACCOUNTING }),
    instrument_status_schedule_hash: canonicalHash([STATUS_SNAPSHOT]),
    instrument_status_provenance_hash: canonicalHash(STATUS_PROVENANCE),
    instrument_status_provider_capability_hash: HASH,
    instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
    harness_hash: harnessHash, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order, cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle",
      earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open",
      position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open",
      margin_evaluation: "before_strategy_orders",
    },
    margin_policy: {
      policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated",
      collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1,
      maintenance_tier: structuredClone(MAINTENANCE_TIER), cashflow_scope: "position_attributed",
      collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat",
      settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path",
      mark_source_policy: "complete_exact_mark_else_ohlcv_adverse",
      maintenance_trigger: "margin_balance_below_maintenance_requirement",
      breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event",
      maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure",
      liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark",
      liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position",
      liquidation_order_priority: "cancel_strategy_exits_before_forced_fill",
      liquidation_deficit: "fail_without_result",
    },
    random_seed: 1,
  }
}

function authorizeReplayTrialRequest(requestValue: ReplayExecutionRequest): TrialReservationSnapshot {
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: `reservation:${requestValue.run_id}`,
    reservation_ref: requestValue.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z",
    expires_at: "2026-07-15T00:00:00Z",
    status: "reserved",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: requestValue.experiment_id,
      trial_group_id: requestValue.trial_group_id,
      trial_group_hash: requestValue.trial_group_hash,
      trial_id: requestValue.trial_id,
      candidate_id: requestValue.candidate_id,
      candidate_hash: requestValue.candidate_hash,
      identity_hash_policy_version: requestValue.identity_hash_policy_version,
      experiment_contract_hash: requestValue.experiment_contract_hash,
    },
    trial_ordinal: 1,
    run_id: requestValue.run_id,
    counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1",
    candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: requestValue.idempotency_key,
      execution_spec_hash: replayExecutionSpecHash(requestValue),
      dataset_manifest_ref: requestValue.dataset_manifest_ref,
      dataset_hash: requestValue.dataset_hash,
      liquidity_capacity_attestation_hash: null,
      supplemental_facts_hash: requestValue.supplemental_facts_hash,
      supplemental_requirement_set_hash: requestValue.supplemental_requirement_set_hash,
      venue_risk_policy_schedule_hash: requestValue.venue_risk_policy_schedule_hash,
      instrument_spec_schedule_hash: requestValue.instrument_spec_schedule_hash,
      instrument_status_schedule_hash: requestValue.instrument_status_schedule_hash,
      instrument_status_provenance_hash: requestValue.instrument_status_provenance_hash,
      instrument_status_provider_capability_hash: requestValue.instrument_status_provider_capability_hash,
      instrument_status_provider_certification_hash: requestValue.instrument_status_provider_certification_hash,
      harness_hash: requestValue.harness_hash,
      assumptions_hash: requestValue.assumptions_hash,
      cost_policy_hash: canonicalHash(requestValue.cost_policy),
      margin_policy_hash: canonicalHash(requestValue.margin_policy),
      simulator_policy_version: requestValue.simulator_policy.version,
      execution_mode: "step",
    },
    instrument_status_provider_certification: PROVIDER_CERTIFICATION,
    required_capabilities: [...REPLAY_CERTIFIED_CAPABILITIES],
  }
  requestValue.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  return reservation
}

function goldenReplayDatasetManifest(): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-r4-152",
    manifest_ref: "dataset://fixture",
    data_hash: GOLDEN_REPLAY_DATASET_HASH,
    dataset_kind: "ohlcv",
    symbol: "BTCUSDT",
    timeframe: "4h",
    interval_ms: 14_400_000,
    row_count: GOLDEN_REPLAY_BARS.length,
    first_open_time: GOLDEN_REPLAY_BARS[0]!.open_time,
    last_close_time: GOLDEN_REPLAY_BARS.at(-1)!.close_time,
    observed_through: GOLDEN_REPLAY_BARS.at(-1)!.close_time,
    closed_candles_only: true,
    bar_final_availability: "close_time",
    funding_availability: "event_time",
    mark_availability: "event_time",
    mark_coverage: "none",
    mark_interval_ms: null,
    mark_event_count: 0,
    supplemental_facts: {
      coverage: "none",
      record_count: 0,
      source_ids: [],
      content_hash: canonicalHash([]),
      requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    },
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z",
      trading_enabled_at: "2020-01-01T00:00:00Z",
      delisted_at: null,
      status_history: "complete",
      status_epochs: [STATUS_SNAPSHOT],
      status_provenance: STATUS_PROVENANCE,
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}

function contextBinding(requestValue: ReplayExecutionRequest) {
  const entries = requestValue.decision_schedule.entries.map((scheduleEntry: ReplayDecisionScheduleEntry) => {
    const context = createReplayDecisionHarnessContext(requestValue, scheduleEntry)
    return createReplaySourceEventDecisionObservationHarnessContextBindingEntry({
      schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_ENTRY_SCHEMA_VERSION,
      decision_sequence: scheduleEntry.decision_sequence, decision_time: scheduleEntry.decision_time,
      selected_expected_effect: scheduleEntry.expected_effect,
      selected_schedule_entry_hash: canonicalHash(scheduleEntry),
      schedule_binding_id: `fixture-schedule-binding-${scheduleEntry.decision_sequence}`,
      schedule_binding_hash: HASH,
      observation_projection_id: `fixture-observation-projection-${scheduleEntry.decision_sequence}`,
      observation_projection_hash: HASH, observation_as_of_time: scheduleEntry.decision_time,
      observation_count: 1, observations_hash: HASH, observation_values_hash: HASH,
      visibility_cut_hash: HASH, pit_payload_view_hash: HASH, harness_hash: requestValue.harness_hash,
      harness_context: context, harness_context_hash: canonicalHash(context),
    })
  })
  const bodyWithoutId: Omit<ReplaySourceEventDecisionObservationHarnessContextBindingBody, "binding_id"> = {
    schema_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_SCHEMA_VERSION,
    binding_policy_version: REPLAY_SOURCE_EVENT_DECISION_OBSERVATION_HARNESS_CONTEXT_BINDING_POLICY_VERSION,
    scope: "pre_integration_non_economic_observation_harness_context_binding",
    binding_purpose: "bind_admitted_observation_boundaries_to_frozen_harness_context_identity",
    authority_source: "control_plane_derivation_admission", context_derivation: "canonical_request_and_schedule_entry",
    observation_binding: "admitted_bundle_member_identity_only", decision_input_materialization: "not_certified",
    supplemental_input_compatibility: "not_bound", market_input_compatibility: "not_bound",
    state_input_compatibility: "not_bound", worker_request_compatibility: "not_bound",
    harness_invocation: "forbidden", decision_output_authority: "none", signal_authority: "none",
    order_authority: "none", economic_authority: "none", runner_compatibility: "not_bound",
    request_schema_version: requestValue.schema_version, request_hash: canonicalHash(requestValue),
    run_id: requestValue.run_id, experiment_id: requestValue.experiment_id,
    trial_group_id: requestValue.trial_group_id, trial_id: requestValue.trial_id,
    candidate_id: requestValue.candidate_id, candidate_hash: requestValue.candidate_hash,
    reservation_ref: requestValue.trial_reservation_ref, reservation_hash: requestValue.trial_reservation_hash,
    dataset_manifest_ref: requestValue.dataset_manifest_ref, dataset_hash: requestValue.dataset_hash,
    derivation_admission_id: "fixture-derivation-admission-1",
    derivation_admission_ref: "admission://fixture/derivation-1", derivation_admission_hash: HASH,
    bundle_id: "fixture-observation-bundle-1", bundle_hash: HASH,
    decision_schedule_hash: requestValue.decision_schedule_hash, harness_hash: requestValue.harness_hash,
    harness_context_schema_version: entries[0]!.harness_context.schema_version,
    entry_count: entries.length, entries, entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    harness_context_hashes_hash: canonicalHash(entries.map((entry) => entry.harness_context_hash)),
    observation_projection_hashes_hash: canonicalHash(entries.map((entry) => entry.observation_projection_hash)),
    first_decision_time: entries[0]!.decision_time, last_decision_time: entries.at(-1)!.decision_time,
  }
  return createReplaySourceEventDecisionObservationHarnessContextBinding({
    ...bodyWithoutId,
    binding_id: `source-event-observation-harness-context-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
}

function workerInputAssemblyV2(requestValue: ReplayExecutionRequest, binding: ReturnType<typeof contextBinding>) {
  const entries = binding.entries.map((contextEntry) => {
    const decisionTime = contextEntry.decision_time
    const close = Date.parse(decisionTime)
    const decisionInput = createReplayDecisionInputSnapshot(requestValue, [], decisionTime)
    const marketInput = createReplayDecisionMarketInputSnapshot({
      request: requestValue,
      decision_time: decisionTime,
      interval_ms: 14_400_000,
      bars: [{
        open_time: new Date(close - 14_400_000).toISOString(), close_time: decisionTime,
        open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true,
      }],
    })
    const needsState = contextEntry.harness_context.decision_phase === "position_open"
    return createReplayDecisionWorkerInputAssemblyV2Entry({
      schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_ENTRY_SCHEMA_VERSION,
      decision_sequence: contextEntry.decision_sequence,
      decision_time: decisionTime,
      decision_phase: contextEntry.harness_context.decision_phase,
      harness_context_binding_entry_hash: contextEntry.entry_hash,
      harness_context: structuredClone(contextEntry.harness_context),
      harness_context_hash: contextEntry.harness_context_hash,
      supplemental_input_source: "r4_97_empty_input_materialization",
      decision_input_snapshot: decisionInput,
      decision_input_snapshot_hash: decisionInput.snapshot_hash,
      market_input_source: "r4_100_market_input_materialization",
      decision_market_input_snapshot: marketInput,
      decision_market_input_snapshot_hash: marketInput.snapshot_hash,
      r4_97_embedded_market_compatibility: "exact_snapshot_match",
      state_input_status: needsState
        ? "runtime_state_required_not_materialized" : "not_applicable_non_position_phase",
      decision_state_snapshot: null,
      input_tuple_status: needsState
        ? "incomplete_runtime_state_snapshot" : "complete_non_executable_build_unbound",
      worker_request: null,
      harness_invocation: "forbidden",
      execution_effect: "none",
    })
  })
  const bodyWithoutId: Omit<ReplayDecisionWorkerInputAssemblyV2Body, "assembly_id"> = {
    schema_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_SCHEMA_VERSION,
    assembly_policy_version: REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V2_POLICY_VERSION,
    scope: "pre_worker_non_economic_complete_input_tuple_assembly",
    purpose: "bind_context_supplemental_and_market_snapshots_without_creating_worker_request",
    parent_validation: "self_hash_and_cross_object_binding_only",
    source_bundle_binding: "not_bound", build_attestation_binding: "not_bound",
    invocation_identity_materialization: "forbidden", worker_request_materialization: "forbidden",
    harness_invocation: "forbidden", decision_output_authority: "none", signal_authority: "none",
    order_authority: "none", economic_authority: "none", runner_compatibility: "not_bound",
    request_hash: canonicalHash(requestValue), run_id: requestValue.run_id,
    experiment_id: requestValue.experiment_id, trial_group_id: requestValue.trial_group_id,
    trial_id: requestValue.trial_id, candidate_id: requestValue.candidate_id,
    candidate_hash: requestValue.candidate_hash, harness_context_binding_id: binding.binding_id,
    harness_context_binding_hash: binding.binding_hash,
    observation_input_materialization_id: "fixture-r4-97-materialization",
    observation_input_materialization_hash: HASH,
    initial_signal_supplemental_materialization_id: null,
    initial_signal_supplemental_materialization_hash: null,
    market_input_materialization_id: "fixture-r4-100-materialization",
    market_input_materialization_hash: HASH,
    supplemental_source_policy: "exactly_one_request_bound_r4_97_or_r4_98_materialization",
    market_source_policy: "required_same_request_context_bound_r4_100_materialization",
    r4_97_embedded_market_policy: "require_exact_match_then_use_r4_100",
    entry_count: entries.length, entries, entries_hash: canonicalHash(entries),
    entry_hashes_hash: canonicalHash(entries.map((entry) => entry.entry_hash)),
    complete_entry_count: 1, incomplete_state_entry_count: 1, missing_market_entry_count: 0,
    worker_request_count: 0,
  }
  return createReplayDecisionWorkerInputAssemblyV2({
    ...bodyWithoutId,
    assembly_id: `decision-worker-input-v2-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
}

const replayProfileStartedAt = performance.now()

function replayProfile(stage: string): void {
  if (process.env.REPLAY_TEST_PROFILE !== "1") return
  const elapsed = ((performance.now() - replayProfileStartedAt) / 1_000).toFixed(2)
  process.stderr.write(`[replay-worker-v10-test] ${elapsed}s ${stage}\n`)
}

test("Replay binds runtime inputs and deterministic code evidence without Worker authority", async () => {
  replayProfile("start")
  const sourceBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "fixture://decision-harness/r4-104",
    entrypoint: { file_path: "strategy.ts", export_name: "decide" },
    files: [{
      path: "strategy.ts",
      content_utf8: [
        "export function decide(input) {",
        "  if (input.request_context.decision_phase !== 'initial_entry') return { decision_output: { action: 'no_action' }, trace: null }",
        "  return { decision_output: { action: 'submit_initial_order', order: { side: 'long', quantity: 1, signal_time: '2026-07-14T04:00:00Z', earliest_executable_time: '2026-07-14T08:00:00Z', stop_price: 95, target_price: 110, entry_execution: { order_type: 'market' } } }, trace: null }",
        "}",
        "",
      ].join("\n"),
    }],
  })
  const buildAttestation = buildReplayDecisionHarness(sourceBundle)
  const requestValue = request(HASH, sourceBundle.bundle_hash, GOLDEN_REPLAY_DATASET_HASH)
  const trialReservation = authorizeReplayTrialRequest(requestValue)
  const binding = contextBinding(requestValue)
  const sourceEvents: ReplaySourceEvent[] = [{
    source_event_id: "source:bar_range:1", kind: "bar_range", source_index: 0,
    event_key: {
      event_time: "2026-07-14T08:00:00Z", boundary_phase: 20,
      source_sequence: 1, event_subphase: 0, stable_event_id: "source:bar_range:1",
    },
  }, {
    source_event_id: "source:bar_range:2", kind: "bar_range", source_index: 1,
    event_key: {
      event_time: "2026-07-14T12:00:00Z", boundary_phase: 20,
      source_sequence: 2, event_subphase: 0, stable_event_id: "source:bar_range:2",
    },
  }]
  const snapshot = createReplayDecisionStateSnapshot({
    schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
    run_id: requestValue.run_id, decision_sequence: 2, decision_time: "2026-07-14T12:00:00Z",
    observation_event_key: structuredClone(sourceEvents[1]!.event_key),
    source_prefix_hash: canonicalHash(sourceEvents),
    position: { state: "open", side: "long", signed_quantity: 1, average_entry_price: 100 },
    active_protection: {
      stop: { order_id: "stop-1", status: "active", trigger_price: 95, remaining_quantity: 1 },
      target: { order_id: "target-1", status: "active", trigger_price: 110, remaining_quantity: 1 },
    },
    mark_price: 102, cash_balance: 999.9, total_fees: 0.1, total_funding: 0,
    unrealized_pnl: 2, equity: 1001.9,
  })
  const input = {
    request: requestValue,
    harness_context_binding: binding,
    decision_state_snapshot: snapshot,
    source_events: sourceEvents,
  }
  const materialization = buildReplayPositionOpenStateInputMaterialization(input)
  expect(materialization.owner).toBe("replay_engine_runtime")
  expect(materialization.economic_recomputation).toBe("not_performed")
  expect(materialization.source_event_count).toBe(2)
  expect(materialization.decision_state_snapshot_hash).toBe(snapshot.snapshot_hash)
  expect(materialization.worker_request_materialization).toBe("forbidden")
  expect(materialization.harness_invocation).toBe("forbidden")
  expect(() => assertReplayPositionOpenStateInputMaterialization(materialization)).not.toThrow()
  expect(() => assertReplayPositionOpenStateInputMaterializationLineage(materialization, input)).not.toThrow()
  expect(buildReplayPositionOpenStateInputMaterialization(structuredClone(input))).toEqual(materialization)

  const sourceAssemblyV2 = workerInputAssemblyV2(requestValue, binding)
  const assemblyV3Input = {
    source_assembly_v2: sourceAssemblyV2,
    state_input_materializations: [materialization],
  }
  const assemblyV3 = buildReplayDecisionWorkerInputAssemblyV3(assemblyV3Input)
  expect(assemblyV3.owner).toBe("replay_engine_runtime")
  expect(assemblyV3.source_assembly_v2_hash).toBe(sourceAssemblyV2.assembly_hash)
  expect(assemblyV3.state_materialization_count).toBe(1)
  expect(assemblyV3.complete_entry_count).toBe(2)
  expect(assemblyV3.incomplete_state_entry_count).toBe(0)
  expect(assemblyV3.entries[1]!.state_input_materialization_hash).toBe(materialization.materialization_hash)
  expect(assemblyV3.entries[1]!.input_tuple_status).toBe("complete_non_executable_build_unbound")
  expect(assemblyV3.worker_request_count).toBe(0)
  expect(assemblyV3.entries.every((entry) => entry.worker_request === null)).toBeTrue()
  expect(() => assertReplayDecisionWorkerInputAssemblyV3(assemblyV3)).not.toThrow()
  expect(() => assertReplayDecisionWorkerInputAssemblyV3Lineage(assemblyV3, assemblyV3Input)).not.toThrow()
  expect(buildReplayDecisionWorkerInputAssemblyV3(structuredClone(assemblyV3Input))).toEqual(assemblyV3)
  expect(() => buildReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3Input,
    state_input_materializations: [],
  })).toThrow("exactly one State parent")
  expect(() => assertReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision Worker input assembly v3 authority")

  const assemblyV4Input = {
    source_assembly_v3: assemblyV3,
    harness_context_binding: binding,
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
  }
  const assemblyV4 = buildReplayDecisionWorkerInputAssemblyV4(assemblyV4Input)
  expect(assemblyV4.owner).toBe("replay_runner_code_admission")
  expect(assemblyV4.input_tuple_status).toBe("complete_non_executable_build_bound")
  expect(assemblyV4.source_bundle_hash).toBe(sourceBundle.bundle_hash)
  expect(assemblyV4.build_attestation_hash).toBe(buildAttestation.attestation_hash)
  expect(assemblyV4.build_artifact_hash).toBe(buildAttestation.artifact.sha256)
  expect(assemblyV4.worker_request_count).toBe(0)
  expect(assemblyV4.worker_request_materialization).toBe("forbidden")
  expect(assemblyV4.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionWorkerInputAssemblyV4(assemblyV4)).not.toThrow()
  expect(() => assertReplayDecisionWorkerInputAssemblyV4Lineage(assemblyV4, assemblyV4Input)).not.toThrow()
  expect(buildReplayDecisionWorkerInputAssemblyV4(structuredClone(assemblyV4Input))).toEqual(assemblyV4)
  const forgedBuild = createReplayDecisionHarnessBuildAttestation({
    source_bundle: sourceBundle,
    runtime_version: buildAttestation.runtime.runtime_version,
    runtime_executable_sha256: buildAttestation.runtime.executable_sha256,
    artifact_content_utf8: `${buildAttestation.artifact.content_utf8}// forged\n`,
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4Input,
    build_attestation: forgedBuild,
  })).toThrow("does not match deterministic rebuild")
  const mismatchedBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "fixture://decision-harness/r4-104-mismatch",
    entrypoint: { file_path: "strategy.ts", export_name: "decide" },
    files: [{ path: "strategy.ts", content_utf8: "export function decide() { return null }\n" }],
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4Input,
    source_bundle: mismatchedBundle,
    build_attestation: buildReplayDecisionHarness(mismatchedBundle),
  })).toThrow("input/Context/code binding drift")
  expect(() => assertReplayDecisionWorkerInputAssemblyV4({
    ...assemblyV4,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision Worker input assembly v4 authority")

  const registry = createReplayDecisionHarnessRegistry([{
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
  }])
  replayProfile("base assembly and registry")
  const codeAdmissionInput = { source_assembly_v4: assemblyV4, registry }
  const codeAdmission = buildReplayDecisionHarnessCodeAdmission(codeAdmissionInput)
  expect(codeAdmission.owner).toBe("replay_runner_registry_admission")
  expect(codeAdmission.admission_status).toBe("compatible_exact_registration_observed")
  expect(codeAdmission.registry_registration_lifetime).toBe("immutable_for_process_lifetime")
  expect(codeAdmission.registry_instance_identity).toBe("unavailable")
  expect(codeAdmission.registry_instance_id).toBeNull()
  expect(codeAdmission.future_lookup_guarantee).toBe("not_proven")
  expect(codeAdmission.registry_authenticity).toBe("process_local_interface_observation_not_signed")
  expect(codeAdmission.lookup_value).toBe(sourceBundle.bundle_hash)
  expect(codeAdmission.registry_entry.source_bundle).toEqual(sourceBundle)
  expect(codeAdmission.registry_entry.build_attestation).toEqual(buildAttestation)
  expect(codeAdmission.worker_request_count).toBe(0)
  expect(codeAdmission.worker_request_materialization).toBe("forbidden")
  expect(codeAdmission.harness_invocation).toBe("forbidden")
  expect(codeAdmission.trial_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessCodeAdmission(codeAdmission)).not.toThrow()
  expect(() => assertReplayDecisionHarnessCodeAdmissionLineage(codeAdmission, codeAdmissionInput)).not.toThrow()
  const independentlyCreatedRegistry = createReplayDecisionHarnessRegistry([{
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
  }])
  expect(buildReplayDecisionHarnessCodeAdmission({
    source_assembly_v4: structuredClone(assemblyV4),
    registry: independentlyCreatedRegistry,
  })).toEqual(codeAdmission)
  expect(() => buildReplayDecisionHarnessCodeAdmission({
    source_assembly_v4: assemblyV4,
    registry: createReplayDecisionHarnessRegistry([]),
  })).toThrow("bundle hash is not registered")
  const mismatchedRegistration = {
    source_bundle: sourceBundle,
    build_attestation: forgedBuild,
  }
  expect(() => buildReplayDecisionHarnessCodeAdmission({
    source_assembly_v4: assemblyV4,
    registry: {
      capability: structuredClone(registry.capability),
      resolve: () => structuredClone(mismatchedRegistration),
    },
  })).toThrow("does not exactly match R4.104 code evidence")
  expect(() => assertReplayDecisionHarnessCodeAdmission({
    ...codeAdmission,
    future_lookup_guarantee: "proven" as never,
  })).toThrow("unsupported decision harness code admission authority")
  expect(() => assertReplayDecisionHarnessCodeAdmission({
    ...codeAdmission,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision harness code admission authority")

  const invocationIdentityInput = { code_admission: codeAdmission }
  const invocationIdentities = buildReplayDecisionHarnessInvocationIdentitySet(invocationIdentityInput)
  expect(invocationIdentities.owner).toBe("replay_runner_invocation_admission")
  expect(invocationIdentities.identity_formula_compatibility).toBe("exact_existing_worker_request_v9_derivation")
  expect(invocationIdentities.request_context_identity_limit)
    .toBe("context_not_direct_hash_member_parent_evidence_only")
  expect(invocationIdentities.reproducibility_pair_identity)
    .toBe("same_logical_invocation_id_for_both_processes")
  expect(invocationIdentities.process_instance_identity).toBe("not_materialized")
  expect(invocationIdentities.execution_attempt_identity).toBe("not_materialized")
  expect(invocationIdentities.retry_identity).toBe("not_materialized")
  expect(invocationIdentities.entry_count).toBe(2)
  expect(invocationIdentities.invocation_identity_count).toBe(2)
  expect(new Set(invocationIdentities.entries.map((entry) => entry.invocation_id)).size).toBe(2)
  expect(invocationIdentities.entries[0]!.decision_state_snapshot_hash).toBeNull()
  expect(invocationIdentities.entries[1]!.decision_state_snapshot_hash).toBe(snapshot.snapshot_hash)
  expect(invocationIdentities.entries[0]!.worker_request).toBeNull()
  expect(invocationIdentities.worker_request_count).toBe(0)
  expect(invocationIdentities.worker_request_materialization).toBe("forbidden")
  expect(invocationIdentities.harness_invocation).toBe("forbidden")
  expect(invocationIdentities.trial_authority).toBe("none")
  expect(invocationIdentities.entries[0]!.invocation_id).toBe(deriveReplayDecisionHarnessInvocationId({
    run_id: requestValue.run_id,
    source_bundle_hash: sourceBundle.bundle_hash,
    artifact_hash: buildAttestation.artifact.sha256,
    decision_input_snapshot_hash: sourceAssemblyV2.entries[0]!.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: sourceAssemblyV2.entries[0]!.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: null,
  }))
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet(invocationIdentities)).not.toThrow()
  expect(() => assertReplayDecisionHarnessInvocationIdentityLineage(
    invocationIdentities,
    invocationIdentityInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessInvocationIdentitySet({
    code_admission: structuredClone(codeAdmission),
  })).toEqual(invocationIdentities)
  const firstIdentity = invocationIdentities.entries[0]!
  const { entry_hash: _identityEntryHash, ...firstIdentityBody } = firstIdentity
  const forgedInvocationEntry = createReplayDecisionHarnessInvocationIdentityEntry({
    ...firstIdentityBody,
    invocation_id: "b".repeat(64),
  })
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet({
    ...invocationIdentities,
    entries: [forgedInvocationEntry, invocationIdentities.entries[1]!],
  })).toThrow("invocation identity derivation drift")
  const contextDriftEntry = createReplayDecisionHarnessInvocationIdentityEntry({
    ...firstIdentityBody,
    request_context_hash: "b".repeat(64),
  })
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet({
    ...invocationIdentities,
    entries: [contextDriftEntry, invocationIdentities.entries[1]!],
  })).toThrow("entry parent binding drift")
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet({
    ...invocationIdentities,
    process_instance_identity: "materialized" as never,
  })).toThrow("unsupported decision harness invocation identity set authority")
  expect(() => assertReplayDecisionHarnessInvocationIdentitySet({
    ...invocationIdentities,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision harness invocation identity set authority")

  const identityUpgradeInput = { source_invocation_identity_set: invocationIdentities }
  const identityUpgrade = buildReplayDecisionHarnessLogicalRequestIdentityUpgrade(identityUpgradeInput)
  expect(identityUpgrade.owner).toBe("replay_runner_protocol_admission")
  expect(identityUpgrade.activation_status).toBe("identity_policy_frozen_worker_request_not_materialized")
  expect(identityUpgrade.target_worker_protocol_version).toBe("rd-replay-harness-worker-stdio-v10")
  expect(identityUpgrade.target_worker_request_schema_version)
    .toBe("trade.rd-replay-decision-harness-worker-request.v10")
  expect(identityUpgrade.request_context_direct_binding).toBe("required")
  expect(identityUpgrade.code_admission_direct_binding).toBe("required")
  expect(identityUpgrade.attempt_identity_policy).toBe("separate_execution_envelope_not_logical_request_hash")
  expect(identityUpgrade.attempt_lease_binding).toBe("forbidden")
  expect(identityUpgrade.retry_stability).toBe("same_frozen_inputs_and_code_admission_same_logical_request_id")
  expect(identityUpgrade.process_instance_identity).toBe("not_materialized")
  expect(identityUpgrade.execution_attempt_identity).toBe("not_materialized")
  expect(identityUpgrade.entries[0]!.legacy_v9_invocation_id).toBe(invocationIdentities.entries[0]!.invocation_id)
  expect(identityUpgrade.entries[0]!.logical_request_id).not.toBe(identityUpgrade.entries[0]!.legacy_v9_invocation_id)
  expect(identityUpgrade.entries[0]!.worker_request).toBeNull()
  expect(identityUpgrade.worker_request_count).toBe(0)
  expect(identityUpgrade.worker_request_materialization).toBe("forbidden")
  expect(identityUpgrade.harness_invocation).toBe("forbidden")
  expect(identityUpgrade.trial_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgrade(identityUpgrade)).not.toThrow()
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgradeLineage(
    identityUpgrade,
    identityUpgradeInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    source_invocation_identity_set: structuredClone(invocationIdentities),
  })).toEqual(identityUpgrade)
  const firstUpgradeEntry = identityUpgrade.entries[0]!
  const logicalIdInput = {
    identity_policy_version: REPLAY_DECISION_HARNESS_LOGICAL_REQUEST_IDENTITY_POLICY_VERSION,
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    target_worker_request_schema_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
    run_id: firstUpgradeEntry.run_id,
    code_admission_hash: firstUpgradeEntry.code_admission_hash,
    source_bundle_hash: firstUpgradeEntry.source_bundle_hash,
    artifact_hash: firstUpgradeEntry.artifact_hash,
    request_context_hash: firstUpgradeEntry.request_context_hash,
    decision_input_snapshot_hash: firstUpgradeEntry.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: firstUpgradeEntry.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: firstUpgradeEntry.decision_state_snapshot_hash,
  }
  expect(deriveReplayDecisionHarnessLogicalRequestId(logicalIdInput)).toBe(firstUpgradeEntry.logical_request_id)
  expect(deriveReplayDecisionHarnessLogicalRequestId({
    ...logicalIdInput,
    request_context_hash: "b".repeat(64),
  })).not.toBe(firstUpgradeEntry.logical_request_id)
  expect(deriveReplayDecisionHarnessLogicalRequestId({
    ...logicalIdInput,
    code_admission_hash: "b".repeat(64),
  })).not.toBe(firstUpgradeEntry.logical_request_id)
  const { entry_hash: _upgradeEntryHash, ...firstUpgradeEntryBody } = firstUpgradeEntry
  const forgedLogicalIdEntry = createReplayDecisionHarnessLogicalRequestIdentityUpgradeEntry({
    ...firstUpgradeEntryBody,
    logical_request_id: "b".repeat(64),
  })
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    ...identityUpgrade,
    entries: [forgedLogicalIdEntry, identityUpgrade.entries[1]!],
  })).toThrow("logical request identity upgrade derivation drift")
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    ...identityUpgrade,
    attempt_lease_hash: HASH,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessLogicalRequestIdentityUpgrade({
    ...identityUpgrade,
    worker_request_count: 1 as never,
  })).toThrow("unsupported decision harness logical request identity upgrade authority")

  const requestV10Input = { source_identity_upgrade: identityUpgrade }
  const requestV10Materialization = buildReplayDecisionHarnessWorkerRequestV10Materialization(requestV10Input)
  expect(requestV10Materialization.owner).toBe("replay_runner_protocol_admission")
  expect(requestV10Materialization.activation_status).toBe("contract_materialized_non_executable")
  expect(requestV10Materialization.field_policy).toBe("exact_whitelist_no_attempt_or_process_fields")
  expect(requestV10Materialization.self_validation_policy).toBe("content_hashes_logical_id_and_request_hash")
  expect(requestV10Materialization.migration_policy).toBe("v9_execution_unchanged_v10_contract_only")
  expect(requestV10Materialization.activation_gate)
    .toBe("response_echo_execution_envelope_transport_and_worker_certification_required")
  expect(requestV10Materialization.request_count).toBe(2)
  expect(requestV10Materialization.response_contract).toBe("not_materialized")
  expect(requestV10Materialization.execution_envelope).toBe("not_materialized")
  expect(requestV10Materialization.transport).toBe("forbidden")
  expect(requestV10Materialization.harness_invocation).toBe("forbidden")
  expect(requestV10Materialization.trial_authority).toBe("none")
  const firstRequestV10 = requestV10Materialization.requests[0]!
  expect(firstRequestV10.schema_version).toBe("trade.rd-replay-decision-harness-worker-request.v10")
  expect(firstRequestV10.worker_protocol_version).toBe("rd-replay-harness-worker-stdio-v10")
  expect(firstRequestV10.logical_request_id).toBe(identityUpgrade.entries[0]!.logical_request_id)
  expect(firstRequestV10.legacy_v9_invocation_id).toBe(identityUpgrade.entries[0]!.legacy_v9_invocation_id)
  expect(firstRequestV10.request_context).toEqual(sourceAssemblyV2.entries[0]!.harness_context)
  expect(firstRequestV10.decision_input_snapshot).toEqual(sourceAssemblyV2.entries[0]!.decision_input_snapshot)
  expect(firstRequestV10.decision_market_input_snapshot)
    .toEqual(sourceAssemblyV2.entries[0]!.decision_market_input_snapshot)
  expect(firstRequestV10.decision_state_snapshot).toBeNull()
  expect(requestV10Materialization.requests[1]!.decision_state_snapshot).toEqual(snapshot)
  expect(firstRequestV10.execution_admission).toBe("not_granted")
  expect(firstRequestV10.execution_envelope).toBeNull()
  expect(firstRequestV10.transport_status).toBe("not_invoked")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10(firstRequestV10)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerRequestV10Materialization(requestV10Materialization)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerRequestV10MaterializationLineage(
    requestV10Materialization,
    requestV10Input,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerRequestV10Materialization({
    source_identity_upgrade: structuredClone(identityUpgrade),
  })).toEqual(requestV10Materialization)
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    attempt_lease_hash: HASH,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    logical_request_id: "b".repeat(64),
  })).toThrow("logical identity or self-hash drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10({
    ...firstRequestV10,
    request_context: {
      ...firstRequestV10.request_context,
      candidate_hash: "b".repeat(64),
    },
  })).toThrow("embedded input hash or run binding drift")
  expect(() => assertReplayDecisionHarnessWorkerRequestV10Materialization({
    ...requestV10Materialization,
    transport: "stdio" as never,
  })).toThrow("unsupported decision harness Worker Request v10 materialization authority")

  const workerV10BuildInput = { source_code_admission: codeAdmission }
  replayProfile("worker request identity")
  const workerV10BuildCapability = buildReplayDecisionHarnessWorkerV10Capability(workerV10BuildInput)
  expect(workerV10BuildCapability.activation_status)
    .toBe("build_capability_available_process_not_admitted")
  expect(workerV10BuildCapability.legacy_v9_worker_protocol_version)
    .toBe("rd-replay-harness-worker-stdio-v9")
  expect(workerV10BuildCapability.target_worker_protocol_version)
    .toBe("rd-replay-harness-worker-stdio-v10")
  expect(workerV10BuildCapability.migration_policy)
    .toBe("separate_v10_artifact_v9_execution_path_unchanged")
  expect(workerV10BuildCapability.artifact.sha256).not.toBe(buildAttestation.artifact.sha256)
  expect(workerV10BuildCapability.artifact_relation).toBe("distinct_from_legacy_v9_worker_artifact")
  expect(workerV10BuildCapability.decoder_input_surface).toBe("one_in_memory_plain_object_no_byte_frame")
  expect(workerV10BuildCapability.decoder_validation_policy)
    .toBe("exact_field_whitelist_protocol_schema_and_non_executable_markers")
  expect(workerV10BuildCapability.semantic_validation_policy)
    .toBe("runner_v10_contract_validation_still_required_before_future_dispatch")
  expect(workerV10BuildCapability.transport_frame_design_status).toBe("not_designed")
  expect(workerV10BuildCapability.stdio_loop).toBe("not_materialized")
  expect(workerV10BuildCapability.process_launch).toBe("not_materialized")
  expect(workerV10BuildCapability.worker_request_instance_count).toBe(0)
  expect(workerV10BuildCapability.request_decode_occurrence).toBe("not_materialized")
  expect(workerV10BuildCapability.dispatch_occurrence).toBe("not_materialized")
  expect(workerV10BuildCapability.harness_invocation).toBe("forbidden")
  expect(workerV10BuildCapability.response_instance).toBeNull()
  expect(workerV10BuildCapability.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability(workerV10BuildCapability)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapabilityLineage(
    workerV10BuildCapability,
    workerV10BuildInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerV10Capability({
    source_code_admission: structuredClone(codeAdmission),
  })).toEqual(workerV10BuildCapability)

  const decoderModuleRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-decoder-module-"))
  try {
    const decoderModulePath = join(decoderModuleRoot, workerV10BuildCapability.artifact.file_name)
    writeFileSync(decoderModulePath, workerV10BuildCapability.artifact.content_utf8, "utf8")
    const decoderModule = await import(
      `${pathToFileURL(decoderModulePath).href}?artifact=${workerV10BuildCapability.artifact.sha256}`
    ) as Record<string, unknown>
    const decode = decoderModule[workerV10BuildCapability.decoder_export_name]
    if (typeof decode !== "function") throw new Error("expected Worker v10 decoder export")
    expect(decode(structuredClone(firstRequestV10))).toEqual(firstRequestV10)
    expect(() => decode({ ...firstRequestV10, frame_id: "not-designed" }))
      .toThrow("field whitelist drift")
    expect(() => decode(Object.assign(Object.create({ inherited: true }), firstRequestV10)))
      .toThrow("must be one plain object")
    expect(() => decode({ ...firstRequestV10, worker_protocol_version: "rd-replay-harness-worker-stdio-v9" }))
      .toThrow("protocol drift")
    expect(() => decode({ ...firstRequestV10, transport_status: "invoked" }))
      .toThrow("executable markers are forbidden")
  } finally {
    rmSync(decoderModuleRoot, { recursive: true, force: true })
  }

  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    target_worker_protocol_version: "rd-replay-harness-worker-stdio-v9" as never,
  })).toThrow("unsupported decision harness Worker v10 build capability authority")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    worker_request_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker v10 build capability authority")
  expect(() => assertReplayDecisionHarnessWorkerV10BuildCapability({
    ...workerV10BuildCapability,
    artifact: { ...workerV10BuildCapability.artifact, content_utf8: "forged" },
  })).toThrow("parent or artifact binding drift")

  const workerV10RegistryRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-build-registry-"))
  try {
    expect(readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toBeNull()
    const registeredWorkerV10Capability = registerReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })
    expect(registeredWorkerV10Capability).toEqual(workerV10BuildCapability)
    expect(registerReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: structuredClone(codeAdmission),
    })).toEqual(workerV10BuildCapability)
    expect(readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toEqual(workerV10BuildCapability)
    const capabilityFile = readdirSync(workerV10RegistryRoot)
      .find((name) => name.startsWith("worker-v10-build-capability-"))
    if (!capabilityFile) throw new Error("expected Replay Worker v10 build capability registry file")
    writeFileSync(join(workerV10RegistryRoot, capabilityFile), "{}\n", "utf8")
    expect(() => readReplayWorkerV10BuildCapability({
      registry_root: workerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toThrow()
  } finally {
    rmSync(workerV10RegistryRoot, { recursive: true, force: true })
  }

  const differentWorkerV10RegistryRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-build-different-"))
  try {
    const { capability_hash: originalCapabilityHash, ...workerV10CapabilityBody } = workerV10BuildCapability
    expect(originalCapabilityHash).toHaveLength(64)
    const forgedGeneratedSource = `${workerV10CapabilityBody.generated_entrypoint_content_utf8}// forged\n`
    const forgedArtifact = `${workerV10CapabilityBody.artifact.content_utf8}// forged\n`
    const forgedCapability = createReplayDecisionHarnessWorkerV10BuildCapability({
      ...workerV10CapabilityBody,
      generated_entrypoint_content_utf8: forgedGeneratedSource,
      generated_entrypoint_hash: createHash("sha256").update(forgedGeneratedSource, "utf8").digest("hex"),
      artifact: {
        ...workerV10CapabilityBody.artifact,
        content_utf8: forgedArtifact,
        sha256: createHash("sha256").update(forgedArtifact, "utf8").digest("hex"),
      },
    })
    const differentFile = join(
      differentWorkerV10RegistryRoot,
      `worker-v10-build-capability-${forgedCapability.capability_key}.json`,
    )
    writeFileSync(differentFile, `${canonicalJson(forgedCapability)}\n`, "utf8")
    expect(() => registerReplayWorkerV10BuildCapability({
      registry_root: differentWorkerV10RegistryRoot,
      source_code_admission: codeAdmission,
    })).toThrow("already registered with different evidence")
  } finally {
    rmSync(differentWorkerV10RegistryRoot, { recursive: true, force: true })
  }

  const responseV10ContractInput = { source_request_materialization: requestV10Materialization }
  const responseV10Contract = buildReplayDecisionHarnessWorkerResponseV10Contract(responseV10ContractInput)
  expect(responseV10Contract.owner).toBe("replay_runner_protocol_admission")
  expect(responseV10Contract.activation_status).toBe("schema_frozen_response_not_materialized")
  expect(responseV10Contract.worker_response_schema_version)
    .toBe("trade.rd-replay-decision-harness-worker-response.v10")
  expect(responseV10Contract.response_field_whitelist).toEqual([...REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_FIELDS])
  expect(responseV10Contract.request_echo_fields)
    .toEqual([...REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS])
  expect(responseV10Contract.decision_output_policy)
    .toBe("typed_shape_and_hash_only_schedule_authority_not_granted")
  expect(responseV10Contract.migration_policy).toBe("v9_response_and_receipt_execution_path_unchanged")
  expect(responseV10Contract.response_instance_count).toBe(0)
  expect(responseV10Contract.response_instances).toEqual([])
  expect(responseV10Contract.response_admission).toBe("not_granted")
  expect(responseV10Contract.execution_envelope).toBe("not_materialized")
  expect(responseV10Contract.process_receipt).toBe("not_materialized")
  expect(responseV10Contract.harness_receipt).toBe("not_materialized")
  expect(responseV10Contract.transport).toBe("forbidden")
  expect(responseV10Contract.harness_invocation).toBe("forbidden")
  expect(responseV10Contract.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10Contract(responseV10Contract)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerResponseV10ContractLineage(
    responseV10Contract,
    responseV10ContractInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessWorkerResponseV10Contract({
    source_request_materialization: structuredClone(requestV10Materialization),
  })).toEqual(responseV10Contract)
  const responseOutput = { action: "no_action" as const }
  const responseTrace = { fixture: "schema-validation-only" }
  const responseV10Body: ReplayDecisionHarnessWorkerResponseV10Body = {
    schema_version: "trade.rd-replay-decision-harness-worker-response.v10",
    worker_protocol_version: firstRequestV10.worker_protocol_version,
    logical_request_id: firstRequestV10.logical_request_id,
    request_hash: firstRequestV10.request_hash,
    run_id: firstRequestV10.run_id,
    code_admission_hash: firstRequestV10.code_admission_hash,
    source_bundle_hash: firstRequestV10.source_bundle_hash,
    artifact_hash: firstRequestV10.artifact_hash,
    request_context_hash: firstRequestV10.request_context_hash,
    decision_input_snapshot_hash: firstRequestV10.decision_input_snapshot_hash,
    decision_market_input_snapshot_hash: firstRequestV10.decision_market_input_snapshot_hash,
    decision_state_snapshot_hash: firstRequestV10.decision_state_snapshot_hash,
    decision_output: responseOutput,
    decision_output_hash: canonicalHash(responseOutput),
    trace: responseTrace,
    trace_hash: canonicalHash(responseTrace),
    authority_status: "unadmitted_worker_claim",
  }
  const responseV10 = { ...responseV10Body, response_hash: canonicalHash(responseV10Body) }
  expect(() => assertReplayDecisionHarnessWorkerResponseV10(responseV10, firstRequestV10)).not.toThrow()
  const echoDriftBody = { ...responseV10Body, request_hash: "b".repeat(64) }
  expect(() => assertReplayDecisionHarnessWorkerResponseV10({
    ...echoDriftBody,
    response_hash: canonicalHash(echoDriftBody),
  }, firstRequestV10)).toThrow("Request echo drift")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10({
    ...responseV10,
    execution_envelope_hash: HASH,
  } as never, firstRequestV10)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessWorkerResponseV10Contract({
    ...responseV10Contract,
    response_instance_count: 1 as never,
  })).toThrow("unsupported decision harness Worker Response v10 contract authority")

  const authorityBinding = assemblyV4.harness_context_binding
  const attemptLease: ReplayAttemptLeaseSnapshot = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: "attempt-envelope-1",
    attempt_ordinal: 1,
    worker_id: "worker-authority-1",
    trial_id: authorityBinding.trial_id,
    run_id: authorityBinding.run_id,
    reservation_ref: authorityBinding.reservation_ref,
    reservation_hash: authorityBinding.reservation_hash,
    request_hash: authorityBinding.request_hash,
    status: "running",
    lease_generation: 2,
    claimed_at: "2026-07-14T00:00:00Z",
    heartbeat_at: "2026-07-14T00:00:30Z",
    lease_expires_at: "2026-07-14T00:05:00Z",
  }
  const envelopeInput = {
    source_response_contract: responseV10Contract,
    logical_request_id: firstRequestV10.logical_request_id,
    attempt_lease: attemptLease,
  }
  const executionEnvelope = buildReplayDecisionHarnessExecutionEnvelope(envelopeInput)
  expect(executionEnvelope.owner).toBe("replay_runner_execution_admission")
  expect(executionEnvelope.worker_request_hash).toBe(firstRequestV10.request_hash)
  expect(executionEnvelope.replay_execution_request_hash).toBe(authorityBinding.request_hash)
  expect(executionEnvelope.worker_request_hash).not.toBe(executionEnvelope.replay_execution_request_hash)
  expect(executionEnvelope.attempt_lease_hash).toBe(hashReplayAttemptLeaseSnapshot(attemptLease))
  expect(executionEnvelope.worker_identity_semantics)
    .toBe("control_plane_worker_authority_not_os_process_identity")
  expect(executionEnvelope.succession_kind).toBe("root_binding")
  expect(executionEnvelope.predecessor_execution_envelope_hash).toBeNull()
  expect(executionEnvelope.lease_generation_policy).toBe("one_envelope_one_exact_generation")
  expect(executionEnvelope.cross_attempt_retry_policy)
    .toBe("new_attempt_requires_new_root_envelope_logical_request_stable")
  expect(executionEnvelope.reproducibility_pair_policy)
    .toBe("shared_envelope_distinct_future_process_receipts")
  expect(executionEnvelope.lease_freshness_at_dispatch)
    .toBe("not_evaluated_requires_future_transport_admission")
  expect(executionEnvelope.process_instance_identity).toBe("not_materialized")
  expect(executionEnvelope.transport_admission).toBe("not_granted")
  expect(executionEnvelope.transport).toBe("forbidden")
  expect(executionEnvelope.harness_invocation).toBe("forbidden")
  expect(executionEnvelope.response_instance).toBeNull()
  expect(executionEnvelope.decision_output_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope(executionEnvelope)).not.toThrow()
  expect(() => assertReplayDecisionHarnessExecutionEnvelopeLineage(executionEnvelope, envelopeInput)).not.toThrow()
  expect(buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    source_response_contract: structuredClone(responseV10Contract),
    attempt_lease: structuredClone(attemptLease),
  })).toEqual(executionEnvelope)
  const renewedLease: ReplayAttemptLeaseSnapshot = {
    ...attemptLease,
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:02:00Z",
    lease_expires_at: "2026-07-14T00:07:00Z",
  }
  const successorInput = {
    ...envelopeInput,
    attempt_lease: renewedLease,
    predecessor_execution_envelope: executionEnvelope,
  }
  const successorEnvelope = buildReplayDecisionHarnessExecutionEnvelope(successorInput)
  expect(successorEnvelope.succession_kind).toBe("same_attempt_lease_generation_successor")
  expect(successorEnvelope.predecessor_execution_envelope_hash).toBe(executionEnvelope.envelope_hash)
  expect(successorEnvelope.logical_request_id).toBe(executionEnvelope.logical_request_id)
  expect(successorEnvelope.worker_request_hash).toBe(executionEnvelope.worker_request_hash)
  expect(successorEnvelope.lease_generation).toBe(3)
  expect(successorEnvelope.envelope_hash).not.toBe(executionEnvelope.envelope_hash)
  expect(() => assertReplayDecisionHarnessExecutionEnvelopeLineage(successorEnvelope, successorInput)).not.toThrow()
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    predecessor_execution_envelope: executionEnvelope,
  })).toThrow("generation or heartbeat did not advance")
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...successorInput,
    attempt_lease: { ...renewedLease, worker_id: "forged-worker" },
  })).toThrow("changed immutable authority")
  const retryLease: ReplayAttemptLeaseSnapshot = {
    ...attemptLease,
    attempt_id: "attempt-envelope-2",
    attempt_ordinal: 2,
    worker_id: "worker-authority-2",
    lease_generation: 1,
    claimed_at: "2026-07-14T00:10:00Z",
    heartbeat_at: "2026-07-14T00:10:30Z",
    lease_expires_at: "2026-07-14T00:15:00Z",
  }
  const retryEnvelope = buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    attempt_lease: retryLease,
  })
  expect(retryEnvelope.succession_kind).toBe("root_binding")
  expect(retryEnvelope.predecessor_execution_envelope_hash).toBeNull()
  expect(retryEnvelope.logical_request_id).toBe(executionEnvelope.logical_request_id)
  expect(retryEnvelope.attempt_id).not.toBe(executionEnvelope.attempt_id)
  expect(retryEnvelope.envelope_hash).not.toBe(executionEnvelope.envelope_hash)
  expect(() => buildReplayDecisionHarnessExecutionEnvelope({
    ...envelopeInput,
    attempt_lease: { ...attemptLease, request_hash: "b".repeat(64) },
  })).toThrow("does not match Replay authority")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope({
    ...executionEnvelope,
    process_id: 1234,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessExecutionEnvelope({
    ...executionEnvelope,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Execution Envelope authority")

  const dispatchAdmissionInput = {
    source_execution_envelope: executionEnvelope,
    current_attempt_lease: attemptLease,
    observed_at: attemptLease.heartbeat_at,
  }
  const dispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission(dispatchAdmissionInput)
  expect(dispatchAdmission.owner).toBe("replay_runner_dispatch_admission")
  expect(dispatchAdmission.source_execution_envelope_hash).toBe(executionEnvelope.envelope_hash)
  expect(dispatchAdmission.current_attempt_lease_hash).toBe(executionEnvelope.attempt_lease_hash)
  expect(dispatchAdmission.freshness_window_policy).toBe("heartbeat_inclusive_lease_expiry_exclusive")
  expect(dispatchAdmission.current_lease_match_policy).toBe("exact_attempt_worker_generation_and_hash")
  expect(dispatchAdmission.freshness_outcome).toBe("fresh_at_control_plane_observed_at")
  expect(dispatchAdmission.dispatch_eligibility).toBe("lease_freshness_admitted_only")
  expect(dispatchAdmission.dispatch_occurrence).toBe("not_materialized")
  expect(dispatchAdmission.clock_evidence).toBe("control_plane_observation_not_external_time_attestation")
  expect(dispatchAdmission.process_instance_identity).toBe("not_materialized")
  expect(dispatchAdmission.transport_admission).toBe("not_granted")
  expect(dispatchAdmission.transport).toBe("forbidden")
  expect(dispatchAdmission.harness_invocation).toBe("forbidden")
  expect(dispatchAdmission.response_instance).toBeNull()
  expect(dispatchAdmission.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission(dispatchAdmission)).not.toThrow()
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmissionLineage(
    dispatchAdmission,
    dispatchAdmissionInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: structuredClone(executionEnvelope),
    current_attempt_lease: structuredClone(attemptLease),
    observed_at: attemptLease.heartbeat_at,
  })).toEqual(dispatchAdmission)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    observed_at: "2026-07-14T00:00:29Z",
  })).toThrow("precedes fencing heartbeat")
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    observed_at: attemptLease.lease_expires_at,
  })).toThrow("expired at observed_at")
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmissionInput,
    current_attempt_lease: renewedLease,
    observed_at: renewedLease.heartbeat_at,
  })).toThrow("current Lease generation and a successor Envelope")
  const successorDispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: successorEnvelope,
    current_attempt_lease: renewedLease,
    observed_at: renewedLease.heartbeat_at,
  })
  expect(successorDispatchAdmission.lease_generation).toBe(3)
  expect(successorDispatchAdmission.source_execution_envelope_hash).toBe(successorEnvelope.envelope_hash)
  expect(successorDispatchAdmission.admission_hash).not.toBe(dispatchAdmission.admission_hash)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: executionEnvelope,
    current_attempt_lease: retryLease,
    observed_at: retryLease.heartbeat_at,
  })).toThrow("current Attempt authority does not match Execution Envelope")
  const retryDispatchAdmission = buildReplayDecisionHarnessDispatchLeaseAdmission({
    source_execution_envelope: retryEnvelope,
    current_attempt_lease: retryLease,
    observed_at: retryLease.heartbeat_at,
  })
  expect(retryDispatchAdmission.attempt_id).toBe(retryLease.attempt_id)
  expect(retryDispatchAdmission.attempt_ordinal).toBe(2)
  expect(retryDispatchAdmission.retry_attempt_policy).toBe("new_root_envelope_required_before_readmission")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmission,
    process_id: 1234,
  } as never)).toThrow("field whitelist drift")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAdmission({
    ...dispatchAdmission,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Dispatch Lease Admission authority")

  const leaseObservationBody = {
    schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_SCHEMA_VERSION,
    observation_id: "lease-observation-envelope-1",
    observation_ref: "observation://replay-attempt-lease/envelope-1",
    observation_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_POLICY_VERSION,
    status: "active_lease_observed" as const,
    observed_at: attemptLease.heartbeat_at,
    authority_owner: "research_control_plane" as const,
    authority_source: "research_control_plane_state_store" as const,
    read_consistency: "single_control_plane_transaction" as const,
    clock_evidence: "caller_supplied_utc_not_external_time_attestation" as const,
    trial_id: attemptLease.trial_id,
    run_id: attemptLease.run_id,
    attempt_id: attemptLease.attempt_id,
    attempt_ordinal: attemptLease.attempt_ordinal,
    worker_id: attemptLease.worker_id,
    lease_generation: attemptLease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(attemptLease),
    attempt_lease: attemptLease,
  }
  const leaseObservation = createReplayAttemptLeaseObservationSnapshot(leaseObservationBody)
  const authorityBindingInput = {
    source_execution_envelope: executionEnvelope,
    control_plane_lease_observation: leaseObservation,
  }
  const dispatchAuthorityBinding = buildReplayDecisionHarnessDispatchLeaseAuthorityBinding(authorityBindingInput)
  expect(dispatchAuthorityBinding.authority_observation_status).toBe("control_plane_receipt_verified")
  expect(dispatchAuthorityBinding.control_plane_observation_hash).toBe(leaseObservation.observation_hash)
  expect(dispatchAuthorityBinding.source_dispatch_lease_admission_hash).toBe(dispatchAdmission.admission_hash)
  expect(dispatchAuthorityBinding.receipt_binding_policy)
    .toBe("exact_observation_time_lease_hash_attempt_worker_and_generation")
  expect(dispatchAuthorityBinding.dispatch_eligibility)
    .toBe("authority_receipt_and_lease_freshness_admitted_only")
  expect(dispatchAuthorityBinding.dispatch_occurrence).toBe("not_materialized")
  expect(dispatchAuthorityBinding.clock_evidence).toBe("caller_supplied_utc_not_external_time_attestation")
  expect(dispatchAuthorityBinding.transport_admission).toBe("not_granted")
  expect(dispatchAuthorityBinding.response_instance).toBeNull()
  expect(dispatchAuthorityBinding.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBinding(dispatchAuthorityBinding)).not.toThrow()
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBindingLineage(
    dispatchAuthorityBinding,
    authorityBindingInput,
  )).not.toThrow()
  expect(buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: structuredClone(executionEnvelope),
    control_plane_lease_observation: structuredClone(leaseObservation),
  })).toEqual(dispatchAuthorityBinding)
  const dispatchEvidenceRegistryRoot = mkdtempSync(join(tmpdir(), "replay-dispatch-evidence-"))
  replayProfile("dispatch envelope and lease binding")
  try {
    expect(() => registerReplayDispatchEvidence({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_binding: dispatchAuthorityBinding,
      registered_at: attemptLease.lease_expires_at,
    })).toThrow("must occur inside the observed Lease window")
    const dispatchEvidenceRegistration = registerReplayDispatchEvidence({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_binding: dispatchAuthorityBinding,
      registered_at: "2026-07-14T00:00:31Z",
    })
    expect(dispatchEvidenceRegistration.source_authority_binding_hash)
      .toBe(dispatchAuthorityBinding.binding_hash)
    expect(dispatchEvidenceRegistration.evidence_status).toBe("durable_pre_dispatch_evidence_only")
    expect(dispatchEvidenceRegistration.dispatch_claim).toBeNull()
    expect(dispatchEvidenceRegistration.dispatch_eligibility)
      .toBe("requires_future_current_lease_revalidation_and_one_time_dispatch_claim")
    expect(dispatchEvidenceRegistration.dispatch_occurrence).toBe("not_materialized")
    expect(() => assertReplayDecisionHarnessDispatchEvidenceRegistration(
      dispatchEvidenceRegistration,
    )).not.toThrow()
    expect(registerReplayDispatchEvidence({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_binding: structuredClone(dispatchAuthorityBinding),
      registered_at: "2026-07-14T00:00:32Z",
    })).toEqual(dispatchEvidenceRegistration)
    expect(readReplayDispatchEvidence({
      registry_root: dispatchEvidenceRegistryRoot,
      attempt_id: dispatchEvidenceRegistration.attempt_id,
      lease_generation: dispatchEvidenceRegistration.lease_generation,
      logical_request_id: dispatchEvidenceRegistration.logical_request_id,
    })).toEqual(dispatchEvidenceRegistration)

    const missingTransportContractRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-transport-missing-"))
    try {
      expect(() => registerReplayWorkerV10TransportContract({
        registry_root: missingTransportContractRoot,
        source_worker_v10_build_capability: workerV10BuildCapability,
        source_execution_envelope: executionEnvelope,
      })).toThrow("requires the exact durable v10 Build Capability")
    } finally {
      rmSync(missingTransportContractRoot, { recursive: true, force: true })
    }
    const durableWorkerV10Capability = registerReplayWorkerV10BuildCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      source_code_admission: codeAdmission,
    })
    expect(durableWorkerV10Capability).toEqual(workerV10BuildCapability)
    const transportContractInput = {
      source_worker_v10_build_capability: durableWorkerV10Capability,
      source_execution_envelope: executionEnvelope,
    }
    replayProfile("durable build capability")
    const workerV10TransportContract = buildReplayDecisionHarnessWorkerV10TransportContract(
      transportContractInput,
    )
    expect(workerV10TransportContract.status).toBe("frozen_blocked_zero_instance")
    expect(workerV10TransportContract.logical_request_artifact_hash).toBe(buildAttestation.artifact.sha256)
    expect(workerV10TransportContract.logical_request_artifact_role)
      .toBe("legacy_v9_code_admission_anchor_not_transport_executable")
    expect(workerV10TransportContract.transport_process_artifact_hash)
      .toBe(workerV10BuildCapability.artifact.sha256)
    expect(workerV10TransportContract.transport_process_artifact_hash)
      .not.toBe(workerV10TransportContract.logical_request_artifact_hash)
    expect(workerV10TransportContract.transport_process_artifact_role)
      .toBe("r4_118_v10_decoder_module_candidate_not_stdio_process_artifact")
    expect(workerV10TransportContract.artifact_bridge_status).toBe("exact_migration_lineage_verified")
    expect(workerV10TransportContract.migration_scope).toBe("v1_bridge_not_long_term_artifact_taxonomy")
    expect(workerV10TransportContract.process_model)
      .toBe("fresh_single_request_process_no_pool_keepalive_or_multiplex")
    expect(workerV10TransportContract.process_lifecycle).toEqual([
      "spawn_exact_artifact",
      "write_one_request_frame",
      "close_stdin",
      "read_one_response_frame",
      "await_process_exit",
    ])
    expect(workerV10TransportContract.request_frame_encoding).toBe("canonical_json_utf8_lf_then_eof")
    expect(workerV10TransportContract.response_frame_encoding)
      .toBe("canonical_json_utf8_lf_then_process_exit")
    expect(workerV10TransportContract.frame_identity_policy)
      .toBe("logical_frame_excludes_process_identity_write_receipt_must_bind_process")
    expect(workerV10TransportContract.blockers).toEqual([
      "source_v10_capability_is_decoder_module_without_stdio_loop",
      "v10_stdio_process_artifact_not_materialized",
      "v10_process_instance_not_materialized",
      "target_worker_request_execution_admission_not_granted",
      "target_worker_request_transport_status_not_invoked",
      "transport_frame_instances_not_materialized",
    ])
    expect(workerV10TransportContract.r4_117_gate_relation)
      .toBe("successor_contract_does_not_rewrite_prior_blocked_gate")
    expect(workerV10TransportContract.stdio_process_artifact).toBe("not_materialized")
    expect(workerV10TransportContract.process_instance_count).toBe(0)
    expect(workerV10TransportContract.request_frame_instance_count).toBe(0)
    expect(workerV10TransportContract.request_write_receipt_count).toBe(0)
    expect(workerV10TransportContract.response_frame_instance_count).toBe(0)
    expect(workerV10TransportContract.response_read_receipt_count).toBe(0)
    expect(workerV10TransportContract.dispatch_occurrence).toBe("not_materialized")
    expect(workerV10TransportContract.harness_invocation).toBe("forbidden")
    expect(workerV10TransportContract.decision_output_authority).toBe("none")
    expect(() => assertReplayDecisionHarnessWorkerV10TransportContract(
      workerV10TransportContract,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10TransportContractLineage(
      workerV10TransportContract,
      transportContractInput,
    )).not.toThrow()

    const requestFrameCandidate = createReplayDecisionHarnessWorkerV10RequestFrame({
      schema_version: workerV10TransportContract.request_frame_schema_version,
      frame_kind: "worker_request",
      worker_protocol_version: workerV10TransportContract.worker_protocol_version,
      transport_contract_id: workerV10TransportContract.contract_id,
      transport_contract_hash: workerV10TransportContract.contract_hash,
      execution_envelope_hash: workerV10TransportContract.source_execution_envelope_hash,
      process_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
      logical_request_id: firstRequestV10.logical_request_id,
      worker_request_hash: firstRequestV10.request_hash,
      worker_request: structuredClone(firstRequestV10),
      authority_status: "unadmitted_transport_candidate",
    })
    expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
      requestFrameCandidate,
      workerV10TransportContract,
    )).not.toThrow()
    expect(Buffer.byteLength(`${canonicalJson(requestFrameCandidate)}\n`, "utf8"))
      .toBeLessThanOrEqual(workerV10TransportContract.max_request_frame_bytes)
    const { frame_hash: requestFrameHash, ...requestFrameBody } = requestFrameCandidate
    expect(requestFrameHash).toHaveLength(64)
    const wrongArtifactRequestFrame = createReplayDecisionHarnessWorkerV10RequestFrame({
      ...requestFrameBody,
      process_artifact_hash: buildAttestation.artifact.sha256,
    })
    expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
      wrongArtifactRequestFrame,
      workerV10TransportContract,
    )).toThrow("Transport Contract binding drift")

    const responseFrameCandidate = createReplayDecisionHarnessWorkerV10ResponseFrame({
      schema_version: workerV10TransportContract.response_frame_schema_version,
      frame_kind: "worker_response",
      worker_protocol_version: workerV10TransportContract.worker_protocol_version,
      transport_contract_id: workerV10TransportContract.contract_id,
      transport_contract_hash: workerV10TransportContract.contract_hash,
      execution_envelope_hash: workerV10TransportContract.source_execution_envelope_hash,
      process_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
      logical_request_id: responseV10.logical_request_id,
      worker_request_hash: responseV10.request_hash,
      worker_response_hash: responseV10.response_hash,
      worker_response: structuredClone(responseV10),
      authority_status: "unadmitted_transport_candidate",
    })
    expect(() => assertReplayDecisionHarnessWorkerV10ResponseFrame(
      responseFrameCandidate,
      workerV10TransportContract,
    )).not.toThrow()
    expect(Buffer.byteLength(`${canonicalJson(responseFrameCandidate)}\n`, "utf8"))
      .toBeLessThanOrEqual(workerV10TransportContract.max_response_frame_bytes)
    expect(() => assertReplayDecisionHarnessWorkerV10TransportContract({
      ...workerV10TransportContract,
      logical_request_artifact_hash: workerV10TransportContract.transport_process_artifact_hash,
    })).toThrow("parent or artifact bridge drift")
    expect(() => assertReplayDecisionHarnessWorkerV10TransportContract({
      ...workerV10TransportContract,
      request_frame_instance_count: 1 as never,
    })).toThrow("unsupported decision harness Worker v10 Transport Contract authority")

    const registeredTransportContract = registerReplayWorkerV10TransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      ...transportContractInput,
    })
    expect(registeredTransportContract).toEqual(workerV10TransportContract)
    expect(registerReplayWorkerV10TransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_worker_v10_build_capability: structuredClone(durableWorkerV10Capability),
      source_execution_envelope: structuredClone(executionEnvelope),
    })).toEqual(workerV10TransportContract)
    expect(readReplayWorkerV10TransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      ...transportContractInput,
    })).toEqual(workerV10TransportContract)

    const missingStdioCapabilityRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-stdio-missing-"))
    try {
      expect(() => registerReplayWorkerV10StdioCapability({
        registry_root: missingStdioCapabilityRoot,
        source_transport_contract: workerV10TransportContract,
      })).toThrow("requires the exact durable Transport Contract")
    } finally {
      rmSync(missingStdioCapabilityRoot, { recursive: true, force: true })
    }
    const workerV10StdioCapability = buildReplayDecisionHarnessWorkerV10StdioCapability({
      source_transport_contract: registeredTransportContract,
    })
    replayProfile("stdio capability")
    expect(workerV10StdioCapability.status)
      .toBe("stdio_process_capability_available_transport_activation_not_granted")
    expect(workerV10StdioCapability.source_decoder_artifact_hash)
      .toBe(workerV10BuildCapability.artifact.sha256)
    expect(workerV10StdioCapability.artifact.sha256)
      .not.toBe(workerV10StdioCapability.source_decoder_artifact_hash)
    expect(workerV10StdioCapability.artifact.sha256)
      .not.toBe(workerV10StdioCapability.source_legacy_v9_artifact_hash)
    expect(workerV10StdioCapability.r4_119_binding_relation)
      .toBe("successor_artifact_requires_new_transport_contract_no_retroactive_rewrite")
    expect(workerV10StdioCapability.valid_frame_policy)
      .toBe("reject_before_decode_until_successor_transport_activation")
    expect(workerV10StdioCapability.process_instance_count).toBe(0)
    expect(workerV10StdioCapability.worker_request_frame_instance_count).toBe(0)
    expect(workerV10StdioCapability.worker_request_decode_occurrence).toBe("not_materialized")
    expect(workerV10StdioCapability.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10StdioCapability(
      workerV10StdioCapability,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10StdioCapabilityLineage(
      workerV10StdioCapability,
      { source_transport_contract: registeredTransportContract },
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10StdioCapability({
      ...workerV10StdioCapability,
      source_decoder_artifact_hash: workerV10StdioCapability.artifact.sha256,
    })).toThrow("parent or artifact binding drift")
    const successorArtifactFrame = createReplayDecisionHarnessWorkerV10RequestFrame({
      ...requestFrameBody,
      process_artifact_hash: workerV10StdioCapability.artifact.sha256,
    })
    expect(() => assertReplayDecisionHarnessWorkerV10RequestFrame(
      successorArtifactFrame,
      workerV10TransportContract,
    )).toThrow("Transport Contract binding drift")

    const durableStdioCapability = registerReplayWorkerV10StdioCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      source_transport_contract: registeredTransportContract,
    })
    expect(durableStdioCapability).toEqual(workerV10StdioCapability)
    expect(registerReplayWorkerV10StdioCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      source_transport_contract: structuredClone(registeredTransportContract),
    })).toEqual(workerV10StdioCapability)
    expect(readReplayWorkerV10StdioCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      source_transport_contract: registeredTransportContract,
    })).toEqual(workerV10StdioCapability)

    const negativeProbeReceipt = runReplayWorkerV10NegativeProbeSuite({
      registry_root: dispatchEvidenceRegistryRoot,
      source_stdio_capability: durableStdioCapability,
      clock: { now: () => "2026-07-14T00:00:33Z" },
    })
    expect(negativeProbeReceipt.status).toBe("complete_expected_pre_decode_rejections")
    expect(negativeProbeReceipt.probe_order).toEqual([
      "empty_eof",
      "invalid_json_lf",
      "missing_lf",
      "multiple_frames",
      "oversized_input",
    ])
    expect(negativeProbeReceipt.probe_results.map((item) => item.exit_status))
      .toEqual([64, 65, 67, 68, 66])
    expect(negativeProbeReceipt.process_instance_count).toBe(5)
    expect(negativeProbeReceipt.worker_request_frame_instance_count).toBe(0)
    expect(negativeProbeReceipt.worker_request_write_receipt_count).toBe(0)
    expect(negativeProbeReceipt.worker_request_decode_occurrence).toBe("not_materialized")
    expect(negativeProbeReceipt.dispatch_occurrence)
      .toBe("not_materialized_only_non_frame_probe_bytes")
    expect(negativeProbeReceipt.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(
      negativeProbeReceipt,
    )).not.toThrow()
    expect(runReplayWorkerV10NegativeProbeSuite({
      registry_root: dispatchEvidenceRegistryRoot,
      source_stdio_capability: durableStdioCapability,
      clock: { now: () => "2026-07-14T00:00:34Z" },
    })).toEqual(negativeProbeReceipt)
    expect(readReplayWorkerV10NegativeProbeReceipt({
      registry_root: dispatchEvidenceRegistryRoot,
      source_stdio_capability: durableStdioCapability,
    })).toEqual(negativeProbeReceipt)

    const missingSuccessorTransportRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-successor-missing-"))
    try {
      expect(() => registerReplayWorkerV10SuccessorTransportContract({
        registry_root: missingSuccessorTransportRoot,
        source_negative_probe_receipt: negativeProbeReceipt,
      })).toThrow()
    } finally {
      rmSync(missingSuccessorTransportRoot, { recursive: true, force: true })
    }
    const successorTransportInput = { source_negative_probe_receipt: negativeProbeReceipt }
    const successorTransportContract = buildReplayDecisionHarnessWorkerV10SuccessorTransportContract(
      successorTransportInput,
    )
    replayProfile("successor transport")
    expect(successorTransportContract.status).toBe("artifact_bound_activation_blocked_zero_instance")
    expect(successorTransportContract.logical_request_artifact_hash).toBe(buildAttestation.artifact.sha256)
    expect(successorTransportContract.predecessor_decoder_artifact_hash)
      .toBe(workerV10BuildCapability.artifact.sha256)
    expect(successorTransportContract.successor_process_artifact_hash)
      .toBe(workerV10StdioCapability.artifact.sha256)
    expect(successorTransportContract.artifact_binding_status)
      .toBe("successor_stdio_process_artifact_bound")
    expect(successorTransportContract.predecessor_contract_relation)
      .toBe("r4_119_immutable_not_rewritten")
    expect(successorTransportContract.target_request_execution_admission).toBe("not_granted")
    expect(successorTransportContract.target_request_transport_status).toBe("not_invoked")
    expect(successorTransportContract.immutable_request_policy)
      .toBe("request_v10_markers_cannot_be_mutated_by_transport_contract")
    expect(successorTransportContract.blockers).toEqual([
      "target_worker_request_execution_admission_not_granted",
      "target_worker_request_transport_status_not_invoked",
      "current_lease_revalidation_for_successor_process_not_materialized",
      "attempt_bound_stdio_process_launch_intent_not_materialized",
      "attempt_bound_stdio_process_receipt_not_materialized",
      "worker_request_frame_instance_not_materialized",
      "worker_request_write_receipt_not_materialized",
      "worker_request_decode_receipt_not_materialized",
      "worker_response_frame_read_and_admission_not_materialized",
    ])
    expect(successorTransportContract.source_negative_probe_process_instance_count).toBe(5)
    expect(successorTransportContract.source_negative_probe_worker_request_frame_count).toBe(0)
    expect(successorTransportContract.admitted_process_instance_count).toBe(0)
    expect(successorTransportContract.current_lease_revalidation_receipt).toBeNull()
    expect(successorTransportContract.attempt_bound_process_launch_intent).toBeNull()
    expect(successorTransportContract.attempt_bound_process_receipt).toBeNull()
    expect(successorTransportContract.request_frame_instance_count).toBe(0)
    expect(successorTransportContract.request_write_receipt_count).toBe(0)
    expect(successorTransportContract.request_decode_receipt_count).toBe(0)
    expect(successorTransportContract.response_frame_instance_count).toBe(0)
    expect(successorTransportContract.response_read_receipt_count).toBe(0)
    expect(successorTransportContract.dispatch_occurrence).toBe("not_materialized")
    expect(successorTransportContract.transport_activation).toBe("blocked")
    expect(successorTransportContract.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(
      successorTransportContract,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContractLineage(
      successorTransportContract,
      successorTransportInput,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract({
      ...successorTransportContract,
      successor_process_artifact_hash: successorTransportContract.predecessor_decoder_artifact_hash,
    })).toThrow("parent or artifact binding drift")
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorTransportContract({
      ...successorTransportContract,
      request_frame_instance_count: 1 as never,
    })).toThrow("unsupported decision harness Worker v10 successor Transport Contract authority")

    const registeredSuccessorTransport = registerReplayWorkerV10SuccessorTransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_negative_probe_receipt: negativeProbeReceipt,
    })
    expect(registeredSuccessorTransport).toEqual(successorTransportContract)
    expect(registerReplayWorkerV10SuccessorTransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_negative_probe_receipt: structuredClone(negativeProbeReceipt),
    })).toEqual(successorTransportContract)
    expect(readReplayWorkerV10SuccessorTransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_negative_probe_receipt: negativeProbeReceipt,
    })).toEqual(successorTransportContract)

    const missingExecutionAdmissionRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-admission-missing-"))
    try {
      expect(() => registerReplayWorkerV10ExecutionAdmissionContract({
        registry_root: missingExecutionAdmissionRoot,
        source_successor_transport_contract: successorTransportContract,
      })).toThrow()
    } finally {
      rmSync(missingExecutionAdmissionRoot, { recursive: true, force: true })
    }
    const executionAdmissionInput = {
      source_successor_transport_contract: successorTransportContract,
    }
    const executionAdmissionContract = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(
      executionAdmissionInput,
    )
    replayProfile("execution admission")
    expect(executionAdmissionContract.status)
      .toBe("authority_model_frozen_activation_blocked_zero_instance")
    expect(executionAdmissionContract.execution_authority_model)
      .toBe("separate_attempt_bound_execution_admission_command")
    expect(executionAdmissionContract.request_v11_decision)
      .toBe("not_required_for_authority_only_transition")
    expect(executionAdmissionContract.worker_request_v10_role)
      .toBe("immutable_non_executable_logical_payload_source")
    expect(executionAdmissionContract.worker_request_marker_policy)
      .toBe("preserved_not_overridden_or_reinterpreted")
    expect(executionAdmissionContract.effective_executable_object)
      .toBe("future_execution_admission_command_not_worker_request_v10")
    expect(executionAdmissionContract.target_worker_request_execution_admission).toBe("not_granted")
    expect(executionAdmissionContract.target_worker_request_transport_status).toBe("not_invoked")
    expect(executionAdmissionContract.future_command_required_bindings).toEqual([
      "worker_request_hash",
      "logical_request_id",
      "attempt_id",
      "attempt_ordinal",
      "worker_id",
      "lease_generation",
      "dispatch_claim_hash",
      "current_lease_observation_hash",
      "successor_process_artifact_hash",
      "transport_contract_hash",
    ])
    expect(executionAdmissionContract.blockers).toEqual([
      "exact_durable_dispatch_claim_not_bound",
      "control_plane_registry_read_provenance_not_materialized",
      "independent_dispatch_clock_attestation_not_materialized",
      "current_lease_revalidation_for_admission_command_not_materialized",
      "execution_admission_command_instance_not_issued",
      "attempt_bound_stdio_process_launch_intent_not_materialized",
      "attempt_bound_stdio_process_receipt_not_materialized",
      "worker_request_frame_write_and_decode_not_materialized",
      "worker_response_frame_read_and_admission_not_materialized",
    ])
    expect(executionAdmissionContract.admission_command_instance_count).toBe(0)
    expect(executionAdmissionContract.request_frame_instance_count).toBe(0)
    expect(executionAdmissionContract.request_write_receipt_count).toBe(0)
    expect(executionAdmissionContract.request_decode_receipt_count).toBe(0)
    expect(executionAdmissionContract.response_frame_instance_count).toBe(0)
    expect(executionAdmissionContract.response_read_receipt_count).toBe(0)
    expect(executionAdmissionContract.dispatch_occurrence).toBe("not_materialized")
    expect(executionAdmissionContract.transport_activation).toBe("blocked")
    expect(executionAdmissionContract.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(
      executionAdmissionContract,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContractLineage(
      executionAdmissionContract,
      executionAdmissionInput,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract({
      ...executionAdmissionContract,
      worker_request_marker_policy: "overridden" as never,
    })).toThrow("unsupported decision harness Worker v10 Execution Admission Contract authority")
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract({
      ...executionAdmissionContract,
      admission_command_instance_count: 1 as never,
    })).toThrow("unsupported decision harness Worker v10 Execution Admission Contract authority")
    expect(registerReplayWorkerV10ExecutionAdmissionContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_successor_transport_contract: successorTransportContract,
    })).toEqual(executionAdmissionContract)
    expect(registerReplayWorkerV10ExecutionAdmissionContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_successor_transport_contract: structuredClone(successorTransportContract),
    })).toEqual(executionAdmissionContract)
    expect(readReplayWorkerV10ExecutionAdmissionContract({
      registry_root: dispatchEvidenceRegistryRoot,
      source_successor_transport_contract: successorTransportContract,
    })).toEqual(executionAdmissionContract)

    const claimObservation = createReplayAttemptLeaseObservationSnapshot({
      ...leaseObservationBody,
      observation_id: "lease-observation-envelope-claim",
      observation_ref: "observation://replay-attempt-lease/envelope-claim",
      observed_at: "2026-07-14T00:00:32Z",
    })
    expect(() => claimReplayDispatch({
      registry_root: dispatchEvidenceRegistryRoot,
      source_registration: dispatchEvidenceRegistration,
      revalidation_observation: leaseObservation,
      dispatcher_claimant_id: "runner-claimant-1",
      claimed_at: "2026-07-14T00:00:33Z",
    })).toThrow("requires a post-registration Lease observation")
    expect(() => claimReplayDispatch({
      registry_root: dispatchEvidenceRegistryRoot,
      source_registration: dispatchEvidenceRegistration,
      revalidation_observation: claimObservation,
      dispatcher_claimant_id: "runner-claimant-1",
      claimed_at: attemptLease.lease_expires_at,
    })).toThrow("must occur inside the revalidated Lease window")
    const missingRegistrationRoot = mkdtempSync(join(tmpdir(), "replay-dispatch-claim-missing-"))
    try {
      expect(() => claimReplayDispatch({
        registry_root: missingRegistrationRoot,
        source_registration: dispatchEvidenceRegistration,
        revalidation_observation: claimObservation,
        dispatcher_claimant_id: "runner-claimant-1",
        claimed_at: "2026-07-14T00:00:33Z",
      })).toThrow("requires the exact durable Dispatch Evidence Registration")
    } finally {
      rmSync(missingRegistrationRoot, { recursive: true, force: true })
    }
    const claimRenewedObservation = createReplayAttemptLeaseObservationSnapshot({
      ...leaseObservationBody,
      observation_id: "lease-observation-envelope-claim-renewed",
      observation_ref: "observation://replay-attempt-lease/envelope-claim-renewed",
      observed_at: renewedLease.heartbeat_at,
      lease_generation: renewedLease.lease_generation,
      attempt_lease_hash: hashReplayAttemptLeaseSnapshot(renewedLease),
      attempt_lease: renewedLease,
    })
    expect(() => claimReplayDispatch({
      registry_root: dispatchEvidenceRegistryRoot,
      source_registration: dispatchEvidenceRegistration,
      revalidation_observation: claimRenewedObservation,
      dispatcher_claimant_id: "runner-claimant-1",
      claimed_at: "2026-07-14T00:02:01Z",
    })).toThrow("registration or Lease revalidation drift")

    const dispatchClaim = claimReplayDispatch({
      registry_root: dispatchEvidenceRegistryRoot,
      source_registration: dispatchEvidenceRegistration,
      revalidation_observation: claimObservation,
      dispatcher_claimant_id: "runner-claimant-1",
      claimed_at: "2026-07-14T00:00:33Z",
    })
    replayProfile("dispatch claim")
    expect(dispatchClaim.claim_effect)
      .toBe("at_most_one_local_claimant_while_cas_record_is_preserved")
    expect(dispatchClaim.delivery_guarantee).toBe("at_most_once_claim_can_lose_dispatch_before_occurrence")
    expect(dispatchClaim.dispatch_authorization)
      .toBe("cas_exclusivity_only_not_process_or_transport_authority")
    expect(dispatchClaim.dispatch_occurrence).toBe("not_materialized")
    expect(() => assertReplayDecisionHarnessDispatchClaim(dispatchClaim)).not.toThrow()
    expect(claimReplayDispatch({
      registry_root: dispatchEvidenceRegistryRoot,
      source_registration: structuredClone(dispatchEvidenceRegistration),
      revalidation_observation: structuredClone(claimObservation),
      dispatcher_claimant_id: "runner-claimant-1",
      claimed_at: "2026-07-14T00:00:34Z",
    })).toEqual(dispatchClaim)
    expect(() => claimReplayDispatch({
      registry_root: dispatchEvidenceRegistryRoot,
      source_registration: dispatchEvidenceRegistration,
      revalidation_observation: claimObservation,
      dispatcher_claimant_id: "runner-claimant-2",
      claimed_at: "2026-07-14T00:00:34Z",
    })).toThrow("natural key is already claimed by different authority")
    expect(readReplayDispatchClaim({
      registry_root: dispatchEvidenceRegistryRoot,
      attempt_id: dispatchEvidenceRegistration.attempt_id,
      lease_generation: dispatchEvidenceRegistration.lease_generation,
      logical_request_id: dispatchEvidenceRegistration.logical_request_id,
    })).toEqual(dispatchClaim)

    const preIssueObservation = createReplayAttemptLeaseObservationSnapshot({
      ...leaseObservationBody,
      observation_id: "lease-observation-envelope-pre-issue",
      observation_ref: "observation://replay-attempt-lease/envelope-pre-issue",
      observed_at: "2026-07-14T00:00:34Z",
    })
    const preIssueInput = {
      source_execution_admission_contract: executionAdmissionContract,
      source_dispatch_claim: dispatchClaim,
      source_current_lease_observation: preIssueObservation,
    }
    const preIssueBundle = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(preIssueInput)
    replayProfile("pre-issue bundle")
    expect(preIssueBundle.status).toBe("claim_and_lease_evidence_bound_command_issue_blocked")
    expect(preIssueBundle.durable_claim_binding).toBe("exact_local_cas_dispatch_claim_bound")
    expect(preIssueBundle.lease_revalidation_status)
      .toBe("fresh_under_control_plane_receipt_with_caller_supplied_clock_only")
    expect(preIssueBundle.predecessor_blocker_closure)
      .toBe("dispatch_claim_and_current_lease_revalidation_bound_without_closing_provenance_or_clock")
    expect(preIssueBundle.control_plane_registry_read_provenance)
      .toBe("not_materialized_observation_wire_only")
    expect(preIssueBundle.clock_evidence).toBe("caller_supplied_utc_not_external_time_attestation")
    expect(preIssueBundle.target_worker_request_hash).toBe(executionAdmissionContract.target_worker_request_hash)
    expect(preIssueBundle.attempt_id).toBe(dispatchClaim.attempt_id)
    expect(preIssueBundle.lease_generation).toBe(dispatchClaim.lease_generation)
    expect(preIssueBundle.successor_process_artifact_hash)
      .toBe(successorTransportContract.successor_process_artifact_hash)
    expect(preIssueBundle.transport_contract_hash).toBe(successorTransportContract.contract_hash)
    expect(preIssueBundle.execution_admission_command).toBeNull()
    expect(preIssueBundle.execution_admission_command_instance_count).toBe(0)
    expect(preIssueBundle.blockers).toEqual([
      "control_plane_registry_read_provenance_not_materialized",
      "independent_dispatch_clock_attestation_not_materialized",
      "execution_admission_command_instance_not_issued",
      "attempt_bound_stdio_process_launch_intent_not_materialized",
      "attempt_bound_stdio_process_receipt_not_materialized",
      "worker_request_frame_write_and_decode_not_materialized",
      "worker_response_frame_read_and_admission_not_materialized",
    ])
    expect(preIssueBundle.dispatch_occurrence).toBe("not_materialized")
    expect(preIssueBundle.transport_activation).toBe("blocked")
    expect(preIssueBundle.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(preIssueBundle))
      .not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleLineage(
      preIssueBundle,
      preIssueInput,
    )).not.toThrow()
    expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
      ...preIssueInput,
      source_current_lease_observation: claimObservation,
    })).toThrow("observation is not post-claim fresh")
    expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
      ...preIssueInput,
      source_current_lease_observation: claimRenewedObservation,
    })).toThrow("parent binding drift")
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle({
      ...preIssueBundle,
      execution_admission_command_instance_count: 1 as never,
    })).toThrow("unsupported decision harness Worker v10 Execution Admission pre-issue authority")

    const missingPreIssueRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-pre-issue-missing-"))
    try {
      expect(() => registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
        registry_root: missingPreIssueRoot,
        ...preIssueInput,
      })).toThrow()
    } finally {
      rmSync(missingPreIssueRoot, { recursive: true, force: true })
    }
    expect(registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
      registry_root: dispatchEvidenceRegistryRoot,
      ...preIssueInput,
    })).toEqual(preIssueBundle)
    expect(registerReplayWorkerV10ExecutionAdmissionPreIssueBundle({
      registry_root: dispatchEvidenceRegistryRoot,
      source_execution_admission_contract: structuredClone(executionAdmissionContract),
      source_dispatch_claim: structuredClone(dispatchClaim),
      source_current_lease_observation: structuredClone(preIssueObservation),
    })).toEqual(preIssueBundle)
    expect(readReplayWorkerV10ExecutionAdmissionPreIssueBundle({
      registry_root: dispatchEvidenceRegistryRoot,
      ...preIssueInput,
    })).toEqual(preIssueBundle)
    const registryReadReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
      schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
      receipt_id: `replay-attempt-lease-observation-registry-read-${preIssueObservation.observation_hash.slice(0, 16)}-${Date.parse("2026-07-14T00:00:35Z")}`,
      receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${preIssueObservation.observation_hash.slice(0, 16)}-${Date.parse("2026-07-14T00:00:35Z")}`,
      receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
      status: "registered_active_lease_observation_read",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      registry_table: "rd_replay_attempt_lease_observation",
      registry_key: preIssueObservation.observation_id,
      registry_row_immutability: "sqlite_update_and_delete_triggers",
      read_consistency: "single_control_plane_transaction",
      registry_read_provenance: "registered_row_and_current_attempt_exact_match",
      registered_at: "2026-07-14T00:00:34Z",
      read_at: "2026-07-14T00:00:35Z",
      clock_evidence: "caller_supplied_utc_not_external_time_attestation",
      external_time_attestation: "not_provided",
      source_observation_id: preIssueObservation.observation_id,
      source_observation_ref: preIssueObservation.observation_ref,
      source_observation_hash: preIssueObservation.observation_hash,
      source_observation: preIssueObservation,
      current_attempt_status: preIssueObservation.attempt_lease.status,
      current_attempt_lease_hash: preIssueObservation.attempt_lease_hash,
      current_attempt_lease: preIssueObservation.attempt_lease,
    })
    const registryProvenanceInput = {
      source_pre_issue_bundle: preIssueBundle,
      control_plane_registry_read_receipt: registryReadReceipt,
    }
    const registryProvenance = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(
      registryProvenanceInput,
    )
    replayProfile("registry provenance")
    expect(registryProvenance.status).toBe("registry_provenance_bound_independent_clock_blocked")
    expect(registryProvenance.control_plane_registry_read_provenance)
      .toBe("registered_row_and_current_attempt_exact_match_bound")
    expect(registryProvenance.predecessor_blocker_closure)
      .toBe("control_plane_registry_read_provenance_closed_only")
    expect(registryProvenance.external_time_attestation).toBe("not_provided")
    expect(registryProvenance.execution_admission_command_instance_count).toBe(0)
    expect(registryProvenance.blockers).toEqual([
      "independent_dispatch_clock_attestation_not_materialized",
      "execution_admission_command_instance_not_issued",
      "attempt_bound_stdio_process_launch_intent_not_materialized",
      "attempt_bound_stdio_process_receipt_not_materialized",
      "worker_request_frame_write_and_decode_not_materialized",
      "worker_response_frame_read_and_admission_not_materialized",
    ])
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(registryProvenance))
      .not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceLineage(
      registryProvenance,
      registryProvenanceInput,
    )).not.toThrow()
    expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance({
      ...registryProvenanceInput,
      control_plane_registry_read_receipt: { ...registryReadReceipt, receipt_hash: "1".repeat(64) },
    })).toThrow()
    const missingProvenanceRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-registry-provenance-missing-"))
    try {
      expect(() => registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
        registry_root: missingProvenanceRoot,
        ...registryProvenanceInput,
      })).toThrow("requires the exact durable pre-issue bundle")
    } finally {
      rmSync(missingProvenanceRoot, { recursive: true, force: true })
    }
    expect(registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
      registry_root: dispatchEvidenceRegistryRoot,
      ...registryProvenanceInput,
    })).toEqual(registryProvenance)
    expect(registerReplayWorkerV10ExecutionAdmissionRegistryProvenance({
      registry_root: dispatchEvidenceRegistryRoot,
      source_pre_issue_bundle: structuredClone(preIssueBundle),
      control_plane_registry_read_receipt: structuredClone(registryReadReceipt),
    })).toEqual(registryProvenance)
    expect(readReplayWorkerV10ExecutionAdmissionRegistryProvenance({
      registry_root: dispatchEvidenceRegistryRoot,
      ...registryProvenanceInput,
    })).toEqual(registryProvenance)
    const clockIdentityHash = replayDispatchClockAttestationIdentityHash({
      source_registry_read_receipt_hash: registryReadReceipt.receipt_hash,
      registry_read_started_at: registryReadReceipt.read_at,
      registry_read_completed_at: "2026-07-14T00:00:36Z",
      registry_read_started_monotonic_ns: "3000000",
      registry_read_completed_monotonic_ns: "3000100",
      attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
    })
    const clockAttestation = createReplayDispatchClockAttestation({
      schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
      attestation_id: `replay-dispatch-clock-attestation-${clockIdentityHash.slice(0, 24)}`,
      attestation_ref: `attestation://replay-dispatch-clock/${clockIdentityHash.slice(0, 24)}`,
      attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
      status: "authority_clock_bracketed_registry_read",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      clock_source: "control_plane_authority_process_clock_port",
      clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
      caller_time_input: "forbidden",
      wall_clock_source: "javascript_date_now_utc",
      monotonic_clock_source: "process_hrtime_bigint",
      external_time_attestation: "not_provided",
      registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read",
      registry_read_started_at: registryReadReceipt.read_at,
      registry_read_completed_at: "2026-07-14T00:00:36Z",
      registry_read_started_monotonic_ns: "3000000",
      registry_read_completed_monotonic_ns: "3000100",
      source_registry_read_receipt_id: registryReadReceipt.receipt_id,
      source_registry_read_receipt_ref: registryReadReceipt.receipt_ref,
      source_registry_read_receipt_hash: registryReadReceipt.receipt_hash,
      source_registry_read_receipt: registryReadReceipt,
      attempt_id: registryReadReceipt.current_attempt_lease.attempt_id,
      worker_id: registryReadReceipt.current_attempt_lease.worker_id,
      lease_generation: registryReadReceipt.current_attempt_lease.lease_generation,
      current_attempt_lease_hash: registryReadReceipt.current_attempt_lease_hash,
    })
    const clockBindingInput = {
      source_registry_provenance: registryProvenance,
      control_plane_clock_attestation: clockAttestation,
    }
    const clockBinding = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(clockBindingInput)
    replayProfile("clock binding")
    expect(clockBinding.status).toBe("authority_clock_attested_command_issue_blocked")
    expect(clockBinding.independent_dispatch_clock_attestation).toBe("authority_internal_dual_sample_bound")
    expect(clockBinding.clock_authority_limit).toBe("local_control_plane_process_clock_not_signed_remote_or_tsa_time")
    expect(clockBinding.predecessor_blocker_closure).toBe("independent_dispatch_clock_attestation_closed_only")
    expect(clockBinding.execution_admission_command_instance_count).toBe(0)
    expect(clockBinding.blockers).toEqual([
      "execution_admission_command_instance_not_issued",
      "attempt_bound_stdio_process_launch_intent_not_materialized",
      "attempt_bound_stdio_process_receipt_not_materialized",
      "worker_request_frame_write_and_decode_not_materialized",
      "worker_response_frame_read_and_admission_not_materialized",
    ])
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(clockBinding)).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationLineage(
      clockBinding,
      clockBindingInput,
    )).not.toThrow()
    expect(() => buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation({
      ...clockBindingInput,
      control_plane_clock_attestation: { ...clockAttestation, attestation_hash: "2".repeat(64) },
    })).toThrow()
    const missingClockRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-clock-attestation-missing-"))
    try {
      expect(() => registerReplayWorkerV10ExecutionAdmissionClockAttestation({
        registry_root: missingClockRoot,
        ...clockBindingInput,
      })).toThrow("requires the exact durable registry provenance")
    } finally {
      rmSync(missingClockRoot, { recursive: true, force: true })
    }
    expect(registerReplayWorkerV10ExecutionAdmissionClockAttestation({
      registry_root: dispatchEvidenceRegistryRoot,
      ...clockBindingInput,
    })).toEqual(clockBinding)
    expect(readReplayWorkerV10ExecutionAdmissionClockAttestation({
      registry_root: dispatchEvidenceRegistryRoot,
      ...clockBindingInput,
    })).toEqual(clockBinding)
    const commandInput = { source_clock_binding: clockBinding }
    const executionAdmissionCommand = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(commandInput)
    replayProfile("execution command")
    expect(executionAdmissionCommand.status).toBe("issued_process_launch_intent_not_materialized")
    expect(executionAdmissionCommand.command_instance_count).toBe(1)
    expect(executionAdmissionCommand.execution_admission)
      .toBe("granted_for_exact_attempt_bound_process_launch_intent_creation_only")
    expect(executionAdmissionCommand.worker_request_hash).toBe(clockBinding.target_worker_request_hash)
    expect(executionAdmissionCommand.dispatch_claim_hash).toBe(dispatchClaim.claim_hash)
    expect(executionAdmissionCommand.current_lease_observation_hash).toBe(preIssueObservation.observation_hash)
    expect(executionAdmissionCommand.registry_read_receipt_hash).toBe(registryReadReceipt.receipt_hash)
    expect(executionAdmissionCommand.dispatch_clock_attestation_hash).toBe(clockAttestation.attestation_hash)
    expect(executionAdmissionCommand.issued_at).toBe(clockAttestation.registry_read_completed_at)
    expect(executionAdmissionCommand.valid_before).toBe(attemptLease.lease_expires_at)
    expect(executionAdmissionCommand.blockers).toEqual([
      "attempt_bound_stdio_process_launch_intent_not_materialized",
      "attempt_bound_stdio_process_receipt_not_materialized",
      "worker_request_frame_write_and_decode_not_materialized",
      "worker_response_frame_read_and_admission_not_materialized",
    ])
    expect(executionAdmissionCommand.attempt_bound_process_launch_intent_count).toBe(0)
    expect(executionAdmissionCommand.dispatch_occurrence).toBe("not_materialized")
    expect(executionAdmissionCommand.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(executionAdmissionCommand)).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandLineage(
      executionAdmissionCommand,
      commandInput,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand({
      ...executionAdmissionCommand,
      attempt_bound_process_launch_intent_count: 1 as never,
    })).toThrow("unsupported Execution Admission Command authority")
    const missingCommandRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-execution-command-missing-"))
    try {
      expect(() => issueReplayWorkerV10ExecutionAdmissionCommand({
        registry_root: missingCommandRoot,
        ...commandInput,
      })).toThrow("requires the exact durable clock attestation binding")
    } finally {
      rmSync(missingCommandRoot, { recursive: true, force: true })
    }
    expect(issueReplayWorkerV10ExecutionAdmissionCommand({
      registry_root: dispatchEvidenceRegistryRoot,
      ...commandInput,
    })).toEqual(executionAdmissionCommand)
    expect(readReplayWorkerV10ExecutionAdmissionCommand({
      registry_root: dispatchEvidenceRegistryRoot,
      ...commandInput,
    })).toEqual(executionAdmissionCommand)

    const postCommandObservation = createReplayAttemptLeaseObservationSnapshot({
      ...leaseObservationBody,
      observation_id: "lease-observation-envelope-process-intent",
      observation_ref: "observation://replay-attempt-lease/process-intent",
      observed_at: "2026-07-14T00:00:38Z",
    })
    const postCommandReadAt = "2026-07-14T00:00:40Z"
    const postCommandRegistryReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
      schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
      receipt_id: `replay-attempt-lease-observation-registry-read-${postCommandObservation.observation_hash.slice(0, 16)}-${Date.parse(postCommandReadAt)}`,
      receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${postCommandObservation.observation_hash.slice(0, 16)}-${Date.parse(postCommandReadAt)}`,
      receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
      status: "registered_active_lease_observation_read",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      registry_table: "rd_replay_attempt_lease_observation",
      registry_key: postCommandObservation.observation_id,
      registry_row_immutability: "sqlite_update_and_delete_triggers",
      read_consistency: "single_control_plane_transaction",
      registry_read_provenance: "registered_row_and_current_attempt_exact_match",
      registered_at: "2026-07-14T00:00:39Z",
      read_at: postCommandReadAt,
      clock_evidence: "caller_supplied_utc_not_external_time_attestation",
      external_time_attestation: "not_provided",
      source_observation_id: postCommandObservation.observation_id,
      source_observation_ref: postCommandObservation.observation_ref,
      source_observation_hash: postCommandObservation.observation_hash,
      source_observation: postCommandObservation,
      current_attempt_status: postCommandObservation.attempt_lease.status,
      current_attempt_lease_hash: postCommandObservation.attempt_lease_hash,
      current_attempt_lease: postCommandObservation.attempt_lease,
    })
    const postCommandClockIdentityHash = replayDispatchClockAttestationIdentityHash({
      source_registry_read_receipt_hash: postCommandRegistryReceipt.receipt_hash,
      registry_read_started_at: postCommandReadAt,
      registry_read_completed_at: "2026-07-14T00:00:41Z",
      registry_read_started_monotonic_ns: "4000000",
      registry_read_completed_monotonic_ns: "4000100",
      attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
    })
    const postCommandClockAttestation = createReplayDispatchClockAttestation({
      schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
      attestation_id: `replay-dispatch-clock-attestation-${postCommandClockIdentityHash.slice(0, 24)}`,
      attestation_ref: `attestation://replay-dispatch-clock/${postCommandClockIdentityHash.slice(0, 24)}`,
      attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
      status: "authority_clock_bracketed_registry_read",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      clock_source: "control_plane_authority_process_clock_port",
      clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
      caller_time_input: "forbidden",
      wall_clock_source: "javascript_date_now_utc",
      monotonic_clock_source: "process_hrtime_bigint",
      external_time_attestation: "not_provided",
      registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read",
      registry_read_started_at: postCommandReadAt,
      registry_read_completed_at: "2026-07-14T00:00:41Z",
      registry_read_started_monotonic_ns: "4000000",
      registry_read_completed_monotonic_ns: "4000100",
      source_registry_read_receipt_id: postCommandRegistryReceipt.receipt_id,
      source_registry_read_receipt_ref: postCommandRegistryReceipt.receipt_ref,
      source_registry_read_receipt_hash: postCommandRegistryReceipt.receipt_hash,
      source_registry_read_receipt: postCommandRegistryReceipt,
      attempt_id: postCommandRegistryReceipt.current_attempt_lease.attempt_id,
      worker_id: postCommandRegistryReceipt.current_attempt_lease.worker_id,
      lease_generation: postCommandRegistryReceipt.current_attempt_lease.lease_generation,
      current_attempt_lease_hash: postCommandRegistryReceipt.current_attempt_lease_hash,
    })
    const processIntentInput = {
      source_execution_admission_command: executionAdmissionCommand,
      post_command_clock_attestation: postCommandClockAttestation,
    }
    const processLaunchIntent = buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent(processIntentInput)
    replayProfile("process launch intent")
    expect(processLaunchIntent.status).toBe("intent_committed_process_not_started")
    expect(processLaunchIntent.process_launch_intent_instance_count).toBe(1)
    expect(processLaunchIntent.source_execution_admission_command_hash).toBe(executionAdmissionCommand.command_hash)
    expect(processLaunchIntent.post_command_lease_observation_hash).toBe(postCommandObservation.observation_hash)
    expect(processLaunchIntent.current_attempt_lease_hash).toBe(executionAdmissionCommand.current_attempt_lease_hash)
    expect(processLaunchIntent.process_artifact_hash).toBe(executionAdmissionCommand.successor_process_artifact_hash)
    expect(processLaunchIntent.intent_issued_at).toBe(postCommandClockAttestation.registry_read_completed_at)
    expect(processLaunchIntent.valid_before).toBe(attemptLease.lease_expires_at)
    expect(processLaunchIntent.process_launch_authority)
      .toBe("not_granted_until_fresh_spawn_boundary_revalidation")
    expect(processLaunchIntent.blockers).toEqual([
      "attempt_bound_stdio_process_receipt_not_materialized",
      "worker_request_frame_write_and_decode_not_materialized",
      "worker_response_frame_read_and_admission_not_materialized",
    ])
    expect(processLaunchIntent.attempt_bound_process_receipt_count).toBe(0)
    expect(processLaunchIntent.admitted_process_instance_count).toBe(0)
    expect(processLaunchIntent.process_launch_occurrence).toBe("not_materialized")
    expect(processLaunchIntent.dispatch_occurrence).toBe("not_materialized")
    expect(processLaunchIntent.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(processLaunchIntent)).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntentLineage(
      processLaunchIntent,
      processIntentInput,
    )).not.toThrow()
    expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
      ...processIntentInput,
      post_command_clock_attestation: clockAttestation,
    })).toThrow("parent, revalidation, or executable binding drift")
    expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
      ...processIntentInput,
      post_command_clock_attestation: {
        ...postCommandClockAttestation,
        source_registry_read_receipt: {
          ...postCommandRegistryReceipt,
          current_attempt_status: "cancelled" as never,
        },
      },
    })).toThrow()
    expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
      ...processIntentInput,
      post_command_clock_attestation: {
        ...postCommandClockAttestation,
        lease_generation: postCommandClockAttestation.lease_generation + 1,
      },
    })).toThrow()
    expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
      ...processIntentInput,
      post_command_clock_attestation: {
        ...postCommandClockAttestation,
        registry_read_completed_at: attemptLease.lease_expires_at,
      },
    })).toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
      ...processLaunchIntent,
      process_launch_occurrence: "materialized" as never,
    })).toThrow("unsupported Worker v10 Process Launch Intent authority")
    const missingIntentRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-process-intent-missing-"))
    try {
      expect(() => issueReplayWorkerV10ProcessLaunchIntent({
        registry_root: missingIntentRoot,
        ...processIntentInput,
      })).toThrow("requires the exact durable Execution Admission Command")
    } finally {
      rmSync(missingIntentRoot, { recursive: true, force: true })
    }
    expect(issueReplayWorkerV10ProcessLaunchIntent({
      registry_root: dispatchEvidenceRegistryRoot,
      ...processIntentInput,
    })).toEqual(processLaunchIntent)
    expect(readReplayWorkerV10ProcessLaunchIntent({
      registry_root: dispatchEvidenceRegistryRoot,
      ...processIntentInput,
    })).toEqual(processLaunchIntent)

    const processReadinessInput = { source_process_launch_intent: processLaunchIntent }
    const missingReadinessRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-readiness-missing-"))
    try {
      expect(() => registerReplayWorkerV10ProcessLaunchReadinessGate({
        registry_root: missingReadinessRoot,
        ...processReadinessInput,
      })).toThrow("requires the exact durable Process Launch Intent")
    } finally {
      rmSync(missingReadinessRoot, { recursive: true, force: true })
    }
    const processLaunchReadiness = registerReplayWorkerV10ProcessLaunchReadinessGate({
      registry_root: dispatchEvidenceRegistryRoot,
      ...processReadinessInput,
    })
    replayProfile("process launch readiness")
    expect(processLaunchReadiness.status).toBe("blocked_intent_bound_artifact_not_dispatch_executable")
    expect(processLaunchReadiness.launch_decision).toBe("denied")
    expect(processLaunchReadiness.launch_decision_reason)
      .toBe("spawn_would_only_create_a_terminal_non_dispatch_process")
    expect(processLaunchReadiness.intent_bound_process_artifact_hash).toBe(processLaunchIntent.process_artifact_hash)
    expect(processLaunchReadiness.artifact_valid_frame_exit_code).toBe(70)
    expect(processLaunchReadiness.artifact_valid_frame_error_code).toBe("transport_activation_not_granted")
    expect(processLaunchReadiness.request_frame_authority_finding)
      .toBe("unadmitted_candidate_has_no_command_or_intent_hash")
    expect(processLaunchReadiness.response_frame_authority_finding)
      .toBe("unadmitted_candidate_has_no_execution_admission_command_hash")
    expect(processLaunchReadiness.exact_binding_consequence)
      .toBe("new_artifact_requires_new_transport_command_and_intent_versions")
    expect(processLaunchReadiness.required_cutover_objects).toEqual([
      "activated_stdio_build_capability",
      "command_bound_request_frame",
      "command_echoing_response_frame",
      "artifact_bound_successor_transport",
      "new_execution_admission_command",
      "new_process_launch_intent",
    ])
    expect(processLaunchReadiness.blockers).toEqual([
      "intent_bound_artifact_rejects_every_parseable_request_before_decode",
      "request_frame_v1_lacks_command_and_intent_authority_binding",
      "response_frame_v1_lacks_execution_admission_command_echo",
      "exact_artifact_binding_requires_versioned_downstream_reissue",
    ])
    expect(processLaunchReadiness.readiness_gate_instance_count).toBe(1)
    expect(processLaunchReadiness.process_launch_receipt_count).toBe(0)
    expect(processLaunchReadiness.admitted_process_instance_count).toBe(0)
    expect(processLaunchReadiness.request_frame_instance_count).toBe(0)
    expect(processLaunchReadiness.response_frame_instance_count).toBe(0)
    expect(processLaunchReadiness.dispatch_occurrence).toBe("not_materialized")
    expect(processLaunchReadiness.harness_invocation).toBe("forbidden")
    expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate({
      ...processLaunchReadiness,
      launch_decision: "granted" as never,
    })).toThrow("unsupported Worker v10 Process Launch Readiness Gate authority")
    expect(readReplayWorkerV10ProcessLaunchReadinessGate({
      registry_root: dispatchEvidenceRegistryRoot,
      ...processReadinessInput,
    })).toEqual(processLaunchReadiness)

    const authorityBuildInput = { source_launch_readiness_gate: processLaunchReadiness }
    const authorityFrameBuild = buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
      authorityBuildInput,
    )
    replayProfile("authority frame build")
    expect(authorityFrameBuild.status).toBe("contract_frozen_build_not_materialized")
    expect(authorityFrameBuild.request_frame_schema_version)
      .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION)
    expect(authorityFrameBuild.response_frame_schema_version)
      .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION)
    expect(authorityFrameBuild.required_response_echo_fields).toEqual([
      "execution_admission_command_hash",
      "process_launch_intent_hash",
      "request_frame_hash",
      "worker_request_hash",
    ])
    expect(authorityFrameBuild.old_authority_reuse_policy)
      .toBe("forbidden_new_artifact_requires_new_transport_command_and_intent")
    expect(authorityFrameBuild.blockers).toEqual([
      "activated_stdio_process_artifact_not_materialized",
      "artifact_bound_successor_transport_not_materialized",
      "successor_execution_admission_command_not_issued",
      "successor_process_launch_intent_not_issued",
      "fresh_spawn_boundary_revalidation_not_materialized",
      "attempt_bound_process_launch_receipt_not_materialized",
      "authority_frame_write_decode_read_and_admission_not_materialized",
    ])
    expect(authorityFrameBuild.activated_stdio_artifact_count).toBe(0)
    expect(authorityFrameBuild.successor_transport_contract_count).toBe(0)
    expect(authorityFrameBuild.successor_execution_admission_command_count).toBe(0)
    expect(authorityFrameBuild.successor_process_launch_intent_count).toBe(0)
    expect(authorityFrameBuild.admitted_process_instance_count).toBe(0)
    expect(authorityFrameBuild.request_frame_instance_count).toBe(0)
    expect(authorityFrameBuild.response_frame_instance_count).toBe(0)
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
      authorityFrameBuild,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractLineage(
      authorityFrameBuild,
      authorityBuildInput,
    )).not.toThrow()

    const futureTransportHash = canonicalHash({ kind: "future-authority-transport" })
    const futureArtifactHash = canonicalHash({ kind: "future-activated-stdio-artifact" })
    const futureCommandHash = canonicalHash({ kind: "future-execution-admission-command" })
    const futureIntentHash = canonicalHash({ kind: "future-process-launch-intent" })
    const authorityRequestFrame = createReplayDecisionHarnessWorkerV10AuthorityRequestFrame({
      schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
      frame_kind: "worker_request",
      worker_protocol_version: firstRequestV10.worker_protocol_version,
      transport_contract_hash: futureTransportHash,
      execution_envelope_hash: executionEnvelope.envelope_hash,
      process_artifact_hash: futureArtifactHash,
      execution_admission_command_hash: futureCommandHash,
      process_launch_intent_hash: futureIntentHash,
      logical_request_id: firstRequestV10.logical_request_id,
      worker_request_hash: firstRequestV10.request_hash,
      worker_request: structuredClone(firstRequestV10),
      authority_status: "authority_bound_candidate_not_admitted",
    })
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame(
      authorityRequestFrame,
    )).not.toThrow()
    const authorityResponseFrame = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
      schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
      frame_kind: "worker_response",
      worker_protocol_version: responseV10.worker_protocol_version,
      transport_contract_hash: futureTransportHash,
      execution_envelope_hash: executionEnvelope.envelope_hash,
      process_artifact_hash: futureArtifactHash,
      execution_admission_command_hash: futureCommandHash,
      process_launch_intent_hash: futureIntentHash,
      request_frame_hash: authorityRequestFrame.frame_hash,
      logical_request_id: responseV10.logical_request_id,
      worker_request_hash: responseV10.request_hash,
      worker_response_hash: responseV10.response_hash,
      worker_response: structuredClone(responseV10),
      authority_status: "authority_bound_candidate_not_admitted",
    })
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
      authorityResponseFrame,
      authorityRequestFrame,
    )).not.toThrow()
    const { frame_hash: _authorityResponseHash, ...authorityResponseBody } = authorityResponseFrame
    const commandEchoTamper = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
      ...authorityResponseBody,
      execution_admission_command_hash: canonicalHash({ kind: "wrong-command" }),
    })
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
      commandEchoTamper,
      authorityRequestFrame,
    )).toThrow("Request authority echo drift")
    const requestEchoTamper = createReplayDecisionHarnessWorkerV10AuthorityResponseFrame({
      ...authorityResponseBody,
      request_frame_hash: canonicalHash({ kind: "wrong-request-frame" }),
    })
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
      requestEchoTamper,
      authorityRequestFrame,
    )).toThrow("Request authority echo drift")

    const missingAuthorityBuildRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-build-missing-"))
    try {
      expect(() => registerReplayWorkerV10AuthorityFrameBuildContract({
        registry_root: missingAuthorityBuildRoot,
        ...authorityBuildInput,
      })).toThrow("requires the exact durable Process Launch Readiness Gate")
    } finally {
      rmSync(missingAuthorityBuildRoot, { recursive: true, force: true })
    }
    expect(registerReplayWorkerV10AuthorityFrameBuildContract({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityBuildInput,
    })).toEqual(authorityFrameBuild)
    expect(readReplayWorkerV10AuthorityFrameBuildContract({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityBuildInput,
    })).toEqual(authorityFrameBuild)

    const activatedStdioInput = { source_authority_frame_build_contract: authorityFrameBuild }
    replayProfile("pre-authority transport chain")
    const activatedStdio = buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability(activatedStdioInput)
    expect(activatedStdio.status).toBe("artifact_built_successor_transport_and_authority_not_materialized")
    expect(activatedStdio.artifact.sha256).not.toBe(processLaunchReadiness.intent_bound_process_artifact_hash)
    expect(activatedStdio.authority_capsule_environment_variable)
      .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV)
    expect(activatedStdio.authority_capsule_fields).toEqual([
      "execution_admission_command_hash",
      "execution_envelope_hash",
      "logical_request_id",
      "process_artifact_hash",
      "process_launch_intent_hash",
      "transport_contract_hash",
      "worker_request_hash",
    ])
    expect(activatedStdio.frame_authority_validation)
      .toBe("every_outer_authority_field_must_equal_capsule_before_worker_request_decode")
    expect(activatedStdio.valid_authority_frame_probe)
      .toBe("not_materialized_until_successor_authority_exists")
    expect(activatedStdio.blockers).toEqual([
      "artifact_bound_successor_transport_not_materialized",
      "successor_execution_admission_command_not_issued",
      "successor_process_launch_intent_not_issued",
      "fresh_spawn_boundary_revalidation_not_materialized",
      "attempt_bound_process_launch_receipt_not_materialized",
      "authority_frame_write_decode_read_and_admission_not_materialized",
    ])
    expect(activatedStdio.activated_stdio_artifact_count).toBe(1)
    expect(activatedStdio.authority_capsule_instance_count).toBe(0)
    expect(activatedStdio.admitted_process_instance_count).toBe(0)
    expect(activatedStdio.request_frame_instance_count).toBe(0)
    expect(activatedStdio.response_frame_instance_count).toBe(0)
    expect(() => assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(activatedStdio)).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityLineage(
      activatedStdio,
      activatedStdioInput,
    )).not.toThrow()
    const activatedArtifactRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-activated-artifact-"))
    try {
      const artifactPath = join(activatedArtifactRoot, activatedStdio.artifact.file_name)
      writeFileSync(artifactPath, activatedStdio.artifact.content_utf8, "utf8")
      const missingCapsuleProbe = spawnSync(process.execPath, [artifactPath], {
        encoding: "utf8",
        env: { TZ: "UTC", LANG: "C", LC_ALL: "C" },
        input: "",
      })
      expect(missingCapsuleProbe.status).toBe(71)
      expect(missingCapsuleProbe.stderr).toBe('{"error_code":"launch_authority_capsule_missing"}\n')
      const malformedCapsuleProbe = spawnSync(process.execPath, [artifactPath], {
        encoding: "utf8",
        env: { TZ: "UTC", LANG: "C", LC_ALL: "C", [REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV]: "{}" },
        input: "",
      })
      expect(malformedCapsuleProbe.status).toBe(72)
      expect(malformedCapsuleProbe.stderr).toBe('{"error_code":"launch_authority_capsule_invalid"}\n')
    } finally {
      rmSync(activatedArtifactRoot, { recursive: true, force: true })
    }
    const missingActivatedRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-activated-missing-"))
    try {
      expect(() => registerReplayWorkerV10ActivatedStdioCapability({
        registry_root: missingActivatedRoot,
        ...activatedStdioInput,
      })).toThrow("requires the exact durable Authority Frame Build Contract")
    } finally {
      rmSync(missingActivatedRoot, { recursive: true, force: true })
    }
    expect(registerReplayWorkerV10ActivatedStdioCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      ...activatedStdioInput,
    })).toEqual(activatedStdio)
    expect(readReplayWorkerV10ActivatedStdioCapability({
      registry_root: dispatchEvidenceRegistryRoot,
      ...activatedStdioInput,
    })).toEqual(activatedStdio)

    const authorityTransportInput = { source_activated_stdio_capability: activatedStdio }
    const authorityTransport = buildReplayDecisionHarnessWorkerV10AuthorityTransportContract(
      authorityTransportInput,
    )
    expect(authorityTransport.status).toBe("activated_artifact_bound_authority_issuance_blocked_zero_process")
    expect(authorityTransport.activated_process_artifact_hash).toBe(activatedStdio.artifact.sha256)
    expect(authorityTransport.source_predecessor_transport_contract_hash)
      .toBe(successorTransportContract.contract_hash)
    expect(authorityTransport.request_frame_schema_version)
      .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION)
    expect(authorityTransport.response_frame_schema_version)
      .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION)
    expect(authorityTransport.authority_capsule_intent_binding)
      .toBe("future_successor_intent_hash_derived_at_spawn_not_stored_in_intent_payload")
    expect(authorityTransport.process_receipt_required_bindings)
      .toEqual(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_RECEIPT_BINDINGS)
    expect(authorityTransport.blockers).toEqual([
      "successor_execution_admission_command_not_issued",
      "successor_process_launch_intent_not_issued",
      "fresh_spawn_boundary_revalidation_not_materialized",
      "attempt_bound_process_launch_receipt_not_materialized",
      "authority_frame_write_decode_read_and_admission_not_materialized",
    ])
    expect(authorityTransport.activated_stdio_artifact_count).toBe(1)
    expect(authorityTransport.authority_transport_contract_instance_count).toBe(1)
    expect(authorityTransport.successor_execution_admission_command_count).toBe(0)
    expect(authorityTransport.successor_process_launch_intent_count).toBe(0)
    expect(authorityTransport.authority_capsule_instance_count).toBe(0)
    expect(authorityTransport.process_launch_receipt_count).toBe(0)
    expect(authorityTransport.request_frame_instance_count).toBe(0)
    expect(authorityTransport.response_frame_instance_count).toBe(0)
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(authorityTransport)).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContractLineage(
      authorityTransport,
      authorityTransportInput,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityTransportContract({
      ...authorityTransport,
      activated_process_artifact_hash: successorTransportContract.successor_process_artifact_hash,
    })).toThrow("parent or artifact binding drift")
    const missingAuthorityTransportRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-transport-missing-"))
    try {
      expect(() => registerReplayWorkerV10AuthorityTransportContract({
        registry_root: missingAuthorityTransportRoot,
        ...authorityTransportInput,
      })).toThrow("requires the exact durable Activated Stdio Capability")
    } finally {
      rmSync(missingAuthorityTransportRoot, { recursive: true, force: true })
    }
    expect(registerReplayWorkerV10AuthorityTransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityTransportInput,
    })).toEqual(authorityTransport)
    expect(readReplayWorkerV10AuthorityTransportContract({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityTransportInput,
    })).toEqual(authorityTransport)

    const authorityCommandReadAt = "2026-07-14T00:00:45Z"
    const authorityCommandRegistryReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
      schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
      receipt_id: `replay-attempt-lease-observation-registry-read-${postCommandObservation.observation_hash.slice(0, 16)}-${Date.parse(authorityCommandReadAt)}`,
      receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${postCommandObservation.observation_hash.slice(0, 16)}-${Date.parse(authorityCommandReadAt)}`,
      receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
      status: "registered_active_lease_observation_read",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      registry_table: "rd_replay_attempt_lease_observation",
      registry_key: postCommandObservation.observation_id,
      registry_row_immutability: "sqlite_update_and_delete_triggers",
      read_consistency: "single_control_plane_transaction",
      registry_read_provenance: "registered_row_and_current_attempt_exact_match",
      registered_at: "2026-07-14T00:00:39Z",
      read_at: authorityCommandReadAt,
      clock_evidence: "caller_supplied_utc_not_external_time_attestation",
      external_time_attestation: "not_provided",
      source_observation_id: postCommandObservation.observation_id,
      source_observation_ref: postCommandObservation.observation_ref,
      source_observation_hash: postCommandObservation.observation_hash,
      source_observation: postCommandObservation,
      current_attempt_status: postCommandObservation.attempt_lease.status,
      current_attempt_lease_hash: postCommandObservation.attempt_lease_hash,
      current_attempt_lease: postCommandObservation.attempt_lease,
    })
    const buildAuthorityCommandClock = (completedAt: string, completedMonotonicNs: string) => {
      const identityHash = replayDispatchClockAttestationIdentityHash({
        source_registry_read_receipt_hash: authorityCommandRegistryReceipt.receipt_hash,
        registry_read_started_at: authorityCommandReadAt,
        registry_read_completed_at: completedAt,
        registry_read_started_monotonic_ns: "5000000",
        registry_read_completed_monotonic_ns: completedMonotonicNs,
        attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
      })
      return createReplayDispatchClockAttestation({
        schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
        attestation_id: `replay-dispatch-clock-attestation-${identityHash.slice(0, 24)}`,
        attestation_ref: `attestation://replay-dispatch-clock/${identityHash.slice(0, 24)}`,
        attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
        status: "authority_clock_bracketed_registry_read",
        authority_owner: "research_control_plane",
        authority_source: "research_control_plane_state_store",
        clock_source: "control_plane_authority_process_clock_port",
        clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
        caller_time_input: "forbidden",
        wall_clock_source: "javascript_date_now_utc",
        monotonic_clock_source: "process_hrtime_bigint",
        external_time_attestation: "not_provided",
        registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read",
        registry_read_started_at: authorityCommandReadAt,
        registry_read_completed_at: completedAt,
        registry_read_started_monotonic_ns: "5000000",
        registry_read_completed_monotonic_ns: completedMonotonicNs,
        source_registry_read_receipt_id: authorityCommandRegistryReceipt.receipt_id,
        source_registry_read_receipt_ref: authorityCommandRegistryReceipt.receipt_ref,
        source_registry_read_receipt_hash: authorityCommandRegistryReceipt.receipt_hash,
        source_registry_read_receipt: authorityCommandRegistryReceipt,
        attempt_id: authorityCommandRegistryReceipt.current_attempt_lease.attempt_id,
        worker_id: authorityCommandRegistryReceipt.current_attempt_lease.worker_id,
        lease_generation: authorityCommandRegistryReceipt.current_attempt_lease.lease_generation,
        current_attempt_lease_hash: authorityCommandRegistryReceipt.current_attempt_lease_hash,
      })
    }
    const authorityCommandClock = buildAuthorityCommandClock("2026-07-14T00:00:46Z", "5000100")
    const authorityCommandInput = {
      source_authority_transport_contract: authorityTransport,
      control_plane_clock_attestation: authorityCommandClock,
    }
    const authorityCommand = buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
      authorityCommandInput,
    )
    expect(authorityCommand.status).toBe("issued_successor_intent_not_materialized_zero_process")
    expect(authorityCommand.source_authority_transport_contract_hash).toBe(authorityTransport.contract_hash)
    expect(authorityCommand.activated_process_artifact_hash).toBe(activatedStdio.artifact.sha256)
    expect(authorityCommand.source_predecessor_execution_admission_command_hash)
      .toBe(executionAdmissionCommand.command_hash)
    expect(authorityCommand.source_predecessor_process_launch_intent_hash).toBe(processLaunchIntent.intent_hash)
    expect(authorityCommand.issued_at).toBe(authorityCommandClock.registry_read_completed_at)
    expect(authorityCommand.required_response_echo_fields)
      .toEqual(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS)
    expect(authorityCommand.blockers).toEqual([
      "successor_process_launch_intent_not_issued",
      "fresh_spawn_boundary_revalidation_not_materialized",
      "attempt_bound_process_launch_receipt_not_materialized",
      "authority_frame_write_decode_read_and_admission_not_materialized",
    ])
    expect(authorityCommand.authority_execution_admission_command_instance_count).toBe(1)
    expect(authorityCommand.successor_process_launch_intent_count).toBe(0)
    expect(authorityCommand.authority_capsule_instance_count).toBe(0)
    expect(authorityCommand.process_launch_receipt_count).toBe(0)
    expect(authorityCommand.request_frame_instance_count).toBe(0)
    expect(authorityCommand.response_frame_instance_count).toBe(0)
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(authorityCommand))
      .not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandLineage(
      authorityCommand,
      authorityCommandInput,
    )).not.toThrow()
    expect(() => buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand({
      ...authorityCommandInput,
      control_plane_clock_attestation: postCommandClockAttestation,
    })).toThrow("parent, freshness, or validity drift")
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand({
      ...authorityCommand,
      activated_process_artifact_hash: successorTransportContract.successor_process_artifact_hash,
    })).toThrow("parent, freshness, or validity drift")
    const missingAuthorityCommandRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-command-missing-"))
    try {
      expect(() => issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
        registry_root: missingAuthorityCommandRoot,
        ...authorityCommandInput,
      })).toThrow("requires the exact durable Authority Transport Contract")
    } finally {
      rmSync(missingAuthorityCommandRoot, { recursive: true, force: true })
    }
    expect(issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityCommandInput,
    })).toEqual(authorityCommand)
    expect(readReplayWorkerV10AuthorityExecutionAdmissionCommand({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityCommandInput,
    })).toEqual(authorityCommand)
    expect(() => issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
      registry_root: dispatchEvidenceRegistryRoot,
      source_authority_transport_contract: authorityTransport,
      control_plane_clock_attestation: buildAuthorityCommandClock("2026-07-14T00:00:47Z", "5000200"),
    })).toThrow("natural key has different evidence")

    const authorityIntentObservation = createReplayAttemptLeaseObservationSnapshot({
      ...leaseObservationBody,
      observation_id: "lease-observation-envelope-authority-intent",
      observation_ref: "observation://replay-attempt-lease/authority-intent",
      observed_at: "2026-07-14T00:00:48Z",
    })
    const authorityIntentReadAt = "2026-07-14T00:00:50Z"
    const authorityIntentRegistryReceipt = createReplayAttemptLeaseObservationRegistryReadReceipt({
      schema_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_SCHEMA_VERSION,
      receipt_id: `replay-attempt-lease-observation-registry-read-${authorityIntentObservation.observation_hash.slice(0, 16)}-${Date.parse(authorityIntentReadAt)}`,
      receipt_ref: `receipt://replay-attempt-lease-observation-registry-read/${authorityIntentObservation.observation_hash.slice(0, 16)}-${Date.parse(authorityIntentReadAt)}`,
      receipt_policy_version: REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_POLICY_VERSION,
      status: "registered_active_lease_observation_read",
      authority_owner: "research_control_plane",
      authority_source: "research_control_plane_state_store",
      registry_table: "rd_replay_attempt_lease_observation",
      registry_key: authorityIntentObservation.observation_id,
      registry_row_immutability: "sqlite_update_and_delete_triggers",
      read_consistency: "single_control_plane_transaction",
      registry_read_provenance: "registered_row_and_current_attempt_exact_match",
      registered_at: "2026-07-14T00:00:49Z",
      read_at: authorityIntentReadAt,
      clock_evidence: "caller_supplied_utc_not_external_time_attestation",
      external_time_attestation: "not_provided",
      source_observation_id: authorityIntentObservation.observation_id,
      source_observation_ref: authorityIntentObservation.observation_ref,
      source_observation_hash: authorityIntentObservation.observation_hash,
      source_observation: authorityIntentObservation,
      current_attempt_status: authorityIntentObservation.attempt_lease.status,
      current_attempt_lease_hash: authorityIntentObservation.attempt_lease_hash,
      current_attempt_lease: authorityIntentObservation.attempt_lease,
    })
    const buildAuthorityIntentClock = (completedAt: string, completedMonotonicNs: string) => {
      const identityHash = replayDispatchClockAttestationIdentityHash({
        source_registry_read_receipt_hash: authorityIntentRegistryReceipt.receipt_hash,
        registry_read_started_at: authorityIntentReadAt,
        registry_read_completed_at: completedAt,
        registry_read_started_monotonic_ns: "6000000",
        registry_read_completed_monotonic_ns: completedMonotonicNs,
        attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
      })
      return createReplayDispatchClockAttestation({
        schema_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_SCHEMA_VERSION,
        attestation_id: `replay-dispatch-clock-attestation-${identityHash.slice(0, 24)}`,
        attestation_ref: `attestation://replay-dispatch-clock/${identityHash.slice(0, 24)}`,
        attestation_policy_version: REPLAY_DISPATCH_CLOCK_ATTESTATION_POLICY_VERSION,
        status: "authority_clock_bracketed_registry_read",
        authority_owner: "research_control_plane",
        authority_source: "research_control_plane_state_store",
        clock_source: "control_plane_authority_process_clock_port",
        clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
        caller_time_input: "forbidden",
        wall_clock_source: "javascript_date_now_utc",
        monotonic_clock_source: "process_hrtime_bigint",
        external_time_attestation: "not_provided",
        registry_read_bracketing: "wall_and_monotonic_samples_before_and_after_single_transaction_read",
        registry_read_started_at: authorityIntentReadAt,
        registry_read_completed_at: completedAt,
        registry_read_started_monotonic_ns: "6000000",
        registry_read_completed_monotonic_ns: completedMonotonicNs,
        source_registry_read_receipt_id: authorityIntentRegistryReceipt.receipt_id,
        source_registry_read_receipt_ref: authorityIntentRegistryReceipt.receipt_ref,
        source_registry_read_receipt_hash: authorityIntentRegistryReceipt.receipt_hash,
        source_registry_read_receipt: authorityIntentRegistryReceipt,
        attempt_id: authorityIntentRegistryReceipt.current_attempt_lease.attempt_id,
        worker_id: authorityIntentRegistryReceipt.current_attempt_lease.worker_id,
        lease_generation: authorityIntentRegistryReceipt.current_attempt_lease.lease_generation,
        current_attempt_lease_hash: authorityIntentRegistryReceipt.current_attempt_lease_hash,
      })
    }
    const authorityIntentClock = buildAuthorityIntentClock("2026-07-14T00:00:51Z", "6000100")
    const authorityIntentInput = {
      source_authority_execution_admission_command: authorityCommand,
      post_command_clock_attestation: authorityIntentClock,
    }
    const authorityIntent = buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(
      authorityIntentInput,
    )
    expect(authorityIntent.status).toBe("intent_committed_capsule_and_process_not_materialized")
    expect(authorityIntent.source_authority_execution_admission_command_hash).toBe(authorityCommand.command_hash)
    expect(authorityIntent.source_authority_transport_contract_hash).toBe(authorityTransport.contract_hash)
    expect(authorityIntent.process_artifact_hash).toBe(activatedStdio.artifact.sha256)
    expect(authorityIntent.process_artifact_file_name).toBe("worker-v10-authority-stdio.mjs")
    expect(authorityIntent.intent_issued_at).toBe(authorityIntentClock.registry_read_completed_at)
    expect(authorityIntent.authority_capsule_environment_variable)
      .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV)
    expect(authorityIntent.authority_capsule_fields).toEqual(activatedStdio.authority_capsule_fields)
    expect(authorityIntent.authority_capsule_intent_binding)
      .toBe("intent_hash_added_after_exact_intent_commit_not_embedded_in_payload")
    expect(authorityIntent.blockers).toEqual([
      "authority_capsule_not_materialized",
      "fresh_spawn_boundary_revalidation_not_materialized",
      "attempt_bound_process_launch_receipt_not_materialized",
      "authority_frame_write_decode_read_and_admission_not_materialized",
    ])
    expect(authorityIntent.authority_process_launch_intent_instance_count).toBe(1)
    expect(authorityIntent.authority_capsule_instance_count).toBe(0)
    expect(authorityIntent.process_launch_receipt_count).toBe(0)
    expect(authorityIntent.admitted_process_instance_count).toBe(0)
    expect(authorityIntent.request_frame_instance_count).toBe(0)
    expect(authorityIntent.response_frame_instance_count).toBe(0)
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(authorityIntent)).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentLineage(
      authorityIntent,
      authorityIntentInput,
    )).not.toThrow()
    expect(() => buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent({
      ...authorityIntentInput,
      post_command_clock_attestation: authorityCommandClock,
    })).toThrow("parent, revalidation, or executable binding drift")
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent({
      ...authorityIntent,
      process_artifact_hash: successorTransportContract.successor_process_artifact_hash,
    })).toThrow("parent, revalidation, or executable binding drift")
    const missingAuthorityIntentRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-intent-missing-"))
    try {
      expect(() => issueReplayWorkerV10AuthorityProcessLaunchIntent({
        registry_root: missingAuthorityIntentRoot,
        ...authorityIntentInput,
      })).toThrow("requires the exact durable Authority Command")
    } finally {
      rmSync(missingAuthorityIntentRoot, { recursive: true, force: true })
    }
    expect(issueReplayWorkerV10AuthorityProcessLaunchIntent({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityIntentInput,
    })).toEqual(authorityIntent)
    expect(readReplayWorkerV10AuthorityProcessLaunchIntent({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityIntentInput,
    })).toEqual(authorityIntent)
    expect(() => issueReplayWorkerV10AuthorityProcessLaunchIntent({
      registry_root: dispatchEvidenceRegistryRoot,
      source_authority_execution_admission_command: authorityCommand,
      post_command_clock_attestation: buildAuthorityIntentClock("2026-07-14T00:00:52Z", "6000200"),
    })).toThrow("natural key has different evidence")

    const authorityCapsuleInput = {
      source_authority_process_launch_intent: authorityIntent,
    }
    const authorityCapsule = buildReplayDecisionHarnessWorkerV10AuthorityCapsule(authorityCapsuleInput)
    expect(authorityCapsule.status)
      .toBe("capsule_materialized_spawn_revalidation_and_process_not_materialized")
    expect(authorityCapsule.source_authority_process_launch_intent_hash).toBe(authorityIntent.intent_hash)
    expect(authorityCapsule.source_authority_execution_admission_command_hash).toBe(authorityCommand.command_hash)
    expect(authorityCapsule.source_authority_transport_contract_hash).toBe(authorityTransport.contract_hash)
    expect(authorityCapsule.authority_capsule).toEqual({
      execution_admission_command_hash: authorityCommand.command_hash,
      execution_envelope_hash: authorityIntent.source_execution_envelope_hash,
      logical_request_id: authorityIntent.logical_request_id,
      process_artifact_hash: activatedStdio.artifact.sha256,
      process_launch_intent_hash: authorityIntent.intent_hash,
      transport_contract_hash: authorityTransport.contract_hash,
      worker_request_hash: authorityIntent.worker_request_hash,
    })
    expect(authorityCapsule.authority_capsule_canonical_json)
      .toBe(canonicalJson(authorityCapsule.authority_capsule))
    expect(authorityCapsule.capsule_hash).toBe(canonicalHash(authorityCapsule.authority_capsule))
    expect(authorityCapsule.blockers).toEqual([
      "fresh_spawn_boundary_revalidation_not_materialized",
      "attempt_bound_process_launch_receipt_not_materialized",
      "authority_frame_write_decode_read_and_admission_not_materialized",
    ])
    expect(authorityCapsule.authority_capsule_instance_count).toBe(1)
    expect(authorityCapsule.spawn_boundary_revalidation_receipt_count).toBe(0)
    expect(authorityCapsule.process_launch_receipt_count).toBe(0)
    expect(authorityCapsule.admitted_process_instance_count).toBe(0)
    expect(authorityCapsule.request_frame_instance_count).toBe(0)
    expect(authorityCapsule.response_frame_instance_count).toBe(0)
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(authorityCapsule)).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleLineage(
      authorityCapsule,
      authorityCapsuleInput,
    )).not.toThrow()
    expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord({
      ...authorityCapsule,
      authority_capsule: {
        ...authorityCapsule.authority_capsule,
        process_artifact_hash: successorTransportContract.successor_process_artifact_hash,
      },
    })).toThrow("parent or environment binding drift")
    const missingAuthorityCapsuleRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-capsule-missing-"))
    try {
      expect(() => materializeReplayWorkerV10AuthorityCapsule({
        registry_root: missingAuthorityCapsuleRoot,
        ...authorityCapsuleInput,
      })).toThrow("requires the exact durable Authority Process Launch Intent")
    } finally {
      rmSync(missingAuthorityCapsuleRoot, { recursive: true, force: true })
    }
    expect(materializeReplayWorkerV10AuthorityCapsule({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityCapsuleInput,
    })).toEqual(authorityCapsule)
    expect(materializeReplayWorkerV10AuthorityCapsule({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityCapsuleInput,
    })).toEqual(authorityCapsule)
    expect(readReplayWorkerV10AuthorityCapsule({
      registry_root: dispatchEvidenceRegistryRoot,
      ...authorityCapsuleInput,
    })).toEqual(authorityCapsule)

    const spawnRevalidationRequestInput = { source_authority_capsule: authorityCapsule }
    const spawnRevalidationRequest = buildReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest(
      spawnRevalidationRequestInput,
    )
    expect(spawnRevalidationRequest.status).toBe("capsule_bound_current_attempt_revalidation_requested")
    expect(spawnRevalidationRequest.source_authority_capsule_record_hash).toBe(authorityCapsule.record_hash)
    expect(spawnRevalidationRequest.authority_capsule_hash).toBe(authorityCapsule.capsule_hash)
    expect(spawnRevalidationRequest.expected_current_attempt_lease_hash)
      .toBe(authorityCapsule.current_attempt_lease_hash)
    expect(spawnRevalidationRequest.process_authority).toBe("none")
    const missingSpawnRequestRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-spawn-request-missing-"))
    try {
      expect(() => issueReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest({
        registry_root: missingSpawnRequestRoot,
        ...spawnRevalidationRequestInput,
      })).toThrow("requires the exact durable Authority Capsule")
    } finally {
      rmSync(missingSpawnRequestRoot, { recursive: true, force: true })
    }
    expect(issueReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest({
      registry_root: dispatchEvidenceRegistryRoot,
      ...spawnRevalidationRequestInput,
    })).toEqual(spawnRevalidationRequest)
    expect(readReplayWorkerV10AuthoritySpawnBoundaryRevalidationRequest({
      registry_root: dispatchEvidenceRegistryRoot,
      ...spawnRevalidationRequestInput,
    })).toEqual(spawnRevalidationRequest)

    const buildSpawnRevalidationReceipt = (
      completedAt: string,
      completedMonotonicNs: string,
    ) => {
      const startedAt = "2026-07-14T00:00:53Z"
      const startedMonotonicNs = "7000000"
      const identityHash = replaySpawnBoundaryRevalidationReceiptIdentityHash({
        source_request_hash: spawnRevalidationRequest.request_hash,
        registry_read_started_at: startedAt,
        registry_read_completed_at: completedAt,
        registry_read_started_monotonic_ns: startedMonotonicNs,
        registry_read_completed_monotonic_ns: completedMonotonicNs,
        receipt_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
      })
      return createReplaySpawnBoundaryRevalidationReceipt({
        schema_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_SCHEMA_VERSION,
        receipt_id: `replay-spawn-boundary-revalidation-receipt-${identityHash.slice(0, 24)}`,
        receipt_ref: `receipt://replay-spawn-boundary-revalidation/${identityHash.slice(0, 24)}`,
        receipt_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_RECEIPT_POLICY_VERSION,
        status: "capsule_bound_current_attempt_revalidated",
        authority_owner: "research_control_plane",
        authority_source: "research_control_plane_state_store",
        source_request_id: spawnRevalidationRequest.request_id,
        source_request_ref: spawnRevalidationRequest.request_ref,
        source_request_hash: spawnRevalidationRequest.request_hash,
        source_request: spawnRevalidationRequest,
        clock_source: "control_plane_authority_process_clock_port",
        clock_independence: "authority_internal_sampling_without_caller_timestamp_input",
        caller_time_input: "forbidden",
        wall_clock_source: "javascript_date_now_utc",
        monotonic_clock_source: "process_hrtime_bigint",
        external_time_attestation: "not_provided",
        current_attempt_read: "single_control_plane_transaction_exact_attempt_worker_generation_and_lease_hash",
        registry_read_started_at: startedAt,
        registry_read_completed_at: completedAt,
        registry_read_started_monotonic_ns: startedMonotonicNs,
        registry_read_completed_monotonic_ns: completedMonotonicNs,
        current_attempt_status: authorityIntentRegistryReceipt.current_attempt_status,
        current_attempt_lease_hash: authorityIntentRegistryReceipt.current_attempt_lease_hash,
        current_attempt_lease: authorityIntentRegistryReceipt.current_attempt_lease,
        revalidated_at: completedAt,
        valid_before: authorityIntentRegistryReceipt.current_attempt_lease.lease_expires_at,
        spawn_candidate_authority: "single_immediate_spawn_candidate_not_process_start_evidence",
        race_limit: "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_completed_read",
        process_authority: "none",
      })
    }
    const spawnRevalidationReceipt = buildSpawnRevalidationReceipt("2026-07-14T00:00:54Z", "7000100")
    expect(() => assertReplaySpawnBoundaryRevalidationReceipt(spawnRevalidationReceipt)).not.toThrow()
    const spawnRevalidationInput = {
      source_authority_capsule: authorityCapsule,
      source_revalidation_request: spawnRevalidationRequest,
      control_plane_revalidation_receipt: spawnRevalidationReceipt,
    }
    const spawnRevalidation = buildReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(
      spawnRevalidationInput,
    )
    replayProfile("authority spawn chain")
    expectAuthoritySpawnBoundary({
      revalidation: spawnRevalidation,
      lineage: spawnRevalidationInput,
    })
    const missingSpawnBindingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-spawn-binding-missing-"))
    try {
      expect(() => registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
        registry_root: missingSpawnBindingRoot,
        ...spawnRevalidationInput,
      })).toThrow("requires the exact durable Authority Capsule")
    } finally {
      rmSync(missingSpawnBindingRoot, { recursive: true, force: true })
    }
    expect(registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
      registry_root: dispatchEvidenceRegistryRoot,
      ...spawnRevalidationInput,
    })).toEqual(spawnRevalidation)
    expect(readReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
      registry_root: dispatchEvidenceRegistryRoot,
      ...spawnRevalidationInput,
    })).toEqual(spawnRevalidation)
    expect(() => registerReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
      registry_root: dispatchEvidenceRegistryRoot,
      ...spawnRevalidationInput,
      control_plane_revalidation_receipt: buildSpawnRevalidationReceipt("2026-07-14T00:00:55Z", "7000200"),
    })).toThrow("natural key has different evidence")

    const missingAuthorityProcessRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-process-missing-"))
    try {
      await expect(launchReplayWorkerV10AuthorityProcess({
        registry_root: missingAuthorityProcessRoot,
        source_spawn_revalidation: spawnRevalidation,
        clock: { now: () => "2026-07-14T00:00:55Z" },
      })).rejects.toThrow("requires the exact durable Spawn Boundary Revalidation")
    } finally {
      rmSync(missingAuthorityProcessRoot, { recursive: true, force: true })
    }
    const authorityProcessTimes = ["2026-07-14T00:00:55Z", "2026-07-14T00:00:56Z"]
    const authorityProcessOutcome = await launchReplayWorkerV10AuthorityProcess({
      registry_root: dispatchEvidenceRegistryRoot,
      source_spawn_revalidation: spawnRevalidation,
      clock: { now: () => authorityProcessTimes.shift() ?? "2026-07-14T00:00:56Z" },
    })
    expect(authorityProcessOutcome.disposition).toBe("new_live_process_handle")
    expect(authorityProcessOutcome.session).not.toBeNull()
    const authorityProcessSession = authorityProcessOutcome.session
    if (!authorityProcessSession) throw new Error("expected live Worker v10 Authority Process session")
    const authorityProcessReceipt = authorityProcessOutcome.receipt
    const authorityProcessAttempt = readReplayWorkerV10AuthorityProcessLaunchAttempt({
      registry_root: dispatchEvidenceRegistryRoot,
      source_spawn_revalidation: spawnRevalidation,
    })
    if (!authorityProcessAttempt) throw new Error("expected Worker v10 Authority Process Launch Attempt")
    expectAuthorityProcessLaunch({
      receipt: authorityProcessReceipt,
      spawn_revalidation_hash: spawnRevalidation.binding_hash,
      authority_capsule_hash: authorityCapsule.capsule_hash,
      process_artifact_hash: activatedStdio.artifact.sha256,
      live_process_instance_id: authorityProcessSession.process_instance_id,
    })
    expect(readReplayWorkerV10AuthorityProcessLaunchReceipt({
      registry_root: dispatchEvidenceRegistryRoot,
      source_spawn_revalidation: spawnRevalidation,
    })).toEqual(authorityProcessReceipt)
    const authorityProcessRetry = await launchReplayWorkerV10AuthorityProcess({
      registry_root: dispatchEvidenceRegistryRoot,
      source_spawn_revalidation: spawnRevalidation,
      clock: { now: () => { throw new Error("durable receipt retry must not read a new clock") } },
    })
    expect(authorityProcessRetry.disposition).toBe("durable_receipt_without_live_handle")
    expect(authorityProcessRetry.receipt).toEqual(authorityProcessReceipt)
    expect(authorityProcessRetry.session).toBeNull()

    const missingAuthorityDispatchRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-dispatch-missing-"))
    try {
      await expect(dispatchReplayWorkerV10AuthorityRequest({
        registry_root: missingAuthorityDispatchRoot,
        source_process_launch_receipt: authorityProcessReceipt,
        session: authorityProcessSession,
        clock: { now: () => "2026-07-14T00:00:57Z" },
      })).rejects.toThrow("requires the exact durable Spawn Boundary Revalidation")
    } finally {
      rmSync(missingAuthorityDispatchRoot, { recursive: true, force: true })
    }
    const authorityDispatchTimes = [
      "2026-07-14T00:00:57Z", "2026-07-14T00:00:58Z",
      "2026-07-14T00:00:59Z", "2026-07-14T00:01:00Z",
    ]
    const authorityDispatchOutcome = await dispatchReplayWorkerV10AuthorityRequest({
      registry_root: dispatchEvidenceRegistryRoot,
      source_process_launch_receipt: authorityProcessReceipt,
      session: authorityProcessSession,
      clock: { now: () => authorityDispatchTimes.shift() ?? "2026-07-14T00:01:00Z" },
    })
    replayProfile("authority process dispatch")
    expect(authorityDispatchOutcome.disposition).toBe("new_opaque_transport_capture")
    const authorityDispatchReceipt = authorityDispatchOutcome.receipt
    const authorityDispatchAttempt = readReplayWorkerV10AuthorityRequestDispatchAttempt({
      registry_root: dispatchEvidenceRegistryRoot,
      source_process_launch_receipt: authorityProcessReceipt,
    })
    if (!authorityDispatchAttempt) throw new Error("expected Worker v10 Authority Request Dispatch Attempt")
    expectAuthorityDispatch({
      receipt: authorityDispatchReceipt,
      attempt: authorityDispatchAttempt,
      process_launch_receipt_hash: authorityProcessReceipt.receipt_hash,
      process_instance_id: authorityProcessReceipt.process_instance_id!,
      transport_contract_hash: authorityTransport.contract_hash,
      execution_command_hash: authorityCommand.command_hash,
      process_launch_intent_hash: authorityIntent.intent_hash,
      worker_request_hash: authorityTransport.target_worker_request_hash,
    })
    expect(readReplayWorkerV10AuthorityRequestDispatchReceipt({
      registry_root: dispatchEvidenceRegistryRoot,
      source_process_launch_receipt: authorityProcessReceipt,
    })).toEqual(authorityDispatchReceipt)
    const authorityDispatchRetry = await dispatchReplayWorkerV10AuthorityRequest({
      registry_root: dispatchEvidenceRegistryRoot,
      source_process_launch_receipt: authorityProcessReceipt,
      session: null,
      clock: { now: () => { throw new Error("durable dispatch retry must not read a new clock") } },
    })
    expect(authorityDispatchRetry.disposition).toBe("durable_receipt_without_live_handle")
    expect(authorityDispatchRetry.receipt).toEqual(authorityDispatchReceipt)

    const authorityResponseStage = runReplayWorkerV10AuthorityResponseStage({
      registry_root: dispatchEvidenceRegistryRoot,
      dispatch_receipt: authorityDispatchReceipt,
      dispatch_attempt: authorityDispatchAttempt,
      process_receipt: authorityProcessReceipt,
      replay_execution_request: requestValue,
      profile: replayProfile,
    })
    const authorityResponseValidation = authorityResponseStage.response_validation
    const authorityScheduleAdmission = authorityResponseStage.schedule_admission
    const reproducibilityPairContract =
      authorityResponseStage.reproducibility_pair_contract

    const successorLeaseStage = runReplayWorkerV10SuccessorLeaseStage({
      registry_root: dispatchEvidenceRegistryRoot,
      reproducibility_pair_contract: reproducibilityPairContract,
      first_execution_envelope: executionEnvelope,
      first_schedule_admission: authorityScheduleAdmission,
      first_worker_request: firstRequestV10,
      replay_execution_request_hash: authorityBinding.request_hash,
      predecessor_attempt_lease: attemptLease,
      profile: replayProfile,
    })
    const successorAuthorityContract = successorLeaseStage.authority_contract
    const requestedSuccessorLeaseExpiry = successorLeaseStage.requested_lease_expiry
    const successorLeaseResult = successorLeaseStage.result
    const successorLeaseAdmission = successorLeaseStage.admission

    const successorExecutionStage = runReplayWorkerV10SuccessorExecutionStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_lease_admission: successorLeaseAdmission,
      predecessor_execution_envelope: executionEnvelope,
      comparison_successor_envelope: successorEnvelope,
      predecessor_lease_generation: attemptLease.lease_generation,
      durable_worker_capability: durableWorkerV10Capability,
      predecessor_transport_contract: workerV10TransportContract,
      predecessor_stdio_capability: durableStdioCapability,
      predecessor_negative_probe_receipt: negativeProbeReceipt,
      predecessor_successor_transport_contract: successorTransportContract,
      predecessor_execution_admission_contract: executionAdmissionContract,
      profile: replayProfile,
    })
    const successorEnvelopeAdmission = successorExecutionStage.envelope_admission
    const successorTransportAdmission = successorExecutionStage.transport_admission
    const successorStdioProbeAdmission = successorExecutionStage.stdio_probe_admission
    const successorExecutionContractAdmission =
      successorExecutionStage.execution_contract_admission

    const successorCommandStage = runReplayWorkerV10SuccessorCommandStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_execution_contract_admission: successorExecutionContractAdmission,
      successor_lease_admission: successorLeaseAdmission,
      predecessor_lease_generation: attemptLease.lease_generation,
      predecessor_execution_admission_command_hash: executionAdmissionCommand.command_hash,
      requested_successor_lease_expiry: requestedSuccessorLeaseExpiry,
      profile: replayProfile,
    })
    const successorCommandAdmission = successorCommandStage.command_admission
    const successorExecutionCommand = successorCommandStage.execution_command

    const successorIntentStage = runReplayWorkerV10SuccessorIntentStage({
      registry_root: dispatchEvidenceRegistryRoot,
      successor_command_admission: successorCommandAdmission,
      successor_execution_contract_admission: successorExecutionContractAdmission,
      successor_stdio_probe_admission: successorStdioProbeAdmission,
      command_observation: successorCommandStage.command_observation,
      requested_successor_lease_expiry: requestedSuccessorLeaseExpiry,
      profile: replayProfile,
    })
    const successorProcessLaunchIntent = successorIntentStage.process_launch_intent

    const successorCapsuleStage = runReplayWorkerV10SuccessorCapsuleStage({
      registry_root: dispatchEvidenceRegistryRoot,
      process_launch_intent: successorProcessLaunchIntent,
      execution_command: successorExecutionCommand,
      execution_contract_admission: successorExecutionContractAdmission,
      profile: replayProfile,
    })
    const successorAuthorityCapsule = successorCapsuleStage.authority_capsule
    const successorCapsuleFile = successorCapsuleStage.capsule_file
    const successorIntentFile = successorCapsuleStage.intent_file

    const successorSpawnStage = runReplayWorkerV10SuccessorSpawnStage({
      registry_root: dispatchEvidenceRegistryRoot,
      capsule_file: successorCapsuleFile,
      intent_file: successorIntentFile,
      authority_capsule: successorAuthorityCapsule,
      process_launch_intent: successorProcessLaunchIntent,
      successor_lease_admission: successorLeaseAdmission,
      profile: replayProfile,
    })
    const successorSpawnResult = successorSpawnStage.result
    const buildSuccessorSpawnReceipt = successorSpawnStage.build_receipt
    const successorSpawnRevalidation = successorSpawnResult.spawn_boundary_revalidation
    let cutoverRevalidationCalls = 0
    const cutoverInput = {
      registry_root: dispatchEvidenceRegistryRoot,
      source_pair_contract: reproducibilityPairContract,
      source_successor_spawn_revalidation: successorSpawnRevalidation,
      source_successor_authority_capsule: successorAuthorityCapsule,
      source_successor_process_launch_intent: successorProcessLaunchIntent,
      source_successor_stdio_probe_admission: successorStdioProbeAdmission,
      authority_port: {
        revalidate: (request: ReplaySpawnBoundaryRevalidationRequest) => {
          cutoverRevalidationCalls += 1
          return buildSuccessorSpawnReceipt(
            request, "2026-07-14T00:04:10Z", "2026-07-14T00:04:11Z", "12000000", "12000100",
          )
        },
      },
    }
    const cutover = executeReplayWorkerV10Cutover(cutoverInput)
    replayProfile("worker cutover")
    expectWorkerV10Cutover({
      outcome: cutover,
      revalidation_calls: cutoverRevalidationCalls,
    })
    expect(readReplayWorkerV10CutoverReceipt(cutoverInput)).toEqual(cutover.receipt)
    const cutoverRetry = executeReplayWorkerV10Cutover(cutoverInput)
    expect(cutoverRetry.disposition).toBe("existing_cutover_receipt")
    expect(cutoverRetry.receipt).toEqual(cutover.receipt)
    expect(cutoverRevalidationCalls).toBe(1)
    const cutoverWorkerRequest = cutover.receipt.second_request_frame.worker_request
    const formalCutoverAdmission = executeReplayDecisionHarness({
      registry: createReplayDecisionHarnessCutoverRegistry([{
        source_bundle: sourceBundle,
        build_attestation: buildAttestation,
      }], [cutover.receipt]),
      request: requestValue,
      schedule_entry: requestValue.decision_schedule.entries[0]!,
      decision_input_snapshot: cutoverWorkerRequest.decision_input_snapshot,
      decision_market_input_snapshot: cutoverWorkerRequest.decision_market_input_snapshot,
      decision_state_snapshot: cutoverWorkerRequest.decision_state_snapshot,
    })
    replayProfile("formal cutover admission")
    expectFormalCutoverAdmission({
      receipt: formalCutoverAdmission.receipt,
      cutover: cutover.receipt,
    })
    const resultArtifactRoot = mkdtempSync(join(tmpdir(), "rd-replay-r4-152-result-golden-"))
    try {
      const cutoverRegistry = createReplayDecisionHarnessCutoverRegistry([{
        source_bundle: sourceBundle,
        build_attestation: buildAttestation,
      }], [cutover.receipt])
      const completedTrial = runReplayTrial({
        request: requestValue,
        trial_reservation: trialReservation,
        attempt_lease: successorLeaseAdmission.successor_attempt_lease,
        observed_at: "2026-07-14T00:04:12Z",
        dataset_manifest: goldenReplayDatasetManifest(),
        bars: GOLDEN_REPLAY_BARS,
        decision_harness_registry: cutoverRegistry,
        artifact_root: resultArtifactRoot,
      })
      expect(completedTrial.status).toBe("completed")
      expect(completedTrial.result?.status).toBe("completed")
      const initialDecisionEvidence = completedTrial.result?.decision_evidence_timeline.entries[0]
      expect(initialDecisionEvidence?.decision_harness_receipt?.receipt_hash)
        .toBe(cutover.receipt.receipt_hash)
      expect(initialDecisionEvidence?.decision_harness_receipt?.worker_protocol_version)
        .toBe("rd-replay-harness-worker-stdio-v10")
      expect(completedTrial.result?.fingerprint.decision_harness_receipt_hash)
        .toBe(cutover.receipt.receipt_hash)
      expect(completedTrial.result?.fingerprint.decision_harness_worker_protocol_version)
        .toBe("rd-replay-harness-worker-stdio-v10")
      expect(completedTrial.result?.fingerprint.dataset_hash).toBe(GOLDEN_REPLAY_DATASET_HASH)
      expect(completedTrial.result?.fingerprint.trial_reservation_hash)
        .toBe(hashTrialReservationSnapshot(trialReservation))
      expect(completedTrial.artifact_manifest?.result_hash)
        .toBe(completedTrial.result?.fingerprint.result_hash)
      expect(completedTrial.artifact_manifest?.files.some(
        (file) => file.role === "decision_evidence_timeline",
      )).toBe(true)
      expect(completedTrial.artifact_manifest?.completeness.authoritative_result).toBe(true)
      const idempotentTrial = runReplayTrial({
        request: requestValue,
        trial_reservation: trialReservation,
        attempt_lease: successorLeaseAdmission.successor_attempt_lease,
        observed_at: "2026-07-14T00:04:12Z",
        dataset_manifest: goldenReplayDatasetManifest(),
        bars: GOLDEN_REPLAY_BARS,
        decision_harness_registry: cutoverRegistry,
        artifact_root: resultArtifactRoot,
      })
      expect(idempotentTrial.status).toBe("completed")
      expect(idempotentTrial.idempotent_replay).toBe(true)
      expect(idempotentTrial.artifact_manifest).toEqual(completedTrial.artifact_manifest)
    } finally {
      rmSync(resultArtifactRoot, { recursive: true, force: true })
    }
    expect(admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation({
      registry_root: dispatchEvidenceRegistryRoot,
      source_successor_authority_capsule: structuredClone(successorAuthorityCapsule),
      source_successor_process_launch_intent: structuredClone(successorProcessLaunchIntent),
      authority_port: {
        revalidate: () => {
          successorSpawnStage.record_authority_port_call()
          throw new Error("durable successor revalidation retry must not call Control Plane")
        },
      },
    })).toEqual(successorSpawnResult)
    expect(successorSpawnStage.authority_port_call_count()).toBe(1)
    expect(() => assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation({
      ...successorSpawnRevalidation,
      successor_worker_process_count: 1 as never,
    })).toThrow()

    runReplayWorkerV10SuccessorIntegrityStage({
      registry_root: dispatchEvidenceRegistryRoot,
      command_stage: successorCommandStage,
      intent_stage: successorIntentStage,
      capsule_stage: successorCapsuleStage,
      spawn_stage: successorSpawnStage,
      execution_contract_admission: successorExecutionContractAdmission,
      stdio_probe_admission: successorStdioProbeAdmission,
      transport_admission: successorTransportAdmission,
      envelope_admission: successorEnvelopeAdmission,
      lease_admission: successorLeaseAdmission,
      authority_contract: successorAuthorityContract,
      renewal_request: successorLeaseResult.renewal_request,
      reproducibility_pair_contract: reproducibilityPairContract,
      authority_schedule_admission: authorityScheduleAdmission,
      authority_response_validation: authorityResponseValidation,
      replay_execution_request: requestValue,
    })

    runReplayWorkerV10UpstreamIntegrityStage({
      registry_root: dispatchEvidenceRegistryRoot,
      authority_response_validation: authorityResponseValidation,
      authority_dispatch_receipt: authorityDispatchReceipt,
      authority_process_receipt: authorityProcessReceipt,
      spawn_revalidation: spawnRevalidation,
      spawn_revalidation_input: spawnRevalidationInput,
      spawn_revalidation_request: spawnRevalidationRequest,
      spawn_revalidation_request_input: spawnRevalidationRequestInput,
      authority_capsule: authorityCapsule,
      authority_capsule_input: authorityCapsuleInput,
      authority_intent: authorityIntent,
      authority_intent_input: authorityIntentInput,
      authority_command: authorityCommand,
      authority_command_input: authorityCommandInput,
      authority_transport: authorityTransport,
      authority_transport_input: authorityTransportInput,
      activated_stdio: activatedStdio,
      activated_stdio_input: activatedStdioInput,
      authority_frame_build: authorityFrameBuild,
      authority_build_input: authorityBuildInput,
      process_launch_readiness: processLaunchReadiness,
      process_readiness_input: processReadinessInput,
      post_command_registry_receipt: postCommandRegistryReceipt,
      post_command_read_at: postCommandReadAt,
      post_command_clock_attestation: postCommandClockAttestation,
      execution_admission_command: executionAdmissionCommand,
      process_launch_intent: processLaunchIntent,
      process_intent_input: processIntentInput,
      registry_read_receipt: registryReadReceipt,
      clock_attestation: clockAttestation,
      registry_provenance: registryProvenance,
      clock_binding: clockBinding,
      command_input: commandInput,
      clock_binding_input: clockBindingInput,
      registry_provenance_input: registryProvenanceInput,
      pre_issue_input: preIssueInput,
      execution_admission_contract: executionAdmissionContract,
      successor_transport_contract: successorTransportContract,
      negative_probe_receipt: negativeProbeReceipt,
      durable_stdio_capability: durableStdioCapability,
      worker_v10_transport_contract: workerV10TransportContract,
      transport_contract_input: transportContractInput,
    })

    runReplayWorkerV10LegacyActivationStage({
      registry_root: dispatchEvidenceRegistryRoot,
      lease_observation_body: leaseObservationBody,
      execution_envelope: executionEnvelope,
      dispatch_claim: dispatchClaim,
      claim_observation: claimObservation,
      claim_renewed_observation: claimRenewedObservation,
      attempt_lease: attemptLease,
      dispatch_evidence_registration: dispatchEvidenceRegistration,
      profile: replayProfile,
    })
  } finally {
    rmSync(dispatchEvidenceRegistryRoot, { recursive: true, force: true })
  }
  const renewedObservation = createReplayAttemptLeaseObservationSnapshot({
    ...leaseObservationBody,
    observation_id: "lease-observation-envelope-2",
    observation_ref: "observation://replay-attempt-lease/envelope-2",
    observed_at: renewedLease.heartbeat_at,
    lease_generation: renewedLease.lease_generation,
    attempt_lease_hash: hashReplayAttemptLeaseSnapshot(renewedLease),
    attempt_lease: renewedLease,
  })
  expect(() => buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: executionEnvelope,
    control_plane_lease_observation: renewedObservation,
  })).toThrow("current Lease generation and a successor Envelope")
  const successorAuthorityBinding = buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    source_execution_envelope: successorEnvelope,
    control_plane_lease_observation: renewedObservation,
  })
  expect(successorAuthorityBinding.source_dispatch_lease_admission.lease_generation).toBe(3)
  expect(successorAuthorityBinding.binding_hash).not.toBe(dispatchAuthorityBinding.binding_hash)
  expect(() => buildReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    ...authorityBindingInput,
    control_plane_lease_observation: {
      ...leaseObservation,
      observation_hash: "b".repeat(64),
    },
  })).toThrow("observation hash mismatch")
  expect(() => assertReplayDecisionHarnessDispatchLeaseAuthorityBinding({
    ...dispatchAuthorityBinding,
    transport_admission: "granted" as never,
  })).toThrow("unsupported decision harness Dispatch Lease Authority Binding authority")

  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    source_events: sourceEvents.slice(1),
  })).toThrow("source prefix")
  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    source_events: [...sourceEvents, {
      source_event_id: "source:bar_open:3", kind: "bar_open", source_index: 2,
      event_key: {
        event_time: "2026-07-14T12:00:00Z", boundary_phase: 20,
        source_sequence: 3, event_subphase: 0, stable_event_id: "source:bar_open:3",
      },
    }],
  })).toThrow("exact complete source prefix")
  expect(() => buildReplayPositionOpenStateInputMaterialization({
    ...input,
    harness_context_binding: contextBinding(request("b".repeat(64))),
  })).toThrow("Request/Context binding drift")
  const mismatchedRequest = request("b".repeat(64))
  const mismatchedState = buildReplayPositionOpenStateInputMaterialization({
    request: mismatchedRequest,
    harness_context_binding: contextBinding(mismatchedRequest),
    decision_state_snapshot: snapshot,
    source_events: sourceEvents,
  })
  expect(() => buildReplayDecisionWorkerInputAssemblyV3({
    ...assemblyV3Input,
    state_input_materializations: [mismatchedState],
  })).toThrow("R4.102 parent binding drift")
  expect(() => assertReplayPositionOpenStateInputMaterialization({
    ...materialization,
    worker_request_materialization: "allowed" as never,
  })).toThrow("unsupported position-open State input materialization authority")
  const { snapshot_hash: _snapshotHash, ...snapshotBody } = snapshot
  expect(() => assertReplayPositionOpenStateInputMaterializationLineage(materialization, {
    ...input,
    decision_state_snapshot: createReplayDecisionStateSnapshot({
      ...snapshotBody,
      cash_balance: 999.8,
    }),
  })).toThrow("parent lineage drift")
}, 600_000)
