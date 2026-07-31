#!/usr/bin/env bun

import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { runCodexStdioProbe } from "../lib/codex-stdio-probe"

const root = repoRoot()
const codexPath = requiredArg(process.argv.slice(2), "--codex")
const result = await runCodexStdioProbe({
  codex_path: resolve(codexPath),
  cwd: root,
})
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

function requiredArg(argv: string[], name: string): string {
  const index = argv.indexOf(name)
  const value = index < 0 ? undefined : argv[index + 1]
  if (!value) throw new Error(`${name} is required`)
  return value
}
