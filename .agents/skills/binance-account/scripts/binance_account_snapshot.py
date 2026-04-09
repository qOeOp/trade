#!/usr/bin/env python3

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import http.client
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

SPOT_BASE_URL = "https://api.binance.com"
FUTURES_BASE_URL = "https://fapi.binance.com"

SPOT_PROTECTIVE_TYPES = {
    "STOP_LOSS",
    "STOP_LOSS_LIMIT",
    "TAKE_PROFIT",
    "TAKE_PROFIT_LIMIT",
}

FUTURES_PROTECTIVE_TYPES = {
    "STOP",
    "STOP_MARKET",
    "TAKE_PROFIT",
    "TAKE_PROFIT_MARKET",
    "TRAILING_STOP_MARKET",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read Binance account balances, positions, open orders, and TP/SL "
            "using BINANCE_API_KEY and BINANCE_API_SECRET."
        )
    )
    parser.add_argument("--symbol", help="Optional symbol filter, e.g. BTCUSDT")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    parser.add_argument("--spot-only", action="store_true", help="Only query spot account data")
    parser.add_argument("--futures-only", action="store_true", help="Only query USD-M futures data")
    parser.add_argument("--check-env", action="store_true", help="Only verify required env vars")
    parser.add_argument("--timeout", type=float, default=10.0, help="HTTP timeout in seconds")
    parser.add_argument("--recv-window", type=int, default=60000, help="Binance recvWindow in ms")
    args = parser.parse_args()

    if args.spot_only and args.futures_only:
        parser.error("--spot-only and --futures-only cannot be used together")

    if args.symbol:
        args.symbol = args.symbol.upper()

    return args


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class BinanceHttpError(RuntimeError):
    pass


class BinanceClient:
    def __init__(self, api_key: str, api_secret: str, timeout: float, recv_window: int) -> None:
        self.api_key = api_key
        self.api_secret = api_secret.encode("utf-8")
        self.timeout = timeout
        self.recv_window = recv_window
        self.server_time_offsets: dict[str, int] = {}
        self.max_retries = 3

    def _open_json(self, request: urllib.request.Request, path: str) -> Any:
        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if exc.code in {500, 502, 503, 504} and attempt < self.max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise BinanceHttpError(f"{path} failed with HTTP {exc.code}: {body}") from exc
            except (
                urllib.error.URLError,
                http.client.IncompleteRead,
                http.client.RemoteDisconnected,
                ConnectionResetError,
                TimeoutError,
                ssl.SSLError,
            ) as exc:
                last_error = exc
                if attempt < self.max_retries - 1:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                reason = exc.reason if isinstance(exc, urllib.error.URLError) else str(exc)
                raise BinanceHttpError(f"{path} failed: {reason}") from exc

        if last_error is not None:
            raise BinanceHttpError(f"{path} failed: {last_error}") from last_error
        raise BinanceHttpError(f"{path} failed: unknown error")

    def get_server_time_offset(self, base_url: str) -> int:
        cached = self.server_time_offsets.get(base_url)
        if cached is not None:
            return cached

        time_path = "/api/v3/time" if base_url == SPOT_BASE_URL else "/fapi/v1/time"
        url = f"{base_url}{time_path}"
        request = urllib.request.Request(url)
        payload = self._open_json(request, time_path)

        server_time = int(payload["serverTime"])
        local_time = int(time.time() * 1000)
        offset = server_time - local_time
        self.server_time_offsets[base_url] = offset
        return offset

    def signed_get(self, base_url: str, path: str, params: dict[str, Any] | None = None) -> Any:
        return self._signed_get(base_url, path, params, retry_on_timestamp_error=True)

    def _signed_get(
        self,
        base_url: str,
        path: str,
        params: dict[str, Any] | None,
        retry_on_timestamp_error: bool,
    ) -> Any:
        query_params = dict(params or {})
        query_params["timestamp"] = int(time.time() * 1000) + self.get_server_time_offset(base_url)
        query_params["recvWindow"] = self.recv_window

        query = urllib.parse.urlencode(query_params, doseq=True)
        signature = hmac.new(self.api_secret, query.encode("utf-8"), hashlib.sha256).hexdigest()
        url = f"{base_url}{path}?{query}&signature={signature}"
        request = urllib.request.Request(url, headers={"X-MBX-APIKEY": self.api_key})

        try:
            return self._open_json(request, path)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if retry_on_timestamp_error and '"code":-1021' in body.replace(" ", ""):
                self.server_time_offsets.pop(base_url, None)
                return self._signed_get(base_url, path, params, retry_on_timestamp_error=False)
            message = body
            try:
                payload = json.loads(body)
                code = payload.get("code")
                msg = payload.get("msg")
                if code is not None or msg is not None:
                    message = f"code={code} msg={msg}"
            except json.JSONDecodeError:
                pass
            raise BinanceHttpError(f"{path} failed with HTTP {exc.code}: {message}") from exc
        except BinanceHttpError:
            raise


def check_env() -> tuple[bool, list[str]]:
    missing = [name for name in ("BINANCE_API_KEY", "BINANCE_API_SECRET") if not os.getenv(name)]
    return (not missing, missing)


def keep_spot_balance(balance: dict[str, Any]) -> bool:
    return to_float(balance.get("free")) + to_float(balance.get("locked")) != 0.0


def normalize_spot_balance(balance: dict[str, Any]) -> dict[str, Any]:
    free = to_float(balance.get("free"))
    locked = to_float(balance.get("locked"))
    return {
        "asset": balance.get("asset"),
        "free": balance.get("free"),
        "locked": balance.get("locked"),
        "total": f"{free + locked:.8f}",
    }


def keep_futures_asset(asset: dict[str, Any]) -> bool:
    fields = (
        asset.get("walletBalance"),
        asset.get("availableBalance"),
        asset.get("unrealizedProfit"),
        asset.get("marginBalance"),
    )
    return any(to_float(value) != 0.0 for value in fields)


def normalize_futures_asset(asset: dict[str, Any]) -> dict[str, Any]:
    return {
        "asset": asset.get("asset"),
        "walletBalance": asset.get("walletBalance"),
        "availableBalance": asset.get("availableBalance"),
        "marginBalance": asset.get("marginBalance"),
        "unrealizedProfit": asset.get("unrealizedProfit"),
    }


def keep_position(position: dict[str, Any]) -> bool:
    return to_float(position.get("positionAmt")) != 0.0


def normalize_position(position: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": position.get("symbol"),
        "positionSide": position.get("positionSide"),
        "positionAmt": position.get("positionAmt"),
        "entryPrice": position.get("entryPrice"),
        "breakEvenPrice": position.get("breakEvenPrice"),
        "markPrice": position.get("markPrice"),
        "unRealizedProfit": position.get("unRealizedProfit"),
        "liquidationPrice": position.get("liquidationPrice"),
        "leverage": position.get("leverage"),
        "marginType": position.get("marginType"),
        "notional": position.get("notional"),
    }


def is_spot_protective(order: dict[str, Any]) -> bool:
    order_type = str(order.get("type", "")).upper()
    order_list_id = order.get("orderListId")
    return order_type in SPOT_PROTECTIVE_TYPES or order_list_id not in (-1, None)


def is_futures_protective(order: dict[str, Any]) -> bool:
    order_type = str(order.get("type", "")).upper()
    close_position = str(order.get("closePosition", "")).lower() == "true" or order.get("closePosition") is True
    return order_type in FUTURES_PROTECTIVE_TYPES or close_position


def normalize_order(order: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "symbol": order.get("symbol"),
        "side": order.get("side"),
        "type": order.get("type"),
        "status": order.get("status"),
        "origQty": order.get("origQty"),
        "price": order.get("price"),
        "stopPrice": order.get("stopPrice"),
        "timeInForce": order.get("timeInForce"),
        "orderId": order.get("orderId"),
    }
    if "positionSide" in order:
        normalized["positionSide"] = order.get("positionSide")
    if "closePosition" in order:
        normalized["closePosition"] = order.get("closePosition")
    if "activatePrice" in order:
        normalized["activatePrice"] = order.get("activatePrice")
    if "priceRate" in order:
        normalized["priceRate"] = order.get("priceRate")
    return normalized


def split_orders(orders: list[dict[str, Any]], protective_predicate) -> dict[str, list[dict[str, Any]]]:
    regular: list[dict[str, Any]] = []
    protective: list[dict[str, Any]] = []
    for order in orders:
        target = protective if protective_predicate(order) else regular
        target.append(normalize_order(order))
    return {"regular": regular, "protective": protective}


def fetch_section(fetcher, errors: dict[str, str], key: str) -> Any:
    try:
        return fetcher()
    except BinanceHttpError as exc:
        errors[key] = str(exc)
        return None


def build_snapshot(args: argparse.Namespace) -> dict[str, Any]:
    api_key = os.getenv("BINANCE_API_KEY", "")
    api_secret = os.getenv("BINANCE_API_SECRET", "")
    client = BinanceClient(api_key, api_secret, timeout=args.timeout, recv_window=args.recv_window)
    params = {"symbol": args.symbol} if args.symbol else {}

    snapshot: dict[str, Any] = {
        "generatedAt": now_iso(),
        "symbolFilter": args.symbol,
        "spot": None,
        "futures": None,
        "errors": {},
    }
    errors: dict[str, str] = {}

    if not args.futures_only:
        account = fetch_section(
            lambda: client.signed_get(SPOT_BASE_URL, "/api/v3/account"),
            errors,
            "spot.account",
        )
        orders = fetch_section(
            lambda: client.signed_get(SPOT_BASE_URL, "/api/v3/openOrders", params),
            errors,
            "spot.openOrders",
        )

        balances = []
        permissions = []
        if isinstance(account, dict):
            balances = [
                normalize_spot_balance(balance)
                for balance in account.get("balances", [])
                if keep_spot_balance(balance)
            ]
            permissions = account.get("permissions", [])

        snapshot["spot"] = {
            "permissions": permissions,
            "balances": balances,
            "openOrders": split_orders(orders or [], is_spot_protective) if isinstance(orders, list) else None,
        }

    if not args.spot_only:
        account = fetch_section(
            lambda: client.signed_get(FUTURES_BASE_URL, "/fapi/v3/account", params),
            errors,
            "futures.account",
        )
        positions = fetch_section(
            lambda: client.signed_get(FUTURES_BASE_URL, "/fapi/v3/positionRisk", params),
            errors,
            "futures.positionRisk",
        )
        orders = fetch_section(
            lambda: client.signed_get(FUTURES_BASE_URL, "/fapi/v1/openOrders", params),
            errors,
            "futures.openOrders",
        )

        balances = []
        account_flags: dict[str, Any] = {}
        if isinstance(account, dict):
            balances = [
                normalize_futures_asset(asset)
                for asset in account.get("assets", [])
                if keep_futures_asset(asset)
            ]
            account_flags = {
                "feeTier": account.get("feeTier"),
                "canTrade": account.get("canTrade"),
                "canDeposit": account.get("canDeposit"),
                "canWithdraw": account.get("canWithdraw"),
                "multiAssetsMargin": account.get("multiAssetsMargin"),
                "totalWalletBalance": account.get("totalWalletBalance"),
                "totalUnrealizedProfit": account.get("totalUnrealizedProfit"),
                "totalMarginBalance": account.get("totalMarginBalance"),
                "availableBalance": account.get("availableBalance"),
            }

        snapshot["futures"] = {
            "account": account_flags,
            "balances": balances,
            "positions": [
                normalize_position(position)
                for position in (positions or [])
                if keep_position(position)
            ]
            if isinstance(positions, list)
            else None,
            "openOrders": split_orders(orders or [], is_futures_protective) if isinstance(orders, list) else None,
        }

    snapshot["errors"] = errors
    return snapshot


def print_text(snapshot: dict[str, Any]) -> None:
    print("Binance account snapshot")
    print(f"Generated at: {snapshot['generatedAt']}")
    if snapshot.get("symbolFilter"):
        print(f"Symbol filter: {snapshot['symbolFilter']}")

    spot = snapshot.get("spot")
    if spot is not None:
        print("\n[Spot]")
        permissions = spot.get("permissions") or []
        if permissions:
            print(f"Permissions: {', '.join(permissions)}")

        balances = spot.get("balances") or []
        print(f"Balances: {len(balances)} non-zero asset(s)")
        for balance in balances:
            print(
                f"  - {balance['asset']}: total={balance['total']} "
                f"(free={balance['free']}, locked={balance['locked']})"
            )

        orders = spot.get("openOrders")
        if orders is not None:
            print(
                f"Open orders: {len(orders['regular'])} regular, "
                f"{len(orders['protective'])} protective"
            )
            for label in ("regular", "protective"):
                for order in orders[label]:
                    extra = []
                    if order.get("price"):
                        extra.append(f"price={order['price']}")
                    if order.get("stopPrice") and to_float(order.get("stopPrice")) != 0.0:
                        extra.append(f"stop={order['stopPrice']}")
                    print(
                        f"  - [{label}] {order['symbol']} {order['side']} {order['type']} "
                        f"qty={order['origQty']} {' '.join(extra)}".rstrip()
                    )

    futures = snapshot.get("futures")
    if futures is not None:
        print("\n[Futures]")
        account = futures.get("account") or {}
        summary_bits = [
            f"canTrade={account.get('canTrade')}",
            f"walletBalance={account.get('totalWalletBalance')}",
            f"unrealizedPnL={account.get('totalUnrealizedProfit')}",
            f"availableBalance={account.get('availableBalance')}",
        ]
        print("Account: " + ", ".join(bit for bit in summary_bits if not bit.endswith("=None")))

        balances = futures.get("balances") or []
        print(f"Assets: {len(balances)} non-zero asset(s)")
        for balance in balances:
            print(
                f"  - {balance['asset']}: wallet={balance['walletBalance']} "
                f"available={balance['availableBalance']} unrealized={balance['unrealizedProfit']}"
            )

        positions = futures.get("positions") or []
        print(f"Positions: {len(positions)} active position(s)")
        for position in positions:
            print(
                f"  - {position['symbol']} side={position.get('positionSide')} "
                f"amt={position['positionAmt']} entry={position['entryPrice']} "
                f"mark={position['markPrice']} pnl={position['unRealizedProfit']} "
                f"liq={position['liquidationPrice']}"
            )

        orders = futures.get("openOrders")
        if orders is not None:
            print(
                f"Open orders: {len(orders['regular'])} regular, "
                f"{len(orders['protective'])} protective"
            )
            for label in ("regular", "protective"):
                for order in orders[label]:
                    extra = []
                    if order.get("positionSide"):
                        extra.append(f"positionSide={order['positionSide']}")
                    if order.get("price"):
                        extra.append(f"price={order['price']}")
                    if order.get("stopPrice") and to_float(order.get("stopPrice")) != 0.0:
                        extra.append(f"stop={order['stopPrice']}")
                    if order.get("closePosition") not in (None, False, "false"):
                        extra.append(f"closePosition={order['closePosition']}")
                    print(
                        f"  - [{label}] {order['symbol']} {order['side']} {order['type']} "
                        f"qty={order['origQty']} {' '.join(extra)}".rstrip()
                    )

    if snapshot["errors"]:
        print("\n[Errors]")
        for key, message in snapshot["errors"].items():
            print(f"  - {key}: {message}")


def main() -> int:
    args = parse_args()
    ok, missing = check_env()
    if args.check_env:
        if ok:
            print("OK: BINANCE_API_KEY and BINANCE_API_SECRET are set")
            return 0
        print(f"Missing environment variables: {', '.join(missing)}", file=sys.stderr)
        return 1

    if not ok:
        print(f"Missing environment variables: {', '.join(missing)}", file=sys.stderr)
        return 1

    snapshot = build_snapshot(args)
    if args.json:
        print(json.dumps(snapshot, indent=2, ensure_ascii=False))
    else:
        print_text(snapshot)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
