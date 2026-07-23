#!/usr/bin/env bun

import { runCandidateReleasePackageCli } from "./lib/candidate-release-package-cli"

if (import.meta.main) {
  try {
    runCandidateReleasePackageCli("strategy_source", Bun.argv.slice(2))
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    process.exit(1)
  }
}
