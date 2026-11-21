"""A fake Binance USD-M Futures venue on 127.0.0.1 for the Live loopback tests: REST and WebSocket on one port.

It stands under the real rc7 Binance adapter and the product's own Binance clients (tests.live_loopback.runner points
their origins here). Standard library only; it never connects anywhere. It models what the Live path reads and sends:
signed REST (HMAC-SHA256 over the query and body, checked against the test secret), a hedge-mode account with one
USDT balance, orders and Algo Service conditional orders, the user data stream on `/ws?listenKey=…`, and market
streams subscribed over `/ws` plus the combined `/market/stream?streams=…` the product's side connection reads.

Matching is deliberately simple: a marketable LIMIT fills whole at once at the last close; a resting LIMIT fills whole
at its price when a later minute's range reaches it; an Algo STOP_MARKET triggers when a minute's range reaches its
trigger and fills at the trigger. Each minute's kline comes from `bar()` (or repeats the last close) and is pushed
just after the minute closes, by the wall clock, as Binance does.

Faults are injected through the public methods: `fail` (an HTTP answer for the next matching requests), `hang`,
`drop_user_streams`, `expire_listen_key`, `external_fill`, `set_symbol`, `repeat_next_kline`, `silence_market`.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass, field
from decimal import Decimal
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import itertools
import json
import socket
import struct
import threading
import time
import urllib.parse

MINUTE_MS = 60_000
WS_GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
TAKER = Decimal("0.0005")
MAKER = Decimal("0.0002")


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def text(value: Decimal) -> str:
    return format(value.normalize(), "f") if value else "0"


@dataclass
class Bar:
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal


@dataclass
class Order:
    order_id: int
    client_id: str
    symbol: str
    side: str
    position_side: str
    type: str
    quantity: Decimal
    price: Decimal
    time_in_force: str
    reduce_only: bool
    good_till: int | None = None
    status: str = "NEW"
    filled: Decimal = Decimal(0)
    average: Decimal = Decimal(0)
    update_ms: int = field(default_factory=now_ms)


@dataclass
class Algo:
    algo_id: int
    client_id: str
    symbol: str
    side: str
    position_side: str
    type: str
    quantity: Decimal
    trigger: Decimal
    time_in_force: str
    reduce_only: bool
    status: str = "NEW"
    actual_order_id: str = ""
    filled: Decimal = Decimal(0)
    update_ms: int = field(default_factory=now_ms)


@dataclass
class Position:
    amount: Decimal = Decimal(0)  # signed: SHORT positions are negative, as Binance reports them
    entry: Decimal = Decimal(0)
    realized: Decimal = Decimal(0)


class Venue:
    """One fake account and its market. `start()` serves it; `close()` ends every thread and socket."""

    def __init__(self, *, api_key: str, api_secret: str, symbols: dict[str, dict], wallet: str = "100",
                 leverage: int = 50):
        self.api_key, self.api_secret = api_key, api_secret.encode()
        self.terms = {symbol: dict(spec) for symbol, spec in symbols.items()}
        self.status = {symbol: "TRADING" for symbol in symbols}
        self.last = {symbol: Decimal(spec["price"]) for symbol, spec in symbols.items()}
        self.wallet = Decimal(wallet)
        self.leverage = leverage
        self.lock = threading.RLock()
        self.ids = itertools.count(1_000_001)
        self.orders: dict[int, Order] = {}
        self.algos: dict[int, Algo] = {}
        self.positions: dict[tuple[str, str], Position] = {}
        self.trades: list[dict] = []
        self.listen_keys: set[str] = set()
        self.requests: list[tuple[str, str, int]] = []  # (method, path, status), in arrival order
        self.subscriptions: list[str] = []
        self.planned: dict[str, list[Bar]] = {symbol: [] for symbol in symbols}
        self.faults: list[dict] = []
        self.errors: list[str] = []
        self.repeat_kline = 0
        self.market_silent = False
        self.user_muted = False
        self.user_sockets: list[Socket] = []
        self.market_sockets: list[Socket] = []
        self.side_sockets: list[Socket] = []
        self.stopping = threading.Event()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.threads = [threading.Thread(target=self.server.serve_forever, name="fake-venue-http", daemon=True),
                        threading.Thread(target=self._minutes, name="fake-venue-minutes", daemon=True),
                        threading.Thread(target=self._seconds, name="fake-venue-marks", daemon=True)]

    # -- the test's side ------------------------------------------------------------------------------------------

    @property
    def http_origin(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def ws_origin(self) -> str:
        return f"ws://127.0.0.1:{self.port}/ws"

    def start(self) -> Venue:
        for thread in self.threads:
            thread.start()
        return self

    def close(self) -> None:
        self.stopping.set()
        self.server.shutdown()
        self.server.server_close()
        for found in (*self.user_sockets, *self.market_sockets, *self.side_sockets):
            found.close()

    def bar(self, symbol: str, close, *, high=None, low=None, open=None, volume="1") -> None:
        """The kline of the next minute that closes: its close, and its range (open..close by default)."""
        close = Decimal(str(close))
        first = Decimal(str(open)) if open is not None else self.last[symbol]
        self.planned[symbol].append(Bar(first, Decimal(str(high)) if high is not None else max(first, close),
                                        Decimal(str(low)) if low is not None else min(first, close), close,
                                        Decimal(str(volume))))

    def fail(self, method: str, path: str, status: int, body: dict | None = None, *, times: int = 1,
             headers: dict | None = None) -> None:
        """Answer the next `times` requests of `method path` with `status` and `body` instead of handling them."""
        with self.lock:
            self.faults.append({"method": method, "path": path, "status": status, "times": times,
                                "body": body or {"code": -1003, "msg": "Too many requests."}, "headers": headers or {}})

    def lose(self, method: str, path: str, status: int = 503, *, times: int = 1) -> None:
        """Handle the next `times` requests of `method path`, then answer `status` instead: the venue acted, its answer
        was lost (Binance's 503 "execution status unknown")."""
        with self.lock:
            self.faults.append({"method": method, "path": path, "lose": status, "times": times,
                                "body": {"code": -1007, "msg": "Timeout waiting for response from backend server. "
                                                               "Send status unknown; execution status unknown."}})

    def clear_faults(self) -> None:
        """Answer every request normally again."""
        with self.lock:
            self.faults.clear()

    def mute_user_streams(self, muted: bool = True) -> None:
        """Send (or resume sending) nothing on the user data streams while they stay open."""
        self.user_muted = muted

    def hang(self, method: str, path: str, seconds: float, *, times: int = 1) -> None:
        """Hold the next `times` requests of `method path` unanswered for `seconds`, then handle them."""
        with self.lock:
            self.faults.append({"method": method, "path": path, "hang": seconds, "times": times})

    def drop_user_streams(self) -> None:
        for found in list(self.user_sockets):
            found.close()

    def expire_listen_key(self) -> None:
        with self.lock:
            self.listen_keys.clear()
        self._user({"e": "listenKeyExpired", "E": now_ms(), "listenKey": "expired"})

    def silence_market(self, silent: bool = True) -> None:
        """Stop (or resume) pushing klines and mark prices while the sockets stay open."""
        self.market_silent = silent

    def repeat_next_kline(self, times: int = 1) -> None:
        """Push the next closed kline this many more times (a duplicate push)."""
        self.repeat_kline = times

    def set_symbol(self, symbol: str, *, status: str | None = None, tick: str | None = None) -> None:
        with self.lock:
            if status is not None:
                self.status[symbol] = status
            if tick is not None:
                self.terms[symbol]["tick"] = tick

    def external_fill(self, symbol: str, side: str, position_side: str, quantity, *, client_id: str = "web_manual",
                      price=None) -> None:
        """A fill of an order this account's API client never placed: a manual close, a liquidation
        (`autoclose-…`) or an ADL (`adl_autoclose…`)."""
        with self.lock:
            order = Order(next(self.ids), client_id, symbol, side, position_side, "MARKET", Decimal(str(quantity)),
                          Decimal(0), "GTC", True)
            self.orders[order.order_id] = order
            self._fill(order, Decimal(str(price)) if price is not None else self.last[symbol], maker=False)

    def position(self, symbol: str, position_side: str) -> Decimal:
        with self.lock:
            return self.positions.get((symbol, position_side), Position()).amount

    def open_orders(self) -> list[Order]:
        with self.lock:
            return [order for order in self.orders.values() if order.status in ("NEW", "PARTIALLY_FILLED")]

    def open_algos(self) -> list[Algo]:
        with self.lock:
            return [algo for algo in self.algos.values() if algo.status == "NEW"]

    def requested(self, method: str, path: str) -> int:
        with self.lock:
            return sum(1 for found in self.requests if found[:2] == (method, path))

    # -- matching -------------------------------------------------------------------------------------------------

    def _position(self, symbol: str, side: str) -> Position:
        return self.positions.setdefault((symbol, side), Position())

    def _fill(self, order: Order, price: Decimal, *, maker: bool) -> None:
        quantity = order.quantity - order.filled
        position = self._position(order.symbol, order.position_side)
        signed = quantity if order.side == "BUY" else -quantity
        realized = Decimal(0)
        if position.amount and (position.amount > 0) != (signed > 0):  # a reduction
            closed = min(abs(signed), abs(position.amount))
            realized = (price - position.entry) * closed * (1 if position.amount > 0 else -1)
            position.amount += signed
            if not position.amount:
                position.entry = Decimal(0)
        else:
            total = abs(position.amount) + quantity
            position.entry = (position.entry * abs(position.amount) + price * quantity) / total
            position.amount += signed
        fee = (price * quantity * (MAKER if maker else TAKER)).quantize(Decimal("0.00000001"))
        position.realized += realized
        self.wallet += realized - fee
        order.filled, order.average, order.status, order.update_ms = order.quantity, price, "FILLED", now_ms()
        trade_id = next(self.ids)
        self.trades.append({"symbol": order.symbol, "id": trade_id, "orderId": order.order_id, "side": order.side,
                            "price": text(price), "qty": text(quantity), "realizedPnl": text(realized),
                            "marginAsset": "USDT", "quoteQty": text(price * quantity), "commission": text(fee),
                            "commissionAsset": "USDT", "time": order.update_ms, "positionSide": order.position_side,
                            "buyer": order.side == "BUY", "maker": maker})
        self._order_update(order, "TRADE", last_qty=quantity, last_price=price, fee=fee, trade_id=trade_id,
                           maker=maker, realized=realized)
        self._account_update(order.symbol, order.position_side)

    def _match(self, symbol: str, bar: Bar) -> None:
        for algo in [found for found in self.algos.values() if found.symbol == symbol and found.status == "NEW"]:
            hit = bar.low <= algo.trigger if algo.side == "SELL" else bar.high >= algo.trigger
            if hit:
                self._trigger(algo, algo.trigger)
        for order in [found for found in self.orders.values() if found.symbol == symbol and found.status == "NEW"]:
            if order.type == "LIMIT" and (bar.low <= order.price if order.side == "BUY" else bar.high >= order.price):
                self._fill(order, order.price, maker=True)
            elif order.good_till is not None and order.good_till <= now_ms():
                order.status, order.update_ms = "EXPIRED", now_ms()
                self._order_update(order, "EXPIRED")

    def _trigger(self, algo: Algo, price: Decimal) -> None:
        position = self.positions.get((algo.symbol, algo.position_side))
        order = Order(next(self.ids), algo.client_id, algo.symbol, algo.side, algo.position_side, "MARKET",
                      algo.quantity, Decimal(0), "GTC", algo.reduce_only)
        algo.status, algo.actual_order_id, algo.update_ms = "TRIGGERED", str(order.order_id), now_ms()
        self._algo_update(algo)
        self.orders[order.order_id] = order
        if algo.reduce_only and (position is None or not position.amount):
            order.status = "EXPIRED"
            self._order_update(order, "EXPIRED")
        else:
            self._order_update(order, "NEW")
            self._fill(order, price, maker=False)
            algo.filled = algo.quantity
        algo.status = "FINISHED"
        self._algo_update(algo)

    # -- user data stream -----------------------------------------------------------------------------------------

    def _user(self, message: dict) -> None:
        if self.user_muted:
            return
        for found in list(self.user_sockets):
            found.send(message)

    def _order_update(self, order: Order, execution: str, *, last_qty=Decimal(0), last_price=Decimal(0),
                      fee=Decimal(0), trade_id=0, maker=False, realized=Decimal(0)) -> None:
        stamp = now_ms()
        self._user({"e": "ORDER_TRADE_UPDATE", "E": stamp, "T": stamp, "o": {
            "s": order.symbol, "c": order.client_id, "S": order.side, "o": order.type, "f": order.time_in_force,
            "q": text(order.quantity), "p": text(order.price), "ap": text(order.average), "sp": "0",
            "x": execution, "X": order.status, "i": order.order_id, "l": text(last_qty), "z": text(order.filled),
            "L": text(last_price), "N": "USDT", "n": text(fee), "T": stamp, "t": trade_id, "b": "0", "a": "0",
            "m": maker, "R": order.reduce_only, "wt": "CONTRACT_PRICE", "ot": order.type, "ps": order.position_side,
            "cp": False, "rp": text(realized), "pP": False, "si": 0, "ss": 0, "V": "NONE", "pm": "NONE",
            "gtd": order.good_till or 0}})

    def _algo_update(self, algo: Algo) -> None:
        stamp = now_ms()
        self._user({"e": "ALGO_UPDATE", "E": stamp, "T": stamp, "o": {
            "caid": algo.client_id, "aid": algo.algo_id, "at": "CONDITIONAL", "o": algo.type, "s": algo.symbol,
            "S": algo.side, "ps": algo.position_side, "f": algo.time_in_force, "q": text(algo.quantity),
            "X": algo.status, "tp": text(algo.trigger), "p": "0", "wt": "CONTRACT_PRICE", "pm": "NONE",
            "cp": False, "pP": False, "R": algo.reduce_only, "tt": 0, "gtd": 0, "ai": algo.actual_order_id,
            "ap": "0", "aq": text(algo.filled), "act": "MARKET" if algo.actual_order_id else ""}})

    def _account_update(self, symbol: str, position_side: str) -> None:
        position = self.positions.get((symbol, position_side), Position())
        stamp = now_ms()
        self._user({"e": "ACCOUNT_UPDATE", "E": stamp, "T": stamp, "a": {
            "m": "ORDER", "B": [{"a": "USDT", "wb": text(self.wallet), "cw": text(self.wallet), "bc": "0"}],
            "P": [{"s": symbol, "pa": text(position.amount), "ep": text(position.entry), "bep": text(position.entry),
                   "cr": text(position.realized), "up": "0", "mt": "cross", "iw": "0", "ps": position_side}]}})

    # -- market streams -------------------------------------------------------------------------------------------

    def _minutes(self) -> None:
        while not self.stopping.is_set():
            close_ms = (now_ms() // MINUTE_MS + 1) * MINUTE_MS
            if self.stopping.wait((close_ms - now_ms()) / 1000 + 0.15):
                return
            for symbol in list(self.planned):
                stream = f"{symbol.lower()}@kline_1m"
                heard = any(stream in found.streams for found in list(self.market_sockets))
                with self.lock:
                    # A planned bar waits for a subscriber: a test plans it for the runner to see.
                    bar = self.planned[symbol].pop(0) if self.planned[symbol] and heard else \
                        Bar(*[self.last[symbol]] * 4, Decimal(1))
                    self.last[symbol] = bar.close
                    self._match(symbol, bar)
                if not self.market_silent:
                    for _ in range(1 + self.repeat_kline):
                        self._kline(symbol, close_ms - MINUTE_MS, bar)
                    self.repeat_kline = 0

    def _seconds(self) -> None:
        """Binance pushes `<symbol>@markPrice@1s` every second."""
        while not self.stopping.wait(1):
            if not self.market_silent:
                for symbol in list(self.terms):
                    self._mark(symbol)

    def kline_row(self, symbol: str, start_ms: int, bar: Bar) -> list:
        return [start_ms, text(bar.open), text(bar.high), text(bar.low), text(bar.close), text(bar.volume),
                start_ms + MINUTE_MS - 1, text(bar.close * bar.volume), 1, "0", "0", "0"]

    def _kline(self, symbol: str, start_ms: int, bar: Bar) -> None:
        stamp = now_ms()
        message = {"e": "kline", "E": stamp, "s": symbol, "k": {
            "t": start_ms, "T": start_ms + MINUTE_MS - 1, "s": symbol, "i": "1m", "f": 1, "L": 1,
            "o": text(bar.open), "c": text(bar.close), "h": text(bar.high), "l": text(bar.low),
            "v": text(bar.volume), "n": 1, "x": True, "q": text(bar.close * bar.volume), "V": "0", "Q": "0",
            "B": "0"}}
        stream = f"{symbol.lower()}@kline_1m"
        for found in list(self.market_sockets):
            if stream in found.streams:
                found.send(message)
        for found in list(self.side_sockets):
            if stream in found.streams:
                found.send({"stream": stream, "data": message})

    def _mark(self, symbol: str) -> None:
        stamp = now_ms()
        message = {"e": "markPriceUpdate", "E": stamp, "s": symbol, "p": text(self.last[symbol]),
                   "i": text(self.last[symbol]), "P": text(self.last[symbol]), "r": "0.0001",
                   "T": (stamp // (8 * 3600_000) + 1) * 8 * 3600_000}
        for found in list(self.market_sockets):
            if any(stream.lower().startswith(f"{symbol.lower()}@markprice") for stream in found.streams):
                found.send(message)

    # -- REST -----------------------------------------------------------------------------------------------------

    def _instrument(self, symbol: str) -> dict:
        spec = self.terms[symbol]
        tick, step = spec["tick"], spec["step"]
        return {
            "symbol": symbol, "pair": symbol, "contractType": "PERPETUAL", "deliveryDate": 4133404800000,
            "onboardDate": 1569398400000, "status": self.status[symbol], "maintMarginPercent": "2.5000",
            "requiredMarginPercent": "5.0000", "baseAsset": symbol[:-4], "quoteAsset": "USDT", "marginAsset": "USDT",
            "pricePrecision": max(0, -Decimal(tick).normalize().as_tuple().exponent),
            "quantityPrecision": max(0, -Decimal(step).normalize().as_tuple().exponent),
            "baseAssetPrecision": 8, "quotePrecision": 8, "underlyingType": "COIN", "underlyingSubType": [],
            "settlePlan": 0, "triggerProtect": "0.0500", "liquidationFee": "0.012500", "marketTakeBound": "0.05",
            "orderTypes": ["LIMIT", "MARKET", "STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET",
                           "TRAILING_STOP_MARKET"],
            "timeInForce": ["GTC", "IOC", "FOK", "GTX", "GTD"],
            "filters": [
                {"filterType": "PRICE_FILTER", "minPrice": tick, "maxPrice": "4529764", "tickSize": tick},
                {"filterType": "LOT_SIZE", "minQty": step, "maxQty": "1000", "stepSize": step},
                {"filterType": "MARKET_LOT_SIZE", "minQty": step, "maxQty": "120", "stepSize": step},
                {"filterType": "MAX_NUM_ORDERS", "limit": 200}, {"filterType": "MAX_NUM_ALGO_ORDERS", "limit": 10},
                {"filterType": "MIN_NOTIONAL", "notional": spec["min_notional"]},
                {"filterType": "PERCENT_PRICE", "multiplierUp": "1.0500", "multiplierDown": "0.9500",
                 "multiplierDecimal": "4"}]}

    def _balance(self) -> dict:
        used = sum((abs(position.amount) * position.entry for position in self.positions.values()), Decimal(0)) / self.leverage
        available = self.wallet - used
        return {"accountAlias": "fake", "asset": "USDT", "walletBalance": text(self.wallet), "unrealizedProfit": "0",
                "marginBalance": text(self.wallet), "maintMargin": "0", "initialMargin": text(used),
                "positionInitialMargin": text(used), "openOrderInitialMargin": "0",
                "crossWalletBalance": text(self.wallet), "crossUnPnl": "0", "availableBalance": text(available),
                "maxWithdrawAmount": text(available), "marginAvailable": True, "updateTime": now_ms()}

    def _position_rows(self, symbol: str | None = None) -> list[dict]:
        rows = []
        for name in self.terms:
            if symbol not in (None, name):
                continue
            for side in ("LONG", "SHORT"):
                position = self.positions.get((name, side), Position())
                rows.append({"symbol": name, "positionSide": side, "positionAmt": text(position.amount),
                             "entryPrice": text(position.entry), "breakEvenPrice": text(position.entry),
                             "markPrice": text(self.last[name]), "unRealizedProfit": "0", "liquidationPrice": "0",
                             "isolatedMargin": "0", "notional": text(position.amount * self.last[name]),
                             "marginAsset": "USDT", "isolatedWallet": "0", "initialMargin": "0",
                             "maintMargin": "0", "positionInitialMargin": "0", "openOrderInitialMargin": "0",
                             "adl": 0, "bidNotional": "0", "askNotional": "0", "updateTime": now_ms(),
                             "leverage": str(self.leverage), "marginType": "cross", "isAutoAddMargin": "false",
                             "maxNotionalValue": "1000000"})
        return rows

    def _order_row(self, order: Order) -> dict:
        return {"orderId": order.order_id, "symbol": order.symbol, "status": order.status,
                "clientOrderId": order.client_id, "price": text(order.price), "avgPrice": text(order.average),
                "origQty": text(order.quantity), "executedQty": text(order.filled),
                "cumQuote": text(order.filled * order.average), "timeInForce": order.time_in_force,
                "type": order.type, "origType": order.type, "reduceOnly": order.reduce_only, "closePosition": False,
                "side": order.side, "positionSide": order.position_side, "stopPrice": "0",
                "workingType": "CONTRACT_PRICE", "priceProtect": False, "priceMatch": "NONE",
                "selfTradePreventionMode": "NONE", "goodTillDate": order.good_till or 0, "time": order.update_ms,
                "updateTime": order.update_ms}

    def _algo_row(self, algo: Algo) -> dict:
        return {"algoId": algo.algo_id, "clientAlgoId": algo.client_id, "algoType": "CONDITIONAL",
                "orderType": algo.type, "symbol": algo.symbol, "side": algo.side, "positionSide": algo.position_side,
                "timeInForce": algo.time_in_force, "quantity": text(algo.quantity), "algoStatus": algo.status,
                "triggerPrice": text(algo.trigger), "price": "0", "icebergQuantity": None, "selfTradePreventionMode":
                "NONE", "workingType": "CONTRACT_PRICE", "priceMatch": "NONE", "closePosition": False,
                "priceProtect": False, "reduceOnly": algo.reduce_only, "activatePrice": None, "callbackRate": None,
                "createTime": algo.update_ms, "updateTime": algo.update_ms, "triggerTime": 0, "goodTillDate": 0,
                "actualOrderId": algo.actual_order_id or None, "actualQty": text(algo.filled), "actualPrice": "0"}

    def _signed(self, query: str, body: str, headers) -> bool:
        """Binance signs the query string, or the body, or both concatenated; the signature is the last parameter."""
        signature = dict(urllib.parse.parse_qsl(query) + urllib.parse.parse_qsl(body)).get("signature")
        if headers.get("X-MBX-APIKEY") != self.api_key or not signature:
            return False
        for candidate in (query, body, query + body, f"{query}&{body}"):
            unsigned = candidate.replace(f"&signature={signature}", "").replace(f"signature={signature}", "")
            if hmac.compare_digest(hmac.new(self.api_secret, unsigned.encode(), hashlib.sha256).hexdigest(),
                                   signature):
                return True
        return False

    def answer(self, method: str, path: str, params: dict) -> tuple[int, object]:
        """The venue's answer to one authenticated request (faults already applied)."""
        symbol = params.get("symbol")
        with self.lock:
            if path in ("/fapi/v1/time",):
                return 200, {"serverTime": now_ms()}
            if path == "/fapi/v1/exchangeInfo":
                return 200, {"timezone": "UTC", "serverTime": now_ms(), "futuresType": "U_MARGINED",
                             "rateLimits": [{"rateLimitType": "REQUEST_WEIGHT", "interval": "MINUTE",
                                             "intervalNum": 1, "limit": 2400},
                                            {"rateLimitType": "ORDERS", "interval": "MINUTE", "intervalNum": 1,
                                             "limit": 1200}],
                             "exchangeFilters": [], "assets": [{"asset": "USDT", "marginAvailable": True,
                                                                "autoAssetExchange": "-10000"}],
                             "symbols": [self._instrument(name) for name in self.terms]}
            if path == "/fapi/v1/premiumIndex":
                rows = [{"symbol": name, "markPrice": text(self.last[name]), "indexPrice": text(self.last[name]),
                         "estimatedSettlePrice": text(self.last[name]), "lastFundingRate": "0.0001",
                         "interestRate": "0.0001", "nextFundingTime": (now_ms() // 28_800_000 + 1) * 28_800_000,
                         "time": now_ms()} for name in self.terms if symbol in (None, name)]
                return 200, rows[0] if symbol else rows
            if path == "/fapi/v1/klines":
                start = int(params.get("startTime", now_ms() - 1500 * MINUTE_MS)) // MINUTE_MS * MINUTE_MS
                end = min(int(params.get("endTime", now_ms())), now_ms() // MINUTE_MS * MINUTE_MS - 1)
                limit = int(params.get("limit", 500))
                price = self.last[symbol]
                return 200, [self.kline_row(symbol, at, Bar(price, price, price, price, Decimal(1)))
                             for at in range(start, end - MINUTE_MS + 2, MINUTE_MS)][:limit]
            if path == "/fapi/v1/fundingRate":
                end = int(params.get("endTime", now_ms()))
                last = end // 28_800_000 * 28_800_000
                count = int(params.get("limit", 100))
                return 200, [{"symbol": symbol, "fundingTime": last - index * 28_800_000, "fundingRate": "0.0001",
                              "markPrice": text(self.last[symbol])} for index in reversed(range(count))]
            if path == "/fapi/v1/fundingInfo":
                return 200, [{"symbol": name, "fundingIntervalHours": 8, "adjustedFundingRateCap": "0.003",
                              "adjustedFundingRateFloor": "-0.003", "disclaimer": False} for name in self.terms]
            if path.startswith("/futures/data/"):
                stamp = int(params.get("startTime", now_ms()))
                return 200, [{"symbol": symbol, "sumOpenInterest": "1000", "sumOpenInterestValue": "1000000",
                              "longShortRatio": "1", "longAccount": "0.5", "shortAccount": "0.5",
                              "buySellRatio": "1", "buyVol": "1", "sellVol": "1", "timestamp": stamp}]
            if path == "/fapi/v1/listenKey":
                if method == "POST":
                    key = base64.urlsafe_b64encode(hashlib.sha256(str(next(self.ids)).encode()).digest()).decode()
                    key = key.rstrip("=")[:60]
                    self.listen_keys.add(key)
                    return 200, {"listenKey": key}
                return 200, {}
            if path in ("/fapi/v2/account", "/fapi/v3/account"):
                balance = self._balance()
                return 200, {"feeTier": 0, "canTrade": True, "canDeposit": True, "canWithdraw": True,
                             "multiAssetsMargin": True, "updateTime": 0,
                             "totalInitialMargin": balance["initialMargin"], "totalMaintMargin": "0",
                             "totalWalletBalance": text(self.wallet), "totalUnrealizedProfit": "0",
                             "totalMarginBalance": text(self.wallet), "totalPositionInitialMargin": "0",
                             "totalOpenOrderInitialMargin": "0", "totalCrossWalletBalance": text(self.wallet),
                             "totalCrossUnPnl": "0", "availableBalance": balance["availableBalance"],
                             "maxWithdrawAmount": balance["availableBalance"], "assets": [balance],
                             "positions": []}
            if path == "/fapi/v1/accountConfig":
                return 200, {"feeTier": 0, "canTrade": True, "canDeposit": True, "canWithdraw": True,
                             "dualSidePosition": True, "updateTime": 0, "multiAssetsMargin": True, "tradeGroupId": -1}
            if path == "/fapi/v1/symbolConfig":
                return 200, [{"symbol": name, "marginType": "CROSSED", "isAutoAddMargin": False,
                              "leverage": self.leverage, "maxNotionalValue": "1000000"}
                             for name in self.terms if symbol in (None, name)]
            if path == "/fapi/v1/commissionRate":
                return 200, {"symbol": symbol, "makerCommissionRate": text(MAKER), "takerCommissionRate": text(TAKER),
                             "rpiCommissionRate": "0"}
            if path == "/fapi/v1/positionSide/dual":
                return 200, {"dualSidePosition": True}
            if path == "/fapi/v1/multiAssetsMargin":
                return 200, {"multiAssetsMargin": True}
            if path in ("/fapi/v2/positionRisk", "/fapi/v3/positionRisk"):
                return 200, self._position_rows(symbol)
            if path == "/fapi/v1/openOrders":
                return 200, [self._order_row(order) for order in self.orders.values()
                             if order.status in ("NEW", "PARTIALLY_FILLED") and symbol in (None, order.symbol)]
            if path == "/fapi/v1/allOrders":
                return 200, [self._order_row(order) for order in self.orders.values() if order.symbol == symbol]
            if path in ("/fapi/v1/openAlgoOrders", "/fapi/v1/algoOpenOrders"):
                return 200, [self._algo_row(algo) for algo in self.algos.values()
                             if algo.status == "NEW" and symbol in (None, algo.symbol)]
            if path == "/fapi/v1/allAlgoOrders":
                return 200, [self._algo_row(algo) for algo in self.algos.values() if algo.symbol == symbol]
            if path == "/fapi/v1/userTrades":
                return 200, [trade for trade in self.trades if trade["symbol"] == symbol]
            if path == "/fapi/v1/order":
                return self._order(method, params)
            if path == "/fapi/v1/algoOrder":
                return self._algo(method, params)
            if path in ("/fapi/v1/allOpenOrders",):
                for order in self.open_orders():
                    if order.symbol == symbol:
                        order.status = "CANCELED"
                        self._order_update(order, "CANCELED")
                return 200, {"code": 200, "msg": "The operation of cancel all open order is done."}
            if path == "/fapi/v1/algoOpenOrders" and method == "DELETE":
                for algo in self.open_algos():
                    if algo.symbol == symbol:
                        algo.status = "CANCELED"
                        self._algo_update(algo)
                return 200, {"code": 200, "msg": "success"}
        return 404, {"code": -5000, "msg": f"fake venue: no route {method} {path}"}

    def _find(self, table: dict, params: dict, client_key: str, id_key: str):
        if params.get(id_key):
            return table.get(int(params[id_key]))
        return next((found for found in table.values() if found.client_id == params.get(client_key)), None)

    def _order(self, method: str, params: dict) -> tuple[int, object]:
        if method == "GET":
            order = self._find(self.orders, params, "origClientOrderId", "orderId")
            return (200, self._order_row(order)) if order else (400, {"code": -2013, "msg": "Order does not exist."})
        if method == "DELETE":
            order = self._find(self.orders, params, "origClientOrderId", "orderId")
            if order is None or order.status not in ("NEW", "PARTIALLY_FILLED"):
                return 400, {"code": -2011, "msg": "Unknown order sent."}
            order.status, order.update_ms = "CANCELED", now_ms()
            self._order_update(order, "CANCELED")
            return 200, self._order_row(order)
        symbol = params["symbol"]
        if self.status[symbol] != "TRADING":
            return 400, {"code": -4140, "msg": "Invalid symbol status for opening position."}
        kind = params["type"]
        if kind not in ("LIMIT", "MARKET"):
            return 400, {"code": -4120, "msg": "Order type not supported for this endpoint. Please use the Algo "
                                               "Order API endpoints instead."}
        good_till = int(params["goodTillDate"]) if params.get("goodTillDate") else None
        if params.get("timeInForce") == "GTD" and (good_till is None or good_till < now_ms() + 600_000):
            return 400, {"code": -1102, "msg": "Mandatory parameter 'goodTillDate' was not sent, was empty/null, "
                                               "or malformed."}
        side, leg = params["side"], params.get("positionSide", "BOTH")
        held = self.positions.get((symbol, leg), Position()).amount
        if (leg, side) in (("LONG", "SELL"), ("SHORT", "BUY")) and Decimal(params["quantity"]) > abs(held):
            return 400, {"code": -2022, "msg": "ReduceOnly Order is rejected."}  # hedge mode: a close needs its leg
        if any(found.client_id == params.get("newClientOrderId") for found in self.orders.values()):
            return 400, {"code": -4116, "msg": "ClientOrderId is duplicated."}
        order = Order(next(self.ids), params.get("newClientOrderId") or f"fake-{next(self.ids)}", symbol,
                      params["side"], params.get("positionSide", "BOTH"), kind, Decimal(params["quantity"]),
                      Decimal(params.get("price", "0")), params.get("timeInForce", "GTC"),
                      params.get("reduceOnly") == "true", good_till)
        self.orders[order.order_id] = order
        self._order_update(order, "NEW")
        row = self._order_row(order)
        last = self.last[symbol]
        if kind == "MARKET" or (order.side == "BUY" and order.price >= last) or \
                (order.side == "SELL" and order.price <= last):
            threading.Timer(0.05, self._fill_later, (order.order_id, last)).start()
        return 200, row

    def _fill_later(self, order_id: int, price: Decimal) -> None:
        with self.lock:
            order = self.orders[order_id]
            if order.status == "NEW":
                self._fill(order, price if order.type == "MARKET" else min(price, order.price)
                           if order.side == "BUY" else max(price, order.price), maker=False)

    def _algo(self, method: str, params: dict) -> tuple[int, object]:
        if method == "GET":
            algo = self._find(self.algos, params, "clientAlgoId", "algoId")
            return (200, self._algo_row(algo)) if algo else (400, {"code": -2013, "msg": "Order does not exist."})
        if method == "DELETE":
            algo = self._find(self.algos, params, "clientAlgoId", "algoId")
            if algo is None or algo.status != "NEW":
                return 400, {"code": -2011, "msg": "Unknown order sent."}
            algo.status, algo.update_ms = "CANCELED", now_ms()
            self._algo_update(algo)
            return 200, {"algoId": algo.algo_id, "clientAlgoId": algo.client_id, "code": "200", "msg": "success"}
        symbol = params["symbol"]
        trigger = Decimal(params["triggerPrice"])
        last = self.last[symbol]
        if (params["side"] == "SELL" and trigger >= last) or (params["side"] == "BUY" and trigger <= last):
            return 400, {"code": -2021, "msg": "Order would immediately trigger."}
        algo = Algo(next(self.ids), params.get("clientAlgoId") or f"fake-{next(self.ids)}", symbol, params["side"],
                    params.get("positionSide", "BOTH"), params["type"], Decimal(params["quantity"]), trigger,
                    params.get("timeInForce", "GTC"), params.get("reduceOnly") == "true")
        self.algos[algo.algo_id] = algo
        self._algo_update(algo)
        return 200, self._algo_row(algo)

    # -- transport ------------------------------------------------------------------------------------------------

    def _fault(self, method: str, path: str) -> dict | None:
        with self.lock:
            for found in self.faults:
                if found["method"] == method and found["path"] == path and found["times"] > 0:
                    found["times"] -= 1
                    return found
        return None

    def _handler(self):
        venue = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def _serve(self, method: str):
                parts = urllib.parse.urlsplit(self.path)
                if self.headers.get("Upgrade", "").lower() == "websocket":
                    return venue._upgrade(self, parts)
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length).decode() if length else ""
                params = dict(urllib.parse.parse_qsl(parts.query)) | dict(urllib.parse.parse_qsl(body))
                public = not ("signature" in params or parts.path == "/fapi/v1/listenKey")
                fault = venue._fault(method, parts.path)
                if fault is not None and "hang" in fault:
                    time.sleep(fault["hang"])
                    fault = None
                if fault is not None and "lose" in fault:
                    venue.answer(method, parts.path, params)
                    status, answer, headers = fault["lose"], fault["body"], {}
                elif fault is not None:
                    status, answer, headers = fault["status"], fault["body"], fault["headers"]
                elif not public and parts.path != "/fapi/v1/listenKey" and \
                        not venue._signed(parts.query, body, self.headers):
                    status, answer, headers = 400, {"code": -1022, "msg": "Signature for this request is not "
                                                                           "valid."}, {}
                else:
                    try:
                        status, answer = venue.answer(method, parts.path, params)
                    except Exception as exc:  # a fake's own defect: answered, and kept for the test to see
                        venue.errors.append(f"{method} {parts.path}: {exc!r}")
                        status, answer = 500, {"code": -1000, "msg": f"fake venue error {exc!r}"}
                    headers = {}
                with venue.lock:
                    venue.requests.append((method, parts.path, status))
                data = json.dumps(answer).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("X-MBX-USED-WEIGHT-1M", "1")
                for name, value in headers.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                self._serve("GET")

            def do_POST(self):
                self._serve("POST")

            def do_PUT(self):
                self._serve("PUT")

            def do_DELETE(self):
                self._serve("DELETE")

        return Handler

    def _upgrade(self, handler, parts) -> None:
        key = handler.headers["Sec-WebSocket-Key"].encode()
        accept = base64.b64encode(hashlib.sha1(key + WS_GUID).digest()).decode()
        handler.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                             f"Sec-WebSocket-Accept: {accept}\r\n\r\n").encode())
        handler.wfile.flush()
        handler.close_connection = True
        query = dict(urllib.parse.parse_qsl(parts.query))
        connection = Socket(handler.connection, handler.rfile, self)
        with self.lock:
            self.requests.append(("WS", parts.path, 101))
        if "listenKey" in query:
            if query["listenKey"] not in self.listen_keys:
                connection.close()
                return
            self.user_sockets.append(connection)
            sockets = self.user_sockets
        elif "streams" in query:
            connection.streams.update(query["streams"].split("/"))
            self.side_sockets.append(connection)
            sockets = self.side_sockets
        else:
            self.market_sockets.append(connection)
            sockets = self.market_sockets
        try:
            connection.receive()
        finally:
            connection.close()
            if connection in sockets:
                sockets.remove(connection)


class Socket:
    """One server-side WebSocket: unmasked frames out, masked frames in; SUBSCRIBE and ping are answered."""

    def __init__(self, raw: socket.socket, stream, venue: Venue):
        self.raw, self.stream, self.venue = raw, stream, venue
        self.streams: set[str] = set()
        self.write_lock = threading.Lock()
        self.closed = False

    def send(self, message: dict) -> None:
        self._frame(0x1, json.dumps(message).encode())

    def _frame(self, opcode: int, payload: bytes) -> None:
        if self.closed:
            return
        size = len(payload)
        head = bytes([0x80 | opcode]) + (bytes([size]) if size < 126 else
                                         bytes([126]) + struct.pack(">H", size) if size < 65536 else
                                         bytes([127]) + struct.pack(">Q", size))
        try:
            with self.write_lock:
                self.raw.sendall(head + payload)
        except OSError:
            self.close()

    def _read(self, count: int) -> bytes:
        data = self.stream.read(count)
        if len(data) != count:
            raise ConnectionError
        return data

    def receive(self) -> None:
        try:
            while not self.closed:
                first, second = self._read(2)
                opcode, size = first & 0x0F, second & 0x7F
                if size == 126:
                    size = struct.unpack(">H", self._read(2))[0]
                elif size == 127:
                    size = struct.unpack(">Q", self._read(8))[0]
                mask = self._read(4) if second & 0x80 else b"\0\0\0\0"
                payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(self._read(size)))
                if opcode == 0x8:
                    self._frame(0x8, payload[:2])
                    return
                if opcode == 0x9:
                    self._frame(0xA, payload)
                elif opcode == 0x1:
                    self._message(json.loads(payload))
        except (OSError, ConnectionError, ValueError):
            return

    def _message(self, message: dict) -> None:
        method, params = message.get("method"), message.get("params") or []
        if method == "SUBSCRIBE":
            self.streams.update(params)
            with self.venue.lock:
                self.venue.subscriptions += params
        elif method == "UNSUBSCRIBE":
            self.streams.difference_update(params)
        self.send({"result": None, "id": message.get("id")})

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.raw.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.raw.close()
