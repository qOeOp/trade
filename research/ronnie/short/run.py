"""TrialFamily short-v1: regime-gated trend shorts (S0-S2), bear-rally fades (S3, S4) and a weekly loser short (C1) on
daily bars of large caps. See INTENT.md. Writes short/events.csv.gz, short/weekly.csv.gz and short/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R4 = _load("range4_run", "range4/run.py")
R2, MT = R4.R2, R4.R2.MT
OS = _load("oversold_run", "oversold/run.py")
TR = _load("trend_run", "trend/run.py")

FEE, FUND_DAY, CONTROLS, MAX_DAYS, PAD, SPACING, MAX_STOP = 0.0006, 0.0003, 20, 250, 0.5, 5, 6.0
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
HOLDOUT = (pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
TREND = {"S0": (50, 20, False), "S1": (50, 20, True), "S2": (20, 10, True)}  # entry window, exit window, bear gate
FADES = ("S3", "S4")


def walk(o, h, l, c, e, entry, stop, exit_n):
    """Short trade: stop intraday (gap fills at the open), channel exit at the close -> (exit index, R net)."""
    risk = stop - entry
    n = len(c)
    for j in range(e, min(e + MAX_DAYS, n)):
        if h[j] >= stop:
            px = max(o[j], stop) if j > e else stop
            break
        if j >= exit_n and c[j] > c[j - exit_n:j].max():
            px = c[j]
            break
    else:
        j = min(e + MAX_DAYS, n) - 1
        px = c[j]
    return j, (entry - px) / risk - FEE * (entry + px) / risk - FUND_DAY * (j - e + 1) * entry / risk


def trend_shorts(coin, d, bear, t0, t1, rng):
    o, h, l, c = (d[x].values for x in ("open", "high", "low", "close"))
    n, a = len(c), MT.atr_of(h, l, c, 20)
    sma50 = pd.Series(c).rolling(50).mean().values
    years = d.index.year.values
    pool = (np.arange(n) > 210) & (np.arange(n) < n - 2)
    rows = []
    for v, (en, ex, gate) in TREND.items():
        busy = -1
        for i in range(210, n - 1):
            if i <= busy or not t0 <= d.index[i + 1] < t1:
                continue
            if gate and not bear[i]:
                continue
            if c[i] >= c[i - en:i].min() or (v == "S2" and c[i] >= sma50[i]):
                continue
            e, entry = i + 1, o[i + 1]
            xj, r = walk(o, h, l, c, e, entry, entry + 2 * a[i], ex)
            busy = xj
            js = rng.choice(np.flatnonzero(pool & (years == years[e])), CONTROLS)
            ctl = np.mean([walk(o, h, l, c, j, o[j], o[j] + 2 * a[j - 1], ex)[1] for j in js])
            rows.append(dict(coin=coin, variant=v, time=d.index[e], side=-1, R=r, control=ctl, days=xj - e + 1))
    return rows


def fade_signals(d, bear):
    o, h, l, c = (d[x].values.astype(float) for x in ("open", "high", "low", "close"))
    a = MT.atr_of(h, l, c, 20)
    r2 = OS.rsi(c, 2)
    sma50, sma200 = (pd.Series(c).rolling(k).mean().values for k in (50, 200))
    out, last = {k: [] for k in FADES}, {k: -99 for k in FADES}
    for i in range(210, len(c) - 1):
        if not bear[i]:
            continue
        entry = o[i + 1]
        cand = {}
        if c[i] < sma200[i] and r2[i] > 95:
            cand["S3"] = (h[i] + PAD * a[i], c[i] - 0.5 * (c[i] - l[i - 10:i].min()))
        if c[i] < sma50[i] and c[i - 1] / c[i - 4] - 1 >= 0.08 and c[i] < l[i - 1]:
            cand["S4"] = (h[i - 3:i + 1].max() + PAD * a[i], l[i - 6:i - 3].min())
        for k, (stop, tgt) in cand.items():
            risk = stop - entry
            if risk <= 0 or risk > MAX_STOP * a[i] or entry - tgt < risk or i - last[k] < SPACING:
                continue
            out[k].append((i + 1, -1, entry, stop, tgt))
            last[k] = i
    return out, a


def bear_flags(d, btc_bear):
    return btc_bear.reindex(d.index).ffill().fillna(False).values.astype(bool)


def weekly_losers(closes, opens, bear, t0, t1):
    """Weekly short of the bottom fifth by 28-day return in bear weeks, against shorting the whole universe."""
    rows, prev = [], set()
    for k, dday in enumerate(closes.index):
        if dday.weekday() != 0 or not t0 <= dday < t1 or k < 30 or k + 7 >= len(closes):
            continue
        if not bear.get(closes.index[k - 1], False):
            prev = set()
            continue
        past = closes.iloc[k - 1] / closes.iloc[k - 29] - 1
        fwd = opens.iloc[k + 7] / opens.iloc[k] - 1
        ok = past.notna() & fwd.notna()
        if ok.sum() < 10:
            continue
        p, f = past[ok], fwd[ok]
        q = max(1, int(len(p) * 0.2))
        bot = set(p.nsmallest(q).index)
        cost = FEE * 2 * (len(bot - prev) / q if prev else 1.0)
        rows.append(dict(week=dday, n=len(p), short_losers=-f[list(bot)].mean() - cost, short_universe=-f.mean() - FEE * 2 / 4))
        prev = bot
    return pd.DataFrame(rows)


def main():
    from evaluate import holdout_bars
    rng = np.random.default_rng(79)
    btc = holdout_bars("BTC")["1d"]
    btc_bear = btc.close < btc.close.rolling(200).mean()
    rows, frames = [], {}
    for name_set, coins, (t0, t1) in (("dev", R4.MAJORS, DEV), ("holdout", R4.MAJORS + R4.LARGE, HOLDOUT)):
        for coin in coins:
            d = frames.get(coin)
            if d is None:
                d = frames[coin] = holdout_bars(coin)["1d"][["open", "high", "low", "close", "volume"]]
            bear = bear_flags(d, btc_bear)
            rows += [dict(r, set=name_set) for r in trend_shorts(coin, d, bear, t0, t1, rng)]
            sig, a = fade_signals(d, bear)
            R2.HOLD, R2.FEE = 10, FEE
            for k in FADES:
                rows += [dict(r, set=name_set) for r in R2.score(coin, "1d", k, d[["open", "high", "low", "close"]], sig[k], a, rng)
                         if t0 <= r["time"] < t1]
            print(f"{coin} {name_set}: {sum(r['coin'] == coin and r['set'] == name_set for r in rows)} trades", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["R", "control"])
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    out = ["short-v1 (INTENT.md): daily shorts on large caps; bear regime = BTC close below its 200-day mean; avg R net of",
           "0.06%/side (S0-S2 also 0.03%/day funding against the short); control = 20 random shorts; coin-then-trade bootstrap", "",
           f"bear-regime share of days: 2018-2022 {btc_bear[(btc_bear.index >= DEV[0]) & (btc_bear.index < DEV[1])].mean():.0%}, "
           f"2023-2026/08 {btc_bear[(btc_bear.index >= HOLDOUT[0]) & (btc_bear.index < HOLDOUT[1])].mean():.0%}", "",
           "variant set       n     win   avg R   control  minus control [95%]"]
    verdict = {}
    for v in list(TREND) + list(FADES):
        lows = []
        for s in ("dev", "holdout"):
            z = ev[(ev.variant == v) & (ev.set == s)]
            if len(z) < 5 or z.coin.nunique() < 2:
                out.append(f"{v:<7} {s:<8} {len(z):5d}  too few")
                lows.append(-1)
                continue
            lo, hi = R2.coin_boot(z)
            lows.append(lo)
            out.append(f"{v:<7} {s:<8} {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                       f"{(z.R - z.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
        verdict[v] = min(lows) > 0
    out.append("")
    out.append("per year, avg R (n):")
    for v in list(TREND) + list(FADES):
        z = ev[ev.variant == v]
        g = z.groupby(z.time.dt.year).R.agg(["mean", "count"])
        out.append(f"  {v}: " + ", ".join(f"{y} {r['mean']:+.2f} ({int(r['count'])})" for y, r in g.iterrows()))
    # C1
    out.append("")
    W = []
    for label, coins, (t0, t1) in (("dev", R4.MAJORS, DEV), ("holdout", R4.MAJORS + R4.LARGE, HOLDOUT)):
        cl = pd.DataFrame({k: frames[k].close for k in coins})
        op = pd.DataFrame({k: frames[k].open for k in coins})
        wk = weekly_losers(cl, op, btc_bear.to_dict(), t0, t1).assign(set=label)
        W.append(wk)
        if len(wk) < 5:
            out.append(f"C1 {label}: {len(wk)} bear weeks, too few")
            verdict["C1"] = False
            continue
        ex = wk.short_losers - wk.short_universe
        lo, hi = TR.boot(ex)
        a2, b2 = TR.boot(wk.short_losers)
        out.append(f"C1 {label}: {len(wk)} bear weeks, median {wk.n.median():.0f} coins; short losers {wk.short_losers.mean():+.2%}/week "
                   f"[{a2:+.2%}, {b2:+.2%}], short universe {wk.short_universe.mean():+.2%}; losers minus universe {ex.mean():+.2%} "
                   f"[{lo:+.2%}, {hi:+.2%}]")
        verdict["C1"] = verdict.get("C1", True) and lo > 0
    pd.concat(W).to_csv(f"{HERE}/weekly.csv.gz", index=False, float_format="%.6g")
    out.append("")
    out.append("decision: " + "; ".join(f"{k} {'HOLDS' if ok else 'fails'}" for k, ok in verdict.items()))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
