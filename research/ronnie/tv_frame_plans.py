"""Ronnie's spoken plans read from his video frames (pilot, 2026-10-02). At moments where he says "stop here" or "target
here", he draws a horizontal line or hovers the cursor, and TradingView prints the exact price on the axis. Each row
was read by hand from frames of the 2024-2025 video ideas (scratch copies, not committed); `level` is the zone edge or
swing extreme his stop sits beyond. Geometry is in daily ATR(14) at the last close before the video.
Usage: python tv_frame_plans.py   (writes results/tv_frame_plans.txt)"""
import time

import pandas as pd

from tv_prices import fetch

# id, video uuid, date, symbol, chart tf, side, entry, stop, level the stop protects, targets, his verdict, note
PLANS = [
    ("G1", "XTSAcSVK", "2024-10-11", "FX:XAUUSD", "1h", -1, 2641.5, 2651.26, 2650.0, [2622.82], "take",
     "short at the channel top under a prior high; red stop and target lines drawn live; 'two to three times'"),
    ("G2", "FkBjijSz", "2024-09-11", "FX:XAUUSD", "1h", 1, 2519.16, 2495.0, 2496.2, [2528.0], "reject",
     "chasing a long under resistance: the stop must go below the swing low, so it is not worth it"),
    ("G3", "FkBjijSz", "2024-09-11", "FX:XAUUSD", "1h", -1, 2528.0, 2533.93, 2530.0, [2512.91, 2496.52, 2487.25], "take",
     "short at the range top; stop a few dollars above the zone; stepped targets at lower lines"),
    ("E1", "O2oRgivi", "2025-01-03", "BINANCE:ETHUSDT", "1h", -1, 3420.0, 3465.67, 3427.86, [3315.0], "take",
     "'every short here has its valid stop here' above the resistance zone; it was hit by the breakout"),
    ("O1", "sB6ls08l", "2024-10-15", "TVC:USOIL", "4h", 1, 71.5, 70.61, 71.15, [74.40, 76.85], "take",
     "long at support; 'stop a little below the two lows'"),
    ("A1", "daIJgg2k", "2025-03-06", "BINANCE:AAVEUSDT", "1D", 1, 236.8, 154.98, 172.0, [273.25], "reject",
     "chasing a long: every long's valid stop is below the trend line and swing low, the room above is small"),
    ("A2", "daIJgg2k", "2025-03-06", "BINANCE:AAVEUSDT", "1D", 1, 195.0, 154.98, 172.0, [273.25], "take",
     "the same plan entered on the drawn pullback to the trend line"),
    ("B1", "j7dcXI20", "2024-03-01", "BINANCE:BCHUSDT", "1D", -1, 314.6, 335.0, 330.0, [], "take (small size)",
     "short at resistance; 'the stop must clear this wick' (cursor 330 to 342); no target stated"),
    ("S1", "sg0OK9iV", "2024-11-07", "BINANCE:SOLUSDT", "1D", 1, 189.1, 182.58, 184.0, [197.24, 203.33], "reject",
     "the range is too narrow: entry here, small target, stop still has to go here, not worth it"),
    ("I1", "EMh1cDJr", "2024-04-08", "BINANCE:IMXUSDT", "1D", 1, 2.60, 2.4022, 2.47, [3.0893, 3.60], "take",
     "hold longs from the support zone; 'the stop must be here'; first target the lower high, then the prior high"),
    ("O2", "FkBjijSz", "2024-09-11", "TVC:USOIL", "1D", 1, 64.0, 59.97, 62.5, [72.0], "take",
     "long anywhere in the 62-64 zone; 'every stop goes here', anything inside the zone is a gift"),
    ("I2", "XTSAcSVK", "2024-10-11", "BINANCE:IMXUSDT", "1D", 1, 1.46, 1.268, 1.33, [1.87], "take",
     "long at the trend line after a bullish engulfing; stop below the swing low; target the prior high"),
]


def daily(sym):
    for _ in range(4):
        try:
            b, _err = fetch(sym, "1D", 5000)
            break
        except Exception:
            b = []
            time.sleep(3)
    d = pd.DataFrame([v for _, v in b], index=pd.to_datetime([t for t, _ in b], unit="s"), columns=["o", "h", "l", "c"])
    pc = d.c.shift(1)
    d["atr"] = pd.concat([d.h - d.l, (d.h - pc).abs(), (d.l - pc).abs()], axis=1).max(axis=1).rolling(14).mean()
    return d


def main():
    cache, rows = {}, []
    for pid, uuid, day, sym, tf, side, entry, stop, level, tgts, verdict, note in PLANS:
        if sym not in cache:
            cache[sym] = daily(sym)
        a = cache[sym].loc[:pd.Timestamp(day) - pd.Timedelta(days=1)].atr.iloc[-1]
        risk = (entry - stop) * side
        rows.append(dict(id=pid, date=day, symbol=sym.split(":")[1], tf=tf, side="long" if side == 1 else "short",
                         verdict=verdict, stop_atr=risk / a, beyond_level_atr=(level - stop) * side / a,
                         t1_R=(tgts[0] - entry) * side / risk if tgts else float("nan"),
                         tlast_R=(tgts[-1] - entry) * side / risk if tgts else float("nan"), note=note))
    z = pd.DataFrame(rows)
    out = ["Ronnie's spoken plans read from video frames (pilot): geometry in daily ATR at the last close before the video",
           z.drop(columns="note").round(2).to_string(index=False), ""]
    tk = z[z.verdict.str.startswith("take")]
    out.append(f"plans he takes ({len(tk)}): stop from entry median {tk.stop_atr.median():.2f} daily ATR "
               f"(range {tk.stop_atr.min():.2f}-{tk.stop_atr.max():.2f}); beyond the protected level median "
               f"{tk.beyond_level_atr.median():.2f} ATR; first target median {tk.t1_R.median():.2f}R, last target median "
               f"{tk.tlast_R.median():.2f}R")
    rj = z[z.verdict == "reject"]
    out.append(f"plans he rejects ({len(rj)}): first target {', '.join(f'{x:.2f}R' for x in rj.t1_R)} "
               "(he turns them down as not worth the stop)")
    out.append("R-1 for reference: stop from entry median 0.75 daily ATR (IQR 0.56-1.07), 0.25 ATR beyond the zone, target 2R")
    t = "\n".join(out)
    print(t)
    open("results/tv_frame_plans.txt", "w").write(t + "\n")


if __name__ == "__main__":
    main()
