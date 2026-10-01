"""Shared engine of the autonomous R&D loop (see loop/PROTOCOL.md).

- data: daily and 4h bars of the iteration set (17 majors, 2018-2022), the validation set (20 large caps, 2023-2026)
  and the final holdout (coins never used in this research), cached in loop/.cache;
- score: signals (entry index, side, entry, stop, target) scored by the range-v2 scorer against 20 random entries
  matched on year, side, stop in ATR, target in R and time limit;
- gate: the iteration gate (both halves of the iteration set positive and the pooled interval above zero) and the
  validation gate (interval above zero at a level deflated by the number of candidates validated so far);
- census: every scored trial is appended to loop/census.csv.
"""
import csv, importlib.util, os, pickle, sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("range4_run", os.path.join(ROOT, "range4", "run.py"))
R4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R4)
R2, MT = R4.R2, R4.R2.MT

ITER_COINS, VAL_COINS = R4.MAJORS, R4.LARGE
FINAL_COINS = ("TON", "RENDER", "JUP", "ENA", "BONK", "WIF", "FLOKI", "PYTH", "ORDI", "CFX", "TAO", "STRK")
ITER = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
ITER_SPLIT = pd.Timestamp("2021-01-01", tz="UTC")
VAL = (pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
CACHE = os.path.join(HERE, ".cache")
CENSUS = os.path.join(HERE, "census.csv")


def bars(coin):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{coin}.pkl")
    if os.path.exists(path):
        return pickle.load(open(path, "rb"))
    from evaluate import holdout_bars
    b = holdout_bars(coin)
    out = {k: b[k][["open", "high", "low", "close", "volume"]].astype(float) for k in ("4h", "1d")}
    pickle.dump(out, open(path, "wb"))
    return out


def score(coin, tf, name, d, sigs, hold, fee=0.0006, seed=0):
    """-> list of dict rows (coin, time, side, R, control, stop_atr, target_R)."""
    a = MT.atr_of(d.high.values, d.low.values, d.close.values)
    R2.HOLD, R2.FEE = hold, fee
    return R2.score(coin, tf, name, d[["open", "high", "low", "close"]], sigs, a, np.random.default_rng(seed))


def run(name, signal_fn, tf, hold, sets=("iter",)):
    """Score signal_fn(d1, d4) -> list of (e, side, entry, stop, tgt) on the chosen sets. -> DataFrame."""
    rows = []
    spec = {"iter": (ITER_COINS, ITER), "val": (VAL_COINS, VAL), "final": (FINAL_COINS, VAL)}
    for s in sets:
        coins, (t0, t1) = spec[s]
        for k, coin in enumerate(coins):
            b = bars(coin)
            d = b[tf]
            sigs = signal_fn(b["1d"], b["4h"])
            rows += [dict(r, set=s) for r in score(coin, tf, name, d, sigs, hold, seed=k) if t0 <= r["time"] < t1]
    return pd.DataFrame(rows)


def boot(z, level=95):
    if len(z) < 5 or z.coin.nunique() < 2:
        return np.nan, np.nan
    return R2.coin_boot(z, level=level)


def iteration_gate(z):
    """Both halves of the iteration set above zero (edge = R - control) and the pooled 95% interval above zero."""
    z = z[z.set == "iter"]
    a, b = z[z.time < ITER_SPLIT], z[z.time >= ITER_SPLIT]
    lo, hi = boot(z)
    ea, eb = (a.R - a.control).mean(), (b.R - b.control).mean()
    passed = bool(lo > 0 and ea > 0 and eb > 0)
    return passed, dict(n=len(z), edge=(z.R - z.control).mean(), lo=lo, hi=hi, edge_2018_20=ea, edge_2021_22=eb,
                        n_a=len(a), n_b=len(b), avgR=z.R.mean())


def validation_level():
    """Bonferroni over the candidates already sent to validation, including this one."""
    k = 1
    if os.path.exists(CENSUS):
        k += sum(r["stage"] == "validation" for r in csv.DictReader(open(CENSUS)))
    return 100 - 5 / k, k


def log(loop, name, stage, stats, passed, note=""):
    new = not os.path.exists(CENSUS)
    with open(CENSUS, "a", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        if new:
            w.writerow(["logged_at", "loop", "candidate", "stage", "n", "edge", "lo", "hi", "passed", "note"])
        w.writerow([datetime.now(timezone.utc).isoformat(timespec="seconds"), loop, name, stage, stats.get("n"),
                    f"{stats.get('edge', np.nan):+.4f}", f"{stats.get('lo', np.nan):+.4f}", f"{stats.get('hi', np.nan):+.4f}",
                    passed, note])


def fmt(stats):
    return (f"n {stats['n']}, avg R {stats['avgR']:+.3f}, edge {stats['edge']:+.3f} [{stats['lo']:+.3f}, {stats['hi']:+.3f}], "
            f"2018-20 {stats['edge_2018_20']:+.3f} (n {stats['n_a']}), 2021-22 {stats['edge_2021_22']:+.3f} (n {stats['n_b']})")
