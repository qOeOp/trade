import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { executeOwnerCli } from "./owner-cli"

test("owner CLI failures preserve structured error messages written to stdout", async () => {
  const missingDb = `tmp/agent-mcp-${randomUUID()}/missing.db`
  await assert.rejects(executeOwnerCli({
    script: "modules/research-strategy-development/research-control-plane/program-control/src/scripts/main.ts",
    args: ["--db", missingDb, "--program-id", "rd-program", "--json", "{\"action\":\"read\"}"],
  }), /unable to open database file/)
})
