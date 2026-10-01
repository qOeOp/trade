"""Forward record of the B3 trend book (loop T-1/T-2: an ensemble of nine Donchian lookbacks with a midpoint trailing
stop, volatility-targeted) on the 17 majors, a universe fixed on 2026-10-01 (so no survivorship going forward).
Records only: no orders, no exchange account.

Usage: python trend/forward_b3.py         append the target weights decided at the last closed UTC day to
                                          trend/forward/b3_weights.csv (once per day; the commit is the timestamp proof)
       python trend/forward_b3.py score   book return from the logged weights (earned the next day), 0.1% a side

Weights: exposure (the share of the nine sub-models long) x 25% / 90-day realised volatility / 17, gross at most 1.
"""
import csv, os, sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
from books import COST, TARGET, states  # noqa: E402
from tv_prices import fetch  # noqa: E402

COINS = ("BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "LTC", "TRX", "LINK", "DOT", "AVAX", "BCH", "ETC", "XLM", "ATOM", "FIL")
START = pd.Timestamp("2026-10-01", tz="UTC")
OUT = os.path.join(HERE, "forward", "b3_weights.csv")


def daily(coin, now):
    for _ in range(4):
        try:
            b, _err = fetch(f"BINANCE:{coin}USDT", "1D", 500)
            if b:
                break
        except Exception:
            b = []
    d = pd.DataFrame([(t, *v) for t, v in b], columns=["time", "open", "high", "low", "close"])
    d.index = pd.to_datetime(d.time, unit="s", utc=True)
    return d[d.index < now.floor("1D")]  # closed days only


def log(now):
    rows, day = [], None
    for coin in COINS:
        d = daily(coin, now)
        if len(d) < 400:
            continue
        c = d.close.values
        x = states(c)["B3"][-1]
        vol = pd.Series(c).pct_change().rolling(90).std().iloc[-1] * np.sqrt(365)
        rows.append(dict(coin=coin, exposure=x, vol=vol, w=min(1.0, x * TARGET / vol / len(COINS))))
        day = d.index[-1]
    if day is None or day < START:
        print("nothing to log")
        return
    gross = sum(r["w"] for r in rows)
    seen = set()
    if os.path.exists(OUT):
        seen = {r["day"] for r in csv.DictReader(open(OUT))}
    if str(day.date()) in seen:
        print(f"{day.date()} already logged")
        return
    new = not os.path.exists(OUT)
    with open(OUT, "a", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        if new:
            w.writerow(["logged_at", "day", "coin", "exposure", "vol90", "weight"])
        for r in rows:
            w.writerow([now.isoformat(timespec="seconds"), day.date(), r["coin"], f"{r['exposure']:.4f}", f"{r['vol']:.4f}",
                        f"{r['w'] / max(gross, 1.0):.5f}"])
    print(f"{day.date()}: gross {min(gross, 1.0):.3f}; long exposure in " + ", ".join(f"{r['coin']} {r['exposure']:.2f}" for r in rows if r["exposure"] > 0))


def score(now):
    W = pd.read_csv(OUT, parse_dates=["day"]).pivot_table(index="day", columns="coin", values="weight")
    R = pd.DataFrame({c: daily(c, now).close.pct_change() for c in W.columns})
    R.index = R.index.tz_localize(None).normalize()
    W.index = W.index + pd.Timedelta(days=1)  # decided at the day's close, earned the next day
    W = W.reindex(R.index).dropna(how="all")
    pr = (W * R.reindex(W.index)).sum(axis=1) - COST * W.diff().abs().sum(axis=1).fillna(W.abs().sum(axis=1))
    print(f"B3 forward: {len(pr)} days, cumulative {((1 + pr).prod() - 1):+.2%}, average gross {W.sum(axis=1).mean():.3f}")


if __name__ == "__main__":
    now = pd.Timestamp(datetime.now(timezone.utc))
    score(now) if len(sys.argv) > 1 and sys.argv[1] == "score" else log(now)
