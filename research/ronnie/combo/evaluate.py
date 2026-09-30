"""combo-v2 evaluator: score each frozen candidate once on the holdout coins (combo/INTENT.md).

Usage: python combo/evaluate.py candidate_module [candidate_module ...]  (modules in combo/candidates/)

Order of work, per the intent: the development checks (look-ahead on both development markets, at least 100 signals)
run first, then the holdout bars are built, then each candidate is checked for look-ahead on every holdout coin and
scored once. A candidate that fails a check is reported unscored. Writes combo/holdout_result.txt and
combo/holdout_events.csv.gz.
"""
import gzip, importlib, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (HERE, os.path.join(HERE, "candidates"), ROOT):
    sys.path.insert(0, p)
import harness as H  # noqa: E402

COINS = ("BNB", "XRP", "ADA", "SOL", "DOGE", "LTC", "TRX", "LINK", "DOT", "AVAX", "BCH", "ETC", "XLM", "ATOM", "FIL")
LEVEL = 98.3  # two-sided, Bonferroni over three candidates


def holdout_bars(coin):
    import tv_hourly
    t0, t1 = int(pd.Timestamp("2017-07-01").value // 10**9), int(pd.Timestamp("2026-09-30").value // 10**9)
    h = tv_hourly.binance(f"{coin}USDT", t0, t1, volume=True).drop_duplicates("time").sort_values("time")
    h.index = pd.to_datetime(h.time, unit="s", utc=True)
    return H._resample(h)


def base_zone_touch(bars):
    """The unfiltered base for reference: s6 zone_only confirmed entries, scored by the harness."""
    import s6_confirm as S
    from ronnie_plan import features
    d4, d1 = bars["4h"], bars["1d"]
    F = features(d4, d1)
    tr = S.run_confirm(F, "zone_only", k=3)
    o, h, l = d4.open.values, d4.high.values, d4.low.values
    t = d4.index
    sigs = []
    for r in tr.itertuples():
        e = int(t.get_loc(r.entry_time))
        risk = r.stop_atr * F["atr"][e]
        stop = o[e] - r.side * risk
        sigs.append(H.Signal(t[e - 1] + pd.Timedelta(hours=4), r.side, stop, o[e] + r.side * r.target_R * risk, 60))
    return sigs


def coin_bootstrap(ev, level, seed=11):
    rng = np.random.default_rng(seed)
    groups = [g.values for _, g in (ev.R - ev.control).groupby(ev.coin)]
    boot = []
    for _ in range(4000):
        pick = [groups[k] for k in rng.integers(0, len(groups), len(groups))]
        boot.append(np.concatenate([g[rng.integers(0, len(g), len(g))] for g in pick]).mean())
    q = (100 - level) / 2
    return np.percentile(boot, q), np.percentile(boot, 100 - q)


def main(names):
    mods = {n: importlib.import_module(n) for n in names}
    out = [f"combo-v2 holdout evaluation of {len(mods)} frozen candidate(s): {', '.join(names)}"]
    ok = {}
    for n, m in mods.items():
        msgs, good, total = [], True, 0
        for mk in H.DEV_MARKETS:
            b = H.load(mk)
            passed, msg = H.lookahead_check(m.signals, b)
            total += len(m.signals(b))
            msgs.append(f"{mk} look-ahead {'ok' if passed else 'FAILED: ' + msg}")
            good &= passed
        good &= total >= 100
        msgs.append(f"development signals {total}")
        ok[n] = good
        out.append(f"{n}: development checks {'passed' if good else 'FAILED'} ({'; '.join(msgs)})")
    rows = []
    if os.environ.get("DRY_RUN"):  # exercise the pipeline on the development markets, never on the holdout
        bars_of = {mk: H.load(mk) for mk in H.DEV_MARKETS}
    else:
        bars_of = {c: holdout_bars(c) for c in COINS}  # built only now, after the candidates are frozen
    for n, m in mods.items():
        if not ok[n]:
            continue
        failed, mine = [], []
        for k, (c, b) in enumerate(bars_of.items()):
            passed, msg = H.lookahead_check(m.signals, b)
            if not passed:
                failed.append(f"{c}: {msg}")
                continue
            mine.append(H.score(b, m.signals(b), seed=1000 * (names.index(n) + 1) + k).assign(candidate=n, coin=c))
        if failed:
            out.append(f"{n}: look-ahead failed on holdout coins, unscored: {failed[:3]}")
        else:
            rows += mine
    for k, (c, b) in enumerate(bars_of.items()):
        rows.append(H.score(b, base_zone_touch(b), seed=k).assign(candidate="base_zone_touch", coin=c))
    ev = pd.concat(rows, ignore_index=True)
    if not os.environ.get("DRY_RUN"):
        with gzip.GzipFile(f"{HERE}/holdout_events.csv.gz", "wb", mtime=0) as f:
            f.write(ev.to_csv(index=False).encode())
    base = ev[ev.candidate == "base_zone_touch"]
    for n in list(mods) + ["base_zone_touch"]:
        z = ev[ev.candidate == n]
        if z.empty:
            continue
        lo, hi = coin_bootstrap(z, LEVEL)
        per = z.groupby("coin").apply(lambda g: (g.R - g.control).mean(), include_groups=False)
        verdict = "" if n == "base_zone_touch" else (" -> HOLDS" if lo > 0 else " -> fails")
        out.append(f"{n}: n={len(z)} avgR {z.R.mean():+.3f} control {z.control.mean():+.3f} minus control {(z.R - z.control).mean():+.3f} "
                   f"[{LEVEL}% coin-then-signal {lo:+.3f}, {hi:+.3f}]; coins above control {int((per > 0).sum())}/{len(per)}; "
                   f"avgR minus base avgR {z.R.mean() - base.R.mean():+.3f}{verdict}")
    text = "\n".join(out)
    print(text)
    if not os.environ.get("DRY_RUN"):
        open(f"{HERE}/holdout_result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
