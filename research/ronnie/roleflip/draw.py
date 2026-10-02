"""Draw what R-1 sees on a daily chart, in Ronnie's chart idiom, for side-by-side comparison with his drawings
(information only, not advice; no orders). Uses only bars closed before `asof`.
- black down-arrows at confirmed order-3 pivot highs, orange up-arrows at pivot lows (his marks);
- yellow zones: the broken pivot's wick-to-body zone (capped at 1 ATR) for each order armed in the window, and the
  nearest unbroken pivot zones beyond the last close;
- position boxes for every filled trade (green to the 2R target, red to the stop) with the outcome;
- dashed limits for orders that expired unfilled; resting orders and an open position projected to the right;
- the trend state as a strip under the price.
Usage: python roleflip/draw.py BTC 2026-04-01 [asof] [out.png]"""
import os, sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import replay as RP  # noqa: E402

FR = RP.FR
plt.rcParams["font.family"] = ["WenQuanYi Zen Hei", "DejaVu Sans"]
UP, DN, INK, MUTED = "#26a69a", "#ef5350", "#1f2328", "#6e7781"
ZONE, PIV_H, PIV_L = "#f9e04b", "#111111", "#f39c12"
RIGHT = 16  # bars of room to the right


def draw(coin, start, asof=None, out=None):
    d = RP.load(coin, asof)
    S = FR.state(d)
    o, h, l, c, a, tr = S["o"], S["h"], S["l"], S["c"], S["a"], S["trend"]
    n, K = len(c), FR.K
    s0 = int(d.index.searchsorted(pd.Timestamp(start, tz="UTC")))
    x = np.arange(n)
    fig, ax = plt.subplots(figsize=(16, 9), dpi=120)
    lo_v, hi_v = l[s0:].min(), h[s0:].max()
    pad = (hi_v - lo_v) * 0.06
    # candles
    for i in range(s0, n):
        col = UP if c[i] >= o[i] else DN
        ax.vlines(i, l[i], h[i], color=col, lw=0.8, zorder=3)
        ax.add_patch(Rectangle((i - 0.35, min(o[i], c[i])), 0.7, max(abs(c[i] - o[i]), (hi_v - lo_v) * 0.0008),
                               color=col, zorder=4, lw=0))
    # confirmed pivots (confirmed K bars later, so none in the last K bars)
    for j in range(max(s0, K), n - K):
        if h[j] == h[j - K:j + K + 1].max():
            ax.annotate("", (j, h[j] + pad * 0.15), (j, h[j] + pad * 0.75), zorder=5,
                        arrowprops=dict(arrowstyle="-|>", color=PIV_H, lw=1.2))
        if l[j] == l[j - K:j + K + 1].min():
            ax.annotate("", (j, l[j] - pad * 0.15), (j, l[j] - pad * 0.75), zorder=5,
                        arrowprops=dict(arrowstyle="-|>", color=PIV_L, lw=1.2))
    labels = []  # (y, text, colour) drawn at the right edge without overlaps
    resting = []
    orders = RP.plan(S)
    seen = set()
    n_void = n_exp = 0
    for r in orders:
        i, side = r["i"], r["side"]
        if i < s0:
            if not (r["status"] == "filled" and r["ex"] is not None and r["ex"] >= s0):
                continue
        # zone of the broken pivot, from the pivot to the order's end
        end = r["ex"] if r["status"] == "filled" else min(i + FR.VALID, n - 1 + RIGHT)
        key = (r["pivot"], i)
        if key not in seen and r["status"] in ("filled", "expired unfilled", "open order"):
            seen.add(key)
            z0, z1 = sorted((r["lvl"], r["zone"]))
            zs = r["pivot"] if i - r["pivot"] <= 40 and r["pivot"] >= s0 else max(i - 4, s0)
            ax.add_patch(Rectangle((zs, z0), min(end, n - 1 + RIGHT) - zs, z1 - z0, color=ZONE, alpha=0.45, lw=0, zorder=1))
            if zs != r["pivot"] and r["pivot"] not in seen:
                seen.add(r["pivot"])
                ax.text(zs, z1 if side == 1 else z0, f"{d.index[r['pivot']]:%m-%d}前{'高' if side == 1 else '低'}",
                        fontsize=6.5, color=MUTED, va="bottom" if side == 1 else "top", zorder=7)
        if r["status"] == "void":
            n_void += 1
            continue
        if r["status"] == "expired unfilled":
            n_exp += 1
            ax.hlines(r["lvl"], i + 1, i + FR.VALID, color=MUTED, lw=0.8, ls=(0, (3, 3)), zorder=2)
            continue
        if r["status"] == "open order":
            ax.hlines(r["lvl"], i + 1, n - 1 + RIGHT, color=MUTED, lw=1.0, ls=(0, (3, 3)), zorder=2)
            resting.append(r)
            continue
        if r["status"] != "filled":
            continue
        k, ex, px, stop, tgt = r["k"], r["ex"], r["px"], r["stop"], r["tgt"]
        kind, R = r["res"]
        x1 = min(ex, n - 1 + RIGHT) if kind != "open" else n - 1 + RIGHT
        ax.add_patch(Rectangle((k, min(px, tgt)), x1 - k, abs(tgt - px), color=UP, alpha=0.18, lw=0, zorder=2))
        ax.add_patch(Rectangle((k, min(px, stop)), x1 - k, abs(stop - px), color=DN, alpha=0.18, lw=0, zorder=2))
        ax.hlines(px, k, x1, color=INK, lw=0.9, zorder=3)
        ax.plot([i], [c[i]], marker="o", ms=4, color=INK, zorder=6)  # the break close that armed the order
        if kind == "open":
            sd = "多" if side == 1 else "空"
            labels += [(tgt, f"目标 {tgt:.6g}", UP), (px, f"持{sd}单 进场 {px:.6g}（{R:+.2f}R）", INK), (stop, f"止损 {stop:.6g}", DN)]
        else:
            lab = {"target": "+2R", "stop": "-1R", "time": f"{R:+.1f}R到期"}[kind]
            ax.text(x1 + 0.3, tgt if kind == "target" else stop, lab, fontsize=8, color=INK, va="center", zorder=7)
    # nearest unbroken pivot zones beyond the close (what arms the next order), extended to the right edge
    last = n - 1
    cand = []
    for j in range(K, last - K + 1):
        if h[j] == h[j - K:j + K + 1].max() and h[j] > c[last] and (c[j + 1:] < h[j]).all():
            cand.append((h[j] - c[last], j, h[j], max(h[j] - a[j], max(o[j], c[j]))))
        if l[j] == l[j - K:j + K + 1].min() and l[j] < c[last] and (c[j + 1:] > l[j]).all():
            cand.append((c[last] - l[j], j, l[j], min(l[j] + a[j], min(o[j], c[j]))))
    for dist, j, p, e in sorted(cand)[:4]:
        z0, z1 = sorted((p, e))
        ax.add_patch(Rectangle((max(j, s0), z0), last + RIGHT - max(j, s0), z1 - z0, color=ZONE, alpha=0.3, lw=0, zorder=1))
        labels.append((p, f"未破前{'高' if p > c[last] else '低'} {p:.6g}（大实体收盘突破才挂单）", MUTED))
    if resting:
        held = any(r["status"] == "filled" and r["res"][0] == "open" for r in orders)
        near = sorted(resting, key=lambda r: abs(r["lvl"] - c[last]))[:3]
        for r in near:
            labels.append((r["lvl"], f"挂单{'多' if r['side'] == 1 else '空'} {r['lvl']:.6g} 止损 {r['stop']:.6g} 2R {r['tgt']:.6g}"
                           + (f"（有效至 {d.index[r['i']] + pd.Timedelta(days=FR.VALID):%m-%d}）" if not held else "（已有持仓，平仓前不成交）"), INK if not held else MUTED))
        if len(resting) > 3:
            labels.append((near[-1]["lvl"], f"另有 {len(resting) - 3} 张同向挂单（更远）", MUTED))
    # trend strip
    yb = lo_v - pad * 1.6
    for i in range(s0, n):
        if tr[i]:
            ax.add_patch(Rectangle((i - 0.5, yb), 1, pad * 0.35, color=UP if tr[i] > 0 else DN, alpha=0.7, lw=0))
    ax.text(s0, yb + pad * 0.5, "趋势（绿=多，红=空）", fontsize=8, color=MUTED)
    ax.set_xlim(s0 - 1, n - 1 + RIGHT + 1)
    ax.set_ylim(yb - pad * 0.2, hi_v + pad)
    gap, prev = (hi_v - lo_v) * 0.025, None
    for y, t, col in sorted(labels):
        y = y if prev is None else max(y, prev + gap)
        ax.text(n - 1 + RIGHT + 1.5, y, t, clip_on=False, fontsize=8, color=col, va="center", zorder=8)
        prev = y
    ticks = [i for i in range(s0, n) if d.index[i].day == 1]
    ax.set_xticks(ticks, [d.index[i].strftime("%Y-%m") for i in ticks], fontsize=9, color=MUTED)
    ax.tick_params(axis="y", labelsize=9, colors=MUTED)
    ax.grid(color="#eaeef2", lw=0.6)
    for sp in ax.spines.values():
        sp.set_visible(False)
    t = {1: "多", -1: "空", 0: "无"}[int(tr[-1])]
    fig.text(0.01, 0.985, f"{coin} 日线 · R-1 画图（截至 {d.index[-1].date()} 收盘，趋势{t}）", fontsize=13, color=INK, va="top")
    fig.text(0.01, 0.955, "黑箭头=前高  橙箭头=前低  黄框=前高/前低区间（影线到实体，最多1 ATR）  绿/红框=交易（2R目标/止损）  "
            f"灰虚线=10天未回踩作废的挂单（{n_exp}）  另有{n_void}张因已有持仓作废未画  · 仅规则推演，非交易建议",
            fontsize=8, color=MUTED, va="top")
    out = out or f"{coin.replace(':', '_')}_{d.index[-1].date()}_r1.png"
    fig.subplots_adjust(left=0.045, right=0.76, top=0.91, bottom=0.06)
    fig.savefig(out)
    plt.close(fig)
    return out


if __name__ == "__main__":
    args = sys.argv[1:] + [None] * 3
    print(draw(args[0], args[1], args[2], args[3]))
