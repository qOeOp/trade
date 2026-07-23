#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import type { AgentArtifactRef } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  readAgentArtifact,
  writeAgentTextArtifact,
  type AgentArtifactMediaType,
  type AgentArtifactStorage,
} from "../lib/agent-artifact-store"

type ArtifactCommand =
  | {
      action: "write_text"
      storage: AgentArtifactStorage
      media_type: AgentArtifactMediaType
      text: string
    }
  | {
      action: "read_text"
      artifact: AgentArtifactRef
    }

export function runArtifactStoreCommand(
  repositoryRoot: string,
  input: ArtifactCommand,
): Record<string, unknown> {
  if (input.action === "write_text") {
    return {
      ok: true,
      action: input.action,
      artifact: writeAgentTextArtifact({
        repository_root: repositoryRoot,
        storage: input.storage,
        media_type: input.media_type,
        text: input.text,
      }),
    }
  }
  const materialized = readAgentArtifact(repositoryRoot, input.artifact)
  return {
    ok: true,
    action: input.action,
    artifact: materialized.artifact,
    text: materialized.text,
  }
}

function parseArgs(argv: string[]): { repository_root: string } {
  if (argv.length !== 2 || argv[0] !== "--repository-root" || !argv[1]) {
    throw new Error("Agent Artifact Store requires --repository-root <path>")
  }
  return { repository_root: argv[1] }
}

function parseCommand(value: unknown): ArtifactCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Artifact Store input must be one object")
  }
  const record = value as Record<string, unknown>
  if (record.action === "write_text") {
    if (record.storage !== "durable" && record.storage !== "temporary") {
      throw new Error("Agent Artifact Store storage is invalid")
    }
    if (!isMediaType(record.media_type) || typeof record.text !== "string") {
      throw new Error("Agent Artifact Store write input is invalid")
    }
    return {
      action: record.action,
      storage: record.storage,
      media_type: record.media_type,
      text: record.text,
    }
  }
  if (record.action === "read_text") {
    return {
      action: record.action,
      artifact: artifactRef(record.artifact),
    }
  }
  throw new Error("Agent Artifact Store action is unsupported")
}

function artifactRef(value: unknown): AgentArtifactRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent Artifact Store artifact ref is invalid")
  }
  const record = value as Record<string, unknown>
  if (typeof record.ref !== "string"
    || typeof record.sha256 !== "string"
    || !isMediaType(record.media_type)
    || !Number.isSafeInteger(record.bytes)
    || (record.bytes as number) < 0) {
    throw new Error("Agent Artifact Store artifact ref is invalid")
  }
  return {
    ref: record.ref,
    sha256: record.sha256,
    media_type: record.media_type,
    bytes: record.bytes as number,
  }
}

function isMediaType(value: unknown): value is AgentArtifactMediaType {
  return value === "application/json"
    || value === "text/markdown"
    || value === "text/x-diff"
    || value === "text/plain"
}

if (import.meta.main) {
  try {
    const args = parseArgs(Bun.argv.slice(2))
    const input = parseCommand(JSON.parse(readFileSync(0, "utf8")))
    console.log(JSON.stringify(runArtifactStoreCommand(args.repository_root, input)))
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
  }
}
