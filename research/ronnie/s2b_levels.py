"""S2b entries with exits placed on drawn levels: do lines help as a map for targets and stops?

Declared before the run. Entries are ronnie_bt's S2b signals at their defaults (body >= 1.5 ATR, close in the outer 25%
of the bar, beyond the 20-bar high or low; no Bollinger filter), filled at the next 4h open. Every signal is scored on
its own (no one-position limit), so all variants share the same entries and differ only in the exit:
  T0  target 2R, stop at the signal bar's far end (ronnie_bt's default)
  T1  target at the first 4h zone edge at least 1R beyond entry, else 2R
  T2  the same with daily zones
  T3  the same with resonance zones (daily zones overlapping a weekly zone)
  S1  stop 0.25 ATR beyond the nearest 4h zone behind entry when it lies within 3 ATR, else the signal bar; target 2R
Zones are ronnie_plan.build_zones at the default map, known at the signal bar's close. 30-bar time exit; stop first when
both are touched; cost 0.06% per side (ronnie_bt). Markets and periods: BTC in-sample 2017-2022 and out-of-sample
2023-2026 (read once); ETH and nine FX majors in both periods, as replication. Reported per variant: avgR and its
paired difference from T0 over the same entries, with a 95% bootstrap interval.
"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "filters"))
import ronnie_bt as B  # noqa: E402
import run as R  # noqa: E402
from tv_effect import DEFAULT, zone_schedule  # noqa: E402
from tv_mtf import overlap, weekly  # noqa: E402

PERIODS = {"in-sample 2017-2022": ("2017-01-01", "2023-01-01"), "out-of-sample 2023-2026": ("2023-01-01", "2027-01-01")}
VARIANTS = ("T0", "T1", "T2", "T3", "S1")
HOLD, COST = 30, B.COST
RNG = np.random.default_rng(9)


def first_edge(zones, side, entry, min_dist):
    """Nearest zone edge beyond entry by at least min_dist in the trade's direction, or None."""
    if side == 1:
        e = [z.lo for z in zones if z.lo >= entry + min_dist]
        return min(e) if e else None
    e = [z.hi for z in zones if z.hi <= entry - min_dist]
    return max(e) if e else None


def trade(o, h, l, c, i, side, stop, tp):
    """Entry at bar i's open; returns R net of cost or None when the stop is on the wrong side."""
    e = o[i]
    risk = (e - stop) * side
    if risk <= 0:
        return None
    for j in range(i, min(i + HOLD + 1, len(c))):
        if side == 1 and l[j] <= stop or side == -1 and h[j] >= stop:
            px = min(o[j], stop) if side == 1 else max(o[j], stop)
            break
        if side == 1 and h[j] >= tp or side == -1 and l[j] <= tp:
            px = tp
            break
    else:
        px = c[min(i + HOLD, len(c) - 1)]
    return (side * (px - e) - (e + px) * COST) / risk


def market_rows(name, d4, d1):
    M = R.Market(name, d4, d1)
    t4 = d4.index.as_unit("s").asi8 + 4 * 3600
    D = zone_schedule(d1, d1.index.as_unit("s").asi8 + 86400, t4, DEFAULT)
    f = B.features(d4)
    lo, sh = B.signals(d4, f)
    o, h, l, c = d4.open.values, d4.high.values, d4.low.values, d4.close.values
    atr = f["atr"].values
    rows = []
    for s_idx in np.flatnonzero((lo | sh).values):
        i = s_idx + 1  # entry bar
        if i + HOLD >= len(c) or np.isnan(atr[s_idx]):
            continue
        side = 1 if lo.values[s_idx] else -1
        e = o[i]
        stop0 = l[s_idx] if side == 1 else h[s_idx]
        risk0 = (e - stop0) * side
        if risk0 <= 0:
            continue
        tp0 = e + side * 2 * risk0
        r = dict(market=name, entry_time=d4.index[i])
        r["T0"] = trade(o, h, l, c, i, side, stop0, tp0)
        for key, zones in (("T1", M.z4[s_idx]), ("T2", D[s_idx]), ("T3", M.res[s_idx])):
            edge = first_edge(zones, side, e, risk0)
            r[key] = trade(o, h, l, c, i, side, stop0, edge if edge is not None else tp0)
            r[f"{key}_on_level"] = edge is not None
        behind = [z for z in M.z4[s_idx] if (z.hi < e if side == 1 else z.lo > e)]
        s1 = stop0
        if behind:
            z = max(behind, key=lambda z: z.hi) if side == 1 else min(behind, key=lambda z: z.lo)
            cand = (z.lo - 0.25 * atr[s_idx]) if side == 1 else (z.hi + 0.25 * atr[s_idx])
            if abs(e - cand) <= 3 * atr[s_idx]:
                s1 = cand
        r["S1"] = trade(o, h, l, c, i, side, s1, e + side * 2 * abs(e - s1))
        rows.append(r)
    return rows


def ci(v):
    v = np.asarray(v, float)
    v = v[~np.isnan(v)]
    if len(v) < 3:
        return f"{np.nanmean(v) if len(v) else np.nan:+.3f} (n={len(v)})"
    b = RNG.choice(v, size=(2000, len(v))).mean(1)
    return f"{v.mean():+.3f} [{np.percentile(b, 2.5):+.2f},{np.percentile(b, 97.5):+.2f}]"


def main():
    rows = []
    for name, d4, d1 in R.markets():
        rows += market_rows(name, d4, d1)
        print(f"{name}: {sum(r['market'] == name for r in rows)} S2b entries", flush=True)
    df = pd.DataFrame(rows)
    df.to_csv(f"{HERE}/results/s2b_levels.csv", index=False)
    out = []
    for scope, mask in (("BTC", df.market == "BTCUSD"), ("ETH + 9 FX (replication)", df.market != "BTCUSD")):
        for pname, (a, b) in PERIODS.items():
            z = df[mask & (df.entry_time >= pd.Timestamp(a, tz="UTC")) & (df.entry_time < pd.Timestamp(b, tz="UTC"))]
            z = z.dropna(subset=list(VARIANTS))
            out.append(f"{scope}, {pname}: {len(z)} entries")
            for v in VARIANTS:
                extra = f"  (target on a level in {z[f'{v}_on_level'].mean():.0%})" if f"{v}_on_level" in z else ""
                diff = "" if v == "T0" else f"  minus T0 {ci(z[v] - z['T0'])}"
                out.append(f"  {v}  avgR {ci(z[v])}{diff}{extra}")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/results/s2b_levels.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
