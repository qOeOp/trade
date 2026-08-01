#!/usr/bin/env bun

import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"

const repoRootResult = Bun.spawnSync({
  cmd: ["git", "rev-parse", "--show-toplevel"],
  stdout: "pipe",
  stderr: "pipe",
})
if (repoRootResult.exitCode !== 0) {
  throw new Error(`unable to resolve repository root: ${repoRootResult.stderr.toString()}`)
}
const repoRoot = repoRootResult.stdout.toString().trim()

interface SecretPattern {
  name: string
  pattern: RegExp
}

const patterns: SecretPattern[] = [
  {
    name: "provider-style sk token",
    pattern: /(?:^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{32,}(?=$|[^A-Za-z0-9_-])/,
  },
  {
    name: "non-empty SiliconFlow environment assignment",
    pattern: /SILICONFLOW_API_KEY\s*=\s*["']?[^\s"'#]{16,}/,
  },
  {
    name: "literal bearer credential",
    pattern: /authorization\s*[:=]\s*["']?bearer\s+[A-Za-z0-9._~-]{24,}/i,
  },
]

const candidates = Bun.spawnSync({
  cmd: ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  cwd: repoRoot,
  stdout: "pipe",
  stderr: "pipe",
})
if (candidates.exitCode !== 0) {
  throw new Error(`unable to enumerate secret-scan candidates: ${candidates.stderr.toString()}`)
}

const findings: string[] = []
for (const path of candidates.stdout.toString().split("\0").filter(Boolean)) {
  let stats
  try {
    stats = statSync(resolve(repoRoot, path))
  } catch {
    continue
  }
  if (!stats.isFile() || stats.size > 2_000_000) continue
  const content = readFileSync(resolve(repoRoot, path))
  if (content.includes(0)) continue
  const lines = content.toString("utf8").split(/\r?\n/)
  for (const [lineIndex, line] of lines.entries()) {
    for (const secretPattern of patterns) {
      if (secretPattern.pattern.test(line)) {
        findings.push(`${path}:${lineIndex + 1}: ${secretPattern.name}`)
      }
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`quality: possible committed or unignored credentials (values redacted):\n${findings.join("\n")}\n`)
  process.exit(1)
}

const ignoredSecretFile = Bun.spawnSync({
  cmd: ["git", "check-ignore", "-q", ".secrets/siliconflow.env"],
  cwd: repoRoot,
  stdout: "ignore",
  stderr: "ignore",
})
if (ignoredSecretFile.exitCode !== 0) {
  throw new Error(".secrets/siliconflow.env must remain ignored")
}

process.stdout.write("secret scan ok\n")
