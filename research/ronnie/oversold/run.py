"""TrialFamily oversold-v1: crash (O1), RSI(2) (O2), capitulation (O3) and dip-in-uptrend (O4) on daily bars of large
caps. See INTENT.md. Writes oversold/events.csv.gz and oversold/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("range4_run", os.path.join(ROOT, "range4", "run.py"))
R4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R4)
R2 = R4.R2
MT = R2.MT

CRASH, LOOK, RSI_MAX, DROP3, VOLX, PAD, SPACING, HOLD, MAX_STOP = 0.75, 10, 5.0, -0.15, 2.5, 0.5, 5, 10, 6.0
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
HOLDOUT = (pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
VARIANTS = ("O1", "O2", "O3", "O4")


def rsi(c, n):
    d = np.diff(c, prepend=c[0])
    up = pd.Series(np.maximum(d, 0)).ewm(alpha=1 / n, adjust=False).mean().values
    dn = pd.Series(np.maximum(-d, 0)).ewm(alpha=1 / n, adjust=False).mean().values
    return 100 - 100 / (1 + up / np.maximum(dn, 1e-12))


def signals(d):
    o, h, l, c, v = (d[x].values.astype(float) for x in ("open", "high", "low", "close", "volume"))
    a = MT.atr_of(h, l, c, 20)
    r2 = rsi(c, 2)
    sma200 = pd.Series(c).rolling(200).mean().values
    vm = pd.Series(v).shift(1).rolling(20).mean().values
    hh = pd.Series(h).shift(1).rolling(LOOK).max().values
    out = {k: [] for k in VARIANTS}
    last = {k: -99 for k in VARIANTS}
    for i in range(210, len(c) - 1):
        rg = h[i] - l[i]
        cond = {
            "O1": c[i] <= CRASH * hh[i],
            "O2": r2[i] < RSI_MAX,
            "O3": c[i] / c[i - 3] - 1 <= DROP3 and vm[i] > 0 and v[i] >= VOLX * vm[i] and rg > 0 and (c[i] - l[i]) / rg >= 0.5,
            "O4": r2[i] < RSI_MAX and c[i] > sma200[i],
        }
        stop = l[i] - PAD * a[i]
        entry = o[i + 1]
        tgt = c[i] + 0.5 * (hh[i] - c[i])
        risk = entry - stop
        if risk <= 0 or risk > MAX_STOP * a[i] or tgt - entry < risk:
            continue
        for k, ok in cond.items():
            if ok and i - last[k] >= SPACING:
                out[k].append((i + 1, 1, entry, stop, tgt))
                last[k] = i
    return out, a


def main():
    from evaluate import holdout_bars
    rng = np.random.default_rng(67)
    rows, fwd = [], []
    for name_set, coins, (t0, t1) in (("dev", R4.MAJORS, DEV), ("holdout", R4.MAJORS + R4.LARGE, HOLDOUT)):
        for coin in coins:
            d = holdout_bars(coin)["1d"][["open", "high", "low", "close", "volume"]]
            sig, a = signals(d)
            c = d.close.values
            for k in VARIANTS:
                R2.HOLD = HOLD
                rows += [dict(r, set=name_set) for r in R2.score(coin, "1d", k, d[["open", "high", "low", "close"]], sig[k], a, rng)
                         if t0 <= r["time"] < t1]
                for e, *_ in sig[k]:
                    i = e - 1
                    if t0 <= d.index[e] < t1 and i + 10 < len(c):
                        fwd.append(dict(set=name_set, variant=k, coin=coin,
                                        **{f"r{h}": c[i + h] / c[i] - 1 for h in (1, 3, 5, 10)}))
            span = (d.index >= t0) & (d.index < t1)
            base = pd.DataFrame({f"r{h}": pd.Series(c).shift(-h).values / c - 1 for h in (1, 3, 5, 10)})[span]
            fwd.append(dict(set=name_set, variant="all days", coin=coin, **base.mean().to_dict()))
            print(f"{coin} {name_set}: {sum(r['coin'] == coin and r['set'] == name_set for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    F = pd.DataFrame(fwd)
    out = ["oversold-v1: daily oversold entries on large caps, long only; avg R net of 0.06%/side; control = 20 random entries",
           "variant set       n     win   avgR    control  minus control [95% coin-then-signal]  median target R"]
    verdict = []
    for v in VARIANTS:
        lows = []
        for s in ("dev", "holdout"):
            z = ev[(ev.variant == v) & (ev.set == s)]
            if len(z) < 5 or z.coin.nunique() < 2:
                out.append(f"{v:<7} {s:<8} {len(z):5d}  too few")
                lows.append(-1)
                continue
            lo, hi = R2.coin_boot(z)
            lows.append(lo)
            out.append(f"{v:<7} {s:<8} {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                       f"{(z.R - z.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]  {z.target_R.median():.2f}")
        verdict.append(f"{v} {'HOLDS' if min(lows) > 0 else 'fails'}")
    out.append("decision: " + "; ".join(verdict))
    out.append("")
    out.append("raw forward close-to-close return after the signal close (mean over signals; 'all days' = per-coin mean of every day)")
    for s in ("dev", "holdout"):
        for v in VARIANTS + ("all days",):
            z = F[(F.set == s) & (F.variant == v)]
            if len(z):
                out.append(f"  {s:<8} {v:<9} n {len(z):5d}  " + "  ".join(f"{h}d {z[f'r{h}'].mean():+.2%}" for h in (1, 3, 5, 10)))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
