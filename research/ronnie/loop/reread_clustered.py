"""Re-read the surviving candidates with a date-clustered (weekly) bootstrap next to the coin-clustered one used so far.
Iteration or development data only (no holdout is opened). Writes loop/reread_clustered.txt."""
import importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402


def load(path, **kw):
    return pd.read_csv(os.path.join(ROOT, path), parse_dates=["time"], **kw)


def sets():
    out = []
    for k, lab in (("F-1", "trend-line break"), ("F-2", "trend-line break, time exit"), ("D-1x", "4h box break, extended tier"),
                   ("G-2", "box-break retest, extended tier"), ("C-4", "capitulation 1-5 days, extended tier"),
                   ("C-6", "idiosyncratic capitulation, extended tier"), ("D-1", "4h box break (majors)")):
        out.append((f"{k} {lab}", load(f"loop/out/{k}_iteration.csv.gz")))
    t = load("trend/trades.csv.gz")
    out.append(("T0 daily trend, development (17 majors 2018-2022)", t[t.set == "dev"]))
    out.append(("T0 daily trend, holdout (20 coins 2023-2026)", t[t.set == "holdout"]))
    o = load("oversold/events.csv.gz")
    out.append(("O3 capitulation, development", o[(o.variant == "O3") & (o.set == "dev")]))
    r4 = load("range4/events.csv.gz")
    out.append(("X1 box break, 37 large caps 2023-2026 (range-v4)", r4))
    return out


def main():
    lines = ["Coin-clustered vs date-clustered (weekly) 95% intervals of the edge (R - control); development/iteration data", "",
             f"{'set':<56} {'n':>5} {'edge':>7}   {'coin-clustered':<18} {'week-clustered':<18} weeks  verdict(week)"]
    for name, z in sets():
        z = z.dropna(subset=["R", "control"])
        lo_c, hi_c = E.boot(z)
        lo_w, hi_w = attrib.week_boot(z)
        nw = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").nunique()
        lines.append(f"{name:<56} {len(z):5d} {(z.R - z.control).mean():+.3f}   [{lo_c:+.3f}, {hi_c:+.3f}]   [{lo_w:+.3f}, {hi_w:+.3f}]   "
                     f"{nw:4d}  {'above zero' if lo_w > 0 else 'spans zero'}")
    text = "\n".join(lines)
    print(text)
    open(os.path.join(HERE, "reread_clustered.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
