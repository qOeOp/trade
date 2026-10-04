# backtest MCP

The `backtest` server of the agent's domain MCP catalog
([`docs/owners/rd.md`](../../docs/owners/rd.md), "backtest MCP server"). A stateless stdio process
speaking MCP's JSON-RPC, one message per line. It holds the R&D API's URL and token in its own
environment and reaches `/v1/backtests` only; every rule it answers by name lives behind that API's
own routes.

This crate is its own Cargo workspace, with its own `Cargo.lock`: the root workspace does not list
it, and it depends on no Owner crate - `reqwest`, `serde_json`, `tokio` and `anyhow` only - so it is
built, tested and deployed without the rest of the repository.

## Tools

`run`, `status`, `report`, `list`. See `src/lib.rs` for each tool's input schema and the route it
becomes.

## Build and test

```bash
cargo test --locked --manifest-path services/backtest-mcp/Cargo.toml
```

## Run

On the local deployment `product/rd-workbench/scripts/up.sh` brings up, `make mcp-backtest` builds
this crate, installs it into the deployment's state directory and prints the `claude mcp add`
command. To run it directly against any R&D API, copy `.env.example` to `.env`, fill in the two
variables, and:

```bash
set -a && . ./.env && set +a
cargo run --locked --release --manifest-path services/backtest-mcp/Cargo.toml
```

The binary reads its environment directly; it loads no `.env` file itself.
