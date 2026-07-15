import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY, canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  createReplayLocalArtifactStore,
  ensureReplayDurableDirectory,
  removeReplayDurableFile,
  writeReplayDurableAtomic,
  writeReplayImmutableCas,
} from "./replay-local-artifact-store"

test("local artifact store fsyncs nested directories and atomically replaces staging files", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-durable-"))
  const directory = join(root, "logical", "attempt")
  ensureReplayDurableDirectory(directory)
  const path = join(directory, "result.json")
  const first = writeReplayDurableAtomic(path, "first\n")
  const second = writeReplayDurableAtomic(path, "second\n")
  expect(first.sha256).not.toBe(second.sha256)
  expect(readFileSync(path, "utf8")).toBe("second\n")
  expect(readdirSync(directory).some((name) => name.endsWith(".tmp"))).toBe(false)
})

test("local artifact store uses create-if-absent CAS for immutable commits", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-cas-"))
  const path = join(root, "artifact-manifest.json")
  const first = writeReplayImmutableCas(path, "committed\n")
  const retry = writeReplayImmutableCas(path, "committed\n")
  expect(retry).toEqual(first)
  expect(() => writeReplayImmutableCas(path, "changed\n")).toThrow("CAS collision")
  expect(readFileSync(path, "utf8")).toBe("committed\n")
  removeReplayDurableFile(path)
  expect(existsSync(path)).toBe(false)
})

test("local Artifact Store port isolates opaque refs inside one Attempt namespace", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-port-"))
  const store = createReplayLocalArtifactStore(root)
  const namespace = store.openAttempt({
    idempotency_key_hash: canonicalHash("idem-1"),
    attempt_id_hash: canonicalHash("attempt-1"),
  })
  expect(store.capability).toEqual(REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY)
  const committed = namespace.writeImmutable("result.json", "{}\n")
  expect(namespace.readRef(committed.ref).bytes.toString()).toBe("{}\n")
  expect(namespace.listNames()).toEqual(["result.json"])
  expect(() => namespace.readRef(join(root, "outside.json"))).toThrow("outside the Attempt namespace")
  const outside = join(root, "outside.json")
  writeFileSync(outside, "{}\n", "utf8")
  symlinkSync(outside, namespace.fileRef("linked.json"))
  expect(() => namespace.read("linked.json")).toThrow("regular file, not a link")
})
