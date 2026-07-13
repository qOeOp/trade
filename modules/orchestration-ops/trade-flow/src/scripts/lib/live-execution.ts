import { asRecord, stringField, type JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import { resolveRegisteredOwnerTool } from "../../../../../contracts/runtime-core/src/owner-tool-registry"
import { runJsonCommand } from "../../../../../contracts/runtime-core/src/tool-runner"

export async function runShadowFromTools(
  input: JSONRecord,
  dbPath: string,
): Promise<JSONRecord> {
  const observe = Object.keys(asRecord(input.observe_event)).length > 0
    ? asRecord(input.observe_event)
    : await runObserveFromTools(input)
  const observeBody = asRecord(observe.body_json)
  const contractInput = {
    ...asRecord(input.execution_contract_input),
    source_observe_event_key: observe.event_key,
    chain_id: observe.chain_id,
    symbol: stringField(observeBody.symbol),
    side: stringField(observeBody.side),
    setup_id: stringField(observeBody.setup_id) || stringField(asRecord(input.execution_contract_input).setup_id),
  }
  return runExecutionOwnerTool({
    ...input,
    observe: observeBody,
    execution_contract_input: contractInput,
  }, dbPath)
}

async function runObserveFromTools(input: JSONRecord): Promise<JSONRecord> {
  const command = resolveRegisteredOwnerTool("decision.observe-runner", [
    "--observe-from-tools",
    "--json",
    JSON.stringify(input),
  ])
  const result = await runJsonCommand(command.argv, { cwd: command.cwd })
  if (!result.ok) {
    throw new Error(`observe runner owner tool failed: ${result.error}${result.stderr ? `; ${result.stderr.trim()}` : ""}`)
  }
  const response = result.data && typeof result.data === "object" ? result.data as JSONRecord : {}
  if (response.ok === false) {
    throw new Error(typeof response.error === "string" ? response.error : "observe runner owner tool returned ok=false")
  }
  return response.data && typeof response.data === "object" ? response.data as JSONRecord : response
}

async function runExecutionOwnerTool(input: JSONRecord, dbPath: string): Promise<JSONRecord> {
  const command = resolveRegisteredOwnerTool("execution.flow-runner", [
    "--run",
    "--db",
    dbPath,
    "--mode",
    "shadow",
    "--json",
    JSON.stringify(input),
  ])
  const result = await runJsonCommand(command.argv, { cwd: command.cwd })
  if (!result.ok) {
    throw new Error(`execution owner tool failed: ${result.error}${result.stderr ? `; ${result.stderr.trim()}` : ""}`)
  }
  const response = result.data && typeof result.data === "object" ? result.data as JSONRecord : {}
  if (response.ok === false) {
    throw new Error(typeof response.error === "string" ? response.error : "execution owner tool returned ok=false")
  }
  return response.data && typeof response.data === "object" ? response.data as JSONRecord : response
}
