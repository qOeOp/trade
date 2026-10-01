"""Bucket audit (loop/LOG.md): edges of closed and parked variants by asset bucket and market context, with
week-clustered bootstrap p-values and Holm across all cells. Writes loop/bucket_audit.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402

FILES = ("A8x", "A11", "A12", "B-5x", "B-9", "B-10", "C-8", "E-1x", "E-4", "E-5", "G-1", "R-1", "R-2")
SESOI = 0.10


def boot(z, reps=4000, seed=7):
    """Week-clustered bootstrap of the mean edge -> (estimate, lo, hi, one-sided p of edge <= 0)."""
    x = (z.R - z.control).values
    w = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    keys, inv = np.unique(w, return_inverse=True)
    s, n = np.bincount(inv, x), np.bincount(inv)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(keys), (reps, len(keys)))
    m = s[idx].sum(1) / n[idx].sum(1)
    return x.mean(), np.percentile(m, 2.5), np.percentile(m, 97.5), (m <= 0).mean()


def buckets(z):
    out = {}
    out["major"] = z.coin.isin(E.ITER_COINS)
    out["mid"] = z.coin.isin(E.ITER_EXT_COINS)
    out["small"] = ~(out["major"] | out["mid"])
    if "btc_trend" in z:
        out["bull"] = z.btc_trend > 0
        out["bear"] = z.btc_trend <= 0
    if "vol_ratio" in z:
        out["high vol"] = z.vol_ratio > 1
        out["low vol"] = z.vol_ratio <= 1
    return out


def main():
    rows = []
    for k in FILES:
        z = pd.read_csv(os.path.join(HERE, "out", f"{k}_iteration.csv.gz")).dropna(subset=["R", "control"])
        for b, m in buckets(z).items():
            a = z[m]
            if len(a) < 20 or a.R.count() == len(z):
                continue
            e, lo, hi, p = boot(a)
            rows.append(dict(variant=k, bucket=b, n=len(a), edge=e, lo=lo, hi=hi, p=p,
                             rest=(z[~m].R - z[~m].control).mean()))
    T = pd.DataFrame(rows).sort_values("p").reset_index(drop=True)
    m = len(T)
    T["holm"] = [min(1.0, max((m - j2) * T.p.iloc[j2] for j2 in range(j + 1))) for j in range(m)]
    T["flag"] = np.where((T.holm < 0.05) & (T.edge >= SESOI), "SURVIVES HOLM",
                         np.where((T.p < 0.05) & (T.edge >= SESOI), "nominal only", ""))
    t = (f"Bucket audit: {m} cells, Holm at 5%, SESOI {SESOI}\n\n" + T.round(3).to_string(index=False))
    print(t)
    open(os.path.join(HERE, "bucket_audit.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
