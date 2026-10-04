# strategy-authoring MCP

The `strategy-authoring` server of the agent's domain MCP catalog
([`docs/owners/rd.md`](../../docs/owners/rd.md), "strategy-authoring MCP server"). A stateless
stdio process speaking MCP's JSON-RPC, one message per line. It holds the R&D API's URL and token
in its own environment and reaches `/v1/strategies` only; every rule it answers by name lives
behind that API's own routes. This crate depends on no Owner crate: `reqwest`, `serde_json` and
`tokio` only, so it can be built, tested and deployed without the rest of the workspace.

## Tools

`validate`, `create`, `get`, `list`, `revise`, `archive`. See `src/lib.rs` for each tool's input
schema and the route it becomes.

## Run

On the local deployment `product/rd-workbench/scripts/up.sh` brings up, `make
mcp-strategy-authoring` builds this crate, installs it into the deployment's state directory and
prints the `claude mcp add` command. That wrapper script is the supported way to run it against
that deployment; see [`product/rd-workbench/README.md`](../../product/rd-workbench/README.md).

To run it directly against any R&D API, copy `.env.example` to `.env`, fill in the two variables,
and:

```bash
set -a && . ./.env && set +a
cargo run --locked --release -p vibe-strategy-authoring-mcp
```

(the binary reads its environment directly; it loads no `.env` file itself.) The token is read
from the environment only; no tool argument or result carries it.

## Test

```bash
cargo test -p vibe-strategy-authoring-mcp
```

Every tool's routing, refusal and the MCP handshake are tested here, transport-free, against a
recording fake of the API - no network, no deployment needed.
