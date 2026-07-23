#!/usr/bin/env bun

import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  createOpenClawCodeSmokeConfig,
  OPENCLAW_SMOKE_VERSION,
} from "./lib/openclaw-code-smoke-config"

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dir, "..")
  const apiKey = readEnvironmentValue(
    resolve(repositoryRoot, ".secrets", "siliconflow.env"),
    "SILICONFLOW_API_KEY",
  )
  const root = mkdtempSync(join(tmpdir(), "trade-openclaw-code-smoke-"))
  const state = join(root, "state")
  const workspace = join(root, "workspace")
  mkdirSync(state, { recursive: true, mode: 0o700 })
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  const fixturePath = join(workspace, "fixture.txt")
  const configPath = join(root, "openclaw.json")
  writeFileSync(fixturePath, "before\n", { mode: 0o600 })
  writeFileSync(
    configPath,
    JSON.stringify(createOpenClawCodeSmokeConfig({ workspace })),
    { mode: 0o600 },
  )
  try {
    const child = Bun.spawn({
      cmd: [
        "npx",
        "--yes",
        `openclaw@${OPENCLAW_SMOKE_VERSION}`,
        "agent",
        "--local",
        "--agent",
        "rd-developer-code",
        "--session-key",
        "agent:rd-developer-code:trade-code-smoke",
        "--message",
        [
          "Use the file tools to inspect fixture.txt.",
          "Replace its entire content with exactly: after",
          "Do not create or modify any other file.",
          "Finish only after the file edit succeeds.",
        ].join(" "),
        "--thinking",
        "high",
        "--timeout",
        "600",
        "--json",
      ],
      cwd: repositoryRoot,
      env: {
        ...sanitizedEnvironment(),
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: state,
        OPENCLAW_DISABLE_BONJOUR: "1",
        SILICONFLOW_API_KEY: apiKey,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      readBounded(child.stdout, 8 * 1024 * 1024, () => child.kill("SIGKILL")),
      readBounded(child.stderr, 2 * 1024 * 1024, () => child.kill("SIGKILL")),
      child.exited,
    ])
    if (exitCode !== 0) {
      throw new Error(
        `OpenClaw code smoke failed: ${safeFailureClass(stderr.toString())}`,
      )
    }
    JSON.parse(stdout.toString())
    const content = readFileSync(fixturePath, "utf8")
    const entries = readdirSync(workspace)
    if (content !== "after\n" && content !== "after") {
      throw new Error("OpenClaw code smoke did not apply the requested edit")
    }
    if (entries.length !== 1 || entries[0] !== "fixture.txt") {
      throw new Error("OpenClaw code smoke widened its workspace effect")
    }
    console.log(JSON.stringify({
      schema_version: "trade.openclaw-developer-code-smoke.v1",
      status: "passed",
      openclaw_version: OPENCLAW_SMOKE_VERSION,
      model: "siliconflow/Qwen/Qwen3.5-27B",
      exact_file_effect: true,
      undeclared_files_created: false,
      trading_authority: false,
    }))
  } finally {
    rmSync(root, { recursive: true, force: true })
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

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  overflow: () => void,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximum) {
      overflow()
      throw new Error("OpenClaw code smoke output exceeded byte limit")
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function sanitizedEnvironment(): Record<string, string> {
  const allowed = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE"]
  return Object.fromEntries(
    allowed.flatMap((name) =>
      process.env[name] ? [[name, process.env[name]!]] : []),
  )
}

function safeFailureClass(stderr: string): string {
  if (/429|rate.?limit/i.test(stderr)) return "rate_limited"
  if (/401|403|unauthor|forbidden/i.test(stderr)) return "provider_auth"
  if (/timeout|timed out/i.test(stderr)) return "timeout"
  return "agent_failed"
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
