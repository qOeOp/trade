import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"

const root = repoRoot()
const dockerfile = readFileSync(resolve(root, "deploy/server/Dockerfile"), "utf8")
const compose = readFileSync(resolve(root, "deploy/server/compose.yaml"), "utf8")
const operatorCompose = readFileSync(resolve(root, "deploy/server/compose.operator.yaml"), "utf8")
const ignore = readFileSync(resolve(root, ".dockerignore"), "utf8")

test("server image locks toolchains, builds Rust with its lock, and drops root", () => {
  assert.match(dockerfile, /ARG RUST_VERSION=1\.97\.1/)
  assert.match(dockerfile, /ARG BUN_VERSION=1\.3\.13/)
  assert.match(dockerfile, /cargo build[\s\S]*--locked[\s\S]*--release/)
  assert.match(dockerfile, /bun install --frozen-lockfile --production/)
  assert.match(dockerfile, /USER 10001:10001/)
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini", "--"\]/)
  assert.doesNotMatch(dockerfile, /API_KEY|API_SECRET|sk-[a-z0-9]/i)
})

test("server Compose keeps one no-live runtime namespace and an opt-in hardened operator", () => {
  assert.match(dockerfile, /server-runtime-container-foreground\.ts/)
  assert.match(compose, /restart: always/)
  assert.match(compose, /read_only: true/)
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(compose, /server-runtime-container-status\.ts/)
  assert.match(operatorCompose, /profiles:\s*\n\s*- operator/)
  assert.match(operatorCompose, /TRADE_OPERATOR_SECRET_ENV_FILE/)
  assert.match(operatorCompose, /network_mode: host/)
  assert.doesNotMatch(`${compose}\n${operatorCompose}`, /privileged:|docker\.sock|BINANCE_API|SILICONFLOW_API_KEY|TRADE_OPERATOR_API_TOKEN/)
})

test("server build context excludes runtime state, credentials, dependencies, and build caches", () => {
  for (const entry of [".git", ".secrets", "data", "tmp", "node_modules", "**/target"]) {
    assert.equal(ignore.split(/\r?\n/).includes(entry), true, `missing dockerignore entry ${entry}`)
  }
})
