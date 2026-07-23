import assert from "node:assert/strict"
import test from "node:test"
import { CodexJsonlPeer } from "./codex-jsonl-peer"

test("JSONL peer correlates responses and emits notifications", async () => {
  const written: string[] = []
  const notifications: string[] = []
  const peer = new CodexJsonlPeer({
    write: (line) => written.push(line),
    onNotification: (method) => notifications.push(method),
  })
  const pending = peer.request("initialize", { clientInfo: { name: "trade" } })
  assert.deepEqual(JSON.parse(written[0]!), {
    method: "initialize",
    id: 1,
    params: { clientInfo: { name: "trade" } },
  })
  peer.feed('{"id":1,"result":{"platformOs":"macos"}}')
  assert.deepEqual(await pending, { platformOs: "macos" })
  peer.feed('{"method":"turn/started","params":{"turn":{"id":"turn-1"}}}')
  assert.deepEqual(notifications, ["turn/started"])
})

test("JSONL peer denies server requests and rejects malformed or orphan responses", () => {
  const written: string[] = []
  const errors: Error[] = []
  const peer = new CodexJsonlPeer({
    write: (line) => written.push(line),
    onProtocolError: (error) => errors.push(error),
  })
  peer.feed('{"method":"item/commandExecution/requestApproval","id":22,"params":{}}')
  assert.deepEqual(JSON.parse(written[0]!), {
    id: 22,
    error: { code: -32601, message: "Host denied server request: item/commandExecution/requestApproval" },
  })
  peer.feed("{bad")
  peer.feed('{"id":999,"result":{}}')
  assert.match(errors[0]!.message, /malformed JSON/)
  assert.match(errors[1]!.message, /no pending request/)
})

test("JSONL peer rejects pending requests on close", async () => {
  const peer = new CodexJsonlPeer({ write: () => undefined })
  const pending = peer.request("thread/start", {}, 5_000)
  peer.close("process exited")
  await assert.rejects(pending, /process exited/)
})
