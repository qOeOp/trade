"""One installed custody authority, derived from existing protected release metadata.

No environment/CLI override and no standalone fallback. Retained reads/STOP use
an authentic original snapshot; only new effects require current write authority.
"""

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import stat

from deploy import live_configuration as installed, release_host
from live import configuration, release, state

STATE = Path("/var/lib/trade-release")


def unavailable():
    return state.fail("LIVE_RELEASE_UNAVAILABLE", "the installed Live authority is unavailable or does not match")


def _identity(root: Path) -> tuple[tuple[int, int], tuple[int, int]]:
    if not root.is_absolute() or root.resolve() != root or root.is_symlink():
        raise unavailable()
    directory, lock = root.lstat(), (root / "account.lock").lstat()
    if (not stat.S_ISDIR(directory.st_mode) or directory.st_mode & 0o077
            or not stat.S_ISREG(lock.st_mode) or lock.st_mode & 0o077 or lock.st_uid != directory.st_uid):
        raise unavailable()
    return (directory.st_dev, directory.st_ino), (lock.st_dev, lock.st_ino)


def path(binding: release.Binding) -> Path:
    if binding.state != STATE:  # Binding itself refuses a web_name that is no release Web
        raise unavailable()
    return STATE / "live" / binding.web_name.removeprefix(release_host.WEB) / "configuration.json"


@dataclass(frozen=True)
class Authority:
    binding: release.Binding
    config: configuration.Configuration
    original: dict
    root_identity: tuple[int, int]
    lock_identity: tuple[int, int]

    @property
    def root(self) -> Path:
        return self.config.root

    def retained(self) -> None:
        """Original snapshot, directory and lock, without requiring current write ownership."""
        try:
            file = path(self.binding)
            value = installed.snapshot(file, file.parent / "socket/control.sock")
            if value != self.original or _identity(self.root) != (self.root_identity, self.lock_identity):
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
            if root != self.root:
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


def retained(config: configuration.Configuration | None, binding: release.Binding | None) -> Authority:
    """The binding's installed snapshot, read once; it must equal `config` when one is given."""
    try:
        if binding is None:
            raise unavailable()
        file = path(binding)
        value = installed.snapshot(file, file.parent / "socket/control.sock")
        found = configuration.parse(value)
        if config is not None and found != config:
            raise unavailable()
        return Authority(binding, found, value, *_identity(found.root))
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        raise unavailable() from None


def from_file(file: Path, binding: release.Binding | None) -> Authority:
    if binding is None or file != path(binding):
        raise unavailable()
    return retained(None, binding)


def inspection(file: Path) -> Authority:
    """Host release already holds the account lock; do not acquire it in its helper."""
    try:
        return from_file(file, release.Binding(STATE, release_host.WEB + file.parent.name))
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        raise unavailable() from None
