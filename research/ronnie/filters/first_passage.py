"""Is the level-touch entry good but its exits bad? An exit-free answer.

Every stop/target exit's expectancy is set by first-passage probabilities: from the entry, does price reach +a ATR
before -b ATR? If those probabilities equal a random entry's for every (a, b), no stop or target can beat a random entry,
and if an entry had an edge some (a, b) would show it. So this scores the whole table and selects nothing.

Events: filters/events.csv.gz (s6 zone_only confirmed entries, 11 markets), plus BTC s6 confluence entries (zone x trend
line). Entry at the entry bar's open, ATR of the bar before, 60-bar horizon (4h bars), both barriers in one bar count as
the adverse one first; a path that reaches neither is scored at its 60-bar close. Gross of costs. Control: 20 random
bars per event, same market, year and side.
"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import run as R  # noqa: E402
import s6_confirm as S  # noqa: E402

UP = (0.5, 1.0, 1.5, 2.0, 3.0, 5.0)
DOWN = (0.5, 1.0, 1.5, 2.0, 3.0)
HOLD, CONTROLS = 60, 20
RNG = np.random.default_rng(77)


def paths(M, i0, s):
    """Favourable and adverse excursion per bar (in ATR, running max) and the signed 60-bar close, from bar i0's open."""
    e, a = M.o[i0], M.atr[i0 - 1]
    seg = slice(i0, i0 + HOLD + 1)
    fav = (M.h[seg] - e) / a if s == 1 else (e - M.l[seg]) / a
    adv = (e - M.l[seg]) / a if s == 1 else (M.h[seg] - e) / a
    return np.maximum.accumulate(fav), np.maximum.accumulate(adv), s * (M.c[i0 + HOLD] - e) / a


def outcomes(fav, adv, end):
    """-> array (len(UP), len(DOWN)) of results in ATR for every target a and stop b."""
    out = np.empty((len(UP), len(DOWN)))
    for u, a in enumerate(UP):
        ka = np.flatnonzero(fav >= a)
        for d, b in enumerate(DOWN):
            kb = np.flatnonzero(adv >= b)
            ta = ka[0] if ka.size else np.inf
            tb = kb[0] if kb.size else np.inf
            out[u, d] = -b if tb <= ta and np.isfinite(tb) else (a if np.isfinite(ta) else float(np.clip(end, -b, a)))
    return out


def table(M_of, events):
    real, ctrl, seg = [], [], []
    for r in events.itertuples():
        M = M_of[r.market]
        t = pd.DatetimeIndex(M.F["t"])
        i0 = int(t.get_loc(r.entry_time))
        if i0 + HOLD >= M.n:
            continue
        real.append(outcomes(*paths(M, i0, r.side)))
        bars = np.flatnonzero((t.year == r.entry_time.year) & (np.arange(M.n) > 600) & (np.arange(M.n) < M.n - HOLD - 2))
        ctrl.append(np.mean([outcomes(*paths(M, int(i), r.side)) for i in RNG.choice(bars, CONTROLS)], axis=0))
        seg.append(r.seg)
    return np.array(real), np.array(ctrl), np.array(seg)


def report(name, real, ctrl, seg):
    diff = real - ctrl
    n = len(diff)
    boot = np.array([diff[RNG.integers(0, n, n)].mean(0) for _ in range(1000)])
    lo, hi = np.percentile(boot, 2.5, axis=0), np.percentile(boot, 97.5, axis=0)
    out = [f"{name}: {n} entries. Mean result per entry in ATR, entry minus random control [95% bootstrap]; rows target a, columns stop b"]
    out.append("   a\\b " + "".join(f"{b:>24}" for b in DOWN))
    for u, a in enumerate(UP):
        out.append(f"  {a:>4} " + "".join(f"{diff[:, u, d].mean():+.3f} [{lo[u, d]:+.2f},{hi[u, d]:+.2f}]".rjust(24) for d in range(len(DOWN))))
    sig_pos = int(((lo > 0)).sum())
    sig_neg = int(((hi < 0)).sum())
    out.append(f"  cells whose interval is above zero: {sig_pos} of {diff.shape[1] * diff.shape[2]}; below zero: {sig_neg}")
    out.append(f"  best cell for the entry: {diff.mean(0).max():+.3f} ATR; raw entry result there {real.mean(0).flat[diff.mean(0).argmax()]:+.3f}, "
               f"random {ctrl.mean(0).flat[diff.mean(0).argmax()]:+.3f}")
    for s_ in ("train", "validation", "test"):
        m = seg == s_
        if m.any():
            d = diff[m].mean(0)
            out.append(f"  {s_:<10} n={int(m.sum()):4d}: cells above zero {int((d > 0).sum())}/30, mean over cells {d.mean():+.3f}, best {d.max():+.3f}, worst {d.min():+.3f}")
    return out


def main():
    ev = pd.read_csv(gzip.open(f"{HERE}/events.csv.gz", "rt"), parse_dates=["entry_time"])
    M_of = {}
    for name, d4, d1 in R.markets():
        M_of[name] = R.Market(name, d4, d1)
        print(f"loaded {name}", flush=True)
    lines = report("Zone touch, confirmed (s6 zone_only), 11 markets", *table(M_of, ev))
    B = M_of["BTCUSD"]
    tr = S.run_confirm(B.F, "confluence", k=3)
    tr["market"], tr["seg"] = "BTCUSD", [R.segment(x) for x in tr.entry_time]
    lines += [""] + report("Zone x trend line, confirmed (s6 confluence), BTC", *table(M_of, tr[tr.seg.notna()]))
    text = "\n".join(lines)
    print(text)
    open(f"{HERE}/first_passage.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
