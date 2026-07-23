import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { assertServerRuntimeReleaseTarget } from "./server-runtime-release-stage"

type JSONRecord = Record<string, unknown>

export const SERVER_CONTAINER_SOURCE_PACKAGE_SCHEMA =
  "trade.server-container-source-package.v1" as const

export const SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS = [
  ".dockerignore",
  "bun.lock",
  "package.json",
  "deploy/server/Dockerfile",
  "deploy/server/compose.yaml",
  "deploy/server/compose.agent.yaml",
  "deploy/server/compose.operator.yaml",
  "deploy/server/container-acceptance.sh",
  "deploy/server/openclaw.json",
  "deploy/server/openclaw-dependency.json",
  "profile/server-runtime-container.json",
] as const

const FORBIDDEN_ARCHIVE_PREFIXES = [
  ".git/",
  ".secrets/",
  "data/",
  "node_modules/",
  "tmp/",
] as const

export interface CreateServerContainerSourcePackageInput {
  repository_root: string
  target_root: string
  created_at?: string
}

export function createServerContainerSourcePackage(
  input: CreateServerContainerSourcePackageInput,
): JSONRecord {
  const repositoryRoot = resolve(input.repository_root)
  const targetRoot = assertServerRuntimeReleaseTarget(repositoryRoot, input.target_root)
  const commit = gitText(repositoryRoot, ["rev-parse", "HEAD"]).trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("git HEAD is not a full commit hash")
  const createdAt = canonicalTime(input.created_at ?? new Date().toISOString())
  const partialRoot = `${targetRoot}.partial-${process.pid}`
  if (existsSync(partialRoot)) throw new Error("container source package temporary path already exists")
  mkdirSync(dirname(targetRoot), { recursive: true, mode: 0o700 })
  mkdirSync(partialRoot, { recursive: false, mode: 0o700 })
  try {
    const sourceArchive = resolve(partialRoot, "source.tar")
    git(repositoryRoot, [
      "archive",
      "--format=tar",
      `--output=${sourceArchive}`,
      commit,
    ])
    assertArchiveSafety(sourceArchive)

    const acceptance = gitBytes(
      repositoryRoot,
      ["show", `${commit}:deploy/server/container-acceptance.sh`],
    )
    const acceptancePath = resolve(partialRoot, "container-acceptance.sh")
    writeFileSync(acceptancePath, acceptance, { mode: 0o700 })
    chmodSync(acceptancePath, 0o700)

    const sourceCommitPath = resolve(partialRoot, "SOURCE_COMMIT")
    writeFileSync(sourceCommitPath, `${commit}\n`, { mode: 0o600 })
    const manifest = {
      schema_version: SERVER_CONTAINER_SOURCE_PACKAGE_SCHEMA,
      package_id: commit.slice(0, 12),
      source_commit: commit,
      created_at: createdAt,
      source_archive: fileEvidence(partialRoot, "source.tar"),
      critical_contracts: SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS.map((ref) => ({
        ref,
        sha256: hashBytes(gitBytes(repositoryRoot, ["show", `${commit}:${ref}`])),
      })),
      toolchains: {
        bun: "1.3.13",
        rust: "1.97.1",
        go: "1.25",
      },
      adoption: {
        status: "source_package_only",
        linux_image_build_complete: false,
        image_digest: null,
        sbom_ref: null,
        provenance_ref: null,
        container_smoke_complete: false,
      },
      safety: {
        domain_jobs_enabled: false,
        live_writes_allowed: false,
        credentials_included: false,
        runtime_state_included: false,
        working_tree_included: false,
      },
      required_next: [
        "linux_buildkit_build_with_sbom_and_provenance",
        "linux_no_live_health_restart_and_volume_canary",
        "independent_evidence_review",
      ],
    }
    const manifestPath = resolve(partialRoot, "release-manifest.json")
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    const readmePath = resolve(partialRoot, "README.md")
    writeFileSync(readmePath, packageReadme(commit), { mode: 0o600 })
    const checksummed = [
      "source.tar",
      "container-acceptance.sh",
      "SOURCE_COMMIT",
      "release-manifest.json",
      "README.md",
    ]
    const sums = checksummed
      .map((ref) => `${fileHash(resolve(partialRoot, ref))}  ${ref}`)
      .join("\n")
    writeFileSync(resolve(partialRoot, "SHA256SUMS"), `${sums}\n`, { mode: 0o600 })
    renameSync(partialRoot, targetRoot)
    return {
      schema_version: "trade.server-container-source-package-result.v1",
      status: "packaged",
      package_id: manifest.package_id,
      source_commit: commit,
      package_root: targetRoot,
      manifest_hash: fileHash(resolve(targetRoot, "release-manifest.json")),
      source_archive_hash: fileHash(resolve(targetRoot, "source.tar")),
      linux_image_build_complete: false,
      live_writes_allowed: false,
    }
  } catch (error) {
    if (existsSync(partialRoot)) rmSync(partialRoot, { recursive: true })
    throw error
  }
}

function assertArchiveSafety(archivePath: string): void {
  const entries = commandBytes(["tar", "-tf", archivePath], process.cwd())
    .toString("utf8")
    .split(/\r?\n/)
    .filter(Boolean)
  const forbidden = entries.find((entry) =>
    FORBIDDEN_ARCHIVE_PREFIXES.some((prefix) => entry === prefix.slice(0, -1) || entry.startsWith(prefix)))
  if (forbidden) throw new Error(`source archive contains forbidden runtime path: ${forbidden}`)
}

function fileEvidence(root: string, ref: string): JSONRecord {
  const path = resolve(root, ref)
  return {
    ref,
    sha256: fileHash(path),
    size_bytes: statSync(path).size,
  }
}

function packageReadme(commit: string): string {
  return `# Trade server source package

This package contains only committed source at \`${commit}\`. It has no credentials,
runtime databases, build output, image digest, or live-trading authority.

On a Linux Docker host:

\`\`\`sh
./container-acceptance.sh verify
export TRADE_CONTAINER_ACCEPTANCE_ROOT=/opt/trade/acceptance/${commit.slice(0, 12)}
export TRADE_CONTAINER_EVIDENCE_DIR=/var/lib/trade/acceptance-evidence/${commit.slice(0, 12)}
./container-acceptance.sh all
\`\`\`

The acceptance run builds with BuildKit SBOM/provenance requests, runs only the
no-live base runtime, checks health across a container restart, verifies a named-volume
canary, and stops the container without deleting volumes. Passing it is evidence for
manual release review; it does not authorize exchange writes.
`
}

function git(repositoryRoot: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    stdio: ["ignore", "ignore", "pipe"],
  })
  if (result.status !== 0) {
    throw new Error(`git ${args[0] ?? ""} failed with exit ${result.status ?? -1}`)
  }
}

function gitText(repositoryRoot: string, args: string[]): string {
  return gitBytes(repositoryRoot, args).toString("utf8")
}

function gitBytes(repositoryRoot: string, args: string[]): Buffer {
  return commandBytes(["git", ...args], repositoryRoot)
}

function commandBytes(argv: string[], cwd: string): Buffer {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    throw new Error(`${argv[0]} ${argv[1] ?? ""} failed with exit ${result.status ?? -1}`)
  }
  return result.stdout
}

function fileHash(path: string): string {
  return hashBytes(readFileSync(path))
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function canonicalTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("created_at must be canonical UTC")
  }
  return value
}
