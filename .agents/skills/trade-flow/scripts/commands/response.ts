import type { JSONRecord, ScriptErrorCode, ScriptResponse } from "./types"

export const SCRIPT_RESPONSE_SCHEMA_VERSION = "trade-flow.script-response.v1"

export function successResponse(data: unknown): ScriptResponse {
  return {
    ok: true,
    schema_version: SCRIPT_RESPONSE_SCHEMA_VERSION,
    data,
  }
}

export function errorResponse(error: unknown): ScriptResponse {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    schema_version: SCRIPT_RESPONSE_SCHEMA_VERSION,
    error: message,
    code: classifyError(message),
    retriable: isRetriable(message),
    details: errorDetails(error),
  }
}

function classifyError(message: string): ScriptErrorCode {
  if (
    message.startsWith("unknown flag:")
    || message.includes(" requires a value")
    || message.includes("unsupported --mode")
    || message.includes("--track must be")
    || message.includes("--to must be")
    || message.includes("unsupported replay strategy")
    || message.includes("requires datasetId")
    || message.includes("requires at least")
  ) {
    return "INVALID_ARGUMENT"
  }
  if (
    message.includes("requires --yes")
    || message.includes("requires --artifact-root")
    || message.includes("blocked preflight")
    || message.includes("risk locked")
  ) {
    return "PRECONDITION_FAILED"
  }
  if (
    message.includes("command failed")
    || message.includes("did not return JSON")
    || message.includes("ECONNRESET")
    || message.includes("ETIMEDOUT")
    || message.includes("rate limit")
  ) {
    return "EXTERNAL_FAILURE"
  }
  return "INTERNAL_ERROR"
}

function isRetriable(message: string): boolean {
  return message.includes("ECONNRESET")
    || message.includes("ETIMEDOUT")
    || message.includes("timeout")
    || message.includes("rate limit")
}

function errorDetails(error: unknown): JSONRecord {
  if (error instanceof Error) {
    return {
      error_name: error.name,
    }
  }
  return {
    error_type: typeof error,
  }
}
