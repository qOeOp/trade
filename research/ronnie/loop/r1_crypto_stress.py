"""Loop M-2 (loop/LOG.md): crypto-native stress gauges (funding, open interest, stablecoin supply and peg, Coinbase
premium) as pauses for R-1 longs or shorts. Public data only; thresholds fixed in advance. Usage: python loop/r1_crypto_stress.py"""
import io, json, os, sys, time, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import r1_macro as M  # noqa: E402

VISION = "https://data.binance.vision/data"
DEV = (pd.Timestamp("2020-07-01", tz="UTC"), E.ITER[1])


def get(url, path):
    path = os.path.join(E.CACHE, "crypto_stress", path)
    if os.path.exists(path):
        return open(path, "rb").read() or None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    b = b""
    for k in range(5):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "research"}), timeout=60).read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                break
            time.sleep(2 ** k)
        except Exception:
            time.sleep(2 ** k)
    open(path, "wb").write(b)
    return b or None


def unzip_csv(b):
    z = zipfile.ZipFile(io.BytesIO(b))
    return pd.read_csv(z.open(z.namelist()[0]), header=None)


def funding():
    rows = []
    for m in pd.period_range("2020-01", "2026-08", freq="M"):
        b = get(f"{VISION}/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-{m}.zip", f"fund_{m}.zip")
        if b:
            d = unzip_csv(b)
            d = d[pd.to_numeric(d[0], errors="coerce").notna()]
            rows.append(pd.DataFrame({"t": pd.to_datetime(d[0].astype("int64"), unit="ms", utc=True), "r": d[2].astype(float)}))
    f = pd.concat(rows)
    return f.set_index("t").r.resample("D").mean()


def open_interest():
    days = pd.date_range("2020-08-01", "2026-08-31", freq="D")

    def one(day):
        b = get(f"{VISION}/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-{day:%Y-%m-%d}.zip", f"metrics_{day:%Y-%m-%d}.zip")
        if not b:
            return None
        d = unzip_csv(b)
        d = d[d[0] != "create_time"]
        return day, pd.to_numeric(d[3], errors="coerce").iloc[-1]
    with ThreadPoolExecutor(8) as ex:
        got = [x for x in ex.map(one, days) if x is not None]
    return pd.Series([v for _, v in got], index=pd.DatetimeIndex([t for t, _ in got]).tz_localize("UTC")).dropna()


def stable_supply():
    j = json.loads(get("https://stablecoins.llama.fi/stablecoincharts/all", "stable_all.json"))
    return pd.Series([float(x["totalCirculatingUSD"]["peggedUSD"]) for x in j],
                     index=pd.to_datetime([int(x["date"]) for x in j], unit="s", utc=True)).resample("D").last()


def usdc():
    rows = []
    for m in pd.period_range("2019-01", "2026-08", freq="M"):
        b = get(f"{VISION}/spot/monthly/klines/USDCUSDT/1d/USDCUSDT-1d-{m}.zip", f"usdc_{m}.zip")
        if b:
            d = unzip_csv(b)
            ts = d[0].astype("int64")
            ts = np.where(ts > 10**14, ts // 1000, ts)
            rows.append(pd.Series(d[4].astype(float).values, index=pd.to_datetime(ts, unit="ms", utc=True)))
    return pd.concat(rows).sort_index()


def coinbase():
    out = []
    t = pd.Timestamp("2019-06-01", tz="UTC")
    while t < pd.Timestamp("2026-09-01", tz="UTC"):
        e = t + pd.Timedelta(days=299)
        b = get(f"https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400&start={t:%Y-%m-%d}&end={e:%Y-%m-%d}", f"cb_{t:%Y-%m-%d}.json")
        if b:
            out += json.loads(b)
        t = e + pd.Timedelta(days=1)
    d = pd.DataFrame(out, columns=["t", "l", "h", "o", "c", "v"]).drop_duplicates("t")
    return pd.Series(d.c.values, index=pd.to_datetime(d.t, unit="s", utc=True)).sort_index()


def trail_pct(x, q):
    return x.rolling(365, min_periods=180).quantile(q)


def gauges():
    btc = E.bars("BTC")["1d"].close
    fr = funding().rolling(7).mean()
    oi = open_interest()
    oi14 = oi.pct_change(14)
    px14 = btc.reindex(oi14.index).pct_change(14)
    st = stable_supply()
    uc = usdc()
    cb = coinbase()
    prem = (cb / btc.reindex(cb.index) - 1).rolling(7).mean()
    days = pd.date_range("2019-01-01", "2026-09-30", freq="D", tz="UTC")
    g = pd.DataFrame(index=days)
    g["funding_hot"] = (fr > trail_pct(fr, 0.95)).reindex(days)
    g["funding_cold"] = (fr < trail_pct(fr, 0.05)).reindex(days)
    g["oi_build"] = ((oi14 > trail_pct(oi14, 0.90)) & (px14 < 0.02)).reindex(days)
    g["stable_out"] = (st.diff(30) < 0).reindex(days)
    g["depeg"] = ((uc - 1).abs() > 0.005).astype(float).rolling(3, min_periods=1).max().reindex(days) > 0
    g["cb_weak"] = (prem < trail_pct(prem, 0.10)).reindex(days)
    g = g.astype(float).fillna(0.0)
    g["long_stress"] = (g[["funding_hot", "oi_build", "stable_out", "depeg", "cb_weak"]].sum(axis=1) >= 2).astype(float)
    return g.shift(1)  # usable on the next UTC day


def main():
    G = gauges()
    G.to_csv(os.path.join(HERE, "out", "M-2_gauges.csv.gz"))
    out = ["M-2: crypto-native stress gauges for R-1 (realistic trades, f = 0)"]
    tests = {}
    for name, path, (t0, t1) in (("development", "S-1_orders.csv.gz", DEV), ("validation", "S-3_val_orders.csv.gz", E.VAL)):
        t = M.trades(os.path.join(HERE, "out", path))
        t = t[(t.fill >= t0) & (t.fill < t1)].reset_index(drop=True)
        day = t.fill.dt.normalize()
        for c in G.columns:
            t[c] = G[c].reindex(day).fillna(0).values.astype(bool)
        gd = G.loc[t0:t1 - pd.Timedelta(days=1)]
        out.append(f"\n== {name} ({t0:%Y-%m} to {t1:%Y-%m}): {len(t)} trades, avg R {t.R.mean():+.3f} (longs {t.R[t.side == 1].mean():+.3f}, shorts {t.R[t.side == -1].mean():+.3f})")
        for c in G.columns:
            s_ = t[c]
            out.append(f"  {c:12s}: on {gd[c].mean():.0%} of days; longs in it {t.R[s_ & (t.side == 1)].mean():+.3f} ({(s_ & (t.side == 1)).sum()}) vs outside "
                       f"{t.R[~s_ & (t.side == 1)].mean():+.3f}; shorts in it {t.R[s_ & (t.side == -1)].mean():+.3f} ({(s_ & (t.side == -1)).sum()}) vs outside {t.R[~s_ & (t.side == -1)].mean():+.3f}")
        for rule, cond, side in (("A pause longs", "long_stress", 1), ("B pause shorts", "funding_cold", -1)):
            sub = (t.side == side).values
            inside = t[cond].values
            if (inside & sub).sum() < 5:
                out.append(f"  {rule}: too few trades in the condition ({(inside & sub).sum()})")
                tests[(name, rule)] = (1.0, np.nan)
                continue
            d_, (lo, hi), p, n_in = M.diff_ci(t, ~inside, pd.Series(sub))
            tests[(name, rule)] = (p, d_)
            keep = ~(inside & sub)
            base, sw = M.book(t, np.ones(len(t), bool), t0, t1), M.book(t, keep, t0, t1)
            rng = np.random.default_rng(61)
            share = (inside & sub).sum() / sub.sum()
            rnd = np.array([M.book(t, ~((rng.random(len(t)) < share) & sub), t0, t1) for _ in range(200)])
            out.append(f"  {rule}: outside minus inside {d_:+.3f} [{lo:+.3f}, {hi:+.3f}], p {p:.3f} ({n_in} trades paused)")
            out.append(f"    book: no pause total R {base[0]:.0f} / Sharpe {base[1]:.2f} / max DD {base[2]:.0f}R; pause {sw[0]:.0f} / {sw[1]:.2f} / {sw[2]:.0f}R;"
                       f" random pauses {rnd[:, 0].mean():.0f} / {rnd[:, 1].mean():.2f} [{np.percentile(rnd[:, 1], 5):.2f}, {np.percentile(rnd[:, 1], 95):.2f}] / {rnd[:, 2].mean():.0f}R")
    rules = sorted(("A pause longs", "B pause shorts"), key=lambda r: tests[("validation", r)][0])
    out.append("\nHolm on the validation tier (95%, two tests): " + ", ".join(
        f"{r} p {tests[('validation', r)][0]:.3f} vs {0.05 / (2 - n):.4f}, diff {tests[('validation', r)][1]:+.3f} (development {tests[('development', r)][1]:+.3f}) -> "
        f"{'PASS' if tests[('validation', r)][0] <= 0.05 / (2 - n) and tests[('validation', r)][1] >= 0.10 and tests[('development', r)][1] > 0 else 'fail'}"
        for n, r in enumerate(rules)))
    txt = "\n".join(out)
    print(txt)
    open(os.path.join(HERE, "r1_crypto_stress.txt"), "w").write(txt + "\n")
    E.log("M-2", "R-1 crypto stress pauses", "validation", dict(n=0, edge=np.nan, lo=np.nan, hi=np.nan), False, "see r1_crypto_stress.txt")


if __name__ == "__main__":
    main()
