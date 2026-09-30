"""TrialFamily trend-v1: daily trend following (T0) with line-guided execution variants, and cross-sectional momentum
(C0). See INTENT.md. Writes trend/trades.csv.gz, trend/weekly.csv.gz and trend/result.txt.
"""
import importlib.util, os, sys

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


MT = _load("mtf_run", "mtf/run.py")  # level_book, atr_of

ENTRY_N, EXIT_N, STOP_ATR, MAX_DAYS, RETEST_DAYS = 50, 20, 2.0, 250, 10
FEE, FUND_DAY, CONTROLS = 0.0006, 0.0003, 20
MOM_N, TOP = 28, 0.2
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
DEV_C0 = (pd.Timestamp("2019-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
HOLD = (pd.Timestamp("2023-10-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
DEV_COINS = ("BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "LTC", "TRX", "LINK", "DOT", "AVAX", "BCH", "ETC", "XLM",
             "ATOM", "FIL")
HOLDOUT = ("GNO", "PUNDIX", "HFT", "MAGIC", "GMX", "LQTY", "SSV", "ID", "EDU", "ARKM", "WLD", "APT", "ARB", "SUI", "PENDLE",
           "JOE", "OSMO", "XNO", "POLYX", "STG")
USED_SETS = (("filters2/run.py", "COINS"), ("patterns/run.py", "HOLDOUT"), ("mtf/run.py", "HOLDOUT"),
             ("volume/run.py", "HOLDOUT"), ("volume2/run.py", "HOLDOUT"), ("patterns2/run.py", "HOLDOUT"))
AGG = {"open": "first", "high": "max", "low": "min", "close": "last"}


def daily(coin):
    import tv_hourly
    t0, t1 = int(pd.Timestamp("2017-07-01").value // 10**9), int(pd.Timestamp("2026-09-01").value // 10**9)
    h = tv_hourly.binance(f"{coin}USDT", t0, t1).drop_duplicates("time").sort_values("time")
    if h.empty:
        return None
    h.index = pd.to_datetime(h.time, unit="s", utc=True)
    return h[["open", "high", "low", "close"]].resample("1D", label="left", closed="left").agg(AGG).dropna()


def run_trade(o, h, l, c, e, side, entry, stop, tp=None):
    """-> (exit index, R net of fees and funding). Stop intraday (gap fills at the open), target intraday from the day
    after entry, channel exit at the close."""
    risk = (entry - stop) * side
    n = len(c)
    for j in range(e, min(e + MAX_DAYS, n)):
        if (l[j] <= stop) if side == 1 else (h[j] >= stop):
            px = min(o[j], stop) if side == 1 and j > e else max(o[j], stop) if j > e else stop
            break
        if tp is not None and j > e and ((h[j] >= tp) if side == 1 else (l[j] <= tp)):
            px = max(o[j], tp) if side == 1 else min(o[j], tp)
            break
        if j >= EXIT_N and ((c[j] < c[j - EXIT_N:j].min()) if side == 1 else (c[j] > c[j - EXIT_N:j].max())):
            px = c[j]
            break
    else:
        j = min(e + MAX_DAYS, n) - 1
        px = c[j]
    days = j - e + 1
    return j, side * (px - entry) / risk - FEE * (entry + px) / risk - FUND_DAY * days * entry / risk


def trend_trades(coin, d1, t0, t1, rng):
    o, h, l, c = (d1[x].values for x in ("open", "high", "low", "close"))
    n = len(c)
    atr = MT.atr_of(h, l, c, 20)
    dbook = MT.level_book(d1, MT.D_K, False)
    w1 = d1.resample("W-MON", label="left", closed="left").agg(AGG).dropna()
    wbook = MT.level_book(w1, MT.W_K, False)
    wc = w1.close.values
    years = d1.index.year.values
    pool_ok = (np.arange(n) > ENTRY_N + 30) & (np.arange(n) < n - 2)
    rows = []
    busy = {1: -1, -1: -1}
    for i in range(ENTRY_N + 30, n - 1):
        day = d1.index[i + 1]
        if not t0 <= day < t1:
            continue
        for side in (1, -1):
            if i <= busy[side]:
                continue
            ref = c[i - ENTRY_N:i].max() if side == 1 else c[i - ENTRY_N:i].min()
            if (c[i] - ref) * side <= 0:
                continue
            e, entry = i + 1, o[i + 1]
            stop0 = entry - side * STOP_ATR * atr[i]
            xj, r0 = run_trade(o, h, l, c, e, side, entry, stop0)
            busy[side] = xj
            # E-line: limit at the broken level for RETEST_DAYS days
            r_e = 0.0
            for j in range(i + 1, min(i + 1 + RETEST_DAYS, n)):
                if (l[j] <= ref) if side == 1 else (h[j] >= ref):
                    fill = min(o[j], ref) if side == 1 else max(o[j], ref)
                    _, r_e = run_trade(o, h, l, c, j, side, fill, fill - side * STOP_ATR * atr[i])
                    break
            # S-line: stop behind the nearest intact daily swing level on the stop side
            Y, S = dbook[e][0], dbook[e][1]
            cand = Y[(S == -side) & ((entry - Y) * side > 0)]
            stop_s = stop0
            if len(cand):
                y = cand.max() if side == 1 else cand.min()
                s_try = y - side * 0.25 * atr[i]
                if 1.0 <= (entry - s_try) * side / atr[i] <= 6.0:
                    stop_s = s_try
            _, r_s = run_trade(o, h, l, c, e, side, entry, stop_s)
            # X-line: take profit at the nearest intact weekly level beyond the entry, if at least 2R away
            w = int(w1.index.searchsorted(day, side="right")) - 1
            tp = None
            if w >= 1:
                Yw, Sw = wbook[w][0], wbook[w][1]
                far = Yw[(Sw == side) & ((Yw - entry) * side > 0)]
                if len(far):
                    y = far.min() if side == 1 else far.max()
                    if (y - entry) * side >= 2 * STOP_ATR * atr[i]:
                        tp = y
            _, r_x = run_trade(o, h, l, c, e, side, entry, stop0, tp)
            # F-mtf: last closed weekly close vs the mean of the 20 closed weeks before it
            wk = wc[w - 20:w] if w >= 21 else None
            f_ok = bool(wk is not None and (wc[w - 1] - wk.mean()) * side > 0)
            # control: random entries, same coin, year and side, same rules
            pool = np.flatnonzero(pool_ok & (years == years[e]))
            ctl = []
            for j in rng.choice(pool, CONTROLS):
                en = o[j]
                ctl.append(run_trade(o, h, l, c, j, side, en, en - side * STOP_ATR * atr[j - 1])[1])
            rows.append(dict(coin=coin, time=day, side=side, R=r0, control=float(np.mean(ctl)), E=r_e, S=r_s, X=r_x,
                             weekly_ok=f_ok, days=xj - e + 1, x_has_tp=tp is not None))
    return rows


def c0_weeks(closes, opens, t0, t1):
    """Weekly top-fifth, bottom-fifth and universe returns (Monday open to Monday open), with turnover costs."""
    mondays = [d for d in closes.index if d.weekday() == 0 and t0 <= d < t1]
    rows, prev_top, prev_bot = [], set(), set()
    for d in mondays:
        k = closes.index.get_loc(d)
        if k < MOM_N + 1 or k + 7 >= len(closes):
            continue
        past = closes.iloc[k - 1] / closes.iloc[k - 1 - MOM_N] - 1  # the last closed day, 28 days back
        fwd = opens.iloc[k + 7] / opens.iloc[k] - 1
        ok = past.notna() & fwd.notna()
        if ok.sum() < 10:
            continue
        p, f = past[ok], fwd[ok]
        q = max(1, int(len(p) * TOP))
        top, bot = set(p.nlargest(q).index), set(p.nsmallest(q).index)
        cost_t = FEE * 2 * (len(top - prev_top) / q if prev_top else 1.0)
        cost_b = FEE * 2 * (len(bot - prev_bot) / q if prev_bot else 1.0)
        rows.append(dict(week=d, n=len(p), top=f[list(top)].mean() - cost_t, bottom=f[list(bot)].mean() - cost_b, universe=f.mean()))
        prev_top, prev_bot = top, bot
    return pd.DataFrame(rows)


def boot(v, groups=None, level=95, seed=8, reps=4000):
    rng = np.random.default_rng(seed)
    v = pd.Series(np.asarray(v, float))
    if groups is None:
        b = rng.choice(v.values, size=(reps, len(v))).mean(1)
    else:
        gs = [g.values for _, g in v.groupby(np.asarray(groups))]
        b = [np.concatenate([gs[k][rng.integers(0, len(gs[k]), len(gs[k]))] for k in rng.integers(0, len(gs), len(gs))]).mean()
             for _ in range(reps)]
    q = (100 - level) / 2
    return np.percentile(b, q), np.percentile(b, 100 - q)


def main():
    rng = np.random.default_rng(53)
    days = {}
    for coin in DEV_COINS + HOLDOUT:
        days[coin] = daily(coin)
    rows = []
    for coin in DEV_COINS:
        rows += [dict(r, set="dev") for r in trend_trades(coin, days[coin], *DEV, rng)]
    for coin in HOLDOUT:
        if days[coin] is not None:
            rows += [dict(r, set="holdout") for r in trend_trades(coin, days[coin], *HOLD, rng)]
        print(f"{coin}: {sum(r['coin'] == coin for r in rows)} trend trades", flush=True)
    T = pd.DataFrame(rows)
    T.to_csv(os.path.join(HERE, "trades.csv.gz"), index=False, float_format="%.6g")
    out = ["trend-v1 (INTENT.md): 50-day close breakout, 2 ATR stop, 20-day close exit; line-guided variants paired", ""]
    ok = {}
    for s in ("dev", "holdout"):
        z = T[T.set == s]
        g = z.coin if s == "holdout" else None
        out.append(f"{s} ({'17 coins 2018-2022' if s == 'dev' else '20 unused coins 2023-10 to 2026-08'}): {len(z)} trades, "
                   f"median {z.days.median():.0f} days held")
        lo, hi = boot(z.R - z.control, g)
        out.append(f"  T0 avg R {z.R.mean():+.3f}  win {np.mean(z.R > 0):.0%}  control {z.control.mean():+.3f}  "
                   f"minus control {(z.R - z.control).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
        ok[(s, "T0")] = lo
        for sd, name in ((1, "long"), (-1, "short")):
            k = z[z.side == sd]
            a, b = boot(k.R - k.control, k.coin if s == "holdout" else None)
            out.append(f"     {name:<5} n {len(k):4d}  avg R {k.R.mean():+.3f}  minus control {(k.R - k.control).mean():+.3f} [{a:+.3f}, {b:+.3f}]")
        for v, label in (("E", "E-line retest entry (miss = 0R)"), ("S", "S-line stop behind structure"),
                         ("X", "X-line target at weekly level")):
            d = z[v] - z.R
            a, b = boot(d, g)
            extra = f", filled {np.mean(z.E != 0):.0%}" if v == "E" else f", target set on {z.x_has_tp.mean():.0%}" if v == "X" else ""
            out.append(f"  {label:<32} avg R {z[v].mean():+.3f}  minus T0 {d.mean():+.3f} [{a:+.3f}, {b:+.3f}]{extra}")
            ok[(s, v)] = a
        kept, drop = z[z.weekly_ok], z[~z.weekly_ok]
        rng2 = np.random.default_rng(9)
        diffs = []
        for _ in range(4000):
            if s == "holdout":
                cs = rng2.choice(z.coin.unique(), z.coin.nunique())
                zz = pd.concat([z[z.coin == cc].sample(frac=1, replace=True, random_state=int(rng2.integers(1e9))) for cc in cs])
            else:
                zz = z.sample(frac=1, replace=True, random_state=int(rng2.integers(1e9)))
            diffs.append(zz[zz.weekly_ok].R.mean() - zz[~zz.weekly_ok].R.mean())
        a, b = np.nanpercentile(diffs, [2.5, 97.5])
        out.append(f"  F-mtf weekly filter: kept {len(kept)} avg R {kept.R.mean():+.3f}, dropped {len(drop)} avg R {drop.R.mean():+.3f}; "
                   f"kept minus dropped {kept.R.mean() - drop.R.mean():+.3f} [{a:+.3f}, {b:+.3f}]")
        ok[(s, "F")] = a
        out.append("")
    # C0
    uni = list(DEV_COINS)
    for path, attr in USED_SETS:
        uni += list(getattr(_load(path.replace("/", "_"), path), attr))
    for coin in uni:
        if coin not in days:
            days[coin] = daily(coin)
    W = []
    for label, coins, (t0, t1) in (("dev", uni, DEV_C0), ("holdout", HOLDOUT, HOLD)):
        cl = pd.DataFrame({k: days[k].close for k in coins if days[k] is not None})
        op = pd.DataFrame({k: days[k].open for k in coins if days[k] is not None})
        wk = c0_weeks(cl, op, t0, t1).assign(set=label)
        W.append(wk)
        ex, ls = wk.top - wk.universe, wk.top - wk.bottom
        a, b = boot(ex)
        a2, b2 = boot(ls)
        out.append(f"C0 {label}: {len(wk)} weeks, median universe {wk.n.median():.0f} coins; weekly top {wk.top.mean():+.2%}, "
                   f"universe {wk.universe.mean():+.2%}, bottom {wk.bottom.mean():+.2%}")
        out.append(f"   top minus universe {ex.mean():+.2%} per week [{a:+.2%}, {b:+.2%}]; top minus bottom {ls.mean():+.2%} [{a2:+.2%}, {b2:+.2%}]")
        ok[(label, "C0")] = a
    pd.concat(W).to_csv(os.path.join(HERE, "weekly.csv.gz"), index=False, float_format="%.6g")
    both = lambda k: ok[("dev", k)] > 0 and ok[("holdout", k)] > 0  # noqa: E731
    out.append("")
    out.append("Decision: T0 " + ("HOLDS" if both("T0") else "fails") + "; " +
               "; ".join(f"{n} {'adopted' if both(k) else 'not adopted'}" for k, n in
                         (("E", "E-line"), ("S", "S-line"), ("X", "X-line"), ("F", "F-mtf"))) +
               f"; C0 {'HOLDS' if both('C0') else 'fails'}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
