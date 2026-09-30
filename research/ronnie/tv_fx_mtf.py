"""Replicate tv_mtf's cross-timeframe confluence on the FX majors, same rules and parameters as on BTC.

FXCM public hourly bid candles 2017-2026 (candledata.fxcorporate.com, weekly files), resampled to 4h and UTC-day bars.
Costs are the BTC model's (maker/taker fees and an 8-hourly funding charge), a rough stand-in for FX spread and swap.
Both periods are reported: in-sample 2017-2022 and out-of-sample 2023-2026; nothing here was tuned on FX.
"""
import gzip, io, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tv_hourly  # noqa: E402
import tv_mtf  # noqa: E402

PAIRS = ("EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "GBPJPY", "EURAUD")
PERIODS = (("in-sample 2017-2022", ("2017-01-01", "2023-01-01")), ("out-of-sample 2023-2026", ("2023-01-01", "2027-01-01")))
AGG = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}


def hourly(pair):
    t0 = int(pd.Timestamp("2016-10-01").value // 10**9)
    t1 = int(pd.Timestamp("2026-09-30").value // 10**9)
    d = tv_hourly.fxcm(pair, t0, t1).drop_duplicates("time").sort_values("time")
    d.index = pd.to_datetime(d.time, unit="s", utc=True)
    d["volume"] = 1.0
    return d[["open", "high", "low", "close", "volume"]]


def main():
    out = []
    for pair in PAIRS:
        h = hourly(pair)
        d4 = h.resample("4h", label="left", closed="left").agg(AGG).dropna()
        d1 = h.resample("1D", label="left", closed="left").agg(AGG).dropna()
        d4, d1 = d4[d4.index >= "2017-01-01"], d1[d1.index >= "2016-10-01"]
        print(f"{pair}: {len(h)} hourly bars {h.index[0]:%Y-%m-%d}..{h.index[-1]:%Y-%m-%d}", flush=True)
        out.append(tv_mtf.main(d4, d1, label=pair, periods=PERIODS, out_name=f"tv_fx_mtf_{pair}.txt"))
    open(f"{HERE}/results/tv_fx_mtf.txt", "w").write("\n\n".join(out) + "\n")


if __name__ == "__main__":
    main()
