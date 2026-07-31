import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import {
  parseAgentJsonArtifact,
  readAgentArtifact,
  writeAgentJsonArtifact,
  writeAgentTextArtifact,
} from "./agent-artifact-store"

test("Agent artifacts are immutable, content addressed, and restart-readable", () => {
  const root = mkdtempSync(resolve(tmpdir(), "agent-artifact-store-"))
  try {
    const first = writeAgentJsonArtifact({
      repository_root: root,
      storage: "durable",
      value: { beta: 2, alpha: 1 },
    })
    const replay = writeAgentJsonArtifact({
      repository_root: root,
      storage: "durable",
      value: { alpha: 1, beta: 2 },
    })
    assert.deepEqual(replay, first)
    assert.deepEqual(parseAgentJsonArtifact(root, first), { alpha: 1, beta: 2 })
    assert.equal(readAgentArtifact(root, first).artifact.ref, first.ref)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Agent artifact reads reject drift, secrets, collisions, and symlinked roots", () => {
  const root = mkdtempSync(resolve(tmpdir(), "agent-artifact-deny-"))
  const external = mkdtempSync(resolve(tmpdir(), "agent-artifact-external-"))
  try {
    assert.throws(() => writeAgentTextArtifact({
      repository_root: root,
      storage: "temporary",
      media_type: "text/plain",
      text: "api_key=sk-abcdefghijklmnopqrstuv",
    }), /secret-like/)
    assert.doesNotThrow(() => writeAgentTextArtifact({
      repository_root: root,
      storage: "temporary",
      media_type: "application/json",
      text: "{\"risk_adjusted_return\":0.15}",
    }))
    const artifact = writeAgentTextArtifact({
      repository_root: root,
      storage: "temporary",
      media_type: "text/plain",
      text: "bounded",
    })
    assert.throws(() => readAgentArtifact(root, { ...artifact, bytes: artifact.bytes + 1 }), /drifted/)
    const hash = artifact.sha256
    writeFileSync(resolve(root, "tmp/agent-runs/artifacts", hash), "mutated")
    assert.throws(() => readAgentArtifact(root, artifact), /drifted/)

    const symlinkRoot = mkdtempSync(resolve(tmpdir(), "agent-artifact-symlink-"))
    try {
      symlinkSync(external, resolve(symlinkRoot, "data"))
      assert.throws(() => writeAgentTextArtifact({
        repository_root: symlinkRoot,
        storage: "durable",
        media_type: "text/plain",
        text: "safe",
      }), /symlink|escaped/)
    } finally {
      rmSync(symlinkRoot, { recursive: true, force: true })
    }
    assert.equal(readFileSync(resolve(root, "tmp/agent-runs/artifacts", hash), "utf8"), "mutated")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(external, { recursive: true, force: true })
  }
})
