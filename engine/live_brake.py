"""The drawdown brake and the cash floor of a Live run (design `docs/plans/live-continuous-operation-design-20261110.zh.md`
§3.5, user 2026-11-10).

The brake reads the account over REST: equity is the USDT wallet plus its unrealized result, so fees and funding
count. Once equity falls the run's brake share below the highest equity the run has seen, the run takes the STOP
path (closes, stops, the user is told) and is not started again. The run's highest equity starts at its first
arming's equity and is journalled then and whenever it rises (`equity_peak`), so a start again carries it on.

The cash floor (budget) is BUDGET_SHARE of the USDT wallet at the first arming: every entry still needs that much
USDT wallet and available cash, a last line should the brake fail.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal
import json
from pathlib import Path

from engine import live_commands as commands
from engine.live_errors import LiveRefusal as Refusal
from engine.live_records import journal, keep
from engine.load import read_regular_file

BUDGET_SHARE = Decimal("0.85")
BRAKE_MAX = Decimal("0.15")  # the user's maximum-drawdown target; a run may set a tighter brake, never a looser one
READ_SECONDS = 15
UNREAD_SECONDS = 60  # with a position open and no equity read for this long, the brake cannot be applied


@dataclass
class Brake:
    budget: Decimal | None = None
    peak: Decimal | None = None
    observation: object = None  # the account read in flight (engine.live_commands.AccountObservation)
    last_read: float | None = None  # monotonic time the latest read was asked for
    last_seen: float | None = None  # monotonic time of the latest equity


def usdt(snapshot: dict) -> dict:
    rows = [row for row in snapshot["account"]["assets"] if row["asset"] == "USDT"]
    if len(rows) != 1:
        raise Refusal("LIVE_FUNDS", "the venue did not report one USDT asset")
    return rows[0]


def equity(snapshot: dict) -> Decimal:
    """USDT wallet plus its unrealized result, as the venue reports them."""
    try:
        row = usdt(snapshot)
        value = Decimal(row["walletBalance"]) + Decimal(row["unrealizedProfit"])
    except Refusal:
        raise
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "a complete USDT wallet and unrealized result are required") from exc
    if not value.is_finite():
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "a finite USDT equity is required")
    return value


def budget(snapshot: dict) -> Decimal:
    """BUDGET_SHARE of the USDT wallet, down to the cent."""
    try:
        wallet = Decimal(usdt(snapshot)["walletBalance"])
    except Refusal:
        raise
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "a complete USDT wallet observation is required") from exc
    if not wallet.is_finite() or wallet <= 0:
        raise Refusal("LIVE_FUNDS", "the run requires a positive USDT wallet")
    return (wallet * BUDGET_SHARE).quantize(Decimal("0.01"), rounding=ROUND_DOWN)


def arm(session, snapshot: dict) -> None:
    """The run's first arming: its budget and its first highest equity."""
    session.brake.budget, session.brake.peak = budget(snapshot), equity(snapshot)


def resume(session, output: Path) -> None:
    """A start again: the first arming's budget, and the highest equity journalled since."""
    armed = json.loads(read_regular_file(output / "armed.json"))
    first = json.loads(read_regular_file(output / armed["observation"]))
    arm(session, first)
    for row in journal(output):  # a damaged journal raises: the peak is never read from part of it
        if row.get("event") == "equity_peak":
            session.brake.peak = max(session.brake.peak, Decimal(row["equity"]))


def observe(session, snapshot: dict, now: float) -> None:
    """Judge one account read: a new highest equity is journalled, a drawdown of the brake's share stops the run."""
    brake = session.brake
    value = equity(snapshot)
    brake.last_seen = now
    if value > brake.peak:
        brake.peak = value
        session.event("equity_peak", strict=False, equity=str(value), observed_ns=snapshot["observed_ns"])
    if value <= brake.peak * (1 - Decimal(session.manifest["config"]["drawdown_brake"])) and not session.stopping:
        observation: str | None
        try:
            observation = keep(session.output, "brake-account", snapshot)
        except OSError:
            observation = None  # the stop never waits on its record
        session.event("drawdown_brake", strict=False, equity=str(value), peak=str(brake.peak),
                      drawdown=str((1 - value / brake.peak).quantize(Decimal("0.0001"))), observation=observation)
        session.begin_stop("drawdown")


def tick(session, exposed: bool, now: float) -> None:
    """Read the account every READ_SECONDS. With a position open and no equity for UNREAD_SECONDS the brake cannot be
    applied, which counts as reaching it and fails the run."""
    brake = session.brake
    if brake.last_seen is None:
        brake.last_seen = now
    if brake.observation is None:
        if brake.last_read is None or now - brake.last_read >= READ_SECONDS:
            brake.last_read = now
            brake.observation = commands.observe_account(session, "brake")
    else:
        try:
            snapshot = commands.observed_account(session, "brake", brake.observation)
            if snapshot is not None:
                brake.observation = None
                observe(session, snapshot, now)
        except Exception:  # an unread or incomplete account: only this read is lost, UNREAD_SECONDS bounds it
            brake.observation = None
    if exposed and now - brake.last_seen >= UNREAD_SECONDS and not session.stopping:
        session.failed = True
        session.event("drawdown_unverified", strict=False, unread_seconds=int(now - brake.last_seen))
        session.begin_stop("drawdown_unverified")
