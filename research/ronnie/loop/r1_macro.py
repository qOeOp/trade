"""Loop M-1 (loop/LOG.md): pause R-1 entries when public market stress gauges agree. Gauges from FRED public CSVs,
thresholds fixed in advance; trades are the realistic R-1 trades rebuilt from the S-1 (development) and S-3
(validation) orders. Usage: python loop/r1_macro.py"""
import io, os, sys, urllib.request

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402

SERIES = ("BAA10Y", "VIXCLS", "DTWEXBGS", "DFII10")
LAG = 2  # days between a gauge's date and the fill day that may use it


def fred(sid):
    path = os.path.join(E.CACHE, f"fred_{sid}.csv")
    if not os.path.exists(path):
        os.makedirs(E.CACHE, exist_ok=True)
        b = urllib.request.urlopen(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd=2015-01-01", timeout=60).read()
        open(path, "wb").write(b)
    d = pd.read_csv(path)
    d.columns = ["date", "v"]
    d["v"] = pd.to_numeric(d.v, errors="coerce")
    return d.dropna().set_index(pd.to_datetime(d.dropna().date))["v"]


def gauges():
    baa, vix, usd, real = (fred(s) for s in SERIES)
    g = pd.DataFrame({
        "credit": (baa - baa.rolling(252).mean()) / baa.rolling(252).std() > 1,
        "vix": vix > 25,
        "dollar": usd.pct_change(60) > 0.03,
        "real": real.diff(60) > 0.50,
    })
    g = g.ffill().astype(float)
    g["stress"] = (g[["credit", "vix", "dollar", "real"]].sum(axis=1) >= 2).astype(float)
    days = pd.date_range(g.index.min(), "2026-12-31", freq="D")
    return g.reindex(days).ffill().shift(LAG)  # value usable on a fill day


def trades(path):
    z = pd.read_csv(path, parse_dates=["arm", "fill", "exit"])
    z = z[z.f == 0.0].sort_values(["coin", "fill", "arm"])
    keep = []
    for _, g in z.groupby("coin"):
        busy = pd.Timestamp("1970", tz="UTC")
        for r in g.itertuples():
            if r.fill > busy:
                keep.append(r.Index)
                busy = r.exit
    return z.loc[keep].reset_index(drop=True)


def diff_ci(t, mask_out, sub, reps=2000, seed=51):
    t = t[sub].reset_index(drop=True)
    m = mask_out[sub.values] if isinstance(mask_out, np.ndarray) else mask_out[sub].values
    wk = t.fill.dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    ix = {w: np.flatnonzero(wk == w) for w in weeks}
    R = t.R.values
    rng = np.random.default_rng(seed)
    bs = []
    for _ in range(reps):
        sel = np.concatenate([ix[w] for w in rng.choice(weeks, len(weeks))])
        a, b = R[sel][m[sel]], R[sel][~m[sel]]
        if len(a) and len(b):
            bs.append(a.mean() - b.mean())
    bs = np.array(bs)
    return R[m].mean() - R[~m].mean(), np.percentile(bs, [2.5, 97.5]), float(min(np.mean(bs <= 0), np.mean(bs >= 0)) * 2), int((~m).sum())


def book(t, keep, t0, t1):
    idx = pd.date_range(t0, t1, freq="W-MON", inclusive="left", tz="UTC")
    w = t[keep].set_index("exit").R.resample("W-MON").sum().reindex(idx).fillna(0)
    eq = w.cumsum()
    return w.sum(), w.mean() / w.std() * np.sqrt(52), (eq - eq.cummax()).min()


def main():
    G = gauges()
    out = ["M-1: macro risk switch for R-1 (stress = at least two of credit, vix, dollar, real); realistic R-1 trades, f = 0"]
    tests = {}
    for name, path, (t0, t1) in (("development", "S-1_orders.csv.gz", E.ITER), ("validation", "S-3_val_orders.csv.gz", E.VAL)):
        t = trades(os.path.join(HERE, "out", path))
        t = t[(t.fill >= t0) & (t.fill < t1)].reset_index(drop=True)
        day = t.fill.dt.tz_convert(None).dt.normalize()
        for c in ("credit", "vix", "dollar", "real", "stress"):
            t[c] = G[c].reindex(day).fillna(0).values.astype(bool)
        gd = G.loc[str(t0.date()):str((t1 - pd.Timedelta(days=1)).date())]
        out.append(f"\n== {name}: {len(t)} trades, avg R {t.R.mean():+.3f}; stress on {gd.stress.mean():.0%} of days, {t.stress.mean():.0%} of trades")
        for c in ("credit", "vix", "dollar", "real", "stress"):
            s_ = t[c]
            out.append(f"  {c:7s}: on {gd[c].mean():.0%} of days; trades in it {s_.sum()} avg R {t.R[s_].mean():+.3f} (longs {t.R[s_ & (t.side == 1)].mean():+.3f},"
                       f" shorts {t.R[s_ & (t.side == -1)].mean():+.3f}); outside {t.R[~s_].mean():+.3f} (longs {t.R[~s_ & (t.side == 1)].mean():+.3f}, shorts {t.R[~s_ & (t.side == -1)].mean():+.3f})")
        outside = ~t.stress.values
        for rule, sub in (("A pause all", np.ones(len(t), bool)), ("B pause longs", (t.side == 1).values)):
            d_, (lo, hi), p, n_in = diff_ci(t, outside, pd.Series(sub))
            tests[(name, rule)] = (p, d_)
            keep = ~(t.stress.values & sub)
            base, sw = book(t, np.ones(len(t), bool), t0, t1), book(t, keep, t0, t1)
            rng = np.random.default_rng(53)
            share = 1 - keep.mean()
            rnd = np.array([book(t, ~((rng.random(len(t)) < share / max(sub.mean(), 1e-9)) & sub), t0, t1) for _ in range(200)])
            out.append(f"  {rule}: outside minus inside stress {d_:+.3f} [{lo:+.3f}, {hi:+.3f}], p {p:.3f} ({n_in} trades paused)")
            out.append(f"    book: no switch total R {base[0]:.0f} / Sharpe {base[1]:.2f} / max DD {base[2]:.0f}R; switch {sw[0]:.0f} / {sw[1]:.2f} / {sw[2]:.0f}R;"
                       f" random pauses total R {rnd[:, 0].mean():.0f}, Sharpe {rnd[:, 1].mean():.2f} [{np.percentile(rnd[:, 1], 5):.2f}, {np.percentile(rnd[:, 1], 95):.2f}],"
                       f" max DD {rnd[:, 2].mean():.0f}R")
    out.append("\nHolm on the validation tier (95%, two tests): " + ", ".join(
        f"{r} p {tests[('validation', r)][0]:.3f} vs {0.05 / (2 - n):.4f}, diff {tests[('validation', r)][1]:+.3f} (development {tests[('development', r)][1]:+.3f}) -> "
        f"{'PASS' if tests[('validation', r)][0] <= 0.05 / (2 - n) and tests[('validation', r)][1] >= 0.10 and tests[('development', r)][1] > 0 else 'fail'}"
        for n, r in enumerate(sorted(("A pause all", "B pause longs"), key=lambda r: tests[("validation", r)][0]))))
    txt = "\n".join(out)
    print(txt)
    open(os.path.join(HERE, "r1_macro.txt"), "w").write(txt + "\n")
    E.log("M-1", "R-1 macro risk switch", "validation", dict(n=0, edge=np.nan, lo=np.nan, hi=np.nan), False, "see r1_macro.txt")


if __name__ == "__main__":
    main()
