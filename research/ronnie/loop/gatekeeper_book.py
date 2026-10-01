"""Gatekeeper for the frozen ensemble book (loop N-4; protocol amendment 5). The iterating agent does not run this.

Frozen book (N-2, "T|risk26|equal"): B3, D-1, F-2, C-6 weekly streams, each scaled to equal risk by its trailing
26-week volatility (expanding volatility where that is zero or undefined), averaged with equal weights. Warm-up uses the
iteration streams (loop/out/streams_weekly.csv.gz); the read covers 2023-01 to 2026-08 on the majors slice (17 majors).

Two verdicts, each at 100 - 5/k percent with k = FINAL_K (default 2), weekly bootstrap:
1. the book's mean weekly return above zero (against cash);
2. Sharpe(book) - Sharpe(B0 buy-and-hold book) above zero.
stdout carries only the three-level verdicts; details go to loop/sealed/N-4_majors.json.
"""
import json, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "trend"))
import engine as E  # noqa: E402
from books import COST, TARGET, states  # noqa: E402

V0, V1 = pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC")
RULES = ("B3", "D-1", "F-2", "C-6")
FAMS = {"D-1": "family_d", "F-2": "family_f", "C-6": "family_c"}


def book_daily():
    rets, vol, expo = {}, {}, {}
    for coin in E.ITER_COINS:
        d = E.bars(coin)["1d"]
        r = d.close.pct_change()
        rets[coin], vol[coin] = r, r.rolling(90).std() * np.sqrt(365)
        for k, s in states(d.close.values).items():
            expo.setdefault(k, {})[coin] = pd.Series(s, index=d.index)
    R, V = pd.DataFrame(rets), pd.DataFrame(vol)
    out = {}
    for k in ("B0", "B3"):
        W = (pd.DataFrame(expo[k]) * (TARGET / V) / len(E.ITER_COINS)).clip(upper=1.0)
        W = W.div(np.maximum(W.sum(axis=1), 1.0), axis=0).shift(1)
        out[k] = (W * R).sum(axis=1) - COST * W.diff().abs().sum(axis=1)
    return out


def trade_stream(key):
    import importlib
    fam = importlib.import_module(FAMS[key])
    cfg = fam.LOOPS[key]
    fn, _ = fam.make(cfg)
    z = E.run(key, fn, cfg["tf"], cfg["hold"], ("majors",), ts=cfg.get("ts"))
    if z.empty:
        return pd.Series(dtype=float), 0
    return z.dropna(subset=["R"]).set_index(pd.to_datetime(z.dropna(subset=["R"]).time)).R, len(z)


def scaled(x):
    sd = x.rolling(26, min_periods=13).std().shift(1)
    sd = sd.where(sd > 0, x.expanding(13).std().shift(1))
    return (x / sd).where(sd > 0).fillna(0.0)


def boot(fn, a, b, level, reps=4000):
    rng = np.random.default_rng(11)
    vals = []
    for _ in range(reps):
        i = rng.integers(0, len(a), len(a))
        vals.append(fn(a[i], b[i]))
    q = (100 - level) / 2
    return np.percentile(vals, [q, 100 - q])


def verdict(lo, est):
    if lo > 0:
        return "PASS"
    return "FAIL (edge positive, interval spans zero)" if est > 0 else "FAIL (edge at or below zero)"


def main():
    k = int(os.environ.get("FINAL_K", 2))
    level = 100 - 5 / k
    it = pd.read_csv(os.path.join(HERE, "out", "streams_weekly.csv.gz"), index_col=0, parse_dates=True)
    daily = book_daily()
    idx = pd.date_range(V0, V1, freq="W-MON", inclusive="left")
    new = pd.DataFrame({b: daily[b].resample("W-MON").sum().reindex(idx) for b in ("B0", "B3")})
    counts = {}
    for key in FAMS:
        s, n = trade_stream(key)
        counts[key] = n
        new[key] = s.resample("W-MON").sum().reindex(idx).fillna(0.0) if len(s) else 0.0
    allw = pd.concat([it[list(RULES) + ["B0"]], new[list(RULES) + ["B0"]]])
    allw = allw[~allw.index.duplicated(keep="last")]
    S = pd.DataFrame({r: scaled(allw[r]) for r in RULES})
    book = S.mean(axis=1).loc[idx].values
    b0 = allw.B0.loc[idx].values
    sh = lambda x: x.mean() / x.std() * np.sqrt(52)  # noqa: E731
    lo1, hi1 = boot(lambda a, _: a.mean(), book, book, level)
    lo2, hi2 = boot(lambda a, b: sh(a) - sh(b), book, b0, level)
    v1 = verdict(lo1, book.mean())
    v2 = verdict(lo2, sh(book) - sh(b0))
    print(f"N-4 majors book vs cash: {v1} at {level:.2f}% (k={k})")
    print(f"N-4 majors book Sharpe vs buy-and-hold: {v2} at {level:.2f}% (k={k})")
    sealed = dict(loop="N-4", stage="majors", weeks=len(idx), trades=counts, level=level,
                  book_mean_week=float(book.mean()), book_sharpe=float(sh(book)), b0_sharpe=float(sh(b0)),
                  ci_mean=[float(lo1), float(hi1)], ci_sharpe_diff=[float(lo2), float(hi2)],
                  rule_sharpe={r: float(sh(S[r].loc[idx].values)) for r in RULES},
                  per_year={str(y): float(g.sum()) for y, g in pd.Series(book, index=idx).groupby(idx.year)},
                  verdicts=[v1, v2])
    json.dump(sealed, open(os.path.join(HERE, "sealed", "N-4_majors.json"), "w"), indent=1)
    E.log("N-4", "ensemble", "majors", dict(n=len(idx), edge=np.nan, lo=np.nan, hi=np.nan), lo1 > 0,
          f"sealed; frozen book vs cash; Sharpe vs B0 {'pass' if lo2 > 0 else 'fail'}; level {level:.2f}")


if __name__ == "__main__":
    main()
