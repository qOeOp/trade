"""Decay diagnosis D-R: regime shift against within-regime decay, 2018-2022 vs 2023-2026, on open trade sets.
Writes loop/decay_diagnosis.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import engine as E  # noqa: E402

SPLIT = pd.Timestamp("2023-01-01", tz="UTC")


def btc_regimes():
    c = E.bars("BTC")["1d"].close
    r = c.pct_change()
    vol = r.rolling(30).std() * np.sqrt(365)
    er = (c - c.shift(60)).abs() / c.diff().abs().rolling(60).sum()
    R = pd.DataFrame({"vol": vol, "er": er}).shift(1)  # known at the open of each day
    dev = R[(R.index >= "2018-01-01") & (R.index < SPLIT)]
    for k in ("vol", "er"):
        q = dev[k].quantile([1 / 3, 2 / 3]).values
        R[k + "_t"] = np.select([R[k] <= q[0], R[k] <= q[1]], ["low", "mid"], "high")
        R.loc[R[k].isna(), k + "_t"] = np.nan
    return R


def load():
    a = pd.read_csv(os.path.join(ROOT, "combo", "holdout_events.csv.gz"), parse_dates=["time"])
    a = a[a.candidate == "trendline_break_strong"][["coin", "time", "R", "control"]].assign(rule="F-1 trendline")
    b = pd.read_csv(os.path.join(ROOT, "altcoins", "events.csv.gz"), parse_dates=["entry_time"]).rename(columns={"entry_time": "time"})
    b = b[["coin", "time", "R", "control"]].assign(rule="B1 momentum")
    c = pd.read_csv(os.path.join(ROOT, "trend", "trades.csv.gz"), parse_dates=["time"])[["coin", "time", "R", "control"]].assign(rule="T0 daily trend")
    z = pd.concat([a, b, c]).dropna(subset=["R", "control"])
    z["time"] = pd.to_datetime(z.time, utc=True)
    return z[z.time >= pd.Timestamp("2018-01-01", tz="UTC")]


def boot_decay(z, cells, reps=2000, seed=21):
    """Within-regime decay: OLS of edge on post + cell dummies; week-clustered bootstrap of the post coefficient."""
    y = (z.R - z.control).values
    X = np.column_stack([np.ones(len(z)), (z.time >= SPLIT).astype(float).values] +
                        [(z.cell == k).astype(float).values for k in cells[1:]])
    w = z.time.dt.tz_convert(None).dt.to_period("W").astype(str).values
    keys, inv = np.unique(w, return_inverse=True)
    groups = [np.flatnonzero(inv == g) for g in range(len(keys))]
    beta = np.linalg.lstsq(X, y, rcond=None)[0][1]
    rng, bs = np.random.default_rng(seed), []
    for _ in range(reps):
        idx = np.concatenate([groups[g] for g in rng.integers(0, len(groups), len(groups))])
        bs.append(np.linalg.lstsq(X[idx], y[idx], rcond=None)[0][1])
    return beta, np.percentile(bs, 2.5), np.percentile(bs, 97.5)


def main():
    R = btc_regimes()
    z = load()
    day = z.time.dt.tz_convert(None).dt.normalize()
    idx = R.index.tz_convert(None) if R.index.tz is not None else R.index
    Rn = R.set_axis(idx)
    z["vol_t"] = Rn.vol_t.reindex(day).values
    z["er_t"] = Rn.er_t.reindex(day).values
    z = z.dropna(subset=["vol_t", "er_t"])
    z["cell"] = z.vol_t + " vol / " + z.er_t + " trend"
    z["edge"] = z.R - z.control
    lines = ["Decay diagnosis D-R (BTC regimes at entry; terciles fixed on 2018-2022)", ""]
    share = {}
    for rule, g in z.groupby("rule"):
        pre, post = g[g.time < SPLIT], g[g.time >= SPLIT]
        cells = sorted(g.cell.unique())
        e_pre, e_post = pre.edge.mean(), post.edge.mean()
        cell_pre = pre.groupby("cell").edge.mean()
        sh_post = post.cell.value_counts(normalize=True)
        expected = float(sum(sh_post.get(k, 0) * cell_pre.get(k, e_pre) for k in sh_post.index))
        beta, lo, hi = boot_decay(g, cells)
        lines += [f"{rule}: 2018-22 edge {e_pre:+.3f} (n {len(pre)}), 2023-26 edge {e_post:+.3f} (n {len(post)})",
                  f"  regime shift (expected 2023-26 from 2018-22 cell edges minus 2018-22 edge): {expected - e_pre:+.3f}",
                  f"  within-regime decay (actual minus expected): {e_post - expected:+.3f}; regression post coefficient "
                  f"{beta:+.3f} [{lo:+.3f}, {hi:+.3f}] week-clustered",
                  "  edge by trend regime, 2018-22 / 2023-26: " + ", ".join(
                      f"{t} {pre[pre.er_t == t].edge.mean():+.2f} / {post[post.er_t == t].edge.mean():+.2f}" for t in ("low", "mid", "high")),
                  "  edge by volatility regime, 2018-22 / 2023-26: " + ", ".join(
                      f"{t} {pre[pre.vol_t == t].edge.mean():+.2f} / {post[post.vol_t == t].edge.mean():+.2f}" for t in ("low", "mid", "high")),
                  ""]
    days = Rn.dropna(subset=["vol_t"])
    for lab, m in (("2018-22", (days.index >= "2018-01-01") & (days.index < "2023-01-01")), ("2023-26", days.index >= "2023-01-01")):
        d = days[m]
        lines.append(f"BTC regime shares {lab}: trend " + ", ".join(f"{t} {(d.er_t == t).mean():.0%}" for t in ("low", "mid", "high"))
                     + "; volatility " + ", ".join(f"{t} {(d.vol_t == t).mean():.0%}" for t in ("low", "mid", "high")))
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "decay_diagnosis.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
