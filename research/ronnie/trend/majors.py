"""Descriptive: trend-v1's T0 and its line variants on the 17 major coins over 2018-2026, per coin and per period.

Not a test: these coins were development data. Writes trend/majors.txt.
"""
import importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("trend_run", os.path.join(HERE, "run.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)


def main():
    rng = np.random.default_rng(61)
    rows = []
    for coin in T.DEV_COINS:
        rows += T.trend_trades(coin, T.daily(coin), pd.Timestamp("2018-01-01", tz="UTC"), T.HOLD[1], rng)
    z = pd.DataFrame(rows)
    z["period"] = np.where(z.time < pd.Timestamp("2023-01-01", tz="UTC"), "2018-2022", "2023-2026")
    out = ["trend-v1 T0 on the 17 majors, 2018-01 to 2026-08 (descriptive; development coins)", "",
           "coin    trades  win   avg R   sum R   minus control   2018-22 avg R  2023-26 avg R   long avg R  short avg R"]
    for coin, g in z.groupby("coin", sort=False):
        a, b = (g[g.period == p].R.mean() for p in ("2018-2022", "2023-2026"))
        out.append(f"{coin:<7} {len(g):5d}  {np.mean(g.R > 0):.0%}  {g.R.mean():+6.2f}  {g.R.sum():+6.1f}   {(g.R - g.control).mean():+6.2f}"
                   f"          {a:+6.2f}         {b:+6.2f}        {g[g.side == 1].R.mean():+6.2f}      {g[g.side == -1].R.mean():+6.2f}")
    out.append("")
    for p, g in z.groupby("period"):
        lo, hi = T.boot(g.R - g.control, g.coin)
        out.append(f"{p}: {len(g)} trades, avg R {g.R.mean():+.3f}, minus control {(g.R - g.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]; "
                   f"variants minus T0: retest {(g.E - g.R).mean():+.3f}, structure stop {(g.S - g.R).mean():+.3f}, "
                   f"weekly target {(g.X - g.R).mean():+.3f}; weekly filter kept {g[g.weekly_ok].R.mean():+.3f} vs dropped "
                   f"{g[~g.weekly_ok].R.mean():+.3f}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "majors.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
