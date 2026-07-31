import { createHash } from "node:crypto"
import { resolve, sep } from "node:path"
import {
  buildAgentRunEvent,
  type AgentArtifactRef,
  type AgentRunEvent,
  type AgentRunFailureClass,
  type AgentRunRequest,
} from "../../../../contracts/agent-run-contract/src/agent-run-contract"

type JSONRecord = Record<string, unknown>

export const CODEX_APP_SERVER_BASELINE = {
  cli_version: "codex-cli 0.146.0",
  stable_schema_bundle_sha256: "1a9a00c1ee35d44c8e04e92b394263544f90acaa7afe3c7023b08d9f0eb0d161",
  transport: "jsonl_stdio",
} as const

export interface MaterializedAgentArtifact {
  artifact: AgentArtifactRef
  text: string
}

export interface CodexAgentRunMaterialization {
  repo_root: string
  workspace_root: string
  instruction: MaterializedAgentArtifact
  inputs: MaterializedAgentArtifact[]
  output_schema?: JSONRecord
}

export interface CodexAgentRunWirePlan {
  initialize: JSONRecord
  thread_start: JSONRecord
  turn_start(threadId: string): JSONRecord
}

export function buildCodexAgentRunWirePlan(
  request: AgentRunRequest,
  materialization: CodexAgentRunMaterialization,
): CodexAgentRunWirePlan {
  const workspace = validateWorkspace(request, materialization.repo_root, materialization.workspace_root)
  verifyMaterialized(materialization.instruction, request.instruction_ref, "instruction")
  if (materialization.inputs.length !== request.input_refs.length) throw new Error("materialized Agent Run input count drifted")
  for (let index = 0; index < request.input_refs.length; index += 1) {
    verifyMaterialized(materialization.inputs[index]!, request.input_refs[index]!, `input[${index}]`)
  }
  const prompt = renderPrompt(request, materialization)
  const artifactBytes = materialization.instruction.artifact.bytes
    + materialization.inputs.reduce(
      (sum, input) => sum + input.artifact.bytes,
      0,
    )
  const framingBytes = Buffer.byteLength(prompt) - artifactBytes
  if (framingBytes < 0 || framingBytes > 128 * 1024) {
    throw new Error("materialized Codex prompt framing exceeds Host limit")
  }
  const writable = request.task_profile === "developer"
  const sandboxPolicy = writable
    ? {
        type: "workspaceWrite",
        writableRoots: [workspace],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      }
    : { type: "readOnly", networkAccess: false }
  return {
    initialize: {
      clientInfo: { name: "trade_agent_host", title: "Trade Agent Host", version: "0.1.0" },
      capabilities: {
        optOutNotificationMethods: [
          "item/agentMessage/delta",
          "item/plan/delta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/summaryPartAdded",
          "item/reasoning/textDelta",
          "rawResponseItem/completed",
        ],
      },
    },
    thread_start: {
      cwd: workspace,
      approvalPolicy: "never",
      sandbox: writable ? "workspace-write" : "read-only",
      ephemeral: true,
      serviceName: "trade_agent_host",
      baseInstructions: baseInstructions(request.task_profile),
    },
    turn_start: (threadId: string) => ({
      threadId: opaqueId(threadId, "threadId"),
      clientUserMessageId: request.run_id,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      cwd: workspace,
      approvalPolicy: "never",
      sandboxPolicy,
      ...(materialization.output_schema == null ? {} : { outputSchema: materialization.output_schema }),
    }),
  }
}

export function normalizeCodexNotification(input: {
  request: AgentRunRequest
  sequence: number
  observed_at: string
  method: string
  params: unknown
}): AgentRunEvent | null {
  if (input.method.startsWith("item/reasoning/")
    || input.method === "item/agentMessage/delta"
    || input.method === "item/plan/delta"
    || input.method === "rawResponseItem/completed") return null
  const params = record(input.params, "notification params")
  if (input.method === "turn/started") {
    return event(input, "started", "Codex turn started.")
  }
  if (input.method === "item/started" || input.method === "item/completed") {
    const item = record(params.item, "notification item")
    const itemType = text(item.type, "notification item type")
    if (itemType === "reasoning" || itemType === "agentMessage" || itemType === "plan" || itemType === "userMessage") return null
    const operationRef = `codex-item://${opaqueId(item.id, "notification item id")}`
    return event(
      input,
      input.method === "item/started" ? "tool_started" : "tool_completed",
      input.method === "item/started" ? `Codex ${safeItemType(itemType)} item started.` : `Codex ${safeItemType(itemType)} item completed.`,
      operationRef,
    )
  }
  if (input.method === "turn/completed") {
    const turn = record(params.turn, "completed turn")
    const status = text(turn.status, "completed turn status")
    if (status === "completed") return event(input, "terminal", "Codex turn completed.", undefined, "completed")
    if (status === "interrupted") return event(input, "terminal", "Codex turn was interrupted.", undefined, "cancelled", "cancelled")
    if (status === "failed") {
      const failure = classifyCodexFailure(turn.error)
      return event(input, "terminal", "Codex turn failed.", undefined, "failed", failure)
    }
    throw new Error("turn/completed carried non-terminal status")
  }
  if (input.method === "error") {
    return event(input, "progress", "Codex reported a sanitized operational error.")
  }
  return null
}

function event(
  input: Parameters<typeof normalizeCodexNotification>[0],
  kind: AgentRunEvent["kind"],
  summary: string,
  operationRef?: string,
  status?: AgentRunEvent["status"],
  failureClass?: AgentRunFailureClass,
): AgentRunEvent {
  return buildAgentRunEvent({
    run_id: input.request.run_id,
    trace_id: input.request.trace_id,
    request_hash: input.request.request_hash,
    sequence: input.sequence,
    occurred_at: input.observed_at,
    kind,
    summary,
    ...(operationRef == null ? {} : { operation_ref: operationRef }),
    ...(status == null ? {} : { status }),
    ...(failureClass == null ? {} : { failure_class: failureClass }),
  })
}

function verifyMaterialized(actual: MaterializedAgentArtifact, expected: AgentArtifactRef, field: string): void {
  if (actual.artifact.ref !== expected.ref
    || actual.artifact.sha256 !== expected.sha256
    || actual.artifact.media_type !== expected.media_type
    || actual.artifact.bytes !== expected.bytes) {
    throw new Error(`${field} artifact identity drifted`)
  }
  const bytes = Buffer.from(actual.text)
  if (bytes.byteLength !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
    throw new Error(`${field} artifact bytes or hash drifted`)
  }
  rejectSecretLike(actual.text, field)
}

function renderPrompt(request: AgentRunRequest, materialization: CodexAgentRunMaterialization): string {
  const inputs = materialization.inputs.map((input, index) =>
    `<input index="${index}" ref="${input.artifact.ref}" sha256="${input.artifact.sha256}">\n${input.text}\n</input>`,
  ).join("\n")
  return [
    `<agent-run run-id="${request.run_id}" profile="${request.task_profile}" source-revision="${request.source_revision}">`,
    `<objective>${request.objective}</objective>`,
    `<instruction ref="${request.instruction_ref.ref}" sha256="${request.instruction_ref.sha256}">`,
    materialization.instruction.text,
    "</instruction>",
    inputs,
    `<output-schema>${request.output_schema_version}</output-schema>`,
    "Return only the requested proposal or patch artifact. Domain authority remains none.",
    "</agent-run>",
  ].filter(Boolean).join("\n")
}

function validateWorkspace(request: AgentRunRequest, repoRoot: string, workspaceRoot: string): string {
  const repo = resolve(repoRoot)
  const workspace = resolve(workspaceRoot)
  if (workspace === repo || !workspace.startsWith(`${repo}${sep}`)) throw new Error("Codex workspace must be a repository-contained isolated path")
  const relative = workspace.slice(repo.length + 1).replaceAll("\\", "/")
  if (relative.startsWith(".secrets/") || relative.startsWith("data/")) throw new Error("Codex workspace cannot expose secret or owner data")
  if (request.task_profile === "developer" && !relative.startsWith("tmp/agent-workspaces/")) {
    throw new Error("Developer Agent Run requires tmp/agent-workspaces isolation")
  }
  return workspace
}

function baseInstructions(profile: AgentRunRequest["task_profile"]): string {
  const common = "Operate only on supplied refs. Do not read secrets or owner databases. Do not trade, deploy, promote, or claim domain authority. Never reveal chain-of-thought."
  return profile === "developer"
    ? `${common} Write only inside the isolated workspace and return reviewable patch and test evidence.`
    : `${common} This profile is read-only; return a typed proposal only.`
}

function classifyCodexFailure(value: unknown): AgentRunFailureClass {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "host_unavailable"
  const info = (value as JSONRecord).codexErrorInfo
  const encoded = JSON.stringify(info)
  if (/unauthorized|httpConnectionFailed|responseStream|usageLimit|serverOverloaded/.test(encoded)) return "provider_unavailable"
  if (/sandboxError/.test(encoded)) return "sandbox_failed"
  return "host_unavailable"
}

function rejectSecretLike(value: string, field: string): void {
  if (/(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/i.test(value)
    || /authorization\s*:\s*(?:bearer|basic)\s+\S+/i.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    throw new Error(`${field} contains secret-like material`)
  }
}

function safeItemType(value: string): string {
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : "tool"
}

function opaqueId(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as JSONRecord
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${field} must be text`)
  return value
}
