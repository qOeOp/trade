"""TrialFamily altcoins-v1: setups-v1's crypto breakout (B1) on 15 coins it never saw. See altcoins/INTENT.md."""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "setups"))
import ronnie_bt as B  # noqa: E402
import run as SR  # noqa: E402  (setups/run.py)
import tv_hourly  # noqa: E402

COINS = ("BNB", "XRP", "ADA", "SOL", "DOGE", "LTC", "TRX", "LINK", "DOT", "AVAX", "BCH", "ETC", "XLM", "ATOM", "FIL")
COST = SR.COST["crypto"]
RNG = np.random.default_rng(41)


def bars(coin):
    t0, t1 = int(pd.Timestamp("2017-07-01").value // 10**9), int(pd.Timestamp("2026-09-30").value // 10**9)
    h = tv_hourly.binance(f"{coin}USDT", t0, t1).drop_duplicates("time").sort_values("time")
    if h.empty:
        return None
    h.index = pd.to_datetime(h.time, unit="s", utc=True)
    h["volume"] = 1.0
    agg = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
    return h.resample("4h", label="left", closed="left").agg(agg).dropna()


def events(coin, d4):
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = pd.Series(tr).ewm(alpha=1 / 14, adjust=False).mean().values
    lo, sh = B.signals(d4, B.features(d4))
    years = d4.index.year.values
    rows = []
    for i in np.flatnonzero((lo | sh).values):
        e = i + 1
        if e + SR.HOLD >= len(c) or i < 150:
            continue
        side = 1 if lo.values[i] else -1
        stop = l[i] if side == 1 else h[i]
        risk = (o[e] - stop) * side
        if risk <= 0:
            continue
        r = SR.trade(o, h, l, c, e, side, stop, o[e] + side * 2 * risk, COST)
        stop_atr = risk / atr[i]
        pool = np.flatnonzero((years == years[e]) & (np.arange(len(c)) > 150) & (np.arange(len(c)) < len(c) - SR.HOLD - 2))
        if len(pool) < 20:
            continue
        ctl = [SR.trade(o, h, l, c, j, side, o[j] - side * stop_atr * atr[j - 1], o[j] + side * 2 * stop_atr * atr[j - 1], COST)
               for j in RNG.choice(pool, SR.CONTROLS)]
        rows.append(dict(coin=coin, entry_time=d4.index[e], side=side, R=r, control=float(np.mean([x for x in ctl if x is not None]))))
    return rows


def main():
    rows = []
    for coin in COINS:
        d4 = bars(coin)
        if d4 is None or len(d4) < 500:
            print(f"{coin}: no data", flush=True)
            continue
        rows += events(coin, d4)
        print(f"{coin}: {len(d4)} 4h bars from {d4.index[0]:%Y-%m-%d}, {sum(r['coin'] == coin for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows)
    ev["diff"] = ev.R - ev.control
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False).encode())
    groups = [g["diff"].values for _, g in ev.groupby("coin")]
    boot = []
    for _ in range(2000):
        pick = [groups[k] for k in RNG.integers(0, len(groups), len(groups))]
        boot.append(np.concatenate([g[RNG.integers(0, len(g), len(g))] for g in pick]).mean())
    lo, hi = np.percentile(boot, [2.5, 97.5])
    by = ev.groupby("coin").agg(n=("R", "size"), avgR=("R", "mean"), control=("control", "mean"), diff=("diff", "mean"))
    out = [f"altcoins-v1: B1 breakout on {ev.coin.nunique()} unseen coins, {len(ev)} signals (cost 0.06% per side)",
           f"pooled avgR {ev.R.mean():+.3f}, control {ev.control.mean():+.3f}, minus control {ev['diff'].mean():+.3f} "
           f"[95% coin-then-signal bootstrap {lo:+.3f}, {hi:+.3f}]",
           f"coins with avgR above control: {int((by['diff'] > 0).sum())} of {len(by)}; with avgR above zero: {int((by.avgR > 0).sum())}",
           f"decision: {'HOLDS on unseen coins' if lo > 0 else 'fails on unseen coins'}", "per coin:"]
    out += [f"  {c:<5} n={r.n:4d}  avgR {r.avgR:+.3f}  control {r.control:+.3f}  minus {r.diff:+.3f}" for c, r in by.iterrows()]
    for y, g in ev.groupby(ev.entry_time.dt.year):
        out.append(f"  year {y}: n={len(g):4d} minus control {g['diff'].mean():+.3f}")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
