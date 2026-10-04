"""Loop Z-1, minute check (loop/LOG.md): the Z-1 trades re-walked on 1h bars with every ambiguous hour resolved on 1m
bars (Binance daily 1m files): the fill hour always (the fill minute, then stop and target from the following
minutes), and any later hour that touches both the stop and the target. A minute touching both still counts as the
stop. Stop exits are also charged a slippage of 0, 0.05% and 0.1% of price, which costs a tight stop more R.
Usage: python loop/r1_zone_entry_fine.py   (1m files cached under $ZONE_1M_CACHE, default /tmp/zone_1m)"""
import io, os, sys, time, urllib.request, zipfile
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402
import r1_zone_entry as Z  # noqa: E402

CACHE = os.environ.get("ZONE_1M_CACHE", "/tmp/zone_1m")
SLIPS = (0.0, 0.0005, 0.001)
FEE = 0.0006


def minutes(coin, day):
    """1m bars of one UTC day as arrays (open, high, low, close) indexed by minute of day, or None"""
    os.makedirs(CACHE, exist_ok=True)
    name = f"{coin}USDT-1m-{day:%Y-%m-%d}"
    path = os.path.join(CACHE, name + ".npy")
    if os.path.exists(path):
        x = np.load(path)
        return x if len(x) else None
    url = f"https://data.binance.vision/data/spot/daily/klines/{coin}USDT/1m/{name}.zip"
    b = None
    for k in range(6):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                b = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                break
            time.sleep(2 ** k)
        except Exception:
            time.sleep(2 ** k)
    x = np.full((1440, 4), np.nan)
    if b:
        for line in zipfile.ZipFile(io.BytesIO(b)).read(name + ".csv").decode().splitlines():
            v = line.split(",")
            if not v[0].isdigit():
                continue
            ts = int(v[0])
            ts = ts // 1000 if ts < 10**14 else ts // 10**6
            m = (ts - int(day.timestamp())) // 60
            if 0 <= m < 1440:
                x[m] = [float(v[1]), float(v[2]), float(v[3]), float(v[4])]
    else:
        x = np.empty((0, 4))
    np.save(path, x)
    return x if len(x) else None


def resolve(coin, t, side, stop, tgt, after=None, lim=None):
    """Walk the minutes of hour t. Fill hour: lim given, fill at the first minute touching it, exits from the next
    minute. -> (kind, price, px) with kind 'stop'/'target'/None (no exit in the hour) or 'nofill'; None if no minutes."""
    day = t.normalize()
    x = minutes(coin, day)
    if x is None:
        return None
    m0 = int((t - day).total_seconds() // 60)
    seg = x[m0:m0 + 60]
    seg = seg[~np.isnan(seg[:, 0])]
    if not len(seg):
        return None
    o, h, l = seg[:, 0], seg[:, 1], seg[:, 2]
    px, start = None, 0
    if lim is not None:
        f = np.flatnonzero(l <= lim) if side == 1 else np.flatnonzero(h >= lim)
        if not len(f):
            return ("nofill", None, None)
        j = f[0]
        px = min(o[j], lim) if side == 1 else max(o[j], lim)
        if (l[j] <= stop) if side == 1 else (h[j] >= stop):
            return ("stop", stop, px)
        start = j + 1
    for m in range(start, len(o)):
        if (l[m] <= stop) if side == 1 else (h[m] >= stop):
            return ("stop", min(o[m], stop) if side == 1 else max(o[m], stop), px)
        if (h[m] >= tgt) if side == 1 else (l[m] <= tgt):
            return ("target", max(o[m], tgt) if side == 1 else min(o[m], tgt), px)
    return (None, None, px)


def walk(coin, q, d, sig):
    o, h, l, c = (q[x].values for x in ("open", "high", "low", "close"))
    k, _, side, _, stop, tgt, lim, _ = sig
    day = d.index[k]
    j0, j1 = q.index.searchsorted(day), q.index.searchsorted(day + pd.Timedelta(days=1))
    j = next((j for j in range(j0, j1) if (side == 1 and l[j] <= lim) or (side == -1 and h[j] >= lim)), None)
    if j is None or j + 2 >= len(c):
        return None
    flag, px, start = "min", None, j + 1
    r = resolve(coin, q.index[j], side, stop, tgt, lim=lim)
    if r is None or r[0] == "nofill":  # no minutes: the hourly convention (fill, stop if touched, no target)
        flag = "hour"
        px = min(o[j], lim) if side == 1 else max(o[j], lim)
        if (l[j] <= stop) if side == 1 else (h[j] >= stop):
            return px, "stop", stop, flag
    else:
        px = r[2]
        if r[0]:
            return px, r[0], r[1], flag
    if (px - stop) * side <= 0:
        return None
    end = min(j + FR.HOLD * 24, len(c))
    for m in range(start, end):
        hs = (l[m] <= stop) if side == 1 else (h[m] >= stop)
        ht = (h[m] >= tgt) if side == 1 else (l[m] <= tgt)
        if hs and ht:
            r = resolve(coin, q.index[m], side, stop, tgt)
            if r is not None and r[0]:
                return px, r[0], r[1], flag
            flag = "amb"
            return px, "stop", min(o[m], stop) if side == 1 else max(o[m], stop), flag
        if hs:
            return px, "stop", min(o[m], stop) if side == 1 else max(o[m], stop), flag
        if ht:
            return px, "target", max(o[m], tgt) if side == 1 else min(o[m], tgt), flag
    return px, "time", c[end - 1], flag


def coin_rows(coin):
    d = E.bars(coin)["1d"]
    try:
        q = E.bars_1h(coin)
    except Exception:
        return []
    rows = []
    for f, tm in Z.VARS:
        sigs, _ = Z.signals(d, f, tm)
        for s in sigs:
            day = d.index[s[0]]
            if not (Z.T0 <= day < Z.T1) or s[0] <= 300 or s[0] + FR.HOLD >= len(d):
                continue
            w = walk(coin, q, d, s)
            if w is None:
                continue
            px, kind, ex, flag = w
            side, stop = s[2], s[4]
            risk = abs(px - stop)
            row = dict(coin=coin, time=day, f=f, tm=tm, side=side, kind=kind, flag=flag, risk_pct=risk / px)
            for sl in SLIPS:
                exs = ex - side * sl * ex if kind == "stop" else ex
                row[f"R{sl}"] = (exs - px) * side / risk - FEE * (px + exs) / risk
            rows.append(row)
    print(coin, flush=True)
    return rows


def main():
    coins = E.ITER_COINS + E.ITER_EXT_COINS
    with ProcessPoolExecutor(8) as ex:
        z = pd.DataFrame([r for rows in ex.map(coin_rows, coins) for r in rows])
    z.to_csv(os.path.join(HERE, "out", "Z-1_1m_trades.csv.gz"), index=False)
    idx = pd.date_range(Z.T0, Z.T1, freq="W-MON", inclusive="left")
    sh = lambda g, col: (lambda w: w.mean() / w.std() * np.sqrt(52))(  # noqa: E731
        g.set_index(pd.to_datetime(g.time))[col].resample("W-MON").sum().reindex(idx).fillna(0))
    out = [f"Z-1 minute check: 1h walk with ambiguous hours resolved on 1m bars, {len(z)} trades",
           "  per fraction: trades, avg R / total R / weekly Sharpe at stop slippage 0, 0.05%, 0.1%; median risk % of price;"
           " fill hour on minutes; trades left ambiguous (counted as stop)"]
    for (f, tm), g in z.groupby(["f", "tm"], sort=False):
        cells = "; ".join(f"slip {sl:.2%}: {g[f'R{sl}'].mean():+.3f} / {g[f'R{sl}'].sum():.0f} / {sh(g, f'R{sl}'):.2f}" for sl in SLIPS)
        out.append(f"  f {f:.2f} {tm:4s}: n {len(g)}, win {np.mean(g['R0.0'] > 0):.0%}, {cells}; risk {g.risk_pct.median():.2%},"
                   f" fill on 1m {np.mean(g.flag != 'hour'):.0%}, ambiguous {np.mean(g.flag == 'amb'):.1%}")
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "r1_zone_entry_fine.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
