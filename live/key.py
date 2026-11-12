"""The API key's own permissions, read by the operator's process before a run takes the account and, while it runs,
every CHECK_SECONDS (live.control.check_key_locked).

The runner's egress cannot reach api.binance.com, deliberately: it filters by host only, so a container
holding the key could otherwise reach wallet endpoints.
"""

from __future__ import annotations

from pathlib import Path

from engine.live_errors import LiveRefusal
from engine.live_venue import BinanceReadOnly, read_credentials
from live import state


RESTRICTIONS = "/sapi/v1/account/apiRestrictions"
CHECK_SECONDS = 3600


class _KeyRead(BinanceReadOnly):
    ORIGIN = "https://api.binance.com"
    TIME = "/api/v3/time"
    PUBLIC = frozenset({TIME})
    PRIVATE = frozenset({RESTRICTIONS})


def require_limits(credentials: Path, *, ip_restricted: bool = False) -> list[str]:
    """Refuses a key that can withdraw or whose permissions cannot be read, and, for a run with no end
    (`ip_restricted`, design §3.9), one with no IP restriction; returns what the operator should know."""
    try:
        found = _KeyRead(read_credentials(credentials)).get(RESTRICTIONS)
        withdrawals, restricted = found["enableWithdrawals"], found["ipRestrict"]
    except LiveRefusal as exc:  # Its text was already cleared of signed URLs and credentials.
        raise state.fail("LIVE_KEY_UNVERIFIED", f"could not read this API key's permissions from this host, "
                                                f"which must reach api.binance.com from an allowed IP: {exc}") from None
    except (KeyError, TypeError):
        raise state.fail("LIVE_KEY_UNVERIFIED", "Binance did not report this API key's permissions") from None
    if not isinstance(withdrawals, bool) or not isinstance(restricted, bool):
        raise state.fail("LIVE_KEY_UNVERIFIED", "Binance did not report this API key's permissions as true or false")
    if withdrawals:
        raise state.fail("LIVE_KEY_WITHDRAWAL", "turn off withdrawals on this API key; Live never withdraws")
    if not restricted and ip_restricted:
        raise state.fail("LIVE_KEY_IP_UNRESTRICTED", "a run with no duration needs an API key restricted to this "
                                                     "host's IP; set one at Binance or give the run a duration")
    return [] if restricted else ["this API key has no IP restriction"]
