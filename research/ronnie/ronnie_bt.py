"""Ad-hoc backtest of an interpretation of Ronnie S2b (large-body breakout) with F1(c) (Bollinger state filter).

Scratch analysis, not the repository's Owner path. Signals are computed on a closed 4h bar and filled at the
next bar's open. Intrabar, if both the stop and the target are touched, the stop is assumed first.
"""
import sys
import numpy as np
import pandas as pd

COST = 0.0006  # per side: 0.05% taker + 0.01% slippage
RISK = 0.01    # fraction of equity risked per trade
MAX_LEV = 3.0


def load(path="btc_4h.csv"):
    d = pd.read_csv(path, index_col=0, parse_dates=True)
    d = d[d.volume > 0]
    return d


def features(d, atr_n=14, bb_n=20, bb_k=2.0, bw_look=120):
    h, l, c, o = d.high, d.low, d.close, d.open
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    f = pd.DataFrame(index=d.index)
    f["atr"] = tr.ewm(alpha=1 / atr_n, adjust=False).mean().shift(1)  # ATR known before this bar
    mid = c.rolling(bb_n).mean()
    sd = c.rolling(bb_n).std(ddof=0)
    f["bw"] = (2 * bb_k * sd) / mid
    f["bw_pct"] = f["bw"].rolling(bw_look).rank(pct=True)
    f["mid"] = mid
    return f


def signals(d, f, body_mult=1.5, look=20, close_pos=0.75, bb_filter=False, squeeze_pct=0.3, squeeze_within=10):
    o, h, l, c = d.open, d.high, d.low, d.close
    body = (c - o).abs()
    rng = (h - l).replace(0, np.nan)
    big = body >= body_mult * f["atr"]
    hh = h.shift(1).rolling(look).max()
    ll = l.shift(1).rolling(look).min()
    long_ = big & (c > o) & ((c - l) / rng >= close_pos) & (c > hh)
    short = big & (c < o) & ((h - c) / rng >= close_pos) & (c < ll)
    if bb_filter:
        squeezed = (f["bw_pct"] <= squeeze_pct).rolling(squeeze_within).max().astype(bool)
        long_ &= squeezed & (c > f["mid"])
        short &= squeezed & (c < f["mid"])
    return long_.fillna(False), short.fillna(False)


def backtest(d, long_, short, rr=2.0, max_hold=30, stop_dist=None):
    o, h, l = d.open.values, d.high.values, d.low.values
    lo_sig, sh_sig = long_.values, short.values
    idx = d.index
    eq = 1.0
    curve = np.ones(len(d))
    trades = []
    pos = None
    for i in range(1, len(d)):
        if pos is None and (lo_sig[i - 1] or sh_sig[i - 1]):
            side = 1 if lo_sig[i - 1] else -1
            entry = o[i]
            stop = l[i - 1] if side == 1 else h[i - 1]
            if stop_dist is not None:
                stop = entry - side * stop_dist[i - 1]
            risk_px = (entry - stop) * side
            if risk_px > 0:
                qty = min(RISK * eq / risk_px, MAX_LEV * eq / entry)
                pos = dict(side=side, entry=entry, stop=stop, tp=entry + side * rr * risk_px, qty=qty, i0=i, t0=idx[i])
                eq -= qty * entry * COST
        if pos is not None:
            s = pos["side"]
            hit_stop = (l[i] <= pos["stop"]) if s == 1 else (h[i] >= pos["stop"])
            hit_tp = (h[i] >= pos["tp"]) if s == 1 else (l[i] <= pos["tp"])
            exit_px = None
            if hit_stop:
                exit_px = min(o[i], pos["stop"]) if s == 1 else max(o[i], pos["stop"])  # gap through stop
                why = "stop"
            elif hit_tp:
                exit_px, why = pos["tp"], "target"
            elif i - pos["i0"] >= max_hold:
                exit_px, why = d.close.values[i], "time"
            if exit_px is not None:
                pnl = pos["qty"] * (exit_px - pos["entry"]) * s - pos["qty"] * exit_px * COST
                r_mult = (exit_px - pos["entry"]) * s / abs(pos["entry"] - pos["stop"])
                eq += pnl
                trades.append(dict(entry_time=pos["t0"], exit_time=idx[i], side="L" if s == 1 else "S",
                                   entry=pos["entry"], exit=exit_px, why=why, R=r_mult, pnl_pct=pnl / (eq - pnl)))
                pos = None
        mtm = eq if pos is None else eq + pos["qty"] * (d.close.values[i] - pos["entry"]) * pos["side"]
        curve[i] = mtm
    return pd.Series(curve, index=idx), pd.DataFrame(trades)


def stats(curve, trades, label):
    years = (curve.index[-1] - curve.index[0]).days / 365.25
    total = curve.iloc[-1] / curve.iloc[0] - 1
    cagr = (curve.iloc[-1] / curve.iloc[0]) ** (1 / years) - 1 if years > 0 else np.nan
    dd = (curve / curve.cummax() - 1).min()
    daily = curve.resample("1D").last().pct_change().dropna()
    sharpe = daily.mean() / daily.std() * np.sqrt(365) if daily.std() > 0 else np.nan
    n = len(trades)
    win = (trades.R > 0).mean() if n else np.nan
    pf = trades.loc[trades.pnl_pct > 0, "pnl_pct"].sum() / -trades.loc[trades.pnl_pct < 0, "pnl_pct"].sum() if n and (trades.pnl_pct < 0).any() else np.nan
    return dict(label=label, trades=n, win=win, avgR=trades.R.mean() if n else np.nan, PF=pf,
                total=total, CAGR=cagr, maxDD=dd, Sharpe=sharpe)


def run(d, f, start, end, label, **kw):
    bb = kw.pop("bb_filter", False)
    sig_kw = {k: v for k, v in kw.items() if k in ("body_mult", "look", "close_pos", "squeeze_pct", "squeeze_within")}
    bt_kw = {k: v for k, v in kw.items() if k in ("rr", "max_hold")}
    lo, sh = signals(d, f, bb_filter=bb, **sig_kw)
    m = (d.index >= start) & (d.index < end)
    curve, trades = backtest(d[m], lo[m], sh[m], **bt_kw)
    return stats(curve, trades, label), curve, trades


if __name__ == "__main__":
    d = load()
    f = features(d)
    periods = [("2017-01-01", "2023-01-01", "IS 2017-2022"), ("2023-01-01", "2027-01-01", "OOS 2023-2026")]
    rows = []
    for start, end, pname in periods:
        seg = d[(d.index >= start) & (d.index < end)]
        bh = seg.close.iloc[-1] / seg.open.iloc[0] - 1
        yrs = (seg.index[-1] - seg.index[0]).days / 365.25
        bh_dd = (seg.close / seg.close.cummax() - 1).min()
        rows.append(dict(label=f"{pname} | BTC buy&hold", trades=1, total=bh, CAGR=(1 + bh) ** (1 / yrs) - 1, maxDD=bh_dd))
        for bb in (False, True):
            name = "S2b + F1(c)" if bb else "S2b"
            s, curve, trades = run(d, f, start, end, f"{pname} | {name}", bb_filter=bb)
            rows.append(s)
            trades.to_csv(f"trades_{'s2b_f1' if bb else 's2b'}_{start[:4]}.csv", index=False)
            curve.to_csv(f"curve_{'s2b_f1' if bb else 's2b'}_{start[:4]}.csv")
    pd.set_option("display.width", 200)
    out = pd.DataFrame(rows).set_index("label")
    print(out.to_string(float_format=lambda x: f"{x:,.3f}"))

    print("\nParameter neighbourhood, full 2017-2026 (S2b + F1(c)); every cell is one more trial:")
    grid = []
    for bm in (1.2, 1.5, 2.0):
        for lk in (10, 20, 40):
            for rr in (1.5, 2.0, 3.0):
                s, _, _ = run(d, f, "2017-01-01", "2027-01-01", f"body{bm} look{lk} rr{rr}", bb_filter=True, body_mult=bm, look=lk, rr=rr)
                grid.append(s)
    g = pd.DataFrame(grid).set_index("label")[["trades", "win", "avgR", "PF", "CAGR", "maxDD", "Sharpe"]]
    print(g.to_string(float_format=lambda x: f"{x:,.3f}"))
    print(f"\ncells with CAGR>0: {(g.CAGR > 0).sum()}/{len(g)}; median Sharpe {g.Sharpe.median():.2f}")
