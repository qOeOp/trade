"""Family A of the R&D loop: "support holds in a trend". Usage: python loop/family_a.py A1 [validate|final]

Each loop id maps to one configuration in LOOPS; a loop changes one thing from its predecessor (see loop/LOG.md).
Writes loop/out/<id>.csv.gz (trades with attribution features) and prints the gate result and the attribution.
"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402

BASE = dict(tf="1d", trend="sma", touch=0.25, stop_atr=1.0, target="hh20", hold=20, confirm="close_above", sides=(1, -1),
            level_tf="1d", spacing=5)
LOOPS = {"A1": dict(BASE), "A2": dict(BASE, min_touches=2), "A3": dict(BASE, confirm="trigger"), "A4": dict(BASE, confirm="trigger", ts=(5, 1.0)), "A5": dict(BASE, confirm="trigger", level_tf="1w"),
         "A6": dict(BASE, confirm="trigger", level_tf="1w", tf="4h"),
         "A7": dict(BASE, confirm="trigger", level_tf="1w", touch=0.5),
         "A8": dict(BASE, confirm="trigger", level_tf="1w", touch=0.5, max_vol=1.0)}


def levels(d, k):
    return E.MT.level_book(d[["open", "high", "low", "close"]], k, True)


def make(cfg):
    feats = {}

    def fn(d1, d4):
        d = d1 if cfg["tf"] == "1d" else d4
        o, h, l, c, v = (d[x].values for x in ("open", "high", "low", "close", "volume"))
        a = E.MT.atr_of(h, l, c)
        a100 = E.MT.atr_of(h, l, c, 100)
        if cfg["tf"] == "1d":
            s50, s200 = (pd.Series(c).rolling(k).mean().values for k in (50, 200))
        else:  # the daily trend, known at the open of the 4h bar (last closed day), mapped onto 4h bars
            dc = d1.close
            m50, m200 = dc.rolling(50).mean(), dc.rolling(200).mean()
            di = d1.index.searchsorted(d.index, side="right") - 2
            s50 = np.where(di >= 0, m50.values[np.maximum(di, 0)], np.nan)
            s200 = np.where(di >= 0, m200.values[np.maximum(di, 0)], np.nan)
            c_d = np.where(di >= 0, dc.values[np.maximum(di, 0)], np.nan)
        if cfg["level_tf"] == "1w":
            w = d.resample("W-MON", label="left", closed="left").agg(
                {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
            wbook = levels(w, 2)
            wi = w.index.searchsorted(d.index, side="right") - 1
            book = [wbook[k] if k >= 0 else (np.array([]),) * 4 + (np.nan,) for k in wi]
        else:
            book = levels(d, 3)
        hh, ll = pd.Series(h).shift(1).rolling(20).max().values, pd.Series(l).shift(1).rolling(20).min().values
        out, last = [], -99
        for i in range(210, len(c) - 1):
            if i - last < cfg["spacing"]:
                continue
            Y, S, T, L, _ = book[i]  # levels known at the open of bar i (built from bars before i)
            for side in cfg["sides"]:
                cc = c[i] if cfg["tf"] == "1d" else c_d[i]
                up = cc > s200[i] and s50[i] > s200[i]
                dn = cc < s200[i] and s50[i] < s200[i]
                if (side == 1 and not up) or (side == -1 and not dn):
                    continue
                m = (S == -side) & (T >= cfg.get("min_touches", 0))  # supports for longs, resistances for shorts
                if not m.any():
                    continue
                ys, ts, ls = Y[m], T[m], L[m]
                # the level tested by bar i: the extreme reaches within touch*ATR and the close is back on the far side
                reach = (l[i] <= ys + cfg["touch"] * a[i - 1]) if side == 1 else (h[i] >= ys - cfg["touch"] * a[i - 1])
                hold = (c[i] > ys) if side == 1 else (c[i] < ys)
                near = (ys - c[i]) * side < 0  # level on the stop side of the close
                ok = reach & hold & near
                if not ok.any():
                    continue
                j = np.argmax(ys * ok) if side == 1 else np.argmin(np.where(ok, ys, np.inf))
                y = ys[j]
                if a[i - 1] / a100[i - 1] >= cfg.get("max_vol", np.inf):
                    continue
                e, entry = i + 1, o[i + 1]
                if cfg["confirm"] == "trigger":
                    trig, e = (h[i] if side == 1 else l[i]), None
                    for k in (i + 1, i + 2):
                        if k < len(c) - 1 and ((h[k] >= trig) if side == 1 else (l[k] <= trig)):
                            e, entry = k, (max(o[k], trig) if side == 1 else min(o[k], trig))
                            break
                    if e is None:
                        continue
                stop = y - side * cfg["stop_atr"] * a[i - 1]
                tgt = hh[i] if side == 1 else ll[i]
                risk = (entry - stop) * side
                if risk <= 0 or risk > 6 * a[i - 1] or (tgt - entry) * side < risk:
                    continue
                out.append((e, side, entry, stop, tgt))
                feats[(d.index[e], side)] = dict(
                    trend_atr=(c[i] - s200[i]) / a[i - 1] * side, touches=int(ts[j]), age=i - int(ls[j]) if ls[j] >= 0 else -1,
                    vol_ratio=a[i - 1] / a100[i - 1], depth=(hh[i] - c[i]) / a[i - 1] if side == 1 else (c[i] - ll[i]) / a[i - 1],
                    n_levels=int(m.sum()))
                last = i
        return out
    return fn, feats


def attribute(z):
    z = z.assign(edge=z.R - z.control)
    lines = []
    for f in ("side", "trend_atr", "touches", "age", "vol_ratio", "depth", "stop_atr", "target_R"):
        if f == "side":
            g = z.groupby("side").edge.agg(["mean", "count"])
        else:
            q = pd.qcut(z[f].rank(method="first"), 3, labels=["T1 low", "T2", "T3 high"])
            g = z.groupby(q, observed=True).edge.agg(["mean", "count"])
            g.index = [f"{k} ({z[f][q == k].min():.2f}..{z[f][q == k].max():.2f})" for k in g.index]
        lines.append(f"  {f:<10} " + "   ".join(f"{k}: {r['mean']:+.3f} (n {int(r['count'])})" for k, r in g.iterrows()))
    stopped = (z.R <= -0.9).mean()
    lines.append(f"  outcome mix: stopped {stopped:.0%}, avg R {z.R.mean():+.3f}, control {z.control.mean():+.3f}")
    return "\n".join(lines)


def main():
    loop = sys.argv[1]
    stage = sys.argv[2] if len(sys.argv) > 2 else "iteration"
    cfg = LOOPS[loop]
    fn, feats = make(cfg)
    sets = {"iteration": (cfg.get("iter_set", "iter"),), "validate": ("val",), "final": ("final",)}[stage]
    z = E.run(loop, fn, cfg["tf"], cfg["hold"], sets, ts=cfg.get("ts"))
    f = pd.DataFrame([feats.get((t, s), {}) for t, s in zip(z.time, z.side)])
    z = pd.concat([z.reset_index(drop=True), f], axis=1)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    with gzip.GzipFile(os.path.join(HERE, "out", f"{loop}_{stage}.csv.gz"), "wb", mtime=0) as fh:
        fh.write(z.to_csv(index=False, float_format="%.6g").encode())
    if stage == "iteration":
        passed, st = E.iteration_gate(z)
        E.log(loop, "familyA", "iteration", st, passed)
        print(f"{loop} iteration gate {'PASS' if passed else 'fail'}: {E.fmt(st)}")
        print("attribution (iteration tier, edge by tercile):")
        print(attribute(z))
        print(E.decompose(z, cfg["tf"], cfg["hold"]))
    else:
        level, k = E.validation_level() if stage == "validate" else (95, 0)
        lo, hi = E.boot(z, level)
        st = dict(n=len(z), edge=(z.R - z.control).mean(), lo=lo, hi=hi)
        passed = bool(lo > 0)
        E.log(loop, "familyA", "validation" if stage == "validate" else "final", st, passed, f"level {level:.2f}")
        print(f"{loop} {stage} ({level:.2f}% interval, k={k}): n {len(z)}, avg R {z.R.mean():+.3f}, edge {st['edge']:+.3f} "
              f"[{lo:+.3f}, {hi:+.3f}] -> {'PASS' if passed else 'fail'}")


if __name__ == "__main__":
    main()
