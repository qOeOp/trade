#!/usr/bin/env bun

import { createHash } from "node:crypto"
import {
  canonicalHash,
  canonicalJson,
} from "../../contracts/src/lib/replay-contracts"
import { createReplayLocalArtifactStore } from "../../runner/src/lib/replay-local-artifact-store"

const mode = argument("--mode")
const root = argument("--root")
if (mode !== "crash-after-payload" && mode !== "recover-or-read") {
  throw new Error("publication crash member mode is invalid")
}

const store = createReplayLocalArtifactStore(root)
const namespace = store.openAttempt({
  idempotency_key_hash: canonicalHash("m5-publication-crash-probe-idempotency"),
  attempt_id_hash: canonicalHash("m5-publication-crash-probe-attempt"),
})
const payloads = [
  { role: "result", name: "result.json", value: {
    fixture: "m5-publication-crash-probe", result_hash: canonicalHash("result"),
  } },
  { role: "fills", name: "fills.json", value: [
    { fill_id: "fill-1", quantity: "1", price: "100" },
  ] },
  { role: "ledger", name: "ledger.json", value: [
    { entry_id: "ledger-1", amount: "-100", kind: "position_open" },
  ] },
] as const
const manifestName = "artifact-manifest.json"

if (mode === "crash-after-payload") {
  for (const payload of payloads) {
    namespace.writeImmutable(payload.name, encode(payload.value))
  }
  process.stdout.write(`${canonicalJson({
    schema_version: "trade.rd-replay-publication-crash-member-ready.v1",
    process_id: process.pid,
    namespace_ref: namespace.namespace_ref,
    payload_count: payloads.length,
    manifest_present: namespace.exists(manifestName),
  })}\n`)
  await new Promise<never>(() => {})
}

let idempotentRead = namespace.exists(manifestName)
if (!idempotentRead) {
  const files = payloads.map((payload) => ({
    role: payload.role,
    name: payload.name,
    ...namespace.writeImmutable(payload.name, encode(payload.value)),
  }))
  const manifest = {
    schema_version: "trade.rd-replay-publication-crash-probe.v1",
    fixture_id: "m5-publication-crash-probe",
    publication_policy: "durable-payloads-then-immutable-manifest-last",
    files,
    completeness: {
      authoritative_result: true,
      required_roles: payloads.map((payload) => payload.role),
      commit_marker: manifestName,
      partial_payload_without_manifest_is_authoritative: false,
    },
  }
  namespace.writeImmutable(manifestName, encode(manifest))
} else {
  idempotentRead = true
}

const manifestRead = namespace.read(manifestName)
const manifest = JSON.parse(new TextDecoder().decode(manifestRead.bytes)) as {
  schema_version: string
  fixture_id: string
  publication_policy: string
  files: Array<{ role: string; name: string; ref: string; sha256: string }>
  completeness: {
    authoritative_result: boolean
    required_roles: string[]
    commit_marker: string
    partial_payload_without_manifest_is_authoritative: boolean
  }
}
if (manifest.schema_version !== "trade.rd-replay-publication-crash-probe.v1"
    || manifest.fixture_id !== "m5-publication-crash-probe"
    || manifest.publication_policy !== "durable-payloads-then-immutable-manifest-last"
    || manifest.files.length !== payloads.length
    || manifest.completeness.authoritative_result !== true
    || JSON.stringify(manifest.completeness.required_roles)
      !== JSON.stringify(payloads.map((payload) => payload.role))
    || manifest.completeness.commit_marker !== manifestName
    || manifest.completeness.partial_payload_without_manifest_is_authoritative !== false) {
  throw new Error("publication crash probe manifest policy drifted")
}
for (const [index, file] of manifest.files.entries()) {
  const payload = payloads[index]!
  const read = namespace.read(file.name)
  if (file.role !== payload.role || file.name !== payload.name || file.ref !== read.ref
      || file.sha256 !== sha256(read.bytes)
      || canonicalHash(JSON.parse(new TextDecoder().decode(read.bytes)))
        !== canonicalHash(payload.value)) {
    throw new Error("publication crash probe payload binding drifted")
  }
}
if (JSON.stringify(namespace.listNames())
    !== JSON.stringify([...payloads.map((payload) => payload.name), manifestName].sort())) {
  throw new Error("publication crash probe file set drifted")
}

process.stdout.write(canonicalJson({
  schema_version: "trade.rd-replay-publication-crash-member.v1",
  process_id: process.pid,
  idempotent_read: idempotentRead,
  namespace_ref: namespace.namespace_ref,
  manifest_sha256: sha256(manifestRead.bytes),
  publication_hash: canonicalHash({ manifest, payloads: payloads.map((payload) => payload.value) }),
  file_count: namespace.listNames().length,
}))

function argument(flag: string): string {
  const index = process.argv.indexOf(flag)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`publication crash member requires ${flag}`)
  return value
}

function encode(value: unknown): string { return `${canonicalJson(value)}\n` }
function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
