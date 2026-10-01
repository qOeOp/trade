"""V-1: edge by the coin's own volatility at entry, before and after 2022, with the post-2022 high-minus-rest interaction.
Writes loop/coin_vol_bucket.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import decay_diagnosis as DR  # noqa: E402


def coin_vol():
    U = pd.read_csv(os.path.join(HERE, ".cache", "universe_1d.csv.gz"), usecols=["symbol", "time", "close"], parse_dates=["time"])
    U["coin"] = U.symbol.str[:-4]
    U = U.sort_values(["coin", "time"])
    U["vol"] = U.groupby("coin").close.transform(lambda s: s.pct_change().rolling(30).std().shift(1) * np.sqrt(365))
    U["day"] = U.time.dt.tz_convert(None).dt.normalize()
    return U.set_index(["coin", "day"]).vol


def boot(a, b, reps=4000, seed=23):
    """Week-clustered bootstrap of mean(a) - mean(b)."""
    rng = np.random.default_rng(seed)
    def prep(z):
        w = z.time.dt.tz_convert(None).dt.to_period("W").astype(str).values
        k, inv = np.unique(w, return_inverse=True)
        return np.bincount(inv, z.edge.values), np.bincount(inv), len(k)
    (sa, na, ka), (sb, nb, kb) = prep(a), prep(b)
    d = []
    for _ in range(reps):
        i, j = rng.integers(0, ka, ka), rng.integers(0, kb, kb)
        d.append(sa[i].sum() / na[i].sum() - sb[j].sum() / nb[j].sum())
    d = np.array(d)
    return d.mean(), np.percentile(d, 2.5), np.percentile(d, 97.5), (d <= 0).mean()


def main():
    z = DR.load()
    z["edge"] = z.R - z.control
    V = coin_vol()
    day = z.time.dt.tz_convert(None).dt.normalize()
    z["cvol"] = [V.get((c, d), np.nan) for c, d in zip(z.coin, day)]
    lines = [f"V-1: matched coin volatility for {z.cvol.notna().sum()} of {len(z)} trades", ""]
    z = z.dropna(subset=["cvol"])
    ps = []
    for rule, g in z.groupby("rule"):
        pre = g[g.time < DR.SPLIT]
        q = pre.cvol.quantile([1 / 3, 2 / 3]).values
        g = g.assign(t=np.select([g.cvol <= q[0], g.cvol <= q[1]], ["low", "mid"], "high"))
        pre, post = g[g.time < DR.SPLIT], g[g.time >= DR.SPLIT]
        row = ", ".join(f"{t} {pre[pre.t == t].edge.mean():+.2f} ({(pre.t == t).sum()}) / {post[post.t == t].edge.mean():+.2f} ({(post.t == t).sum()})"
                        for t in ("low", "mid", "high"))
        e, lo, hi, p = boot(post[post.t == "high"], post[post.t != "high"])
        ps.append(p)
        lines += [f"{rule}: edge by coin-volatility tercile, 2018-22 / 2023-26 (n): {row}",
                  f"  post-2022 high minus rest: {e:+.3f} [{lo:+.3f}, {hi:+.3f}], one-sided p {p:.3f}", ""]
    m = len(ps)
    holm = [min(1.0, max((m - j) * sorted(ps)[j] for j in range(k + 1))) for k in range(m)]
    lines.append("Holm-adjusted p (sorted): " + ", ".join(f"{h:.3f}" for h in holm))
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "coin_vol_bucket.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
