#!/usr/bin/env bun

import {
  loadReplayProfileEvidenceManifest,
  findReplayCertificationRepoRoot,
} from "../lib/replay-certification"
import {
  loadReplayCrossProcessReproducibilityBundle,
  runReplayCrossProcessReproducibilityBundle,
} from "../lib/replay-cross-process-reproducibility"

const repoRoot = findReplayCertificationRepoRoot()
const receipt = await runReplayCrossProcessReproducibilityBundle(
  loadReplayCrossProcessReproducibilityBundle(repoRoot),
  loadReplayProfileEvidenceManifest(repoRoot),
  repoRoot,
)
process.stdout.write(`${JSON.stringify(receipt)}\n`)
