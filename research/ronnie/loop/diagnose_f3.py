"""Loop F-3: line-quality attribution of F-2 trades (span, slope, age, pivot gap, break body)."""
import csv, datetime, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "combo", "candidates"))
import attrib  # noqa: E402
import engine as E  # noqa: E402
import trendline_break_strong as TL  # noqa: E402


def line_feats(d4):
    o, h, l, c = (d4[x].values.astype(float) for x in ("open", "high", "low", "close"))
    a = np.r_[np.nan, TL._atr(h, l, c)[:-1]]
    k = TL.PIVOT_K
    ph, pl = TL._pivots(h, l, k)
    rows = {}
    for side, piv, px in ((1, ph, h), (-1, pl, l)):
        p, conf, dead = 0, [], set()
        for i in range(1, len(c)):
            while p < len(piv) and piv[p] + k <= i:
                conf.append(piv[p])
                p += 1
            if len(conf) < 2:
                continue
            j1, j2 = conf[-2], conf[-1]
            if (j1, j2) in dead or j2 - j1 < TL.MIN_SPAN or i - j2 > TL.MAX_EXT:
                continue
            if side == 1 and not px[j2] < px[j1] or side == -1 and not px[j2] > px[j1]:
                continue
            sl = (px[j2] - px[j1]) / (j2 - j1)
            if (c[i] - (px[j2] + sl * (i - j2))) * side > 0:
                dead.add((j1, j2))
                t = d4.index[i] + pd.Timedelta(hours=4)
                rows[(t, side)] = dict(span=j2 - j1, slope=abs(sl) / a[i], age=i - j2, gap=abs(px[j2] - px[j1]) / a[i],
                                       body=abs(c[i] - o[i]) / a[i])
    return rows


def main():
    z = pd.read_csv(os.path.join(HERE, "out", "F-2_iteration.csv.gz"), parse_dates=["time"]).dropna(subset=["R", "control"])
    z = z.sort_values("coin", kind="stable").reset_index(drop=True)
    F = []
    for coin, g in z.groupby("coin", sort=True):
        lf = line_feats(E.bars(coin)["4h"])
        F += [lf.get((t, s), {}) for t, s in zip(g.time, g.side)]
    z = pd.concat([z, pd.DataFrame(F)], axis=1)
    feats = ["span", "slope", "age", "gap", "body"]
    print(f"matched {z.span.notna().sum()} of {len(z)}")
    t, ev = attrib.report(z.dropna(subset=["span"]), feats, "F-3 line quality (F-2 iteration trades)")
    print(t)
    rel = bool(ev.reliable.any())
    with open(os.path.join(HERE, "census.csv"), "a", newline="") as f:
        csv.writer(f, lineterminator="\n").writerow([datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                                                     "F-3", "trendline", "diagnosis", int(z.span.notna().sum()), "", "", "",
                                                     rel, "line-quality attribution: span, slope, age, gap, body"])


if __name__ == "__main__":
    main()
