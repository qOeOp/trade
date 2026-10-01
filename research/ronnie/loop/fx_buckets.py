"""Cross-asset bucket tests (loop/LOG.md, "FX bucket"): crypto-closed families on 9 FX pairs, 2017-2022 (iteration);
2023-2026 is kept for a gatekeeper read. Usage: python loop/fx_buckets.py <variant>"""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402
import family_b as FB  # noqa: E402
import tv_fx_mtf  # noqa: E402

FX_FEE = 0.0001  # per side, about one pip of spread plus commission
T0, T1 = pd.Timestamp("2017-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
VARIANTS = {
    "A3fx": (FA, dict(FA.BASE, confirm="trigger")),
    "A12fx": (FA, dict(FA.BASE, confirm="trigger", level_tf="round", round_div=200)),
    "B-9fx": (FB, dict(FB.LOOPS["B-9"], round_div=200)),
}
AGG = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}


def fx_bars(pair):
    path = os.path.join(HERE, ".cache", f"FX_{pair}.pkl")
    if os.path.exists(path):
        return pd.read_pickle(path)
    h = tv_fx_mtf.hourly(pair)
    b = {"4h": h.resample("4h", label="left", closed="left").agg(AGG).dropna(),
         "1d": h.resample("1D", label="left", closed="left").agg(AGG).dropna()}
    pd.to_pickle(b, path)
    return b


def main():
    k = sys.argv[1]
    mod, cfg = VARIANTS[k]
    rows = []
    for j, pair in enumerate(tv_fx_mtf.PAIRS):
        b = fx_bars(pair)
        E.CURRENT["coin"] = pair
        fn, _ = mod.make(cfg)
        sigs = fn(b["1d"], b["4h"])
        d = b[cfg["tf"]]
        scored = E.score(pair, cfg["tf"], k, d, sigs, cfg["hold"], fee=FX_FEE, seed=j)
        rows += [r for r in scored if T0 <= r["time"] < T1]
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(os.path.join(HERE, "out", f"{k}_iteration.csv.gz"), "wb", mtime=0) as f:
        f.write(z.to_csv(index=False).encode())
    lo, hi = attrib.week_boot(z)
    e = float((z.R - z.control).mean())
    st = "active" if lo > 0 and e >= 0.10 else ("closed (equivalent-null)" if hi < 0.10 else "parked (inconclusive)")
    print(f"{k}: {len(z)} trades on {z.coin.nunique()} pairs; avg R {z.R.mean():+.3f}, edge {e:+.3f} [{lo:+.3f}, {hi:+.3f}] "
          f"week-clustered -> {st}")
    print("  by pair: " + ", ".join(f"{c} {v:+.2f} ({n})" for c, (v, n) in (z.R - z.control).groupby(z.coin).agg(["mean", "count"]).iterrows()))
    E.log(k, "fx bucket", "iteration", dict(n=len(z), edge=e, lo=lo, hi=hi), st == "active", f"FX 2017-2022; {st}")


if __name__ == "__main__":
    main()
