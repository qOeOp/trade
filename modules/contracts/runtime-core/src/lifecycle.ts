import { buildCommandSpec, type ProtocolToolsetEntry } from "../../protocol-fabric/src/protocol-fabric"
import { asRecord, type JSONRecord } from "./json"

type LifecyclePhase = "pre_cycle" | "pre_job" | "post_job" | "post_cycle" | string

interface BuildLifecycleProcessorSpecInput {
  processorId: string
  lifecyclePhase: LifecyclePhase
  tool: ProtocolToolsetEntry
  executable: boolean
  payload: JSONRecord
  argv: string[]
  targetDomain?: string
}

interface BuildLifecycleProcessorRecordInput {
  processor_id: string
  lifecycle_phase: LifecyclePhase
  enabled: boolean
  active: boolean
  reason: string
  processorSpec: JSONRecord
  subagent_role?: string
  write_scope?: string[]
  concurrency_group?: string
  may_write_trade_db?: boolean
  may_call_binance_write?: boolean
}

function buildLifecycleProcessorSpec(input: BuildLifecycleProcessorSpecInput): JSONRecord {
  return {
    processor_id: input.processorId,
    lifecycle_phase: input.lifecyclePhase,
    tool_id: input.tool.id,
    target_domain: input.targetDomain || "orchestration-ops",
    module_type: input.tool.module_type,
    capability_class: input.tool.capability_class,
    writes: input.tool.writes,
    concurrency_group: input.tool.concurrency_group,
    requires_preflight: input.tool.requires_preflight,
    payload: input.payload,
    entry_contract: input.tool.entry_contract,
    command_spec: buildCommandSpec(input.tool, input.executable, input.argv),
  }
}

function buildLifecycleProcessorRecord(input: BuildLifecycleProcessorRecordInput): JSONRecord {
  return {
    processor_id: input.processor_id,
    lifecycle_phase: input.lifecycle_phase,
    enabled: input.enabled,
    active: input.enabled && input.active,
    reason: input.reason,
    subagent_role: input.subagent_role || "ops-runtime-operator",
    write_scope: input.write_scope || ["ops_runtime_store"],
    concurrency_group: input.concurrency_group || "ops-runtime",
    may_write_trade_db: input.may_write_trade_db ?? false,
    may_call_binance_write: input.may_call_binance_write ?? false,
    command: commandFromProcessorSpec(input.processorSpec),
    processor_spec: input.processorSpec,
    command_spec: asRecord(input.processorSpec.command_spec),
  }
}

function commandFromProcessorSpec(processorSpec: JSONRecord): string {
  const commandSpec = asRecord(processorSpec.command_spec)
  const cwd = stringField(commandSpec.cwd)
  const argv = Array.isArray(commandSpec.argv) ? commandSpec.argv.map(String) : []
  if (cwd && argv.length >= 2 && !argv[1].startsWith(`${cwd}/`)) {
    return shellCommand([argv[0], `${cwd}/${argv[1]}`, ...argv.slice(2)])
  }
  return shellCommand(argv)
}

function shellCommand(argv: string[]): string {
  return argv.map(shellQuote).join(" ")
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_./:=@-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export {
  buildLifecycleProcessorRecord,
  buildLifecycleProcessorSpec,
  type BuildLifecycleProcessorRecordInput,
  type BuildLifecycleProcessorSpecInput,
  type LifecyclePhase,
}
