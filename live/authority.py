"""One installed custody authority, derived from existing protected release metadata.

No environment/CLI override and no standalone fallback. Retained reads/STOP use
an authentic original snapshot; only new effects require current write authority.
"""

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import stat

from deploy import live_configuration as installed
from engine.live_errors import LiveRefusal
from live import configuration, release, state

STATE = Path("/var/lib/trade-release")


def unavailable():
    return state.fail("LIVE_RELEASE_UNAVAILABLE", "the installed Live authority is unavailable or does not match")


def _lock(root: Path) -> tuple[int, int]:
    if not root.is_absolute() or root.resolve() != root or root.is_symlink():
        raise unavailable()
    directory, lock = root.lstat(), (root / "account.lock").lstat()
    if (not stat.S_ISDIR(directory.st_mode) or directory.st_mode & 0o077
            or not stat.S_ISREG(lock.st_mode) or lock.st_mode & 0o077 or lock.st_uid != directory.st_uid):
        raise unavailable()
    return lock.st_dev, lock.st_ino


def path(binding: release.Binding) -> Path:
    if binding.state != STATE or not release.WEB.fullmatch(binding.web_name):
        raise unavailable()
    return STATE / "live" / binding.web_name.removeprefix("trade-release-web-") / "configuration.json"


@dataclass(frozen=True)
class Authority:
    binding: release.Binding
    config: configuration.Configuration
    original: dict
    lock_identity: tuple[int, int]

    @property
    def root(self) -> Path:
        return self.config.root

    def retained(self) -> None:
        """Original snapshot and inode, without requiring current write ownership."""
        try:
            file = path(self.binding)
            value = installed.snapshot(file, file.parent / "socket/control.sock")
            if value != self.original or _lock(self.root) != self.lock_identity:
                raise unavailable()
        except (OSError, ValueError, RuntimeError, KeyError, TypeError):
            raise unavailable() from None

    @contextmanager
    def serialized(self, root: Path):
        if root != self.root:
            raise unavailable()
        with state.existing(root, exclusive=True) as locked:
            self.retained()
            yield locked

    def admit_locked(self, root: Path, *, maintenance: bool = False, inventory: bool = True) -> None:
        self.retained()
        try:
            declared = installed.declaration(STATE / "live/configuration.json")
            if (root != self.root or declared["root"] != str(root)
                    or any(declared[key] != self.original[key] for key in installed.OPERATOR_FIELDS)):
                raise unavailable()
            release.admission_locked(self.binding, maintenance=maintenance)
        except (OSError, ValueError, RuntimeError, KeyError, TypeError):
            raise unavailable() from None
        if inventory and not maintenance:
            from live.inventory import require_clear
            require_clear(root)

    @contextmanager
    def mutation(self, *, maintenance: bool = False):
        with self.serialized(self.root) as root:
            self.admit_locked(root, maintenance=maintenance)
            yield root


def retained(config: configuration.Configuration, binding: release.Binding | None) -> Authority:
    try:
        if binding is None:
            raise unavailable()
        file = path(binding)
        value = installed.snapshot(file, file.parent / "socket/control.sock")
        if configuration.load(file) != config:
            raise unavailable()
        return Authority(binding, config, value, _lock(config.root))
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        raise unavailable() from None


def from_file(file: Path, binding: release.Binding | None) -> Authority:
    if binding is None or file != path(binding):
        raise unavailable()
    return retained(configuration.load(file), binding)


def operator(root: Path, web_name: str) -> Authority:
    """Assert the root and selected service release; the current route never assigns caller identity."""
    try:
        declared = installed.declaration(STATE / "live/configuration.json")
        if root != Path(declared["root"]):
            raise state.fail("LIVE_IDENTITY_CHANGED", "use the installed canonical Live custody root")
        binding = release.Binding(STATE, web_name)
        result = from_file(path(binding), binding)
        # Initial proof precedes profile/credential reads; the locked effect repeats it.
        result.admit_locked(root, inventory=False)
        return result
    except LiveRefusal:
        raise
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        raise unavailable() from None


def inspection(file: Path) -> Authority:
    """Host release already holds the account lock; do not acquire it in its helper."""
    try:
        binding = release.Binding(STATE, "trade-release-web-" + file.parent.name)
        result = from_file(file, binding)
        result.retained()
        declared = installed.declaration(STATE / "live/configuration.json")
        if any(declared[key] != result.original[key] for key in installed.OPERATOR_FIELDS):
            raise unavailable()
        return result
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        raise unavailable() from None
