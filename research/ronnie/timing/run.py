"""timing-v1: act on a line break at the 4h close, or at the first 1h, 15m or 5m close through the line? See INTENT.md.

Writes timing/result.txt and timing/events.csv.gz.
"""
import io, os, sys, zipfile

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import tv_hourly  # noqa: E402

MARKETS = ("BTCUSDT", "ETHUSDT")
START, END = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC")
VARIANTS = {"4h": 48, "1h": 12, "15m": 3, "5m": 1}  # 5m bars per trigger bar
LEVEL_K, LINE_K = (3, 5, 8), (5, 8)
MIN_SPAN, MAX_EXT = 6, 60
RR, HOLD5 = 2.0, 30 * 48
FEE, MIN_STOP = 0.0006, 0.1
N_CTRL, SEED = 20, 7


def bars5(pair):
    rows = []
    for m in pd.period_range(START.tz_localize(None), (END - pd.Timedelta(days=1)).tz_localize(None), freq="M"):
        b = tv_hourly.get(f"https://data.binance.vision/data/spot/monthly/klines/{pair}/5m/{pair}-5m-{m.year}-{m.month:02d}.zip")
        z = zipfile.ZipFile(io.BytesIO(b))
        d = pd.read_csv(z.open(z.namelist()[0]), header=None, usecols=range(5))
        rows.append(d)
    d = pd.concat(rows)
    t = d[0].values
    t = np.where(t > 10**14, t // 1000, t)  # Binance switched to microseconds in 2025
    d.index = pd.to_datetime(t, unit="ms", utc=True)
    d = d[~d.index.duplicated()].sort_index()
    d.columns = ["t", "open", "high", "low", "close"]
    full = pd.date_range(START, END - pd.Timedelta(minutes=5), freq="5min")
    d = d.reindex(full)
    d["close"] = d.close.ffill()
    for k in ("open", "high", "low"):
        d[k] = d[k].fillna(d.close)  # exchange outages: flat bars at the last close
    return d[["open", "high", "low", "close"]]


def atr(h, l, c, n=14):
    pc = np.r_[np.nan, c[:-1]]
    tr = np.nanmax(np.c_[h - l, np.abs(h - pc), np.abs(l - pc)], axis=1)
    return pd.Series(tr).ewm(alpha=1 / n, adjust=False).mean().values


def pivots(h, l, k):
    ph, pl = [], []
    for j in range(k, len(h) - k):
        if h[j] == h[j - k:j + k + 1].max():
            ph.append(j)
        if l[j] == l[j - k:j + k + 1].min():
            pl.append(j)
    return ph, pl


def lines_by_bar(h, l, c):
    """For each 4h bar i: the lines known from bars closed before i, as (id, side, value at bar i)."""
    n = len(c)
    out = [[] for _ in range(n)]
    for k in LEVEL_K:
        ph, pl = pivots(h, l, k)
        for side, piv, px in ((1, ph, h), (-1, pl, l)):
            act, p = [], 0
            for i in range(1, n):
                while p < len(piv) and piv[p] + k <= i - 1:
                    act.append(piv[p])
                    p += 1
                act = [j for j in act if (c[i - 1] - px[j]) * side <= 0]  # removed by a 4h close beyond
                out[i] += [(("L", k, j), side, px[j]) for j in act]
    for k in LINE_K:
        ph, pl = pivots(h, l, k)
        for side, piv, px in ((1, ph, h), (-1, pl, l)):
            p, conf, dead = 0, [], set()
            for i in range(1, n):
                while p < len(piv) and piv[p] + k <= i - 1:
                    conf.append(piv[p])
                    p += 1
                if len(conf) < 2:
                    continue
                j1, j2 = conf[-2], conf[-1]
                if (j1, j2) in dead or j2 - j1 < MIN_SPAN or i - j2 > MAX_EXT:
                    continue
                if side == 1 and not px[j2] < px[j1] or side == -1 and not px[j2] > px[j1]:
                    continue
                sl = (px[j2] - px[j1]) / (j2 - j1)
                if (c[i - 1] - (px[j2] + sl * (i - 1 - j2))) * side > 0:
                    dead.add((j1, j2))
                    continue
                out[i].append((("T", k, j1, j2), side, px[j2] + sl * (i - j2)))
    return out


def events(m5, d4, lines):
    """First trigger-timeframe close through each line inside a 4h bar; one event per variant, bar and side."""
    o5, h5, l5, c5 = (m5[x].values for x in ("open", "high", "low", "close"))
    c4 = d4.close.values
    a4 = atr(d4.high.values, d4.low.values, c4)
    rows = []
    fired = {v: set() for v in VARIANTS}
    for i in range(1, len(c4) - 1):
        ap = a4[i - 1]
        s0 = i * 48
        lo, hi = l5[s0:s0 + 48].min(), h5[s0:s0 + 48].max()
        near = [x for x in lines[i] if lo <= x[2] <= hi]  # a close through a line needs the bar to reach it
        for v, step in VARIANTS.items():
            ends = np.arange(s0 + step - 1, s0 + 48, step)  # 5m index of each trigger bar's last 5m bar
            closes = c5[ends]
            best = {}
            for lid, side, y in near:
                if lid in fired[v]:
                    continue
                hit = np.flatnonzero((closes - y) * side > 0)
                if len(hit) == 0:
                    continue
                fired[v].add(lid)
                q = hit[0]
                if side not in best or q < best[side][0]:
                    best[side] = (q, y)
            for side, (q, y) in best.items():
                e = ends[q] + 1  # next 5m open
                seg = slice(s0, ends[q] + 1)
                raw = l5[seg].min() if side == 1 else h5[seg].max()
                rows.append(dict(variant=v, bar=i, side=side, line=y, e=e, raw_stop=raw, atr=ap,
                                 false_break=v != "4h" and (c4[i] - y) * side <= 0))
    ev = pd.DataFrame(rows)
    ev["entry"] = o5[ev.e.values]
    dist = np.maximum((ev.entry - ev.raw_stop) * ev.side, MIN_STOP * ev.atr)
    ev["dist"] = dist
    ev["dist_atr"] = dist / ev.atr
    ev["time"] = m5.index[ev.e.values]
    return ev


def walk(o5, h5, l5, c5, e, side, dist, chunk=20000):
    """R (net of fees) of trades entering at 5m open e with stop dist and a 2R target; stop first; 30 x 4h limit."""
    n = len(c5)
    ok = e + HOLD5 < n
    R = np.full(len(e), np.nan)
    idx = np.flatnonzero(ok)
    for s in range(0, len(idx), chunk):
        k = idx[s:s + chunk]
        ee, sd, dd = e[k], side[k], dist[k]
        entry = o5[ee]
        stop, tgt = entry - sd * dd, entry + sd * RR * dd
        w = ee[:, None] + np.arange(HOLD5)[None, :]
        H, L = h5[w], l5[w]
        hit_s = np.where(sd[:, None] == 1, L <= stop[:, None], H >= stop[:, None])
        hit_t = np.where(sd[:, None] == 1, H >= tgt[:, None], L <= tgt[:, None])
        fs = np.where(hit_s.any(1), hit_s.argmax(1), HOLD5)
        ft = np.where(hit_t.any(1), hit_t.argmax(1), HOLD5)
        oj = o5[ee + np.minimum(fs, HOLD5 - 1)]
        stop_px = np.where(sd == 1, np.minimum(oj, stop), np.maximum(oj, stop))
        exit_px = np.where(fs <= ft, stop_px, tgt)
        exit_px = np.where((fs == HOLD5) & (ft == HOLD5), c5[ee + HOLD5 - 1], exit_px)
        R[k] = sd * (exit_px - entry) / dd - FEE * (entry + exit_px) / dd
    return R


def controls(m5, ev, a5, rng):
    """Mean R of N_CTRL random 5m-open entries per event: same year and side, same stop distance in ATR."""
    o5, h5, l5, c5 = (m5[x].values for x in ("open", "high", "low", "close"))
    years = m5.index.year.values
    pools = {y: np.flatnonzero((years == y) & ~np.isnan(a5)) for y in np.unique(years)}
    e = np.concatenate([rng.choice(pools[y], N_CTRL) for y in ev.time.dt.year.values])
    side = np.repeat(ev.side.values, N_CTRL)
    dist = np.repeat(ev.dist_atr.values, N_CTRL) * a5[e]
    R = walk(o5, h5, l5, c5, e, side, dist).reshape(len(ev), N_CTRL)
    return np.nanmean(R, axis=1)


def boot(ev, variants, rng, reps=2000):
    """Month-block bootstrap of each variant's edge (R - control) and of each variant's edge minus the 4h edge."""
    ev = ev.assign(month=ev.time.dt.strftime("%Y-%m"))
    months = ev.month.unique()
    g = {v: ev[ev.variant == v].groupby("month").edge.agg(["sum", "count"]).reindex(months, fill_value=0) for v in variants}
    draws = {v: [] for v in variants}
    for _ in range(reps):
        pick = rng.integers(0, len(months), len(months))
        for v in variants:
            s = g[v].iloc[pick].sum()
            draws[v].append(s["sum"] / max(s["count"], 1))
    return {v: np.array(x) for v, x in draws.items()}


def main():
    rng = np.random.default_rng(SEED)
    out = ["timing-v1: line breaks acted on at the 4h close vs the first lower-timeframe close (INTENT.md)", ""]
    allev = []
    verdict = {}
    for mkt in MARKETS:
        m5 = bars5(mkt)
        d4 = m5.resample("4h", label="left", closed="left").agg(
            {"open": "first", "high": "max", "low": "min", "close": "last"})
        lines = lines_by_bar(d4.high.values, d4.low.values, d4.close.values)
        ev = events(m5, d4, lines)
        a4 = atr(d4.high.values, d4.low.values, d4.close.values)
        a5 = np.repeat(np.r_[np.nan, a4[:-1]], 48)[:len(m5)]  # ATR of the last closed 4h bar
        o5, h5, l5, c5 = (m5[x].values for x in ("open", "high", "low", "close"))
        ev["R"] = walk(o5, h5, l5, c5, ev.e.values, ev.side.values, ev.dist.values)
        ev["ctrl"] = controls(m5, ev, a5, rng)
        ev = ev.dropna(subset=["R", "ctrl"])
        ev["edge"] = ev.R - ev.ctrl
        ev["market"] = mkt
        allev.append(ev)
        b = boot(ev, list(VARIANTS), rng)
        out.append(f"{mkt}:")
        for v in VARIANTS:
            x = ev[ev.variant == v]
            lo, hi = np.percentile(b[v], [2.5, 97.5])
            line = (f"  {v:>4}  n {len(x):5d}  win {np.mean(x.R > 0):.0%}  avg R {x.R.mean():+.3f}  control {x.ctrl.mean():+.3f}  "
                    f"edge {x.edge.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]  stop {x.dist_atr.median():.2f} ATR")
            if v != "4h":
                d = b[v] - b["4h"]
                dlo, dhi = np.percentile(d, [2.5, 97.5])
                fb = x[x.false_break]
                line += (f"\n        minus 4h edge {x.edge.mean() - ev[ev.variant == '4h'].edge.mean():+.3f} [{dlo:+.3f}, {dhi:+.3f}];"
                         f"  false breaks {len(fb) / len(x):.0%} (avg R {fb.R.mean():+.3f}), kept breaks avg R "
                         f"{x[~x.false_break].R.mean():+.3f}")
                verdict.setdefault(v, []).append(dlo > 0)
            out.append(line)
        out.append("")
    better = [v for v, ok in verdict.items() if all(ok)]
    out.append("Decision: " + (f"{', '.join(better)} beats the 4h close on both markets" if better else
                               "no lower-timeframe trigger beats the 4h close on both markets; the 4h close stays"))
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")
    ev = pd.concat(allev)
    ev[["market", "variant", "time", "side", "line", "entry", "dist_atr", "false_break", "R", "ctrl"]].to_csv(
        os.path.join(HERE, "events.csv.gz"), index=False, float_format="%.6g")


if __name__ == "__main__":
    main()
