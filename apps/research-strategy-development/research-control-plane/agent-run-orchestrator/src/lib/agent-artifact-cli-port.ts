import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type { AgentArtifactRef } from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import type { AgentArtifactPort } from "./planner-agent-run"

const ARTIFACT_OWNER_SCRIPT =
  "apps/orchestration-ops/agent-artifact-store/src/scripts/main.ts"

export function createAgentArtifactCliPort(
  repositoryRootValue: string,
  storage: "durable" | "temporary",
): AgentArtifactPort {
  const repositoryRoot = realpathSync(resolve(repositoryRootValue))
  return {
    put: (text, mediaType) => {
      const response = callArtifactOwner(repositoryRoot, {
        action: "write_text",
        storage,
        media_type: mediaType,
        text,
      })
      return artifactRef(response.artifact)
    },
    read: (artifact) => {
      const response = callArtifactOwner(repositoryRoot, {
        action: "read_text",
        artifact,
      })
      if (typeof response.text !== "string") {
        throw new Error("Agent Artifact owner returned no text")
      }
      return response.text
    },
  }
}

function callArtifactOwner(
  repositoryRoot: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      resolve(repositoryRoot, ARTIFACT_OWNER_SCRIPT),
      "--repository-root",
      repositoryRoot,
    ],
    cwd: repositoryRoot,
    stdin: Buffer.from(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error("Agent Artifact owner command failed")
  }
  const parsed = JSON.parse(result.stdout.toString()) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Agent Artifact owner response is invalid")
  }
  const response = parsed as Record<string, unknown>
  if (response.ok !== true) throw new Error("Agent Artifact owner rejected command")
  return response
}

function artifactRef(value: unknown): AgentArtifactRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Artifact owner returned an invalid ref")
  }
  const record = value as Record<string, unknown>
  if (typeof record.ref !== "string"
    || typeof record.sha256 !== "string"
    || !isMediaType(record.media_type)
    || !Number.isSafeInteger(record.bytes)
    || (record.bytes as number) < 0) {
    throw new Error("Agent Artifact owner returned an invalid ref")
  }
  return {
    ref: record.ref,
    sha256: record.sha256,
    media_type: record.media_type,
    bytes: record.bytes as number,
  }
}

function isMediaType(value: unknown): value is AgentArtifactRef["media_type"] {
  return value === "application/json"
    || value === "text/markdown"
    || value === "text/x-diff"
    || value === "text/plain"
}
