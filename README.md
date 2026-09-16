# Vibe Trader

Vibe Trader is a Rust-native trading engine with Python bindings for research,
deterministic simulation, and live execution. The repository is an internal
development base: crates and Python artifacts are not configured for public
publication.

## Architecture

The runtime is organized around a shared event-driven kernel:

- `vibe-core`, `vibe-common`, and `vibe-model` own foundational types and contracts.
- `vibe-data`, `vibe-execution`, `vibe-portfolio`, and `vibe-risk` own the engine planes.
- `vibe-system`, `vibe-backtest`, and `vibe-live` compose those planes for simulation and live use.
- `vibe-pyo3` exposes the Rust implementation through `vibe_trader._libvibe`.
- `crates/adapters/` contains venue and data-provider integrations.

The Rust crate names use `vibe-*`, Rust imports use `vibe_*`, and the Python package is
`vibe_trader`. These are the only supported project identities; compatibility aliases and
forwarding packages are intentionally absent.

## Product architecture

The crates above are the engine layer. Above them sits a product layer that defines who owns each
mutable business fact: ten business Owners (Market Data, R&D, Backtest, Qualification, Strategy
Governance, Scanner, Runtime, Risk, Execution, Portfolio) plus the non-authoritative Product Edge,
Strategy Factory, and Observability boundaries. A crate can support an Owner, but a crate is never an
authority.

- [`docs/guide/`](docs/guide/index.md) - product loop, architecture rules, and the Dashboard contract.
- [`docs/owners/`](docs/owners/index.md) - the ten business fact writers and their handoffs.
- [`docs/architecture/`](docs/architecture/index.md) - authority boundaries and
  [capability adoption](docs/architecture/capability-adoption.md), which maps each crate to a target
  Owner without claiming the Owner contract is implemented.

Implementation maturity varies sharply by Owner and is tracked inside each document. Read the status
markers there rather than inferring progress from crate size.

## Repository layout

- [`crates/`](crates/) - Rust workspace and adapters.
- [`product/`](product/) - the Windmill R&D Workbench and the first-party Dashboard.
- [`python/vibe_trader/`](python/vibe_trader/) - Python package and type stubs.
- [`python/tests/`](python/tests/) - Python unit, integration, acceptance, and performance tests.
- [`docs/`](docs/) - concepts, integration guides, tutorials, and API sources.
- [`examples/`](examples/) - backtest, sandbox, and live examples.
- [`schema/`](schema/) - database schemas.
- [`scripts/`](scripts/) - local build, validation, and development tooling.
- [`test_data/`](test_data/) - repository test fixtures.

## Development

The pinned toolchain is defined by [`rust-toolchain.toml`](rust-toolchain.toml),
[`python/pyproject.toml`](python/pyproject.toml), and the repository lockfiles.

Common commands:

```bash
cargo check --workspace --all-targets
make build
make cargo-test
make pytest
make format
```

Use [`docs/getting_started/installation.md`](docs/getting_started/installation.md) for the
source-development setup and [`CONTRIBUTING.md`](CONTRIBUTING.md) for repository conventions.

## Branding status

No official Vibe Trader visual asset is included in this baseline. Artwork inherited from the
source project must not be renamed or displayed as Vibe Trader branding.
