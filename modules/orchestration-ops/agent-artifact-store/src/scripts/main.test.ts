import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import type { AgentArtifactRef } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import { runArtifactStoreCommand } from "./main"

test("Agent Artifact Store command writes and reads one verified artifact", () => {
  const root = mkdtempSync(resolve(tmpdir(), "agent-artifact-command-"))
  try {
    const written = runArtifactStoreCommand(root, {
      action: "write_text",
      storage: "temporary",
      media_type: "application/json",
      text: "{\"bounded\":true}",
    })
    const artifact = written.artifact as AgentArtifactRef
    const read = runArtifactStoreCommand(root, {
      action: "read_text",
      artifact,
    })
    assert.equal(read.text, "{\"bounded\":true}")
    assert.deepEqual(read.artifact, artifact)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
