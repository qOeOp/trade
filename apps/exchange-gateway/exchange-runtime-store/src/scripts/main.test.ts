import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { parseArgs, run } from "./main"

test("exchange runtime store CLI records and reads command by idempotency key", () => {
  const dir = mkdtempSync(join(tmpdir(), "exchange-runtime-store-"))
  const dbPath = join(dir, "exchange.db")
  try {
    run(parseArgs(["--db", dbPath, "--action", "init"]))
    run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "record_command",
      "--json",
      JSON.stringify({
        command_id: "cmd-cli",
        idempotency_key: "idem-cli",
        command_type: "order_place",
        requested_by_ref: "plan_event/obs-cli",
        request: { symbol: "BTCUSDT" },
      }),
    ]))
    const result = run(parseArgs([
      "--db",
      dbPath,
      "--action",
      "command_by_idempotency",
      "--json",
      JSON.stringify({ idempotency_key: "idem-cli" }),
    ])) as { command: { command_id: string; request_json: { symbol: string } } }
    assert.equal(result.command.command_id, "cmd-cli")
    assert.equal(result.command.request_json.symbol, "BTCUSDT")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
