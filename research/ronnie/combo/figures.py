"""How the lines evolve bar by bar: three snapshots of the same BTC window, each drawn only from bars closed by then.

Horizontal levels follow level_break_calm_trend (order-3 swing levels, added once confirmed, removed when a close crosses
them); trend lines follow trendline_break_strong (the last two confirmed order-8 swings, redrawn when a new swing
confirms). Writes combo/fig_lines_evolve.png.
"""
import os, sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "candidates"))
import harness as H  # noqa: E402
import level_break_calm_trend as C1  # noqa: E402
import trendline_break_strong as C2  # noqa: E402

SUPPORT, RESIST, TREND = "#2a78d6", "#eb6834", "#1baf7a"
INK, MUTED, GRID, SURFACE = "#0b0b0b", "#8a8984", "#e6e5e0", "#fcfcfb"
WINDOW = ("2023-07-10", "2023-08-26")
SNAPS = ("2023-07-30 20:00", "2023-08-07 16:00", "2023-08-17 00:00")  # 4h closes with signals


def state(h, l, c, i):
    """Active order-3 levels and the order-8 trend lines as known at the close of bar i."""
    k1, k8 = C1.PIVOT_K, C2.PIVOT_K
    ph, pl = C1._pivots(h[:i + 1], l[:i + 1], k1)
    levels = []
    for side, piv, px in ((1, ph, h), (-1, pl, l)):
        act = []
        for j in range(1, i + 1):
            act += [(p, px[p]) for p in piv if p + k1 == j]
            act = [(p, v) for p, v in act if (c[j] - v) * side <= 0]
        levels += [(p, v, side) for p, v in act]
    lines = []
    ph8, pl8 = C2._pivots(h[:i + 1], l[:i + 1], k8)
    for side, piv, px in ((1, ph8, h), (-1, pl8, l)):
        conf = [p for p in piv if p + k8 <= i]
        if len(conf) >= 2:
            j1, j2 = conf[-2], conf[-1]
            falling_highs = side == 1 and px[j2] < px[j1]
            rising_lows = side == -1 and px[j2] > px[j1]
            if (falling_highs or rising_lows) and j2 - j1 >= C2.MIN_SPAN and i - j2 <= C2.MAX_EXT:
                lines.append((j1, px[j1], j2, px[j2], side))
    confirmed = [(p, h[p], 1) for p in ph if p + k1 <= i] + [(p, l[p], -1) for p in pl if p + k1 <= i]
    # the latest swing extreme of the last k bars is visible on the chart but not yet confirmed
    tail = slice(max(0, i - k1 + 1), i + 1)
    pending = [(tail.start + int(np.argmax(h[tail])), h[tail].max(), 1), (tail.start + int(np.argmin(l[tail])), l[tail].min(), -1)]
    return levels, lines, confirmed, pending


def main():
    b = H.load("BTCUSD")
    d4 = b["4h"]
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    t = d4.index + pd.Timedelta(hours=4)  # bar close times
    lo_i = int(np.searchsorted(t, pd.Timestamp(WINDOW[0], tz="UTC")))
    hi_i = int(np.searchsorted(t, pd.Timestamp(WINDOW[1], tz="UTC")))
    sig1 = {s.time: s for s in C1.signals(b)}
    sig2 = {s.time: s for s in C2.signals(b)}
    ymin, ymax = l[lo_i:hi_i].min() * 0.985, h[lo_i:hi_i].max() * 1.012
    fig, axes = plt.subplots(3, 1, figsize=(11, 11), sharex=True, facecolor=SURFACE)
    for ax, snap in zip(axes, SNAPS):
        i = int(np.searchsorted(t, pd.Timestamp(snap, tz="UTC")))
        ax.set_facecolor(SURFACE)
        x = np.arange(lo_i, hi_i)
        past, fut = x[x <= i], x[x > i]
        ax.vlines(past, l[past], h[past], color=INK, lw=0.8, alpha=0.55)
        ax.plot(past, c[past], color=INK, lw=1.2)
        ax.vlines(fut, l[fut], h[fut], color=MUTED, lw=0.8, alpha=0.18)
        ax.plot(fut, c[fut], color=MUTED, lw=1.0, alpha=0.35)
        ax.axvline(i, color=INK, lw=1, ls=(0, (3, 3)))
        levels, lines, confirmed, pending = state(h, l, c, i)
        for p, v, side in levels:
            if ymin < v < ymax and p >= lo_i - 60:
                col = RESIST if side == 1 else SUPPORT
                ax.plot([max(p, lo_i), i], [v, v], color=col, lw=2, solid_capstyle="round")
                ax.plot([i, hi_i], [v, v], color=col, lw=1, alpha=0.3, ls=":")
        for j1, v1, j2, v2, side in lines:
            xs = np.array([j1, i + 8])
            ax.plot(xs, v1 + (v2 - v1) * (xs - j1) / (j2 - j1), color=TREND, lw=2, ls=(0, (6, 3)))
        for p, v, side in confirmed:
            if lo_i <= p <= i:
                ax.plot(p, v, "o", ms=4.5, color=RESIST if side == 1 else SUPPORT, mec=SURFACE, mew=1)
        for p, v, side in pending:
            ax.plot(p, v, "o", ms=8, mfc="none", mec=MUTED, mew=1.5)
        for which, sigs, marker_label in ((1, sig1, "level break"), (2, sig2, "trend-line break")):
            s = sigs.get(t[i])
            if s is not None:
                y = c[i] * (1.006 if s.side == 1 else 0.994)
                ax.plot(i + (0.8 if which == 2 else 0), y, "^" if s.side == 1 else "v", ms=12, color=INK)
                ax.annotate(f"signal: {marker_label}, {'long' if s.side == 1 else 'short'}", (i, y),
                            xytext=(8, 10 if which == 1 else -16), textcoords="offset points", fontsize=9, color=INK)
        n_res = sum(1 for _, v, s_ in levels if s_ == 1 and ymin < v < ymax)
        n_sup = sum(1 for _, v, s_ in levels if s_ == -1 and ymin < v < ymax)
        ax.set_title(f"As of {snap} UTC: {n_res} resistance and {n_sup} support levels in view, "
                     f"{len(lines)} trend line{'s' if len(lines) != 1 else ''}", loc="left", fontsize=11, color=INK)
        ax.set_ylim(ymin, ymax)
        ax.grid(axis="y", color=GRID, lw=0.8)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
        for sp in ("left", "bottom"):
            ax.spines[sp].set_color(MUTED)
        ax.tick_params(colors="#52514e", labelsize=9)
        ax.set_ylabel("BTC/USD", color="#52514e")
    ticks = np.arange(lo_i, hi_i, 36)
    axes[-1].set_xticks(ticks)
    axes[-1].set_xticklabels([t[k].strftime("%b %d") for k in ticks])
    handles = [plt.Line2D([], [], color=RESIST, lw=2, label="resistance level (confirmed swing high)"),
               plt.Line2D([], [], color=SUPPORT, lw=2, label="support level (confirmed swing low)"),
               plt.Line2D([], [], color=TREND, lw=2, ls=(0, (6, 3)), label="trend line (last two order-8 swings)"),
               plt.Line2D([], [], marker="o", ls="none", mfc="none", mec=MUTED, mew=1.5, ms=8, label="latest swing, not yet confirmed"),
               plt.Line2D([], [], color=MUTED, lw=1, alpha=0.5, label="bars not yet seen at that moment")]
    fig.legend(handles=handles, loc="lower center", ncol=3, frameon=False, fontsize=9, labelcolor=INK)
    fig.suptitle("Lines are redrawn as bars arrive: each panel uses only bars closed by its dashed line",
                 x=0.01, ha="left", fontsize=13, color=INK)
    fig.tight_layout(rect=(0, 0.05, 1, 0.97))
    out = os.path.join(HERE, "fig_lines_evolve.png")
    fig.savefig(out, dpi=110)
    print(out)


if __name__ == "__main__":
    main()
