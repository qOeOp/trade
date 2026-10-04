"""Loop S-1 (loop/LOG.md): which R-1 orders to take when an account cannot take them all. Every filled R-1 order at
f = 0 and f = 0.5 of the zone is walked on its own (1h bars, ambiguous hours on 1m, 0.05% stop slippage) and described
by features known at the arming close; a ridge score is fitted walk-forward by year and judged by its test terciles
and in a 5-slot account. Usage: python loop/r1_select.py"""
import os, sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402
import r1_zone_entry as Z  # noqa: E402
import r1_zone_entry_fine as F  # noqa: E402

FEATS = ["short", "zone_atr", "body_x", "dist_atr", "room", "stop_pct", "btc_agree", "trend_age", "ma_slope",
         "pivot_age", "stacked", "vol_rank"]
SLIP, CAP, SLOTS = 0.0005, 6.0, 5


def btc_trend():
    d = E.bars("BTC")["1d"]
    return pd.Series(FR.state(d)["trend"], index=d.index)


def features(d, S, i, side, lvl, lower, lim, stop, pidx, btc):
    o, h, l, c, a = S["o"], S["h"], S["l"], S["c"], S["a"]
    risk = abs(lim - stop)
    body = np.abs(c - o)
    med = np.median(body[max(0, i - 20):i])
    lo0 = max(FR.K, i - 700)
    js = np.arange(lo0, i - FR.K + 1)
    ph = [j for j in js if h[j] == h[j - FR.K:j + FR.K + 1].max()]
    pl = [j for j in js if l[j] == l[j - FR.K:j + FR.K + 1].min()]
    if side == 1:  # nearest pivot high above the close never closed above since
        opp = [h[j] for j in ph if h[j] > c[i] and c[j + 1:i + 1].max() < h[j]]
        room = (min(opp) - lim) / risk if opp else CAP
    else:
        opp = [l[j] for j in pl if l[j] < c[i] and c[j + 1:i + 1].min() > l[j]]
        room = (lim - max(opp)) / risk if opp else CAP
    zlo, zhi = (lower - 0.25 * a[i], lvl + 0.25 * a[i]) if side == 1 else (lvl - 0.25 * a[i], lower + 0.25 * a[i])
    stacked = sum(1 for j in ph if j != pidx and zlo <= h[j] <= zhi) + sum(1 for j in pl if j != pidx and zlo <= l[j] <= zhi)
    tr = S["trend"]
    t0 = i
    while t0 > 0 and tr[t0 - 1] == side:
        t0 -= 1
    ma = pd.Series(c[max(0, i - 70):i + 1]).rolling(50).mean().values
    vr = a[max(0, i - 365):i + 1] / c[max(0, i - 365):i + 1]
    return dict(short=float(side == -1), zone_atr=abs(lvl - lower) / a[i], body_x=body[i] / med if med > 0 else np.nan,
                dist_atr=(c[i] - lim) * side / a[i], room=float(np.clip(room, -CAP, CAP)), stop_pct=risk / lim,
                btc_agree=float(btc.get(d.index[i], side) == side), trend_age=np.log1p(i - t0),
                ma_slope=(ma[-1] - ma[-11]) * side / a[i], pivot_age=np.log1p(i - pidx), stacked=float(stacked),
                vol_rank=float(np.mean(vr <= vr[-1])))


def coin_rows(args):
    coin, btc = args
    d = E.bars(coin)["1d"]
    try:
        q = E.bars_1h(coin)
    except Exception:
        return []
    S = FR.state(d)
    a, tr = S["a"], S["trend"]
    rows = []
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low") or i + 1 >= len(d) or np.isnan(a[i]) or i <= 300:
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] != side or not (Z.T0 <= d.index[i] < Z.T1):
            continue
        lvl, edge = p[1], p[2]
        lower = max(edge, lvl - a[i]) if side == 1 else min(edge, lvl + a[i])
        stop = lower - side * FR.BUF * a[i]
        for f in (0.0, 0.5):
            lim = lvl - f * (lvl - lower)
            if (lim - stop) * side <= 0:
                continue
            k, px = FR.fill(S, i + 1, side, lim)
            if k is None or k + FR.HOLD >= len(d):
                continue
            w = F.walk(coin, q, d, (k, i, side, px, stop, px + side * 2 * abs(px - stop), lim, 0))
            if w is None:
                continue
            px, kind_x, ex, flag, jf, jx = w
            risk = abs(px - stop)
            exs = ex - side * SLIP * ex if kind_x == "stop" else ex
            R = (exs - px) * side / risk - F.FEE * (px + exs) / risk
            rows.append(dict(coin=coin, arm=d.index[i], f=f, side=side, fill=q.index[jf], exit=q.index[jx] + pd.Timedelta(hours=1),
                             R=R, kind=kind_x, **features(d, S, i, side, lvl, lower, lim, stop, p[0], btc)))
    print(coin, len(rows), flush=True)
    return rows


def ridge(X, y, lam=10.0):
    Xb = np.c_[np.ones(len(X)), X]
    P = lam * np.eye(Xb.shape[1])
    P[0, 0] = 0
    return np.linalg.solve(Xb.T @ Xb + P, Xb.T @ y)


def week_ci(t, x, reps=2000, seed=31):
    wk = pd.to_datetime(t, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    rng = np.random.default_rng(seed)
    g = {w: x[wk == w] for w in weeks}
    bs = []
    for _ in range(reps):
        pick = rng.choice(weeks, len(weeks))
        bs.append(np.concatenate([g[w] for w in pick]).mean())
    return np.percentile(bs, [2.5, 97.5])


def account(z, take):
    """at most SLOTS open and one per coin, in fill order; -> weekly R series over 2020-2022, n taken"""
    ev = z[take].sort_values("fill")
    open_, taken = [], []
    for r in ev.itertuples():
        open_ = [(t, c) for t, c in open_ if t > r.fill]
        if len(open_) >= SLOTS or any(c == r.coin for _, c in open_):
            continue
        open_.append((r.exit, r.coin))
        taken.append((r.exit, r.R))
    s = pd.Series([x for _, x in taken], index=pd.to_datetime([t for t, _ in taken], utc=True))
    idx = pd.date_range("2020-01-01", "2023-01-01", freq="W-MON", inclusive="left", tz="UTC")
    return s.resample("W-MON").sum().reindex(idx).fillna(0), len(taken)


def stats(w):
    eq = w.cumsum()
    return w.sum(), w.mean() / w.std() * np.sqrt(52), (eq - eq.cummax()).min()


def main():
    btc = btc_trend().to_dict()
    coins = E.ITER_COINS + E.ITER_EXT_COINS
    with ProcessPoolExecutor(8) as ex:
        z = pd.DataFrame([r for rows in ex.map(coin_rows, [(c, btc) for c in coins]) for r in rows])
    z.to_csv(os.path.join(HERE, "out", "S-1_orders.csv.gz"), index=False)
    z["year"] = pd.to_datetime(z.arm).dt.year
    out = [f"S-1: choosing among R-1 orders; {len(z)} filled orders walked on their own (1h, 1m-resolved, 0.05% stop slippage)"]
    for f, g in z.groupby("f"):
        g = g.dropna(subset=FEATS).copy()
        out.append(f"\n== f {f:.1f}: {len(g)} orders, avg R {g.R.mean():+.3f}")
        tr0 = g[g.year <= 2019]
        out.append("  univariate terciles on 2018-2019 (avg R low / mid / high tercile of the feature):")
        for c in FEATS:
            if c in ("short", "btc_agree"):
                out.append(f"    {c:10s}: no {tr0[tr0[c] == 0].R.mean():+.3f} ({(tr0[c] == 0).sum()}), yes {tr0[tr0[c] == 1].R.mean():+.3f} ({(tr0[c] == 1).sum()})")
                continue
            qs = pd.qcut(tr0[c].rank(method="first"), 3, labels=False)
            out.append(f"    {c:10s}: " + " / ".join(f"{tr0.R[qs == t].mean():+.3f}" for t in range(3)))
        g["score"] = np.nan
        g["above"] = False
        for yr in (2020, 2021, 2022):
            trn, tst = g[g.year < yr], g.year == yr
            mu, sd = trn[FEATS].mean(), trn[FEATS].std().replace(0, 1)
            w = ridge(((trn[FEATS] - mu) / sd).values, trn.R.values)
            sc = np.c_[np.ones(tst.sum()), ((g.loc[tst, FEATS] - mu) / sd).values] @ w
            g.loc[tst, "score"] = sc
            med = np.median(np.c_[np.ones(len(trn)), ((trn[FEATS] - mu) / sd).values] @ w)
            g.loc[tst, "above"] = sc > med
            if yr == 2022:
                out.append("  ridge weights (fit 2018-2021, standardised): " + ", ".join(f"{c} {x:+.3f}" for c, x in zip(FEATS, w[1:])))
        t = g[g.year >= 2020].copy()
        t["terc"] = t.groupby("year").score.transform(lambda s: pd.qcut(s.rank(method="first"), 3, labels=False))
        top, bot = t.terc == 2, t.terc == 0
        diff = t.R.where(top, np.nan).mean() - t.R.where(bot, np.nan).mean()
        # clustered CI of top minus bottom: bootstrap weeks, recompute
        wk = pd.to_datetime(t.arm, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
        weeks = pd.unique(wk)
        rng = np.random.default_rng(33)
        Rv, tv, bv = t.R.values, top.values, bot.values
        ix = {w_: np.flatnonzero(wk == w_) for w_ in weeks}
        bs = []
        for _ in range(2000):
            sel = np.concatenate([ix[w_] for w_ in rng.choice(weeks, len(weeks))])
            bs.append(Rv[sel][tv[sel]].mean() - Rv[sel][bv[sel]].mean())
        lo, hi = np.percentile(bs, [2.5, 97.5])
        out.append(f"  test 2020-2022 by score tercile: bottom {t.R[bot].mean():+.3f} ({bot.sum()}), middle {t.R[t.terc == 1].mean():+.3f},"
                   f" top {t.R[top].mean():+.3f} ({top.sum()}); all {t.R.mean():+.3f}")
        out.append(f"  top minus bottom {diff:+.3f} [{lo:+.3f}, {hi:+.3f}]; top minus all {t.R[top].mean() - t.R.mean():+.3f};"
                   f" by year " + ", ".join(f"{y} {gg.R[gg.terc == 2].mean() - gg.R[gg.terc == 0].mean():+.3f}" for y, gg in t.groupby("year")))
        out.append(f"  -> {'PASS' if lo > 0 and t.R[top].mean() - t.R.mean() >= 0.10 else 'fail'} (registered: interval above 0 and top beats all by 0.10R)")
        allw, n_all = account(t, np.ones(len(t), bool))
        selw, n_sel = account(t, t.above.values)
        rr = np.random.default_rng(35)
        rnd = [account(t, rr.random(len(t)) < t.above.mean()) for _ in range(100)]
        ra = np.array([stats(w_) for w_, _ in rnd])
        out.append(f"  account, {SLOTS} slots, one per coin, 2020-2022: every order {n_all} trades, total R {stats(allw)[0]:.0f}, Sharpe {stats(allw)[1]:.2f}, max DD {stats(allw)[2]:.0f}R")
        out.append(f"    score above training median ({t.above.mean():.0%} pass): {n_sel} trades, total R {stats(selw)[0]:.0f}, Sharpe {stats(selw)[1]:.2f}, max DD {stats(selw)[2]:.0f}R")
        out.append(f"    random filter, same pass rate (100 draws): total R {ra[:, 0].mean():.0f} [{np.percentile(ra[:, 0], 5):.0f}, {np.percentile(ra[:, 0], 95):.0f}],"
                   f" Sharpe {ra[:, 1].mean():.2f} [{np.percentile(ra[:, 1], 5):.2f}, {np.percentile(ra[:, 1], 95):.2f}]")
    txt = "\n".join(out)
    print(txt)
    open(os.path.join(HERE, "r1_select.txt"), "w").write(txt + "\n")
    E.log("S-1", "R-1 order selection", "iteration", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), False, "see r1_select.txt")


if __name__ == "__main__":
    main()
