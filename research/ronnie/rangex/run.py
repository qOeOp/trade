"""TrialFamily rangex-v1: daily box fades and breaks across commodities, FX, indices and crypto, by asset character.
See INTENT.md. Writes rangex/events.csv.gz and rangex/result.txt.
"""
import gzip, importlib.util, os, sys, time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
from tv_prices import fetch  # noqa: E402

_spec = importlib.util.spec_from_file_location("range6_run", os.path.join(ROOT, "range6", "run.py"))
R6 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R6)
R2, R3 = R6.R2, R6.R4.R3

ASSETS = {"TVC:UKOIL": "commodity", "TVC:GOLD": "commodity", "TVC:SILVER": "commodity", "NYMEX:NG1!": "commodity",
          "COMEX:HG1!": "commodity", "FX:EURUSD": "fx", "FX:USDJPY": "fx", "FX:GBPUSD": "fx", "FX:AUDUSD": "fx",
          "FX:USDCAD": "fx", "FX:USDCHF": "fx", "TVC:NDQ": "index", "TVC:DXY": "index", "BITSTAMP:BTCUSD": "crypto",
          "BITSTAMP:ETHUSD": "crypto"}
FORM_END = pd.Timestamp("2019-01-01", tz="UTC")
TEST = (pd.Timestamp("2019-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))


def daily(symbol):
    for k in range(4):
        try:
            bars, _ = fetch(symbol, "1D", 5000)
            if bars:
                break
        except Exception:
            time.sleep(3)
    d = pd.DataFrame([(t, *v) for t, v in bars], columns=["time", "open", "high", "low", "close"])
    d.index = pd.to_datetime(d.time, unit="s", utc=True)
    d = d[d.index < TEST[1]][["open", "high", "low", "close"]]
    return d[(d.low > 0) & (d.high >= d.low)]


def boot_assets(z, level=95, seed=5):
    rng = np.random.default_rng(seed)
    groups = [g.values for _, g in z.edge.groupby(z.asset)]
    b = [np.concatenate([groups[k][rng.integers(0, len(groups[k]), len(groups[k]))] for k in rng.integers(0, len(groups), len(groups))]).mean()
         for _ in range(4000)]
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    rng = np.random.default_rng(113)
    rows, char = [], {}
    for sym, cls in ASSETS.items():
        d = daily(sym)
        top, bot, a = R2.boxes(d)
        tests = R6.edge_tests(d, top, bot, a)
        form = tests[np.array([d.index[int(i)] < FORM_END for i in tests[:, 0]], bool)] if len(tests) else tests
        char[sym] = (form[:, 2].mean() if len(form) else np.nan, len(form))
        R2.FEE = 0.0006 if cls == "crypto" else 0.0003
        for trade, sigs in (("FADE", R2.signals(d, top, bot, a)["C"]), ("BREAK", R3.x1(d, top, bot, a))):
            rows += [dict(r, asset=sym, cls=cls, trade=trade) for r in R2.score(sym, "1d", trade, d, sigs, a, rng)
                     if TEST[0] <= r["time"] < TEST[1]]
        print(f"{sym}: HOLD {char[sym][0]:.2f} over {char[sym][1]} formation tests; "
              f"{sum(r['asset'] == sym for r in rows)} test-period trades", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    ev["edge"] = ev.R - ev.control
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    hold = pd.Series({k: v[0] for k, v in char.items()})
    med = hold.median()
    ev["type"] = np.where(ev.asset.map(hold) > med, "range type", "trend type")
    out = ["rangex-v1: daily box fades and breaks across asset classes; formation 2007-2018 sets each asset's HOLD,",
           "test 2019-2026; edge = R minus matched random control (costs 0.03%/side, crypto 0.06%)", "",
           "asset              class      HOLD (formation)  FADE n / edge     BREAK n / edge"]
    for sym in hold.sort_values(ascending=False).index:
        f, b = ev[(ev.asset == sym) & (ev.trade == "FADE")], ev[(ev.asset == sym) & (ev.trade == "BREAK")]
        out.append(f"{sym:<18} {ASSETS[sym]:<10} {hold[sym]:.2f} ({char[sym][1]:3d})        {len(f):3d} / {f.edge.mean():+.3f}     "
                   f"{len(b):3d} / {b.edge.mean():+.3f}")
    fe = ev[ev.trade == "FADE"].groupby("asset").edge.mean()
    rho = pd.concat([hold, fe], axis=1).dropna().corr(method="spearman").iloc[0, 1]
    out.append(f"\nT1 (reported): Spearman across assets, formation HOLD vs test FADE edge = {rho:+.2f} ({fe.notna().sum()} assets)")
    res = {}
    for trade in ("FADE", "BREAK"):
        for t in ("range type", "trend type"):
            z = ev[(ev.trade == trade) & (ev.type == t)]
            lo, hi = boot_assets(z)
            res[(trade, t)] = (lo, z.edge.mean())
            out.append(f"T2 {trade:<5} {t:<10} n {len(z):4d}  avg R {z.R.mean():+.3f}  edge {z.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
    ok = res[("FADE", "range type")][0] > 0 and res[("FADE", "range type")][1] > res[("FADE", "trend type")][1]
    out.append(f"T2 decision: FADE on range-type assets {'HOLDS' if ok else 'fails'}")
    for cls in ("commodity", "fx", "index", "crypto"):
        z = ev[ev.cls == cls]
        out.append(f"by class {cls:<9}: FADE edge {z[z.trade == 'FADE'].edge.mean():+.3f} (n {int((z.trade == 'FADE').sum())}), "
                   f"BREAK edge {z[z.trade == 'BREAK'].edge.mean():+.3f} (n {int((z.trade == 'BREAK').sum())})")
    o, g = "TVC:UKOIL", "TVC:GOLD"
    out.append(f"\noil vs gold: HOLD {hold[o]:.2f} vs {hold[g]:.2f}; FADE edge {fe.get(o, np.nan):+.3f} vs {fe.get(g, np.nan):+.3f}; "
               f"BREAK edge {ev[(ev.asset == o) & (ev.trade == 'BREAK')].edge.mean():+.3f} vs "
               f"{ev[(ev.asset == g) & (ev.trade == 'BREAK')].edge.mean():+.3f}")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
