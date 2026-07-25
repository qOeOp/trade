import { expect, test } from "bun:test"
import {
  lstatSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readReplayDurableParentValidationReceipt,
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

test("successor execution contract parent rejects self-signed direct parents and snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-contract-parent-validation-"))
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
