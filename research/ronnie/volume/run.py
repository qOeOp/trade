"""TrialFamily volume-v1: volume-profile nodes (A), swing levels judged by volume (B), break volume (C). See INTENT.md.

Writes volume/levels.csv.gz, volume/breaks.csv.gz and volume/result.txt.
"""
import importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
import harness as H  # noqa: E402
from tv_effect import react  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MT = _load("mtf_run", "mtf/run.py")  # level_book, atr_of
TR = _load("timing_run", "timing/run.py")  # lines_by_bar

WIN_D, BIN, HVN_Q, LVN_Q, NEAR_MIN, NEAR_MAX = 30, 0.1, 0.8, 0.2, 0.5, 5.0
N_MOVED, HORIZON, HI_RV, LO_RV = 20, 240, 1.5, 1.0
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
HOLD = (pd.Timestamp("2022-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
HOLDOUT = ("AUDIO", "ALICE", "KNC", "STX", "AR", "ROSE", "RSR", "SFP", "CAKE", "TWT", "JST", "SUN", "DYDX", "GALA", "FLOW",
           "SUPER", "C98", "MASK", "DODO", "BEL")  # the INTENT list minus ATA, LINA, ALPHA (no 2026-08 archive)


def profile(h, l, v, lo, hi, width):
    """Volume per price bin on [lo, hi): each bar's volume spread evenly over its range."""
    edges = np.arange(lo, hi + width, width)
    prof = np.zeros(len(edges) - 1)
    for a, b, vol in zip(l, h, v):
        i0, i1 = int((a - lo) // width), int((b - lo) // width)
        i0, i1 = max(i0, 0), min(i1, len(prof) - 1)
        if i1 >= i0 and vol > 0:
            prof[i0:i1 + 1] += vol / (i1 - i0 + 1)
    sm = np.convolve(prof, np.ones(3) / 3, mode="same")
    return edges[:-1] + width / 2, sm


def levels_and_nodes(bars, t0, t1, rng):
    h1 = bars["1h"]
    d1 = bars["1d"]
    t1h = h1.index
    o, h, l, c, v = (h1[x].values.astype(float) for x in ("open", "high", "low", "close", "volume"))
    d4 = bars["4h"]
    a4 = MT.atr_of(d4.high.values, d4.low.values, d4.close.values)
    k4 = d4.index.searchsorted(t1h, side="right") - 1
    atr4 = np.r_[np.nan, a4[:-1]][np.maximum(k4, 0)]  # ATR of the last closed 4h bar
    B = dict(o=o, h=h, l=l, c=c, atr=atr4)
    book = MT.level_book(d1[["open", "high", "low", "close"]], MT.D_K, False)
    rows = []
    for D in range(WIN_D + 20, len(d1)):
        day = d1.index[D]
        if not t0 <= day < t1:
            continue
        i0 = int(t1h.searchsorted(day)) - 1  # last 1h bar closed before the day opens
        if i0 < 500 or i0 + HORIZON >= len(c):
            continue
        ad, a = book[D][4], atr4[i0]
        if not (ad > 0 and a > 0):
            continue
        s = int(t1h.searchsorted(d1.index[D - WIN_D]))
        px = o[i0 + 1]
        mids, prof = profile(h[s:i0 + 1], l[s:i0 + 1], v[s:i0 + 1], px - 8 * ad, px + 8 * ad, BIN * ad)
        near = (np.abs(mids - px) <= NEAR_MAX * ad)
        if prof[near].sum() <= 0:
            continue
        hq, lq = np.quantile(prof[prof > 0], [HVN_Q, LVN_Q])
        peak = np.r_[False, (prof[1:-1] >= prof[:-2]) & (prof[1:-1] >= prof[2:]), False]
        trough = np.r_[False, (prof[1:-1] <= prof[:-2]) & (prof[1:-1] <= prof[2:]), False]
        dist = np.abs(mids - px)
        band = (dist >= NEAR_MIN * ad) & (dist <= NEAR_MAX * ad)
        cand = []
        for kind, m in (("HVN", peak & (prof >= hq) & band), ("LVN", trough & (prof <= lq) & band)):
            for sgn in (1, -1):
                q = np.flatnonzero(m & (np.sign(mids - px) == sgn))
                if len(q):
                    cand.append((kind, mids[q[np.argmin(dist[q])]]))
        Y = book[D][0]
        ranks = pd.Series(prof[near]).rank(pct=True).values
        nm = mids[near]
        for sgn in (1, -1):
            ys = Y[(np.sign(Y - px) == sgn) & (np.abs(Y - px) <= NEAR_MAX * ad)]
            if len(ys):
                y = ys[np.argmin(np.abs(ys - px))]
                r = ranks[np.argmin(np.abs(nm - y))]
                cand.append(("backed" if r >= 2 / 3 else "hollow" if r <= 1 / 3 else "middle", y))
        for kind, y in cand:
            x = react(B, i0, y, HORIZON)
            mv = [react(B, i0, y + rng.uniform(1, 4) * a * rng.choice((-1, 1)), HORIZON) for _ in range(N_MOVED)]
            mv = [z for z in mv if z is not None]
            rows.append(dict(day=day, kind=kind, y=y, held=x, moved=np.mean(mv) if mv else np.nan))
    return rows


def breaks(bars, t0, t1, seed):
    d4 = bars["4h"]
    h, l, c, v = (d4[x].values.astype(float) for x in ("high", "low", "close", "volume"))
    lines = TR.lines_by_bar(h, l, c)
    rv = v / pd.Series(v).shift(1).rolling(20).mean().values
    close_t = d4.index + pd.Timedelta(hours=4)
    fired, seen, sigs, rvs = set(), set(), [], {}
    for i in range(300, len(c) - 31):
        for lid, side, y in lines[i]:
            if lid in fired or (c[i] - y) * side <= 0:
                continue
            fired.add(lid)
            if (i, side) in seen or not t0 <= close_t[i] < t1:
                continue
            seen.add((i, side))
            stop = l[i] if side == 1 else h[i]
            if (c[i] - stop) * side <= 0:
                continue
            sigs.append(H.Signal(close_t[i], side, stop, c[i] + side * 2 * (c[i] - stop) * side, 30))
            rvs[(close_t[i], side)] = rv[i]
    df = H.score(bars, sigs, seed=seed)
    if df.empty:
        return df
    df["rv"] = [rvs[(t, s)] for t, s in zip(df.time, df.side)]
    return df


def boot_mean(v, groups, level=95, seed=3, reps=4000):
    """Group (day or coin) bootstrap interval of the mean of v."""
    rng = np.random.default_rng(seed)
    gs = [x for _, x in pd.Series(v).groupby(groups)]
    gs = [g.values for g in gs]
    b = [np.concatenate([gs[k] for k in rng.integers(0, len(gs), len(gs))]).mean() for _ in range(reps)]
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def boot_diff(a_val, a_grp, b_val, b_grp, level=95, seed=4, reps=4000):
    rng = np.random.default_rng(seed)
    ga = {k: g.values for k, g in pd.Series(a_val).groupby(a_grp)}
    gb = {k: g.values for k, g in pd.Series(b_val).groupby(b_grp)}
    keys = sorted(set(ga) | set(gb))
    out = []
    for _ in range(reps):
        pick = [keys[k] for k in rng.integers(0, len(keys), len(keys))]
        xa = np.concatenate([ga[k] for k in pick if k in ga] or [np.array([np.nan])])
        xb = np.concatenate([gb[k] for k in pick if k in gb] or [np.array([np.nan])])
        out.append(np.nanmean(xa) - np.nanmean(xb))
    q = (100 - level) / 2
    return np.nanpercentile(out, q), np.nanpercentile(out, 100 - q)


def main():
    from evaluate import holdout_bars
    rng = np.random.default_rng(29)
    lv, br = [], []
    sets = [(n, "dev", H.load(n), DEV) for n in ("BTCUSD", "ETHUSDT")]
    for n, name_set, bars, (t0, t1) in sets + [(c, "holdout", None, HOLD) for c in HOLDOUT]:
        bars = bars if bars is not None else holdout_bars(n)
        lv += [dict(r, market=n, set=name_set) for r in levels_and_nodes(bars, t0, t1, rng)]
        b = breaks(bars, t0, t1, seed=len(br) + 1)
        if not b.empty:
            br.append(b.assign(market=n, set=name_set))
        print(f"{n}: {sum(r['market'] == n for r in lv)} levels, {len(b)} breaks", flush=True)
    L = pd.DataFrame(lv).dropna(subset=["held", "moved"])
    Bk = pd.concat(br, ignore_index=True).dropna(subset=["R", "control", "rv"])
    L.to_csv(os.path.join(HERE, "levels.csv.gz"), index=False, float_format="%.6g")
    Bk.to_csv(os.path.join(HERE, "breaks.csv.gz"), index=False, float_format="%.6g")
    L["held"] = L.held.astype(float)
    L["diff"] = L.held - L.moved
    L["g"] = L.market + L.day.astype(str)
    Bk["edge"] = Bk.R - Bk.control
    out = ["volume-v1 (INTENT.md): volume-profile nodes, volume-backed swing levels, break volume", ""]
    ok = {}
    for s in ("dev", "holdout"):
        z = L[L.set == s]
        out.append(f"{s} ({'BTC+ETH 2018-2022' if s == 'dev' else '20 unused coins 2022-2026'}):")
        for kind in ("HVN", "LVN", "backed", "middle", "hollow"):
            k = z[z.kind == kind]
            lo, hi = boot_mean(k["diff"], k.g)
            out.append(f"  {kind:<7} resolved {len(k):5d}  held {k.held.mean():.1%}  moved {k.moved.mean():.1%}  "
                       f"held minus moved {k['diff'].mean():+.1%} [{lo:+.1%}, {hi:+.1%}]")
            ok[(s, kind)] = lo
        h_, l_ = z[z.kind == "HVN"], z[z.kind == "LVN"]
        dlo, dhi = boot_diff(h_.held, h_.day.astype(str), l_.held, l_.day.astype(str))
        out.append(f"  HVN minus LVN held {h_.held.mean() - l_.held.mean():+.1%} [{dlo:+.1%}, {dhi:+.1%}]")
        ok[(s, "HVN-LVN")] = dlo
        b_, w_ = z[z.kind == "backed"], z[z.kind == "hollow"]
        blo, bhi = boot_diff(b_.held, b_.day.astype(str), w_.held, w_.day.astype(str))
        out.append(f"  backed minus hollow held {b_.held.mean() - w_.held.mean():+.1%} [{blo:+.1%}, {bhi:+.1%}]")
        ok[(s, "B")] = blo
        zb = Bk[Bk.set == s]
        grp = zb.market if s == "holdout" else zb.time.dt.strftime("%Y-%m")
        hi_m, lo_m = zb.rv >= HI_RV, zb.rv < LO_RV
        for name, m in (("high volume (>= 1.5x)", hi_m), ("middle", ~hi_m & ~lo_m), ("low volume (< 1x)", lo_m)):
            k = zb[m]
            a, b = boot_mean(k.edge, grp[m])
            out.append(f"  breaks {name:<22} n {len(k):5d}  avg R {k.R.mean():+.3f}  edge {k.edge.mean():+.3f} [{a:+.3f}, {b:+.3f}]")
            if name.startswith("high"):
                ok[(s, "C-high")] = a
        clo, chi = boot_diff(zb.edge[hi_m], grp[hi_m], zb.edge[lo_m], grp[lo_m])
        out.append(f"  breaks high minus low volume edge {zb.edge[hi_m].mean() - zb.edge[lo_m].mean():+.3f} [{clo:+.3f}, {chi:+.3f}]")
        ok[(s, "C")] = clo
        out.append("")
    both = lambda *keys: all(ok[(s, k)] > 0 for s in ("dev", "holdout") for k in keys)  # noqa: E731
    out.append(f"Decision: A (HVN hold and beat LVN) {'HOLDS' if both('HVN', 'HVN-LVN') else 'fails'}; "
               f"B (backed beat hollow) {'HOLDS' if both('B') else 'fails'}; "
               f"C (high-volume breaks beat low-volume) {'HOLDS' if both('C', 'C-high') else 'fails'}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
