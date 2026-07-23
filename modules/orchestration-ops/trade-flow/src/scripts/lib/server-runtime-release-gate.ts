import { canonicalHash } from "../../../../../contracts/runtime-core/src/canonical-json"

type JSONRecord = Record<string, unknown>

export const SERVER_RUNTIME_RELEASE_GATE_SCHEMA = "trade.server-runtime-release-gate.v2" as const

export interface ServerRuntimeReleaseEvidence {
  observed_at: string
  host_platform: "linux" | "darwin"
  lifecycle: { status: "passed"; fixture_scope: "synthetic_process_manager_only" }
  recovery: { status: "passed"; fixture_scope: "synthetic_recovery_closure_only" }
  full_shadow: {
    status: "passed"
    enabled_jobs: 7
    parity_matches: number
    parity_mismatches: 0
    duplicate_jobs: 0
    live_commands: 0
  }
  rd_autonomy: { status: "passed"; cas_and_idempotency: true; provider_smoke: boolean; kill_restart_single_trial_result: boolean }
  operator_http: { status: "passed"; policy_tests: true; resident_smoke: boolean; audit_roundtrip: boolean }
  deployment: {
    process_manager: "systemd" | "launchd"
    process_manager_installed: boolean
    public_soak_passed: boolean
    real_volume_restore_passed: boolean
  }
}

export function evaluateServerRuntimeRelease(evidence: ServerRuntimeReleaseEvidence): JSONRecord {
  const observedAt = canonicalTime(evidence.observed_at)
  if (evidence.lifecycle.status !== "passed" || evidence.lifecycle.fixture_scope !== "synthetic_process_manager_only") throw new Error("lifecycle evidence is invalid")
  if (evidence.recovery.status !== "passed" || evidence.recovery.fixture_scope !== "synthetic_recovery_closure_only") throw new Error("recovery evidence is invalid")
  if (evidence.full_shadow.status !== "passed" || evidence.full_shadow.enabled_jobs !== 7 || evidence.full_shadow.parity_matches < 2
    || evidence.full_shadow.parity_mismatches !== 0 || evidence.full_shadow.duplicate_jobs !== 0 || evidence.full_shadow.live_commands !== 0) {
    throw new Error("full-shadow evidence is invalid")
  }
  if (evidence.rd_autonomy.status !== "passed" || evidence.rd_autonomy.cas_and_idempotency !== true) throw new Error("R&D autonomy evidence is invalid")
  if (evidence.operator_http.status !== "passed" || evidence.operator_http.policy_tests !== true) throw new Error("operator HTTP evidence is invalid")
  const expectedManager = evidence.host_platform === "darwin" ? "launchd" : "systemd"
  if (evidence.deployment.process_manager !== expectedManager) throw new Error("host platform and process manager do not match")

  const pending: string[] = []
  if (evidence.host_platform !== "linux") pending.push("linux_server_rehearsal_not_run")
  if (!evidence.deployment.process_manager_installed) pending.push("process_manager_not_installed")
  if (!evidence.deployment.public_soak_passed) pending.push("server_public_soak_not_passed")
  if (!evidence.deployment.real_volume_restore_passed) pending.push("real_volume_restore_not_passed")
  if (!evidence.rd_autonomy.provider_smoke) pending.push("model_provider_smoke_not_passed")
  if (!evidence.rd_autonomy.kill_restart_single_trial_result) pending.push("rd_kill_restart_single_trial_result_not_passed")
  if (!evidence.operator_http.resident_smoke) pending.push("operator_http_resident_smoke_not_passed")
  if (!evidence.operator_http.audit_roundtrip) pending.push("operator_http_audit_roundtrip_not_passed")

  return {
    schema_version: SERVER_RUNTIME_RELEASE_GATE_SCHEMA,
    observed_at: observedAt,
    evidence_hash: canonicalHash(evidence),
    local_no_live_rehearsal: "passed",
    server_no_live_adoption: pending.length === 0 ? "eligible_for_manual_change_review" : "blocked",
    pending_server_gates: pending,
    maximum_verified_authority: pending.length === 0
      ? "no_live_server_shadow"
      : "no_live_local_rehearsal",
    catalog_canary: pending.length === 0 ? "eligible_for_explicit_operator_run" : "blocked",
    live_cutover: "forbidden_without_separate_user_approval_and_canary_evidence",
    live_writes_allowed: false,
    automatic_promotion_allowed: false,
    limitations: [
      "this_gate_never_grants_exchange_write_or_strategy_promotion_authority",
      "synthetic_lifecycle_and_recovery_do_not_prove_target_server_readiness",
      "darwin_rehearsal_never_substitutes_for_linux_server_adoption",
      "manual_change_review_is_required_even_when_all_no_live_gates_pass",
    ],
  }
}

function canonicalTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error("observed_at must be canonical UTC")
  return value
}
