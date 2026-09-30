"""Cross-timeframe confluence on BTC: daily/weekly zones meeting a 4h trend line, in-sample 2017-2022 only.

Same confirmed entry as s6_confirm (a 4h bar touches the level and closes back, enter at the next open; stop beyond
the bar and the level; target the next zone, at least 2R), every parameter at its declared default; only the source of
the zones changes. Zones come from ronnie_plan.build_zones (k=3, 6 reactions per side) on 4h, daily or weekly bars,
known only once their bar has closed. "Resonance" keeps the daily zones that overlap a weekly zone.
Controls: 200 runs of random entries matched on side, count per year, stop and target (s6_confluence.random_control), and 30 runs with every zone
displaced 2-6 ATR. The 2023+ out-of-sample set is not read.
"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import s6_confirm as S  # noqa: E402
import s6_confluence as s6  # noqa: E402
from ronnie_plan import features, load  # noqa: E402
from tv_effect import DEFAULT, zone_schedule  # noqa: E402

IS = ("2017-01-01", "2023-01-01")


def weekly(d1):
    w = d1.resample("W-MON", label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}).dropna()
    return w[w.volume > 0]


def overlap(a, b):
    return [z for z in a if any(z.lo <= w.hi and w.lo <= z.hi for w in b)]


def in_sample(tr):
    return tr[(tr.entry_time >= IS[0]) & (tr.entry_time < IS[1])] if len(tr) else tr


def main():
    d4, d1 = load()
    F = features(d4, d1)
    t4 = d4.index.as_unit("s").asi8 + 4 * 3600
    w1 = weekly(d1)
    srcs = {"4h": (d4, t4), "daily": (d1, d1.index.as_unit("s").asi8 + 86400),
            "weekly": (w1, w1.index.as_unit("s").asi8 + 7 * 86400)}

    def sched(name, rng=None):
        if name == "resonance":
            d, w = sched("daily", rng), sched("weekly", rng)
            return [overlap(a, b) for a, b in zip(d, w)]
        d, ct = srcs[name]
        return zone_schedule(d, ct, t4, DEFAULT, rng)

    variants = [("4h zone x 4h line (S6)", "4h", "confluence"), ("daily zone x 4h line", "daily", "confluence"),
                ("weekly zone x 4h line", "weekly", "confluence"), ("resonance zone x 4h line", "resonance", "confluence"),
                ("resonance zone alone", "resonance", "zone_only"), ("4h line alone", "4h", "line_only")]
    out = ["Cross-timeframe confluence, BTC 4h confirmed entries, in-sample 2017-2022 (R net of fees and funding)"]
    for name, src, mode in variants:
        tr = S.run_confirm(F, mode, k=3, zone_sched=sched(src))
        x = in_sample(tr)
        if x.empty:
            out.append(f"  {name:<28} no trades")
            continue
        rc = np.asarray(s6.random_control(F, x))
        line = (f"  {name:<28} n={len(x):4d}  win {np.mean(x.R > 0):.0%}  avgR {x.R.mean():+.3f}  | random entries median "
                f"{np.median(rc):+.3f}, share >= real {np.mean(rc >= x.R.mean()):.2f}")
        if mode != "line_only":
            pz = []
            for s_ in range(30):
                y = in_sample(S.run_confirm(F, mode, k=3, zone_sched=sched(src, np.random.default_rng(300 + s_))))
                pz.append(y.R.mean() if len(y) else np.nan)
            pz = np.array(pz)
            pz = pz[~np.isnan(pz)]
            line += f" | displaced zones median {np.median(pz):+.3f}, share >= real {np.mean(pz >= x.R.mean()):.2f}"
        out.append(line)
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/results/tv_mtf.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
