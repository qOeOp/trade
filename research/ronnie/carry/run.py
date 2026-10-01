"""TrialFamily carry-v1: cash-and-carry funding hedges (K0 always on, K1 conditional, K2 cross-sectional) and funding as
a positioning signal (P1). See INTENT.md. Writes carry/daily.csv.gz and carry/result.txt.
"""
import gzip, importlib.util, io, os, sys, zipfile

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import tv_hourly  # noqa: E402

_spec = importlib.util.spec_from_file_location("range4_run", os.path.join(ROOT, "range4", "run.py"))
R4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R4)

SPOT_SIDE, PERP_SIDE = 0.0010, 0.0005
OPEN_CLOSE = 2 * (SPOT_SIDE + PERP_SIDE)
K1_IN, K1_OUT = 0.0001, 0.0
DEV = (pd.Timestamp("2020-01-01"), pd.Timestamp("2023-01-01"))
HOLD = (pd.Timestamp("2023-01-01"), pd.Timestamp("2026-09-01"))
PERP = {"PEPE": "1000PEPEUSDT", "SHIB": "1000SHIBUSDT"}
BASE = "https://data.binance.vision/data"


def monthly(kind, sym, t0="2020-01-01", t1="2026-09-01"):
    rows = []
    for m in pd.date_range(t0, t1, freq="MS", inclusive="left"):
        tag = f"{m.year}-{m.month:02d}"
        url = {"fund": f"{BASE}/futures/um/monthly/fundingRate/{sym}/{sym}-fundingRate-{tag}.zip",
               "perp": f"{BASE}/futures/um/monthly/klines/{sym}/1d/{sym}-1d-{tag}.zip",
               "spot": f"{BASE}/spot/monthly/klines/{sym}/1d/{sym}-1d-{tag}.zip"}[kind]
        b = tv_hourly.get(url, tries=3)
        if not b:
            continue
        z = zipfile.ZipFile(io.BytesIO(b))
        for line in z.read(z.namelist()[0]).decode().splitlines():
            x = line.split(",")
            if x[0].isdigit():
                rows.append(x)
    return rows


def ts(v):
    v = int(v)
    return pd.to_datetime(v // 1000 if v < 10**14 else v // 10**6, unit="s")


def coin_daily(coin):
    perp_sym = PERP.get(coin, f"{coin}USDT")
    f = monthly("fund", perp_sym)
    p = monthly("perp", perp_sym)
    s = monthly("spot", f"{coin}USDT")
    if not f or not p or not s:
        return None
    fund = pd.Series([float(x[2]) for x in f], index=[ts(x[0]) - pd.Timedelta(seconds=1) for x in f])
    fund = fund.groupby(fund.index.normalize()).sum()
    close = lambda rows: pd.Series([float(x[4]) for x in rows], index=[ts(x[0]).normalize() for x in rows])  # noqa: E731
    pc, sc = close(p), close(s)
    pc, sc = pc[~pc.index.duplicated()], sc[~sc.index.duplicated()]
    d = pd.DataFrame({"perp": pc, "spot": sc, "fund": fund}).dropna(subset=["perp", "spot"])
    d["fund"] = d.fund.fillna(0.0)
    d["perp_ret"], d["spot_ret"] = d.perp.pct_change(), d.spot.pct_change()
    d["hedge"] = d.spot_ret - d.perp_ret + d.fund
    d["f7"] = d.fund.rolling(7).sum().shift(1) / 21  # mean per 8 hours over the 7 days before day t
    d["f3"] = d.fund.rolling(3).sum().shift(1) / 9
    return d.dropna(subset=["hedge"])


def k1_path(d):
    held, out = False, []
    for f7, f3, h in zip(d.f7.values, d.f3.values, d.hedge.values):
        cost = 0.0
        if not held and f7 >= K1_IN:
            held, cost = True, OPEN_CLOSE / 2
        elif held and f3 < K1_OUT:
            held, cost = False, OPEN_CLOSE / 2
        out.append((h - cost) if held else (-cost if cost else np.nan))
    return pd.Series(out, index=d.index)


def week_boot(x, reps=4000, seed=3):
    x = np.asarray(x, float)
    b = np.random.default_rng(seed).choice(x, (reps, len(x))).mean(1)
    return np.percentile(b, 2.5), np.percentile(b, 97.5)


def main():
    data = {}
    for coin in R4.MAJORS + R4.LARGE:
        d = coin_daily(coin)
        if d is not None:
            data[coin] = d
        print(f"{coin}: {0 if d is None else len(d)} days", flush=True)
    allrows = pd.concat([d.assign(coin=c) for c, d in data.items()])
    with gzip.GzipFile(f"{HERE}/daily.csv.gz", "wb", mtime=0) as f:
        f.write(allrows.to_csv(float_format="%.6g").encode())
    out = ["carry-v1 (INTENT.md): long spot, short perpetual on Binance; daily hedge return = spot - perp + funding;",
           f"costs {OPEN_CLOSE:.2%} per open and close; returns per unit of hedge notional (capital is about twice that)", ""]
    verdict = {}
    for label, coins, (t0, t1) in (("dev", R4.MAJORS, DEV), ("holdout", R4.MAJORS + R4.LARGE, HOLD)):
        cs = [c for c in coins if c in data]
        H = pd.DataFrame({c: data[c].hedge for c in cs})
        H = H[(H.index >= t0) & (H.index < t1)]
        F = pd.DataFrame({c: data[c].fund for c in cs}).reindex(H.index)
        k0 = H.mean(axis=1)
        K1 = pd.DataFrame({c: k1_path(data[c]) for c in cs}).reindex(H.index)
        k1 = K1.mean(axis=1).fillna(0.0)
        wk0, wk1 = k0.resample("W-MON").sum(), k1.resample("W-MON").sum()
        lo, hi = week_boot(wk1)
        out.append(f"{label} ({len(cs)} coins, {H.index[0].date()} to {H.index[-1].date()}):")
        out.append(f"  funding: mean per day {F.stack().mean():+.4%} ({F.stack().mean() * 365:+.1%} a year); "
                   f"share of coin-days with negative funding {(F.stack() < 0).mean():.0%}")
        out.append(f"  K0 always on: {k0.mean() * 365:+.1%} a year, worst week {wk0.min():+.2%}, weekly sd {wk0.std():.2%}")
        out.append(f"  K1 conditional: {k1.mean() * 365:+.1%} a year [{lo * 52:+.1%}, {hi * 52:+.1%}], held {K1.notna().mean().mean():.0%} "
                   f"of coin-days, invested {(K1.notna().sum(axis=1) > 0).mean():.0%} of days, worst week {wk1.min():+.2%}")
        yr = pd.DataFrame({"K0": k0, "K1": k1})
        out.append("  per year: " + ", ".join(f"{y} K0 {g.K0.sum():+.1%} K1 {g.K1.sum():+.1%}" for y, g in yr.groupby(yr.index.year)))
        ok1 = lo > 0 and k1.mean() > k0.mean()
        # K2
        rows, prev = [], set()
        for mon in [d for d in H.index if d.weekday() == 0]:
            f7 = pd.Series({c: data[c].f7.get(mon, np.nan) for c in cs}).dropna()
            nxt = H[(H.index >= mon) & (H.index < mon + pd.Timedelta(days=7))]
            if len(f7) < 5 or len(nxt) < 7:
                continue
            q = max(1, int(len(f7) * 0.2))
            top = set(f7.nlargest(q).index)
            cost = OPEN_CLOSE * (len(top - prev) / q if prev else 1.0)
            rows.append(dict(week=mon, k2=nxt[list(top)].sum().mean() - cost, universe=nxt.sum().mean()))
            prev = top
        W = pd.DataFrame(rows)
        a, b = week_boot(W.k2 - W.universe)
        out.append(f"  K2 top fifth by funding: {W.k2.mean() * 52:+.1%} a year vs universe {W.universe.mean() * 52:+.1%}; "
                   f"difference {(W.k2 - W.universe).mean() * 52:+.1%} [{a * 52:+.1%}, {b * 52:+.1%}]")
        ok2 = a > 0
        # P1
        ev = []
        for c in cs:
            d = data[c]
            r7 = d.perp.shift(-6) / d.perp.shift(1) - 1  # close of day t-1 to close of day t+6
            pr = d.f7.rolling(365, min_periods=180).apply(lambda x: (x[:-1] < x[-1]).mean(), raw=True)
            last = {1: pd.Timestamp("1970-01-01"), -1: pd.Timestamp("1970-01-01")}
            for t in d.index[(d.index >= t0) & (d.index < t1)]:
                p = pr.get(t, np.nan)
                k = 1 if p >= 0.9 else -1 if p <= 0.1 else 0
                if k and t - last[k] >= pd.Timedelta(days=7) and not np.isnan(r7.get(t, np.nan)):
                    ev.append(dict(coin=c, time=t, decile="top" if k == 1 else "bottom", r7=r7[t]))
                    last[k] = t
        E = pd.DataFrame(ev)
        rng = np.random.default_rng(5)
        groups = {c: g for c, g in E.groupby("coin")}
        diffs = []
        for _ in range(2000):
            z = pd.concat([groups[c].sample(frac=1, replace=True, random_state=int(rng.integers(1e9)))
                           for c in rng.choice(list(groups), len(groups))])
            diffs.append(z[z.decile == "top"].r7.mean() - z[z.decile == "bottom"].r7.mean())
        a, b = np.nanpercentile(diffs, [2.5, 97.5])
        tm, bm = E[E.decile == "top"].r7.mean(), E[E.decile == "bottom"].r7.mean()
        out.append(f"  P1 next 7 days after funding in the top decile {tm:+.2%} (n {(E.decile == 'top').sum()}), bottom decile {bm:+.2%} "
                   f"(n {(E.decile == 'bottom').sum()}); top minus bottom {tm - bm:+.2%} [{a:+.2%}, {b:+.2%}]")
        verdict.setdefault("K1", []).append(ok1)
        verdict.setdefault("K2", []).append(ok2)
        verdict.setdefault("P1 crowding", []).append(b < 0)
        out.append("")
    out.append("decision: " + "; ".join(f"{k} {'HOLDS' if all(v) else 'fails'}" for k, v in verdict.items()))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
