export type FootprintClass =
  | "durable_db"
  | "durable_data"
  | "protected_evidence_workspace"
  | "test_residue"
  | "build_cache"
  | "dependency_cache"
  | "external_audit_clone"
  | "ephemeral_other"

export function classifyWorkspacePath(path: string): FootprintClass {
  const normalized = path.replaceAll("\\", "/")
  if (/^data\/.*\.(db|db-shm|db-wal|sqlite|sqlite3)$/.test(normalized)) return "durable_db"
  if (normalized.startsWith("data/")) return "durable_data"
  if (/^tmp\/(artifacts|panels|l2-recorder-bakeoff)(\/|$)/.test(normalized)) return "protected_evidence_workspace"
  if (/^tmp\/(test|test-runs)(\/|$)/.test(normalized)) return "test_residue"
  if (normalized.startsWith("tmp/upstream-source-audit")) return "external_audit_clone"
  if (normalized.startsWith("node_modules/") || normalized.includes("/node_modules/") || normalized.startsWith("tmp/skill-validator-venv/")) return "dependency_cache"
  if (normalized.includes("/target/") || /^tmp\/check\/(final-)?cargo-target\//.test(normalized)) return "build_cache"
  if (normalized.startsWith("tmp/check/")) return "test_residue"
  return "ephemeral_other"
}
