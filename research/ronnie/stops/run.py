"""TrialFamily stops-v1: signal-bar stop vs ATR stop vs stop behind support vs stop behind the broken line. See INTENT.md.

Writes stops/events.csv.gz and stops/result.txt.
"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo"), os.path.join(ROOT, "combo", "candidates"), os.path.join(ROOT, "patterns")):
    sys.path.insert(0, p)
import harness as H  # noqa: E402
import line_break_ridge as C3  # noqa: E402
import trendline_break_strong as C2  # noqa: E402
from evaluate import holdout_bars  # noqa: E402
from portfolio import b1_signals  # noqa: E402
import run as PR  # noqa: E402  (patterns/run.py: HOLDOUT, SR, atr_of)

sys.path.insert(0, os.path.join(ROOT, "timing"))
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("timing_run", os.path.join(ROOT, "timing", "run.py"))
TR = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(TR)

SR = PR.SR
STRATS = {"B1": b1_signals, "trendline": C2.signals, "ridge": C3.signals}
ATR_MULT, PAD, MIN_STOP, MAX_STOP, RR = 1.5, 0.25, 0.3, 6.0, 2.0
STOPS = ("S0", "S1", "S2", "S3")
DEV_END = pd.Timestamp("2023-01-01", tz="UTC")


def market_rows(name, bars, t0=None, t1=None):
    d4 = bars["4h"]
    o, h, l, c = (d4[x].values.astype(float) for x in ("open", "high", "low", "close"))
    atr = PR.atr_of(h, l, c)
    lines = TR.lines_by_bar(h, l, c)
    hh = pd.Series(h).shift(1).rolling(20).max().values
    ll = pd.Series(l).shift(1).rolling(20).min().values
    close_t = d4.index + pd.Timedelta(hours=4)
    rows = []
    for strat, fn in STRATS.items():
        for s in fn(bars):
            i = int(close_t.searchsorted(pd.Timestamp(s.time)))
            e = i + 1
            if i < 300 or e + SR.HOLD >= len(c) or (t0 is not None and not t0 <= d4.index[e] < t1):
                continue
            side, entry, a = s.side, o[e], atr[i]
            # S2: nearest intact confirmed order-3 swing level on the stop side, known at the signal close
            supp = [y for lid, sd, y in lines[e] if lid[0] == "L" and lid[1] == 3 and sd == -side and (entry - y) * side > 0]
            s2 = (max(supp) if side == 1 else min(supp)) - side * PAD * a if supp else np.nan
            # S3: the line the signal bar closed through, nearest to its close; B1 (and any bar with no such line) uses
            # the prior 20-bar extreme it broke
            crossed = [y for lid, sd, y in lines[i] if sd == side and (c[i - 1] - y) * side <= 0 < (c[i] - y) * side]
            ext = hh[i] if side == 1 else ll[i]
            if strat != "B1" and crossed:
                brk = max(crossed) if side == 1 else min(crossed)
            else:
                brk = ext
            s3 = brk - side * PAD * a
            stops = {"S0": s.stop, "S1": entry - side * ATR_MULT * a, "S2": s2, "S3": s3}
            dist = {k: (entry - v) * side / a for k, v in stops.items()}
            if any(not (MIN_STOP <= d <= MAX_STOP) for d in dist.values()):
                continue  # unusable for some stop: dropped from all, so every stop scores the same entries
            row = dict(market=name, strat=strat, time=d4.index[e], side=side)
            for k, st in stops.items():
                tp = entry + side * RR * (entry - st) * side
                row[k] = SR.trade(o, h, l, c, e, side, st, tp, SR.COST["crypto"])
                row[f"{k}_atr"] = dist[k]
            rows.append(row)
    return rows


def coin_boot(z, col, level=95, seed=9):
    rng = np.random.default_rng(seed)
    groups = [g.values for _, g in z[col].groupby(z.market)]
    b = []
    for _ in range(4000):
        pick = [groups[k] for k in rng.integers(0, len(groups), len(groups))]
        b.append(np.concatenate([g[rng.integers(0, len(g), len(g))] for g in pick]).mean())
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    rows = []
    for name in ("BTCUSD", "ETHUSDT"):
        rows += market_rows(name, H.load(name))
        print(f"{name}: {len(rows)} entries", flush=True)
    for coin in PR.HOLDOUT:
        rows += [dict(r, market=coin) for r in market_rows(coin, holdout_bars(coin), PR.HOLD_START, PR.HOLD_END)]
        print(f"{coin}: {sum(r['market'] == coin for r in rows)} entries", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=list(STOPS))
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    dev = ev[ev.market.isin(["BTCUSD", "ETHUSDT"]) & (ev.time < DEV_END)]
    hold = ev[~ev.market.isin(["BTCUSD", "ETHUSDT"])]
    out = ["stops-v1: same entries (B1, trendline, ridge), four stops, target 2R of each; avg R net of 0.06%/side", ""]
    verdict = []
    for label, z in (("development BTC+ETH 2017-2022", dev), ("holdout 20 coins 2021-2026", hold)):
        out.append(f"{label}: {len(z)} entries")
        for k in STOPS:
            line = f"  {k}  avg R {z[k].mean():+.3f}  win {np.mean(z[k] > 0):.0%}  median stop {z[f'{k}_atr'].median():.2f} ATR"
            if k != "S0":
                d = z[k] - z.S0
                if label.startswith("dev"):
                    m, lo, hi = SR.ci(d, 95)
                else:
                    m, (lo, hi) = d.mean(), coin_boot(z.assign(d=d), "d")
                line += f"  minus S0 {m:+.3f} [{lo:+.3f}, {hi:+.3f}]"
                verdict.append((k, label, lo > 0))
            out.append(line)
        for s, g in z.groupby("strat"):
            out.append(f"    {s:<10} n {len(g):5d}  " + "  ".join(f"{k} {g[k].mean():+.3f}" for k in STOPS))
        out.append("")
    wins = [k for k in STOPS[1:] if all(ok for kk, _, ok in verdict if kk == k)]
    out.append("decision (paired difference above zero on development and holdout): " +
               (", ".join(f"{k} beats S0" for k in wins) if wins else "no stop beats the signal-bar stop"))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
