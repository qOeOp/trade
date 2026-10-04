from __future__ import annotations

from vibe_trading._libvibe.model import *  # noqa: F403 (undefined-local-with-import-star)


try:  # pragma: no cover - optional extension may be absent
    from vibe_trading._libvibe.blockchain import Blockchain as _Blockchain
    from vibe_trading._libvibe.blockchain import Chain as _Chain
    from vibe_trading._libvibe.blockchain import Dex as _Dex  # type: ignore[attr-defined]
    from vibe_trading._libvibe.blockchain import DexType as _DexType
except ImportError:

    class _Blockchain:  # type: ignore[too-many-ancestors]
        ...

    class _Chain:  # type: ignore[too-many-ancestors]
        ...

    class _Dex:  # type: ignore[too-many-ancestors]
        ...

    class _DexType:  # type: ignore[too-many-ancestors]
        ...

else:
    Blockchain = _Blockchain
    Chain = _Chain
    Dex = _Dex
    DexType = _DexType

from vibe_trading._fixup import fixup_module_names


fixup_module_names(globals(), __name__)
del fixup_module_names
