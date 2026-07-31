import assert from "node:assert/strict"
import { unlinkSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { createAgentArtifactCliPort } from "./agent-artifact-cli-port"

const repositoryRoot = resolve(import.meta.dir, "../../../../../..")

test("R&D artifact port reaches the fixed owner command without a source import", () => {
  const artifacts = createAgentArtifactCliPort(repositoryRoot, "temporary")
  const ref = artifacts.put("{\"artifact_cli_port_test\":true}", "application/json")
  try {
    assert.equal(artifacts.read(ref), "{\"artifact_cli_port_test\":true}")
  } finally {
    unlinkSync(resolve(repositoryRoot, "tmp/agent-runs/artifacts", ref.sha256))
  }
})
