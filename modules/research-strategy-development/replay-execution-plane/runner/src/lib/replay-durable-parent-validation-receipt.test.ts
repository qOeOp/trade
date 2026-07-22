import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  readReplayDurableParentValidationReceipt,
  registerReplayDurableParentValidationReceipt,
} from "./replay-durable-parent-validation-receipt"

test("durable parent validation receipt binds self hash and canonical file bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-parent-validation-"))
  const input = {
    registry_root: root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission" as const,
    parent_key: "a".repeat(64),
    parent_self_hash: "b".repeat(64),
    parent_canonical_content: '{"admission_hash":"' + "b".repeat(64) + '"}\n',
  }
  try {
    const receipt = registerReplayDurableParentValidationReceipt(input)
    expect(receipt.parent_key).toBe(input.parent_key)
    expect(receipt.parent_self_hash).toBe(input.parent_self_hash)
    expect(readReplayDurableParentValidationReceipt(input)).toEqual(receipt)
    expect(registerReplayDurableParentValidationReceipt(input)).toEqual(receipt)
    expect(() => registerReplayDurableParentValidationReceipt({
      ...input,
      parent_canonical_content: '{}\n',
    })).toThrow("different evidence")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
