"""Rebuild the BTC bars every script here reads (Bitstamp BTC/USD 1-minute, github.com/ff137/bitstamp-btcusd-minute-data).

Run from this directory: python fetch_data.py  ->  btc1m.csv.gz, btc1m_latest.csv, btc_1h.csv, btc_4h.csv, btc_1d.csv
"""
import urllib.request

import pandas as pd

BASE = "https://raw.githubusercontent.com/ff137/bitstamp-btcusd-minute-data/main/data"
urllib.request.urlretrieve(f"{BASE}/historical/btcusd_bitstamp_1min_2012-2025.csv.gz", "btc1m.csv.gz")
urllib.request.urlretrieve(f"{BASE}/updates/btcusd_bitstamp_1min_latest.csv", "btc1m_latest.csv")
d = pd.concat([pd.read_csv("btc1m.csv.gz"), pd.read_csv("btc1m_latest.csv")]).drop_duplicates("timestamp").sort_values("timestamp")
d.index = pd.to_datetime(d.timestamp, unit="s", utc=True)
agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
d[d.index >= "2016-10-01"].resample("1h").agg(agg).dropna().to_csv("btc_1h.csv")
d = d[d.index >= "2017-01-01"]
for tf, name in (("4h", "btc_4h"), ("1D", "btc_1d")):
    d.resample(tf, label="left", closed="left").agg(agg).dropna().to_csv(name + ".csv")
