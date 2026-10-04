"""Loop S-3 (loop/LOG.md): two order scores fitted once on S-1's development orders (trim: the ridge score's middle
60%; binned: an additive tercile-bin score, above its training median), checked on the validation tier (20 coins,
2023-2026). Usage: python loop/r1_select_val.py"""
import os, sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import r1_select as S1  # noqa: E402
import r1_zone_entry as Z  # noqa: E402

FEATS, BIN = S1.FEATS, ("short", "btc_agree")
SHRINK = 500


def fit_binned(trn):
    mu, parts = trn.R.mean(), {}
    for c in FEATS:
        if c in BIN:
            edges = None
            b = trn[c].values
        else:
            edges = np.quantile(trn[c], [1 / 3, 2 / 3])
            b = np.searchsorted(edges, trn[c].values, side="right")
        vals = {}
        for k in np.unique(b):
            r = trn.R.values[b == k]
            vals[k] = (r.mean() - mu) * len(r) / (len(r) + SHRINK)
        parts[c] = (edges, vals)
    return parts


def score_binned(parts, X):
    s = np.zeros(len(X))
    for c, (edges, vals) in parts.items():
        b = X[c].values if edges is None else np.searchsorted(edges, X[c].values, side="right")
        s += np.array([vals.get(k, 0.0) for k in b])
    return s


def diff_ci(t, take, reps=2000, seed=41):
    wk = pd.to_datetime(t.arm, utc=True).dt.tz_convert(None).dt.to_period("W").astype(str).values
    weeks = pd.unique(wk)
    ix = {w: np.flatnonzero(wk == w) for w in weeks}
    R = t.R.values
    rng = np.random.default_rng(seed)
    bs = []
    for _ in range(reps):
        sel = np.concatenate([ix[w] for w in rng.choice(weeks, len(weeks))])
        bs.append(R[sel][take[sel]].mean() - R[sel][~take[sel]].mean())
    bs = np.array(bs)
    return R[take].mean() - R[~take].mean(), np.percentile(bs, [2.5, 97.5]), float(min(np.mean(bs <= 0), np.mean(bs >= 0)) * 2)


def account(t, take):
    ev = t[take].sort_values("fill")
    open_, taken = [], []
    for r in ev.itertuples():
        open_ = [(x, c) for x, c in open_ if x > r.fill]
        if len(open_) >= 5 or any(c == r.coin for _, c in open_):
            continue
        open_.append((r.exit, r.coin))
        taken.append((r.exit, r.R))
    idx = pd.date_range(E.VAL[0], E.VAL[1], freq="W-MON", inclusive="left")
    w = pd.Series([x for _, x in taken], index=pd.to_datetime([x for x, _ in taken], utc=True)).resample("W-MON").sum().reindex(idx).fillna(0)
    eq = w.cumsum()
    return len(taken), w.sum(), w.mean() / w.std() * np.sqrt(52), (eq - eq.cummax()).min()


def main():
    Z.T0, Z.T1 = E.VAL  # inherited by the forked workers
    btc = S1.btc_trend().to_dict()
    with ProcessPoolExecutor(8) as ex:
        v = pd.DataFrame([r for rows in ex.map(S1.coin_rows, [(c, btc) for c in E.VAL_COINS]) for r in rows])
    v.to_csv(os.path.join(HERE, "out", "S-3_val_orders.csv.gz"), index=False)
    dev = pd.read_csv(os.path.join(HERE, "out", "S-1_orders.csv.gz"))
    out = [f"S-3: frozen order scores (fit on {len(dev)} development orders) on the validation tier: {len(v)} orders, {v.coin.nunique()} coins, 2023-2026-08"]
    tests = {}
    for f in (0.0, 0.5):
        trn, t = dev[dev.f == f].dropna(subset=FEATS), v[v.f == f].dropna(subset=FEATS).reset_index(drop=True)
        mu, sd = trn[FEATS].mean(), trn[FEATS].std().replace(0, 1)
        w = S1.ridge(((trn[FEATS] - mu) / sd).values, trn.R.values)
        lin = lambda X: np.c_[np.ones(len(X)), ((X[FEATS] - mu) / sd).values] @ w  # noqa: E731
        st = lin(trn)
        lo20, hi80 = np.percentile(st, [20, 80])
        pct = np.array([np.mean(st <= x) * 100 for x in lin(t)])
        parts = fit_binned(trn)
        bmed = np.median(score_binned(parts, trn))
        take = {"trim": (pct > 20) & (pct <= 80), "binned": score_binned(parts, t) > bmed}
        out.append(f"\n== f {f:.1f}: {len(t)} validation orders, avg R {t.R.mean():+.3f}")
        bands = pd.cut(pct, np.arange(0, 101, 10), include_lowest=True)
        out.append("  linear score bands on validation (avg R, n): " + ", ".join(
            f"{int(b.left) if b.left > 0 else 0}-{int(b.right)} {t.R[bands == b].mean():+.3f} ({(bands == b).sum()})" for b in bands.categories))
        for name, tk in take.items():
            d_, (lo, hi), p = diff_ci(t, tk)
            tests[(f, name)] = (p, d_)
            na, ra, sa, da = account(t, np.ones(len(t), bool))
            nt, rt, s_, dt = account(t, tk)
            rng = np.random.default_rng(43)
            rnd = np.array([account(t, rng.random(len(t)) < tk.mean())[1:3] for _ in range(100)])
            out.append(f"  {name:6s}: takes {tk.mean():.0%}; taken {t.R[tk].mean():+.3f} vs rejected {t.R[~tk].mean():+.3f}: difference {d_:+.3f} [{lo:+.3f}, {hi:+.3f}], p {p:.3f};"
                       f" taken minus all {t.R[tk].mean() - t.R.mean():+.3f}; by year " + ", ".join(
                           f"{y} {g.R[tk[g.index]].mean() - g.R[~tk[g.index]].mean():+.2f}" for y, g in t.groupby(pd.to_datetime(t.arm).dt.year)))
            out.append(f"    5-slot account: every order {na} trades / total R {ra:.0f} / Sharpe {sa:.2f} / max DD {da:.0f}R; {name} {nt} / {rt:.0f} / {s_:.2f} / {dt:.0f}R;"
                       f" random filter total R {rnd[:, 0].mean():.0f} [{np.percentile(rnd[:, 0], 5):.0f}, {np.percentile(rnd[:, 0], 95):.0f}], Sharpe {rnd[:, 1].mean():.2f}")
    order = sorted(tests, key=lambda k: tests[k][0])
    out.append("\nHolm (95%, four tests): " + ", ".join(
        f"f {k[0]:.1f} {k[1]} p {tests[k][0]:.3f} vs {0.05 / (4 - n):.4f}, diff {tests[k][1]:+.3f} -> "
        f"{'PASS' if tests[k][0] <= 0.05 / (4 - n) and tests[k][1] >= 0.10 else 'fail'}" for n, k in enumerate(order)))
    txt = "\n".join(out)
    print(txt)
    open(os.path.join(HERE, "r1_select_val.txt"), "w").write(txt + "\n")
    E.log("S-3", "R-1 order scores on validation", "validation", dict(n=len(v), edge=np.nan, lo=np.nan, hi=np.nan), False, "see r1_select_val.txt")


if __name__ == "__main__":
    main()
