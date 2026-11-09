"""Telegram notices of retained Live run facts, sent by the control; never a venue call or a run effect.

Private files under LIVE_ROOT/notify (0700), written only by the control and its fixed CLI:
- telegram.json (0600): the bot token and the one private chat it is bound to. Saved only with its chat.
- state.json (0600): what has been sent, so a restart or a second control never resends.
- lock: one sender per tick; the settings commands wait up to WAIT seconds for it.
No read route returns the token, and it never reaches a log, argv, env or exception text.
docs/plans/live-telegram-notify-20261110.zh.md records the decision.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import contextmanager
import copy
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import stat
import time
import urllib.error
import urllib.request

from live import configuration, runs, state, views


ACTIONS = frozenset({"notify_save", "notify_test", "notify_remove"})
TOKEN = re.compile(r"[0-9]{1,20}:[A-Za-z0-9_-]{20,100}\Z")
REASON = re.compile(r"[A-Za-z0-9_.:-]{1,64}\Z")
FORMAT = "live-notify-v1"
FRESH: dict = {"format": FORMAT, "done": [], "attempts": {}, "closed": [], "last_sent_ns": None,
               "last_error": None, "dropped": 0}
TIMEOUT = 10
BACKOFF_NS = 10 * 10**9  # doubles per failure up to MAX_BACKOFF_NS; only a refused message (4xx but 429) is dropped
MAX_BACKOFF_NS = 300 * 10**9
MAX_PER_TICK = 5
WAIT = 30  # seconds a settings command waits for a sending control
DAILY = "@daily:"  # a run ID never holds "@", so a run's "<run_id>:" keys never match a summary key
FINAL = frozenset({"clean_stopped", "reconciled_flat", "venue_flat", "not_armed"})
NAMES = {"clean_stopped": "stopped flat", "reconciled_flat": "reconciled flat", "venue_flat": "flat at Binance",
         "not_armed": "ended before arming, no order placed"}
DAY_NS = 86_400 * 10**9


class Failure(Exception):
    """A Telegram call that did not succeed: only an HTTP status class or `network`, never the URL."""

    def __init__(self, code: str, status: int | None = None):
        super().__init__(code)
        self.code, self.status = code, status


Call = Callable[[str, str, dict], dict]


def telegram(token: str, method: str, payload: dict) -> dict:
    request = urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}",
                                     data=json.dumps(payload).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            value = json.loads(response.read(1 << 20))
    except urllib.error.HTTPError as exc:
        status = exc.code
        exc.close()
        raise Failure(f"http_{status // 100}xx", status) from None
    except Exception:  # URLError, timeouts, http.client protocol errors and unreadable bodies
        raise Failure("network") from None
    if not isinstance(value, dict) or value.get("ok") is not True:
        raise Failure("response")
    return value


def _store():
    return state.fail("LIVE_NOTIFY_STORE", "the private notification settings are unavailable")


def _private(path: Path, kind: int) -> bool:
    """Metadata only. Absent is False; anything but a private file or directory of this kind is unavailable."""
    try:
        mode = path.lstat()
    except FileNotFoundError:
        return False
    if stat.S_IFMT(mode.st_mode) != kind or mode.st_mode & 0o077:
        raise _store()
    return True


def _replace(path: Path, data: bytes) -> None:
    temporary = path.with_name("." + path.name + "." + secrets.token_hex(8))
    try:
        state.write_new(temporary, data)
        os.replace(temporary, path)
        state.fsync_parent(path)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise _store() from None


@contextmanager
def _locked(directory: Path, *, wait: float = 0):
    """Yield whether this process holds notify/lock, trying for up to `wait` seconds."""
    descriptor = os.open(directory / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise _store()
        deadline = time.monotonic() + wait
        while True:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    acquired = False
                    break
                time.sleep(.2)
        yield acquired


def _settings(directory: Path) -> tuple[str, int]:
    path = directory / "telegram.json"
    if not _private(path, stat.S_IFREG):
        raise state.fail("LIVE_NOTIFY_UNCONFIGURED", "no Telegram bot token is saved")
    try:
        value = state.read(path)
    except Exception:
        raise _store() from None
    token, chat = value.get("bot_token"), value.get("chat_id")
    if set(value) != {"bot_token", "chat_id"} or not isinstance(token, str) or not TOKEN.fullmatch(token) \
            or type(chat) is not int:
        raise _store()
    return token, chat


def _load(directory: Path) -> dict:
    path = directory / "state.json"
    if not _private(path, stat.S_IFREG):
        return copy.deepcopy(FRESH)
    try:
        value = state.read(path)
    except Exception:
        raise _store() from None
    if value.get("format") != FORMAT or set(value) != set(FRESH):
        raise _store()
    return value


def _save(directory: Path, value: dict) -> None:
    _replace(directory / "state.json", state.encode(value))


def view(root: Path) -> dict:
    """The page's nonsecret status; reads only metadata of the token file."""
    result: dict = {"configured": False, "last_sent_ns": None, "last_error": None, "dropped": 0}
    directory = root / "notify"
    try:
        if not _private(directory, stat.S_IFDIR):
            return result
        result["configured"] = _private(directory / "telegram.json", stat.S_IFREG)
        record = _load(directory)
        error = record["last_error"]
        result.update(last_sent_ns=None if record["last_sent_ns"] is None else str(record["last_sent_ns"]),
                      last_error=None if error is None else {"code": error["code"], "at_ns": str(error["at_ns"])},
                      dropped=record["dropped"])
    except Exception:
        result["last_error"] = {"code": "unavailable", "at_ns": None}
    return result


def _chats(updates: dict) -> set[int]:
    chats = set()
    for update in updates.get("result") or []:
        for name in ("message", "edited_message"):
            message = update.get(name) if isinstance(update, dict) else None
            chat = message.get("chat") if isinstance(message, dict) else None
            if isinstance(chat, dict) and chat.get("type") == "private" and type(chat.get("id")) is int:
                chats.add(chat["id"])
    return chats


def execute(config: configuration.Configuration, action: str, body: dict, *, call: Call = telegram) -> dict:
    """The page's settings commands. Not account operations: no request journal and no account lock."""
    if action == "notify_save":
        configuration.fields(body, {"bot_token"})
        token = body["bot_token"]
        if not isinstance(token, str) or not TOKEN.fullmatch(token):
            raise state.fail("LIVE_NOTIFY_TOKEN", "the bot token is malformed")
    elif action in ACTIONS:
        configuration.fields(body, set())
    else:
        raise configuration.fail()
    directory = state.private_directory(config.root / "notify")
    with _locked(directory, wait=WAIT) as acquired:
        if not acquired:
            raise state.fail("LIVE_NOTIFY_BUSY", "another control is sending notifications")
        if action == "notify_remove":
            for name in ("telegram.json", "state.json"):
                path = directory / name
                _private(path, stat.S_IFREG)
                path.unlink(missing_ok=True)
            state.fsync_parent(directory / "telegram.json")
            return view(config.root)
        record = _load(directory)
        if action == "notify_save":
            try:
                chats = _chats(call(token, "getUpdates", {"timeout": 0}))
            except Failure as exc:
                raise (state.fail("LIVE_NOTIFY_TOKEN", "Telegram did not accept the bot token")
                       if exc.status in {401, 404} else state.fail("LIVE_NOTIFY_TELEGRAM", "Telegram did not answer")) from None
            if not chats:
                raise state.fail("LIVE_NOTIFY_NO_CHAT", "no private chat has messaged this bot")
            if len(chats) > 1:
                raise state.fail("LIVE_NOTIFY_CHATS", "more than one private chat has messaged this bot")
            _replace(directory / "telegram.json", state.encode({"bot_token": token, "chat_id": chats.pop()}))
            record["last_error"] = None
        else:
            token, chat = _settings(directory)
            now = time.time_ns()
            try:
                call(token, "sendMessage", {"chat_id": chat, "text": "Test message from the Live control. Run "
                                            "starts and ends, fills, runs needing attention and a daily summary "
                                            "come to this chat."})
            except Failure as exc:
                record["last_error"] = {"code": exc.code, "at_ns": now}
                _save(directory, record)
                raise state.fail("LIVE_NOTIFY_TELEGRAM", "Telegram did not deliver the test message") from None
            record.update(last_sent_ns=now, last_error=None)
        _save(directory, record)
    return view(config.root)


# Messages. Each has a stable key; a key in `done` is never sent again.

def _source_name(config: configuration.Configuration, run: dict) -> str:
    """The candidate version the page shows for this run's source; a controlled-test adaptation says so."""
    source, origin = run.get("source") or {}, run.get("origin_candidate") or {}
    found = next((item for item in config.sources.values()
                  if item.source_sha256 == source.get("source_sha256") and item.entry_class == source.get("entry_class")),
                 None)
    if found is not None:
        return found.candidate + (", controlled test" if found.purpose == "controlled" else "")
    return f"{origin.get('strategy_id') or 'unknown'}@{origin.get('revision') or '?'}"


def collect(config: configuration.Configuration, skip: set[str]) -> list[dict]:
    """The browser-safe view of each retained run not yet closed, with its source id and safe stop reason."""
    directory = config.root / "runs"
    if directory.is_symlink() or not directory.is_dir():
        return []
    result = []
    for path in sorted(directory.iterdir()):
        if path.name in skip or not state.RUN_ID.fullmatch(path.name):
            continue
        try:
            run = views.run_view(config.root, path.name)
            reason = runs._stop_reason(path)
        except Exception:
            continue  # unknown this tick; never a reason to stop the others
        run["source_name"] = _source_name(config, run)
        run["stop_reason"] = reason if isinstance(reason, str) and REASON.fullmatch(reason) else (
            None if reason is None else "other")
        result.append(run)
    return result


def _fills(run: dict) -> list[dict]:
    return [row for row in run.get("orders") or [] if row.get("event_type") == "OrderFilled"]


def _fill_key(run: dict, row: dict) -> str:
    return f"{run['run_id']}:fill:{row.get('client_order_id')}:{row.get('trade_id')}:{row.get('ts_event')}"


def _result(run: dict) -> str | None:
    return next((value for _, value in reversed(run.get("minute_results") or []) if value is not None), None)


def messages(run: dict) -> list[tuple[str, str]]:
    """(key, text) for what this run's current facts say, in order."""
    run_id, host = run["run_id"], run.get("host") or {}
    name = f"Live run {run_id} ({run.get('source_name')})"
    current, mode, terminal = host.get("state"), host.get("mode"), run.get("terminal") or {}
    reason = f" Stop reason: {run['stop_reason']}." if run.get("stop_reason") else ""
    result = []
    if current == "running" and mode in {"run", "reconcile"}:
        result.append((f"{run_id}:running:{mode}",
                       f"{name} started." if mode == "run" else f"{name} is reconciling with Binance."))
    for row in _fills(run):
        result.append((_fill_key(run, row), f"{name} fill: {row.get('order_side') or 'side unknown'} "
                       f"{row.get('last_qty') or '?'} {row.get('instrument_id') or ''} at {row.get('last_px') or '?'}."))
    if current in FINAL:
        attention = []
        if type(host.get("exit_code")) is int and host["exit_code"] != 0:
            attention.append(f"exit code {host['exit_code']}")
        if terminal.get("source_failed") is True:
            attention.append("the strategy source failed")
        value = _result(run)
        text = f"{name} ended: {NAMES[current]}.{reason}" + (f" Result: {value} USDT." if value is not None else "")
        if attention:
            text += f" Needs attention: {', '.join(attention)}."
        result.append((f"{run_id}:ended:{current}", text))
    elif current == "unresolved":
        result.append((f"{run_id}:unresolved:{mode}",
                       f"{name} is UNRESOLVED and needs attention now: exposure may remain at Binance and nothing "
                       f"will close it. Follow 'Unresolved Live runs' in engine/README.md.{reason}"))
    return result


def _ns(value) -> int | None:
    return int(value) if isinstance(value, str) and value.isdigit() else None


def _day(ns: int) -> str:
    return datetime.fromtimestamp(ns / 1e9, timezone.utc).date().isoformat()


def _wallet(facts: list[dict]) -> tuple[int, str, str] | None:
    """The newest observed USDT wallet among the runs read: (observed_ns, wallet, run_id)."""
    observed = [(ns, account["usdt_wallet"], run["run_id"]) for run in facts
                if (account := run.get("account")) and account.get("usdt_wallet") is not None
                and (ns := _ns(account.get("observed_ns"))) is not None]
    return max(observed) if observed else None


def _summary(facts: list[dict], day: str) -> str:
    wallet = _wallet(facts)
    when = datetime.fromtimestamp(wallet[0] / 1e9, timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if wallet else ""
    lines = [f"Live daily summary for {day} (UTC)",
             f"Wallet: {wallet[1]} USDT, observed {when} by run {wallet[2]}" if wallet else "Wallet: no account observation"]
    open_rows = []
    for run in facts:
        if (run.get("host") or {}).get("state") in runs.ENDED:
            continue  # an ended run's flat end is proven; its events are not positions now
        latest: dict[str, dict] = {}
        for row in run.get("positions") or []:
            if row.get("position_id"):
                latest[row["position_id"]] = row
        open_rows += [f"{run['run_id']} {row.get('instrument_id') or row['position_id']} {row.get('side') or '?'} "
                      f"{row.get('quantity') or '?'}" for row in latest.values() if row.get("event_type") != "PositionClosed"]
    lines.append("Open positions (no recorded close): " + ("; ".join(open_rows) if open_rows else "none"))
    fills = sum(1 for run in facts for row in _fills(run) if (ns := _ns(row.get("ts_event"))) and _day(ns) == day)
    lines.append(f"Fills: {fills}")
    return "\n".join(lines)


def _last_day(run: dict) -> str | None:
    """The run's latest day with a fill or its terminal event; it is read until the summary after that day."""
    found = [ns for ns in (_ns((run.get("terminal") or {}).get("observed_ns")),
                           *(_ns(row.get("ts_event")) for row in _fills(run))) if ns is not None]
    return _day(max(found)) if found else None


def step(record: dict, facts: list[dict], now: int, send: Callable[[str], object],
         save: Callable[[], None], stop: Callable[[], bool] = lambda: False) -> None:
    """Send what is new, strictly in order, saving after each change. A failure ends the tick; it is retried later.

    The first pass after enabling (no summary key in `done` yet) records the current facts as history, unsent.
    """
    done = set(record["done"])
    today = DAILY + _day(now)
    candidates = [pair for run in facts for pair in messages(run)]
    if not any(key.startswith(DAILY) for key in done):
        done.update(key for key, _ in candidates)
        done.add(today)
    else:
        sent = 0
        for key, text in [*candidates, (today, None)]:
            if key in done:
                continue
            attempt = record["attempts"].get(key)
            if (attempt and attempt["next_ns"] > now) or stop() or sent >= MAX_PER_TICK:
                break  # strict order: nothing overtakes a message still waiting
            if text is None:  # every earlier message is sent, so the previous day's fills are all counted
                text = _summary(facts, _day(now - DAY_NS))
            try:
                send(text[:4000])
            except Failure as exc:
                record["last_error"] = {"code": exc.code, "at_ns": now}
                if exc.status is not None and 400 <= exc.status < 500 and exc.status != 429:
                    done.add(key)  # Telegram refused this message: retrying cannot deliver it
                    record["dropped"] += 1
                    record["attempts"].pop(key, None)
                else:
                    count = (attempt["n"] if attempt else 0) + 1
                    record["attempts"][key] = {"n": count, "next_ns": now + min(BACKOFF_NS * 2 ** (count - 1),
                                                                                    MAX_BACKOFF_NS)}
                record["done"] = sorted(done)
                save()
                break
            sent += 1
            done.add(key)
            record["attempts"].pop(key, None)
            record.update(done=sorted(done), last_sent_ns=now, last_error=None)
            save()
        live = {key for key, _ in candidates} | {today}
        record["attempts"] = {key: value for key, value in record["attempts"].items() if key in live}
    # Only the newest summary key is needed to know the day is done.
    newest = max(key for key in done if key.startswith(DAILY))
    done = {key for key in done if not key.startswith(DAILY) or key == newest}
    # A run ended flat with its resources archived never changes again. Once every message of it is sent and the
    # summary after its last day is out, stop reading it and drop its keys. The run holding the newest wallet
    # observation stays read, so the summary can still show it.
    wallet = _wallet(facts)
    for run in facts:
        run_id, last = run["run_id"], _last_day(run)
        if ((run.get("host") or {}).get("state") in FINAL and (run.get("custody") or {}).get("archived") is True
                and all(key in done for key, _ in messages(run)) and (last is None or DAILY + last < newest)
                and not (wallet and wallet[2] == run_id)):
            record["closed"] = sorted({*record["closed"], run_id})
            done = {key for key in done if not key.startswith(run_id + ":")}
    record["done"] = sorted(done)
    save()


def tick(config: configuration.Configuration, *, call: Call = telegram, now: int | None = None,
         stop: Callable[[], bool] = lambda: False) -> None:
    """One sender pass from a control's maintenance thread. Never raises, never touches a run."""
    try:
        directory = config.root / "notify"
        if not _private(directory, stat.S_IFDIR) or not _private(directory / "telegram.json", stat.S_IFREG):
            return
        with _locked(directory) as acquired:
            if not acquired:
                return  # another control sends this tick
            token, chat = _settings(directory)
            record = _load(directory)
            facts = collect(config, set(record["closed"]))
            step(record, facts, time.time_ns() if now is None else now,
                 lambda text: call(token, "sendMessage", {"chat_id": chat, "text": text}),
                 lambda: _save(directory, record), stop)
    except Exception:
        pass  # notification never affects run maintenance; the page shows the last recorded error
