import { rmSync } from "node:fs"
import type { ReplayWorkerV10StartedAuthorityProcess } from "./replay-worker-v10-authority-process-runtime"
import { sha256ReplayWorkerV10AuthorityValue } from "./replay-worker-v10-authority-process-runtime"
import type { ReplayWorkerV10AuthorityOpaqueProcessCapture, ReplayWorkerV10AuthorityOpaqueRequestInput, ReplayWorkerV10AuthorityProcessSession } from "./replay-worker-v10-authority-process-launch-types"

export function createReplayWorkerV10AuthorityProcessSession(
  started: ReplayWorkerV10StartedAuthorityProcess,
  processInstanceId: string,
  observedChildPid: number,
): ReplayWorkerV10AuthorityProcessSession {
  let consumed = false
  return {
    process_instance_id: processInstanceId,
    observed_child_pid: observedChildPid,
    async dispatchOpaqueRequest(input) {
      if (consumed) throw new Error("Authority Process session is already consumed")
      assertOpaqueRequestInput(input)
      consumed = true
      return await dispatchStartedProcess(started, input)
    },
    async terminateWithoutDispatch() {
      if (consumed) return
      consumed = true
      await terminateReplayWorkerV10AuthorityProcess(started)
    },
  }
}

export async function terminateReplayWorkerV10AuthorityProcess(
  started: ReplayWorkerV10StartedAuthorityProcess,
): Promise<void> {
  const child = started.child
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()))
    child.kill("SIGTERM")
    await Promise.race([
      exited,
      new Promise<void>((resolveTimeout) => setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
        resolveTimeout()
      }, 1_000)),
    ])
  }
  rmSync(started.root, { recursive: true, force: true })
}

async function dispatchStartedProcess(
  started: ReplayWorkerV10StartedAuthorityProcess,
  input: ReplayWorkerV10AuthorityOpaqueRequestInput,
): Promise<ReplayWorkerV10AuthorityOpaqueProcessCapture> {
  const child = started.child
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let transportErrorCode: ReplayWorkerV10AuthorityOpaqueProcessCapture["transport_error_code"] = null
  let transportErrorHash: string | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null
  const setTransportError = (
    code: Exclude<ReplayWorkerV10AuthorityOpaqueProcessCapture["transport_error_code"], null>,
    detail: string,
  ) => {
    if (transportErrorCode !== null) return
    transportErrorCode = code
    transportErrorHash = sha256ReplayWorkerV10AuthorityValue(detail)
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }
  child.stdout.on("data", (chunk: Buffer) => {
    stdout.push(Buffer.from(chunk))
    stdoutBytes += chunk.byteLength
    if (stdoutBytes > input.max_stdout_bytes) {
      setTransportError("stdout_limit", `stdout:${stdoutBytes}`)
    }
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(Buffer.from(chunk))
    stderrBytes += chunk.byteLength
    if (stderrBytes > input.max_stderr_bytes) {
      setTransportError("stderr_limit", `stderr:${stderrBytes}`)
    }
  })
  child.stdout.once("error", (error) => setTransportError("stream_error", `stdout:${error.message}`))
  child.stderr.once("error", (error) => setTransportError("stream_error", `stderr:${error.message}`))
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose) => {
    child.once("close", (code, signal) => resolveClose({ code, signal }))
  })
  try {
    await new Promise<void>((resolveWrite, rejectWrite) => {
      child.stdin.write(input.request_bytes, (error) => {
        if (error) {
          rejectWrite(error)
          return
        }
        child.stdin.end()
        input.on_request_written()
        resolveWrite()
      })
    })
    timeout = setTimeout(
      () => setTransportError("timeout", `timeout:${input.timeout_ms}`),
      input.timeout_ms,
    )
    const exit = await closed
    return {
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
      exit_status: exit.code,
      exit_signal: exit.signal,
      transport_error_code: transportErrorCode,
      transport_error_hash: transportErrorHash,
    }
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await closed
    throw error
  } finally {
    if (timeout !== null) clearTimeout(timeout)
    rmSync(started.root, { recursive: true, force: true })
  }
}

function assertOpaqueRequestInput(input: ReplayWorkerV10AuthorityOpaqueRequestInput): void {
  if (!Buffer.isBuffer(input.request_bytes) || input.request_bytes.byteLength < 1) {
    throw new Error("Authority Process opaque Request bytes are required")
  }
  for (const bound of [input.timeout_ms, input.max_stdout_bytes, input.max_stderr_bytes]) {
    if (!Number.isSafeInteger(bound) || bound < 1) {
      throw new Error("Authority Process opaque Request bound")
    }
  }
  if (typeof input.on_request_written !== "function") {
    throw new Error("Authority Process opaque Request write observer is required")
  }
}
