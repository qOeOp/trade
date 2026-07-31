#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs"
import { runStrategyRndLoop } from "../../../../agent-roles/developer/rd-loop-runner/src/lib/rd-loop-runner"
import { strategyRndLoopInputFromJson } from "../../../../agent-roles/developer/candidate-batch-engine/src/lib/strategy-rnd-inputs"
import { executePlannedResearchWithControlPlane } from "../lib/rd-supervisor-runner"

type JSONRecord = Record<string, unknown>

interface MemberInput {
  db_path: string
  manifest_path: string
  artifact_root: string
  catalog_db_path: string
  marker_path: string
  hold_after_commit: boolean
  payload: JSONRecord
}

const inputPath = Bun.argv[2]
if (!inputPath) throw new Error("kill/restart member requires an input path")
const input = JSON.parse(readFileSync(inputPath, "utf8")) as MemberInput
const result = executePlannedResearchWithControlPlane(
  "research.rd-loop-runner",
  {
    ...input.payload,
    manifest_path: input.manifest_path,
    artifact_root: input.artifact_root,
    catalog_db_path: input.catalog_db_path,
  },
  {
    runLoop: (payload) =>
      runStrategyRndLoop(strategyRndLoopInputFromJson(payload)) as unknown as JSONRecord,
    runCampaign: () => {
      throw new Error("kill/restart member must not run a campaign")
    },
  },
  input.db_path,
)

writeFileSync(input.marker_path, JSON.stringify(result), { flag: "wx" })
process.stdout.write(`${JSON.stringify(result)}\n`)
if (input.hold_after_commit) await Bun.sleep(30_000)
