"""Binance public USD-M perpetual sources (`market.fetch_archive`, `market.monthly_archives`,
`market.rest_klines`, `market.rest_funding`, `market.rest_exchange_info`).

Only data.binance.vision archives (each checked against the `.CHECKSUM` published beside it) and
the public `fapi` market endpoints are read; no account, key or private endpoint. Values stay the
exchange's decimal strings here; `market.store` scales them exactly. Every market refusal is a
`MarketError` with its catalogued code.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import io
import json
from pathlib import Path
import re
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ElementTree
import zipfile

import pyarrow as pa
import pyarrow.csv as pcsv


ARCHIVE = "https://data.binance.vision/"
LISTING = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
REST = "https://fapi.binance.com"
UM = "data/futures/um"
DAY = 86_400_000
KINDS = ("klines", "markPriceKlines", "fundingRate")
KIND_OF = {"LAST": "klines", "MARK": "markPriceKlines"}
MINUTE = 60_000
STEP_MS = {"1m": MINUTE, "1d": DAY}
KLINE_COLUMNS = ("open_time", "open", "high", "low", "close", "volume", "close_time", "quote_volume",
                 "count", "taker_buy_volume", "taker_buy_quote_volume", "ignore")
COLUMNS = ("open_time", "open", "high", "low", "close", "volume", "close_time")
KLINE_SCHEMA = pa.schema([("open_time", pa.int64()), *((name, pa.string()) for name in COLUMNS[1:6]),
                          ("close_time", pa.int64())])
SYMBOL = re.compile(r"[^\W_]+\Z")  # letters and digits of any script; no separator, quote or underscore
MONTH = re.compile(r"\d{4}-(0[1-9]|1[0-2])\Z")
_S3 = "{http://s3.amazonaws.com/doc/2006-03-01/}"


class MarketError(Exception):
    """A coded market refusal; nothing was written by the refused call."""

    def __init__(self, message: str, *, code: str, missing=()):
        super().__init__(message)
        self.code, self.message = code, str(message)
        self.missing = tuple(str(item) for item in missing)

    def __reduce__(self):  # a refusal crosses from a worker process with its code
        return _refuse, (self.message, self.code), {"missing": self.missing}

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "missing": list(self.missing)}


def _refuse(message: str, code: str, **extra) -> MarketError:
    return MarketError(message, code=code, **extra)


def check_symbol(symbol) -> str:
    if not isinstance(symbol, str) or not SYMBOL.fullmatch(symbol):
        raise _refuse(f"{symbol!r} is not an exchange contract code", "SOURCE_SHAPE", missing=(str(symbol),))
    return symbol


# HTTP

class _NotPublished(Exception):
    pass


_LOCAL = threading.local()
ATTEMPTS = 8
DOWNLOAD_BYTES = 1 << 20


def _connection(host: str) -> http.client.HTTPSConnection:
    """One kept-alive connection per thread and host: an import opens thousands of requests, and a
    new socket for each exhausts the ephemeral ports (Errno 49)."""
    pool = getattr(_LOCAL, "connections", None)
    if pool is None:
        pool = _LOCAL.connections = {}
    if host not in pool:
        pool[host] = http.client.HTTPSConnection(host, timeout=60)
    return pool[host]


def _drop(host: str) -> None:
    connection = getattr(_LOCAL, "connections", {}).pop(host, None)
    if connection is not None:
        connection.close()


def _get(url: str, path: Path | None = None) -> bytes:
    """GET with backoff on throttling, server errors and dropped connections. 404 is _NotPublished,
    400 from REST is SOURCE_UNKNOWN_SYMBOL, exhaustion is SOURCE_UNREACHABLE. With `path`, a 200 body
    goes to that file in bounded chunks instead of memory."""
    parts = urllib.parse.urlsplit(url)
    target = parts.path + (f"?{parts.query}" if parts.query else "")
    delay = 1.0
    for attempt in range(ATTEMPTS):
        try:
            connection = _connection(parts.netloc)
            connection.request("GET", target, headers={"User-Agent": "trade-market/2"})
            response = connection.getresponse()
            status, headers = response.status, response.headers
            if path is not None and status == 200:
                body = b""
                with path.open("wb") as stream:
                    while chunk := response.read(DOWNLOAD_BYTES):
                        stream.write(chunk)
            else:
                body = response.read()
            if response.will_close:
                _drop(parts.netloc)
        except (OSError, http.client.HTTPException) as exc:
            _drop(parts.netloc)
            if attempt == ATTEMPTS - 1:
                raise _refuse(f"{url}: {exc}", "SOURCE_UNREACHABLE", missing=(url,)) from exc
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue
        if status == 200:
            return body
        if status == 404:
            raise _NotPublished(url)
        if status == 400 and url.startswith(REST):
            raise _bad_request(url, body)
        if status not in (403, 418, 429, 500, 502, 503, 504) or attempt == ATTEMPTS - 1:
            raise _refuse(f"{url}: HTTP {status}", "SOURCE_UNREACHABLE", missing=(url,))
        # 403 (WAF), 418 and 429 are Binance's rate limits: wait them out.
        retry_after = headers.get("Retry-After")
        wait = (float(retry_after) if retry_after and retry_after.isdigit()
                else 60.0 * 2 ** attempt if status in (403, 418, 429) else delay)
        time.sleep(max(delay, wait))
        delay = min(delay * 2, 60)
    raise AssertionError("unreachable")


UNKNOWN_SYMBOL_CODE = -1121  # Binance's "Invalid symbol."


def _bad_request(url: str, body: bytes) -> MarketError:
    """HTTP 400 from the public endpoints: SOURCE_UNKNOWN_SYMBOL only for Binance's error -1121 (the
    contract is unknown); any other rejection is a malformed request, SOURCE_SHAPE."""
    try:
        found = json.loads(body)
    except ValueError:
        found = None
    code = found.get("code") if isinstance(found, dict) else None
    detail = found.get("msg") if isinstance(found, dict) else body[:200].decode("utf-8", "replace")
    if code == UNKNOWN_SYMBOL_CODE:
        return _refuse(f"{url}: the public endpoint does not know the contract ({detail})", "SOURCE_UNKNOWN_SYMBOL",
                       missing=(url,))
    return _refuse(f"{url}: HTTP 400 {code} {detail}", "SOURCE_SHAPE", missing=(url,))


# Archives (market.fetch_archive, market.monthly_archives)

def _sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _verified(target: Path, checksum: Path) -> bool:
    try:
        return _sha256(target) == checksum.read_text().split()[0].lower()
    except (OSError, IndexError):
        return False


def _cached(cache_root: Path, key: str) -> tuple[Path, Path]:
    """Where the cache keeps an archive and its .CHECKSUM."""
    target = Path(cache_root) / key
    return target, target.with_name(target.name + ".CHECKSUM")


def fetch_archive(cache_root: Path, key: str) -> Path:
    """market.fetch_archive: one monthly or daily archive, copied to disk in bounded chunks and checked
    against its published SHA-256 before it enters the cache."""
    target, checksum = _cached(cache_root, key)
    if _verified(target, checksum):
        return target
    partial = target.with_name(target.name + ".part")
    url = ARCHIVE + urllib.parse.quote(key)
    try:
        expected = _get(url + ".CHECKSUM")
        published = expected.split()[0].decode("ascii", errors="replace") if expected.split() else ""
        if not re.fullmatch(r"[0-9a-fA-F]{64}", published):
            raise _refuse(f"{key}: invalid .CHECKSUM", "CHECKSUM_MISMATCH", missing=(key,))
        target.parent.mkdir(parents=True, exist_ok=True)
        _get(url, partial)
        digest = _sha256(partial)
        if digest != published.lower():
            raise _refuse(f"{key}: SHA-256 {digest} differs from its .CHECKSUM {published}", "CHECKSUM_MISMATCH",
                          missing=(key,))
        checksum_partial = checksum.with_name(checksum.name + ".part")
        checksum_partial.write_bytes(expected)
        checksum_partial.replace(checksum)
        partial.replace(target)
    except _NotPublished as exc:
        raise _refuse(f"{key} is not published", "ARCHIVE_NOT_PUBLISHED", missing=(key,)) from exc
    finally:
        partial.unlink(missing_ok=True)
    return target


def published(cache_root: Path, key: str) -> Path | None:
    """fetch_archive, None for an archive Binance has not published."""
    try:
        return fetch_archive(cache_root, key)
    except MarketError as exc:
        if exc.code != "ARCHIVE_NOT_PUBLISHED":
            raise
        return None


def forget(cache_root: Path, key: str) -> None:
    """Drop an archive and its .CHECKSUM from the cache."""
    for path in _cached(cache_root, key):
        path.unlink(missing_ok=True)


def republished(cache_root: Path, key: str) -> bool | None:
    """None when the cache never held `key`; else whether Binance has published another checksum for it since (the
    stale copy is then dropped). An archive no longer published has not changed."""
    _, checksum = _cached(cache_root, key)
    if not checksum.is_file():
        return None
    try:
        remote = _get(ARCHIVE + urllib.parse.quote(key) + ".CHECKSUM").split()
    except _NotPublished:
        return False
    if remote and remote[0].decode("ascii", errors="replace").lower() != checksum.read_text().split()[0].lower():
        forget(cache_root, key)
        return True
    return False


def fetch_all(cache_root: Path, keys: list[str]) -> list[Path]:
    if not keys:
        return []
    with ThreadPoolExecutor(max(1, min(4, len(keys)))) as pool:
        return list(pool.map(lambda key: fetch_archive(cache_root, key), keys))


def _listed(prefix: str, node: ElementTree.Element | None) -> str:
    """The text of one listing entry (a Key or a CommonPrefixes Prefix); an entry without text is no key."""
    if node is None or not node.text:
        raise _refuse(f"the archive listing {prefix} holds an entry without a key", "SOURCE_SHAPE",
                      missing=(prefix,))
    return node.text


def _listing(prefix: str, *, delimiter: str | None) -> tuple[list[str], list[str]]:
    keys: list[str] = []
    prefixes: list[str] = []
    marker = ""
    while True:
        query = {"prefix": prefix, "marker": marker}
        if delimiter:
            query["delimiter"] = delimiter
        try:
            root = ElementTree.fromstring(_get(f"{LISTING}?{urllib.parse.urlencode(query)}"))
        except _NotPublished as exc:
            raise _refuse(f"the archive listing {prefix} is not reachable", "SOURCE_UNREACHABLE",
                          missing=(prefix,)) from exc
        page_keys = [_listed(prefix, node) for node in root.iter(f"{_S3}Key")]
        page_prefixes = [_listed(prefix, node.find(f"{_S3}Prefix")) for node in root.iter(f"{_S3}CommonPrefixes")]
        keys += page_keys
        prefixes += page_prefixes
        if root.findtext(f"{_S3}IsTruncated") != "true":
            return keys, prefixes
        # A truncated page continues after its marker, else after its own last entry; one with neither cannot continue.
        marker = root.findtext(f"{_S3}NextMarker") or (page_keys or page_prefixes or [""])[-1]
        if not marker:
            raise _refuse(f"the archive listing {prefix} is truncated with no entry to continue from",
                          "SOURCE_SHAPE", missing=(prefix,))


def archive_symbols() -> list[str]:
    """Every contract code with monthly USD-M kline archives, delisted ones included."""
    _, prefixes = _listing(f"{UM}/monthly/klines/", delimiter="/")
    return sorted(prefix.rstrip("/").rsplit("/", 1)[1] for prefix in prefixes)


def _stem(frequency: str, kind: str, symbol: str, interval: str | None) -> str:
    folder = f"{UM}/{frequency}/{kind}/{symbol}/" + (f"{interval}/" if interval else "")
    return folder + (f"{symbol}-{interval}-" if interval else f"{symbol}-{kind}-")


def period(key: str) -> str:
    """'YYYY-MM' or 'YYYY-MM-DD' of an archive key."""
    stem = key.rsplit("/", 1)[1].removesuffix(".zip")
    parts = stem.split("-")
    daily = len(parts) >= 3 and len(parts[-1]) == 2 and len(parts[-2]) == 2 and len(parts[-3]) == 4
    return "-".join(parts[-3:]) if daily else "-".join(parts[-2:])


def _check_series(kind: str, symbol: str, interval: str | None) -> None:
    if kind not in KINDS or (kind == "fundingRate") != (interval is None) or (
            interval is not None and interval not in STEP_MS):
        raise _refuse(f"archive kind {kind!r} with interval {interval!r} is no published series", "SOURCE_SHAPE",
                      missing=(str(kind),))
    check_symbol(symbol)


def monthly_archives(cache_root: Path, kind: str, symbol: str, interval: str | None,
                     months: list[str]) -> dict[str, Path]:
    """market.monthly_archives: {month: verified path} for the published monthly archives among `months`.

    A few months (an append) are fetched by their known names, an unpublished one answering 404;
    many months are found with one listing of the series instead of one request each.
    """
    _check_series(kind, symbol, interval)
    if not isinstance(months, list) or any(not isinstance(month, str) or not MONTH.fullmatch(month) for month in months):
        raise _refuse(f"months {months!r} are not YYYY-MM", "SOURCE_SHAPE", missing=("months",))
    stem = _stem("monthly", kind, symbol, interval)
    if len(months) > 3:
        listed, _ = _listing(stem, delimiter=None)
        out = {period(key) for key in listed if key.endswith(".zip")}
        wanted = [month for month in months if month in out]
        return dict(zip(wanted, fetch_all(cache_root, [f"{stem}{month}.zip" for month in wanted]), strict=True))
    found = {month: published(cache_root, f"{stem}{month}.zip") for month in months}
    return {month: path for month, path in found.items() if path is not None}


def daily_archives(cache_root: Path, kind: str, symbol: str, days: list[str]) -> dict[str, Path]:
    """{day: verified path} of the published one-minute daily archives among `days` (YYYY-MM-DD), found by
    one listing per month."""
    _check_series(kind, symbol, "1m")
    stem = _stem("daily", kind, symbol, "1m")
    wanted = set(days)
    keys = []
    for month in sorted({day[:7] for day in wanted}):
        listed, _ = _listing(stem + month, delimiter=None)
        keys += [key for key in listed if key.endswith(".zip") and period(key) in wanted]
    keys = sorted(set(keys))
    return dict(zip([period(key) for key in keys], fetch_all(cache_root, keys), strict=True))


def _csv(path: Path) -> bytes:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != 1:
            raise _refuse(f"{path}: expected one CSV, found {names}", "SOURCE_SHAPE", missing=(str(path),))
        return archive.read(names[0])


def archive_table(path: Path, period: str, low: int, high: int) -> pa.Table:
    """An archive's klines as (open_time, open, high, low, close, volume, close_time), prices and volumes as the
    exchange's decimal strings; refused SOURCE_SHAPE unless every row is a closed one-minute kline inside the
    archive's own month or day `period`, [low, high) (checked before any trimming to a window, so a file in other
    units or of another period is never silently dropped)."""
    raw = _csv(path)
    header = raw.startswith(b"open_time")
    try:
        table = pcsv.read_csv(io.BytesIO(raw), read_options=pcsv.ReadOptions(
            column_names=None if header else list(KLINE_COLUMNS)),
            convert_options=pcsv.ConvertOptions(include_columns=list(COLUMNS),
                                                column_types={field.name: field.type for field in KLINE_SCHEMA}))
    except pa.ArrowInvalid as exc:
        raise _refuse(f"{path}: rows do not parse as klines ({exc})", "SOURCE_SHAPE", missing=(str(path),)) from exc
    table = table.select(list(COLUMNS)).cast(KLINE_SCHEMA)
    opens, closes = table["open_time"].to_numpy(), table["close_time"].to_numpy()
    bad = (opens < low) | (opens >= high) | (opens % MINUTE != 0) | (closes != opens + MINUTE - 1)
    if bad.any():
        at = int(opens[int(bad.argmax())])
        raise _refuse(f"{path.name}: the row at {at} is no closed one-minute kline of {period}", "SOURCE_SHAPE",
                      missing=(str(path.name),))
    return table


def rows_table(rows: list[tuple]) -> pa.Table:
    """REST kline rows (same tuple shape as archive rows) as a kline table."""
    return pa.table([pa.array([row[index] for row in rows], field.type) for index, field in enumerate(KLINE_SCHEMA)],
                    schema=KLINE_SCHEMA)


def funding_rows(path: Path) -> list[tuple[int, str]]:
    """(funding_time, rate) of a monthly fundingRate archive (calc_time, interval hours, rate)."""
    rows = []
    for line in _csv(path).decode().splitlines():
        if not line or line.startswith("calc_time"):
            continue
        cells = line.split(",")
        if len(cells) != 3 or not cells[0].isdigit():
            raise _refuse(f"{path}: {line!r} is no funding row", "SOURCE_SHAPE", missing=(str(path),))
        rows.append((int(cells[0]), cells[2]))
    return rows


# Public REST (market.rest_klines, market.rest_funding, market.rest_exchange_info)

_THROTTLE = threading.Lock()
_LAST_REST: dict[str, float] = {}
# Seconds between requests in one process (an import divides the budget among its workers):
# klines weigh 10 against 2400 a minute; fundingRate has its own 500 per 5 minutes.
REST_INTERVAL = 0.25
FUNDING_INTERVAL = 0.7
PAGE = {"/fapi/v1/klines": 1500, "/fapi/v1/markPriceKlines": 1500, "/fapi/v1/fundingRate": 1000}


def _rest(path: str, params: dict):
    interval = FUNDING_INTERVAL if path == "/fapi/v1/fundingRate" else REST_INTERVAL
    with _THROTTLE:
        wait = _LAST_REST.get(path, 0.0) + interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _LAST_REST[path] = time.monotonic()
    try:
        return json.loads(_get(f"{REST}{path}?{urllib.parse.urlencode(params)}"))
    except _NotPublished as exc:
        raise _refuse(f"{path} answered 404", "SOURCE_UNREACHABLE", missing=(path,)) from exc
    except ValueError as exc:
        raise _refuse(f"{path} did not answer JSON", "SOURCE_SHAPE", missing=(path,)) from exc


def rest_klines(price_type: str, symbol: str, interval: str, start_ms: int, end_ms: int,
                now_ms: int | None = None) -> list[tuple]:
    """market.rest_klines: closed klines with open_time in [start_ms, end_ms) from the public endpoint,
    (open_time, open, high, low, close, volume, close_time, quote_volume) with decimal strings."""
    if price_type not in KIND_OF or interval not in STEP_MS or not isinstance(start_ms, int) \
            or not isinstance(end_ms, int) or start_ms >= end_ms or _off_grid(start_ms, interval) \
            or _off_grid(end_ms, interval):
        raise _refuse(f"rest_klines({price_type!r}, {interval!r}, {start_ms}, {end_ms}) is no closed-kline request",
                      "SOURCE_SHAPE", missing=("interval",))
    check_symbol(symbol)
    path = "/fapi/v1/klines" if price_type == "LAST" else "/fapi/v1/markPriceKlines"
    now = int(time.time() * 1000) if now_ms is None else now_ms
    rows, cursor = [], start_ms
    while cursor < end_ms:
        page = _rest(path, {"symbol": symbol, "interval": interval, "startTime": cursor, "endTime": end_ms - 1,
                            "limit": PAGE[path]})
        if not isinstance(page, list):
            raise _refuse(f"{path} for {symbol} did not answer a list", "SOURCE_SHAPE", missing=(symbol,))
        if not page:
            break
        for item in page:
            if not isinstance(item, list) or len(item) < 8 or _off_grid(int(item[0]), interval):
                raise _refuse(f"{path} for {symbol}: {item!r} is no kline row", "SOURCE_SHAPE", missing=(symbol,))
            if int(item[0]) < end_ms and int(item[6]) < now:
                rows.append((int(item[0]), *(str(value) for value in item[1:6]), int(item[6]), str(item[7])))
        following = int(page[-1][0]) + 1
        if following <= cursor:
            break
        cursor = following
    return rows


def _off_grid(ms: int, interval: str) -> bool:
    return ms % STEP_MS[interval] != 0


def rest_funding(symbol: str, start_ms: int, end_ms: int) -> list[tuple[int, str]]:
    """market.rest_funding: (funding_time_ms, rate) settled in [start_ms, end_ms), in settlement order."""
    if not isinstance(start_ms, int) or not isinstance(end_ms, int) or start_ms >= end_ms:
        raise _refuse(f"funding interval [{start_ms}, {end_ms}) is empty", "SOURCE_SHAPE", missing=("interval",))
    check_symbol(symbol)
    rows, cursor = [], start_ms
    while cursor < end_ms:
        page = _rest("/fapi/v1/fundingRate", {"symbol": symbol, "startTime": cursor, "endTime": end_ms - 1,
                                              "limit": PAGE["/fapi/v1/fundingRate"]})
        if not isinstance(page, list):
            raise _refuse(f"fundingRate for {symbol} did not answer a list", "SOURCE_SHAPE", missing=(symbol,))
        if not page:
            break
        for item in page:
            if not isinstance(item, dict) or "fundingTime" not in item or "fundingRate" not in item:
                raise _refuse(f"fundingRate for {symbol}: {item!r} lacks its time or rate", "SOURCE_SHAPE",
                              missing=(symbol,))
            if start_ms <= int(item["fundingTime"]) < end_ms:
                rows.append((int(item["fundingTime"]), str(item["fundingRate"])))
        following = int(page[-1]["fundingTime"]) + 1
        if following <= cursor:
            break
        cursor = following
    return rows


def rest_exchange_info() -> tuple[int, list[dict]]:
    """market.rest_exchange_info: (server time ms, the listed contracts' terms) from public exchangeInfo,
    every value the exchange's string."""
    try:
        info = json.loads(_get(f"{REST}/fapi/v1/exchangeInfo"))
    except (_NotPublished, ValueError) as exc:
        raise _refuse("exchangeInfo did not answer JSON", "SOURCE_UNREACHABLE", missing=("exchangeInfo",)) from exc
    if not isinstance(info, dict) or not isinstance(info.get("serverTime"), int) or not isinstance(
            info.get("symbols"), list):
        raise _refuse("exchangeInfo lacks its server time or contracts", "SOURCE_SHAPE", missing=("serverTime",))
    return info["serverTime"], [contract_terms(item) for item in info["symbols"]]


def contract_terms(item: dict) -> dict:
    """One exchangeInfo contract's status, type, assets and terms (its filters verbatim)."""
    try:
        filters = {entry["filterType"]: entry for entry in item["filters"]}
        price, lot = filters["PRICE_FILTER"], filters["LOT_SIZE"]
        found = {"symbol": item["symbol"], "status": item["status"], "contract_type": item.get("contractType"),
                 "quote_asset": item.get("quoteAsset"), "base_asset": item.get("baseAsset"),
                 "underlying_type": item.get("underlyingType"),
                 "underlying_sub_types": list(item.get("underlyingSubType") or ()),
                 "price_increment": price["tickSize"], "size_increment": lot["stepSize"],
                 "min_quantity": lot.get("minQty"), "max_quantity": lot.get("maxQty"),
                 "min_notional": (filters.get("MIN_NOTIONAL") or {}).get("notional"),
                 "min_price": price.get("minPrice"), "max_price": price.get("maxPrice")}
    except (KeyError, TypeError) as exc:
        raise _refuse(f"exchangeInfo contract {item.get('symbol') if isinstance(item, dict) else item!r} lacks a "
                      f"required field ({exc})", "SOURCE_SHAPE", missing=(str(exc),)) from exc
    if not all(isinstance(found[key], str) and found[key] for key in ("symbol", "status", "price_increment",
                                                                      "size_increment")):
        raise _refuse(f"exchangeInfo contract {found['symbol']!r} lacks its status or increments", "SOURCE_SHAPE",
                      missing=(str(found["symbol"]),))
    return found


# aggTrades daily archives (the complete aggTrades import's source)

def aggtrades_key(symbol: str, day: str) -> str:
    """The archive key of one UTC day's aggTrades of `symbol`."""
    return f"{UM}/daily/aggTrades/{check_symbol(symbol)}/{symbol}-aggTrades-{day}.zip"


def metrics_key(symbol: str, day: str) -> str:
    """The archive key of one UTC day's metrics (open interest and long/short ratios) of `symbol`."""
    return f"{UM}/daily/metrics/{check_symbol(symbol)}/{symbol}-metrics-{day}.zip"
