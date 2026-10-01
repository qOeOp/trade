"""TrialFamily rangex-v2: 1h box fades and breaks on FX, gold, silver, Brent and crypto, by asset character, plus the
range-v6 development cells tested out of crypto. See INTENT.md. Writes rangex2/events.csv.gz and rangex2/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
import tv_fx_mtf  # noqa: E402
import tv_hourly  # noqa: E402

_spec = importlib.util.spec_from_file_location("range6_run", os.path.join(ROOT, "range6", "run.py"))
R6 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R6)
R2, R3, MT = R6.R2, R6.R4.R3, R6.MT

FX = ("EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF")
DUKA = {"XAUUSD": "gold", "XAGUSD": "silver", "BRENTCMDUSD": "brent"}
CRYPTO = ("BTC", "ETH")
COST = {"fx": 0.00005, "metal/oil": 0.0002, "crypto": 0.0006}
FORM = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2022-01-01", tz="UTC"))
TEST = (pd.Timestamp("2022-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
SQUEEZE_CUT = 0.978
AGG = {"open": "first", "high": "max", "low": "min", "close": "last"}


def load(name, cls):
    if cls == "fx":
        h = tv_fx_mtf.hourly(name)
    elif cls == "metal/oil":
        t0, t1 = int(FORM[0].value // 10**9), int(TEST[1].value // 10**9)
        h = tv_hourly.dukascopy(name, t0, t1).drop_duplicates("time").sort_values("time")
        h.index = pd.to_datetime(h.time, unit="s", utc=True)
    else:
        from evaluate import holdout_bars
        h = holdout_bars(name)["1h"]
    h = h[["open", "high", "low", "close"]].astype(float)
    return h[(h.index >= FORM[0]) & (h.index < TEST[1]) & (h.low > 0)]


def asset(name, cls, rng):
    d = load(name, cls)
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    top, bot, a = R2.boxes(d)
    tests = R6.edge_tests(d, top, bot, a)
    in_form = np.array([FORM[0] <= d.index[int(i)] < FORM[1] for i in tests[:, 0]], bool) if len(tests) else np.zeros(0, bool)
    hold = tests[in_form, 2].mean() if in_form.any() else np.nan
    a100 = MT.atr_of(h, l, c, 100)
    d1 = d.resample("1D", label="left", closed="left").agg(AGG).dropna()
    trend = np.sign(d1.close - d1.close.rolling(50).mean())
    trend.index = trend.index + pd.Timedelta(days=1)
    dtrend = trend.reindex(d.index + pd.Timedelta(hours=1), method="ffill").fillna(0).values
    R2.FEE = COST[cls]
    fades = R2.signals(d, top, bot, a)["C"]
    feat = {(d.index[e], side): (a[e - 2] / a100[e - 2], side * dtrend[e - 1]) for e, side, *_ in fades}
    rows = []
    for trade, sigs in (("FADE", fades), ("BREAK", R3.x1(d, top, bot, a))):
        for r in R2.score(name, "1h", trade, d, sigs, a, rng):
            if TEST[0] <= r["time"] < TEST[1]:
                sq, tr = feat.get((r["time"], r["side"]), (np.nan, np.nan))
                rows.append(dict(r, asset=name, cls=cls, trade=trade, squeeze=sq, htf=tr))
    return rows, hold, int(in_form.sum())


def boot(z, level=95, seed=7):
    rng = np.random.default_rng(seed)
    groups = [g.values for _, g in z.edge.groupby(z.asset)]
    if len(groups) < 2:
        return np.nan, np.nan
    b = [np.concatenate([groups[k][rng.integers(0, len(groups[k]), len(groups[k]))] for k in rng.integers(0, len(groups), len(groups))]).mean()
         for _ in range(4000)]
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    rng = np.random.default_rng(127)
    rows, char = [], {}
    for name, cls in [(p, "fx") for p in FX] + [(k, "metal/oil") for k in DUKA] + [(k, "crypto") for k in CRYPTO]:
        r, hold, n = asset(name, cls, rng)
        rows += r
        char[name] = (hold, n, cls)
        print(f"{name}: HOLD {hold:.2f} over {n} formation tests; {len(r)} test trades", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    ev["edge"] = ev.R - ev.control
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    hold = pd.Series({k: v[0] for k, v in char.items()})
    ev["type"] = np.where(ev.asset.map(hold) > hold.median(), "range type", "trend type")
    out = ["rangex-v2: 1h box fades and breaks; formation 2018-2021 sets HOLD, test 2022-2026; edge = R minus matched control",
           "costs per side: FX 0.005%, metals/oil 0.02%, crypto 0.06%", "",
           "asset          class       HOLD (formation tests)   FADE n / avg R / edge        BREAK n / avg R / edge"]
    for k in hold.sort_values(ascending=False).index:
        f, b = ev[(ev.asset == k) & (ev.trade == "FADE")], ev[(ev.asset == k) & (ev.trade == "BREAK")]
        out.append(f"{k:<14} {char[k][2]:<11} {hold[k]:.2f} ({char[k][1]:4d})            "
                   f"{len(f):4d} / {f.R.mean():+.3f} / {f.edge.mean():+.3f}    {len(b):4d} / {b.R.mean():+.3f} / {b.edge.mean():+.3f}")
    fe = ev[ev.trade == "FADE"].groupby("asset").edge.mean()
    rho = pd.concat([hold, fe], axis=1).dropna().corr(method="spearman").iloc[0, 1]
    out.append(f"\nT1 (reported): Spearman, formation HOLD vs test FADE edge across {fe.notna().sum()} assets = {rho:+.2f}")
    res = {}
    for trade in ("FADE", "BREAK"):
        for t in ("range type", "trend type"):
            z = ev[(ev.trade == trade) & (ev.type == t)]
            lo, hi = boot(z)
            res[(trade, t)] = (lo, z.edge.mean())
            out.append(f"T2 {trade:<5} {t:<10} n {len(z):5d}  avg R {z.R.mean():+.3f}  edge {z.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
    ok2 = res[("FADE", "range type")][0] > 0 and res[("FADE", "range type")][1] > res[("FADE", "trend type")][1]
    out.append(f"T2 decision: FADE on range-type assets {'HOLDS' if ok2 else 'fails'}")
    fz = ev[ev.trade == "FADE"].dropna(subset=["squeeze", "htf"])
    for label, m in (("no squeeze (ATR14/ATR100 >= 0.978)", fz.squeeze >= SQUEEZE_CUT), ("against the daily trend", fz.htf <= 0)):
        a_, b_ = fz[m], fz[~m]
        lo, hi = boot(a_)
        lo2, hi2 = boot(b_)
        ok = lo > 0 and a_.edge.mean() > b_.edge.mean()
        out.append(f"T3 {label:<36} n {len(a_):5d} edge {a_.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]  vs rest n {len(b_):5d} "
                   f"edge {b_.edge.mean():+.3f} [{lo2:+.3f}, {hi2:+.3f}] -> {'HOLDS' if ok else 'fails'}")
    for cls in ("fx", "metal/oil", "crypto"):
        z = ev[ev.cls == cls]
        f, b = z[z.trade == "FADE"], z[z.trade == "BREAK"]
        lf, hf = boot(f)
        lb, hb = boot(b)
        out.append(f"class {cls:<9}: FADE n {len(f):4d} edge {f.edge.mean():+.3f} [{lf:+.3f}, {hf:+.3f}]   "
                   f"BREAK n {len(b):4d} edge {b.edge.mean():+.3f} [{lb:+.3f}, {hb:+.3f}]")
    for k in ("BRENTCMDUSD", "XAUUSD"):
        z = ev[ev.asset == k]
        out.append(f"  {DUKA[k]:<6}: FADE edge {z[z.trade == 'FADE'].edge.mean():+.3f} (n {int((z.trade == 'FADE').sum())}), "
                   f"BREAK edge {z[z.trade == 'BREAK'].edge.mean():+.3f} (n {int((z.trade == 'BREAK').sum())}), HOLD {hold[k]:.2f}")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
