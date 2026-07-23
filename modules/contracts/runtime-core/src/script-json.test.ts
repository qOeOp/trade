import assert from "node:assert/strict"
import test from "node:test"
import {
  readDbActionJsonArgs,
  readDbJsonArgs,
} from "./script-json"

test("database JSON argument readers inherit the deployment environment identity", () => {
  const previous = process.env.TRADE_ENVIRONMENT_ID
  process.env.TRADE_ENVIRONMENT_ID = "server:integration-test"
  try {
    assert.equal(
      readDbActionJsonArgs([], { dbPath: "data/test.db" }, () => undefined)
        .environmentId,
      "server:integration-test",
    )
    assert.equal(
      readDbJsonArgs([], "data/test.db", () => undefined).environmentId,
      "server:integration-test",
    )
  } finally {
    if (previous === undefined) delete process.env.TRADE_ENVIRONMENT_ID
    else process.env.TRADE_ENVIRONMENT_ID = previous
  }
})

test("explicit database environment identity overrides the deployment default", () => {
  const previous = process.env.TRADE_ENVIRONMENT_ID
  process.env.TRADE_ENVIRONMENT_ID = "server:default"
  try {
    assert.equal(
      readDbActionJsonArgs(
        ["--environment-id", "server:override"],
        { dbPath: "data/test.db" },
        () => undefined,
      ).environmentId,
      "server:override",
    )
    assert.equal(
      readDbJsonArgs(
        ["--environment-id", "server:override"],
        "data/test.db",
        () => undefined,
      ).environmentId,
      "server:override",
    )
  } finally {
    if (previous === undefined) delete process.env.TRADE_ENVIRONMENT_ID
    else process.env.TRADE_ENVIRONMENT_ID = previous
  }
})
