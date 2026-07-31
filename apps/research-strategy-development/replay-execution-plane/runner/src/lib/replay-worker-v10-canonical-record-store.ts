import { existsSync, lstatSync, readFileSync } from "node:fs"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export function persistReplayWorkerV10CanonicalRecord<T>(
  path: string,
  expected: T,
  label: string,
  driftMessage: string,
  assertValue: (value: T) => void,
): T {
  const existing = readReplayWorkerV10CanonicalRecord(path, label, assertValue)
  if (existing) return requireSameReplayWorkerV10CanonicalRecord(existing, expected, driftMessage)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readReplayWorkerV10CanonicalRecord(path, label, assertValue)
    if (winner) return requireSameReplayWorkerV10CanonicalRecord(winner, expected, driftMessage)
    throw error
  }
  return parseCanonicalRecord(content, label, assertValue)
}

export function readReplayWorkerV10CanonicalRecord<T>(
  path: string,
  label: string,
  assertValue: (value: T) => void,
): T | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`)
  return parseCanonicalRecord(readFileSync(path, "utf8"), label, assertValue)
}

export function requireSameReplayWorkerV10CanonicalRecord<T>(
  existing: T,
  expected: T,
  message: string,
): T {
  if (canonicalJson(existing) !== canonicalJson(expected)) throw new Error(message)
  return existing
}

function parseCanonicalRecord<T>(
  content: string,
  label: string,
  assertValue: (value: T) => void,
): T {
  const value = JSON.parse(content) as T
  assertValue(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error(`${label} is not canonical`)
  return value
}
