"""Portfolio view of long-only daily trend following on the majors (spot, no leverage). Descriptive; rules fixed before
the run:
- Signals as trend-v1 T0, long only: close above the prior 50-day closing high, entry at the next open, initial stop
  entry - 2 ATR(20), exit at the close below the prior 20-day closing low or at the stop (gaps fill at the open).
- Sizing: risk 1% of equity per trade (0.5% also shown); total notional at most 1x equity (spot); one trade per coin.
  A signal that does not fit is scaled down to the room left; under 10% of its size it is skipped.
- Costs: 0.1% per side (Binance spot), no funding.
- Books: the 17 majors; BTC, ETH and SOL only. Benchmarks: hold BTC; hold the 17 equally weighted (rebalanced monthly).
Writes trend/portfolio.txt and trend/fig_portfolio.png.
"""
import importlib.util, os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("trend_run", os.path.join(HERE, "run.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)

START, END = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC")
FEE, MAX_LEV = 0.001, 1.0
COLORS = {"trend 17 majors, 1% risk": "#0b0b0b", "trend 17 majors, 0.5% risk": "#8a8984",
          "trend BTC+ETH+SOL, 1% risk": "#2a78d6", "hold BTC": "#eb6834", "hold 17 equal weight": "#1baf7a"}


def trades(coin, d1):
    o, h, l, c = (d1[x].values for x in ("open", "high", "low", "close"))
    atr = T.MT.atr_of(h, l, c, 20)
    out, busy = [], -1
    for i in range(T.ENTRY_N + 30, len(c) - 1):
        if i <= busy or not START <= d1.index[i + 1] < END or c[i] <= c[i - T.ENTRY_N:i].max():
            continue
        e, entry = i + 1, o[i + 1]
        stop = entry - T.STOP_ATR * atr[i]
        for j in range(e, len(c)):
            if l[j] <= stop:
                px = min(o[j], stop) if j > e else stop
                break
            if c[j] < c[j - T.EXIT_N:j].min():
                px = c[j]
                break
        else:
            j, px = len(c) - 1, c[-1]
        busy = j
        out.append(dict(coin=coin, t_in=d1.index[e], t_out=d1.index[j], px_in=entry, px_out=px, stop=stop))
    return out


def simulate(tr, closes, risk):
    grid = closes.index
    cash, pos, curve, invested = 1.0, [], [], []
    ins = {t: g for t, g in tr.groupby("t_in")}
    for t in grid:
        # entries at today's open (valued at the open price), exits at their own day (close or stop price)
        mtm_open = cash + sum(p["qty"] * closes.at[t, p["coin"]] for p in pos)  # yesterday's closes carried
        for _, r in ins.get(t, pd.DataFrame()).iterrows():
            if any(p["coin"] == r.coin for p in pos):
                continue
            want = risk * mtm_open / (r.px_in - r.stop)
            room = MAX_LEV * mtm_open - sum(p["qty"] * closes.at[t, p["coin"]] for p in pos)
            qty = min(want, max(room, 0) / r.px_in, cash / (r.px_in * (1 + FEE)))
            if qty < 0.1 * want:
                continue
            cash -= qty * r.px_in * (1 + FEE)
            pos.append(dict(coin=r.coin, qty=qty, t_out=r.t_out, px_out=r.px_out))
        keep = []
        for p in pos:
            if p["t_out"] <= t:
                cash += p["qty"] * p["px_out"] * (1 - FEE)
            else:
                keep.append(p)
        pos = keep
        val = sum(p["qty"] * closes.at[t, p["coin"]] for p in pos)
        curve.append(cash + val)
        invested.append(val / (cash + val))
    return pd.Series(curve, index=grid), pd.Series(invested, index=grid)


def stats(d):
    r = d.pct_change().dropna()
    yrs = (d.index[-1] - d.index[0]).days / 365.25
    cagr = (d.iloc[-1] / d.iloc[0]) ** (1 / yrs) - 1
    dd = (d / d.cummax() - 1).min()
    return cagr, dd, r.mean() / r.std() * np.sqrt(365), d.iloc[-1] / d.iloc[0] - 1


def main():
    days = {c: T.daily(c) for c in T.DEV_COINS}
    grid = pd.date_range(START, END - pd.Timedelta(days=1), freq="1D", tz="UTC")
    closes = pd.DataFrame({c: d.close.reindex(grid).ffill() for c, d in days.items()})
    tr = pd.DataFrame([x for c, d in days.items() for x in trades(c, d)])
    curves, inv = {}, {}
    for label, coins, risk in (("trend 17 majors, 1% risk", T.DEV_COINS, 0.01), ("trend 17 majors, 0.5% risk", T.DEV_COINS, 0.005),
                               ("trend BTC+ETH+SOL, 1% risk", ("BTC", "ETH", "SOL"), 0.01)):
        curves[label], inv[label] = simulate(tr[tr.coin.isin(coins)], closes, risk)
    curves["hold BTC"] = closes.BTC / closes.BTC.iloc[0]
    # equal weight, rebalanced monthly, over the coins listed at each rebalance
    eq, val = [], 1.0
    rets = closes.pct_change().fillna(0)
    w = None
    for t in grid:
        if w is None or t.day == 1:
            live = closes.loc[t].notna() & (closes.loc[:t].count() > 30)
            w = live / live.sum()
        val *= 1 + (rets.loc[t] * w).sum()
        eq.append(val)
    curves["hold 17 equal weight"] = pd.Series(eq, index=grid)
    out = ["Long-only daily trend following on the majors, spot, 0.1%/side, at most 1x invested (descriptive; development coins)",
           f"{len(tr)} trades on 17 coins, 2018-01 to 2026-08", "",
           "book                          CAGR     maxDD   Sharpe   total      avg invested"]
    for k, cv in curves.items():
        cagr, dd, sh, tot = stats(cv)
        iv = f"{inv[k].mean():.0%}" if k in inv else "100%"
        out.append(f"{k:<29} {cagr:+7.1%}  {dd:7.1%}  {sh:6.2f}  {tot:+8.0%}    {iv}")
    out.append("")
    out.append("by year: " + "  ".join(f"{y}" for y in range(2018, 2027)))
    for k, cv in curves.items():
        yr = cv.resample("YE").last()
        prev = pd.concat([pd.Series([cv.iloc[0]]), yr.iloc[:-1]]).values
        out.append(f"  {k:<29} " + "  ".join(f"{v:+.0%}" for v in yr.values / prev - 1))
    fig, ax = plt.subplots(figsize=(11, 5.5), facecolor="#fcfcfb")
    ax.set_facecolor("#fcfcfb")
    for k, cv in curves.items():
        ax.plot(cv.index, cv.values, color=COLORS[k], lw=2.2 if k.startswith("trend 17 majors, 1%") else 1.4, label=k)
    ax.set_yscale("log")
    ax.set_ylabel("equity (start 1.0, log scale)", color="#52514e")
    ax.grid(color="#e6e5e0", lw=0.8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.legend(frameon=False, fontsize=9, loc="upper left")
    ax.set_title("Long-only daily trend following on crypto majors vs holding, spot, after fees", loc="left", fontsize=11)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, "fig_portfolio.png"), dpi=110)
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "portfolio.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
