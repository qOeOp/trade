"""Telegram, the deployment's one notification channel: its call and its saved settings.

Shared by the Live control (live/notify.py) and the host's release tick (deploy/release.py `Notices`). The bot
token and the one private chat it is bound to are saved only through the Live page, in
LIVE_ROOT/notify/telegram.json (0600); nothing here writes them. The token never reaches a log, argv, env or
exception text. Stdlib only: the host's reviewed control code imports this module.
"""

import json
import os
from pathlib import Path
import re
import stat
import urllib.error
import urllib.request


TOKEN = re.compile(r"[0-9]{1,20}:[A-Za-z0-9_-]{20,100}\Z")
TIMEOUT = 10


class Failure(Exception):
    """A Telegram call that did not succeed: only an HTTP status class or `network`, never the URL."""

    def __init__(self, code: str, status: int | None = None):
        super().__init__(code)
        self.code, self.status = code, status


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


def settings(directory: Path) -> tuple[str, int] | None:
    """The saved (token, chat) in `directory`/telegram.json; None when none is saved.

    ValueError, with no part of the file in it, when it is not a private regular file or not the saved shape.
    """
    try:
        descriptor = os.open(directory / "telegram.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    except OSError:
        raise ValueError("the Telegram settings are unreadable") from None
    try:
        with os.fdopen(descriptor, "rb") as stream:
            mode = os.fstat(stream.fileno()).st_mode
            if not stat.S_ISREG(mode) or mode & 0o077:
                raise ValueError
            value = json.load(stream)
    except (OSError, ValueError):
        raise ValueError("the Telegram settings are not a private saved file") from None
    if not isinstance(value, dict) or set(value) != {"bot_token", "chat_id"}:
        raise ValueError("the Telegram settings are malformed")
    token, chat = value["bot_token"], value["chat_id"]
    if not isinstance(token, str) or not TOKEN.fullmatch(token) or type(chat) is not int:
        raise ValueError("the Telegram settings are malformed")
    return token, chat
