import assert from "node:assert/strict"
import test from "node:test"
import { commandHasArgument, processIsAlive, readProcessCommand } from "./process-identity"

test("process identity helper matches exact separated and assigned arguments", () => {
  assert.equal(commandHasArgument("bun script.ts --symbol BTCUSDT", "--symbol", "BTCUSDT"), true)
  assert.equal(commandHasArgument("bun script.ts --symbol=BTCUSDT", "--symbol", "BTCUSDT"), true)
  assert.equal(commandHasArgument("bun script.ts --symbol 'BTCUSDT'", "--symbol", "BTCUSDT"), true)
  assert.equal(commandHasArgument("bun script.ts --symbol ETHUSDT", "--symbol", "BTCUSDT"), false)
  assert.equal(commandHasArgument("bun script.ts --symbol BTCUSDT-PERP", "--symbol", "BTCUSDT"), false)
})

test("process identity helper rejects invalid process ids", () => {
  assert.equal(processIsAlive(0), false)
  assert.equal(processIsAlive(1), false)
  assert.equal(readProcessCommand(0), null)
})
