"""Hourly bars around every declared trade in tv/trades_annot.csv, for entry price and stop/target ordering.

Sources: Bitstamp BTC/USD (btc_1h.csv, from fetch_data.py) for every BTC symbol; FXCM's public hourly candles
(candledata.fxcorporate.com, the feed behind TradingView's FX: symbols) for the FX majors; Dukascopy hourly candles for
gold, oil, the dollar index, USD/CNH and the Nasdaq (Dukascopy allows about one request a minute); Binance public klines (data.binance.vision) for the altcoins, synthesised as ALT/BTC x
BTC/USDT where the USDT pair did not trade yet. Each window is scaled so the proxy's price at publish equals the
price on his chart (exchange premia differ); the factor is kept in the file name's companion row of trades.

tv/hourly/<uuid>.csv.gz: time (UTC seconds, bar open), open, high, low, close, already scaled; scale factor in
tv/hourly/scale.csv.
"""
import csv, gzip, io, json, lzma, os, struct, sys, time, urllib.error, urllib.request, zipfile

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from tv_calibrate import load_ideas  # noqa: E402

OUT = f"{HERE}/tv/hourly"
CACHE = f"{HERE}/tv/.cache"  # raw downloads, not committed
FORWARD_DAYS = {"1W": 240, "1D": 60, "240": 20, "60": 7}
BACK_DAYS = 90  # room for random-time control entries before publish
DUKA = {"XAUUSD": "XAUUSD", "GOLD": "XAUUSD", "USOIL": "LIGHTCMDUSD", "WTIUSD": "LIGHTCMDUSD", "SPX": "USA500IDXUSD",
        "NAS100USD": "USATECHIDXUSD", "DXY": "DOLLARIDXUSD"}
FXCM = {"EURUSD", "GBPUSD", "USDJPY", "NZDUSD", "USDCAD", "AUDUSD", "USDCHF", "GBPJPY", "EURAUD"}
DUKA_FX = {"USDCNH": "USDCNH", "GBPAUD": "GBPAUD"}
ALT_USDT = {"ETHUSD": "ETH", "LTCUSD": "LTC", "XRPUSD": "XRP", "EOSUSD": "EOS", "BCHUSD": "BCC|BCHABC|BCH", "IOTUSD": "IOTA",
            "ETCUSD": "ETC", "ADAUSD": "ADA"}
UA = {"User-Agent": "Mozilla/5.0"}


def get(url, tries=20):
    os.makedirs(CACHE, exist_ok=True)
    path = f"{CACHE}/{url.split('://')[1].replace('/', '_')}"
    if os.path.exists(path):
        return open(path, "rb").read() or None
    pause = 65 if "dukascopy" in url else 0.3  # Dukascopy answers 429 to more than about one request a minute
    for _ in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
            open(path, "wb").write(b)
            time.sleep(pause)
            return b
        except urllib.error.HTTPError as e:
            if e.code == 404:
                open(path, "wb").write(b"")
                return None
            time.sleep(max(pause, 5))
        except Exception:
            time.sleep(max(pause, 5))
    raise RuntimeError(f"failed {url}")


def months(t0, t1):
    d = pd.Timestamp(t0, unit="s").replace(day=1, hour=0, minute=0, second=0)
    while d.value // 10**9 < t1:
        yield d
        d = d + pd.offsets.MonthBegin(1)


def dukascopy(inst, t0, t1):
    rows = []
    for m in months(t0, t1):
        b = get(f"https://datafeed.dukascopy.com/datafeed/{inst}/{m.year}/{m.month - 1:02d}/BID_candles_hour_1.bi5")
        if not b:
            continue
        raw = lzma.decompress(b, format=lzma.FORMAT_ALONE)
        base = m.value // 10**9
        for off, o, c, lo, hi, _v in struct.iter_unpack(">5If", raw):
            rows.append((base + off, o, hi, lo, c))
    d = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close"]).astype(float)
    return d[(d.time >= t0) & (d.time < t1)]  # prices in points; scaled to the chart later


def fxcm(sym, t0, t1):
    rows, seen = [], set()
    for day in range(t0 - 7 * 86400, t1 + 7 * 86400, 86400):
        y, w, _ = pd.Timestamp(day, unit="s").isocalendar()
        if (y, w) in seen:
            continue
        seen.add((y, w))
        b = get(f"https://candledata.fxcorporate.com/H1/{sym}/{y}/{w}.csv.gz")
        if not b:
            continue
        d = pd.read_csv(io.BytesIO(gzip.decompress(b)))
        ts = (pd.to_datetime(d.DateTime, format="%m/%d/%Y %H:%M:%S.%f") - pd.Timestamp(0)) // pd.Timedelta(seconds=1)
        rows.append(pd.DataFrame({"time": ts, "open": d.BidOpen, "high": d.BidHigh, "low": d.BidLow, "close": d.BidClose}))
    d = pd.concat(rows) if rows else pd.DataFrame(columns=["time", "open", "high", "low", "close"])
    d = d.apply(pd.to_numeric, errors="raise")  # an empty week file makes the concat object-typed
    d["time"] = d.time.astype("int64")
    return d[(d.time >= t0) & (d.time < t1)]


def binance(pair, t0, t1, volume=False):
    rows = []
    for m in months(t0, t1):
        b = get(f"https://data.binance.vision/data/spot/monthly/klines/{pair}/1h/{pair}-1h-{m.year}-{m.month:02d}.zip")
        if not b:
            continue
        z = zipfile.ZipFile(io.BytesIO(b))
        for line in z.read(z.namelist()[0]).decode().splitlines():
            x = line.split(",")
            if not x[0].isdigit():
                continue
            ts = int(x[0])
            ts = ts // 1000 if ts < 10**14 else ts // 10**6
            rows.append((ts, *map(float, x[1:6 if volume else 5])))
    d = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close"] + (["volume"] if volume else []))
    return d[(d.time >= t0) & (d.time < t1)]


def binance_alt_usd(bases, t0, t1):
    for base in bases.split("|"):  # Binance renamed some pairs (BCC -> BCHABC -> BCH)
        d = binance(f"{base}USDT", t0, t1)
        if len(d) and d.time.min() <= t0 + 86400:
            return d
    base = bases.split("|")[0]
    a, b = binance(f"{base}BTC", t0, t1).set_index("time"), binance("BTCUSDT", t0, t1).set_index("time")
    j = a.join(b, rsuffix="_b", how="inner")
    # a product of two bars' highs is not the hour's high; good enough for ordering, flagged in scale.csv
    return pd.DataFrame({"time": j.index.values, **{k: (j[k] * j[f"{k}_b"]).values for k in ("open", "high", "low", "close")}})


def bitstamp(t0, t1):
    d = pd.read_csv(f"{HERE}/btc_1h.csv", index_col=0, parse_dates=True)
    d = d[d.volume > 0]
    d.insert(0, "time", d.index.as_unit("s").asi8)
    d = d[["time", "open", "high", "low", "close"]].reset_index(drop=True)
    return d[(d.time >= t0) & (d.time < t1)]


def source(sym):
    ex, s = sym.split(":")
    if "BTC" in s and s.endswith(("USD", "USDT")) or s == "XBTUSD":
        return "bitstamp", None
    if s in FXCM:
        return "fxcm", s
    if s in DUKA_FX:
        return "dukascopy", DUKA_FX[s]
    if s in DUKA:
        return "dukascopy", DUKA[s]
    if s in ALT_USDT:
        return "binance_usd", ALT_USDT[s]
    if s.endswith("BTC"):
        return "binance", s
    raise KeyError(sym)


def main():
    os.makedirs(OUT, exist_ok=True)
    ideas = {I["it"]["uuid"]: I for I in load_ideas()}
    only = set(sys.argv[1:])  # optional uuids: fetch just these
    trades = [r for r in csv.DictReader(open(f"{HERE}/tv/trades_annot.csv")) if r["side"] and (not only or r["uuid"] in only)]
    sym_of = lambda r: ideas[r["uuid"]]["it"]["chart_symbol"] or ideas[r["uuid"]]["it"]["symbol"]  # noqa: E731
    trades.sort(key=lambda r: source(sym_of(r))[0] == "dukascopy")  # the slow source last
    old = pd.read_csv(f"{OUT}/scale.csv").set_index("uuid") if os.path.exists(f"{OUT}/scale.csv") else None
    scale_rows = [] if not only or old is None else [dict(uuid=u, **old.loc[u].to_dict()) for u in old.index if u not in only]
    for r in trades:
        I = ideas[r["uuid"]]
        it = I["it"]
        sym = sym_of(r)
        if old is not None and r["uuid"] in old.index and os.path.exists(f"{OUT}/{r['uuid']}.csv.gz"):
            scale_rows.append(dict(uuid=r["uuid"], **old.loc[r["uuid"]].to_dict()))
            continue
        pub = int(pd.Timestamp(it["created_at"]).value // 10**9)
        t0, t1 = pub - BACK_DAYS * 86400, pub + FORWARD_DAYS[it["interval"]] * 86400
        kind, arg = source(sym)
        d = {"bitstamp": lambda: bitstamp(t0, t1), "dukascopy": lambda: dukascopy(arg, t0, t1), "fxcm": lambda: fxcm(arg, t0, t1),
             "binance": lambda: binance(arg, t0, t1), "binance_usd": lambda: binance_alt_usd(arg, t0, t1)}[kind]()
        d = d.sort_values("time").drop_duplicates("time")
        before = d[d.time < pub]
        if before.empty or d[d.time >= pub].empty:
            print(f"{r['uuid']} {sym}: no hourly data around publish")
            scale_rows.append(dict(uuid=r["uuid"], symbol=sym, source=kind, scale=np.nan, bars=len(d)))
            continue
        k = I["c"][-1] / before.close.iloc[-1]
        # Dukascopy prices are integer points; the scale also converts them, so snap the point size first
        if kind == "dukascopy":
            k_pts = 10.0 ** np.round(np.log10(k))
            d[["open", "high", "low", "close"]] *= k_pts
            k = I["c"][-1] / (before.close.iloc[-1] * k_pts)
        d[["open", "high", "low", "close"]] *= k
        with gzip.GzipFile(f"{OUT}/{r['uuid']}.csv.gz", "wb", mtime=0) as f:
            f.write(d.to_csv(index=False, float_format="%.10g").encode())
        scale_rows.append(dict(uuid=r["uuid"], symbol=sym, source=f"{kind}:{arg or ''}", scale=round(k, 5), bars=len(d)))
        print(f"{r['uuid']} {sym:<18} {kind:<12} scale {k:.4f} bars {len(d)}", flush=True)
        pd.DataFrame(scale_rows).to_csv(f"{OUT}/scale.csv", index=False)  # after every trade, so a re-run resumes


if __name__ == "__main__":
    main()
