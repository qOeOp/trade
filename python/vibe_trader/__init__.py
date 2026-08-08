"""
VibeTrader (https://github.com/qOeOp/trade) is a Rust-native engine for multi-asset,
multi-venue trading systems.

The system spans research, deterministic simulation, and live execution within a single
event-driven architecture, with Python serving as the control plane for strategy logic,
configuration, and orchestration.
"""

import importlib.metadata as _metadata

from vibe_trader._libvibe import *  # noqa: F403 (undefined-local-with-import-star)


# Derive the version from installed distribution metadata so it always matches the built
# wheel. `_metadata` is underscore-aliased so the star import above cannot shadow it.
try:
    __version__ = _metadata.version("vibe-trader")
except _metadata.PackageNotFoundError:  # pragma: no cover
    __version__ = "unknown"
