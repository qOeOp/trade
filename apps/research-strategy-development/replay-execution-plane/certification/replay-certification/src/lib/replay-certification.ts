import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export type ReplayProfileEvidenceDimension = "golden" | "resume" | "idempotency" | "tamper"
export type ReplayProfileEvidenceKind = "test" | "delegated-child-trial-test" | "explicit-not-supported"

export interface ReplayProfileEvidenceRef {
  kind: ReplayProfileEvidenceKind
  path?: string
  test_name?: string
}

export interface ReplayProfileEvidenceEntry {
  profile: string
  entrypoint_path: string
  entrypoint_export: string
  checkpoint_mode: string
  evidence: Record<ReplayProfileEvidenceDimension, ReplayProfileEvidenceRef>
}

export interface ReplayProfileEvidenceManifest {
  schema_version: "trade.rd-replay-profile-evidence.v1"
  owner: string
  required_dimensions: ReplayProfileEvidenceDimension[]
  profiles: ReplayProfileEvidenceEntry[]
}

export const REPLAY_CERTIFICATION_OWNER =
  "apps/research-strategy-development/replay-execution-plane/certification/replay-certification" as const
export const REPLAY_PLANE_ROOT =
  "apps/research-strategy-development/replay-execution-plane" as const

export function findReplayCertificationRepoRoot(start = import.meta.dir): string {
  let cursor = resolve(start)
  while (true) {
    if (existsSync(join(cursor, "package.json")) && existsSync(join(cursor, "apps"))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) throw new Error("Replay certification repository root not found")
    cursor = parent
  }
}

export function loadReplayProfileEvidenceManifest(repoRoot: string): ReplayProfileEvidenceManifest {
  const path = join(repoRoot, REPLAY_CERTIFICATION_OWNER, "replay-profile-evidence.json")
  return JSON.parse(readFileSync(path, "utf8")) as ReplayProfileEvidenceManifest
}

export function assertReplayProfileEvidenceManifest(
  manifest: ReplayProfileEvidenceManifest,
  repoRoot: string,
): void {
  const publicEntrypointPath = `${REPLAY_PLANE_ROOT}/runner/src/public.ts`
  const requiredDimensions: ReplayProfileEvidenceDimension[] = ["golden", "resume", "idempotency", "tamper"]
  if (manifest.schema_version !== "trade.rd-replay-profile-evidence.v1"
      || manifest.owner !== REPLAY_CERTIFICATION_OWNER
      || JSON.stringify(manifest.required_dimensions) !== JSON.stringify(requiredDimensions)) {
    throw new Error("unsupported Replay profile evidence manifest")
  }
  const profiles = manifest.profiles.map((entry) => entry.profile)
  if (new Set(profiles).size !== profiles.length
      || JSON.stringify(profiles) !== JSON.stringify([...profiles].sort())) {
    throw new Error("Replay profile evidence entries must be unique and sorted")
  }
  for (const entry of manifest.profiles) {
    const entrypointSource = readRepoFile(repoRoot, entry.entrypoint_path)
    if (entry.entrypoint_path !== publicEntrypointPath
        || !exportsName(entrypointSource, entry.entrypoint_export)) {
      throw new Error(`Replay profile entrypoint is invalid: ${entry.profile}`)
    }
    if (JSON.stringify(Object.keys(entry.evidence).sort())
        !== JSON.stringify([...requiredDimensions].sort())) {
      throw new Error(`Replay profile evidence dimensions are incomplete: ${entry.profile}`)
    }
    for (const dimension of requiredDimensions) {
      const evidence = entry.evidence[dimension]
      if (evidence.kind === "explicit-not-supported") {
        if (dimension !== "resume" || entry.checkpoint_mode !== "not-supported-no-checkpoint-writer"
            || evidence.path !== undefined || evidence.test_name !== undefined) {
          throw new Error(`Replay explicit unsupported evidence is invalid: ${entry.profile}.${dimension}`)
        }
        continue
      }
      if (evidence.kind !== "test" && evidence.kind !== "delegated-child-trial-test") {
        throw new Error(`Replay profile evidence kind is invalid: ${entry.profile}.${dimension}`)
      }
      if (!evidence.path?.endsWith(".test.ts") || !evidence.test_name) {
        throw new Error(`Replay profile test evidence is incomplete: ${entry.profile}.${dimension}`)
      }
      const testSource = readRepoFile(repoRoot, evidence.path)
      if (!testSource.includes(`test(${JSON.stringify(evidence.test_name)}`)) {
        throw new Error(`Replay profile evidence test is missing: ${entry.profile}.${dimension}`)
      }
      if (evidence.kind === "delegated-child-trial-test"
          && (dimension !== "resume" || entry.checkpoint_mode !== "child-trial-engine-checkpoints-v32-only")) {
        throw new Error(`Replay delegated resume evidence is invalid: ${entry.profile}`)
      }
    }
    const resumeKind = entry.evidence.resume.kind
    if (entry.checkpoint_mode === "resumable-engine-checkpoint-v32" && resumeKind !== "test") {
      throw new Error(`Replay resumable profile lacks direct resume evidence: ${entry.profile}`)
    }
    if (entry.checkpoint_mode === "child-trial-engine-checkpoints-v32-only"
        && resumeKind !== "delegated-child-trial-test") {
      throw new Error(`Replay child-checkpoint profile lacks delegated resume evidence: ${entry.profile}`)
    }
  }
  const publicSource = readRepoFile(repoRoot, publicEntrypointPath)
  const declaredExports = [...publicSource.matchAll(/export\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from/g)]
    .map((match) => match[1]!)
    .sort()
  const profileExports = manifest.profiles.map((entry) => entry.entrypoint_export).sort()
  if (JSON.stringify(declaredExports) !== JSON.stringify(profileExports)) {
    throw new Error("Replay public execution surface must expose exactly the four certified profiles")
  }
}

function exportsName(source: string, name: string): boolean {
  return source.includes(`export function ${name}`)
    || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(source)
}

function readRepoFile(repoRoot: string, path: string): string {
  if (!path || path.startsWith("/") || path.includes("..")) {
    throw new Error(`Replay certification path is not repo-relative: ${path}`)
  }
  const absolutePath = join(repoRoot, path)
  if (!existsSync(absolutePath)) throw new Error(`Replay certification evidence is missing: ${path}`)
  return readFileSync(absolutePath, "utf8")
}
