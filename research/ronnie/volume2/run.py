"""TrialFamily volume2-v1: the volume-profile node fade as a trade, against the same order at moved nodes. See INTENT.md.

Writes volume2/trades.csv.gz and volume2/result.txt.
"""
import importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


VR = _load("volume_run", "volume/run.py")  # profile(), WIN_D, BIN, HVN_Q, LVN_Q, NEAR_MIN, NEAR_MAX
MT = VR.MT  # atr_of, level_book, walk

STOP, TGT = {"N1": 1.0, "N2": 1.0}, {"N1": 1.0, "N2": 2.0}
DAY_BARS, HOLD_1H, N_MOVED, FEE = 24, 240, 20, 0.0006
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
HOLD = (pd.Timestamp("2022-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
HOLDOUT = ("IMX", "ENS", "JASMY", "PEOPLE", "SPELL", "ACH", "GLMR", "MINA", "QNT", "BICO", "NMR", "ILV", "YGG", "RARE", "AMP")


def orders(bars, t0, t1, rng):
    """-> list of (day, is_node, fill bar, side, fill, a4) for nodes and their moved copies."""
    h1, d1, d4 = bars["1h"], bars["1d"], bars["4h"]
    t1h = h1.index
    o, h, l, c, v = (h1[x].values.astype(float) for x in ("open", "high", "low", "close", "volume"))
    a4 = MT.atr_of(d4.high.values, d4.low.values, d4.close.values)
    k4 = d4.index.searchsorted(t1h, side="right") - 1
    atr4 = np.r_[np.nan, a4[:-1]][np.maximum(k4, 0)]
    dh, dl, dc = (d1[x].values for x in ("high", "low", "close"))
    ad_all = np.r_[np.nan, MT.atr_of(dh, dl, dc)[:-1]]  # ATR of the last closed daily bar
    out = []
    for D in range(VR.WIN_D + 20, len(d1)):
        day = d1.index[D]
        if not t0 <= day < t1:
            continue
        i0 = int(t1h.searchsorted(day)) - 1
        if i0 < 500 or i0 + DAY_BARS + HOLD_1H + 1 >= len(c):
            continue
        ad, a = ad_all[D], atr4[i0]
        if not (ad > 0 and a > 0):
            continue
        s = int(t1h.searchsorted(d1.index[D - VR.WIN_D]))
        px = o[i0 + 1]
        mids, prof = VR.profile(h[s:i0 + 1], l[s:i0 + 1], v[s:i0 + 1], px - 8 * ad, px + 8 * ad, VR.BIN * ad)
        if prof.sum() <= 0:
            continue
        hq, lq = np.quantile(prof[prof > 0], [VR.HVN_Q, VR.LVN_Q])
        peak = np.r_[False, (prof[1:-1] >= prof[:-2]) & (prof[1:-1] >= prof[2:]), False]
        trough = np.r_[False, (prof[1:-1] <= prof[:-2]) & (prof[1:-1] <= prof[2:]), False]
        dist = np.abs(mids - px)
        node = ((peak & (prof >= hq)) | (trough & (prof <= lq))) & (dist >= VR.NEAR_MIN * ad) & (dist <= VR.NEAR_MAX * ad)
        for sgn in (1, -1):
            q = np.flatnonzero(node & (np.sign(mids - px) == sgn))
            if not len(q):
                continue
            y = mids[q[np.argmin(dist[q])]]
            side = -sgn  # sell the node above, buy the node below
            for is_node, yy in [(True, y)] + [(False, y + rng.uniform(1, 4) * a * rng.choice((-1, 1))) for _ in range(N_MOVED)]:
                if (px - yy) * side <= 0:
                    continue  # a moved copy that lands on the wrong side of the open is not a resting order
                w = slice(i0 + 1, i0 + 1 + DAY_BARS)
                hit = np.flatnonzero(l[w] <= yy) if side == 1 else np.flatnonzero(h[w] >= yy)
                if len(hit):
                    e = i0 + 1 + hit[0]
                    fill = min(o[e], yy) if side == 1 else max(o[e], yy)
                    out.append((day, is_node, e, side, fill, yy, a))
    return out, (o, h, l, c)


def main():
    import harness as H
    from evaluate import holdout_bars
    rng = np.random.default_rng(37)
    frames = []
    for name, sname, (t0, t1) in [("BTCUSD", "dev", DEV), ("ETHUSDT", "dev", DEV)] + [(c, "holdout", HOLD) for c in HOLDOUT]:
        bars = H.load(name) if sname == "dev" else holdout_bars(name)
        od, (o, h, l, c) = orders(bars, t0, t1, rng)
        if not od:
            continue
        df = pd.DataFrame(od, columns=["day", "is_node", "e", "side", "fill", "y", "a"])
        for k in STOP:
            stop = df.y.values - df.side.values * STOP[k] * df.a.values
            tgt = df.y.values + df.side.values * TGT[k] * df.a.values
            valid = (df.fill.values - stop) * df.side.values > 0
            R = np.full(len(df), np.nan)
            R[valid] = MT.walk(o, h, l, c, df.e.values[valid], df.side.values[valid], df.fill.values[valid], stop[valid],
                               tgt[valid], HOLD_1H, FEE)
            df[k] = R
        frames.append(df.assign(market=name, set=sname))
        print(f"{name}: {int(df.is_node.sum())} node fills, {int((~df.is_node).sum())} moved fills", flush=True)
    T = pd.concat(frames, ignore_index=True)
    T.to_csv(os.path.join(HERE, "trades.csv.gz"), index=False, float_format="%.6g")
    out = ["volume2-v1: profile-node fade as a trade (limit at node, stop 1 ATR4h beyond, target 1 or 2 ATR4h), vs moved nodes", ""]
    ok = {}
    for s in ("dev", "holdout"):
        z = T[T.set == s]
        out.append(f"{s} ({'BTC+ETH 2018-2022, already read: not evidence' if s == 'dev' else '15 unused coins 2022-2026'}):")
        for k in STOP:
            nd, mv = z[z.is_node].dropna(subset=[k]), z[~z.is_node].dropna(subset=[k])
            lo_n, hi_n = VR.boot_mean(nd[k], nd.day.astype(str))
            dlo, dhi = VR.boot_diff(nd[k], nd.day.astype(str), mv[k], mv.day.astype(str))
            out.append(f"  {k}: nodes n {len(nd):5d}  win {np.mean(nd[k] > 0):.1%}  avg R {nd[k].mean():+.3f} [{lo_n:+.3f}, {hi_n:+.3f}];  "
                       f"moved n {len(mv):6d}  win {np.mean(mv[k] > 0):.1%}  avg R {mv[k].mean():+.3f};  "
                       f"node minus moved {nd[k].mean() - mv[k].mean():+.3f} [{dlo:+.3f}, {dhi:+.3f}]")
            ok[(s, k)] = (lo_n, dlo)
        out.append("")
    lo_n, dlo = ok[("holdout", "N1")]
    out.append(f"Decision (N1 on the holdout: node minus moved > 0 and node R > 0): "
               f"{'TRADABLE' if lo_n > 0 and dlo > 0 else 'not tradable' + (' (beats moved nodes, but loses after costs)' if dlo > 0 else '')}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
