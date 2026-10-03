"""Loop E-1 (loop/LOG.md): R-1u with the limit moved deeper by 0-1 ATR, stop fixed at the zone, target 2R.
Usage: python loop/r1_entry_offset.py"""
import itertools, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402
import family_r as FR  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
OFFSETS = (0.0, 0.1, 0.25, 0.5, 0.75, 1.0)


def signals(d, off):
    S = FR.state(d)
    c, a, tr = S["c"], S["a"], S["trend"]
    cand = []
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low") or i + 1 >= len(c) or np.isnan(a[i]):
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] != side:
            continue
        lvl, edge = p[1], p[2]
        lower = max(edge, lvl - a[i]) if side == 1 else min(edge, lvl + a[i])
        stop = lower - side * FR.BUF * a[i]
        lim = lvl - side * off * a[i]
        if (lim - stop) * side <= 0.05 * a[i]:
            continue
        k, px = FR.fill(S, i + 1, side, lim)
        if k is None or (px - stop) * side <= 0:
            continue
        cand.append((k, i, side, px, stop, px + side * 2 * abs(px - stop)))
    busy, out = -1, []
    for k, i, side, px, stop, tgt in sorted(cand, key=lambda x: (x[0], x[1])):
        if k <= busy:
            continue
        out.append((k, side, px, stop, tgt))
        busy = FR.exit_bar(S, k, side, stop, tgt)
    return out


def main():
    rows = []
    for ci, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        a = E.MT.atr_of(d.high.values, d.low.values, d.close.values)
        for off in OFFSETS:
            for x in FP.score_all(coin, d[["open", "high", "low", "close"]], signals(d, off), FR.HOLD, ci, a):
                if T0 <= x["time"] < T1:
                    rows.append(dict(x, off=off))
        print(coin, flush=True)
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    z.to_csv(os.path.join(HERE, "out", "E-1_trades.csv.gz"), index=False)
    idx = pd.date_range(T0, T1, freq="W-MON", inclusive="left")
    W = pd.DataFrame({off: g.set_index(pd.to_datetime(g.time)).R.resample("W-MON").sum().reindex(idx).fillna(0)
                      for off, g in z.groupby("off")})
    out = ["E-1: deeper R-1u entries (stop fixed at the zone, 2R target), development 53 coins 2018-2022"]
    for off, g in z.groupby("off"):
        lo, hi = attrib.week_boot(g)
        w = W[off]
        out.append(f"  deeper by {off:.2f} ATR: n {len(g)}, avg R {g.R.mean():+.3f}, win {np.mean(g.R > 0):.0%}, edge "
                   f"{(g.R - g.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}], total R {g.R.sum():.0f}, weekly Sharpe {w.mean() / w.std() * np.sqrt(52):.2f}")
    M = W.values
    blocks = np.array_split(np.arange(len(M)), 12)
    logits = []
    for comb in itertools.combinations(range(12), 6):
        ins = np.concatenate([blocks[i] for i in comb])
        oos = np.concatenate([blocks[i] for i in range(12) if i not in comb])
        si, so = M[ins].mean(0) / M[ins].std(0), M[oos].mean(0) / M[oos].std(0)
        b = int(np.argmax(si))
        wr = ((so < so[b]).sum() + 1) / (len(so) + 1)
        logits.append(np.log(wr / (1 - wr)))
    out.append(f"  CSCV PBO over the six: {np.mean(np.array(logits) <= 0):.2f}")
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_entry_offset.txt"), "w").write(t + "\n")
    E.log("E-1", "R-1 deeper entries", "iteration", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), False, "six offsets; see r1_entry_offset.txt")


if __name__ == "__main__":
    main()
