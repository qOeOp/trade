"""Shared engine of the autonomous R&D loop (see loop/PROTOCOL.md).

- data: daily and 4h bars of the iteration set (17 majors, 2018-2022), the validation set (20 large caps, 2023-2026)
  and the final holdout (coins never used in this research), cached in loop/.cache;
- score: signals (entry index, side, entry, stop, target) scored by the range-v2 scorer against 20 random entries
  matched on year, side, stop in ATR, target in R and time limit;
- gate: the iteration gate (both halves of the iteration set positive and the pooled interval above zero) and the
  validation gate (interval above zero at a level deflated by the number of candidates validated so far);
- census: every scored trial is appended to loop/census.csv.
"""
import csv, importlib.util, os, pickle, sys
from datetime import datetime, timezone

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

ITER_COINS, VAL_COINS = R4.MAJORS, R4.LARGE
FINAL_COINS = ("TON", "RENDER", "JUP", "ENA", "BONK", "WIF", "FLOKI", "PYTH", "ORDI", "CFX", "TAO", "STRK")
# iteration-tier extension for rare-event families (protocol amendment 1): mid and large caps used by earlier families
# for other entries, never for an oversold or capitulation rule; not in the validation or final tiers
ITER_EXT_COINS = ("VET", "SAND", "MANA", "AXS", "EGLD", "THETA", "XTZ", "NEO", "ZEC", "DASH", "CHZ", "GRT", "CRV", "QTUM",
                  "KSM", "RUNE", "SNX", "COMP", "YFI", "AR", "CAKE", "DYDX", "GALA", "FLOW", "ENS", "MINA", "QNT", "LPT",
                  "CVX", "IOTA", "BAT", "ZIL", "1INCH", "SUSHI", "ENJ", "KAVA")
ITER = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
ITER_SPLIT = pd.Timestamp("2021-01-01", tz="UTC")
VAL = (pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
CACHE = os.path.join(HERE, ".cache")
CURRENT = {"coin": None}  # the coin whose signals are being built; families key their features by it
CENSUS = os.path.join(HERE, "census.csv")


def bars(coin):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{coin}.pkl")
    if os.path.exists(path):
        return pickle.load(open(path, "rb"))
    from evaluate import holdout_bars
    b = holdout_bars(coin)
    out = {k: b[k][["open", "high", "low", "close", "volume"]].astype(float) for k in ("4h", "1d")}
    pickle.dump(out, open(path, "wb"))
    return out


def score(coin, tf, name, d, sigs, hold, fee=0.0006, seed=0):
    """-> list of dict rows (coin, time, side, R, control, stop_atr, target_R)."""
    a = MT.atr_of(d.high.values, d.low.values, d.close.values)
    R2.HOLD, R2.FEE = hold, fee
    return R2.score(coin, tf, name, d[["open", "high", "low", "close"]], sigs, a, np.random.default_rng(seed))


def run(name, signal_fn, tf, hold, sets=("iter",), ts=None):
    """Score signal_fn(d1, d4) -> list of (e, side, entry, stop, tgt) on the chosen sets. -> DataFrame."""
    rows = []
    spec = {"iter": (ITER_COINS, ITER), "iterx": (ITER_COINS + ITER_EXT_COINS, ITER), "val": (VAL_COINS, VAL),
            "final": (FINAL_COINS, VAL)}
    for s in sets:
        coins, (t0, t1) = spec[s]
        for k, coin in enumerate(coins):
            b = bars(coin)
            d = b[tf]
            CURRENT["coin"] = coin
            sigs = signal_fn(b["1d"], b["4h"])
            scored = score_ts(coin, tf, name, d, sigs, hold, *ts, seed=k) if ts else score(coin, tf, name, d, sigs, hold, seed=k)
            part = pd.DataFrame([dict(r, set=s) for r in scored if t0 <= r["time"] < t1])
            rows += common_features(coin, tf, part).to_dict("records") if len(part) else []
    return pd.DataFrame(rows)


COMMON_FEATURES = ("btc_trend", "coin_trend", "ret20", "vol_ratio", "volume_ratio", "stop_atr", "target_R")
_BTC = {}


def common_features(coin, tf, z):
    """Features every trade carries, computed from the bar before entry and keyed by the trade itself (note 17)."""
    if z.empty:
        return z
    d = bars(coin)[tf]
    o, h, l, c, v = (d[x].values for x in ("open", "high", "low", "close", "volume"))
    a, a100 = MT.atr_of(h, l, c), MT.atr_of(h, l, c, 100)
    s200 = pd.Series(c).rolling(200).mean().values
    vm = pd.Series(v).rolling(20).mean().values
    if "d" not in _BTC:
        bd = bars("BTC")["1d"]
        _BTC["d"] = (bd.close / bd.close.rolling(200).mean() - 1)
    bt = _BTC["d"]
    e = d.index.get_indexer(pd.to_datetime(z.time))
    i = e - 1
    btc = bt.reindex(pd.to_datetime(z.time).dt.floor("1D") - pd.Timedelta(days=1)).values
    return z.assign(btc_trend=btc, coin_trend=c[i] / s200[i] - 1, ret20=c[i] / c[i - 20] - 1, vol_ratio=a[i] / a100[i],
                    volume_ratio=v[i] / vm[i])


def boot(z, level=95):
    if len(z) < 5 or z.coin.nunique() < 2:
        return np.nan, np.nan
    return R2.coin_boot(z, level=level)


def iteration_gate(z):
    """Both halves of the iteration set above zero (edge = R - control) and the pooled 95% interval above zero."""
    z = z[z.set.isin(["iter", "iterx"])]
    a, b = z[z.time < ITER_SPLIT], z[z.time >= ITER_SPLIT]
    lo, hi = boot(z)
    ea, eb = (a.R - a.control).mean(), (b.R - b.control).mean()
    passed = bool(lo > 0 and ea > 0 and eb > 0)
    return passed, dict(n=len(z), edge=(z.R - z.control).mean(), lo=lo, hi=hi, edge_2018_20=ea, edge_2021_22=eb,
                        n_a=len(a), n_b=len(b), avgR=z.R.mean())


def validation_level():
    """Bonferroni over the candidates already sent to validation, including this one."""
    k = 1
    if os.path.exists(CENSUS):
        k += sum(r["stage"] == "validation" for r in csv.DictReader(open(CENSUS)))
    return 100 - 5 / k, k


def log(loop, name, stage, stats, passed, note=""):
    if os.environ.get("LOOP_RERUN"):
        stage, note = f"rerun-{stage}", (note + " " if note else "") + os.environ["LOOP_RERUN"]
    new = not os.path.exists(CENSUS)
    with open(CENSUS, "a", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        if new:
            w.writerow(["logged_at", "loop", "candidate", "stage", "n", "edge", "lo", "hi", "passed", "note"])
        w.writerow([datetime.now(timezone.utc).isoformat(timespec="seconds"), loop, name, stage, stats.get("n"),
                    f"{stats.get('edge', np.nan):+.4f}", f"{stats.get('lo', np.nan):+.4f}", f"{stats.get('hi', np.nan):+.4f}",
                    passed, note])


def fmt(stats):
    return (f"n {stats['n']}, avg R {stats['avgR']:+.3f}, edge {stats['edge']:+.3f} [{stats['lo']:+.3f}, {stats['hi']:+.3f}], "
            f"2018-20 {stats['edge_2018_20']:+.3f} (n {stats['n_a']}), 2021-22 {stats['edge_2021_22']:+.3f} (n {stats['n_b']})")


def decompose(z, tf, hold):
    """Where a loss happens: for each trade, the bar of exit, the maximum favourable excursion (MFE) before the stop, in R,
    and whether the stop came within 2 bars. Reconstructed from (coin, time, side, stop_atr, target_R)."""
    rows = []
    for coin, g in z.groupby("coin"):
        d = bars(coin)[tf]
        o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
        a = MT.atr_of(h, l, c)
        for t in g.itertuples():
            e = int(d.index.get_loc(t.time))
            side, entry = t.side, o[e]
            risk = t.stop_atr * a[e - 1]
            stop, tgt = entry - side * risk, entry + side * t.target_R * risk
            mfe, k_stop = 0.0, None
            for j in range(e, min(e + hold, len(c))):
                if (l[j] <= stop) if side == 1 else (h[j] >= stop):
                    k_stop = j - e
                    break
                mfe = max(mfe, ((h[j] - entry) if side == 1 else (entry - l[j])) / risk)
                if (h[j] >= tgt) if side == 1 else (l[j] <= tgt):
                    break
            rows.append(dict(mfe=mfe, k_stop=k_stop))
    dz = pd.DataFrame(rows)
    st = dz.k_stop.notna()
    return (f"  decomposition: stopped {st.mean():.0%} of trades; of the stopped, {(dz.k_stop[st] <= 1).mean():.0%} within 2 bars "
            f"and {(dz.mfe[st] >= 1).mean():.0%} after first reaching +1R; median MFE before the stop {dz.mfe[st].median():.2f}R; "
            f"winners' median MFE {dz.mfe[~st].median():.2f}R")


def walk_ts(o, h, l, c, e, side, entry, stop, tgt, hold, fee, ts_bars=None, ts_r=None):
    """One trade: stop first, then target (from the bar after entry), optional time stop at the close of bar e+ts_bars-1
    when the best excursion so far is below ts_r R; else the close at the time limit. -> R net of fees."""
    risk = (entry - stop) * side
    if risk <= 0:
        return np.nan
    best, n = 0.0, len(c)
    for j in range(e, min(e + hold, n)):
        if (l[j] <= stop) if side == 1 else (h[j] >= stop):
            px = stop if j == e else (min(o[j], stop) if side == 1 else max(o[j], stop))
            break
        if j > e and ((h[j] >= tgt) if side == 1 else (l[j] <= tgt)):
            px = max(o[j], tgt) if side == 1 else min(o[j], tgt)
            break
        best = max(best, ((h[j] - entry) if side == 1 else (entry - l[j])) / risk)
        if ts_bars and j == e + ts_bars - 1 and best < ts_r:
            px = c[j]
            break
    else:
        px = c[min(e + hold, n) - 1]
    return side * (px - entry) / risk - fee * (entry + px) / risk


def score_ts(coin, tf, name, d, sigs, hold, ts_bars, ts_r, fee=0.0006, seed=0, controls=20):
    """Like score(), with a time stop applied to signals and controls alike."""
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    a = MT.atr_of(h, l, c)
    years, idx = d.index.year.values, np.arange(len(c))
    rng = np.random.default_rng(seed)
    rows = []
    for e, side, entry, stop, tgt in sigs:
        risk = (entry - stop) * side
        if e <= 300 or e + hold >= len(c) or risk <= 0 or (tgt - entry) * side < risk:
            continue
        r = walk_ts(o, h, l, c, e, side, entry, stop, tgt, hold, fee, ts_bars, ts_r)
        sa, tr = risk / a[e - 1], (tgt - entry) * side / risk
        ctl = []
        for j in rng.choice(np.flatnonzero((years == years[e]) & (idx > 300) & (idx < len(c) - hold - 2)), controls):
            rk = sa * a[j - 1]
            ctl.append(walk_ts(o, h, l, c, j, side, o[j], o[j] - side * rk, o[j] + side * tr * rk, hold, fee, ts_bars, ts_r))
        rows.append(dict(coin=coin, tf=tf, variant=name, time=d.index[e], side=int(side), R=r, control=float(np.nanmean(ctl)),
                         stop_atr=sa, target_R=tr))
    return rows
