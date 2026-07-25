import { expect, test } from "bun:test"
import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readReplayDurableParentValidationReceipt,
  readRememberedReplayDurableParentValidation,
  rememberReplayDurableParentValidation,
  registerReplayDurableParentValidationReceipt,
} from "./replay-durable-parent-validation-receipt"
import {
  readReplayWorkerV10SuccessorExecutionParent,
  rememberReplayWorkerV10SuccessorExecutionParent,
} from "./replay-worker-v10-successor-execution-contract-parent"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"

test("durable parent validation receipt binds self hash and canonical file bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-parent-validation-"))
  try {
    for (const parent_kind of [
      "worker_v10_successor_execution_transport_admission",
      "worker_v10_successor_execution_stdio_probe_admission",
    ] as const) {
      const input = {
        registry_root: root,
        parent_kind,
        parent_key: "a".repeat(64),
        parent_self_hash: "b".repeat(64),
        parent_canonical_content: '{"admission_hash":"' + "b".repeat(64) + '"}\n',
      }
      const receipt = registerReplayDurableParentValidationReceipt(input)
      expect(receipt.parent_kind).toBe(parent_kind)
      expect(receipt.parent_key).toBe(input.parent_key)
      expect(receipt.parent_self_hash).toBe(input.parent_self_hash)
      expect(readReplayDurableParentValidationReceipt(input)).toEqual(receipt)
      expect(registerReplayDurableParentValidationReceipt(input)).toEqual(receipt)
      expect(() => registerReplayDurableParentValidationReceipt({
        ...input,
        parent_canonical_content: '{}\n',
      })).toThrow("different evidence")
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("validated parent cache is bound to root, parent kind, key, and exact file bytes", () => {
  const firstRoot = mkdtempSync(join(tmpdir(), "replay-parent-cache-first-"))
  const secondRoot = mkdtempSync(join(tmpdir(), "replay-parent-cache-second-"))
  const movedRoot = `${firstRoot}-moved`
  try {
    const parentKey = "a".repeat(64)
    const fileSha256 = "b".repeat(64)
    const value = { admission_key: parentKey, admission_hash: "c".repeat(64) }
    const ancestorPath = join(firstRoot, "ancestor.json")
    const binaryPath = join(firstRoot, "ancestor.bin")
    writeFileSync(ancestorPath, "{\"status\":\"validated\"}\n", "utf8")
    writeFileSync(binaryPath, Uint8Array.of(0xff))
    rememberReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
      value,
    })
    value.admission_hash = "e".repeat(64)
    const firstRead = readRememberedReplayDurableParentValidation<typeof value>({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
    })
    expect(firstRead).toEqual({
      admission_key: parentKey,
      admission_hash: "c".repeat(64),
    })
    if (!firstRead) throw new Error("expected remembered durable parent")
    firstRead.admission_hash = "f".repeat(64)
    expect(readRememberedReplayDurableParentValidation<typeof value>({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
    })).toEqual({
      admission_key: parentKey,
      admission_hash: "c".repeat(64),
    })
    expect(readRememberedReplayDurableParentValidation({
      registry_root: secondRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
    })).toBeNull()
    expect(readRememberedReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_execution_envelope_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
    })).toBeNull()
    expect(readRememberedReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: "d".repeat(64),
    })).toBeNull()
    writeFileSync(binaryPath, Uint8Array.of(0xfe))
    expect(readRememberedReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
    })).toBeNull()
    rememberReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
      value,
    })
    writeFileSync(join(firstRoot, "new-parent-alias.json"), "{}\n", "utf8")
    expect(readRememberedReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
    })).toBeNull()
    rmSync(join(firstRoot, "new-parent-alias.json"))
    rememberReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
      value,
    })
    writeFileSync(ancestorPath, "{\"status\":\"tampered\"}\n", "utf8")
    expect(readRememberedReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
    })).toBeNull()
    rememberReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
      value,
    })
    renameSync(firstRoot, movedRoot)
    mkdirSync(firstRoot)
    expect(readRememberedReplayDurableParentValidation({
      registry_root: firstRoot,
      parent_kind: "worker_v10_successor_lease_admission",
      parent_key: parentKey,
      parent_canonical_file_sha256: fileSha256,
    })).toBeNull()
  } finally {
    rmSync(firstRoot, { recursive: true, force: true })
    rmSync(movedRoot, { recursive: true, force: true })
    rmSync(secondRoot, { recursive: true, force: true })
  }
})

test("successor execution contract parent rejects self-signed direct parents and snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-contract-parent-cache-"))
  try {
    const parentKey = "a".repeat(64)
    const parentHash = "b".repeat(64)
    const source = {
      admission_key: parentKey,
      admission_hash: parentHash,
      nested: { trusted: true },
    }
    const content = `${canonicalJson(source)}\n`
    writeFileSync(
      join(root, `worker-v10-successor-execution-stdio-probe-${parentKey}.json`),
      content,
      "utf8",
    )
    const receipt = registerReplayDurableParentValidationReceipt({
      registry_root: root,
      parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
      parent_key: parentKey,
      parent_self_hash: parentHash,
      parent_canonical_content: content,
    })
    const input = {
      registry_root: root,
      source_successor_execution_stdio_probe_admission: source,
    }
    expect(() => readReplayWorkerV10SuccessorExecutionParent(input as never))
      .toThrow("requires one authoritative R4.145 source parent")
    const rootStat = lstatSync(root)
    const snapshot = {
      registry_root: root,
      registry_root_device: rootStat.dev,
      registry_root_inode: rootStat.ino,
      source: structuredClone(source),
      file_sha256: receipt.parent_canonical_file_sha256,
      cache_key: "unused-by-shared-cache",
    }
    const tamperedBeforeRemember = structuredClone(snapshot)
    ;(tamperedBeforeRemember.source as unknown as { nested: { trusted: boolean } })
      .nested.trusted = false
    expect(() => rememberReplayWorkerV10SuccessorExecutionParent(tamperedBeforeRemember as never))
      .toThrow("parent changed before validation")
    expect(() => rememberReplayWorkerV10SuccessorExecutionParent(snapshot as never))
      .toThrow("requires one authoritative R4.145 source parent")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
