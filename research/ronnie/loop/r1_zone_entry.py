"""Loop Z-1 (loop/LOG.md): R-1u limit placed at a fixed fraction f of the zone, from the edge price reaches first
(f = 0, the current rule: the broken pivot's wick) to the far edge (f = 1: the zone's bottom for longs, top for shorts,
which the user proposed). Stop fixed at the zone stop (0.25 ATR beyond the far edge), target 2R from the fill, one
slot per coin by first fill. Secondary (exploratory): the same fills with the target held at the f = 0 order's 2R price.
Scored on daily bars with matched random-entry controls, and the same trades re-walked on 1h bars (fill hour, then
stop/target in hourly order). Usage: python loop/r1_zone_entry.py"""
import itertools, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402
import family_r as FR  # noqa: E402
import r1_dynexit_fine as XF  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
FRACS = (0.0, 0.25, 0.5, 0.75, 1.0)
VARS = [(f, "2R") for f in FRACS] + [(f, "orig") for f in FRACS[1:]]


def signals(d, f, tmode, raw=False):
    S = FR.state(d)
    c, a, tr = S["c"], S["a"], S["trend"]
    cand, armed = [], 0
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low") or i + 1 >= len(c) or np.isnan(a[i]):
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] != side:
            continue
        lvl, edge = p[1], p[2]
        lower = max(edge, lvl - a[i]) if side == 1 else min(edge, lvl + a[i])
        stop = lower - side * FR.BUF * a[i]
        lim = lvl - f * (lvl - lower)
        armed += 1
        k, px = FR.fill(S, i + 1, side, lim)
        if k is None or (px - stop) * side <= 0:
            continue
        tgt = px + side * 2 * abs(px - stop) if tmode == "2R" else lvl + side * 2 * abs(lvl - stop)
        if (tgt - px) * side <= 0:
            continue
        cand.append((k, i, side, px, stop, tgt, lim, (lvl - lower) * side / a[i]))
    if raw:
        return sorted(cand, key=lambda x: (x[0], x[1])), armed
    busy, out = -1, []
    for x in sorted(cand, key=lambda x: (x[0], x[1])):
        if x[0] <= busy:
            continue
        out.append(x)
        busy = FR.exit_bar(S, x[0], x[2], x[4], x[5])
    return out, armed


def hourly_R(d, q, sig):
    o, h, l, c = (q[x].values for x in ("open", "high", "low", "close"))
    k, _, side, _, stop, tgt, lim, _ = sig
    day = d.index[k]
    j0, j1 = q.index.searchsorted(day), q.index.searchsorted(day + pd.Timedelta(days=1))
    j = next((j for j in range(j0, j1) if (side == 1 and l[j] <= lim) or (side == -1 and h[j] >= lim)), None)
    if j is None or j + 2 >= len(c):
        return np.nan
    px = min(o[j], lim) if side == 1 else max(o[j], lim)
    if (px - stop) * side <= 0:
        return np.nan
    risk = abs(px - stop)
    end, fee = min(j + FR.HOLD * 24, len(c)), lambda p: 0.0006 * p / risk  # noqa: E731
    for m in range(j, end):
        if (l[m] <= stop) if side == 1 else (h[m] >= stop):
            ex = stop if m == j else (min(o[m], stop) if side == 1 else max(o[m], stop))
            return (ex - px) * side / risk - fee(px) - fee(ex)
        if m > j and ((h[m] >= tgt) if side == 1 else (l[m] <= tgt)):
            ex = max(o[m], tgt) if side == 1 else min(o[m], tgt)
            return (ex - px) * side / risk - fee(px) - fee(ex)
    return (c[end - 1] - px) * side / risk - fee(px) - fee(c[end - 1])


def main():
    rows, armed_n = [], {}
    for ci, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        a = E.MT.atr_of(d.high.values, d.low.values, d.close.values)
        try:
            q = E.bars_1h(coin)
        except Exception:
            q = None
        for f, tm in VARS:
            sigs, n_arm = signals(d, f, tm)
            armed_n[(f, tm)] = armed_n.get((f, tm), 0) + n_arm
            by_k = {s[0]: s for s in sigs}
            for x in FP.score_all(coin, d[["open", "high", "low", "close"]], [s[0:1] + s[2:6] for s in sigs], FR.HOLD, ci, a):
                if T0 <= x["time"] < T1:
                    s = by_k[d.index.get_loc(x["time"])]
                    rows.append(dict(x, f=f, tm=tm, zone_atr=s[7], R1h=hourly_R(d, q, s) if q is not None else np.nan))
        print(coin, flush=True)
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    z.to_csv(os.path.join(HERE, "out", "Z-1_trades.csv.gz"), index=False)
    idx = pd.date_range(T0, T1, freq="W-MON", inclusive="left")
    wk = lambda g, col: g.set_index(pd.to_datetime(g.time))[col].resample("W-MON").sum().reindex(idx).fillna(0)  # noqa: E731
    sh = lambda w: w.mean() / w.std() * np.sqrt(52)  # noqa: E731
    out = [f"Z-1: R-1u limit at fraction f of the zone (0 = the broken wick, the current rule; 1 = the far edge), stop fixed "
           f"at the zone stop; development 53 coins 2018-2022; median zone height {z[z.f == 0].zone_atr.median():.2f} ATR"]
    W = {}
    for (f, tm), g in z.groupby(["f", "tm"], sort=False):
        lo, hi = attrib.week_boot(g)
        W[(f, tm)] = wk(g, "R")
        h1 = g.dropna(subset=["R1h"])
        out.append(f"  f {f:.2f} target {tm:4s}: n {len(g)}, avg R {g.R.mean():+.3f}, win {np.mean(g.R > 0):.0%}, edge "
                   f"{(g.R - g.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}], total R {g.R.sum():.0f}, weekly Sharpe {sh(W[(f, tm)]):.2f}"
                   f" | 1h walk: avg R {h1.R1h.mean():+.3f}, win {np.mean(h1.R1h > 0):.0%}, total R {h1.R1h.sum():.0f}, Sharpe {sh(wk(h1, 'R1h')):.2f}"
                   f"; median target {g.target_R.median():.1f}R, stop {g.stop_atr.median():.2f} ATR")
    M = np.column_stack([W[(f, "2R")].values for f in FRACS])
    blocks = np.array_split(np.arange(len(M)), 12)
    logits = []
    for comb in itertools.combinations(range(12), 6):
        ins = np.concatenate([blocks[i] for i in comb])
        oos = np.concatenate([blocks[i] for i in range(12) if i not in comb])
        si, so = M[ins].mean(0) / M[ins].std(0), M[oos].mean(0) / M[oos].std(0)
        b = int(np.argmax(si))
        wr = ((so < so[b]).sum() + 1) / (len(so) + 1)
        logits.append(np.log(wr / (1 - wr)))
    out.append(f"  CSCV PBO over the five primary (2R) fractions: {np.mean(np.array(logits) <= 0):.2f}")
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_zone_entry.txt"), "w").write(t + "\n")
    E.log("Z-1", "R-1 zone-fraction entries", "iteration", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), False,
          "five fractions + fixed-target variants; see r1_zone_entry.txt")


if __name__ == "__main__":
    main()
