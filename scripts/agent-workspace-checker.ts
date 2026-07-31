#!/usr/bin/env bun

import {
  startIsolatedAgentWorkspaceChecker,
} from "../apps/orchestration-ops/agent-workspace-manager/src/lib/isolated-package-checker"

async function main(): Promise<void> {
  const input = parseArgs(Bun.argv.slice(2))
  const checker = await startIsolatedAgentWorkspaceChecker({
    socket_path: input.socket_path,
    workspace_root: input.workspace_root,
    ...(input.dependency_root == null
      ? {}
      : { dependency_root: input.dependency_root }),
    report_error: (error) => {
      console.error(JSON.stringify({
        schema_version: "trade.agent-workspace-checker-error.v1",
        error: error.name,
      }))
    },
  })
  console.log(JSON.stringify({
    schema_version: "trade.agent-workspace-checker-start.v1",
    status: "ready",
    socket_path: checker.socket_path,
  }))
  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    void checker.close().finally(() => process.exit(0))
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

function parseArgs(argv: string[]): {
  socket_path: string
  workspace_root: string
  dependency_root: string | null
} {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) {
      throw new Error("Agent workspace checker arguments must be --key value pairs")
    }
    values.set(flag.slice(2), value)
  }
  return {
    socket_path: absolutePath(
      values.get("socket-path") ?? "/control/checker.sock",
      "socket_path",
    ),
    workspace_root: absolutePath(
      values.get("workspace-root") ?? "/workspace/active",
      "workspace_root",
    ),
    dependency_root: values.has("dependency-root")
      ? absolutePath(values.get("dependency-root")!, "dependency_root")
      : null,
  }
}

function absolutePath(value: string, field: string): string {
  if (!value.startsWith("/") || value.includes("\0") || value.length > 512) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
