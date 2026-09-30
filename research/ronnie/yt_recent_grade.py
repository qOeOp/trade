"""Grade Ronnie's recent (2024-2026) BTC title forecasts against Bitstamp prices.

yt/recent/calls.jsonl comes from titles, thumbnails and community posts (no spoken content could be fetched: YouTube
refuses anonymous player and transcript requests, and his Bilibili space lists no public videos; see routes.json).
Only rows with call_type "forecast" and a long/short direction are graded, one per title, from midday UTC of the
publish date (the hour is unknown), at 3, 7 and 14 days; horizons that end after the last bar are skipped.
"""
import json, os
from math import comb

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    seen, calls = set(), []
    for line in open(f"{HERE}/yt/recent/calls.jsonl"):
        r = json.loads(line)
        if r["call_type"] == "forecast" and r["direction"] in ("long", "short") and r["title"] not in seen:
            seen.add(r["title"])
            calls.append(r)
    c = pd.read_csv(f"{HERE}/btc_1h.csv", index_col=0, parse_dates=True).close
    px = lambda t: c.iloc[c.index.searchsorted(t)]  # noqa: E731
    out = [f"{len(calls)} directional title forecasts, {sum(r['direction'] == 'long' for r in calls)} long"]
    for h in (3, 7, 14):
        rs = []
        for r in calls:
            t0 = pd.Timestamp(r["publish_date"], tz="UTC") + pd.Timedelta(hours=12)
            if t0 + pd.Timedelta(days=h) > c.index[-1]:
                continue
            s = 1 if r["direction"] == "long" else -1
            rs.append(s * (px(t0 + pd.Timedelta(days=h)) / px(t0) - 1))
        rs = np.array(rs)
        k, n = int((rs > 0).sum()), len(rs)
        p = sum(comb(n, j) for j in range(k, n + 1)) / 2**n
        out.append(f"  {h:>2} days: right {k}/{n} ({k / n:.0%}), mean {rs.mean():+.2%}, one-sided binomial p vs 50% {p:.2f}")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/results/yt_recent_grade.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
