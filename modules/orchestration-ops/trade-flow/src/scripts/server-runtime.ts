#!/usr/bin/env bun

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { parseServerRuntimeProfile, serverRuntimeProfileHash } from "./lib/server-runtime-profile"
import { renderServerRuntimeSystemd } from "./lib/server-runtime-systemd"

export interface ServerRuntimeArgs {
  action: "validate" | "render-systemd"
  profile: string
  releaseRoot: string
  bunPath: string
  outputDir: string
}

export function parseArgs(argv: string[], root = repoRoot()): ServerRuntimeArgs {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith("--") || value == null) throw new Error(`incomplete argument: ${name ?? "<missing>"}`)
    const field = name.slice(2)
    if (!["action", "profile", "release-root", "bun-path", "output-dir"].includes(field)) throw new Error(`unknown argument: ${name}`)
    if (field in values) throw new Error(`duplicate argument: ${name}`)
    values[field] = value
  }
  const action = values.action
  if (action !== "validate" && action !== "render-systemd") throw new Error("action must be validate or render-systemd")
  const outputDir = values["output-dir"] ?? "tmp/server-runtime/systemd"
  if (action === "render-systemd") assertProjectRuntimePath(outputDir)
  return {
    action,
    profile: values.profile ?? "profile/server-runtime.json",
    releaseRoot: values["release-root"] ?? root,
    bunPath: values["bun-path"] ?? process.execPath,
    outputDir,
  }
}

export function runServerRuntimeOperation(args: ServerRuntimeArgs, root = repoRoot()): Record<string, unknown> {
  const profilePath = repositoryProfilePath(root, args.profile)
  const profile = parseServerRuntimeProfile(JSON.parse(readFileSync(profilePath, "utf8")))
  const profileHash = serverRuntimeProfileHash(profile)
  if (args.action === "validate") {
    return {
      schema_version: "trade.server-runtime-operation.v1",
      ok: true,
      action: args.action,
      profile_id: profile.profile_id,
      deployment_id: profile.deployment_id,
      profile_hash: profileHash,
      process_authority: "systemd",
      safety: profile.safety,
    }
  }
  const rendered = renderServerRuntimeSystemd(profile, args.releaseRoot, args.bunPath)
  const outputDirectory = resolve(root, args.outputDir)
  mkdirSync(outputDirectory, { recursive: true })
  const unitRefs: string[] = []
  for (const [name, content] of Object.entries(rendered.units).sort(([left], [right]) => left.localeCompare(right))) {
    const target = resolve(outputDirectory, name)
    const temporary = `${target}.tmp.${process.pid}`
    writeFileSync(temporary, content, { mode: 0o600 })
    renameSync(temporary, target)
    unitRefs.push(repoRef(root, target))
  }
  return {
    schema_version: "trade.server-runtime-operation.v1",
    ok: true,
    action: args.action,
    profile_id: rendered.profile_id,
    deployment_id: rendered.deployment_id,
    profile_hash: rendered.profile_hash,
    process_authority: rendered.process_authority,
    readiness_claim: rendered.readiness_claim,
    unit_refs: unitRefs,
    installed: false,
    started: false,
  }
}

function repositoryProfilePath(root: string, ref: string): string {
  const path = resolve(root, ref)
  const normalized = repoRef(root, path)
  if (!(normalized === "profile/server-runtime.json" || normalized.startsWith("profile/server-runtime-"))) {
    throw new Error("server runtime profile must stay under profile/server-runtime*.json")
  }
  return path
}

function repoRef(root: string, path: string): string {
  const ref = relative(root, path).replaceAll("\\", "/")
  if (!ref || ref.startsWith("../") || ref === "..") throw new Error("server runtime path escaped repository")
  return ref
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    process.stdout.write(`${JSON.stringify(runServerRuntimeOperation(parseArgs(process.argv.slice(2))), null, 2)}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema_version: "trade.server-runtime-operation.v1",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`)
    process.exitCode = 1
  }
}
