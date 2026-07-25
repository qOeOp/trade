import { createHash } from "node:crypto"
import { lstatSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  readRememberedReplayDurableParentValidation,
  readReplayDurableParentValidationReceipt,
  rememberReplayDurableParentValidation,
} from "./replay-durable-parent-validation-receipt"
import type { ReplayWorkerV10SuccessorExecutionContractRegistryInput, ReplayWorkerV10SuccessorExecutionParentSnapshot } from "./replay-worker-v10-successor-execution-contract-types"
import { readReplayWorkerV10SuccessorExecutionStdioProbe } from "./replay-worker-v10-successor-execution-stdio-probe-registry"
import { readReplayWorkerV10SuccessorExecutionTransport } from "./replay-worker-v10-successor-execution-transport-registry"
import { readReplayRegularFile, readReplayRegularFileIfExists } from "./replay-regular-file"

export function readReplayWorkerV10SuccessorExecutionParent(
  input: ReplayWorkerV10SuccessorExecutionContractRegistryInput,
): ReplayWorkerV10SuccessorExecutionParentSnapshot {
  requireReferenceInput(input)
  const expected = input.source_successor_execution_stdio_probe_admission
  const registryRoot = resolve(input.registry_root)
  const rootStat = lstatSync(registryRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("successor execution Contract registry root must be a real directory")
  }
  const path = join(registryRoot,
    `worker-v10-successor-execution-stdio-probe-${expected.admission_key}.json`)
  const snapshot = readReplayRegularFileIfExists(
    path,
    "successor execution Contract R4.146 parent reference",
  )
  if (!snapshot) {
    throw new Error("successor execution Contract requires its durable R4.146 parent reference")
  }
  assertRootIdentity(registryRoot, rootStat.dev, rootStat.ino)
  const bytes = snapshot.bytes
  const content = bytes.toString("utf8")
  const fileSha256 = createHash("sha256").update(bytes).digest("hex")
  const receipt = readReplayDurableParentValidationReceipt({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
    parent_key: expected.admission_key,
  })
  if (!receipt || receipt.parent_self_hash !== expected.admission_hash
      || receipt.parent_canonical_file_sha256 !== fileSha256) {
    throw new Error("successor execution Contract requires an exact durable parent validation receipt")
  }
  const cacheKey = `${path}\u0000${fileSha256}`
  const cached = readRememberedReplayDurableParentValidation<
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  >({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
    parent_key: expected.admission_key,
    parent_canonical_file_sha256: fileSha256,
  })
  if (cached) {
    if (cached.admission_key !== expected.admission_key
        || cached.admission_hash !== expected.admission_hash) {
      throw new Error("successor execution Contract R4.146 cached parent key or hash drift")
    }
    return {
      registry_root: input.registry_root,
      registry_root_device: rootStat.dev,
      registry_root_inode: rootStat.ino,
      source: cached,
      file_sha256: fileSha256,
      cache_key: cacheKey,
    }
  }
  const durable = readAuthoritativeParent(input.registry_root, expected)
  if (durable.admission_key !== expected.admission_key
      || durable.admission_hash !== expected.admission_hash
      || content !== `${canonicalJson(durable)}\n`) {
    throw new Error("successor execution Contract R4.146 direct parent key or hash drift")
  }
  return {
    registry_root: input.registry_root,
    registry_root_device: rootStat.dev,
    registry_root_inode: rootStat.ino,
    source: durable,
    file_sha256: fileSha256,
    cache_key: cacheKey,
  }
}

export function rememberReplayWorkerV10SuccessorExecutionParent(
  parent: ReplayWorkerV10SuccessorExecutionParentSnapshot,
): void {
  const registryRoot = resolve(parent.registry_root)
  const rootStat = lstatSync(registryRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
      || rootStat.dev !== parent.registry_root_device
      || rootStat.ino !== parent.registry_root_inode) {
    throw new Error("successor execution Contract parent registry root changed before validation")
  }
  const path = join(registryRoot,
    `worker-v10-successor-execution-stdio-probe-${parent.source.admission_key}.json`)
  const bytes = readReplayRegularFile(
    path,
    "successor execution Contract R4.146 parent reference",
  ).bytes
  assertRootIdentity(registryRoot, rootStat.dev, rootStat.ino)
  const fileSha256 = createHash("sha256").update(bytes).digest("hex")
  if (fileSha256 !== parent.file_sha256
      || bytes.toString("utf8") !== `${canonicalJson(parent.source)}\n`) {
    throw new Error("successor execution Contract parent changed before validation")
  }
  const receipt = readReplayDurableParentValidationReceipt({
    registry_root: parent.registry_root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
    parent_key: parent.source.admission_key,
  })
  if (!receipt || receipt.parent_self_hash !== parent.source.admission_hash
      || receipt.parent_canonical_file_sha256 !== fileSha256) {
    throw new Error("successor execution Contract parent receipt changed before validation")
  }
  const authoritative = readAuthoritativeParent(parent.registry_root, parent.source)
  if (canonicalJson(authoritative) !== canonicalJson(parent.source)) {
    throw new Error("successor execution Contract parent is not authoritative")
  }
  rememberReplayDurableParentValidation({
    registry_root: parent.registry_root,
    parent_kind: "worker_v10_successor_execution_stdio_probe_admission",
    parent_key: parent.source.admission_key,
    parent_canonical_file_sha256: parent.file_sha256,
    value: parent.source,
  })
}

function readAuthoritativeParent(
  registryRoot: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  const transport = findSourceTransport(registryRoot, expected)
  const authoritativeTransport = readReplayWorkerV10SuccessorExecutionTransport({
    registry_root: registryRoot,
    source_successor_execution_envelope_admission:
      transport.source_successor_execution_envelope_admission,
  })
  if (!authoritativeTransport
      || canonicalJson(authoritativeTransport) !== canonicalJson(transport)) {
    throw new Error("successor execution Contract requires its authoritative R4.145 parent chain")
  }
  const durable = readReplayWorkerV10SuccessorExecutionStdioProbe({
    registry_root: registryRoot,
    source_successor_execution_transport_admission: authoritativeTransport,
  })
  if (!durable) {
    throw new Error("successor execution Contract requires its authoritative R4.146 parent chain")
  }
  return durable
}

function findSourceTransport(
  registryRoot: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  const prefix = "worker-v10-successor-execution-transport-"
  const matches = readdirSync(resolve(registryRoot), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink()
      && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
    .map((entry) => {
      const content = readReplayRegularFile(
        join(resolve(registryRoot), entry.name),
        "successor execution Contract R4.145 source parent",
      ).bytes.toString("utf8")
      const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission
      assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission(value)
      if (content !== `${canonicalJson(value)}\n`) {
        throw new Error("successor execution Contract R4.145 source parent is not canonical")
      }
      return value
    })
    .filter((value) =>
      value.admission_hash === expected.source_successor_execution_transport_admission_hash)
  if (matches.length !== 1) {
    throw new Error("successor execution Contract requires one authoritative R4.145 source parent")
  }
  return matches[0]
}

function assertRootIdentity(root: string, device: number, inode: number): void {
  const stat = lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()
      || stat.dev !== device || stat.ino !== inode) {
    throw new Error("successor execution Contract registry root changed while reading")
  }
}

function requireReferenceInput(input: ReplayWorkerV10SuccessorExecutionContractRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Contract registry root is required")
  }
  const source = input.source_successor_execution_stdio_probe_admission
  if (typeof source?.admission_key !== "string" || !/^[a-f0-9]{64}$/.test(source.admission_key)
      || typeof source.admission_hash !== "string"
      || !/^[a-f0-9]{64}$/.test(source.admission_hash)) {
    throw new Error("successor execution Contract R4.146 parent reference is invalid")
  }
}
