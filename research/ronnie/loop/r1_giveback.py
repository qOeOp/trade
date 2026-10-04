"""R-1 trades that reach +1R: what separates those stopped afterwards from those that reach 2R (descriptive,
2026-10-04, the user's question). Realistic R-1 trades (f = 0, one slot per coin by first fill hour, 1h walks with
ambiguous hours on 1m). Every feature is known by the time it names (the +1R hour, or 6 / 24 hours later); minute
features use Binance 1m files. Usage: python loop/r1_giveback.py"""
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

BTC = None


def minutes_span(coin, t0, n_hours):
    """1m closes and highs/lows from hour t0 for n_hours, or None"""
    out = []
    for k in range(n_hours):
        t = t0 + pd.Timedelta(hours=k)
        x = F.minutes(coin, t.normalize())
        if x is None:
            return None
        m0 = int((t - t.normalize()).total_seconds() // 60)
        out.append(x[m0:m0 + 60])
    a = np.concatenate(out)
    return a[~np.isnan(a[:, 0])]


def coin_rows(args):
    coin, t0, t1 = args
    d = E.bars(coin)["1d"]
    try:
        q = E.bars_1h(coin)
    except Exception:
        return []
    bq = E.bars_1h("BTC")
    o, h, l, c, v = (q[x].values for x in ("open", "high", "low", "close", "volume"))
    S = FR.state(d)
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
        if not (t0 <= d.index[s[0]] < t1) or kind == "time" or jf < 60:
            continue
        side, stop, i = s[2], s[4], s[1]
        risk = abs(px - stop)
        Rof = lambda p: (p - px) * side / risk  # noqa: E731
        fav = np.array([Rof(h[m]) if side == 1 else Rof(l[m]) for m in range(jf, jx + 1)])
        fav[0] = 0.0
        if kind == "stop":
            fav[-1] = min(fav[-1], fav[:-1].max() if len(fav) > 1 else 0)
        k1 = np.flatnonzero(fav >= 1.0)
        if not len(k1):
            continue
        j1 = jf + int(k1[0])  # the hour that first reaches +1R
        rng0 = np.mean(h[jf - 48:jf] - l[jf - 48:jf])
        vol0 = np.mean(v[jf - 48:jf])
        hi_b, lo_b = max(o[j1], c[j1]), min(o[j1], c[j1])
        wick = ((h[j1] - hi_b) if side == 1 else (lo_b - l[j1])) / max(h[j1] - l[j1], 1e-12)
        bt = bq.close.reindex(q.index[[jf, j1]]).values
        r = dict(coin=coin, side=side, fill=q.index[jf], won=kind == "target", R=Rof(ex),
                 risk_pct=risk / px, hours_to_1r=j1 - jf,
                 hour_range_x=(h[j1] - l[j1]) / rng0 if rng0 > 0 else np.nan,
                 vol_x=v[j1] / vol0 if vol0 > 0 else np.nan,
                 close_R_1r_hour=Rof(c[j1]), wick_frac=wick,
                 move_atr=abs(c[j1] - px) / S["a"][i],
                 btc_pct=(bt[1] / bt[0] - 1) * 100 * side if np.all(np.isfinite(bt)) else np.nan,
                 coin_pct=(c[j1] / px - 1) * 100 * side,
                 trend_days=int(np.sum(S["trend"][max(0, i - 200):i + 1] == side)))
        # follow-through: decided only once these hours have passed and the trade is still open
        for H in (6, 24):
            j = j1 + H
            if j < jx:
                r[f"max_R_{H}h"] = max(Rof(h[m]) if side == 1 else Rof(l[m]) for m in range(j1, j + 1))
                r[f"close_R_{H}h"] = Rof(c[j])
                r[f"min_R_{H}h"] = min(Rof(l[m]) if side == 1 else Rof(h[m]) for m in range(j1 + 1, j + 1))
        # minutes: how long price held at or above +1R in the 6 hours from the +1R hour
        mm = minutes_span(coin, q.index[j1], 6) if j1 + 6 < len(c) else None
        if mm is not None and len(mm):
            cl = np.array([Rof(x) for x in mm[:, 3]])
            first = np.flatnonzero((np.array([Rof(x) for x in (mm[:, 1] if side == 1 else mm[:, 2])]) >= 1.0))
            if len(first):
                after = cl[first[0]:first[0] + 360]
                r["min_above_1r_6h"] = float(np.sum(after >= 1.0))
                r["min_above_1r_first60"] = float(np.sum(after[:60] >= 1.0))
                r["first_touch_minute_close_R"] = float(after[0])
        rows.append(r)
    return rows


def main():
    jobs = [(c, *E.ITER) for c in E.ITER_COINS + E.ITER_EXT_COINS] + [(c, *E.VAL) for c in E.VAL_COINS]
    with ProcessPoolExecutor(8) as ex:
        z = pd.DataFrame([r for rows in ex.map(coin_rows, jobs) for r in rows])
    z["period"] = np.where(z.fill < pd.Timestamp("2023-01-01", tz="UTC"), "dev", "val")
    z["btc_share"] = z.btc_pct / z.coin_pct.where(z.coin_pct.abs() > 1e-9)
    z.to_csv(os.path.join(HERE, "out", "giveback_1r.csv.gz"), index=False)
    feats = ["hours_to_1r", "hour_range_x", "vol_x", "close_R_1r_hour", "wick_frac", "move_atr", "btc_pct", "btc_share",
             "risk_pct", "trend_days", "min_above_1r_first60", "min_above_1r_6h", "first_touch_minute_close_R",
             "max_R_6h", "close_R_6h", "min_R_6h", "max_R_24h", "close_R_24h", "min_R_24h"]
    out = ["R-1 trades reaching +1R: share ending at 2R by feature tercile (low / mid / high), development | validation"]
    for p, g in z.groupby("period"):
        out.append(f"  {p}: {len(g)} trades reached +1R, {g.won.mean():.0%} ended at 2R; longs {g[g.side == 1].won.mean():.0%}, shorts {g[g.side == -1].won.mean():.0%}")
    for f in feats:
        cells = []
        for p, g in z.groupby("period"):
            g = g.dropna(subset=[f])
            if len(g) < 60:
                cells.append(f"{p}: n {len(g)}")
                continue
            qs = pd.qcut(g[f].rank(method="first"), 3, labels=False)
            edges = g[f].quantile([1 / 3, 2 / 3]).values
            cells.append(f"{p} " + " / ".join(f"{g.won[qs == t].mean():.0%}" for t in range(3)) + f" (cuts {edges[0]:.3g}, {edges[1]:.3g}; n {len(g)})")
        out.append(f"  {f:28s}: " + " | ".join(cells))
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_giveback.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
