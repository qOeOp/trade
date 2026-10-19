"""Binance public USD-M perpetual data: archive listings, checksummed archives and public REST.

Only data.binance.vision and the public `fapi` market endpoints are used; no account, key or
private endpoint. Every archive is checked against its `.CHECKSUM` before it is read. Prices and
volumes stay decimal strings here; `store` scales them exactly.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import json
from pathlib import Path
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ElementTree
import zipfile


ARCHIVE = "https://data.binance.vision/"
LISTING = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
REST = "https://fapi.binance.com"
UM = "data/futures/um"
KINDS = {"LAST": "klines", "MARK": "markPriceKlines"}
KLINE_COLUMNS = ("open_time", "open", "high", "low", "close", "volume", "close_time", "quote_volume",
                 "count", "taker_buy_volume", "taker_buy_quote_volume", "ignore")
_S3 = "{http://s3.amazonaws.com/doc/2006-03-01/}"


class SourceError(Exception):
    """A public source is unreachable, inconsistent or fails its checksum."""


class UnknownSymbol(SourceError):
    """REST does not know the symbol (HTTP 400): a contract removed from the exchange."""


_LOCAL = threading.local()


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


def get(url: str, *, attempts: int = 8) -> bytes:
    """GET with backoff on throttling, server errors and dropped connections; 404 raises at once."""
    parts = urllib.parse.urlsplit(url)
    target = parts.path + (f"?{parts.query}" if parts.query else "")
    delay = 1.0
    for attempt in range(attempts):
        try:
            connection = _connection(parts.netloc)
            connection.request("GET", target, headers={"User-Agent": "trade-market/1"})
            response = connection.getresponse()
            body = response.read()
            status, headers = response.status, response.headers
            if response.will_close:
                _drop(parts.netloc)
        except (OSError, http.client.HTTPException) as exc:
            _drop(parts.netloc)
            if attempt == attempts - 1:
                raise SourceError(f"{url}: {exc}") from exc
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue
        if status == 200:
            return body
        if status == 404:
            raise FileNotFoundError(url)
        if status == 400 and url.startswith(REST):
            raise UnknownSymbol(f"{url}: HTTP 400")
        if status not in (403, 418, 429, 500, 502, 503, 504) or attempt == attempts - 1:
            raise SourceError(f"{url}: HTTP {status}")
        # 403 (WAF), 418 and 429 are Binance's rate limits: wait them out.
        retry_after = headers.get("Retry-After")
        wait = (float(retry_after) if retry_after and retry_after.isdigit()
                else 60.0 * 2 ** attempt if status in (403, 418, 429) else delay)
        time.sleep(max(delay, wait))
        delay = min(delay * 2, 60)
    raise AssertionError("unreachable")


def _listing(prefix: str, *, delimiter: str | None) -> tuple[list[str], list[str]]:
    keys, prefixes, marker = [], [], ""
    while True:
        query = {"prefix": prefix, "marker": marker}
        if delimiter:
            query["delimiter"] = delimiter
        root = ElementTree.fromstring(get(f"{LISTING}?{urllib.parse.urlencode(query)}"))
        keys += [node.text for node in root.iter(f"{_S3}Key")]
        prefixes += [node.find(f"{_S3}Prefix").text for node in root.iter(f"{_S3}CommonPrefixes")]
        if root.findtext(f"{_S3}IsTruncated") != "true":
            return keys, prefixes
        marker = root.findtext(f"{_S3}NextMarker") or (keys or prefixes)[-1]


def archive_symbols() -> list[str]:
    """Every symbol with monthly USD-M kline archives, delisted ones included."""
    _, prefixes = _listing(f"{UM}/monthly/klines/", delimiter="/")
    return sorted(prefix.rstrip("/").rsplit("/", 1)[1] for prefix in prefixes)


def archive_keys(frequency: str, kind: str, symbol: str, interval: str | None, stem: str = "") -> list[str]:
    """Zip keys of one series, e.g. ('monthly', 'klines', 'BTCUSDT', '1m'); `stem` narrows by name prefix."""
    folder = f"{UM}/{frequency}/{kind}/{symbol}/" + (f"{interval}/" if interval else "")
    name = f"{symbol}-{interval}-" if interval else f"{symbol}-{kind}-"
    keys, _ = _listing(folder + name + stem, delimiter=None)
    return sorted(key for key in keys if key.endswith(".zip"))


def monthly_archives(cache: "Cache", kind: str, symbol: str, interval: str | None, months: list[str]) -> dict:
    """{month: verified local path} for the monthly archives that exist among `months`.

    A few months (an append) are fetched by their known names, a missing one answering 404; many
    months (a first import) are found with one listing instead of one request each.
    """
    stem = f"{UM}/monthly/{kind}/{symbol}/" + (f"{interval}/{symbol}-{interval}-" if interval else f"{symbol}-{kind}-")
    if len(months) > 3:
        keys = {period(key): key for key in archive_keys("monthly", kind, symbol, interval)}
        wanted = [keys[month] for month in months if month in keys]
        return dict(zip([period(key) for key in wanted], cache.fetch_all(wanted, 4)))
    found = {}
    for month in months:
        try:
            found[month] = cache.fetch(f"{stem}{month}.zip")
        except FileNotFoundError:
            continue
    return found


def period(key: str) -> str:
    """'YYYY-MM' or 'YYYY-MM-DD' from an archive key."""
    stem = key.rsplit("/", 1)[1].removesuffix(".zip")
    parts = stem.split("-")
    return "-".join(parts[-3:]) if len(parts[-1]) == 2 and len(parts[-2]) == 2 and len(parts[-3]) == 4 \
        else "-".join(parts[-2:])


class Cache:
    """Verified archive copies under a working directory; a lost copy is downloaded again."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def path(self, key: str) -> Path:
        return self.root / key

    def fetch(self, key: str) -> Path:
        target = self.path(key)
        checksum = target.with_name(target.name + ".CHECKSUM")
        if target.exists() and checksum.exists() and self._verified(target, checksum):
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        expected = get(ARCHIVE + urllib.parse.quote(key) + ".CHECKSUM")
        body = get(ARCHIVE + urllib.parse.quote(key))
        digest = hashlib.sha256(body).hexdigest()
        if digest != expected.split()[0].decode():
            raise SourceError(f"{key}: SHA-256 {digest} differs from its .CHECKSUM")
        for path, value in ((checksum, expected), (target, body)):
            partial = path.with_name(path.name + ".part")
            partial.write_bytes(value)
            partial.replace(path)
        return target

    @staticmethod
    def _verified(target: Path, checksum: Path) -> bool:
        return hashlib.sha256(target.read_bytes()).hexdigest() == checksum.read_text().split()[0]

    def fetch_all(self, keys: list[str], workers: int = 16) -> list[Path]:
        with ThreadPoolExecutor(workers) as pool:
            return list(pool.map(self.fetch, keys))


def _csv_lines(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != 1:
            raise SourceError(f"{path}: expected one CSV, found {names}")
        return archive.read(names[0]).decode().splitlines()


def kline_rows(path: Path) -> list[tuple]:
    """(open_time, open, high, low, close, volume, close_time, quote_volume) with decimal strings."""
    rows = []
    for line in _csv_lines(path):
        if not line or line.startswith("open_time"):
            continue
        cells = line.split(",")
        rows.append((int(cells[0]), *cells[1:6], int(cells[6]), cells[7]))
    return rows


def funding_rows(path: Path) -> list[tuple[int, str]]:
    """(funding_time, rate) from a monthly fundingRate archive."""
    rows = []
    for line in _csv_lines(path):
        if not line or line.startswith("calc_time"):
            continue
        calc_time, _, rate = line.split(",")
        rows.append((int(calc_time), rate))
    return rows


_THROTTLE = threading.Lock()
_LAST_REST: dict[str, float] = {}
# Seconds between requests in one process (an import divides the budget among its workers):
# klines weigh 10 against 2400 a minute; fundingRate has its own 500 per 5 minutes.
REST_INTERVAL = 0.25
FUNDING_INTERVAL = 0.7


def _rest(path: str, params: dict) -> list:
    interval = FUNDING_INTERVAL if path == "/fapi/v1/fundingRate" else REST_INTERVAL
    with _THROTTLE:
        wait = _LAST_REST.get(path, 0.0) + interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _LAST_REST[path] = time.monotonic()
    return json.loads(get(f"{REST}{path}?{urllib.parse.urlencode(params)}"))


def rest_klines(price_type: str, symbol: str, interval: str, start_ms: int, end_ms: int) -> list[tuple]:
    """Closed klines with open_time in [start_ms, end_ms), same tuple shape as `kline_rows`."""
    path = {"LAST": "/fapi/v1/klines", "MARK": "/fapi/v1/markPriceKlines"}[price_type]
    rows, cursor = [], start_ms
    while cursor < end_ms:
        page = _rest(path, {"symbol": symbol, "interval": interval, "startTime": cursor,
                            "endTime": end_ms - 1, "limit": 1500})
        if not page:
            break
        rows += [(int(item[0]), *item[1:6], int(item[6]), item[7]) for item in page if int(item[0]) < end_ms]
        cursor = int(page[-1][0]) + 1
    return rows


def rest_funding(symbol: str, start_ms: int, end_ms: int) -> list[tuple[int, str]]:
    rows, cursor = [], start_ms
    while cursor < end_ms:
        page = _rest("/fapi/v1/fundingRate", {"symbol": symbol, "startTime": cursor, "endTime": end_ms - 1,
                                              "limit": 1000})
        if not page:
            break
        rows += [(int(item["fundingTime"]), item["fundingRate"]) for item in page]
        cursor = int(page[-1]["fundingTime"]) + 1
    return rows


def exchange_info() -> dict:
    return json.loads(get(f"{REST}/fapi/v1/exchangeInfo"))

