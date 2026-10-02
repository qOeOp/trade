"""R-1 scan (information only, not advice; no orders): for each coin, the daily trend state, any R-1 order armed in the
last 10 closed days with its fill status, and the nearest unbroken pivot beyond the price that would arm the next one.
Usage: python roleflip/scan.py BTC ETH ..."""
import os, sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import forward as F  # noqa: E402

FR = F.FR


def scan(coin, now):
    d = F.daily(coin, now)
    if len(d) < 60:
        return dict(coin=coin, note="not enough daily bars")
    S = FR.state(d)
    o, h, l, c, a, tr = S["o"], S["h"], S["l"], S["c"], S["a"], S["trend"]
    last = len(c) - 1
    row = dict(coin=coin, day=str(d.index[last].date()), close=c[last], trend={1: "up", -1: "down", 0: "none"}[int(tr[last])],
               atr_pct=a[last] / c[last])
    # the backtest's own trades (one position per coin; first fill takes the slot; orders during a position are void)
    sig, _ = FR.signals(d)
    pos, free_from = None, None
    for k, side, px, stop, tgt in sig["R-1"]:
        if k + FR.HOLD <= last:
            continue
        free_from = "after this trade exits"
        done = None
        for m in range(k, last + 1):
            if (side == 1 and l[m] <= stop) or (side == -1 and h[m] >= stop):
                done = f"stopped {d.index[m].date()}"
                break
            if m > k and ((side == 1 and h[m] >= tgt) or (side == -1 and l[m] <= tgt)):
                done = f"2R target hit {d.index[m].date()}"
                break
        pos = dict(side="long" if side == 1 else "short", entry_day=str(d.index[k].date()), entry=px, stop=stop, target=tgt,
                   status=done or "open")
    row["position"] = pos
    busy = pos is not None and pos["status"] == "open"  # one open R-1 trade per coin; the slot frees at the exit
    row["free_from"] = free_from
    orders = []
    for i, kind, p in S["events"]:
        if i < last - FR.VALID + 1 or kind not in ("break_high", "break_low") or busy:
            continue
        side = 1 if kind == "break_high" else -1
        if tr[i] != side:
            continue
        lvl, edge, ai = p[1], p[2], a[i]
        if i < last and FR.fill(S, i + 1, side, lvl)[0] is not None:
            continue  # already touched; the slot went to whichever order filled first (reported as the position)
        lower = max(edge, lvl - ai) if side == 1 else min(edge, lvl + ai)
        stop = lower - side * FR.BUF * ai
        lower_x = max(edge, lvl - F.CAP_X * ai) if side == 1 else min(edge, lvl + F.CAP_X * ai)
        stop_x = lower_x - side * F.BUF_X * ai
        orders.append(dict(side="long" if side == 1 else "short", break_day=str(d.index[i].date()), limit=lvl, stop=stop,
                           target_2R=lvl + side * 2 * abs(lvl - stop), stop_x=stop_x, target_x=lvl + side * F.TGT_X * abs(lvl - stop_x),
                           valid_until=str((d.index[i] + pd.Timedelta(days=FR.VALID)).date()),
                           dist=abs(c[last] - lvl) / a[last]))
    orders = sorted({(o["side"], round(o["limit"], 10)): o for o in orders}.values(), key=lambda o: o["dist"])[:2]
    # nearest unbroken confirmed pivot beyond the close in the trend's direction (what would arm the next order)
    k3 = FR.K
    piv_h = [h[j] for j in range(k3, last - k3 + 1) if h[j] == h[j - k3:j + k3 + 1].max() and h[j] > c[last]]
    piv_l = [l[j] for j in range(k3, last - k3 + 1) if l[j] == l[j - k3:j + k3 + 1].min() and l[j] < c[last]]
    if tr[last] == 1 and piv_h:
        row["next_trigger"] = f"long arms on a large-bodied daily close above {min(piv_h):.6g} ({(min(piv_h) - c[last]) / a[last]:.1f} ATR away)"
    elif tr[last] == -1 and piv_l:
        row["next_trigger"] = f"short arms on a large-bodied daily close below {max(piv_l):.6g} ({(c[last] - max(piv_l)) / a[last]:.1f} ATR away)"
    else:
        row["next_trigger"] = "no trigger in the trend direction (trend none, or no unbroken pivot beyond price)"
    row["orders"] = orders
    return row


if __name__ == "__main__":
    now = pd.Timestamp(datetime.now(timezone.utc))
    for coin in sys.argv[1:]:
        try:
            r = scan(coin, now)
        except Exception as ex:
            print(f"{coin}: error {type(ex).__name__}")
            continue
        if "note" in r:
            print(f"{coin}: {r['note']}")
            continue
        print(f"{coin} ({r['day']} close {r['close']:.6g}, daily ATR {r['atr_pct']:.1%}): trend {r['trend']}; {r['next_trigger']}")
        if r["position"]:
            q = r["position"]
            print(f"   last trade {q['side']} {q['entry_day']} at {q['entry']:.6g}, stop {q['stop']:.6g}, target {q['target']:.6g}: {q['status']}" + ("; no new R-1 trade until it exits" if q['status'] == 'open' else ""))
        for o in r["orders"]:
            print(f"   resting R-1 {o['side']}: limit {o['limit']:.6g} ({o['dist']:.1f} ATR from close), stop {o['stop']:.6g}, 2R target {o['target_2R']:.6g} | "
                  f"R-1x stop {o['stop_x']:.6g}, 1.5R target {o['target_x']:.6g}; armed {o['break_day']}, valid to {o['valid_until']}")
