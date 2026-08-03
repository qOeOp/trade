#!/usr/bin/env bun

import { createHash } from "node:crypto"

const INPUT_SCHEMA = "mission-evaluator-packet-input/v1"
const OUTPUT_SCHEMA = "mission-evaluator-packet-set/v1"
const SHARED_CORE_SCHEMA = "mission-evaluator-shared-core/v1"
const LENS_DELTA_SCHEMA = "mission-evaluator-lens-delta/v1"
const DISPATCH_SCHEMA = "mission-evaluator-dispatch/v1"
const BINDING_SCHEMA = "mission-evaluator-binding/v1"
const SCRIPT_PATH = ".agents/skills/run-bounded-mission/scripts/evaluator-packet.ts"
const BINDING_PATH = ".agents/skills/run-bounded-mission/scripts/evaluator-binding.ts"
const REVIEWER_CONTRACT = ".agents/skills/run-bounded-mission/references/reviewer-handoff.md"
const ENFORCEMENT_MODES = new Set(["sandbox-enforced", "integrity-checked"])
const LENS_ORDER = ["authority_representation", "consumer_fail_close_closure"] as const

type LensName = typeof LENS_ORDER[number]

interface Arguments {
  repository: string
  origin: string
  candidate: string
  enforcement: string
  requiredFiles: string[]
}

interface LensInput {
  name: LensName
  activation_predicate: string
  required_inspected_scope: string
  required_terminal_evidence: string
  representative_refutation: string
  stop: string
}

interface PacketInput {
  schema: typeof INPUT_SCHEMA
  frame: string
  plan: string
  audit_set: "single" | "complementary_pair"
  admission: {
    planned_launch_context: string
    instruction_origin: string
    automatic_discovery_boundary: string
    parent_receipt_route: string
  }
  replay: {
    main_ci_corroboration: string
    concurrently_pending: string
    unavailable_evidence: string
  }
  lenses: LensInput[]
}

interface CommandResult {
  exitCode: number
  stdout: Uint8Array
  stderr: Uint8Array
}

class PacketRejected extends Error {}

function reject(reason: string): never {
  throw new PacketRejected(reason)
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function canonicalLine(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`)
}

function concatBytes(values: Uint8Array[]): Uint8Array {
  return Buffer.concat(values.map((value) => Buffer.from(value)))
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    reject(`${label} must be valid UTF-8`)
  }
}

function semanticString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) reject(`${field} must be a non-empty string`)
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0xd800 || code > 0xdfff) continue
    if (code > 0xdbff || index + 1 >= value.length) reject(`${field} contains an unpaired surrogate`)
    const next = value.charCodeAt(index + 1)
    if (next < 0xdc00 || next > 0xdfff) reject(`${field} contains an unpaired surrogate`)
    index += 1
  }
  return value
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    reject(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, field: string, expected: string[]): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    reject(`${field} fields must be exactly: ${expected.join(" ")}`)
  }
}

function parsePacketInput(bytes: Uint8Array): PacketInput {
  const text = decodeUtf8(bytes, "stdin")
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    reject("stdin must contain one canonical JSON LF frame")
  }
  const value = record(parsed, "input")
  exactKeys(value, "input", ["schema", "frame", "plan", "audit_set", "admission", "replay", "lenses"])
  if (value.schema !== INPUT_SCHEMA) reject(`unsupported input schema: ${String(value.schema)}`)
  if (value.audit_set !== "single" && value.audit_set !== "complementary_pair") {
    reject(`unsupported audit set: ${String(value.audit_set)}`)
  }

  const admissionValue = record(value.admission, "admission")
  exactKeys(admissionValue, "admission", [
    "planned_launch_context",
    "instruction_origin",
    "automatic_discovery_boundary",
    "parent_receipt_route",
  ])
  const replayValue = record(value.replay, "replay")
  exactKeys(replayValue, "replay", [
    "main_ci_corroboration",
    "concurrently_pending",
    "unavailable_evidence",
  ])
  if (!Array.isArray(value.lenses)) reject("lenses must be an ordered array")

  const lenses = value.lenses.map((item, index): LensInput => {
    const lens = record(item, `lenses[${index}]`)
    exactKeys(lens, `lenses[${index}]`, [
      "name",
      "activation_predicate",
      "required_inspected_scope",
      "required_terminal_evidence",
      "representative_refutation",
      "stop",
    ])
    if (!LENS_ORDER.includes(lens.name as LensName)) {
      reject(`unsupported lens: ${String(lens.name)}`)
    }
    return {
      name: lens.name as LensName,
      activation_predicate: semanticString(lens.activation_predicate, `lenses[${index}].activation_predicate`),
      required_inspected_scope: semanticString(lens.required_inspected_scope, `lenses[${index}].required_inspected_scope`),
      required_terminal_evidence: semanticString(lens.required_terminal_evidence, `lenses[${index}].required_terminal_evidence`),
      representative_refutation: semanticString(lens.representative_refutation, `lenses[${index}].representative_refutation`),
      stop: semanticString(lens.stop, `lenses[${index}].stop`),
    }
  })
  const lensNames = lenses.map((lens) => lens.name)
  if (new Set(lensNames).size !== lensNames.length) reject("duplicate lenses are not allowed")
  if (value.audit_set === "single" && lenses.length !== 1) reject("single audit set requires exactly one lens")
  if (value.audit_set === "complementary_pair"
      && JSON.stringify(lensNames) !== JSON.stringify(LENS_ORDER)) {
    reject(`complementary_pair lenses must use this order: ${LENS_ORDER.join(" ")}`)
  }

  const input: PacketInput = {
    schema: INPUT_SCHEMA,
    frame: semanticString(value.frame, "frame"),
    plan: semanticString(value.plan, "plan"),
    audit_set: value.audit_set,
    admission: {
      planned_launch_context: semanticString(admissionValue.planned_launch_context, "admission.planned_launch_context"),
      instruction_origin: semanticString(admissionValue.instruction_origin, "admission.instruction_origin"),
      automatic_discovery_boundary: semanticString(
        admissionValue.automatic_discovery_boundary,
        "admission.automatic_discovery_boundary",
      ),
      parent_receipt_route: semanticString(admissionValue.parent_receipt_route, "admission.parent_receipt_route"),
    },
    replay: {
      main_ci_corroboration: semanticString(replayValue.main_ci_corroboration, "replay.main_ci_corroboration"),
      concurrently_pending: semanticString(replayValue.concurrently_pending, "replay.concurrently_pending"),
      unavailable_evidence: semanticString(replayValue.unavailable_evidence, "replay.unavailable_evidence"),
    },
    lenses,
  }
  if (!Buffer.from(canonicalLine(input)).equals(Buffer.from(bytes))) {
    reject("stdin must contain one canonical JSON UTF-8 LF frame with fields in contract order")
  }
  return input
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>()
  const requiredFiles: string[] = []
  const singleValueFlags = new Set(["--repository", "--origin", "--candidate", "--enforcement"])

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (value === undefined) reject(`missing value for ${flag ?? "argument"}`)
    if (flag === "--required-file") {
      if (requiredFiles.includes(value)) reject(`duplicate required file: ${value}`)
      requiredFiles.push(value)
      continue
    }
    if (!singleValueFlags.has(flag)) reject(`unsupported argument: ${flag}`)
    if (values.has(flag)) reject(`duplicate argument: ${flag}`)
    values.set(flag, value)
  }

  const repository = values.get("--repository")
  const origin = values.get("--origin")
  const candidate = values.get("--candidate")
  const enforcement = values.get("--enforcement")
  if (!repository || !origin || !candidate || !enforcement || requiredFiles.length === 0) {
    reject("required arguments: --repository --origin --candidate --enforcement --required-file")
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) reject("repository must be owner/name")
  if (!ENFORCEMENT_MODES.has(enforcement)) reject("unsupported enforcement mode")
  return { repository, origin, candidate, enforcement, requiredFiles }
}

function run(cwd: string, argv: string[]): CommandResult {
  const result = Bun.spawnSync(argv, {
    cwd,
    env: {
      ...process.env,
      GIT_NO_LAZY_FETCH: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
    stderr: "pipe",
    stdout: "pipe",
  })
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
}

function commandBytes(cwd: string, argv: string[]): Uint8Array {
  const result = run(cwd, argv)
  if (result.exitCode !== 0) {
    const detail = decodeUtf8(result.stderr, `${argv[0]} stderr`).trim()
    reject(`${argv[0]} ${argv[1] ?? ""} failed${detail ? `: ${detail}` : ""}`)
  }
  return result.stdout
}

function gitText(cwd: string, args: string[]): string {
  return decodeUtf8(commandBytes(cwd, ["git", ...args]), `git ${args[0]} stdout`).trim()
}

function immutableCommit(cwd: string, value: string, label: string): string {
  const oid = gitText(cwd, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`])
  if (!/^[0-9a-f]{40}$/.test(oid)) reject(`${label} did not resolve to a full SHA-1 commit OID`)
  return oid
}

function bindingLine(cwd: string, args: Arguments): { bytes: Uint8Array; value: Record<string, unknown> } {
  const argv = [
    "bun", BINDING_PATH,
    "--repository", args.repository,
    "--origin", args.origin,
    "--candidate", args.candidate,
    "--enforcement", args.enforcement,
    ...args.requiredFiles.flatMap((path) => ["--required-file", path]),
  ]
  const result = run(cwd, argv)
  if (result.exitCode !== 0) {
    const detail = decodeUtf8(result.stdout, "binding stdout").trim()
      || decodeUtf8(result.stderr, "binding stderr").trim()
    reject(`binding helper rejected${detail ? `: ${detail}` : ""}`)
  }
  const text = decodeUtf8(result.stdout, "binding stdout")
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    reject("binding helper must emit exactly one JSON LF line")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    reject("binding helper emitted malformed JSON")
  }
  const value = record(parsed, "binding")
  exactKeys(value, "binding", [
    "schema",
    "status",
    "repository",
    "enforcement",
    "control_plane",
    "origin",
    "candidate",
    "diff",
    "required_files",
    "replay",
    "binding_fingerprint_sha256",
  ])
  if (value.schema !== BINDING_SCHEMA || value.status !== "bound") reject("binding helper did not bind")
  if (value.repository !== args.repository || value.enforcement !== args.enforcement) {
    reject("binding repository or enforcement mismatch")
  }
  const fingerprint = semanticString(value.binding_fingerprint_sha256, "binding.binding_fingerprint_sha256")
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) reject("binding fingerprint is malformed")
  const { binding_fingerprint_sha256: ignored, ...body } = value
  void ignored
  if (sha256(JSON.stringify(body)) !== fingerprint) reject("binding fingerprint mismatch")
  return { bytes: result.stdout, value }
}

async function packetHelperIdentity(cwd: string, candidate: string): Promise<Record<string, unknown>> {
  const commit = immutableCommit(cwd, candidate, "candidate")
  const oid = gitText(cwd, ["rev-parse", "--verify", "--end-of-options", `${commit}:${SCRIPT_PATH}`])
  const type = gitText(cwd, ["cat-file", "-t", oid])
  if (type !== "blob") reject(`candidate packet helper is not a blob: ${type}`)
  const candidateBytes = commandBytes(cwd, ["git", "cat-file", "blob", oid])
  const runtimeBytes = new Uint8Array(await Bun.file(import.meta.path).arrayBuffer())
  if (!Buffer.from(candidateBytes).equals(Buffer.from(runtimeBytes))) {
    reject("runtime packet helper bytes do not match candidate blob")
  }
  return {
    commit,
    path: SCRIPT_PATH,
    blob_oid: oid,
    blob_sha256: sha256(candidateBytes),
    size: candidateBytes.length,
    invocation_argv: [...Bun.argv],
  }
}

function segmentRecord(name: string, bytes: Uint8Array): Record<string, unknown> {
  return {
    name,
    encoding: "utf-8",
    size: bytes.length,
    sha256: `sha256:${sha256(bytes)}`,
  }
}

async function build(): Promise<Uint8Array> {
  const args = parseArguments(Bun.argv.slice(2))
  const inputBytes = new Uint8Array(await Bun.stdin.arrayBuffer())
  const input = parsePacketInput(inputBytes)
  const cwd = gitText(process.cwd(), ["rev-parse", "--show-toplevel"])
  const binding = bindingLine(cwd, args)
  const origin = record(binding.value.origin, "binding.origin")
  const candidate = record(binding.value.candidate, "binding.candidate")
  const controlPlane = record(binding.value.control_plane, "binding.control_plane")
  const resolvedOrigin = immutableCommit(cwd, args.origin, "Origin")
  const resolvedCandidate = immutableCommit(cwd, args.candidate, "candidate")
  if (origin.commit !== resolvedOrigin || candidate.commit !== resolvedCandidate) {
    reject("stale candidate or binding")
  }

  const lensRecords = input.lenses.map((lens) => {
    const bytes = canonicalLine({ schema: LENS_DELTA_SCHEMA, ...lens })
    return { name: lens.name, bytes, sha256: sha256(bytes), size: bytes.length }
  })
  const manifest = lensRecords.map((lens) => ({
    name: lens.name,
    sha256: `sha256:${lens.sha256}`,
    size: lens.size,
  }))
  const helper = await packetHelperIdentity(cwd, resolvedCandidate)
  const frameBytes = new TextEncoder().encode(input.frame)
  const planBytes = new TextEncoder().encode(input.plan)
  const bindingFingerprint = semanticString(
    binding.value.binding_fingerprint_sha256,
    "binding.binding_fingerprint_sha256",
  )
  const sharedCore = canonicalLine({
    schema: SHARED_CORE_SCHEMA,
    candidate_locator: `commit:${resolvedCandidate}`,
    control_plane: {
      head: controlPlane.head,
      tree: controlPlane.tree,
      worktree_candidate_material_fingerprint_sha256: controlPlane.worktree_candidate_material_fingerprint_sha256,
      enforcement: args.enforcement,
      binding_identity: `${BINDING_SCHEMA}:${bindingFingerprint}`,
    },
    packet_helper: helper,
    frame: input.frame,
    frame_utf8_size: frameBytes.length,
    frame_utf8_sha256: `sha256:${sha256(frameBytes)}`,
    plan: input.plan,
    plan_utf8_size: planBytes.length,
    plan_utf8_sha256: `sha256:${sha256(planBytes)}`,
    audit_set: input.audit_set,
    required_lenses: input.lenses.map((lens) => lens.name),
    lens_manifest: manifest,
    admission: input.admission,
    replay: input.replay,
  })
  const commonPacketLocator = `sha256:${sha256(sharedCore)}`
  const dispatches = lensRecords.map((lens) => {
    const header = canonicalLine({
      schema: DISPATCH_SCHEMA,
      purpose: "independent candidate audit",
      reviewer_contract: REVIEWER_CONTRACT,
      common_packet_locator: commonPacketLocator,
      assigned_risk_lens: lens.name,
      assigned_lens_delta_sha256: `sha256:${lens.sha256}`,
      segments: [
        segmentRecord("binding", binding.bytes),
        segmentRecord("shared_core", sharedCore),
        segmentRecord("lens_delta", lens.bytes),
      ],
    })
    const bytes = concatBytes([header, binding.bytes, sharedCore, lens.bytes])
    return {
      assigned_risk_lens: lens.name,
      size: bytes.length,
      sha256: `sha256:${sha256(bytes)}`,
      bytes,
    }
  })
  const setHeader = canonicalLine({
    schema: OUTPUT_SCHEMA,
    status: "built",
    common_packet_locator: commonPacketLocator,
    dispatches: dispatches.map(({ assigned_risk_lens, size, sha256: digest }) => ({
      assigned_risk_lens,
      size,
      sha256: digest,
    })),
  })
  return concatBytes([setHeader, ...dispatches.map((dispatch) => dispatch.bytes)])
}

try {
  const result = await build()
  await Bun.write(Bun.stdout, result)
} catch (error) {
  const reason = error instanceof Error ? error.message : "unknown failure"
  await Bun.write(Bun.stdout, canonicalLine({ schema: OUTPUT_SCHEMA, status: "rejected", reason }))
  process.exitCode = 1
}
