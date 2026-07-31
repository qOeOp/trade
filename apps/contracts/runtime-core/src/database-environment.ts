import { tmpdir } from "node:os"
import { basename, isAbsolute, resolve } from "node:path"
import { repoRoot } from "./paths"

export type DatabaseEnvironmentKind = "local" | "test" | "ci" | "runtime"

export interface DatabaseEnvironment {
  environment_id: string
  kind: DatabaseEnvironmentKind
  lifecycle: "durable" | "ephemeral"
  data_root: string
  tmp_root: string
}

interface DatabaseEnvironmentInput {
  kind: DatabaseEnvironmentKind
  instanceId?: string
  dataRoot?: string
  tmpRoot?: string
  repositoryRoot?: string
}

export function resolveDatabaseEnvironment(input: DatabaseEnvironmentInput): DatabaseEnvironment {
  const repositoryRoot = resolve(input.repositoryRoot || repoRoot())
  const instanceId = safeID(input.instanceId || input.kind)
  if ((input.kind === "test" || input.kind === "ci") && !input.instanceId) {
    throw new Error(`${input.kind} database environment requires a unique instance id`)
  }
  if (input.kind === "runtime" && (!input.dataRoot || !input.tmpRoot)) {
    throw new Error("runtime database environment requires explicit data and tmp roots")
  }
  const ephemeralRoot = resolve(tmpdir(), "trade", input.kind, instanceId)
  return {
    environment_id: `${input.kind}:${instanceId}`,
    kind: input.kind,
    lifecycle: input.kind === "test" || input.kind === "ci" ? "ephemeral" : "durable",
    data_root: resolveRoot(input.dataRoot, input.kind === "local" ? resolve(repositoryRoot, "data") : ephemeralRoot),
    tmp_root: resolveRoot(input.tmpRoot, input.kind === "local" ? resolve(repositoryRoot, "tmp") : resolve(ephemeralRoot, "tmp")),
  }
}

export function resolveEnvironmentDatabase(environment: DatabaseEnvironment, fileName: string): string {
  if (basename(fileName) !== fileName || !/^[a-z0-9][a-z0-9_-]*\.db$/.test(fileName)) {
    throw new Error(`database file name must be a lowercase basename ending in .db: ${fileName}`)
  }
  return resolve(environment.data_root, fileName)
}

export function resolveDatabasePathInput(path: string, repositoryRoot = repoRoot()): string {
  if (!path) throw new Error("database path is required")
  return isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path)
}

function resolveRoot(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  if (!isAbsolute(value)) throw new Error(`database environment root must be absolute: ${value}`)
  return resolve(value)
}

function safeID(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error(`invalid database environment instance id: ${value}`)
  }
  return normalized
}
