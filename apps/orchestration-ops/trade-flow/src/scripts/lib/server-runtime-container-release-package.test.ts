import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import test from "node:test"
import {
  createServerContainerSourcePackage,
  createServerContainerSourcePackageFromArchive,
  SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS,
  SERVER_CONTAINER_SOURCE_PACKAGE_SCHEMA,
} from "./server-runtime-container-release-package"

interface ReleaseManifest {
  schema_version: string
  source_commit: string
  adoption: {
    status: string
    image_digest: string | null
    sbom_ref: string | null
  }
  safety: {
    credentials_included: boolean
    runtime_state_included: boolean
    formal_replay_jobs_enabled: boolean
    working_tree_included: boolean
  }
  critical_contracts: Array<{ ref: string; sha256: string }>
  source_origin: {
    kind: string
    manifest_sha256: string
    packaged_manifest_ref?: string
  }
}

test("container source package binds committed source and excludes workspace state", () => {
  const root = mkdtempSync(resolve(tmpdir(), "trade-container-source-package-"))
  const repository = resolve(root, "repository")
  const target = resolve(root, "package")
  mkdirSync(repository)
  try {
    git(repository, ["init", "--quiet"])
    for (const ref of SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS) {
      const path = resolve(repository, ref)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, fixtureContent(ref))
    }
    git(repository, ["add", "."])
    git(repository, [
      "-c",
      "user.name=Trade Test",
      "-c",
      "user.email=trade-test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ])
    const commit = gitOutput(repository, ["rev-parse", "HEAD"]).trim()

    writeFileSync(resolve(repository, "deploy/server/Dockerfile"), "dirty workspace\n")
    mkdirSync(resolve(repository, ".secrets"), { recursive: true })
    mkdirSync(resolve(repository, "data"), { recursive: true })
    mkdirSync(resolve(repository, "tmp"), { recursive: true })
    writeFileSync(resolve(repository, ".secrets/key"), "secret")
    writeFileSync(resolve(repository, "data/state.db"), "runtime")
    writeFileSync(resolve(repository, "tmp/cache"), "cache")

    const result = createServerContainerSourcePackage({
      repository_root: repository,
      target_root: target,
      created_at: "2026-07-23T10:00:00.000Z",
    })

    assert.equal(result.status, "packaged")
    assert.equal(result.source_commit, commit)
    assert.equal(result.linux_image_build_complete, false)
    assert.equal(result.live_writes_allowed, false)
    assert.equal(statSync(resolve(target, "container-acceptance.sh")).mode & 0o700, 0o700)

    const manifest = JSON.parse(
      readFileSync(resolve(target, "release-manifest.json"), "utf8"),
    ) as ReleaseManifest
    assert.equal(manifest.schema_version, SERVER_CONTAINER_SOURCE_PACKAGE_SCHEMA)
    assert.equal(manifest.source_commit, commit)
    assert.equal(manifest.adoption.status, "source_package_only")
    assert.equal(manifest.adoption.image_digest, null)
    assert.equal(manifest.adoption.sbom_ref, null)
    assert.equal(manifest.safety.credentials_included, false)
    assert.equal(manifest.safety.runtime_state_included, false)
    assert.equal(manifest.safety.formal_replay_jobs_enabled, true)
    assert.equal(manifest.safety.working_tree_included, false)
    assert.equal(
      manifest.critical_contracts.length,
      SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS.length,
    )
    const dockerfile = manifest.critical_contracts.find(
      (entry) => entry.ref === "deploy/server/Dockerfile",
    )
    assert.equal(dockerfile?.sha256, sha256(fixtureContent("deploy/server/Dockerfile")))

    const entries = tarEntries(resolve(target, "source.tar"))
    assert.equal(entries.includes("deploy/server/Dockerfile"), true)
    assert.equal(entries.some((entry) => entry.startsWith(".secrets/")), false)
    assert.equal(entries.some((entry) => entry.startsWith("data/")), false)
    assert.equal(entries.some((entry) => entry.startsWith("tmp/")), false)
    assert.equal(
      gitArchiveFile(resolve(target, "source.tar"), "deploy/server/Dockerfile"),
      fixtureContent("deploy/server/Dockerfile"),
    )
    verifyChecksums(target)

    const candidateTarget = resolve(root, "candidate-package")
    const candidateArchive = resolve(target, "source.tar")
    const candidateOriginManifest = resolve(root, "candidate-origin.json")
    const candidateOriginHash = "a".repeat(64)
    writeFileSync(candidateOriginManifest, `${JSON.stringify({
      schema_version: "trade.rd-developer-patch-adoption-manifest.v1",
      status: "candidate_certified",
      candidate_source_revision: commit,
      manifest_sha256: candidateOriginHash,
      source_archive: {
        sha256: sha256(readFileSync(candidateArchive)),
      },
    })}\n`)
    const candidateResult = createServerContainerSourcePackageFromArchive({
      repository_root: repository,
      target_root: candidateTarget,
      source_archive_path: candidateArchive,
      source_archive_sha256: sha256(readFileSync(candidateArchive)),
      source_commit: commit,
      source_origin_manifest_path: candidateOriginManifest,
      source_origin: {
        kind: "certified_agent_patch_candidate",
        manifest_ref: "data/release-candidates/adoption-fixture/manifest.json",
        manifest_sha256: candidateOriginHash,
      },
      created_at: "2026-07-23T10:01:00.000Z",
    })
    assert.equal(candidateResult.source_commit, commit)
    const candidateManifest = JSON.parse(
      readFileSync(resolve(candidateTarget, "release-manifest.json"), "utf8"),
    ) as ReleaseManifest
    assert.equal(
      candidateManifest.source_origin.kind,
      "certified_agent_patch_candidate",
    )
    assert.equal(
      candidateManifest.source_origin.manifest_sha256,
      candidateOriginHash,
    )
    assert.equal(
      candidateManifest.source_origin.packaged_manifest_ref,
      "source-adoption-manifest.json",
    )
    assert.deepEqual(
      readFileSync(resolve(candidateTarget, "source-adoption-manifest.json")),
      readFileSync(candidateOriginManifest),
    )
    assert.equal(
      sha256(readFileSync(resolve(candidateTarget, "source.tar"))),
      sha256(readFileSync(candidateArchive)),
    )
    verifyChecksums(candidateTarget)

    const strategyTarget = resolve(root, "strategy-candidate-package")
    const strategyOriginManifest = resolve(root, "strategy-origin.json")
    const strategyOriginHash = "b".repeat(64)
    writeFileSync(strategyOriginManifest, `${JSON.stringify({
      schema_version: "trade.rd-strategy-source-adoption-manifest.v1",
      status: "candidate_certified",
      candidate_source_revision: commit,
      manifest_hash: strategyOriginHash,
      source_archive: {
        sha256: sha256(readFileSync(candidateArchive)),
      },
    })}\n`)
    const strategyResult = createServerContainerSourcePackageFromArchive({
      repository_root: repository,
      target_root: strategyTarget,
      source_archive_path: candidateArchive,
      source_archive_sha256: sha256(readFileSync(candidateArchive)),
      source_commit: commit,
      source_origin_manifest_path: strategyOriginManifest,
      source_origin: {
        kind: "certified_strategy_source_candidate",
        manifest_ref:
          "data/release-candidates/strategy-adoptions/fixture/manifest.json",
        manifest_sha256: strategyOriginHash,
      },
      created_at: "2026-07-23T10:02:00.000Z",
    })
    assert.equal(strategyResult.source_commit, commit)
    const strategyManifest = JSON.parse(
      readFileSync(resolve(strategyTarget, "release-manifest.json"), "utf8"),
    ) as ReleaseManifest
    assert.equal(
      strategyManifest.source_origin.kind,
      "certified_strategy_source_candidate",
    )
    assert.equal(
      strategyManifest.source_origin.manifest_sha256,
      strategyOriginHash,
    )
    verifyChecksums(strategyTarget)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function fixtureContent(
  ref: typeof SERVER_CONTAINER_SOURCE_PACKAGE_CRITICAL_REFS[number],
): string {
  if (ref === "deploy/server/container-acceptance.sh") return "#!/bin/sh\nset -eu\n"
  if (ref.endsWith(".json")) return "{}\n"
  if (ref === ".dockerignore") return ".git\n.secrets\ndata\ntmp\nnode_modules\n"
  return `${ref}\n`
}

function verifyChecksums(root: string): void {
  const lines = readFileSync(resolve(root, "SHA256SUMS"), "utf8").trim().split("\n")
  assert.equal(lines.length >= 6, true)
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line)
    assert.ok(match)
    assert.equal(sha256(readFileSync(resolve(root, match[2]!))), match[1])
  }
}

function tarEntries(path: string): string[] {
  return command("tar", ["-tf", path], process.cwd()).trim().split(/\r?\n/)
}

function gitArchiveFile(path: string, ref: string): string {
  return command("tar", ["-xOf", path, ref], process.cwd())
}

function git(cwd: string, args: string[]): void {
  command("git", args, cwd)
}

function gitOutput(cwd: string, args: string[]): string {
  return command("git", args, cwd)
}

function command(executable: string, args: string[], cwd: string): string {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    throw new Error(`${executable} ${args[0] ?? ""} failed with exit ${result.status ?? -1}`)
  }
  return result.stdout
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
