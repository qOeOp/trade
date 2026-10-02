"""Loop R-F: Ronnie's four Fibonacci uses grafted on R-1u, each with a non-Fibonacci placebo (loop/LOG.md).
Development data only. Writes loop/r1_fib.txt."""
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
FIB = dict(conf=(0.382, 0.5, 0.618), entry=0.5, stop=0.786, ext=1.0)
PLA = dict(conf=(0.32, 0.44, 0.70), entry=0.44, stop=0.86, ext=1.15)
VARIANTS = {"base": {}, "F1": dict(tp=FIB), "F1p": dict(tp=PLA), "F2": dict(sl=FIB), "F2p": dict(sl=PLA),
            "F3": dict(conf=FIB), "F3p": dict(conf=PLA), "F4": dict(entry=FIB, sl=FIB, tp=FIB), "F4p": dict(entry=PLA, sl=PLA, tp=PLA),
            "FULL": dict(conf=FIB, sl=FIB, tp=FIB), "FULLp": dict(conf=PLA, sl=PLA, tp=PLA)}


def pivots_low_high(h, l, k=FR.K):
    pl, ph = [], []
    for j in range(k, len(h) - k):
        if l[j] == l[j - k:j + k + 1].min():
            pl.append((j + k, j, l[j]))
        if h[j] == h[j - k:j + k + 1].max():
            ph.append((j + k, j, h[j]))
    return pl, ph


def signals(d):
    S = FR.state(d)
    o, h, l, c, a, tr = S["o"], S["h"], S["l"], S["c"], S["a"], S["trend"]
    pl, ph = pivots_low_high(h, l)
    out = {v: [] for v in VARIANTS}
    cand = {v: [] for v in VARIANTS}
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low") or i + 1 >= len(c) or np.isnan(a[i]):
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] != side:
            continue
        lvl, edge, ai = p[1], p[2], a[i]
        piv = [q for q in (pl if side == 1 else ph) if q[0] <= i and q[1] < i]
        if not piv:
            continue
        ja, A = piv[-1][1], piv[-1][2]
        B = h[ja:i + 1].max() if side == 1 else l[ja:i + 1].min()
        span = (B - A) * side
        if span <= 0:
            continue
        lower = max(edge, lvl - ai) if side == 1 else min(edge, lvl + ai)
        zone_stop = lower - side * FR.BUF * ai
        for v, cfg in VARIANTS.items():
            if "conf" in cfg and not any(abs(lvl - (B - side * r * span)) <= 0.25 * ai for r in cfg["conf"]["conf"]):
                continue
            limit = B - side * cfg["entry"]["entry"] * span if "entry" in cfg else lvl
            k, px = FR.fill(S, i + 1, side, limit)
            if k is None:
                continue
            stop = (B - side * cfg["sl"]["stop"] * span - side * 0.1 * ai) if "sl" in cfg else zone_stop
            if (px - stop) * side <= 0:
                continue
            tgt = (px + side * cfg["tp"]["ext"] * span) if "tp" in cfg else px + side * 2 * abs(px - stop)
            cand[v].append((k, side, px, stop, tgt))
    for v, rows in cand.items():  # the first fill takes the slot, which frees at the exit (as loop/family_r.signals)
        busy = -1
        for sig in sorted(rows, key=lambda x: x[0]):
            if sig[0] > busy:
                out[v].append(sig)
                busy = FR.exit_bar(S, sig[0], sig[1], sig[3], sig[4])
    return out


def main():
    rows = []
    for k, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        d = E.bars(coin)["1d"]
        sig = signals(d)
        a = E.MT.atr_of(d.high.values, d.low.values, d.close.values)
        for v, s in sig.items():
            for x in FP.score_all(coin, d[["open", "high", "low", "close"]], s, FR.HOLD, k, a):
                if T0 <= x["time"] < T1:
                    rows.append(dict(x, variant=v))
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    z.to_csv(os.path.join(HERE, "out", "R-F_iteration.csv.gz"), index=False)
    idx = pd.date_range(T0, T1, freq="W-MON", inclusive="left")
    W = pd.DataFrame({v: g.set_index(pd.to_datetime(g.time)).R.resample("W-MON").sum().reindex(idx).fillna(0) for v, g in z.groupby("variant")})
    sh = W.mean() / W.std() * np.sqrt(52)
    lines = ["R-F: Ronnie's Fibonacci uses on R-1u, 53 coins 2018-2022 (each with a non-Fibonacci placebo)",
             "variant   n     avg R   edge  [week-clustered 95%]     Sharpe(weekly R)"]
    for v in VARIANTS:
        g = z[z.variant == v]
        if len(g) < 10:
            lines.append(f"{v:<6} too few trades ({len(g)})")
            continue
        lo, hi = attrib.week_boot(g)
        lines.append(f"{v:<6} {len(g):5d}  {g.R.mean():+.3f}  {(g.R - g.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]   {sh[v]:.2f}")
    lines.append("")
    for v in ("F1", "F2", "F3", "F4", "FULL"):
        lines.append(f"{v}: Sharpe {sh[v]:.2f} vs base {sh['base']:.2f} vs placebo {sh[v + 'p']:.2f}; "
                     f"Fibonacci-specific (variant - placebo) {sh[v] - sh[v + 'p']:+.2f}; "
                     f"{'meets the adoption rule (before PBO)' if sh[v] > sh['base'] and sh[v] > sh[v + 'p'] else 'not adopted'}")
    M = W.values
    blocks = np.array_split(np.arange(len(M)), 12)
    logits = []
    for comb in itertools.combinations(range(12), 6):
        ins = np.concatenate([blocks[i] for i in comb]); oos = np.concatenate([blocks[i] for i in range(12) if i not in comb])
        si = M[ins].mean(0) / M[ins].std(0); so = M[oos].mean(0) / M[oos].std(0)
        b = int(np.argmax(si)); w = ((so < so[b]).sum() + 1) / (len(so) + 1)
        logits.append(np.log(w / (1 - w)))
    lines.append(f"PBO over the 11 variants: {(np.array(logits) <= 0).mean():.2f}")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "r1_fib.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
