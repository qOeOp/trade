"""A stand-in Binance for the market tests: archives with their .CHECKSUM, the S3 listing, exchangeInfo
and the public REST endpoints, served by replacing `market.sources._get` (no network)."""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from contextlib import contextmanager
from datetime import UTC, date, datetime
import hashlib
import io
import json
import multiprocessing
import urllib.parse
from unittest.mock import patch
import zipfile

from market import sources


MINUTE = 60_000
DAY = 86_400_000


def day_ms(value: date) -> int:
    return int(datetime(value.year, value.month, value.day, tzinfo=UTC).timestamp() * 1000)


def zipped(name: str, text: str) -> bytes:
    sink = io.BytesIO()
    with zipfile.ZipFile(sink, "w") as archive:
        archive.writestr(name, text)
    return sink.getvalue()


def minutes(start_ms: int, end_ms: int, *, mark: bool = False, base: float = 100.0) -> list[tuple]:
    """Kline rows walking a cent a minute; every 7th LAST minute does not trade; MARK carries 8 decimals."""
    rows = []
    for at in range(start_ms, end_ms, MINUTE):
        i = at // MINUTE
        price = f"{base + (i % 997) / 100:.2f}" + ("345678" if mark else "")
        volume = "0" if mark or i % 7 == 0 else "1.5"
        rows.append((at, price, price, price, price, volume, at + MINUTE - 1, "0"))
    return rows


def kline_csv(rows: list[tuple]) -> str:
    head = "open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume," \
           "taker_buy_quote_volume,ignore\n"
    return head + "".join(f"{r[0]},{r[1]},{r[2]},{r[3]},{r[4]},{r[5]},{r[6]},{r[7]},1,0,0,0\n" for r in rows)


def daily_native(rows: list[tuple]) -> list[list]:
    """The exchange's own daily klines of LAST minute rows (the derivation rule applied independently)."""
    by_day: dict[int, list[tuple]] = {}
    for row in rows:
        by_day.setdefault(row[0] - row[0] % DAY, []).append(row)
    found = []
    for start, day in sorted(by_day.items()):
        traded = [row for row in day if float(row[5]) > 0] or day
        found.append([start, traded[0][1], max(row[2] for row in traded), min(row[3] for row in traded), day[-1][4],
                      f"{sum(float(row[5]) for row in day):.1f}", start + DAY - 1, "0", 1, "0", "0", "0"])
    return found


class Exchange:
    """Archives by key, exchangeInfo symbols, and REST minute rows by (price type, symbol)."""

    def __init__(self, server_time: int):
        self.archives: dict[str, bytes] = {}
        self.info: list[dict] = []
        self.rest: dict[tuple[str, str], list[tuple]] = {}
        self.funding: dict[str, list[tuple[int, str]]] = {}
        self.server_time = server_time
        self.requests: list[str] = []

    def contract(self, symbol: str, *, status="TRADING", contract_type="PERPETUAL", underlying="COIN", base=None,
                 tick="0.01", step="0.001"):
        self.info.append({"symbol": symbol, "status": status, "contractType": contract_type, "quoteAsset": "USDT",
                          "baseAsset": base or symbol.removesuffix("USDT"), "underlyingType": underlying,
                          "underlyingSubType": ["Test"],
                          "filters": [{"filterType": "PRICE_FILTER", "tickSize": tick, "minPrice": "0.01",
                                       "maxPrice": "1000000"},
                                      {"filterType": "LOT_SIZE", "stepSize": step, "minQty": step, "maxQty": "1000"},
                                      {"filterType": "MIN_NOTIONAL", "notional": "5"}]})

    def put(self, key: str, data: bytes) -> None:
        self.archives[key] = data

    def klines(self, frequency: str, price_type: str, symbol: str, period: str, rows: list[tuple]) -> None:
        kind = sources.KIND_OF[price_type]
        stem = f"{symbol}-1m-{period}"
        self.put(f"{sources.UM}/{frequency}/{kind}/{symbol}/1m/{stem}.zip", zipped(stem + ".csv", kline_csv(rows)))

    def funding_month(self, symbol: str, month: str, rows: list[tuple[int, str]]) -> None:
        stem = f"{symbol}-fundingRate-{month}"
        text = "calc_time,funding_interval_hours,last_funding_rate\n" + "".join(f"{at},8,{rate}\n" for at, rate in rows)
        self.put(f"{sources.UM}/monthly/fundingRate/{symbol}/{stem}.zip", zipped(stem + ".csv", text))

    def get(self, url: str, **_) -> bytes:
        self.requests.append(url)
        if url.startswith(sources.ARCHIVE):
            key = urllib.parse.unquote(url[len(sources.ARCHIVE):])
            if key.endswith(".CHECKSUM"):
                body = self.archives.get(key.removesuffix(".CHECKSUM"))
                if body is None:
                    raise sources._NotPublished(url)
                return f"{hashlib.sha256(body).hexdigest()}  {key.rsplit('/', 1)[1]}\n".encode()
            if key not in self.archives:
                raise sources._NotPublished(url)
            return self.archives[key]
        if url.startswith(sources.LISTING):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            prefix = query.get("prefix", [""])[0]
            keys = "".join(f"<Contents><Key>{key}</Key></Contents>" for key in sorted(self.archives)
                           if key.startswith(prefix))
            return (f'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">{keys}'
                    "<IsTruncated>false</IsTruncated></ListBucketResult>").encode()
        parts = urllib.parse.urlsplit(url)
        query = {key: values[0] for key, values in urllib.parse.parse_qs(parts.query).items()}
        if parts.path == "/fapi/v1/exchangeInfo":
            self.server_time += 3_600_000  # each observation is a later one, as the exchange's clock runs on
            return json.dumps({"serverTime": self.server_time, "symbols": self.info}).encode()
        symbol = query.get("symbol")
        if symbol not in {item["symbol"] for item in self.info}:
            raise sources._bad_request(url, b'{"code":-1121,"msg":"Invalid symbol."}')
        low, high = int(query["startTime"]), int(query["endTime"])
        if parts.path == "/fapi/v1/fundingRate":
            return json.dumps([{"symbol": symbol, "fundingTime": at, "fundingRate": rate}
                               for at, rate in self.funding.get(symbol, []) if low <= at <= high][:1000]).encode()
        price_type = "LAST" if parts.path == "/fapi/v1/klines" else "MARK"
        if query["interval"] == "1d":
            rows = daily_native([row for row in self.rest.get(("LAST1d", symbol), [])])
        else:
            rows = [list(row) + [1, "0", "0", "0"] for row in self.rest.get((price_type, symbol), [])]
        return json.dumps([row for row in rows if low <= row[0] <= high][:1500]).encode()


@contextmanager
def serving(exchange: Exchange):
    with patch.object(sources, "_get", exchange.get), patch.object(sources, "REST_INTERVAL", 0.0), \
            patch.object(sources, "FUNDING_INTERVAL", 0.0):
        yield exchange


def serve_in_worker(exchange: Exchange) -> None:
    """A pool worker's initializer: the worker serves `exchange` (its copy taken when the pool starts)."""
    sources._get = exchange.get
    sources.REST_INTERVAL = sources.FUNDING_INTERVAL = 0.0


def worker_pool(max_workers: int) -> ProcessPoolExecutor:
    """A stand-in for the import's process pool: spawned workers serve the exchange this process serves."""
    return ProcessPoolExecutor(max_workers, mp_context=multiprocessing.get_context("spawn"),
                               initializer=serve_in_worker, initargs=(sources._get.__self__,))
