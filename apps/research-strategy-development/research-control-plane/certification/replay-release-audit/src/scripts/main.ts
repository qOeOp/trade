#!/usr/bin/env bun

import {
  findReplayReleaseAuditRepoRoot,
  loadReplayIndependentReleaseAuditManifest,
  runReplayIndependentReleaseAudit,
} from "../lib/replay-independent-release-audit"

const repoRoot = findReplayReleaseAuditRepoRoot()
const receipt = await runReplayIndependentReleaseAudit(
  loadReplayIndependentReleaseAuditManifest(repoRoot),
  repoRoot,
)
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
