"""Private, GET-only Binance USD-M admission observations.

Orders, balances and positions remain owned by Binance and Nautilus. This client only
checks the account before arming; it cannot place orders or change account settings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import stat
import time
import urllib.error
import urllib.parse
import urllib.request

from engine.live_errors import LiveRefusal as Refusal

CLOCK_AHEAD_MS = 1000  # The venue's own limit.
CLOCK_BEHIND_MS = 2500  # Half of the 5000 ms recvWindow that native requests use, leaving the rest for transit.
MANIFEST_FORMAT = "live-run-v5"  # one definition: the host writes it, the runner's image refuses any other


@dataclass(frozen=True)
class Credentials:
    api_key: str = field(repr=False)
    api_secret: str = field(repr=False)

    @property
    def binding(self) -> str:
        """Same-key binding, not a claim that different keys identify different accounts."""
        return hashlib.sha256(self.api_key.encode()).hexdigest()


def read_credentials(path: Path) -> Credentials:
    """Only a private regular JSON file; no environment fallback or secret in an error."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            mode = os.fstat(stream.fileno())
            if not stat.S_ISREG(mode.st_mode) or mode.st_mode & 0o077:
                raise ValueError
            data = json.loads(stream.read(16385))
        if set(data) != {"api_key", "api_secret"} or any(
                not isinstance(value, str) or not value or value != value.strip() for value in data.values()):
            raise ValueError
        return Credentials(**data)
    except (OSError, ValueError, TypeError) as exc:
        raise Refusal("LIVE_CREDENTIAL_FILE", "Live needs a private regular credential file (mode 0600)") from exc


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class BinanceReadOnly:
    """Hardcoded production origin and allowlisted GET paths; no write method exists."""

    ORIGIN = "https://fapi.binance.com"
    TIME = "/fapi/v1/time"
    PUBLIC = frozenset({TIME, "/fapi/v1/exchangeInfo", "/fapi/v1/premiumIndex"})
    PRIVATE = frozenset({"/fapi/v2/account", "/fapi/v1/accountConfig", "/fapi/v1/symbolConfig",
                         "/fapi/v3/positionRisk", "/fapi/v1/openOrders", "/fapi/v1/openAlgoOrders",
                         "/fapi/v1/commissionRate"})

    def __init__(self, credentials: Credentials, *, proxy_url: str | None = None):
        self.credentials = credentials
        proxy = {"https": proxy_url} if proxy_url else {}
        self.opener = urllib.request.build_opener(_NoRedirect(), urllib.request.ProxyHandler(proxy))

    def get(self, path: str, **params):
        if path not in self.PUBLIC | self.PRIVATE:
            raise Refusal("LIVE_READ_PATH", "the account observer only accepts declared GET endpoints")
        headers = {}
        if path in self.PRIVATE:
            params = {**params, "timestamp": self.get(self.TIME)["serverTime"], "recvWindow": 5000}
            headers["X-MBX-APIKEY"] = self.credentials.api_key
        query = urllib.parse.urlencode(params)
        if path in self.PRIVATE:
            signature = hmac.new(self.credentials.api_secret.encode(), query.encode(), hashlib.sha256).hexdigest()
            query += "&signature=" + signature
        request = urllib.request.Request(self.ORIGIN + path + ("?" + query if query else ""),
                                         headers=headers, method="GET")
        try:
            with self.opener.open(request, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            status = exc.code
            exc.close()
            raise Refusal("LIVE_ACCOUNT_UNAVAILABLE", f"Binance GET {path} returned HTTP {status}") from None
        except (OSError, ValueError, http.client.HTTPException) as exc:
            # Exception text can contain signed URLs; retain only the failure class.
            raise Refusal("LIVE_ACCOUNT_UNAVAILABLE", f"Binance GET {path} failed ({type(exc).__name__})") from None

    def clock(self) -> list[dict]:
        """Signed reads here carry the venue's time, which would hide an offset native requests can still suffer.

        Each read is a fresh connection, so one stall must not read as an offset: see require_clock.
        """
        samples = []
        for _ in range(3):
            sent_ns = time.time_ns()
            server_ms = self.get(self.TIME)["serverTime"]
            samples.append({"sent_ns": sent_ns, "server_ms": server_ms, "received_ns": time.time_ns()})
        return samples

    def snapshot(self, symbols: list[str]) -> dict:
        """Actual account state and instrument filters, never simulated starting capital."""
        observed_ns = time.time_ns()
        account = self.get("/fapi/v2/account")
        config = self.get("/fapi/v1/accountConfig")
        # Conditional orders, then orders, then positions: whatever triggers or fills between two reads shows up
        # in the later one, so an account that was not flat can never read as flat.
        algos = self.get("/fapi/v1/openAlgoOrders")
        orders = self.get("/fapi/v1/openOrders")
        positions = self.get("/fapi/v3/positionRisk")
        exchange = self.get("/fapi/v1/exchangeInfo")
        terms = {}
        for symbol in symbols:
            rows = [row for row in exchange["symbols"] if row["symbol"] == symbol]
            if len(rows) != 1:
                raise Refusal("LIVE_INSTRUMENT_UNKNOWN", f"Binance has no unique USD-M instrument {symbol}")
            terms[symbol] = {
                "instrument": rows[0], "config": self.get("/fapi/v1/symbolConfig", symbol=symbol),
                "mark": self.get("/fapi/v1/premiumIndex", symbol=symbol),
                "commission": self.get("/fapi/v1/commissionRate", symbol=symbol),
            }
        return {"observed_ns": observed_ns, "credential_binding": self.credentials.binding,
                "account": account, "config": config, "positions": positions,
                "orders": orders, "algo_orders": algos, "symbols": terms}


def require_clock(snapshot: dict) -> None:
    """The venue accepts timestamp < serverTime + 1000 and serverTime - timestamp <= recvWindow. Only bounds are
    knowable: the venue stamped its time between sending and receiving, so each sample caps the offset and the
    tightest cap holds."""
    try:
        samples = snapshot["clock"]
        ahead_ms = min(row["received_ns"] // 1_000_000 - int(row["server_ms"]) for row in samples)
        behind_ms = min(int(row["server_ms"]) - row["sent_ns"] // 1_000_000 for row in samples)
    except (KeyError, TypeError, ValueError) as exc:
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "the venue did not supply a usable server time") from exc
    if ahead_ms >= CLOCK_AHEAD_MS or behind_ms >= CLOCK_BEHIND_MS:
        raise Refusal("LIVE_CLOCK", f"this clock is up to {ahead_ms} ms ahead of or {behind_ms} ms behind Binance; "
                                    f"the limits are {CLOCK_AHEAD_MS} and {CLOCK_BEHIND_MS}")


def require_flat(snapshot: dict) -> None:
    """First arming never claims pre-existing positions or orders as strategy-owned."""
    try:
        held = any(Decimal(row["positionAmt"]) != 0 for row in snapshot["positions"])
        working = bool(snapshot["orders"] or snapshot["algo_orders"])
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "the venue did not supply complete position/order observations") from exc
    if held or working:
        raise Refusal("LIVE_ACCOUNT_NOT_FLAT", "new Live execution requires no account positions or open orders")


def require_account_mode(snapshot: dict, manifest: dict) -> None:
    """Check current account identity and modes without requiring funds or a flat account.

    Reconciliation can observe existing exposure and losses even when new trading is
    disabled. This check never changes venue leverage or margin settings.
    """
    try:
        age = time.time_ns() - snapshot["observed_ns"]
        if not 0 <= age <= 30_000_000_000:
            raise Refusal("LIVE_OBSERVATION_STALE", "account checks require a fresh account observation")
        if snapshot["credential_binding"] != manifest["credential_binding"]:
            raise Refusal("LIVE_ACCOUNT_BINDING", "this run is bound to another credential identity")
        symbols = manifest["symbols"]
        if len(symbols) != 1 or len(set(symbols)) != 1:
            raise Refusal("LIVE_SYMBOL_SCOPE", "the initial Live trial admits one instrument at a time")
        mode = snapshot["config"]
        if mode["dualSidePosition"] is not True or mode["multiAssetsMargin"] is not True:
            raise Refusal("LIVE_ACCOUNT_MODE", "the trial requires hedge and multi-assets mode")
        settings = snapshot["symbols"][symbols[0]]["config"]
        if len(settings) != 1 or settings[0]["symbol"] != symbols[0] \
                or settings[0]["marginType"] != "CROSSED" or int(settings[0]["leverage"]) <= 0 \
                or settings[0]["isAutoAddMargin"] is not False:
            raise Refusal("LIVE_MARGIN_MODE", "the trial requires cross margin, reported leverage and automatic margin addition off")
    except Refusal:
        raise
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "complete account identity and mode observations are required") from exc


# An entry may reach this multiple of the cash budget, never more (user, 2026-11-09). Each entry repeats
# admission, so the account must keep the budget in cash while the strategy's notional stays under the cap.
ENTRY_CAP_BUDGETS = 3


def require_admission(snapshot: dict, manifest: dict) -> None:
    """Admit a fresh USDT-funded trial without converting other collateral to cash."""
    require_account_mode(snapshot, manifest)
    try:
        if snapshot["config"]["canTrade"] is not True:
            raise Refusal("LIVE_ACCOUNT_MODE", "fresh arming requires trading enabled")
        config = manifest["config"]
        budget = Decimal(config["budget_usdt"])
        cap = Decimal(config["max_notional_per_order"])
        if not budget.is_finite() or not cap.is_finite() or not 0 < budget <= 100 \
                or not 0 < cap <= ENTRY_CAP_BUDGETS * budget:
            raise Refusal("LIVE_BUDGET", "the trial requires budget at most 100 USDT and an entry cap at most 3 times the budget")
        assets = snapshot["account"]["assets"]
        names = set()
        usdt = None
        for row in assets:
            name = row["asset"]
            if not isinstance(name, str) or not name or name != name.strip() or name in names:
                raise Refusal("LIVE_ACCOUNT_RESPONSE", "v2 assets require unique nonempty asset names")
            names.add(name)
            wallet = Decimal(row["walletBalance"])
            if not wallet.is_finite() or wallet < 0:
                raise Refusal("LIVE_FUNDS", "fresh arming requires finite nonnegative wallet balances for every asset")
            if name == "USDT":
                usdt = row
        if usdt is None:
            raise Refusal("LIVE_FUNDS", "the venue did not report USDT cash for the declared trial budget")
        wallet = Decimal(usdt["walletBalance"])
        available = Decimal(usdt["availableBalance"])
        if not available.is_finite() or usdt["marginAvailable"] is not True \
                or min(wallet, available) < budget:
            raise Refusal("LIVE_FUNDS", "the declared trial budget exceeds eligible USDT wallet cash or available balance")
        details = snapshot["symbols"][manifest["symbols"][0]]
        terms = details["instrument"]
        if terms["status"] != "TRADING" or terms["contractType"] != "PERPETUAL" or terms["marginAsset"] != "USDT":
            raise Refusal("LIVE_INSTRUMENT", "the trial requires an active USDT-margined perpetual")
        filters = {row["filterType"]: row for row in terms["filters"]}
        minimum = Decimal(filters["MIN_NOTIONAL"]["notional"])
        mark = Decimal(details["mark"]["markPrice"])
        lot = Decimal(filters["LOT_SIZE"]["minQty"])
        if not mark.is_finite() or mark <= 0 or max(minimum, lot * mark) > cap:
            raise Refusal("LIVE_MINIMUM_SIZE", "the venue minimum cannot fit the declared trial budget")
        require_flat(snapshot)
    except Refusal:
        raise
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "complete account, mode and instrument observations are required") from exc
