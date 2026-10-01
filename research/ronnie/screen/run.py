"""TrialFamily screen-v1: room to the nearest multi-timeframe level and structure behind the stop, as screens before
B1, BOX, TREND and FADE entries. See INTENT.md. Writes screen/trades.csv.gz and screen/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("exits_run", os.path.join(ROOT, "exits", "run.py"))
X = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(X)
MT, R2, R4 = X.MT, X.R2, X.R4
AGG = {"open": "first", "high": "max", "low": "min", "close": "last"}
SCREENS = ("G1", "G2", "G3", "G4")


def books(bars):
    d4 = bars["4h"][["open", "high", "low", "close"]]
    d1 = bars["1d"][["open", "high", "low", "close"]]
    w1 = d1.resample("W-MON", label="left", closed="left").agg(AGG).dropna()
    return [(d.index, MT.level_book(d, k, False)) for d, k in ((d4, 3), (d1, 3), (w1, 2))]


def measures(bk, t, side, entry, stop):
    risk = (entry - stop) * side
    room, guard = np.inf, False
    for idx, book in bk:
        i = int(idx.searchsorted(t, side="right")) - 1
        if i < 0:
            continue
        Y = book[i][0]
        if len(Y) == 0:
            continue
        ahead = (Y - entry) * side
        if (ahead > 0).any():
            room = min(room, ahead[ahead > 0].min() / risk)
        behind = (entry - Y) * side
        guard |= bool(((behind > 0) & (behind < risk)).any())
    return room, guard


def main():
    from evaluate import holdout_bars
    rows = []
    for name_set, coins, (t0, t1) in (("dev", R4.MAJORS, X.DEV), ("holdout", R4.LARGE, X.HOLD)):
        for coin in coins:
            bars = holdout_bars(coin)
            bk = books(bars)
            for kind, B, e, side, entry, stop, tgt, t in X.entries(coin, bars):
                if not t0 <= t < t1:
                    continue
                r = X.trade(B, e, side, entry, stop, tgt, "X0")
                if np.isnan(r):
                    continue
                room, guard = measures(bk, t, side, entry, stop)
                rows.append(dict(set=name_set, coin=coin, kind=kind, time=t, side=side, R=r, room=room, guard=guard))
            print(f"{coin} {name_set}: {sum(x['coin'] == coin and x['set'] == name_set for x in rows)} entries", flush=True)
    T = pd.DataFrame(rows)
    T["G1"], T["G2"], T["G3"] = T.room >= 2, T.room >= 1, T.guard
    T["G4"] = T.G1 & T.G3
    with gzip.GzipFile(f"{HERE}/trades.csv.gz", "wb", mtime=0) as f:
        f.write(T.to_csv(index=False, float_format="%.6g").encode())
    out = ["screen-v1 (INTENT.md): room = distance to the nearest intact 4h/daily/weekly level ahead, in R; guard = a level",
           "between stop and entry; score = R under the baseline exit X0; kept minus dropped with a 95% coin-then-trade bootstrap", ""]
    held, rescued = [], []
    for kind in ("B1", "BOX", "TREND", "FADE"):
        out.append(f"{kind}:")
        for s in ("dev", "holdout"):
            z = T[(T.kind == kind) & (T.set == s)]
            out.append(f"  {s}: n {len(z)}, mean R {z.R.mean():+.3f}, median room {z.room.replace(np.inf, np.nan).median():.2f}R "
                       f"(none ahead {np.isinf(z.room).mean():.0%}), guard {z.guard.mean():.0%}")
        for g in SCREENS:
            lows, cells = [], []
            for s in ("dev", "holdout"):
                z = T[(T.kind == kind) & (T.set == s)]
                d = z.assign(R=np.where(z[g], z.R, np.nan))
                kept, drop = z[z[g]], z[~z[g]]
                if len(kept) < 5 or len(drop) < 5:
                    cells.append(f"{s} kept {len(kept)} dropped {len(drop)}: too few")
                    lows.append(-1)
                    continue
                rng = np.random.default_rng(11)
                gk = {c: g_ for c, g_ in z.groupby("coin")}
                diffs = []
                for _ in range(2000):
                    zz = pd.concat([gk[c].sample(frac=1, replace=True, random_state=int(rng.integers(1e9)))
                                    for c in rng.choice(list(gk), len(gk))])
                    diffs.append(zz[zz[g]].R.mean() - zz[~zz[g]].R.mean())
                lo, hi = np.nanpercentile(diffs, [2.5, 97.5])
                lows.append(lo)
                cells.append(f"{s} kept {len(kept):4d} ({len(kept) / len(z):.0%}) {kept.R.mean():+.3f} dropped {drop.R.mean():+.3f} "
                             f"diff {kept.R.mean() - drop.R.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
                del d
            out.append(f"  {g} " + " | ".join(cells))
            if min(lows) > 0:
                held.append(f"{kind}:{g}")
                if kind == "FADE":
                    k = T[(T.kind == kind) & (T.set == "holdout") & T[g]]
                    lo, hi = R2.coin_boot(k.assign(control=0.0))
                    if lo > 0:
                        rescued.append(f"FADE:{g} holdout kept {k.R.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
        out.append("")
    out.append("decision, screens that hold (kept minus dropped above zero at 95% on both sets): " + (", ".join(held) or "none"))
    out.append("decision, box fade rescued: " + (", ".join(rescued) or "no"))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
