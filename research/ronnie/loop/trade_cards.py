"""Trade cards for visual review (the user's suggestion): each trade drawn with the 60 bars before and 40 after entry,
entry, stop, target and exit, and BTC over the same window below. Iteration-tier trades only.

Usage: python loop/trade_cards.py <loop id> <worst|best|random> <n> <out.png>"""
import os, sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402

PRE, POST = 60, 40


def candles(ax, d, x0):
    o, h, l, c = (d[k].values for k in ("open", "high", "low", "close"))
    x = np.arange(len(d)) - x0
    up = c >= o
    ax.vlines(x, l, h, color="#555", lw=0.6)
    ax.bar(x[up], (c - o)[up], bottom=o[up], color="#2a9d8f", width=0.7)
    ax.bar(x[~up], (c - o)[~up], bottom=o[~up], color="#e76f51", width=0.7)


def card(ax, axb, t, tf, hold):
    d = E.bars(t.coin)[tf]
    e = d.index.get_loc(t.time)
    w = d.iloc[max(0, e - PRE):e + POST]
    x0 = min(PRE, e)
    candles(ax, w, x0)
    o, h, l, c = (d[k].values for k in ("open", "high", "low", "close"))
    a = E.MT.atr_of(h, l, c)
    entry = o[e]
    risk = t.stop_atr * a[e - 1]
    stop = entry - t.side * risk
    tgt = entry + t.side * t.target_R * risk if t.target_R < 50 else None
    xe = None
    for j in range(e, min(e + hold, len(c))):
        if (l[j] <= stop) if t.side == 1 else (h[j] >= stop):
            xe = j
            break
        if tgt is not None and j > e and ((h[j] >= tgt) if t.side == 1 else (l[j] <= tgt)):
            xe = j
            break
    xe = xe if xe is not None else min(e + hold - 1, len(c) - 1)
    ax.axvspan(0, xe - e, color="#ffd166", alpha=0.25)
    ax.axhline(entry, color="#264653", lw=0.8)
    ax.axhline(stop, color="#e63946", lw=0.8, ls="--")
    if tgt is not None:
        ax.axhline(tgt, color="#2a9d8f", lw=0.8, ls="--")
    ax.set_title(f"{t.coin} {t.time:%Y-%m-%d %H} {'long' if t.side == 1 else 'short'}  R {t.R:+.2f}  ctl {t.control:+.2f}", fontsize=8)
    ax.tick_params(labelsize=6)
    b = E.bars("BTC")[tf].close.reindex(w.index)
    axb.plot(np.arange(len(w)) - x0, b.values / b.values[x0] - 1, color="#6c757d", lw=0.8)
    axb.axvline(0, color="#264653", lw=0.6)
    axb.axhline(0, color="#adb5bd", lw=0.5)
    axb.tick_params(labelsize=6)
    axb.set_ylabel("BTC", fontsize=6)


def main():
    loop, which, n, path = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    z = pd.read_csv(os.path.join(HERE, "out", f"{loop}_iteration.csv.gz"), parse_dates=["time"])
    tf = "1d" if loop.startswith(("A", "C")) else "4h"
    hold = {"G-1": 12}.get(loop, 10 if loop.startswith("C") else 30)
    pick = z.nsmallest(n, "R") if which == "worst" else z.nlargest(n, "R") if which == "best" else z.sample(n, random_state=1)
    cols = 3
    rows = int(np.ceil(n / cols))
    fig = plt.figure(figsize=(cols * 4.2, rows * 3.4))
    gs = fig.add_gridspec(rows * 3, cols, hspace=0.9, wspace=0.25)
    for k, t in enumerate(pick.itertuples()):
        r, cc = divmod(k, cols)
        ax = fig.add_subplot(gs[r * 3:r * 3 + 2, cc])
        axb = fig.add_subplot(gs[r * 3 + 2, cc], sharex=ax)
        card(ax, axb, t, tf, hold)
    fig.suptitle(f"{loop}: {which} {n} trades (x = bars from entry; yellow = in trade; red dashed = stop)", fontsize=10)
    fig.savefig(path, dpi=110, bbox_inches="tight")
    print(path)


if __name__ == "__main__":
    main()
