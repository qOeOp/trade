import assert from "node:assert/strict"
import test from "node:test"

import { fetchObserveProjections, runJsonCommand, type Runner } from "./observe-runner"

test("fetchObserveProjections calls account and symbol snapshot tools", async () => {
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
  assert.match(calls[0].cwd ?? "", /exchange-gateway\/binance-read\/account-snapshot$/)
  assert.match(calls[1].cwd ?? "", /market-data-products\/binance-read\/symbol-snapshot$/)
  assert.deepEqual(calls[0].command.slice(0, 4), ["bun", "src/scripts/main.ts", "--symbol", "BTCUSDT"])
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

test("runJsonCommand parses JSON stdout", async () => {
  const result = await runJsonCommand(["bun", "-e", "console.log(JSON.stringify({ ok: true, value: 1 }))"])

  assert.equal(result.ok, true)
  assert.deepEqual(result.ok ? result.data : null, { ok: true, value: 1 })
})

test("runJsonCommand returns non-zero exit details", async () => {
  const result = await runJsonCommand(["bun", "-e", "console.error('bad'); process.exit(7)"])

  assert.equal(result.ok, false)
  assert.equal(result.ok ? null : result.exitCode, 7)
  assert.match(result.ok ? "" : result.stderr, /bad/)
})

test("runJsonCommand rejects non-json stdout", async () => {
  const result = await runJsonCommand(["bun", "-e", "console.log('not json')"])

  assert.equal(result.ok, false)
  assert.match(result.ok ? "" : result.error, /did not return JSON/)
})
