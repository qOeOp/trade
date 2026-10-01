"""Gatekeeper for the R-1 stage-2 read (loop/LOG.md). The iterating agent does not run this.
R-1 (loop/family_r.py) frozen, on the 69 post-2022 holdout coins, 2023-01 to 2026-08; three-level verdict at 95%,
week-clustered. stdout carries the verdict only; details go to loop/sealed/R-1_holdout.json."""
import json, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_p as FP  # noqa: E402
import family_r as FR  # noqa: E402

COINS = E.VAL_COINS + E.FINAL_COINS + E.RESERVE_COINS + E.ITER_COINS
V0, V1 = E.VAL


def main():
    rows = []
    for k, coin in enumerate(dict.fromkeys(COINS)):
        try:
            d = E.bars(coin)["1d"]
        except Exception as ex:
            print(f"R-1 holdout: data missing for one coin ({type(ex).__name__})")
            continue
        sig, _ = FR.signals(d)
        a = E.MT.atr_of(d.high.values, d.low.values, d.close.values)
        for x in FP.score_all(coin, d[["open", "high", "low", "close"]], sig["R-1"], FR.HOLD, k, a):
            if V0 <= x["time"] < V1:
                rows.append(x)
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    x = (z.R - z.control).values
    w = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    keys, inv = np.unique(w, return_inverse=True)
    s, n = np.bincount(inv, x), np.bincount(inv)
    idx = np.random.default_rng(29).integers(0, len(keys), (4000, len(keys)))
    m = s[idx].sum(1) / n[idx].sum(1)
    lo, hi = np.percentile(m, [2.5, 97.5])
    e = float(x.mean())
    v = "PASS" if lo > 0 else ("FAIL (edge positive, interval spans zero)" if e > 0 else "FAIL (edge at or below zero)")
    print(f"R-1 holdout: {v} at 95%")
    json.dump(dict(loop="R-1", stage="holdout", n=len(z), coins=int(z.coin.nunique()), weeks=len(keys), edge=e,
                   lo=float(lo), hi=float(hi), meets_sesoi=bool(lo > 0 and e >= 0.10),
                   per_year={str(k_): float(v_) for k_, v_ in (z.R - z.control).groupby(pd.to_datetime(z.time).dt.year).mean().items()},
                   per_side={str(k_): float(v_) for k_, v_ in (z.R - z.control).groupby(z.side).mean().items()}, verdict=v),
              open(os.path.join(HERE, "sealed", "R-1_holdout.json"), "w"), indent=1)
    E.log("R-1", "familyR", "holdout", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), lo > 0, "sealed; stage-2 read")


if __name__ == "__main__":
    main()
