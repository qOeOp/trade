import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import type { ServerRuntimeProfile } from "./server-runtime-profile"
import { parseServerRuntimeProfile, serverRuntimeProfileHash } from "./server-runtime-profile"

export const SERVER_RUNTIME_RECOVERY_FIXTURE_SCHEMA = "trade.server-runtime-recovery-fixture.v1" as const

interface ManifestEntry {
  role: "profile" | "owner_db" | "raw" | "artifact"
  ref: string
  sha256: string
}

export interface ServerRuntimeRecoveryFixtureResult {
  schema_version: typeof SERVER_RUNTIME_RECOVERY_FIXTURE_SCHEMA
  profile_id: string
  deployment_id: string
  profile_hash: string
  status: "passed"
  fixture_scope: "synthetic_recovery_closure_only"
  closure: {
    owner_db_count: 3
    raw_count: 1
    artifact_count: 1
    profile_count: 1
    durable_ref_count: 3
  }
  assertions: {
    sqlite_online_backup_completed: true
    restored_db_integrity_ok: true
    restored_file_hashes_match: true
    durable_refs_resolve_with_matching_hash: true
    restored_profile_hash_matches: true
  }
  limitations: string[]
}

export function runServerRuntimeRecoveryFixture(
  profile: ServerRuntimeProfile,
  repositoryRoot: string,
): ServerRuntimeRecoveryFixtureResult {
  const runtimeRoot = resolve(repositoryRoot, "tmp")
  mkdirSync(runtimeRoot, { recursive: true })
  const fixtureRoot = mkdtempSync(resolve(runtimeRoot, "server-runtime-recovery-"))
  const sourceRoot = resolve(fixtureRoot, "source")
  const backupRoot = resolve(fixtureRoot, "backup")
  const restoreRoot = resolve(fixtureRoot, "restore")
  try {
    const profileRef = "profile/server-runtime.json"
    const rawRef = `${profile.l2_owner.output_base}/fixture/segment.tl2s`
    const artifactRef = "data/artifacts/server-runtime-fixture.json"
    const profileBytes = `${JSON.stringify(profile, null, 2)}\n`
    write(sourceRoot, profileRef, profileBytes)
    write(sourceRoot, rawRef, "TL2S-fixture-segment\n")
    write(sourceRoot, artifactRef, `${JSON.stringify({ schema_version: "trade.fixture-artifact.v1", result: "shadow_only" })}\n`)

    const dbRefs = [
      profile.l2_owner.market_data_db,
      profile.control_runtime.trade_db,
      profile.control_runtime.ops_runtime_db,
    ] as const
    createFixtureDb(resolve(sourceRoot, dbRefs[0]), rawRef, sha256File(resolve(sourceRoot, rawRef)))
    createFixtureDb(resolve(sourceRoot, dbRefs[1]), artifactRef, sha256File(resolve(sourceRoot, artifactRef)))
    createFixtureDb(resolve(sourceRoot, dbRefs[2]), profileRef, sha256File(resolve(sourceRoot, profileRef)))

    const entries: ManifestEntry[] = [
      copyHashed(sourceRoot, backupRoot, profileRef, "profile"),
      copyHashed(sourceRoot, backupRoot, rawRef, "raw"),
      copyHashed(sourceRoot, backupRoot, artifactRef, "artifact"),
    ]
    for (const dbRef of dbRefs) {
      const backupPath = resolve(backupRoot, dbRef)
      mkdirSync(dirname(backupPath), { recursive: true })
      sqliteOnlineBackup(resolve(sourceRoot, dbRef), backupPath)
      entries.push({ role: "owner_db", ref: dbRef, sha256: sha256File(backupPath) })
    }
    entries.sort((left, right) => left.ref.localeCompare(right.ref))
    writeFileSync(resolve(backupRoot, "manifest.json"), `${JSON.stringify({
      schema_version: "trade.server-runtime-backup-manifest.v1",
      profile_hash: serverRuntimeProfileHash(profile),
      entries,
    }, null, 2)}\n`, { mode: 0o600 })

    for (const entry of entries) {
      const target = resolve(restoreRoot, entry.ref)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(resolve(backupRoot, entry.ref), target)
      if (sha256File(target) !== entry.sha256) throw new Error(`restored hash mismatch for ${entry.role}`)
    }
    for (const dbRef of dbRefs) assertSqliteIntegrity(resolve(restoreRoot, dbRef))

    let durableRefCount = 0
    for (const dbRef of dbRefs) {
      const db = new Database(resolve(restoreRoot, dbRef), { readonly: true, create: false })
      try {
        const refs = db.query("SELECT ref, sha256 FROM fixture_durable_ref ORDER BY ref").all() as Array<{ ref: string; sha256: string }>
        for (const durableRef of refs) {
          const target = resolve(restoreRoot, durableRef.ref)
          if (sha256File(target) !== durableRef.sha256) throw new Error("durable ref closure mismatch")
          durableRefCount += 1
        }
      } finally {
        db.close()
      }
    }
    const restoredProfile = parseServerRuntimeProfile(JSON.parse(
      readFileSync(resolve(restoreRoot, profileRef), "utf8"),
    ))
    if (serverRuntimeProfileHash(restoredProfile) !== serverRuntimeProfileHash(profile)) {
      throw new Error("restored profile hash mismatch")
    }
    if (durableRefCount !== 3) throw new Error("fixture durable ref closure is incomplete")

    return {
      schema_version: SERVER_RUNTIME_RECOVERY_FIXTURE_SCHEMA,
      profile_id: profile.profile_id,
      deployment_id: profile.deployment_id,
      profile_hash: serverRuntimeProfileHash(profile),
      status: "passed",
      fixture_scope: "synthetic_recovery_closure_only",
      closure: {
        owner_db_count: 3,
        raw_count: 1,
        artifact_count: 1,
        profile_count: 1,
        durable_ref_count: 3,
      },
      assertions: {
        sqlite_online_backup_completed: true,
        restored_db_integrity_ok: true,
        restored_file_hashes_match: true,
        durable_refs_resolve_with_matching_hash: true,
        restored_profile_hash_matches: true,
      },
      limitations: [
        "synthetic_owner_schemas_and_data_only",
        "does_not_copy_or_mutate_active_runtime_databases",
        "does_not_discover_real_cross_store_artifact_refs",
        "does_not_upload_encrypt_or_apply_retention_to_backups",
        "real_server_volume_recovery_remains_an_adoption_gate",
      ],
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

function createFixtureDb(path: string, durableRef: string, durableHash: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  try {
    db.exec("PRAGMA journal_mode=WAL")
    db.exec("CREATE TABLE fixture_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.exec("CREATE TABLE fixture_durable_ref (ref TEXT PRIMARY KEY, sha256 TEXT NOT NULL)")
    db.query("INSERT INTO fixture_state (key, value) VALUES (?, ?)").run("ready", "true")
    db.query("INSERT INTO fixture_durable_ref (ref, sha256) VALUES (?, ?)").run(durableRef, durableHash)
  } finally {
    db.close()
  }
}

function sqliteOnlineBackup(source: string, target: string): void {
  const db = new Database(source, { readonly: true, create: false })
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
  } finally {
    db.close()
  }
  assertSqliteIntegrity(target)
}

function assertSqliteIntegrity(path: string): void {
  const db = new Database(path, { readonly: true, create: false })
  try {
    const row = db.query("PRAGMA integrity_check").get() as Record<string, unknown> | null
    if (!row || Object.values(row)[0] !== "ok") throw new Error("SQLite integrity_check failed")
  } finally {
    db.close()
  }
}

function copyHashed(sourceRoot: string, targetRoot: string, ref: string, role: ManifestEntry["role"]): ManifestEntry {
  const target = resolve(targetRoot, ref)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(resolve(sourceRoot, ref), target)
  return { role, ref, sha256: sha256File(target) }
}

function write(root: string, ref: string, value: string): void {
  const path = resolve(root, ref)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value, { mode: 0o600 })
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}
