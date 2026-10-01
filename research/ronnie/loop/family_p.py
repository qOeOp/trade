"""Family P: the original Ronnie plan (ronnie_plan.py) on the extended iteration tier, setups scored against matched
random entries. Usage: python loop/family_p.py P-1"""
import csv, datetime, gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import ronnie_plan as RP  # noqa: E402

LOOPS = {"P-1": dict(overrides={}),
         "P-2a": dict(overrides={}, setups=("S2b", "S4", "S5")),
         "P-2b": dict(overrides={"fib_levels": (0.30, 0.45, 0.70)}, setups=("S2b", "S4", "S5"))}
T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")


def score_all(coin, d, sigs, hold, seed, a, fee=0.0006, controls=20):
    """engine.score without its target >= 1R filter (the plan's S4 targets are mostly below 1R); controls matched on
    year, side, stop in ATR and target in R, walked by the same engine (MT.walk)."""
    if not sigs:
        return []
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    e, side, entry, stop, tgt = (np.array(x) for x in zip(*sigs))
    e = e.astype(int)
    risk = (entry - stop) * side
    keep = (risk > 0) & ((tgt - entry) * side > 0) & (e + hold < len(c)) & (e > 300)
    e, side, entry, stop, tgt, risk = e[keep], side[keep], entry[keep], stop[keep], tgt[keep], risk[keep]
    if len(e) == 0:
        return []
    R = E.MT.walk(o, h, l, c, e, side, entry, stop, tgt, hold, fee)
    sa, tr = risk / a[e - 1], (tgt - entry) * side / risk
    years, idx = d.index.year.values, np.arange(len(c))
    rng = np.random.default_rng(seed)
    ce, cs, cen, cst, ctg = [], [], [], [], []
    for x, sd, s_, r_ in zip(e, side, sa, tr):
        j = rng.choice(np.flatnonzero((years == years[x]) & (idx > 300) & (idx < len(c) - hold - 2)), controls)
        rk = s_ * a[j - 1]
        ce.append(j), cs.append(np.full(controls, sd)), cen.append(o[j]), cst.append(o[j] - sd * rk), ctg.append(o[j] + sd * r_ * rk)
    ctl = np.nanmean(E.MT.walk(o, h, l, c, *(np.concatenate(v) for v in (ce, cs, cen, cst, ctg)), hold, fee).reshape(-1, controls), axis=1)
    return [dict(coin=coin, time=d.index[x], side=int(sd), R=r, control=k_, stop_atr=s_, target_R=q)
            for x, sd, r, k_, s_, q in zip(e, side, R, ctl, sa, tr)]


def run_coin(coin, k, overrides, setups=None):
    b = E.bars(coin)
    d4, d1 = b["4h"], b["1d"]
    d4, d1 = d4[d4.volume > 0], d1[d1.volume > 0]
    saved = dict(RP.P)
    RP.P.update(overrides)
    try:
        F = RP.features(d4, d1)
        _, tr = RP.simulate(F, only=setups)
        a = F["atr"]  # the plan's own ATR, from which stop_atr was computed
    finally:
        RP.P.clear()
        RP.P.update(saved)
    if tr.empty:
        return []
    rows = []
    for setup, g in tr.groupby("setup"):
        sigs = []
        for r in g.itertuples():
            e = int(r.entry_bar)
            risk = r.stop_atr * a[e] if np.isfinite(a[e]) else np.nan
            if not risk > 0:
                continue
            stop = r.avg - r.side * risk
            tgt = r.avg + r.side * r.target_R * risk
            sigs.append((e, int(r.side), float(r.avg), float(stop), float(tgt)))
        hold = int(g.max_hold.iloc[0])
        for x in score_all(coin, d4, sigs, hold, k, a):
            if T0 <= x["time"] < T1:
                rows.append(dict(x, setup=setup))
        own = g[(g.entry_time >= T0) & (g.entry_time < T1)]
        rows += [dict(coin=coin, setup=setup, own_R=v, time=t) for v, t in zip(own.R, own.entry_time)]
    return rows


def main():
    loop = sys.argv[1]
    cfg = LOOPS[loop]
    rows = []
    for k, coin in enumerate(E.ITER_COINS + E.ITER_EXT_COINS):
        rows += run_coin(coin, k, cfg["overrides"], cfg.get("setups"))
    Z = pd.DataFrame(rows)
    own = Z[Z.own_R.notna()] if "own_R" in Z else pd.DataFrame()
    z = Z[Z.R.notna() & Z.control.notna()].copy()
    with gzip.GzipFile(os.path.join(HERE, "out", f"{loop}_iteration.csv.gz"), "wb", mtime=0) as f:
        f.write(z.to_csv(index=False).encode())
    lines = [f"{loop}: the Ronnie plan, 53 coins 2018-2022; edge = engine R - 20 matched random entries; week-clustered"]
    ps = {}
    for s, g in z.groupby("setup"):
        lo, hi = attrib.week_boot(g)
        e = float((g.R - g.control).mean())
        st = "active" if lo > 0 and e >= 0.10 else ("harmful" if hi < 0 else ("equivalent-null" if hi < 0.10 else "inconclusive"))
        sides = ", ".join(f"{'long' if sd == 1 else 'short'} {(gg.R - gg.control).mean():+.2f} ({len(gg)})" for sd, gg in g.groupby("side"))
        ownR = own[own.setup == s].own_R.mean() if len(own) else np.nan
        lines.append(f"  {s}: n {len(g)}, avg R {g.R.mean():+.3f} (plan's own fill {ownR:+.3f}), edge {e:+.3f} [{lo:+.3f}, {hi:+.3f}] -> {st}; {sides}")
        E.log(f"{loop}-{s}", "familyP", "iteration", dict(n=len(g), edge=e, lo=lo, hi=hi), st == "active", "Ronnie plan setup; week-clustered")
    lines.append(f"  all setups: n {len(z)}, edge {(z.R - z.control).mean():+.3f}")
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, f"{loop.lower()}_plan.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
