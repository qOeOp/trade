"""How good does the best cell of tv_mtf_grid look by chance? Each cell's real in-sample trades are replaced by random
entries matched on side, count per year, stop and target (s6_confluence.random_control); the best cell is taken per
draw. Cells are drawn independently, which overstates the chance maximum when cells share trades, so a real best
below this null is decisive and one above it is not."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import s6_confirm as S  # noqa: E402
import s6_confluence as s6  # noqa: E402
from ronnie_plan import features, load  # noqa: E402
from tv_effect import zone_schedule  # noqa: E402
from tv_mtf import in_sample, overlap, weekly  # noqa: E402

RUNS = 100


def main():
    d4, d1 = load()
    F = features(d4, d1)
    t4 = d4.index.as_unit("s").asi8 + 4 * 3600
    w1 = weekly(d1)
    ct1, ctw = d1.index.as_unit("s").asi8 + 86400, w1.index.as_unit("s").asi8 + 7 * 86400
    real, null = [], []
    for kz in (2, 3, 5):
        for per in (3, 6, 12):
            prm = (kz, per, 0.5, 2, "wick")
            D = zone_schedule(d1, ct1, t4, prm)
            W = zone_schedule(w1, ctw, t4, prm)
            R = [overlap(a, b) for a, b in zip(D, W)]
            for kl in (3, 5):
                for sc in (D, R):
                    x = in_sample(S.run_confirm(F, "confluence", k=kl, zone_sched=sc))
                    if len(x) < 3:
                        continue
                    real.append(x.R.mean())
                    null.append(np.asarray(s6.random_control(F, x, runs=RUNS, seed=len(real))))
    null = np.array(null)  # cells x runs
    best_null = null.max(axis=0)
    out = [f"{len(real)} grid cells; best real in-sample avgR {max(real):+.3f}; median cell {np.median(real):+.3f}",
           f"best cell under random entries: median {np.median(best_null):+.3f}, 95th percentile {np.percentile(best_null, 95):+.3f}; "
           f"share of draws whose best cell >= the real best: {np.mean(best_null >= max(real)):.2f}",
           f"cells above +0.3R by chance per draw: median {np.median((null > 0.3).sum(0)):.0f} of {len(real)}; real: {sum(r > 0.3 for r in real)}"]
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/results/tv_grid_null.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
