import { Database } from "bun:sqlite"
import { asRecord, stringField, type JSONRecord } from "./json"
import { observeFromToolsWithRunner } from "./observe-flow"
import { runOneFlowStep } from "../../../../../live-execution-control/execution-flow-runner/src/lib/execution-flow-runner"
import type { Runner } from "../../../../../live-decision-planning/observe-runner/src/lib/observe-runner"

export async function runShadowFromTools(
  db: Database,
  input: JSONRecord,
  runner?: Runner,
): Promise<JSONRecord> {
  const observe = await observeFromToolsWithRunner(input, runner)
  const contractInput = {
    ...asRecord(input.execution_contract_input),
    source_observe_event_key: observe.event_key,
    chain_id: observe.chain_id,
    symbol: stringField(observe.body_json.symbol),
    side: stringField(observe.body_json.side),
    setup_id: stringField(observe.body_json.setup_id) || stringField(asRecord(input.execution_contract_input).setup_id),
  }
  return runOneFlowStep(db, {
    ...input,
    observe: observe.body_json,
    execution_contract_input: contractInput,
  }, "shadow")
}
