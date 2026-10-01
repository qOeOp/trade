"""Systematic attribution for the R&D loop, in the manner of factor evaluation (workflow notes 4, 6, 17, 18).

For each feature of a trade set (edge = R - control):
- IC: Spearman rank correlation of the feature with the edge, pooled;
- per-period IC (calendar years with at least MIN_PER trades): mean, standard deviation, ICIR = mean / sd, t = ICIR *
  sqrt(periods), and the share of periods whose IC has the pooled sign;
- quintile buckets (by value; refused when the feature has fewer than 5 distinct values): mean edge and count per
  bucket, monotonicity (Spearman of bucket rank against bucket mean), and the top-minus-bottom spread with a 95%
  coin-clustered bootstrap interval;
- a reliability flag: |t| >= T_MIN, the IC sign the same in both halves of the period, and the spread interval
  excluding zero. Only flagged features may motivate a loop change (with the number of features tested reported).
`compare` re-computes IC and buckets on a second set (validation) to measure IC decay.
Also an integrity check: identical feature vectors across instruments at the same time, and tied-value features.
"""
import numpy as np
import pandas as pd

MIN_PER, T_MIN, BUCKETS = 8, 2.0, 5


def _spearman(x, y):
    m = x.notna() & y.notna()
    if m.sum() < 5 or x[m].nunique() < 2:
        return np.nan
    return x[m].rank().corr(y[m].rank())


def integrity(z, feats):
    msgs = []
    dup = z.duplicated(subset=["coin", "time", "side"]).sum()
    if dup:
        msgs.append(f"{dup} duplicated (coin, time, side) trades")
    same = z.groupby(["time", "side"]).filter(lambda g: g.coin.nunique() > 1 and len(g[feats].drop_duplicates()) < len(g))
    if len(same):
        msgs.append(f"{len(same)} trades share an identical feature vector with another coin at the same time")
    for f in feats:
        if z[f].nunique() < BUCKETS:
            msgs.append(f"{f}: only {z[f].nunique()} distinct values (no buckets)")
    return msgs


def _buckets(z, f, rng):
    q = pd.qcut(z[f], BUCKETS, labels=False, duplicates="drop")
    g = z.groupby(q).edge.agg(["mean", "count"])
    mono = pd.Series(np.arange(len(g)), dtype=float).corr(pd.Series(g["mean"].values).rank()) if len(g) > 2 else np.nan
    top, bot = q.max(), q.min()
    coins = z.coin.unique()
    by = {c: (z.edge[(z.coin == c) & (q == top)].values, z.edge[(z.coin == c) & (q == bot)].values) for c in coins}
    sp = []
    for _ in range(1000):
        pick = rng.choice(coins, len(coins))
        t = np.concatenate([by[c][0] for c in pick])
        b = np.concatenate([by[c][1] for c in pick])
        if len(t) and len(b):
            sp.append(t.mean() - b.mean())
    lo, hi = np.percentile(sp, [2.5, 97.5]) if sp else (np.nan, np.nan)
    return g, mono, g["mean"].iloc[-1] - g["mean"].iloc[0], lo, hi


def evaluate(z, feats, seed=0):
    """-> DataFrame, one row per feature."""
    z = z.assign(edge=z.R - z.control, year=pd.to_datetime(z.time).dt.year)
    rng = np.random.default_rng(seed)
    years = sorted(z.year.unique())
    half = years[len(years) // 2] if len(years) > 1 else None
    rows = []
    for f in feats:
        if z[f].nunique() < BUCKETS:
            continue
        ic = _spearman(z[f], z.edge)
        per = [(y, _spearman(g[f], g.edge)) for y, g in z.groupby("year") if len(g) >= MIN_PER]
        per = [(y, v) for y, v in per if not np.isnan(v)]
        vals = np.array([v for _, v in per])
        icir = vals.mean() / vals.std(ddof=1) if len(vals) > 2 and vals.std(ddof=1) > 0 else np.nan
        t = icir * np.sqrt(len(vals)) if not np.isnan(icir) else np.nan
        hit = np.mean(np.sign(vals) == np.sign(ic)) if len(vals) else np.nan
        a = _spearman(z[f][z.year < half], z.edge[z.year < half]) if half else np.nan
        b = _spearman(z[f][z.year >= half], z.edge[z.year >= half]) if half else np.nan
        g, mono, spread, lo, hi = _buckets(z, f, rng)
        reliable = bool(abs(t) >= T_MIN and np.sign(a) == np.sign(b) == np.sign(ic) and (lo > 0 or hi < 0)) if not np.isnan(t) else False
        rows.append(dict(feature=f, n=int(z[f].notna().sum()), ic=ic, ic_first=a, ic_second=b, periods=len(vals),
                         ic_mean=vals.mean() if len(vals) else np.nan, icir=icir, t=t, hit=hit, mono=mono, spread=spread,
                         spread_lo=lo, spread_hi=hi, reliable=reliable,
                         buckets=" ".join(f"{m:+.2f}({int(n)})" for m, n in zip(g["mean"], g["count"]))))
    return pd.DataFrame(rows)


def report(z, feats, title="attribution"):
    ev = evaluate(z, feats)
    lines = [f"{title}: {len(z)} trades, {len(ev)} features tested (flag: |t| >= {T_MIN}, IC sign stable across halves, "
             f"top-minus-bottom interval excludes zero)"]
    for m in integrity(z, feats):
        lines.append(f"  integrity: {m}")
    lines.append("  feature       IC     IC 1st/2nd   yrs  ICIR    t     hit   mono  Q1..Q5 edge (n)                         Q5-Q1 [95%]")
    for r in ev.itertuples():
        lines.append(f"  {r.feature:<11} {r.ic:+.3f}  {r.ic_first:+.2f}/{r.ic_second:+.2f}   {r.periods:2d}  {r.icir:+5.2f}  {r.t:+5.2f}  "
                     f"{r.hit:4.0%}  {r.mono:+.2f}  {r.buckets:<42} {r.spread:+.3f} [{r.spread_lo:+.3f}, {r.spread_hi:+.3f}]"
                     f"{'  <- reliable' if r.reliable else ''}")
    return "\n".join(lines), ev


def compare(z_iter, z_val, feats):
    """IC decay: the iteration IC and buckets against the same on the validation set."""
    a, b = evaluate(z_iter, feats), evaluate(z_val, feats)
    m = a.merge(b, on="feature", suffixes=("_iter", "_val"))
    lines = ["  IC decay (iteration -> validation):"]
    for r in m.itertuples():
        lines.append(f"  {r.feature:<11} IC {r.ic_iter:+.3f} -> {r.ic_val:+.3f}   Q5-Q1 {r.spread_iter:+.3f} -> {r.spread_val:+.3f}   "
                     f"val buckets {r.buckets_val}")
    return "\n".join(lines)


def beta_check(z, feature, coins, tf, hold=20, stop_atr=1.5, target_r=1.5, step=3):
    """Workflow note 25: does `feature` also predict random entries with a standard geometry? Random longs (and shorts)
    are opened every `step` bars on every coin; the same quintile cut points as on the trades are applied. If the random
    entries show the same bucket pattern, the factor is market timing, not strategy skill."""
    import engine as E
    cuts = z[feature].quantile([0.2, 0.4, 0.6, 0.8]).values
    rows = []
    for coin in coins:
        d = E.bars(coin)[tf]
        d = d[(d.index >= E.ITER[0]) & (d.index < E.ITER[1])]
        if len(d) < 400:
            continue
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        a = E.MT.atr_of(h, l, c)
        idx = np.arange(250, len(c) - hold - 1, step)
        fake = pd.DataFrame({"coin": coin, "time": d.index[idx], "side": 1, "R": 0.0, "control": 0.0})
        fake = E.common_features(coin, tf, fake)
        for side in (1, -1):
            r = [E.walk_ts(o, h, l, c, e, side, o[e], o[e] - side * stop_atr * a[e - 1], o[e] + side * target_r * stop_atr * a[e - 1],
                           hold, 0.0006) for e in idx]
            rows.append(fake.assign(side=side, R=r))
    F = pd.concat(rows).dropna(subset=[feature, "R"])
    F["bucket"] = np.searchsorted(cuts, F[feature].values)
    zb = np.searchsorted(cuts, z[feature].values)
    lines = [f"  beta check for {feature} (random entries every {step} bars, stop {stop_atr} ATR, target {target_r}R, {hold} bars):"]
    for side in (1, -1):
        g = F[F.side == side].groupby("bucket").R.mean()
        t = z[z.side == side].assign(b=zb[z.side.values == side], e=lambda q: q.R - q.control).groupby("b").e.mean()
        lines.append(f"    side {side:+d}: random R by bucket " + " ".join(f"Q{k + 1} {v:+.3f}" for k, v in g.items()) +
                     "   | trades edge by bucket " + " ".join(f"Q{int(k) + 1} {v:+.2f}" for k, v in t.items()))
    return "\n".join(lines)


def week_boot(z, level=95, reps=4000, seed=4):
    """Date-clustered bootstrap of the mean edge (R - control): calendar weeks are resampled whole, so trades of
    different coins on the same days move together (retrospective, flaw 1). -> (lo, hi)."""
    t = pd.to_datetime(z.time, utc=True)
    wk = t.dt.tz_convert(None).dt.to_period("W").astype(str).values
    e = (z.R - z.control).values
    groups = [e[wk == w] for w in pd.unique(wk)]
    rng = np.random.default_rng(seed)
    sums = np.array([g.sum() for g in groups])
    cnts = np.array([len(g) for g in groups])
    k = len(groups)
    idx = rng.integers(0, k, (reps, k))
    b = sums[idx].sum(1) / cnts[idx].sum(1)
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)
