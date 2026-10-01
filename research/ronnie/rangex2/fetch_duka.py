"""Background download of Dukascopy hourly bars for gold, Brent and silver, 2018-01 to 2026-08, into the tv/.cache
used by tv_hourly (Dukascopy allows about one request a minute, so this takes hours; re-runs resume from the cache)."""
import os, sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tv_hourly  # noqa: E402

INSTRUMENTS = ("XAUUSD", "BRENTCMDUSD", "XAGUSD")


def main():
    t0, t1 = int(pd.Timestamp("2018-01-01").value // 10**9), int(pd.Timestamp("2026-09-01").value // 10**9)
    months = list(tv_hourly.months(t0, t1))
    for k, m in enumerate(months):
        for inst in INSTRUMENTS:  # interleaved so every instrument advances together
            tv_hourly.get(f"https://datafeed.dukascopy.com/datafeed/{inst}/{m.year}/{m.month - 1:02d}/BID_candles_hour_1.bi5")
        print(f"{m:%Y-%m} done ({k + 1}/{len(months)})", flush=True)


if __name__ == "__main__":
    main()
