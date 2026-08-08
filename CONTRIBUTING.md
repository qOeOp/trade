# Contributing to Vibe Trader

This repository is an internal development base. Keep changes focused on product code,
builds, tests, runtime behavior, architecture, or migration work.

## Set up the workspace

Use the pinned Rust, Python, uv, and tool versions from `rust-toolchain.toml`,
`python/pyproject.toml`, `Cargo.lock`, `python/uv.lock`, and `tools.toml`.

```bash
cargo install cargo-binstall --locked
make install-tools
make build
```

The Rust workspace is under `crates/`; the Python package and tests are under `python/`.
See [the environment guide](docs/developer_guide/environment_setup.md) for platform details.

## Make a change

- Preserve the existing crate, module, and ownership boundaries.
- Add or update tests for changed behavior.
- Keep generated PyO3 stubs synchronized with their Rust owners.
- Use `vibe-*`, `vibe_*`, and `vibe_trader` consistently; do not add compatibility aliases.
- Keep package and repository metadata limited to facts consumed by current tooling.

Run the smallest affected checks while developing, then the applicable repository gates:

```bash
make cargo-test
make pytest
make format
make pre-commit
```

Use the [developer guide](docs/developer_guide/index.md) for coding, testing, adapter,
documentation, and FFI conventions.
