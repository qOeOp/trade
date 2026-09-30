"""TrialFamily fxrevert-v1: daily mean-reversion entries on the FX majors. See fxrevert/INTENT.md."""
import gzip, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import tv_fx_mtf  # noqa: E402

COST, CONTROLS, STOP_ATR = 0.00005, 20, 2.0
MAX_DAYS = {"M1": 10, "M2": 5, "M3": 5}
IS_END = pd.Timestamp("2023-01-01", tz="UTC")
RNG = np.random.default_rng(51)


def daily(pair):
    h = tv_fx_mtf.hourly(pair)
    agg = {"open": "first", "high": "max", "low": "min", "close": "last"}
    d = h.resample("1D", label="left", closed="left").agg(agg).dropna()
    return d[d.index.dayofweek < 5]  # the few Sunday-evening hours are not a trading day


def indicators(d):
    c = d.close
    x = pd.DataFrame(index=d.index)
    x["sma"] = c.rolling(20).mean()
    sd = c.rolling(20).std(ddof=0)
    x["up"], x["lo"] = x.sma + 2 * sd, x.sma - 2 * sd
    ch = c.diff()
    gain, loss = ch.clip(lower=0).ewm(alpha=1 / 2, adjust=False).mean(), (-ch.clip(upper=0)).ewm(alpha=1 / 2, adjust=False).mean()
    x["rsi2"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    tr = np.maximum(d.high - d.low, np.maximum(abs(d.high - c.shift()), abs(d.low - c.shift())))
    x["atr"] = tr.ewm(alpha=1 / 14, adjust=False).mean()
    lr = np.log(c).diff()
    x["z5"] = np.log(c / c.shift(5)) / (lr.rolling(20).std() * np.sqrt(5))
    return x


def exit_hit(setup, side, x, j):
    if setup == "M1":
        return (x.close[j] >= x.sma[j]) if side == 1 else (x.close[j] <= x.sma[j])
    if setup == "M2":
        return (x.rsi2[j] >= 50) if side == 1 else (x.rsi2[j] <= 50)
    return False  # M3 exits on time only


def trade(setup, x, e, side, atr_ref):
    """Entry at day e's open; -> (R, exit day index)."""
    o, h, l, c = x.open, x.high, x.low, x.close
    entry = o[e]
    risk = STOP_ATR * atr_ref
    stop = entry - side * risk
    last = min(e + MAX_DAYS[setup] - 1, len(c) - 1)
    for j in range(e, last + 1):
        if side == 1 and l[j] <= stop or side == -1 and h[j] >= stop:
            px = min(o[j], stop) if side == 1 else max(o[j], stop)
            return (side * (px - entry) - (entry + px) * COST) / risk, j
        if exit_hit(setup, side, x, j) or j == last:
            return (side * (c[j] - entry) - (entry + c[j]) * COST) / risk, j
    return None, e


def signal(setup, x, i):
    if setup == "M1":
        return -1 if x.close[i] > x.up[i] else (1 if x.close[i] < x.lo[i] else 0)
    if setup == "M2":
        return -1 if x.rsi2[i] > 90 else (1 if x.rsi2[i] < 10 else 0)
    return -1 if x.z5[i] > 1.5 else (1 if x.z5[i] < -1.5 else 0)


def pair_events(pair):
    d = daily(pair)
    ind = indicators(d)
    x = pd.concat([d, ind], axis=1)
    arr = {k: x[k].values for k in x.columns}

    class A:  # attribute access over numpy columns
        pass
    X = A()
    for k, v in arr.items():
        setattr(X, k, v)
    years = x.index.year.values
    rows = []
    for setup in ("M1", "M2", "M3"):
        busy_until = -1
        for i in range(60, len(x) - 12):
            if i <= busy_until or np.isnan(X.atr[i]):
                continue
            side = signal(setup, X, i)
            if side == 0:
                continue
            r, j_exit = trade(setup, X, i + 1, side, X.atr[i])
            if r is None:
                continue
            busy_until = j_exit
            pool = np.flatnonzero((years == years[i + 1]) & (np.arange(len(x)) > 60) & (np.arange(len(x)) < len(x) - 12))
            ctl = [trade(setup, X, int(k), side, X.atr[k - 1])[0] for k in RNG.choice(pool, CONTROLS)]
            rows.append(dict(pair=pair, setup=setup, entry_time=x.index[i + 1], side=side, R=r,
                             control=float(np.nanmean([v for v in ctl if v is not None]))))
    return rows


def ci(v, level):
    v = np.asarray(v, float)
    b = RNG.choice(v, size=(2000, len(v))).mean(1)
    q = (100 - level) / 2
    return v.mean(), np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    rows = []
    for pair in tv_fx_mtf.PAIRS:
        rows += pair_events(pair)
        print(f"{pair}: {sum(r['pair'] == pair for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows)
    ev["diff"] = ev.R - ev.control
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False).encode())
    out = ["fxrevert-v1: daily mean reversion on nine FX majors (cost 0.005% per side, stop 2 ATR)",
           "setup period  n      avgR   control   minus control [interval]"]
    verdict = []
    for s in ("M1", "M2", "M3"):
        lows = []
        for per, m, lvl in (("IS", ev.entry_time < IS_END, 95), ("OOS", ev.entry_time >= IS_END, 90)):
            z = ev[(ev.setup == s) & m]
            dd, lo, hi = ci(z["diff"], lvl)
            lows.append(lo)
            pos = int((z.groupby("pair")["diff"].mean() > 0).sum())
            out.append(f"{s:<5} {per:<6} {len(z):5d}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   {dd:+.3f} [{lo:+.2f},{hi:+.2f}] ({lvl}%)"
                       f"  pairs above control {pos}/9")
        verdict.append(f"{s}: {'HOLDS' if min(lows) > 0 else 'fails'}")
    out.append("decision: " + "; ".join(verdict))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
