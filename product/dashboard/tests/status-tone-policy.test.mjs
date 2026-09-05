import assert from "node:assert/strict";
import test from "node:test";

import {
  actionStateTone,
  availabilityTone,
  catalogCompletenessTone,
  coverageDriftTone,
  decisionDispositionTone,
  deploymentStateTone,
  dispatcherTone,
  firstPartyAdapterTone,
  lifecycleStateTone,
  formationAttemptTone,
  implementationBasisTone,
  intakeStateTone,
  iterationProjectionTone,
  optionalDecisionDispositionTone,
  presenceTone,
  providerBindingTone,
  readFreshnessTone,
  readResultTone,
  progressStateTone,
  replacementReadinessTone,
  researchAvailabilityTone,
  scheduleStateTone,
} from "../components/ui/status-tone-policy.ts";

test("shared status policy maps lifecycle and availability without page-owned color choices", () => {
  assert.equal(availabilityTone("available"), "success");
  assert.equal(availabilityTone("stale"), "warning");
  assert.equal(availabilityTone("unavailable"), "unavailable");
  assert.equal(lifecycleStateTone("active"), "success");
  assert.equal(lifecycleStateTone("head"), "success");
  assert.equal(lifecycleStateTone("deleted"), "danger");
  assert.equal(lifecycleStateTone("historical"), "unavailable");
  assert.equal(deploymentStateTone("available"), "success");
  assert.equal(deploymentStateTone("not-deployed"), "unavailable");
  assert.equal(coverageDriftTone("changed"), "warning");
  assert.equal(coverageDriftTone("unchanged"), "success");
  assert.equal(coverageDriftTone("insufficient_history"), "unavailable");
});

test("shared status policy keeps routing, progress, action, and R&D mappings explicit", () => {
  assert.equal(dispatcherTone("WINDMILL"), "warning");
  assert.equal(dispatcherTone("TRADE"), "neutral");
  assert.equal(replacementReadinessTone("READY_FOR_SEPARATE_AUTHORIZATION"), "success");
  assert.equal(replacementReadinessTone("NOT_READY"), "warning");
  assert.equal(replacementReadinessTone("NOT_APPLICABLE"), "unavailable");
  assert.equal(implementationBasisTone("MATCHED"), "success");
  assert.equal(implementationBasisTone("DRIFTED"), "warning");
  assert.equal(implementationBasisTone("BLOCKED_BY_DEPENDENCY"), "warning");
  assert.equal(implementationBasisTone("NOT_DEPLOYED"), "unavailable");
  assert.equal(firstPartyAdapterTone("IMPLEMENTED_SOURCE_BOUND"), "success");
  assert.equal(firstPartyAdapterTone("BLOCKED_BY_COMPONENT"), "warning");
  assert.equal(firstPartyAdapterTone("NOT_IMPLEMENTED"), "unavailable");
  assert.equal(scheduleStateTone("due"), "warning");
  assert.equal(scheduleStateTone("scheduled"), "success");
  assert.equal(progressStateTone("current"), "info");
  assert.equal(progressStateTone("pending"), "unavailable");
  assert.equal(actionStateTone("ADMITTING"), "warning");
  assert.equal(actionStateTone("TERMINAL"), "info");
  assert.equal(researchAvailabilityTone("AVAILABLE"), "info");
  assert.equal(researchAvailabilityTone("STALE"), "warning");
  assert.equal(decisionDispositionTone("TERMINAL_STOP"), "info");
  assert.equal(decisionDispositionTone("CONTINUE"), "warning");
  assert.equal(optionalDecisionDispositionTone("TERMINAL_STOP"), "info");
  assert.equal(optionalDecisionDispositionTone(undefined), "unavailable");
});

test("R&D pages delegate badge surface semantics to the shared policy", () => {
  assert.equal(presenceTone(true), "info");
  assert.equal(presenceTone(false), "unavailable");
  assert.equal(intakeStateTone("idle"), "protected");
  assert.equal(intakeStateTone("available"), "info");
  assert.equal(intakeStateTone("unavailable"), "warning");
  assert.equal(readFreshnessTone({ current: true }), "info");
  assert.equal(readFreshnessTone({ current: false, stale: true }), "warning");
  assert.equal(readFreshnessTone({ current: false }), "unavailable");
  assert.equal(catalogCompletenessTone("COMPLETE"), "info");
  assert.equal(catalogCompletenessTone("PARTIAL_UNAVAILABLE"), "warning");
  assert.equal(catalogCompletenessTone(undefined), "unavailable");
  assert.equal(formationAttemptTone({ resolution: "SUCCESS" }), "info");
  assert.equal(formationAttemptTone({ resolution: "REJECTED" }), "warning");
  assert.equal(formationAttemptTone({}), "unavailable");
  assert.equal(iterationProjectionTone({ projected: true, selected: true }), "info");
  assert.equal(iterationProjectionTone({ projected: false, selected: true }), "warning");
  assert.equal(iterationProjectionTone({ projected: false, selected: false }), "unavailable");
  assert.equal(providerBindingTone({ bindingIdentity: "binding-v1" }), "info");
  assert.equal(providerBindingTone({ providerState: "UNAVAILABLE" }), "warning");
  assert.equal(providerBindingTone({}), "unavailable");
  assert.equal(readResultTone({ available: true, failed: false }), "info");
  assert.equal(readResultTone({ available: false, failed: true }), "warning");
  assert.equal(readResultTone({ available: false, failed: false }), "unavailable");
});
