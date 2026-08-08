# Installation

Vibe Trader is installed from a source checkout; this repository does not define a public
distribution channel.

## Prerequisites

- Rust through `rustup`; the repository pins the toolchain in `rust-toolchain.toml`.
- Python 3.12 through 3.14.
- `uv` at the version pinned in `python/pyproject.toml`.
- `make` and a C/C++ build toolchain for the current platform.
- `patchelf` on Linux when building the Python extension.

Optional adapter dependencies, such as Cap'n Proto or database services, are documented in their
integration guides.

## Source checkout

```bash
git clone https://github.com/qOeOp/trade.git
cd trade
make sync
```

`make sync` creates or updates the repository Python environment from `python/uv.lock` without
building the local package.

## Build the Python package

Build and install the PyO3 extension into the repository environment:

```bash
make build-debug
```

Use the optimized local build when required:

```bash
make build
```

The import package is `vibe_trader`; its compiled extension is `vibe_trader._libvibe`.

## Rust-only development

The Rust workspace can be checked without installing the Python package:

```bash
cargo check --workspace --all-targets
```

Individual packages use their `vibe-*` Cargo names, for example:

```bash
cargo check -p vibe-core
cargo test -p vibe-model
```

## Precision mode

The normal Python build and most adapter configurations enable the `high-precision` feature. Rust
consumers that opt out of default features must select the precision feature consistently across
all crates that exchange fixed-point model values.

Do not mix artifacts built with different precision modes in one process or persisted dataset.

## Extras

The Python dependency groups and optional visualization dependencies are declared in
`python/pyproject.toml` and locked by `python/uv.lock`. Use the Makefile targets so the selected
groups stay aligned with the build:

```bash
make sync
make build-debug
make pytest
```

## Redis

Redis support is a Cargo feature and requires a reachable Redis service only for tests or runtime
configurations that explicitly select it. The default source setup does not start external
services or create live trading connections.

## Rebuild and clean

After changing PyO3 bindings, regenerate stubs before testing:

```bash
make py-stubs
make build-debug
```

Remove local build artifacts with:

```bash
make clean
```
