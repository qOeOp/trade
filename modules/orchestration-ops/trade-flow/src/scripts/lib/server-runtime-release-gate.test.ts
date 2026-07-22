import assert from "node:assert/strict"
import test from "node:test"
import { evaluateServerRuntimeRelease, type ServerRuntimeReleaseEvidence } from "./server-runtime-release-gate"

test("local rehearsal passes while server and live authority remain blocked", () => {
  const result = evaluateServerRuntimeRelease(fixture())
  assert.equal(result.local_no_live_rehearsal, "passed")
  assert.equal(result.server_no_live_adoption, "blocked")
  assert.equal(result.maximum_verified_authority, "no_live_local_rehearsal")
  assert.equal(result.live_writes_allowed, false)
  assert.match(String(result.live_cutover), /forbidden/)
  assert.deepEqual(result.pending_server_gates, [
    "target_linux_host_not_used", "systemd_not_installed", "server_public_soak_not_passed",
    "real_volume_restore_not_passed", "model_provider_smoke_not_passed",
    "rd_kill_restart_single_trial_result_not_passed", "operator_http_resident_smoke_not_passed",
    "operator_http_audit_roundtrip_not_passed",
  ])
})

test("complete no-live server evidence still never grants live or promotion", () => {
  const evidence = fixture()
  evidence.host_platform = "linux"
  evidence.deployment = { systemd_installed: true, public_soak_passed: true, real_volume_restore_passed: true }
  evidence.rd_autonomy.provider_smoke = true
  evidence.rd_autonomy.kill_restart_single_trial_result = true
  evidence.operator_http.resident_smoke = true
  evidence.operator_http.audit_roundtrip = true
  const result = evaluateServerRuntimeRelease(evidence)
  assert.equal(result.server_no_live_adoption, "eligible_for_manual_change_review")
  assert.equal(result.maximum_verified_authority, "no_live_server_shadow")
  assert.equal(result.catalog_canary, "eligible_for_explicit_operator_run")
  assert.equal(result.live_writes_allowed, false)
  assert.equal(result.automatic_promotion_allowed, false)
})

test("release gate rejects parity, duplicate-job, or live-command drift", () => {
  assert.throws(() => evaluateServerRuntimeRelease({ ...fixture(), full_shadow: { ...fixture().full_shadow, parity_mismatches: 1 as 0 } }), /full-shadow/)
  assert.throws(() => evaluateServerRuntimeRelease({ ...fixture(), full_shadow: { ...fixture().full_shadow, duplicate_jobs: 1 as 0 } }), /full-shadow/)
  assert.throws(() => evaluateServerRuntimeRelease({ ...fixture(), full_shadow: { ...fixture().full_shadow, live_commands: 1 as 0 } }), /full-shadow/)
})

function fixture(): ServerRuntimeReleaseEvidence {
  return {
    observed_at: "2026-07-23T00:00:00.000Z", host_platform: "darwin",
    lifecycle: { status: "passed", fixture_scope: "synthetic_process_manager_only" },
    recovery: { status: "passed", fixture_scope: "synthetic_recovery_closure_only" },
    full_shadow: { status: "passed", enabled_jobs: 7, parity_matches: 2, parity_mismatches: 0, duplicate_jobs: 0, live_commands: 0 },
    rd_autonomy: { status: "passed", cas_and_idempotency: true, provider_smoke: false, kill_restart_single_trial_result: false },
    operator_http: { status: "passed", policy_tests: true, resident_smoke: false, audit_roundtrip: false },
    deployment: { systemd_installed: false, public_soak_passed: false, real_volume_restore_passed: false },
  }
}
