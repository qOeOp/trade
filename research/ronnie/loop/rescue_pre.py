"""Rescues of pre-loop closures (loop/CRITERIA.md): R-1 patterns-v2 F-raw on new coins (4h), R-2 oversold O1 on new
coins (daily). Usage: python loop/rescue_pre.py R-1|R-2"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import c6_universe as CU  # noqa: E402
import engine as E  # noqa: E402


def _load(name, rel):
    s = importlib.util.spec_from_file_location(name, os.path.join(E.ROOT, rel))
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


def flag_fn(d1, d4):
    P2 = _load("patterns2_run", "patterns2/run.py")
    sig, a = P2.signals(d4[["open", "high", "low", "close", "volume"]], False)
    o = d4.open.values
    out = []
    for i, side, stop, tgt in sig["F-raw"]:
        e = i + 1
        if e >= len(o):
            continue
        entry = o[e]
        risk = (entry - stop) * side
        if risk <= 0 or (tgt - entry) * side < risk or risk > P2.MAX_STOP * a[i]:
            continue
        out.append((e, side, entry, stop, tgt))
    return out


def crash_sigs(d):
    OS = _load("oversold_run", "oversold/run.py")
    sig, _ = OS.signals(d)
    return sig["O1"]


def report(k, z, note):
    lo, hi = attrib.week_boot(z)
    e = float((z.R - z.control).mean())
    weeks = pd.to_datetime(z.time, utc=True).dt.tz_convert(None).dt.to_period("W").nunique()
    st = "active" if lo > 0 and e >= 0.10 else ("closed (equivalent-null)" if hi < 0.10 else "parked (inconclusive)")
    print(f"{k} {note}: {len(z)} trades, {z.coin.nunique()} coins, {weeks} weeks; edge {e:+.3f} [{lo:+.3f}, {hi:+.3f}] "
          f"week-clustered -> {st}")
    return e, lo, hi, st


def main():
    k = sys.argv[1]
    if k == "R-1":
        z = E.run(k, flag_fn, "4h", 30, ("iterx",))
        z = z[~z.coin.isin(["BTC", "ETH"])].dropna(subset=["R", "control"])
        e, lo, hi, st = report(k, z, "F-raw on 51 new coins 2018-2022")
    else:
        z1 = E.run(k, lambda d1, d4: crash_sigs(d1), "1d", 10, ("iterx",))
        z1 = z1[z1.coin.isin(E.ITER_EXT_COINS)]
        U = pd.read_csv(os.path.join(HERE, ".cache", "universe_1d.csv.gz"), parse_dates=["time"])
        U = U[U.time < CU.T1 + pd.Timedelta(days=30)]
        rows = []
        for j, sym in enumerate(CU.coins(U)):
            g = U[U.symbol == sym].set_index("time").sort_index()
            if len(g) < 260 or g.index[0] >= CU.T1:
                continue
            d = g.rename(columns={"quote_volume": "volume"})[["open", "high", "low", "close", "volume"]].astype(float)
            qv = d.volume.rolling(30).median().shift(1).values
            sigs = [s for s in crash_sigs(d) if qv[s[0] - 1] >= CU.MIN_QV]
            if sigs:
                rows += [r for r in E.score(sym[:-4], "1d", k, d, sigs, 10, seed=j) if CU.T0 <= r["time"] < CU.T1]
        z2 = pd.DataFrame(rows)
        z = pd.concat([z1, z2]).dropna(subset=["R", "control"])
        report(k, z1.dropna(subset=["R", "control"]), "O1 on the 36 extended coins")
        report(k, z2.dropna(subset=["R", "control"]), "O1 on never-used universe coins")
        e, lo, hi, st = report(k, z, "O1 pooled")
    with gzip.GzipFile(os.path.join(HERE, "out", f"{k}_iteration.csv.gz"), "wb", mtime=0) as f:
        f.write(z.to_csv(index=False).encode())
    E.log(k, "rescue", "iteration", dict(n=len(z), edge=e, lo=lo, hi=hi), st == "active", f"pre-loop rescue; {st}")


if __name__ == "__main__":
    main()
