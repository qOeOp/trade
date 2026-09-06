import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("Source Intake Research is one typed RUN and identity-only RESOLVE operation", async () => {
  const [source, metadata, lock] = await Promise.all([
    readFile(new URL("./source_intake_research_v1.ts", import.meta.url), "utf8"),
    readFile(new URL("./source_intake_research_v1.script.yaml", import.meta.url), "utf8"),
    readFile(new URL("./source_intake_research_v1.script.lock", import.meta.url), "utf8"),
  ])
  assert.match(metadata, /^lock: "!inline f\/trade\/product_edge\/source_intake_research_v1\.script\.lock"$/m)
  assert.match(metadata, /^kind: script$/m)
  assert.match(metadata, /^      enum:\n        - RUN\n        - RESOLVE$/m)
  assert.match(metadata, /^  order:\n    - action\n    - request_identity\n    - operation$/m)
  assert.match(metadata, /^  required:\n    - action\n    - request_identity\n    - operation$/m)
  assert.match(metadata, /action: \{const: RUN\}[\s\S]*operation: \{type: object\}/)
  assert.match(metadata, /action: \{const: RESOLVE\}[\s\S]*operation: \{type: "null"\}/)
  assert.match(metadata, /^  additionalProperties: false$/m)
  assert.match(source, /type Action = "RUN" \| "RESOLVE"/)
  assert.match(source, /request_identity: string,\n  operation\?: SourceIntakeResearchOperationV1 \| null/)
  assert.match(source, /operation\.proposal\.request_identity === request_identity/)
  assert.match(source, /body === undefined \? \{\} : \{ body \}/)
  assert.match(source, /\/v1\/source-intake-research/)
  assert.doesNotMatch(source, /verified_evidence|SourceIntakePolicyEvidenceV1|raw_payload/)
  assert.match(lock, /^\{\n  "dependencies": \{\}\n\}\n\/\/bun\.lock\n<empty>\n$/)
})
