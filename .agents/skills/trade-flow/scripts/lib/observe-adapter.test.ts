import assert from "node:assert/strict"
import test from "node:test"

import { fetchObserveProjections, type Runner } from "./observe-adapter"

test("fetchObserveProjections calls account and symbol snapshot skills", async () => {
  const calls: Array<{ command: string[]; cwd?: string }> = []
  const runner: Runner = async (command, options) => {
    calls.push({ command, cwd: options?.cwd })
    return {
      ok: true,
      data: {
        ok: true,
        data: {
          symbol: "BTCUSDT",
        },
      },
      stdout: "{}",
      stderr: "",
    }
  }

  const result = await fetchObserveProjections({
    repoRoot: "/repo",
    symbol: "BTCUSDT",
  }, runner)

  assert.equal(calls.length, 2)
  assert.match(calls[0].cwd ?? "", /binance-account-snapshot$/)
  assert.match(calls[1].cwd ?? "", /binance-symbol-snapshot$/)
  assert.deepEqual(calls[0].command.slice(0, 4), ["bun", "scripts/main.ts", "--symbol", "BTCUSDT"])
  assert.deepEqual(result.market_refs, [
    "binance-account-snapshot:BTCUSDT",
    "binance-symbol-snapshot:BTCUSDT",
  ])
})

test("fetchObserveProjections fails when account snapshot fails", async () => {
  let count = 0
  const runner: Runner = async () => {
    count += 1
    if (count === 1) {
      return {
        ok: false,
        error: "missing env",
        stdout: "",
        stderr: "missing env",
        exitCode: 1,
      }
    }
    return {
      ok: true,
      data: {},
      stdout: "{}",
      stderr: "",
    }
  }

  await assert.rejects(
    () => fetchObserveProjections({ repoRoot: "/repo", symbol: "BTCUSDT" }, runner),
    /account snapshot failed: missing env/,
  )
})
