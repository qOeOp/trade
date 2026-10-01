"""carry-v1 final read: K1 and K0 on the R&D loop's final tier, unchanged (see the INTENT amendment).
Writes carry/final.txt.
"""
import importlib.util, os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("carry_run", os.path.join(HERE, "run.py"))
C = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(C)
C.PERP.update({"BONK": "1000BONKUSDT", "FLOKI": "1000FLOKIUSDT"})
COINS = ("TON", "RENDER", "JUP", "ENA", "BONK", "WIF", "FLOKI", "PYTH", "ORDI", "CFX", "TAO", "STRK")


def main():
    data = {}
    for coin in COINS:
        d = C.coin_daily(coin)
        if d is not None:
            data[coin] = d
        print(f"{coin}: {0 if d is None else len(d)} days", flush=True)
    H = pd.DataFrame({c: d.hedge for c, d in data.items()})
    H = H[(H.index >= pd.Timestamp("2023-01-01")) & (H.index < pd.Timestamp("2026-09-01"))]
    k0 = H.mean(axis=1)
    K1 = pd.DataFrame({c: C.k1_path(d) for c, d in data.items()}).reindex(H.index)
    k1 = K1.mean(axis=1).fillna(0.0)
    wk1 = k1.resample("W-MON").sum()
    lo, hi = C.week_boot(wk1)
    ok = lo > 0 and k1.mean() > k0.mean()
    yr = pd.DataFrame({"K0": k0, "K1": k1})
    out = [f"carry-v1 final read ({len(data)} coins with data, {H.index[0].date()} to {H.index[-1].date()}):",
           f"  K0 always on: {k0.mean() * 365:+.1%} a year",
           f"  K1 conditional: {k1.mean() * 365:+.1%} a year [{lo * 52:+.1%}, {hi * 52:+.1%}], held {K1.notna().mean().mean():.0%} of coin-days, "
           f"worst week {wk1.min():+.2%}",
           "  per year: " + ", ".join(f"{y} K0 {g.K0.sum():+.1%} K1 {g.K1.sum():+.1%}" for y, g in yr.groupby(yr.index.year)),
           f"decision: K1 on the final tier {'HOLDS' if ok else 'fails'}"]
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "final.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
