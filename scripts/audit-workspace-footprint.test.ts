import { expect, test } from "bun:test"
import { classifyWorkspacePath } from "./workspace-footprint"

test("workspace footprint keeps evidence out of automatic cleanup classes", () => {
  expect(classifyWorkspacePath("tmp/artifacts/strategy-rnd/result.json")).toBe("protected_evidence_workspace")
  expect(classifyWorkspacePath("tmp/panels/validation/input.csv")).toBe("protected_evidence_workspace")
  expect(classifyWorkspacePath("data/ohlcv.db")).toBe("durable_db")
  expect(classifyWorkspacePath("data/ohlcv/BTCUSDT/4h.csv")).toBe("durable_data")
})

test("workspace footprint separates rebuildable and external residue", () => {
  expect(classifyWorkspacePath("apps/x/target/debug/tool")).toBe("build_cache")
  expect(classifyWorkspacePath("tmp/check/final-cargo-target/debug/tool")).toBe("build_cache")
  expect(classifyWorkspacePath("tmp/test/run.db")).toBe("test_residue")
  expect(classifyWorkspacePath("tmp/upstream-source-audit-20260722/repo/.git/config")).toBe("external_audit_clone")
  expect(classifyWorkspacePath("node_modules/typescript/lib/typescript.js")).toBe("dependency_cache")
})
