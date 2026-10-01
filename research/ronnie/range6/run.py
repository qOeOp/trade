"""TrialFamily range-v6: preconditions for box fades, selected on development, read once on the holdout. See INTENT.md.

Writes range6/events.csv.gz and range6/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("range4_run", os.path.join(ROOT, "range4", "run.py"))
R4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R4)
R2, MT = R4.R2, R4.R2.MT

FEATURES = ("char90", "touches", "width", "squeeze", "speed", "volume", "htf")
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
HOLD = (pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
MIN1, MIN2, NULLS, HORIZON = 150, 100, 200, 30


def edge_tests(d, top, bot, a):
    """(test bar, resolve bar, held) for first tests of each box edge; held = middle reached before a 1 ATR close beyond."""
    h, l, c = (d[x].values for x in ("high", "low", "close"))
    seen, out = set(), []
    for i in range(R2.W + 21, len(c) - HORIZON):
        t, b, ai = top[i - 1], bot[i - 1], a[i - 1]
        if np.isnan(t):
            continue
        mid = (t + b) / 2
        for side, edge, reach in ((1, t, h[i] >= t - R2.TOUCH * ai), (-1, b, l[i] <= b + R2.TOUCH * ai)):
            key = (round(t, 10), round(b, 10), side)
            if not reach or key in seen:
                continue
            seen.add(key)
            for j in range(i, i + HORIZON):
                if (c[j] - edge) * side > ai:
                    out.append((i, j, 0))
                    break
                if (l[j] <= mid) if side == 1 else (h[j] >= mid):
                    out.append((i, j, 1))
                    break
    return np.array(out, dtype=float).reshape(-1, 3)


def market(coin, bars, tf, t0, t1, rng):
    d = bars[tf][["open", "high", "low", "close", "volume"]]
    o, h, l, c, v = (d[x].values.astype(float) for x in ("open", "high", "low", "close", "volume"))
    top, bot, a = R2.boxes(d[["open", "high", "low", "close"]])
    a100 = MT.atr_of(h, l, c, 100)
    vm = pd.Series(v).shift(1).rolling(20).mean().values
    d1 = bars["1d"]
    trend = np.sign(d1.close - d1.close.rolling(50).mean())
    trend.index = trend.index + pd.Timedelta(days=1)
    step = pd.Timedelta(hours=1 if tf == "1h" else 4)
    dtrend = trend.reindex(d.index + step, method="ffill").fillna(0).values
    tests = edge_tests(d, top, bot, a)
    bars_90 = int(pd.Timedelta(days=90) / step)
    sigs = R2.signals(d[["open", "high", "low", "close"]], top, bot, a)["C"]
    feats = {}
    for e, side, entry, stop, tgt in sigs:
        i = e - 1
        ai = a[i - 1]
        edge = bot[i] if side == 1 else top[i]
        window = (h[i - R2.W:i], l[i - R2.W:i])
        touches = R2.touches(window[1], edge, ai, False) if side == 1 else R2.touches(window[0], edge, ai, True)
        past = tests[(tests[:, 1] < i) & (tests[:, 0] >= i - bars_90)] if len(tests) else tests
        feats[(d.index[e], side)] = dict(
            char90=past[:, 2].mean() if len(past) >= 5 else np.nan,
            touches=touches, width=(top[i] - bot[i]) / ai, squeeze=ai / a100[i - 1],
            speed=((c[i - 4] - c[i - 1]) if side == 1 else (c[i - 1] - c[i - 4])) / ai,
            volume=v[i] / vm[i] if vm[i] > 0 else np.nan, htf=side * dtrend[i])
    rows = R2.score(coin, tf, "C", d[["open", "high", "low", "close"]], sigs, a, rng)
    return [dict(r, **feats[(r["time"], r["side"])]) for r in rows if t0 <= r["time"] < t1]


def select(dev, cuts, edge_col="edge"):
    """The fixed procedure: best single tercile cell (>= MIN1 events), then the best added cell of another feature."""
    cells = {}
    for f in FEATURES:
        x = dev[f]
        for k, (lo, hi) in enumerate(cuts[f]):
            m = (x >= lo) & (x <= hi) if k == 2 else (x >= lo) & (x < hi)
            cells[(f, k)] = m.values
    e = dev[edge_col].values
    best1 = max(((key, e[m].mean()) for key, m in cells.items() if m.sum() >= MIN1), key=lambda t: t[1], default=None)
    if best1 is None:
        return None, np.nan, cells
    m1 = cells[best1[0]]
    best2 = max(((key, e[m1 & m].mean()) for key, m in cells.items() if key[0] != best1[0][0] and (m1 & m).sum() >= MIN2),
                key=lambda t: t[1], default=None)
    if best2 is not None and best2[1] > best1[1]:
        return (best1[0], best2[0]), best2[1], cells
    return (best1[0],), best1[1], cells


def apply_rule(df, rule, cuts):
    m = np.ones(len(df), bool)
    for f, k in rule:
        lo, hi = cuts[f][k]
        x = df[f].values
        m &= ((x >= lo) & (x <= hi)) if k == 2 else ((x >= lo) & (x < hi))
    return m


def main():
    from evaluate import holdout_bars
    rng = np.random.default_rng(101)
    rows = []
    for coin in R4.MAJORS:
        bars = holdout_bars(coin)
        for tf in ("1h", "4h"):
            rows += [dict(r, set="dev") for r in market(coin, bars, tf, *DEV, rng)]
        print(f"{coin} dev: {sum(r['coin'] == coin for r in rows)}", flush=True)
    for coin in R4.LARGE:
        rows += [dict(r, set="holdout") for r in market(coin, holdout_bars(coin), "1h", *HOLD, rng)]
        print(f"{coin} holdout: {sum(r['coin'] == coin and r['set'] == 'holdout' for r in rows)}", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    ev["edge"] = ev.R - ev.control
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    dev, hold = ev[ev.set == "dev"].reset_index(drop=True), ev[ev.set == "holdout"].reset_index(drop=True)
    cuts = {}
    for f in FEATURES:
        q1, q2 = dev[f].quantile([1 / 3, 2 / 3])
        cuts[f] = [(-np.inf, q1), (q1, q2), (q2, np.inf)]
    out = ["range-v6: preconditions for box fades (range-v2 C), selected on development (17 majors 2018-2022, 1h+4h),",
           "read once on 1h fades of 20 large caps 2023-2026; edge = R minus matched random control", ""]
    out.append(f"development: {len(dev)} fades, edge {dev.edge.mean():+.3f}; per-cell edge (tercile 1 = lowest values):")
    for f in FEATURES:
        cells = []
        for k, (lo, hi) in enumerate(cuts[f]):
            m = apply_rule(dev, [(f, k)], cuts)
            cells.append(f"T{k + 1} {dev.edge[m].mean():+.3f} (n {m.sum()})")
        out.append(f"  {f:<8} " + "   ".join(cells) + f"   cuts {cuts[f][0][1]:.3g} / {cuts[f][1][1]:.3g}")
    rule, dev_edge, _ = select(dev, cuts)
    out.append(f"\nselected rule: {' AND '.join(f'{f} tercile {k + 1}' for f, k in rule)}; development edge {dev_edge:+.3f} "
               f"(n {apply_rule(dev, rule, cuts).sum()})")
    null = []
    shuffled = dev.copy()
    for s in range(NULLS):
        shuffled["edge"] = np.random.default_rng(s).permutation(dev.edge.values)
        null.append(select(shuffled, cuts)[1])
    pct = np.mean(np.array(null) < dev_edge)
    out.append(f"shuffle null of the whole selection ({NULLS} runs): selected edge beats {pct:.0%} of null selections "
               f"(null 95th percentile {np.nanpercentile(null, 95):+.3f})")
    lo_b, hi_b = R2.coin_boot(hold)
    out.append(f"\nholdout baseline (all 1h fades): n {len(hold)}, avg R {hold.R.mean():+.3f}, edge {hold.edge.mean():+.3f} [{lo_b:+.3f}, {hi_b:+.3f}]")
    m = apply_rule(hold, rule, cuts)
    z = hold[m]
    lo, hi = R2.coin_boot(z) if z.coin.nunique() > 1 else (np.nan, np.nan)
    out.append(f"holdout with the rule:            n {len(z)}, avg R {z.R.mean():+.3f}, edge {z.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
    ok = lo > 0 and pct > 0.95
    out.append(f"decision: {'HOLDS' if ok else 'fails'} (holdout interval above zero and selection beyond the 95th null percentile)")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
