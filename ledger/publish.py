"""The public copy of a database on its `origin` remote (`ledger.publish`, `ledger.set_remote`).

The research ledger and the market database are public: each is pushed to its DoltHub repository
by the service administrator after it changes. A publish pushes the branch without force and then
fetches to check that the remote's head contains the local one read before the push: it is that head,
or descends from it when another writer on the same service committed between the head read and the
push (the push names the branch, so it carried both commits). Publishes of one database are serialized
on its service by a named lock (`<database>/publish`), so concurrent commands do not race their pushes;
one that finds the head already published by another skips the branch push after the fetch confirms
it. A rejected push is judged by that fetch too, before the rejection: a remote containing the local
head is published, a remote whose history neither contains the local head nor is an ancestor of it is
refused (`PUBLISH_REJECTED`) and nothing is pushed after it, and anything else is `PUBLISH_FAILED`, to
publish again. Tags follow the branch one by one
(Dolt 2.4.2 has no `--tags` push), only once the branch is published: a pushed tag replaces a
different remote tag of the same name without a warning (measured), and the product never moves a
tag, so a differing remote tag can only follow a remote whose branch the check has already refused.

The service runs with its own Dolt home (`<service>/home`), so the user's DoltHub key from `dolt
login` is copied there when an https remote is set. The service reads that key only when it starts
(measured on 2.4.2), so a key installed while it runs is named as needing a restart. A database that is not active publishes only to
a local `file://` remote, never to a public one. The market database is published holding its
import lock as well, taken after the publish lock, so no import lands during the push.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import time

import pymysql

from ledger import db
from ledger.errors import Refusal
from ledger.refusals import refuse


REMOTE = "origin"
PUBLISH_WAIT = 300  # seconds a publish waits for another publish of the database; a DoltHub push takes ~10 s
DOLTHUB = re.compile(r"https://doltremoteapi\.dolthub\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+")


def _admin(profile: db.LedgerProfile):
    config = db._known_service(profile.service_root)
    password = db._root_password(config)
    try:
        return db.service_connection(config, user="root", password=password,
                                     database=profile.database, autocommit=True, connect_timeout=5)
    except pymysql.MySQLError as exc:
        raise refuse("LEDGER_UNAVAILABLE", "the service administrator could not connect to publish") from exc


def _rows(cursor, statement: str, arguments=()) -> list[tuple]:
    cursor.execute(statement, arguments)
    return list(cursor.fetchall())


def _origin(cursor) -> str | None:
    found = _rows(cursor, "SELECT url FROM dolt_remotes WHERE name = %s", (REMOTE,))
    return found[0][0] if found else None


def _allowed(profile: db.LedgerProfile, url: str) -> None:
    if url.startswith("file://"):
        return
    if profile.kind != "active":
        raise refuse("PUBLISH_FORBIDDEN", f"{profile.name} is a {profile.kind} database; it publishes only to a local "
                     "file:// remote", missing=(url,))
    if not DOLTHUB.fullmatch(url):
        raise refuse("REMOTE_INVALID", f"{url} is neither a DoltHub repository nor a file:// remote",
                     expected="https://doltremoteapi.dolthub.com/<owner>/<repository> or file:///<path>")


def _user_dolt() -> Path:
    return Path(os.environ.get("DOLT_ROOT_PATH") or Path.home()).expanduser() / ".dolt"


def _install_key(profile: db.LedgerProfile) -> str:
    """Copy the user's DoltHub key (`dolt login`) into the service's Dolt home and name it there."""
    return install_key(Path(profile.service_root), _user_dolt())[0]


def install_key(service_root: Path, source: Path) -> tuple[str, bool]:
    """Copy the DoltHub key of the Dolt home `source` (a `dolt login` ~/.dolt) into the Dolt home of the
    service at `service_root` and name it there; whether that changed anything."""
    changed = False
    try:
        key = json.loads((source / "config_global.json").read_text(encoding="utf-8"))["user.creds"]
        data = (source / "creds" / f"{key}.jwk").read_bytes()
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise refuse("DOLTHUB_CREDENTIALS", f"no DoltHub key from `dolt login` under {source}",
                     missing=(str(source / "creds"),)) from exc
    home = Path(service_root) / "home" / ".dolt"
    (home / "creds").mkdir(mode=0o700, parents=True, exist_ok=True)
    target = home / "creds" / f"{key}.jwk"
    if not target.exists() or target.read_bytes() != data:  # an unchanged key keeps its install time
        with open(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as stream:
            stream.write(data)
        changed = True
    config_path = home / "config_global.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        config = {}
    if config.get("user.creds") != key:
        temporary = config_path.with_name(f".{config_path.name}.publish")
        temporary.write_text(json.dumps({**config, "user.creds": key}), encoding="utf-8")
        if config_path.exists():
            shutil.copymode(config_path, temporary)
        os.replace(temporary, config_path)
        changed = True
    return key, changed


def _managed(profile: db.LedgerProfile) -> bool:
    config = db._service(profile.service_root)
    return config is not None and db.managed(config)


def _key_after_start(profile: db.LedgerProfile) -> bool:
    """Whether the running service started before its DoltHub key was installed (`server.pid` is
    written at start), so it does not have the key yet."""
    root = Path(profile.service_root)
    home = root / "home" / ".dolt"
    try:
        key = json.loads((home / "config_global.json").read_text(encoding="utf-8"))["user.creds"]
        installed = max((home / "creds" / f"{key}.jwk").stat().st_mtime, (home / "config_global.json").stat().st_mtime)
        return db._pid(root) is not None and installed > (root / "server.pid").stat().st_mtime
    except (OSError, ValueError, KeyError, TypeError):
        return False


def set_remote(profile: db.LedgerProfile, url: str) -> dict:
    """Name `url` the database's origin (once; another origin is REMOTE_MISMATCH) and, for DoltHub,
    install the user's key in the service's Dolt home; `restart_required` says the running service
    must be restarted to use it."""
    _allowed(profile, url)
    key: str | None
    key, changed = (None, False) if url.startswith("file://") else install_key(Path(profile.service_root), _user_dolt())
    conn = _admin(profile)
    try:
        with conn.cursor() as cursor:
            existing = _origin(cursor)
            if existing is not None and existing != url:
                raise refuse("REMOTE_MISMATCH", f"{profile.database} already publishes to {existing}, not {url}",
                             missing=(url,))
            if existing is None:
                cursor.execute("CALL DOLT_REMOTE('add', %s, %s)", (REMOTE, url))
    finally:
        conn.close()
    return {"database": profile.database, "remote": url, "credentials": key, "added": existing is None,
            # A service compose runs keeps no start time here: a key it did not have needs a restart.
            "restart_required": key is not None and (changed if _managed(profile) else _key_after_start(profile))}


def _push(cursor, profile: db.LedgerProfile, url: str, ref: str) -> None:
    try:
        cursor.execute("CALL DOLT_PUSH(%s, %s)", (REMOTE, ref))
        cursor.fetchall()
    except pymysql.MySQLError as exc:
        text = str(exc.args[1] if len(exc.args) > 1 else exc)
        if "rejected" in text or "non-fast-forward" in text:
            raise refuse("PUBLISH_REJECTED", f"{url} refused {ref} of {profile.database}: its history is not an "
                         "ancestor of the local one; nothing was forced", missing=(url,)) from exc
        restart = (" If its DoltHub key was installed after the service started, the service reads it only at "
                   "start: restart it (`docker compose restart ledger`) and publish again." if _managed(profile) else
                   " The running service started before its DoltHub key was installed and reads it only at "
                   "start: restart it (`ledger service stop`, then `ledger service start`) and publish again."
                   if _key_after_start(profile) else "")
        raise refuse("PUBLISH_FAILED", f"pushing {ref} of {profile.database} to {url} failed: {text.strip()}.{restart}",
                     missing=(url,)) from exc


def unpublished(profile: db.LedgerProfile, branch: str) -> bool:
    """Whether the database has an origin whose last known head differs from the local branch (local
    reads only; no network)."""
    conn = _admin(profile)
    try:
        with conn.cursor() as cursor:
            if _origin(cursor) is None:
                return False
            local = _rows(cursor, "SELECT hash FROM dolt_branches WHERE name = %s", (branch,))
            remote = _rows(cursor, "SELECT hash FROM dolt_remote_branches WHERE name = %s",
                           (f"remotes/{REMOTE}/{branch}",))
            return local != remote
    finally:
        conn.close()


def _remote_head(cursor, branch: str) -> str | None:
    found = _rows(cursor, "SELECT hash FROM dolt_remote_branches WHERE name = %s", (f"remotes/{REMOTE}/{branch}",))
    return found[0][0] if found else None


def _fetch(cursor, url: str, branch: str) -> str | None:
    try:
        cursor.execute("CALL DOLT_FETCH(%s)", (REMOTE,))
        cursor.fetchall()
    except pymysql.MySQLError as exc:
        raise refuse("PUBLISH_FAILED", f"{url} could not be fetched to check the push", missing=(url,)) from exc
    return _remote_head(cursor, branch)


def _ancestor(cursor, older: str, newer: str) -> bool:
    try:
        return _rows(cursor, "SELECT DOLT_MERGE_BASE(%s, %s)", (older, newer))[0][0] == older
    except pymysql.MySQLError:  # unrelated histories have no merge base
        return False


def _contains(cursor, remote: str | None, head: str) -> bool:
    """Whether the remote's head is the local `head` or descends from it."""
    return remote is not None and (remote == head or _ancestor(cursor, head, remote))


def publish(profile: db.LedgerProfile, branch: str, lock: str | None = None) -> dict:
    """Push `branch` and then every tag to origin, and check by a fetch that the remote's head contains
    the local one read before the push, holding the database's publish lock. With `lock` (the market
    import lock) no write lands during the push. `head` of the result is the remote's head after that
    check; `seconds` is the wall time of each stage (waiting for the locks, the branch push, the
    fetches, the tag pushes)."""
    seconds = dict.fromkeys(("lock", "push", "fetch", "tags"), 0.0)

    def timed(stage: str, call, *args):
        start = time.monotonic()
        try:
            return call(*args)
        finally:
            seconds[stage] += time.monotonic() - start

    conn = _admin(profile)
    try:
        with conn.cursor() as cursor:
            url = _origin(cursor)
            if url is None:
                raise refuse("REMOTE_UNSET", f"{profile.database} has no {REMOTE} remote", missing=(REMOTE,))
            _allowed(profile, url)
            serial = f"{profile.database}/publish"
            if timed("lock", _rows, cursor, "SELECT GET_LOCK(%s, %s)", (serial, PUBLISH_WAIT))[0][0] != 1:
                raise refuse("PUBLISH_FAILED", f"another publish of {profile.database} held {serial} for "
                             f"{PUBLISH_WAIT} s; nothing was published", missing=(serial,))
            if lock is not None:
                if _rows(cursor, "SELECT GET_LOCK(%s, 0)", (lock,))[0][0] != 1:
                    raise refuse("CONCURRENT_IMPORT", f"an import of {profile.database} holds {lock}; nothing was "
                                 "published", missing=(lock,))
            (head,), = _rows(cursor, "SELECT hash FROM dolt_branches WHERE name = %s", (branch,))
            before = _remote_head(cursor, branch)
            # A head another publish has pushed is confirmed by a fetch before its tags follow.
            published = timed("fetch", _fetch, cursor, url, branch) if before == head else before
            if published != head:
                rejected = None
                try:
                    timed("push", _push, cursor, profile, url, branch)
                except Refusal as exc:
                    if exc.code != "PUBLISH_REJECTED":
                        raise
                    rejected = exc
                published = timed("fetch", _fetch, cursor, url, branch)
                if not _contains(cursor, published, head):
                    if rejected is not None and published is not None and not _ancestor(cursor, published, head):
                        raise rejected
                    raise refuse("PUBLISH_FAILED", f"the head of {branch} at {url} is {published or 'missing'}, "
                                 f"which does not contain {head}", missing=(url,))
            tags = [name for (name,) in _rows(cursor, "SELECT tag_name FROM dolt_tags ORDER BY tag_name")]
            for name in tags:
                timed("tags", _push, cursor, profile, url, f"refs/tags/{name}")
    finally:
        conn.close()  # also releases the publish and import locks
    return {"database": profile.database, "remote": url, "branch": branch, "head": published,
            "previous_head": before, "tags": len(tags),
            "seconds": {stage: round(value, 3) for stage, value in seconds.items()}}
