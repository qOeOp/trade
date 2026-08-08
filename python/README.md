# VibeTrader Python package

This directory contains the `vibe_trader` Python package. Rust core bindings are exposed
through PyO3.

## Project structure

```
python/
├── README.md                   # This file
├── generate_docstrings.py      # Copies Rust doc comments to PyO3 wrappers
├── generate_stubs.py           # Generates Python type stubs from Rust bindings
├── pyproject.toml              # Maturin build configuration
├── uv.lock                     # Dependency lock file
├── tests/
│   ├── conftest.py             # Shared pytest fixtures
│   ├── unit/
│   │   ├── common/actor.py     # Test actor/strategy/algorithm fixtures
│   │   └── test_live_node.py   # LiveNode registration tests
│   └── acceptance/             # Acceptance tests
└── vibe_trader/
    ├── __init__.py             # Re-exports from _libvibe
    ├── _libvibe/            # Compiled Rust extension (created by the build)
    ├── core/
    │   ├── __init__.py         # Re-exports from _libvibe.core
    │   └── __init__.pyi        # Type stubs (auto-generated)
    ├── model/
    │   ├── __init__.py         # Re-exports from _libvibe.model
    │   └── __init__.pyi        # Type stubs (auto-generated)
    └── ...                     # Other submodules follow the same pattern
```

## Build targets

From the repository root:

```bash
make build-debug  # Compile and install into .venv (debug mode)
make py-stubs     # Regenerate type stubs and docstrings
make pytest       # Run Python tests
```

## Development setup

### Prerequisites

- Rust toolchain (via `rustup`)
- Python 3.12-3.14
- `patchelf` (Linux only) for setting rpath on the compiled extension

### Quick start

From the repository root:

```bash
make build-debug
```

This compiles the Rust extension and installs it into the project venv (`.venv`). Run it again
after Rust changes.

## How it works

1. **Build**: `maturin develop` compiles all Rust code into a single extension module
   under `vibe_trader/_libvibe/`.
2. **Re-exports**: Each submodule's `__init__.py` re-exports components from `_libvibe`.
3. **Type stubs**: `.pyi` files provide type information for IDEs and `mypy`.
4. **Docstrings**: `generate_docstrings.py` copies `///` doc comments from the Rust source
   to PyO3 wrappers, so `__doc__` stays in sync without manual duplication.

## Usage

```python
from vibe_trader.core import UUID4

UUID4()
```

## Installation

### From source

```bash
git clone https://github.com/qOeOp/trade.git
cd trade
make build
```

## Testing

Tests live in `tests/` and require a built extension module.

```bash
make build-debug  # Build first
make pytest       # Run tests
```

Use pytest-style free functions and fixtures. Do not use test classes.
Importable test fixtures (actors, strategies, algorithms) live in `tests/unit/common/actor.py`.

## Type stubs

Type stubs (`.pyi` files) are auto-generated using
[`pyo3-stub-gen`](https://github.com/Jij-Inc/pyo3-stub-gen). To regenerate after modifying
Rust bindings:

```bash
make py-stubs
```

This runs `generate_docstrings.py` first to copy doc comments from Rust source to PyO3
wrappers, then generates the `.pyi` stub files.
