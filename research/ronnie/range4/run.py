"""TrialFamily range-v4: range-v3 X1 (4h box breakout) replicated unchanged on 37 large caps, 2023-2026. See INTENT.md.

Writes range4/events.csv.gz and range4/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("range3_run", os.path.join(ROOT, "range3", "run.py"))
R3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R3)
R2 = R3.R2

MAJORS = R2.COINS
LARGE = ("NEAR", "UNI", "AAVE", "ICP", "APT", "ARB", "SUI", "OP", "INJ", "TIA", "SEI", "PEPE", "SHIB", "HBAR", "ALGO",
         "FET", "WLD", "IMX", "STX", "LDO")
T0, T1 = pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC")


def main():
    from evaluate import holdout_bars
    rng = np.random.default_rng(41)
    rows = []
    for group, coins in (("majors", MAJORS), ("large caps", LARGE)):
        for coin in coins:
            d = holdout_bars(coin)["4h"][["open", "high", "low", "close"]]
            top, bot, a = R2.boxes(d)
            rows += [dict(r, group=group) for r in R2.score(coin, "4h", "X1", d, R3.x1(d, top, bot, a), a, rng)
                     if T0 <= r["time"] < T1]
            print(f"{coin}: {sum(r['coin'] == coin for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    ev["edge"] = ev.R - ev.control
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    out = ["range-v4: 4h box breakout (range-v3 X1, unchanged) on 37 large caps, 2023-01 to 2026-08; avg R net of 0.06%/side",
           "set                 n     win   avgR    control  minus control [95% coin-then-signal]"]

    def line(label, z, boot=True):
        lo, hi = R2.coin_boot(z) if boot and z.coin.nunique() > 1 else (np.nan, np.nan)
        out.append(f"{label:<18} {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                   f"{z.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
        return lo

    lo = line("all 37", ev)
    for g, z in ev.groupby("group"):
        line(g, z)
    for coin in ("BTC", "ETH", "SOL"):
        z = ev[ev.coin == coin]
        a, b = R2.simple_ci(z.edge) if hasattr(R2, "simple_ci") else (np.nan, np.nan)
        out.append(f"{coin:<18} {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   {z.edge.mean():+.3f}")
    out.append("by year (all 37): " + ", ".join(f"{y} {g.edge.mean():+.3f} (n {len(g)})" for y, g in ev.groupby(ev.time.dt.year)))
    pos = ev.groupby("coin").edge.mean()
    out.append(f"coins with edge above zero: {int((pos > 0).sum())} of {len(pos)}")
    out.append(f"decision: {'HOLDS' if lo > 0 else 'fails'} (all 37, interval above zero)")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
