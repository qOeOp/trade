#!/usr/bin/env bun

import {
  errorResponse,
  printScriptResult,
  readJsonInputArgs,
  successResponse,
} from "../../../../../../contracts/runtime-core/src/script-json"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { repoRoot } from "../../../../../../contracts/runtime-core/src/paths"
import {
  bindDataSplitSegmentSnapshot,
  developerDataBindingFromSegmentSnapshot,
} from "../lib/data-split-segment-snapshot"

const SCHEMA_VERSION = "data-split.segment-snapshot-script-response.v1"

async function main(argv: string[]): Promise<void> {
  printScriptResult(await run(argv))
}

export async function run(argv: string[]): Promise<JSONRecord> {
  const previousCwd = process.cwd()
  try {
    process.chdir(repoRoot())
    const { input } = readJsonInputArgs(argv, printHelp)
    const snapshot = await bindDataSplitSegmentSnapshot({
      report_path: stringField(input.report_path, "report_path"),
      dataset_id: stringField(input.dataset_id, "dataset_id"),
      segment: segmentField(input.segment),
      timeframe: stringField(input.timeframe, "timeframe"),
    })
    const exchange = optionalString(input.exchange)
    const datasetKindsSupplied = input.dataset_kinds !== undefined
    if (Boolean(exchange) !== datasetKindsSupplied) {
      throw new Error("exchange and dataset_kinds must be supplied together")
    }
    const dataSnapshotBinding = exchange
      ? developerDataBindingFromSegmentSnapshot({
          snapshot,
          exchange,
          dataset_kinds: stringArray(input.dataset_kinds, "dataset_kinds"),
          evidence_ref: optionalString(input.evidence_ref) || undefined,
        })
      : null
    return successResponse(SCHEMA_VERSION, {
      snapshot,
      data_snapshot_binding: dataSnapshotBinding,
    })
  } catch (error) {
    return errorResponse(SCHEMA_VERSION, error)
  } finally {
    process.chdir(previousCwd)
  }
}

function segmentField(value: unknown): "discovery" | "validation" {
  if (value !== "discovery" && value !== "validation") {
    throw new Error("segment must be discovery or validation")
  }
  return value
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0
      || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be a non-empty string array`)
  }
  return value.map((item) => (item as string).trim())
}

function printHelp(): void {
  console.log("Usage: bun src/scripts/segment-snapshot.ts --json '<report/dataset/segment/timeframe payload; add exchange + dataset_kinds to emit Developer binding>'")
}

if (import.meta.main) {
  await main(process.argv.slice(2))
}
