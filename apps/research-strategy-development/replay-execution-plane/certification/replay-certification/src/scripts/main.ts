#!/usr/bin/env bun

import {
  assertReplayCertificationManifest,
  findReplayCertificationRepoRoot,
  loadReplayCertificationManifest,
  runReplayCertification,
  type ReplayCertificationClassification,
} from "../lib/replay-certification"

const args = process.argv.slice(2)
const suiteIndex = args.indexOf("--suite")
const scope = (suiteIndex >= 0 ? args[suiteIndex + 1] : "all") as ReplayCertificationClassification | "all"
if (scope !== "all" && scope !== "canonical" && scope !== "compatibility") {
  throw new Error("--suite must be canonical, compatibility, or all")
}
const repoRoot = findReplayCertificationRepoRoot()
const manifest = loadReplayCertificationManifest(repoRoot)
assertReplayCertificationManifest(manifest, repoRoot)
if (args.includes("--list")) {
  const suites = manifest.suites.filter((entry) => scope === "all" || entry.classification === scope)
  if (args.includes("--json")) process.stdout.write(`${JSON.stringify({ scope, suites })}\n`)
  else for (const suite of suites) process.stdout.write(`${suite.classification}\t${suite.package_path}\n`)
} else {
  await runReplayCertification(manifest, repoRoot, scope)
}
