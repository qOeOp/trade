from vibe_trader._fixup import fixup_module_names
from vibe_trader._libvibe.indicators import *  # noqa: F403 (undefined-local-with-import-star)


fixup_module_names(globals(), __name__)
del fixup_module_names
