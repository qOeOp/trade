"""Loop C-6u: C-6 on never-used coins from the point-in-time universe, 2018-2022. Writes loop/out/C-6u_iteration.csv.gz."""
import csv, datetime, gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_c as FC  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
STABLE = ("USDC", "BUSD", "TUSD", "PAX", "USDP", "DAI", "FDUSD", "USDS", "SUSD", "EUR", "GBP", "AUD", "TRY", "BRL", "RUB",
          "BIDR", "IDRT", "NGN", "UAH", "ZAR", "BKRW", "VAI", "UST", "USTC", "AEUR", "EURI", "XUSD", "USD1")
LEVER = ("UP", "DOWN", "BULL", "BEAR")
MIN_QV = 5e6


def coins(U):
    used = set(E.ITER_COINS) | set(E.ITER_EXT_COINS)
    out = []
    for s in U.symbol.unique():
        base = s[:-4]
        if base in used or base in STABLE or any(base.endswith(x) and len(base) > len(x) for x in LEVER):
            continue
        out.append(s)
    return out


def main():
    U = pd.read_csv(os.path.join(HERE, ".cache", "universe_1d.csv.gz"), parse_dates=["time"])
    U = U[U.time < T1 + pd.Timedelta(days=30)]
    fn_cfg = FC.LOOPS["C-6"]
    rows = []
    for k, sym in enumerate(coins(U)):
        g = U[U.symbol == sym].set_index("time").sort_index()
        if len(g) < 260 or g.index[0] >= T1:
            continue
        d = g.rename(columns={"quote_volume": "volume"})[["open", "high", "low", "close", "volume"]].astype(float)
        E.CURRENT["coin"] = sym[:-4]
        fn, _ = FC.make(fn_cfg)
        sigs = fn(d, None)
        qv = d.volume.rolling(30).median().shift(1).values
        sigs = [s for s in sigs if qv[s[0] - 1] >= MIN_QV]
        if not sigs:
            continue
        scored = E.score(sym[:-4], "1d", "C-6u", d, sigs, fn_cfg["hold"], seed=k)
        rows += [dict(r, set="univ") for r in scored if T0 <= r["time"] < T1]
    z = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(os.path.join(HERE, "out", "C-6u_iteration.csv.gz"), "wb", mtime=0) as f:
        f.write(z.to_csv(index=False).encode())
    lo, hi = E.boot(z)
    wlo, whi = attrib.week_boot(z)
    t = pd.to_datetime(z.time)
    weeks = t.dt.tz_convert(None).dt.to_period("W").nunique()
    e = (z.R - z.control).mean()
    print(f"C-6u: {len(z)} trades on {z.coin.nunique()} coins in {weeks} weeks; avg R {z.R.mean():+.3f}, edge {e:+.3f} "
          f"[{lo:+.3f}, {hi:+.3f}] coin-clustered, [{wlo:+.3f}, {whi:+.3f}] week-clustered")
    print("by year: " + ", ".join(f"{y} {v:+.2f} ({n})" for y, (v, n) in
                                  (z.R - z.control).groupby(t.dt.year).agg(["mean", "count"]).iterrows()))
    passed = bool(e >= 0.2 and wlo > 0)
    E.log("C-6u", "familyC", "iteration", dict(n=len(z), edge=e, lo=wlo, hi=whi), passed,
          "never-used universe coins 2018-2022; week-clustered interval")


if __name__ == "__main__":
    main()
