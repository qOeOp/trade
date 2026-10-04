"""R-1 dynamic exits built from the +1R giveback analysis (2026-10-04, the user's request; the thresholds were read
off the same development and validation trades, so this is in-sample on both). Realistic R-1 trades (f = 0, slot by
first fill hour, 1h walks with ambiguous hours on 1m); a rule acts only on a trade still open at its checkpoint,
counted from the first hour reaching +1R. Exits at an hourly close pay fees and 0.05% slippage; a moved stop is
walked on 1h bars, a stop and target in one hour counting as the stop. Usage: python loop/r1_giveback_exit.py"""
import os, sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402
import r1_zone_entry as Z  # noqa: E402
import r1_zone_entry_fine as F  # noqa: E402

SLIP = 0.0005
# (name, checkpoint hours after the +1R hour, close threshold in R, action)
RULES = [("X6", 6, 0.70, "exit"), ("X24", 24, 0.45, "exit"), ("B6", 6, 0.70, "be"), ("B24", 24, 0.45, "be"),
         ("W0", 0, 0.93, "be"), ("B6+X24", None, None, None)]


def coin_rows(args):
    coin, t0, t1 = args
    d = E.bars(coin)["1d"]
    try:
        q = E.bars_1h(coin)
    except Exception:
        return []
    o, h, l, c = (q[x].values for x in ("open", "high", "low", "close"))
    cand, _ = Z.signals(d, 0.0, "2R", raw=True)
    walked = []
    for s in cand:
        if s[0] <= 300 or s[0] + FR.HOLD >= len(d):
            continue
        w = F.walk(coin, q, d, s)
        if w is not None:
            walked.append((w[4], s[1], s, w))
    busy, rows = -1, []
    for jf, _, s, w in sorted(walked, key=lambda x: (x[0], x[1])):
        if jf <= busy:
            continue
        px, kind, ex, flag, jf, jx = w
        busy = jx
        if not (t0 <= d.index[s[0]] < t1):
            continue
        side, stop, tgt = s[2], s[4], s[5]
        risk = abs(px - stop)
        fee = lambda p: F.FEE * p / risk  # noqa: E731
        Rof = lambda p: (p - px) * side / risk  # noqa: E731
        exs = ex - side * SLIP * ex if kind == "stop" else ex
        base = Rof(exs) - fee(px) - fee(exs)
        r = dict(coin=coin, fill=q.index[jf], side=side, base=base)
        fav = [0.0] + [Rof(h[m]) if side == 1 else Rof(l[m]) for m in range(jf + 1, jx + 1)]
        if kind == "stop":
            fav[-1] = min(fav[-1], max(fav[:-1]))
        k1 = [k for k, x in enumerate(fav) if x >= 1.0]
        j1 = jf + k1[0] if k1 else None

        def exit_at(j):
            p = c[j] - side * SLIP * c[j]
            return Rof(p) - fee(px) - fee(p)

        def be_from(j):
            """stop moved to the entry after hour j; walk to the original exit or the hold end"""
            end = min(jf + FR.HOLD * 24, len(c))
            for m in range(j + 1, end):
                hit_s = (l[m] <= px) if side == 1 else (h[m] >= px)
                hit_t = (h[m] >= tgt) if side == 1 else (l[m] <= tgt)
                if hit_s:
                    p = min(o[m], px) if side == 1 else max(o[m], px)
                    p -= side * SLIP * p
                    return Rof(p) - fee(px) - fee(p)
                if hit_t:
                    p = max(o[m], tgt) if side == 1 else min(o[m], tgt)
                    return Rof(p) - fee(px) - fee(p)
            return Rof(c[end - 1]) - fee(px) - fee(c[end - 1])

        def rule(H, thr, act):
            if j1 is None or j1 + H >= jx:
                return base, False
            j = j1 + H
            if Rof(c[j]) >= thr:
                return base, False
            return (exit_at(j) if act == "exit" else be_from(j)), True

        for name, H, thr, act in RULES:
            if name == "B6+X24":
                v, hit = rule(6, 0.70, "be")
                if not hit:
                    v, hit = rule(24, 0.45, "exit")
            else:
                v, hit = rule(H, thr, act)
            r[name], r[name + "_hit"] = v, hit
        rows.append(r)
    return rows


def main():
    jobs = [(c, *E.ITER) for c in E.ITER_COINS + E.ITER_EXT_COINS] + [(c, *E.VAL) for c in E.VAL_COINS]
    with ProcessPoolExecutor(8) as ex:
        z = pd.DataFrame([r for rows in ex.map(coin_rows, jobs) for r in rows])
    z.to_csv(os.path.join(HERE, "out", "giveback_exit.csv.gz"), index=False)
    names = ["base"] + [n for n, *_ in RULES]
    out = ["R-1 dynamic exits from the +1R giveback checkpoints (in-sample on both periods); weekly R sums; 0.5%-risk return"
           " is the yearly sum of R x 0.5% with no compounding and no limit on open trades"]
    for p, (t0, t1) in (("development 2018-2022", E.ITER), ("validation 2023-2026-08", E.VAL)):
        g = z[(z.fill >= t0) & (z.fill < t1)]
        idx = pd.date_range(t0, t1, freq="W-MON", inclusive="left", tz="UTC")
        years = (t1 - t0).days / 365.25
        wk = g.fill.dt.tz_convert(None).dt.to_period("W").astype(str).values
        weeks = pd.unique(wk)
        rng = np.random.default_rng(71)
        draws = [np.flatnonzero(np.isin(wk, rng.choice(weeks, len(weeks)))) for _ in range(1000)]
        out.append(f"\n== {p}: {len(g)} trades")
        for n in names:
            w = g.set_index("fill")[n].resample("W-MON").sum().reindex(idx).fillna(0)
            eq = w.cumsum()
            line = (f"  {n:7s}: avg R {g[n].mean():+.3f}, total R {g[n].sum():.0f}, weekly Sharpe {w.mean() / w.std() * np.sqrt(52):.2f}, "
                    f"max DD {(eq - eq.cummax()).min():.0f}R, ~{g[n].sum() / years * 0.5:.0f}%/yr at 0.5% risk")
            if n != "base":
                dd = (g[n] - g.base).values
                bs = [dd[ix].mean() for ix in draws]
                lo, hi = np.percentile(bs, [2.5, 97.5])
                line += f"; acts on {g[n + '_hit'].mean():.1%} of trades, minus base {dd.mean():+.4f} [{lo:+.4f}, {hi:+.4f}]"
            out.append(line)
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_giveback_exit.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
