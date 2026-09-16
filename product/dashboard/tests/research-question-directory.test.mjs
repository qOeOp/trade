import assert from "node:assert/strict";
import test from "node:test";

import {
  parseResearchQuestionBrowserProjectionV1,
  parseResearchQuestionOwnerReadbackV1,
  researchQuestionForReadbackV1,
  researchQuestionsMatchCustodyV1,
} from "../lib/research-question-directory.ts";

const requestIdentity = "rd-research-request-v2-1234567890abcdef";
const owner = {
  schema_version: 1,
  operation: "rd.research_question_directory.read.v1",
  observed_at_epoch_ms: 2_000,
  total: 1,
  items: [{
    request_identity: requestIdentity,
    semantic_digest: `sha256:${"a".repeat(64)}`,
    committed_at_epoch_ms: 1_000,
    availability: "AVAILABLE",
    unavailable_reason: null,
    question: {
      hypothesis: "Liquidity shocks predict short-lived reversal.",
      falsification_question: "Does the effect disappear after costs?",
      expected_observation: "Net reversal remains positive.",
    },
  }],
};

test("research question directory accepts only exact verified Owner shapes", () => {
  const projection = parseResearchQuestionOwnerReadbackV1(owner);
  assert.equal(projection?.items[0].question?.hypothesis, owner.items[0].question.hypothesis);
  assert.equal(parseResearchQuestionOwnerReadbackV1({ ...owner, smuggled: true }), null);
  assert.equal(parseResearchQuestionOwnerReadbackV1({ ...owner, total: 2 }), null);
  assert.equal(parseResearchQuestionOwnerReadbackV1({ ...owner, items: [{ ...owner.items[0], question: null }] }), null);
});

test("browser projection round-trips and binds to the complete custody identity cut", () => {
  const projected = parseResearchQuestionOwnerReadbackV1(owner);
  assert.ok(projected);
  assert.deepEqual(parseResearchQuestionBrowserProjectionV1(projected), projected);
  const custody = {
    completeness: "COMPLETE",
    researchTotal: 1,
    research: [{ requestIdentity, committedAtEpochMs: 1_000, projectionState: "POINT_READ_REQUIRED" }],
  };
  assert.equal(researchQuestionsMatchCustodyV1(projected, custody), true);
  assert.equal(researchQuestionsMatchCustodyV1(projected, {
    ...custody,
    research: [{ ...custody.research[0], committedAtEpochMs: 999 }],
  }), false);
});

test("verified unavailable questions remain explicit rather than inferred", () => {
  const projection = parseResearchQuestionOwnerReadbackV1({
    ...owner,
    items: [{ ...owner.items[0], availability: "UNAVAILABLE",
      unavailable_reason: "VERIFIED_QUESTION_UNAVAILABLE", question: null }],
  });
  assert.equal(projection?.items[0].availability, "unavailable");
  assert.equal(projection?.items[0].question, null);
});

test("question display binds the exact readback identity, semantic digest and commit time", () => {
  const questions = parseResearchQuestionOwnerReadbackV1(owner);
  assert.ok(questions);
  const readback = {
    availability: "available",
    requestIdentity,
    observedAt: new Date(2_000).toISOString(),
    outcome: {
      resolution: "accepted",
      historicalDisposition: null,
      intentIdentity: "research-intent-v1-1234567890abcdef",
      rejectionCode: null,
      committedAt: new Date(1_000).toISOString(),
    },
    view: null,
    technical: {
      ownerReceiptIdentity: "research-receipt-v2-1234567890abcdef",
      semanticDigest: owner.items[0].semantic_digest,
      projectionIdentity: null,
      sourceCut: null,
      trialFamilyIdentity: null,
    },
    reason: null,
  };
  assert.equal(researchQuestionForReadbackV1(questions, readback)?.question?.hypothesis,
    owner.items[0].question.hypothesis);
  assert.equal(researchQuestionForReadbackV1(questions, {
    ...readback,
    technical: { ...readback.technical, semanticDigest: `sha256:${"b".repeat(64)}` },
  }), null);
  assert.equal(researchQuestionForReadbackV1(questions, {
    ...readback,
    outcome: { ...readback.outcome, committedAt: new Date(999).toISOString() },
  }), null);
  assert.equal(researchQuestionForReadbackV1(questions, {
    ...readback,
    requestIdentity: "rd-research-request-v2-other123456",
  }), null);
});
