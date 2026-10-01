"""Gatekeeper for the stage-4 pooled read P-1 (loop/CRITERIA.md, stage 4). The iterating agent does not run this.

For each frozen rule: all post-2022 holdout tiers (val, final, reserve, majors; 69 coins, 2023-01 to 2026-08), trades
deduplicated across tiers, edge = R - control, standard error from a week-clustered bootstrap, t = edge / SE.
Stage 4 passes at t >= 3.0 and edge >= 0.10R. stdout carries verdicts only; details go to loop/sealed/P-1_pool.json.
"""
import importlib, json, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
import engine as E  # noqa: E402

TIERS = ("val", "final", "reserve", "majors")
RULES = {"D-1": "family_d", "G-2": "family_g", "F-1": "family_f", "F-2": "family_f", "C-6": "family_c", "B1": None}
T_MIN, SESOI = 3.0, 0.10


def b1_fn(d1, d4):
    import ronnie_bt as RB
    lo, sh = RB.signals(d4, RB.features(d4))
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    out = []
    for i in np.flatnonzero((lo | sh).values):
        if i + 1 >= len(c):
            continue
        side = 1 if lo.values[i] else -1
        stop = l[i] if side == 1 else h[i]
        entry = o[i + 1]
        if (entry - stop) * side <= 0:
            continue
        out.append((i + 1, side, entry, stop, c[i] + side * 2 * abs(c[i] - stop)))
    return out


def trades(rule):
    if rule == "B1":
        fn, tf, hold, ts = b1_fn, "4h", 30, None
    else:
        fam = importlib.import_module(RULES[rule])
        cfg = fam.LOOPS[rule]
        fn, _ = fam.make(cfg)
        tf, hold, ts = cfg["tf"], cfg["hold"], cfg.get("ts")
    z = E.run(f"P-1 {rule}", fn, tf, hold, TIERS, ts=ts)
    return z.dropna(subset=["R", "control"]).drop_duplicates(["coin", "time", "side"])


def week_se(z, reps=4000, seed=13):
    x = (z.R - z.control).values
    w = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    keys, inv = np.unique(w, return_inverse=True)
    s, n = np.bincount(inv, x), np.bincount(inv)
    idx = np.random.default_rng(seed).integers(0, len(keys), (reps, len(keys)))
    m = s[idx].sum(1) / n[idx].sum(1)
    return float(m.std()), float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5)), len(keys)


def main():
    sealed = {}
    for rule in RULES:
        z = trades(rule)
        if len(z) < 5:
            print(f"P-1 {rule}: too few trades")
            continue
        e = float((z.R - z.control).mean())
        se, lo, hi, weeks = week_se(z)
        t = e / se if se > 0 else np.nan
        if t >= T_MIN and e >= SESOI:
            v = "stage 4 PASS"
        elif lo > 0:
            v = "stage 4 FAIL (interval above zero, t below 3 or edge below SESOI)"
        elif e > 0:
            v = "stage 4 FAIL (edge positive, interval spans zero)"
        else:
            v = "stage 4 FAIL (edge at or below zero)"
        print(f"P-1 {rule}: {v}")
        sealed[rule] = dict(n=len(z), coins=int(z.coin.nunique()), weeks=weeks, edge=e, se=se, t=t, lo=lo, hi=hi,
                            per_tier={k: [int(len(g)), float((g.R - g.control).mean())] for k, g in z.groupby("set")},
                            per_year={str(k): float(v) for k, v in (z.R - z.control).groupby(pd.to_datetime(z.time).dt.year).mean().items()},
                            verdict=v)
        E.log("P-1", rule, "pooled", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), v == "stage 4 PASS", "sealed; stage-4 pooled read")
    json.dump(sealed, open(os.path.join(HERE, "sealed", "P-1_pool.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
