import { expect, test } from "bun:test"
import { readHypothesisCertificateGate } from "./rd-campaign-runner"

test("campaigns reject hypotheses without a certificate", () => {
  const input = { hypothesisId: "h1" } as Parameters<typeof readHypothesisCertificateGate>[0]
  const gate = readHypothesisCertificateGate(input)
  expect(gate.accepted).toBe(false)
  expect(gate.blocked_by).toEqual(["RND-HYPOTHESIS-CERTIFICATE-MISSING"])
})
