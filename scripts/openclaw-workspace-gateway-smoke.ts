#!/usr/bin/env bun

import { randomBytes } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import {
  buildAgentRunRequest,
} from "../modules/contracts/agent-run-contract/src/agent-run-contract"
import {
  readAgentArtifact,
  writeAgentTextArtifact,
} from "../modules/orchestration-ops/agent-artifact-store/src/lib/agent-artifact-store"
import {
  createDeveloperWorkspaceOpenClawHost,
} from "../modules/orchestration-ops/agent-host-openclaw/src/lib/developer-workspace-openclaw-host"
import {
  executeOpenClawGatewayHttp,
} from "../modules/orchestration-ops/agent-host-openclaw/src/lib/openclaw-gateway-http-executor"
import {
  runIsolatedAgentWorkspacePackageCheck,
  startIsolatedAgentWorkspaceChecker,
} from "../modules/orchestration-ops/agent-workspace-manager/src/lib/isolated-package-checker"
import {
  createAgentWorkspaceExecutionScope,
} from "../modules/orchestration-ops/agent-workspace-manager/src/lib/workspace-manager"
import { ensureAgentRunStoreSchema } from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-run-store"
import {
  readAgentWorkspaceExecutionScope,
  registerAgentWorkspaceExecutionScope,
} from "../modules/orchestration-ops/ops-runtime-store/src/lib/agent-workspace-scope-store"
import {
  createOpenClawCodeSmokeConfig,
  OPENCLAW_SMOKE_VERSION,
} from "./lib/openclaw-code-smoke-config"

async function main(): Promise<void> {
  const repositoryRoot = join(import.meta.dir, "..")
  const apiKey = readEnvironmentValue(
    join(repositoryRoot, ".secrets", "siliconflow.env"),
    "SILICONFLOW_API_KEY",
  )
  const root = mkdtempSync(join(tmpdir(), "trade-openclaw-gateway-smoke-"))
  const repo = join(root, "repo")
  const state = join(root, "state")
  const active = join(repo, "tmp", "agent-workspace-slots", "active")
  const checkerSocket = join(root, "checker.sock")
  const configPath = join(root, "openclaw.json")
  const token = randomBytes(32).toString("hex")
  const port = await availablePort()
  mkdirSync(join(repo, "modules", "sample"), { recursive: true })
  mkdirSync(state, { recursive: true, mode: 0o700 })
  writeFileSync(join(repo, ".gitignore"), "data/\ntmp/\n")
  writeFileSync(
    join(repo, "modules", "sample", "index.ts"),
    "export const value = 1\n",
  )
  writeFileSync(
    join(repo, "modules", "sample", "package.json"),
    JSON.stringify({
      name: "sample",
      private: true,
      scripts: { check: "bun -e \"process.exit(0)\"" },
    }),
  )
  git(repo, ["init"])
  git(repo, ["config", "user.email", "gateway-smoke@example.invalid"])
  git(repo, ["config", "user.name", "Gateway Smoke"])
  git(repo, ["add", "."])
  git(repo, ["commit", "-m", "fixture"])
  writeFileSync(
    configPath,
    JSON.stringify(createOpenClawCodeSmokeConfig({
      workspace: active,
      gateway_port: port,
    })),
    { mode: 0o600 },
  )
  const gateway = Bun.spawn({
    cmd: [
      "npx",
      "--yes",
      `openclaw@${OPENCLAW_SMOKE_VERSION}`,
      "gateway",
      "run",
      "--port",
      String(port),
      "--bind",
      "loopback",
    ],
    cwd: repositoryRoot,
    env: {
      ...sanitizedEnvironment(),
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_STATE_DIR: state,
      OPENCLAW_DISABLE_BONJOUR: "1",
      OPENCLAW_GATEWAY_TOKEN: token,
      SILICONFLOW_API_KEY: apiKey,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  const db = new Database(":memory:")
  let checker: Awaited<ReturnType<typeof startIsolatedAgentWorkspaceChecker>>
    | null = null
  let host: ReturnType<typeof createDeveloperWorkspaceOpenClawHost> | null = null
  try {
    await waitForGateway(port, gateway)
    checker = await startIsolatedAgentWorkspaceChecker({
      socket_path: checkerSocket,
      workspace_root: active,
    })
    ensureAgentRunStoreSchema(db)
    const instruction = writeAgentTextArtifact({
      repository_root: repo,
      storage: "temporary",
      media_type: "text/markdown",
      text: [
        "Read modules/sample/index.ts.",
        "Change only that file so it contains exactly:",
        "export const value = 2",
        "Do not create files and do not modify package.json.",
      ].join("\n"),
    })
    const context = writeAgentTextArtifact({
      repository_root: repo,
      storage: "temporary",
      media_type: "application/json",
      text: "{\"reason\":\"gateway_workspace_smoke\"}",
    })
    const request = buildAgentRunRequest({
      run_id: "openclaw-gateway-workspace-smoke",
      idempotency_key: "openclaw-gateway-workspace-smoke-key",
      trace_id: "openclaw-gateway-workspace-smoke-trace",
      task_profile: "developer",
      objective: "Complete one exact isolated fixture edit.",
      source_revision: "HEAD",
      instruction_ref: instruction,
      input_refs: [context],
      output_schema_version: "trade.fixture-developer-submission.v1",
      capabilities: [
        "owner_read",
        "research_read",
        "workspace_read",
        "workspace_patch",
        "bounded_quality_check",
      ],
      budget: {
        deadline_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        max_wall_time_ms: 8 * 60_000,
        max_turns: 16,
        max_tool_calls: 16,
        max_input_bytes: instruction.bytes + context.bytes,
        max_output_bytes: 256 * 1024,
      },
      data_classification: "project_internal",
    })
    const scope = createAgentWorkspaceExecutionScope({
      run_id: request.run_id,
      request_hash: request.request_hash,
      source_revision: request.source_revision,
      allowed_write_prefixes: ["modules/sample"],
      package_paths: ["modules/sample"],
      issued_at: new Date().toISOString(),
    })
    registerAgentWorkspaceExecutionScope(db, {
      scope,
      registered_at: scope.issued_at,
    })
    host = createDeveloperWorkspaceOpenClawHost({
      db,
      repository_root: repo,
      resolve_scope: async (run) => {
        const stored = readAgentWorkspaceExecutionScope(db, run.run_id)
        if (!stored) throw new Error("workspace scope disappeared")
        return stored.scope as unknown as typeof scope
      },
      build_submission: ({ request: run, evidence, created_at }) => ({
        schema_version: "trade.fixture-developer-submission.v1",
        run_id: run.run_id,
        patch_ref: evidence.patch_ref,
        quality_check_refs: evidence.quality_check_refs,
        created_at,
        domain_authority: "none",
      }),
      execute: (executionRequest, signal) =>
        executeOpenClawGatewayHttp({
          gateway_url: `http://127.0.0.1:${port}`,
          gateway_token: token,
          request: executionRequest,
          signal,
        }),
      run_package_check: (check) =>
        runIsolatedAgentWorkspacePackageCheck({
          socket_path: checkerSocket,
          ...check,
        }),
    })
    await host.submit(request)
    const result = await waitForResult(host, request.run_id)
    if (result.status !== "completed" || result.output_refs.length !== 3) {
      throw new Error("Gateway workspace smoke did not complete with exact evidence")
    }
    const patch = readAgentArtifact(repo, result.output_refs[1]!).text
    if (!patch.includes("export const value = 2")
      || patch.includes("package.json")) {
      throw new Error("Gateway workspace smoke patch drifted")
    }
    if (existsSync(active)) {
      throw new Error("Gateway workspace smoke did not clean its fixed slot")
    }
    console.log(JSON.stringify({
      schema_version: "trade.openclaw-workspace-gateway-smoke.v1",
      status: "passed",
      openclaw_version: OPENCLAW_SMOKE_VERSION,
      model: "siliconflow/Qwen/Qwen3.5-27B",
      gateway_transport: true,
      immutable_scope_registry: true,
      isolated_package_checker: true,
      host_derived_evidence_refs: 3,
      fixed_slot_cleaned: true,
      trading_authority: false,
    }))
  } finally {
    await host?.close()
    await checker?.close()
    db.close()
    gateway.kill("SIGTERM")
    await Promise.race([
      gateway.exited,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ])
    if (!gateway.killed) gateway.kill("SIGKILL")
    rmSync(root, { recursive: true, force: true })
  }
}

async function waitForGateway(
  port: number,
  process: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode != null) {
      throw new Error("OpenClaw Gateway exited before readiness")
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`)
      if (response.ok) return
    } catch {
      // Bounded startup polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("OpenClaw Gateway did not become ready")
}

async function waitForResult(
  host: ReturnType<typeof createDeveloperWorkspaceOpenClawHost>,
  runId: string,
) {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const result = await host.result(runId)
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Gateway workspace Agent Run did not finish")
}

async function availablePort(): Promise<number> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  })
  const port = server.port
  await server.stop(true)
  return port
}

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `git ${args[0]} failed`)
  }
}

function readEnvironmentValue(path: string, name: string): string {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${name}=`))
  const value = line?.slice(name.length + 1).trim() ?? ""
  if (value.length < 20 || /\s/.test(value)) {
    throw new Error(`${name} is missing or invalid`)
  }
  return value
}

function sanitizedEnvironment(): Record<string, string> {
  const allowed = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE"]
  return Object.fromEntries(
    allowed.flatMap((name) =>
      process.env[name] ? [[name, process.env[name]!]] : []),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
