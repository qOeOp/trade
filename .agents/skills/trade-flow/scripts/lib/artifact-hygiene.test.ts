import { test } from "bun:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { runArtifactGc } from "./artifact-hygiene"

test("artifact gc dry-run reports stale unreferenced files without deleting", () => {
  const root = makeRoot()
  const stale = writeArtifact(root, "replay/stale.json", "2026-01-01T00:00:00.000Z")
  const fresh = writeArtifact(root, "replay/fresh.json", "2026-01-08T00:00:00.000Z")

  const result = runArtifactGc({
    root,
    now: "2026-01-08T01:00:00.000Z",
    retentionHours: 24,
  })

  assert.deepEqual(result.candidates.map((file) => file.path), [stale])
  assert.equal(result.deleted.length, 0)
  assert.equal(existsSync(stale), true)
  assert.equal(result.kept.some((file) => file.path === fresh && file.reason === "fresh"), true)
})

test("artifact gc preserves pinned, referenced, and durable store files", () => {
  const root = makeRoot()
  const pinned = writeArtifact(root, "raw/pinned.csv", "2026-01-01T00:00:00.000Z")
  const referenced = writeArtifact(root, "raw/referenced.csv", "2026-01-01T00:00:00.000Z")
  const db = writeArtifact(root, "trade.db", "2026-01-01T00:00:00.000Z")
  writeFileSync(`${pinned}.pin`, "")

  const result = runArtifactGc({
    root,
    now: "2026-01-08T01:00:00.000Z",
    retentionHours: 24,
    referencedPaths: [referenced],
    yes: true,
  })

  assert.equal(result.candidates.length, 0)
  assert.equal(result.kept.some((file) => file.path === pinned && file.reason === "pinned"), true)
  assert.equal(result.kept.some((file) => file.path === referenced && file.reason === "referenced"), true)
  assert.equal(result.kept.some((file) => file.path === db && file.reason === "durable_store"), true)
  assert.equal(existsSync(pinned), true)
  assert.equal(existsSync(referenced), true)
  assert.equal(existsSync(db), true)
})

test("artifact gc deletes only stale unreferenced files when yes is set", () => {
  const root = makeRoot()
  const stale = writeArtifact(root, "tmp/stale.json", "2026-01-01T00:00:00.000Z")
  const fresh = writeArtifact(root, "tmp/fresh.json", "2026-01-08T00:00:00.000Z")

  const result = runArtifactGc({
    root,
    now: "2026-01-08T01:00:00.000Z",
    retentionHours: 24,
    yes: true,
  })

  assert.deepEqual(result.deleted.map((file) => file.path), [stale])
  assert.equal(existsSync(stale), false)
  assert.equal(existsSync(fresh), true)
})

function makeRoot(): string {
  const root = join(tmpdir(), `artifact-gc-${crypto.randomUUID()}`)
  mkdirSync(root, { recursive: true })
  return root
}

function writeArtifact(root: string, relativePath: string, mtimeIso: string): string {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "{}")
  const date = new Date(mtimeIso)
  utimesSync(path, date, date)
  return path
}
