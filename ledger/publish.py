"""The public copy of a database on its `origin` remote (`ledger.publish`, `ledger.set_remote`).

The research ledger is public: it is pushed to its DoltHub repository by the service administrator,
in the compose ledger service's rounds (`ledger/service.py`) or by `ledger publish`; commands that change it only
commit locally. The repository's `main` holds the ledger in use (docs/plans/main-is-the-ledger-in-use-20261123.zh.md):
the local branch `main` is pushed as `main`, and only that branch is ever fetched (an explicit refspec, never the
remote's default `refs/heads/*`, which would copy every archived line's data; a fetch also brings the tags on the
fetched history, measured on Dolt 2.7.2). A ledger names its version line (shared/version.py) by the tag
`line/<line>` on its first commit, made with it (db.ledger_schema) and pushed with its first publication.

A publish pushes the branch without force and then
fetches to check that the remote's head contains the local one read before the push: it is that head,
or descends from it when another writer on the same service committed between the head read and the
push (the push names the branch, so it carried both commits). Publishes of one database are serialized
on its service by a named lock (`<database>/publish`), so concurrent publishers do not race their pushes;
one that finds the head already published by another skips the branch push after the fetch confirms
it. A rejected push is judged by that fetch too, before the rejection: a remote containing the local
head is published, a remote whose history neither contains the local head nor is an ancestor of it is
refused (`PUBLISH_REJECTED`) and nothing is pushed after it, and anything else is `PUBLISH_FAILED`, to
publish again. A ledger of another line than this code's is not published.

`replace` is the one forced push: a new line's first ledger takes `main` from the previous line's, which `archive`
has pushed to the branch named after that line and checked (ledger/service.py bootstrap). Archive branches are
pushed without force, so an archived line is never rewritten. `onto_main` is the one-time move of the v0.5 ledger,
which 0.5.3 published as the branch `v0.5`, onto `main` (removed in the next line).

The service runs with its own Dolt home (`<service>/home`), so the user's DoltHub key from `dolt
login` is copied there when an https remote is set. The service reads that key only when it starts
(measured on 2.4.2; not measured on 2.7.2, which needs a DoltHub login), so a key installed while it runs is named as needing a restart. A database that is not active publishes only to
a local `file://` remote, never to a public one.
"""

from __future__ import annotations

import csv
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time

import pymysql

from ledger import db, server
from shared.errors import Refusal
from shared.files import atomic_write
from shared.refusals import refuse
from shared.version import TAG as LINE_TAG, line, order, product_version, tag


PUBLISH_WAIT = 300  # seconds a publish waits for another publish of the database; a DoltHub push takes ~10 s
HOST = "https://doltremoteapi.dolthub.com/"
REPOSITORY = r"[A-Za-z0-9_-]+/[A-Za-z0-9_-]+"  # owner/repository
DOLTHUB = re.compile(re.escape(HOST) + REPOSITORY)  # the one DoltHub remote form: publish and the mirror accept it
LINE = line(product_version())  # this code's version line: the line of the ledgers it publishes
TAG = tag(LINE)  # db.line_tag()
# What a fetch of main answers when origin does not hold it: no branch at all, or no main (Dolt 2.7.2).
UNPUBLISHED = ("no branches found", "invalid ref spec")
TRACKING = f"remotes/{server.REMOTE}/{db.BRANCH}"  # origin's main as last fetched
BRANCHES = f"refs/heads/{db.BRANCH}:refs/{TRACKING}"  # the one branch ever fetched; named, so a missing one fails
PUSHED = f"{db.BRANCH}:{db.BRANCH}"
COMMIT = re.compile(r"[0-9a-v]{32}\Z")
LINE_TAGS = f"SELECT tag_name, tag_hash FROM dolt_tags WHERE LEFT(tag_name, {len(LINE_TAG)}) = '{LINE_TAG}'"
# The one-time move onto main (onto_main): the line 0.5.3 published as a branch, and the line before it, whose
# ledger (schema generation 1, no line tag) is on main until the move archives it.
MOVED_LINE, PREVIOUS_LINE, PREVIOUS_SCHEMA = "v0.5", "v0.4", 1


def ledger_line(select) -> str | None:
    """The line of the ledger whose main `select(statement)` reads (rows as tuples): the line tag on a commit of its
    history, None without one. Two would make the line ambiguous: refused. Each tag is looked up by hash, never by
    walking the history (DoltHub's SQL API times out on that over a few thousand commits, measured)."""
    found = []
    for name, commit in select(LINE_TAGS):
        if COMMIT.fullmatch(commit) and int(select(f"SELECT COUNT(*) FROM dolt_log WHERE commit_hash = '{commit}'")
                                            [0][0]):
            found.append(name.removeprefix(LINE_TAG))
    if len(found) > 1:
        raise refuse("LEDGER_UNKNOWN", f"the ledger carries several line tags ({', '.join(sorted(found))})")
    return found[0] if found else None


def cursor_line(cursor) -> str | None:
    return ledger_line(lambda statement: server.cursor_rows(cursor, statement))


def _tracked(cursor) -> list[str]:
    """The branches of origin the selected database tracks."""
    prefix = f"remotes/{server.REMOTE}/"
    return sorted(name.removeprefix(prefix) for (name,) in server.cursor_rows(
        cursor, "SELECT name FROM dolt_remote_branches") if name.startswith(prefix))


def where(profile: db.LedgerProfile) -> dict:
    """Where the database publishes, read with its reader account and no schema check (a deployment asks this of a
    ledger another version made): its origin's URL (None without one), the branches of origin it tracks (a published
    or fetched ledger tracks `main`; one 0.5.3 published tracks `v0.5`), its line (its line tag, None without one) and
    its local head."""
    config = server.service_config(profile.service_root) or {}
    accounts = config.get("databases", {}).get(profile.database, {})
    if "reader" not in accounts:
        raise refuse("LEDGER_UNKNOWN", f"the service of {profile.name} has no reader account for {profile.database}")
    raw = server.patient_connection(config, user=accounts["reader"]["user"], password=accounts["reader"]["password"],
                                    database=f"{profile.database}/{db.BRANCH}", autocommit=True, connect_timeout=5,
                                    read_timeout=60, write_timeout=60)
    try:
        with raw.cursor() as cursor:
            url = server.cursor_rows(cursor, "SELECT url FROM dolt_remotes WHERE name = %s", (server.REMOTE,))
            tracked = _tracked(cursor)
            (head,), = server.cursor_rows(cursor, "SELECT hash FROM dolt_branches WHERE name = %s", (db.BRANCH,))
            ledger = cursor_line(cursor)
    finally:
        raw.close()
    return {"remote": url[0][0] if url else None, "head": head, "tracked": tracked, "line": ledger}


def state(profile: db.LedgerProfile) -> dict:
    """Where the database is published and whether origin's last known head differs from the local branch, for a
    reader (local reads only; no network). A version's database lists no remotes (measured), so this reads the
    branch. When it differs, `behind_seconds` is the age of the oldest commit origin lacks (None when origin holds
    no branch) and `diverged` says origin's head is not an ancestor of the local one: its history changed
    elsewhere, which a retry cannot settle. All of it derives from the two heads."""
    with db.connect(profile, "reader") as conn:
        found = conn.rows("SELECT url FROM dolt_remotes WHERE name = %s", (server.REMOTE,))
        if not found:
            return {"remote": None, "unpublished": False, "behind_seconds": None, "diverged": False}
        local = conn.rows("SELECT hash FROM dolt_branches WHERE name = %s", (db.BRANCH,))
        remote = conn.rows("SELECT hash FROM dolt_remote_branches WHERE name = %s", (TRACKING,))
        behind, diverged = None, False
        if list(local) != list(remote) and remote:
            diverged = not _reader_ancestor(conn, remote[0][0], local[0][0])
            if not diverged:
                behind = conn.rows("SELECT TIMESTAMPDIFF(SECOND, MIN(date), UTC_TIMESTAMP()) FROM dolt_log(%s)",
                                   (f"{remote[0][0]}..{local[0][0]}",))[0][0]
    return {"remote": found[0][0], "unpublished": list(local) != list(remote), "behind_seconds": behind,
            "diverged": diverged}


def _reader_ancestor(conn, older: str, newer: str) -> bool:
    try:
        return conn.rows("SELECT DOLT_MERGE_BASE(%s, %s)", (older, newer))[0][0] == older
    except Refusal:  # unrelated histories have no merge base
        return False


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
        atomic_write(target, data, 0o600)
        changed = True
    config_path = home / "config_global.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        config = {}
    if config.get("user.creds") != key:
        atomic_write(config_path, json.dumps({**config, "user.creds": key}).encode(),
                     stat.S_IMODE(config_path.stat().st_mode) if config_path.exists() else None)
        changed = True
    return key, changed


def _managed(profile: db.LedgerProfile) -> bool:
    config = server.service_config(profile.service_root)
    return config is not None and server.managed(config)


def _key_after_start(profile: db.LedgerProfile) -> bool:
    """Whether the running service started before its DoltHub key was installed (`server.pid` is
    written at start), so it does not have the key yet."""
    root = Path(profile.service_root)
    home = root / "home" / ".dolt"
    try:
        key = json.loads((home / "config_global.json").read_text(encoding="utf-8"))["user.creds"]
        installed = max((home / "creds" / f"{key}.jwk").stat().st_mtime, (home / "config_global.json").stat().st_mtime)
        return server.server_pid(root) is not None and installed > (root / "server.pid").stat().st_mtime
    except (OSError, ValueError, KeyError, TypeError):
        return False


def set_remote(profile: db.LedgerProfile, url: str) -> dict:
    """Name `url` the database's origin (once; another origin is REMOTE_MISMATCH) and, for DoltHub,
    install the user's key in the service's Dolt home; `restart_required` says the running service
    must be restarted to use it."""
    _allowed(profile, url)
    key: str | None
    key, changed = (None, False) if url.startswith("file://") else install_key(Path(profile.service_root), _user_dolt())
    conn = server.admin(profile)
    try:
        with conn.cursor() as cursor:
            existing = server.origin(cursor)
            if existing is not None and existing != url:
                raise refuse("REMOTE_MISMATCH", f"{profile.database} already publishes to {existing}, not {url}",
                             missing=(url,))
            if existing is None:
                cursor.execute("CALL DOLT_REMOTE('add', %s, %s)", (server.REMOTE, url))
    finally:
        conn.close()
    return {"database": profile.database, "remote": url, "credentials": key, "added": existing is None,
            # A service compose runs keeps no start time here: a key it did not have needs a restart.
            "restart_required": key is not None and (changed if _managed(profile) else _key_after_start(profile))}


def name_and_publish(profile: db.LedgerProfile, url: str) -> tuple[dict, dict]:
    """Name `url` the origin and publish to it; an origin named here that took nothing is forgotten, so a mistyped
    repository or a key without access can be corrected. The results of `publish` and `set_remote`."""
    named = set_remote(profile, url)
    try:
        return publish(profile), named
    except Refusal:
        if named["added"]:
            conn = server.admin(profile)
            try:
                with conn.cursor() as cursor:
                    cursor.execute("CALL DOLT_REMOTE('remove', %s)", (server.REMOTE,))
            finally:
                conn.close()
        raise


def _push(cursor, profile: db.LedgerProfile, url: str, ref: str, force: bool = False) -> None:
    try:
        cursor.execute("CALL DOLT_PUSH(%s, %s, %s)" if force else "CALL DOLT_PUSH(%s, %s)",
                       ("--force", server.REMOTE, ref) if force else (server.REMOTE, ref))
        cursor.fetchall()
    except pymysql.MySQLError as exc:
        text = str(exc.args[1] if len(exc.args) > 1 else exc)
        if "rejected" in text or "non-fast-forward" in text:
            raise refuse("PUBLISH_REJECTED", f"{url} refused {ref} of {profile.database}: its history is not an "
                         "ancestor of the local one; nothing was forced", missing=(url,)) from exc
        denied = " Its DoltHub account must be able to write this repository." if "PermissionDenied" in text else ""
        restart = (" If its DoltHub key was installed after the service started, the service reads it only at "
                   "start: restart it (`docker compose restart ledger`) and publish again." if _managed(profile) else
                   " The running service started before its DoltHub key was installed and reads it only at "
                   "start: restart it (`ledger service stop`, then `ledger service start`) and publish again."
                   if _key_after_start(profile) else "")
        raise refuse("PUBLISH_FAILED", f"pushing {ref} of {profile.database} to {url} failed: {text.strip()}.{denied}{restart}",
                     missing=(url,)) from exc


def unpublished(profile: db.LedgerProfile) -> bool:
    return state(profile)["unpublished"]


def _remote_head(cursor, branch: str = db.BRANCH) -> str | None:
    found = server.cursor_rows(cursor, "SELECT hash FROM dolt_remote_branches WHERE name = %s",
                               (f"remotes/{server.REMOTE}/{branch}",))
    return found[0][0] if found else None


def _fetch(cursor, url: str, branch: str = db.BRANCH) -> str | None:
    """Fetch origin's `branch` (main); the remote's head of it. A remote without branches or without it (named
    explicitly, the branch spec fails rather than keeping the last tracking head) has no head."""
    try:
        cursor.execute("CALL DOLT_FETCH(%s, %s)",
                       (server.REMOTE, f"refs/heads/{branch}:refs/remotes/{server.REMOTE}/{branch}"))
        cursor.fetchall()
        return _remote_head(cursor, branch)
    except pymysql.MySQLError as exc:
        if any(text in str(exc.args[1] if len(exc.args) > 1 else exc) for text in UNPUBLISHED):
            return None
        raise refuse("PUBLISH_FAILED", f"{url} could not be fetched to check the push", missing=(url,)) from exc


def _ancestor(cursor, older: str, newer: str) -> bool:
    try:
        return server.cursor_rows(cursor, "SELECT DOLT_MERGE_BASE(%s, %s)", (older, newer))[0][0] == older
    except pymysql.MySQLError:  # unrelated histories have no merge base
        return False


def _contains(cursor, remote: str | None, head: str) -> bool:
    """Whether the remote's head is the local `head` or descends from it."""
    return remote is not None and (remote == head or _ancestor(cursor, head, remote))


def _own_line(cursor, profile: db.LedgerProfile) -> None:
    """Only a ledger of this code's line is published: one of another line belongs to another version."""
    found = cursor_line(cursor)
    if found != LINE:
        raise refuse("PUBLISH_FAILED", f"{profile.database} is a ledger of line {found or 'unknown (no line tag)'}, "
                     f"not {LINE}; nothing was published", missing=(TAG,))


def _locked(cursor, profile: db.LedgerProfile, timed) -> None:
    serial = f"{profile.database}/publish"
    if timed("lock", server.cursor_rows, cursor, "SELECT GET_LOCK(%s, %s)", (serial, PUBLISH_WAIT))[0][0] != 1:
        raise refuse("PUBLISH_FAILED", f"another publish of {profile.database} held {serial} for "
                     f"{PUBLISH_WAIT} s; nothing was published", missing=(serial,))


def _timer(seconds: dict):
    def timed(stage: str, call, *args):
        start = time.monotonic()
        try:
            return call(*args)
        finally:
            seconds[stage] += time.monotonic() - start
    return timed


def publish(profile: db.LedgerProfile) -> dict:
    """Push the branch and check by a fetch that the remote's head contains the local one read before the
    push, holding the database's publish lock. `head` of the result is the remote's head after that check;
    `seconds` is the wall time of each stage (waiting for the lock, the branch push, the fetches). The first
    publication to a remote without `main` pushes the ledger's line tag first."""
    seconds = dict.fromkeys(("lock", "push", "fetch"), 0.0)
    timed = _timer(seconds)
    conn = server.admin(profile)
    try:
        with conn.cursor() as cursor:
            url = server.origin(cursor)
            if url is None:
                raise refuse("REMOTE_UNSET", f"{profile.database} has no {server.REMOTE} remote", missing=(server.REMOTE,))
            _allowed(profile, url)
            _locked(cursor, profile, timed)
            onto_main(cursor, profile, url)
            _own_line(cursor, profile)
            (head,), = server.cursor_rows(cursor, "SELECT hash FROM dolt_branches WHERE name = %s", (db.BRANCH,))
            before = _remote_head(cursor)
            # A head another publish has pushed is confirmed by a fetch, and so is a remote never fetched yet.
            published = timed("fetch", _fetch, cursor, url) if before in (head, None) else before
            if published != head:
                rejected = None
                try:
                    if published is None:
                        timed("push", _push, cursor, profile, url, TAG)
                    timed("push", _push, cursor, profile, url, PUSHED)
                except Refusal as exc:
                    if exc.code != "PUBLISH_REJECTED":
                        raise
                    rejected = exc
                published = timed("fetch", _fetch, cursor, url)
                if not _contains(cursor, published, head):
                    if rejected is not None and published is not None and not _ancestor(cursor, published, head):
                        raise rejected
                    raise refuse("PUBLISH_FAILED", f"the head of {db.BRANCH} at {url} is {published or 'missing'}, "
                                 f"which does not contain {head}", missing=(url,))
            _drop_moved_branch(cursor, profile, url, published)
    finally:
        conn.close()  # also releases the publish lock
    return {"database": profile.database, "remote": url, "branch": db.BRANCH, "line": LINE, "head": published,
            "previous_head": before,
            "seconds": {stage: round(value, 3) for stage, value in seconds.items()}}


def replace(profile: db.LedgerProfile) -> dict:
    """Make the new ledger of this line the remote's `main` in place of the previous line's, which `archive` has
    pushed to that line's branch and checked: its line tag first, so `main` never holds it untagged, then `main`
    forced, then a fetch must show the local head. Only a new ledger's first start calls this (ledger/service.py)."""
    seconds = dict.fromkeys(("lock", "push", "fetch"), 0.0)
    timed = _timer(seconds)
    conn = server.admin(profile)
    try:
        with conn.cursor() as cursor:
            url = server.origin(cursor)
            if url is None:
                raise refuse("REMOTE_UNSET", f"{profile.database} has no {server.REMOTE} remote", missing=(server.REMOTE,))
            _allowed(profile, url)
            _locked(cursor, profile, timed)
            _own_line(cursor, profile)
            (head,), = server.cursor_rows(cursor, "SELECT hash FROM dolt_branches WHERE name = %s", (db.BRANCH,))
            timed("push", _push, cursor, profile, url, TAG)
            timed("push", _push, cursor, profile, url, PUSHED, True)
            published = timed("fetch", _fetch, cursor, url)
            if published != head:
                raise refuse("PUBLISH_FAILED", f"after replacing {db.BRANCH} at {url}, its head is "
                             f"{published or 'missing'}, not {head}", missing=(url,))
    finally:
        conn.close()
    return {"database": profile.database, "remote": url, "branch": db.BRANCH, "line": LINE, "head": published,
            "replaced": True, "seconds": {stage: round(value, 3) for stage, value in seconds.items()}}


# The remote's main read into a scratch Dolt directory with the Dolt CLI: a new line's first start reads the main it
# replaces there (its data directory, before the new ledger exists) and onto_main the previous generation's.

class DoltFailed(RuntimeError):
    """A Dolt command failed; its message is what Dolt printed."""


def dolt_cli(binary: str, directory: Path, environment: dict, *arguments: str) -> str:
    done = subprocess.run([binary, *arguments], cwd=directory, env=environment, capture_output=True, text=True,
                          check=False)
    if done.returncode:
        raise DoltFailed(done.stderr.strip() or done.stdout.strip())
    return done.stdout


def _cli_rows(binary: str, directory: Path, environment: dict, statement: str) -> list[tuple]:
    """The rows of `statement` on the directory's main, each as a tuple of strings in the order the statement selects
    (CSV keeps that order; Dolt's JSON sorts the columns by name, measured on 2.7.2)."""
    output = dolt_cli(binary, directory, environment, "sql", "-r", "csv", "-q", statement)
    return [tuple(row) for row in list(csv.reader(io.StringIO(output)))[1:]]


def read_main(binary: str, directory: Path, environment: dict, origin: str) -> dict | None:
    """Make the new `directory` a Dolt database whose `main` is origin's `main`, fetching only it (and the tags on
    its history); its `head`, `line` (None without a line tag), schema generation (`schema`, None without a
    ledger_schema) and whether it holds commit `contains(hash)`. None when origin holds no `main`. A failed step raises
    DoltFailed; the directory stays for the caller to remove."""
    directory.mkdir(mode=0o700)
    for arguments in (("init",), ("remote", "add", server.REMOTE, origin)):
        dolt_cli(binary, directory, environment, *arguments)
    try:
        dolt_cli(binary, directory, environment, "fetch", server.REMOTE, BRANCHES)
    except DoltFailed as failed:
        if any(text in str(failed) for text in UNPUBLISHED):
            return None
        raise
    dolt_cli(binary, directory, environment, "reset", "--hard", TRACKING)

    def select(statement: str) -> list[tuple]:
        return _cli_rows(binary, directory, environment, statement)

    (head,), = select("SELECT DOLT_HASHOF('main')")
    try:
        schema = select("SELECT version FROM ledger_schema WHERE singleton = 1")
    except DoltFailed:
        schema = []
    return {"head": head, "line": ledger_line(select), "schema": int(schema[0][0]) if schema else None,
            "contains": lambda commit: COMMIT.fullmatch(commit) is not None and int(select(
                f"SELECT COUNT(*) FROM dolt_log WHERE commit_hash = '{commit}'")[0][0]) > 0}


def archive(binary: str, directory: Path, environment: dict, branch: str, head: str) -> None:
    """Push commit `head` (origin's main, which read_main fetched into `directory`) to origin's branch `branch`, named
    after the line whose ledger it is, without force, and check by a fetch that the branch's head is `head`. A branch
    already there takes it only by fast-forward (one already at `head` is left as it is): an archived line is never
    rewritten, so a branch holding other history refuses (DoltFailed)."""
    if not COMMIT.fullmatch(head):
        raise DoltFailed(f"{head!r} is not a Dolt commit")
    order(branch)
    dolt_cli(binary, directory, environment, "push", server.REMOTE, f"{head}:{branch}")
    dolt_cli(binary, directory, environment, "fetch", server.REMOTE,
          f"refs/heads/{branch}:refs/remotes/{server.REMOTE}/{branch}")
    found = _cli_rows(binary, directory, environment,
                      f"SELECT hash FROM dolt_remote_branches WHERE name = 'remotes/{server.REMOTE}/{branch}'")
    if found != [(head,)]:
        raise DoltFailed(f"the archive branch {branch} holds {found[0][0] if found else 'nothing'}, not {head}")


def onto_main(cursor, profile: db.LedgerProfile, url: str) -> None:
    """The one-time move of a v0.5 ledger 0.5.3 published as origin's branch `v0.5` onto `main`, which holds the
    previous generation (line v0.4: schema generation 1, no line tag), under the publish lock; nothing for a ledger
    that tracks only `main`. Read origin's `main` into `<service>/line-archive` (removed after): unless it already is
    this ledger (an interrupted move), it must be the previous generation, which `archive` pushes to the branch `v0.4`
    and checks. Then the ledger gets its line tag, the tag is pushed, `main` is forced to the ledger and a fetch must
    show the local head. publish() then publishes as usual and _drop_moved_branch deletes `v0.5`. Every step can run
    again after an interruption. To be removed in the next line."""
    stale = [branch for branch in _tracked(cursor) if branch != db.BRANCH]
    if not stale:
        return
    if LINE != MOVED_LINE or stale != [MOVED_LINE]:
        raise refuse("PUBLISH_FAILED", f"{profile.database} tracks {', '.join(stale)} of {url}; this version publishes "
                     f"line {LINE} only as {db.BRANCH}, so nothing was published", missing=(url,))
    found = cursor_line(cursor)
    if found not in (None, LINE):
        raise refuse("PUBLISH_FAILED", f"{profile.database} is a ledger of line {found}, not {MOVED_LINE}",
                     missing=(TAG,))
    (root,), = server.cursor_rows(cursor, "SELECT commit_hash FROM dolt_log WHERE commit_order = 1")
    config = server.service_config(profile.service_root) or {}
    binary = server.binary(config.get("binary"))
    directory = Path(profile.service_root) / "line-archive"
    shutil.rmtree(directory, ignore_errors=True)
    try:
        environment = server.dolt_env(Path(profile.service_root) / "home")
        main = read_main(binary, directory, environment, url)
        if main is not None and main["line"] == LINE:
            if not main["contains"](root):
                raise refuse("PUBLISH_FAILED", f"{db.BRANCH} of {url} holds another ledger of line {LINE}; nothing "
                             "was published. Report it: that branch is the owner's to look at", missing=(url,))
            replacing = False  # an interrupted move already put the ledger there
        elif main is not None and (main["line"] is not None or main["schema"] != PREVIOUS_SCHEMA
                                   or main["contains"](root)):
            raise refuse("PUBLISH_FAILED", f"{db.BRANCH} of {url} holds neither this ledger nor the previous "
                         f"generation (line {main['line']}, schema generation {main['schema']}); nothing was "
                         "published. Report it: that branch is the owner's to look at", missing=(url,))
        else:
            if main is not None:
                archive(binary, directory, environment, PREVIOUS_LINE, main["head"])
            replacing = main is not None
    except DoltFailed as failed:
        raise refuse("PUBLISH_FAILED", f"moving the ledger onto {db.BRANCH} of {url} failed: {str(failed)[-300:]}",
                     missing=(url,)) from failed
    finally:
        shutil.rmtree(directory, ignore_errors=True)
    if found is None:
        cursor.execute("CALL DOLT_TAG(%s, %s)", (TAG, root))
        cursor.fetchall()
    if replacing:
        (head,), = server.cursor_rows(cursor, "SELECT hash FROM dolt_branches WHERE name = %s", (db.BRANCH,))
        _push(cursor, profile, url, TAG)
        _push(cursor, profile, url, PUSHED, True)
        if not _contains(cursor, _fetch(cursor, url), head):
            raise refuse("PUBLISH_FAILED", f"after moving the ledger onto {db.BRANCH} of {url}, it does not hold "
                         f"{head}", missing=(url,))


def _drop_moved_branch(cursor, profile: db.LedgerProfile, url: str, published: str | None) -> None:
    """The last step of onto_main: delete origin's `v0.5` once origin's `main` (`published`, just checked) holds its
    head, so the ledger has one public copy; a `v0.5` already gone leaves only the tracking branch to remove."""
    if MOVED_LINE not in _tracked(cursor):
        return
    held = _fetch(cursor, url, MOVED_LINE)
    if held is None:
        cursor.execute("CALL DOLT_BRANCH('-d', '-r', %s)", (f"{server.REMOTE}/{MOVED_LINE}",))
        cursor.fetchall()
        return
    if not _contains(cursor, published, held):
        raise refuse("PUBLISH_FAILED", f"{db.BRANCH} of {url} does not hold the head {held} of {MOVED_LINE}, so "
                     f"{MOVED_LINE} stays", missing=(url,))
    _push(cursor, profile, url, f":{MOVED_LINE}")  # removes the tracking branch too
