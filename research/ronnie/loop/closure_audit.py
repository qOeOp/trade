"""Closure audit: every iteration loop's edge with a week-clustered 95% interval, its minimum detectable edge at 80%
power, and its status against a smallest effect of interest (SESOI). See loop/CRITERIA.md. Writes loop/closure_audit.txt."""
import glob, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402

SESOI = 0.10  # R per trade over matched random entries (loop/CRITERIA.md)


def status(e, lo, hi):
    if lo > 0 and e >= SESOI:
        return "positive"
    if hi < 0:
        return "harmful"
    if hi < SESOI:
        return "equivalent-null"
    if lo > 0:
        return "positive-below-SESOI"
    return "inconclusive"


def main():
    rows = []
    for p in sorted(glob.glob(os.path.join(HERE, "out", "*_iteration.csv.gz"))):
        k = os.path.basename(p).split("_")[0]
        if k.startswith("H-"):
            continue  # pairs: edge is a return, not R; audited separately
        z = pd.read_csv(p).dropna(subset=["R", "control"])
        if len(z) < 5:
            continue
        lo, hi = attrib.week_boot(z)
        e = float((z.R - z.control).mean())
        weeks = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").nunique()
        mde = (hi - lo) / 3.92 * 2.8
        rows.append(dict(loop=k, n=len(z), weeks=weeks, edge=e, lo=lo, hi=hi, mde80=mde, status=status(e, lo, hi)))
    T = pd.DataFrame(rows)
    T["fam"] = T.loop.str[0]
    t = (f"Closure audit, SESOI {SESOI:+.2f}R, week-clustered 95% intervals\n\n" + T.round(3).to_string(index=False)
         + "\n\nstatus counts: " + ", ".join(f"{k} {v}" for k, v in T.status.value_counts().items()))
    print(t)
    open(os.path.join(HERE, "closure_audit.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
