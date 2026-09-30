"""Portfolio view of the surviving crypto entries: what would running them together have looked like? Descriptive only.

Rules, fixed before the run:
- Universe: BTC, ETH and the 15 holdout coins (17), 4h bars, 2018-01-01 to 2026-09.
- Strategies: B1 (S2b breakout), trendline_break_strong and line_break_ridge; each alone and all three together.
- Entry at the next 4h open after a signal; stop and target as the signal gives (B1's target is 2R from the signal
  close). Stop first when both touch; time exit at the close of the signal's last bar.
- Sizing: risk 0.5% of current equity per trade over the stop distance. At most 10 open positions, one per coin and
  strategy, and total notional at most 3x equity; a signal that does not fit is skipped.
- Costs: 0.06% per side on notional, plus funding of 0.01% of notional every 8 hours, always paid.
- Equity is marked to market at every 4h close.
Every coin here was already used for evidence, so this adds no new evidence. It shows returns, drawdowns and
concurrency. Writes combo/portfolio.txt and combo/fig_portfolio.png.
"""
import os, sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (HERE, os.path.join(HERE, "candidates"), ROOT):
    sys.path.insert(0, p)
import harness as H  # noqa: E402
import line_break_ridge as C3  # noqa: E402
import ronnie_bt as RB  # noqa: E402
import trendline_break_strong as C2  # noqa: E402
from evaluate import COINS, holdout_bars  # noqa: E402

START = pd.Timestamp("2018-01-01", tz="UTC")
RISK, MAX_POS, MAX_LEV = 0.005, 10, 3.0
FEE, FUND_8H = 0.0006, 0.0001
STRATS = ("B1", "trendline", "ridge")
COLORS = {"B1": "#2a78d6", "trendline": "#eb6834", "ridge": "#1baf7a", "all three": "#0b0b0b"}


def b1_signals(bars):
    d4 = bars["4h"]
    lo, sh = RB.signals(d4, RB.features(d4))
    c, h, l = d4.close.values, d4.high.values, d4.low.values
    out = []
    for i in np.flatnonzero((lo | sh).values):
        side = 1 if lo.values[i] else -1
        stop = l[i] if side == 1 else h[i]
        if (c[i] - stop) * side > 0:
            out.append(H.Signal(d4.index[i] + pd.Timedelta(hours=4), side, stop, c[i] + side * 2 * abs(c[i] - stop), 30))
    return out


def trade_path(d4, s):
    """(entry time, exit time, entry px, exit px) under the harness fill model, or None."""
    close_t = d4.index + pd.Timedelta(hours=4)
    i = int(np.searchsorted(close_t, s.time))
    e = i + 1
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    n = int(min(s.max_bars, 60))
    if e + n >= len(c) or (o[e] - s.stop) * s.side <= 0 or (s.target - o[e]) * s.side <= 0:
        return None
    for j in range(e, e + n + 1):
        if s.side == 1 and l[j] <= s.stop or s.side == -1 and h[j] >= s.stop:
            return d4.index[e], close_t[j], o[e], (min(o[j], s.stop) if s.side == 1 else max(o[j], s.stop))
        if j > e and (s.side == 1 and h[j] >= s.target or s.side == -1 and l[j] <= s.target):
            return d4.index[e], close_t[j], o[e], (max(o[j], s.target) if s.side == 1 else min(o[j], s.target))
    return d4.index[e], close_t[e + n], o[e], c[e + n]


def simulate(trades, closes):
    """trades: DataFrame(coin, strat, side, stop, t_in, t_out, px_in, px_out). closes: 4h close per coin (ffilled)."""
    grid = closes.index
    eq_cash = 1.0
    open_pos = []
    curve = np.empty(len(grid))
    taken = 0
    by_in = trades.sort_values("t_in").groupby("t_in")
    ins = {t: g for t, g in by_in}
    for k, t in enumerate(grid):
        # exits at this close
        still = []
        for p in open_pos:
            if p["t_out"] <= t:
                pnl = p["side"] * (p["px_out"] - p["px_in"]) * p["qty"] - p["px_out"] * p["qty"] * FEE
                eq_cash += pnl
            else:
                still.append(p)
        open_pos = still
        # funding on open notional, every 8 hours (every second 4h close)
        if k % 2 == 0:
            eq_cash -= sum(abs(p["qty"]) * closes.at[t, p["coin"]] for p in open_pos) * FUND_8H
        mtm = eq_cash + sum(p["side"] * (closes.at[t, p["coin"]] - p["px_in"]) * p["qty"] for p in open_pos)
        # entries that open at this bar (t is the entry bar's open, the previous close)
        for _, r in (ins.get(t, pd.DataFrame()).iterrows()):
            if len(open_pos) >= MAX_POS or any(p["coin"] == r.coin and p["strat"] == r.strat for p in open_pos):
                continue
            qty = RISK * mtm / abs(r.px_in - r.stop)
            notional = sum(abs(p["qty"]) * closes.at[t, p["coin"]] for p in open_pos)
            if notional + qty * r.px_in > MAX_LEV * mtm:
                continue
            eq_cash -= qty * r.px_in * FEE
            open_pos.append(dict(coin=r.coin, strat=r.strat, side=r.side, qty=qty, px_in=r.px_in, px_out=r.px_out, t_out=r.t_out))
            taken += 1
        curve[k] = eq_cash + sum(p["side"] * (closes.at[t, p["coin"]] - p["px_in"]) * p["qty"] for p in open_pos)
    return pd.Series(curve, index=grid), taken


def stats(curve):
    daily = curve.resample("1D").last().dropna()
    r = daily.pct_change().dropna()
    yrs = (daily.index[-1] - daily.index[0]).days / 365.25
    return dict(CAGR=daily.iloc[-1] ** (1 / yrs) - 1, maxDD=(daily / daily.cummax() - 1).min(),
                Sharpe=r.mean() / r.std() * np.sqrt(365) if r.std() > 0 else np.nan, total=daily.iloc[-1] - 1)


def main():
    coins = {"BTCUSD": H.load("BTCUSD"), "ETHUSDT": H.load("ETHUSDT")}
    coins.update({c: holdout_bars(c) for c in COINS})
    rows, closes = [], {}
    for name, bars in coins.items():
        d4 = bars["4h"]
        closes[name] = pd.Series(d4.close.values, index=d4.index + pd.Timedelta(hours=4))
        for strat, fn in (("B1", b1_signals), ("trendline", C2.signals), ("ridge", C3.signals)):
            for s in fn(bars):
                if s.time < START:
                    continue
                p = trade_path(d4, s)
                if p:
                    rows.append(dict(coin=name, strat=strat, side=s.side, stop=s.stop, t_in=p[0], t_out=p[1], px_in=p[2], px_out=p[3]))
        print(f"{name}: {sum(r['coin'] == name for r in rows)} trades", flush=True)
    trades = pd.DataFrame(rows)
    grid = pd.date_range(START, trades.t_out.max(), freq="4h")
    cl = pd.DataFrame({k: v[~v.index.duplicated()].reindex(grid, method="ffill") for k, v in closes.items()})
    trades["t_in"] = trades.t_in  # entry bar open = previous 4h close on the grid
    out = ["Portfolio view (descriptive; every coin already used for evidence). Risk 0.5%/trade, <=10 positions, <=3x notional, "
           "0.06%/side, funding 0.01%/8h always paid"]
    curves = {}
    for label, keep in (("B1", ["B1"]), ("trendline", ["trendline"]), ("ridge", ["ridge"]), ("all three", list(STRATS))):
        c, taken = simulate(trades[trades.strat.isin(keep)], cl)
        curves[label] = c
        st = stats(c)
        yearly = c.resample("YE").last()
        yr = (yearly / yearly.shift(1).fillna(1.0) - 1)
        out.append(f"  {label:<10} trades taken {taken:5d} of {int(trades.strat.isin(keep).sum()):5d}  CAGR {st['CAGR']:+.1%}  "
                   f"maxDD {st['maxDD']:.1%}  Sharpe {st['Sharpe']:.2f}  total {st['total']:+.0%}")
        out.append("      by year: " + ", ".join(f"{d.year} {v:+.0%}" for d, v in yr.items()))
    fig, ax = plt.subplots(figsize=(11, 5.5), facecolor="#fcfcfb")
    ax.set_facecolor("#fcfcfb")
    for label, c in curves.items():
        d = c.resample("1D").last()
        ax.plot(d.index, d.values, color=COLORS[label], lw=2 if label == "all three" else 1.5, label=label)
        ax.annotate(label, (d.index[-1], d.values[-1]), xytext=(4, 0), textcoords="offset points", fontsize=9, color="#0b0b0b", va="center")
    ax.set_yscale("log")
    ax.set_ylabel("equity (start 1.0, log scale)", color="#52514e")
    ax.grid(color="#e6e5e0", lw=0.8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.legend(frameon=False, fontsize=9, loc="upper left")
    ax.set_title("Crypto line-break and breakout entries on 17 coins, 0.5% risk per trade (descriptive, not new evidence)",
                 loc="left", fontsize=11, color="#0b0b0b")
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, "fig_portfolio.png"), dpi=110)
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "portfolio.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
