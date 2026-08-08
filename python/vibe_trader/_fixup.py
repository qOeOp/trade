def fixup_module_names(namespace: dict, target_module: str) -> None:
    """
    Reassign ``__module__`` on PyO3 types re-exported via star imports.

    The Rust extension registers types under internal submodule paths. When a
    Python ``__init__.py`` does
    ``from vibe_trader._libvibe.<sub> import *``, the types land in the
    right namespace but their ``__module__`` can still point to the internal
    path. This breaks ``pickle`` because Python cannot resolve the internal path
    at import time.

    Call this at the bottom of each ``__init__.py`` that re-exports from
    ``_libvibe``::

        from vibe_trader._fixup import fixup_module_names

        fixup_module_names(globals(), __name__)

    """
    for name, obj in namespace.items():
        module = getattr(obj, "__module__", "")
        if _should_fixup_module_name(name, obj, module, target_module):
            try:
                obj.__module__ = target_module
            except (AttributeError, TypeError):
                continue


def _should_fixup_module_name(
    name: str,
    obj: object,
    module: str,
    target_module: str,
) -> bool:
    if not module or name.startswith("_"):
        return False

    if module == target_module or module.startswith(f"{target_module}."):
        return False

    object_name = getattr(obj, "__name__", None)
    if object_name is not None and object_name != name:
        return False

    return module.startswith("vibe_trader._") or not module.startswith("vibe_trader.")
