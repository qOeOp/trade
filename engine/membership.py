"""A running contract's universe membership, month by month, as Paper and Live read it (coverage U9).

The run's universe file gives the months up to its first; each later month comes from a file the host writes beside
it, `membership/<YYYY-MM>.json` ({"market_day", "members"}: the run's contracts in that month's universe), once the
market holds that month (market.universe.month_files). The runner reads a month's file when the source or the entry check first
looks after the month began; until it is there the contract is no member, so entries are not sent and the contract
only reduces (docs/plans/paper-monthly-membership-20261111.zh.md).
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime
import hashlib
import json
from pathlib import Path

from engine.config import Refusal
from engine.load import episode_membership

MONTHS = "membership"  # beside the universe file


def month_end_ns(at_ns: int) -> int:
    """The first instant of the UTC month after the one holding `at_ns`."""
    moment = datetime.fromtimestamp(at_ns // 10**9, UTC)
    following = date(moment.year + moment.month // 12, moment.month % 12 + 1, 1)
    return int(datetime(following.year, following.month, 1, tzinfo=UTC).timestamp()) * 10**9


def opening(intervals, start_ns: int, end_ns: int) -> list[tuple[int, int]]:
    """A contract's membership in the universe file from `start_ns` to `end_ns`, the end of the months it holds."""
    return [(max(low, start_ns), min(high, end_ns)) for low, high in episode_membership(tuple(intervals), None)
            if high > start_ns and low < end_ns]


class Membership(Sequence):
    """A contract's `universe_membership`: [start_ns, end_ns) intervals known until `known_until_ns`, growing as the
    month files in `months` arrive. `now` is the clock it is read at; `record(event, **fields)` journals each month
    read (`membership`, with the file's sha256) and, once per month, a month whose file is not there yet
    (`membership_stale`, with `stale_code`). A copy taken earlier keeps the months it held."""

    def __init__(self, symbol: str, intervals, known_until_ns: int, months: Path | None, *,
                 now: Callable[[], int], record: Callable[..., None], stale_code: str):
        self.symbol, self.known_until_ns, self._months = symbol, known_until_ns, months
        self._intervals = [tuple(interval) for interval in intervals]
        self._now, self._record, self._stale_code = now, record, stale_code
        self._stale: set[str] = set()

    def _refresh(self) -> None:
        while self._months is not None and self._now() >= self.known_until_ns:
            month = datetime.fromtimestamp(self.known_until_ns // 10**9, UTC).strftime("%Y-%m")
            path = self._months / f"{month}.json"
            try:
                data = path.read_bytes()
            except FileNotFoundError:
                if month not in self._stale:
                    self._stale.add(month)
                    self._record("membership_stale", code=self._stale_code, symbol=self.symbol, month=month)
                return
            try:
                members = json.loads(data)["members"]
                if not isinstance(members, list) or not all(isinstance(member, str) for member in members):
                    raise ValueError("members is not a list of symbols")
            except (ValueError, KeyError, TypeError) as exc:
                raise Refusal("UNIVERSE_FILE_INVALID", f"{path}: {exc}") from exc
            end = month_end_ns(self.known_until_ns)
            member = self.symbol in members
            if member and self._intervals and self._intervals[-1][1] == self.known_until_ns:
                self._intervals[-1] = (self._intervals[-1][0], end)
            elif member:
                self._intervals.append((self.known_until_ns, end))
            self._record("membership", symbol=self.symbol, month=month, member=member,
                         sha256=hashlib.sha256(data).hexdigest())
            self.known_until_ns = end

    def __getitem__(self, index):
        self._refresh()
        return self._intervals[index]

    def __len__(self) -> int:
        self._refresh()
        return len(self._intervals)

    def __iter__(self):
        self._refresh()
        return iter(tuple(self._intervals))

    def __repr__(self) -> str:
        return f"Membership({self.symbol}, {self._intervals!r})"

    def member_at(self, at_ns: int) -> bool:
        return any(low <= at_ns < high for low, high in self)

