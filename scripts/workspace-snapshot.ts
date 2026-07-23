export interface WorkspaceSnapshot {
  schema_version: "trade.workspace-snapshot.v1"
  files: Record<string, string>
}

export function diffWorkspaceSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): string[] {
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)])
  return [...paths].filter((path) => before.files[path] !== after.files[path]).sort()
}
