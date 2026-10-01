"""TrialFamily exit-v1: bar-by-bar exits on fixed entries (B1, BOX, TREND) and on box fades (falsification).
See INTENT.md. Writes exits/trades.csv.gz and exits/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("range4_run", os.path.join(ROOT, "range4", "run.py"))
R4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R4)
R3, R2, MT = R4.R3, R4.R2, R4.R2.MT

FEE, TRAIL, BE, WICK, CHANNEL = 0.0006, 3.0, 1.0, 0.5, 20
EXITS = ("X0", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "X8")
DEV = (pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC"))
HOLD = (pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))


def pivots(h, l, k):
    """Confirmed pivots as arrays: for each bar j, the pivots confirmed exactly at j (pivot index j - k)."""
    hi, lo = np.zeros(len(h), bool), np.zeros(len(h), bool)
    for j in range(k, len(h) - k):
        hi[j] = h[j] == h[j - k:j + k + 1].max()
        lo[j] = l[j] == l[j - k:j + k + 1].min()
    return hi, lo


class Bars:
    def __init__(self, d, daily):
        self.o, self.h, self.l, self.c = (d[x].values.astype(float) for x in ("open", "high", "low", "close"))
        self.a = MT.atr_of(self.h, self.l, self.c)
        self.daily = daily
        self.ph3, self.pl3 = pivots(self.h, self.l, 3)
        self.ph5, self.pl5 = pivots(self.h, self.l, 5)
        self.base_hold = None if daily else 30
        self.time_only = 20 if daily else 30
        self.cap = 250 if daily else 120


def trade(B, e, side, entry, stop0, target0, policy):
    """Average R (on the initial risk, net of fees) of one entry under one exit policy."""
    o, h, l, c, a = B.o, B.h, B.l, B.c, B.a
    n = len(c)
    risk = (entry - stop0) * side
    if risk <= 0:
        return np.nan
    stop, target, part, done_half = stop0, target0 if policy in ("X0", "X2") else None, 0.0, False
    if policy == "X8":
        k3 = 3
        levels = [h[p - k3] if side == 1 else l[p - k3] for p in range(max(k3, e - 300), e)
                  if (B.ph3[p] if side == 1 else B.pl3[p])]
        far = [y for y in levels if (y - entry) * side >= risk]
        target = (min(far) if side == 1 else max(far)) if far else target0
    if policy in ("X1", "X3", "X5"):
        target = None
    limit = {"X0": B.base_hold, "X2": B.base_hold, "X4": B.time_only}.get(policy, B.cap)
    limit = B.cap if limit is None else limit
    best = entry
    lows5 = []  # last confirmed order-5 swing points (index, price) on the stop side
    for p in range(max(5, e - 300), e):
        if (B.pl5[p] if side == 1 else B.ph5[p]):
            lows5.append((p - 5, l[p - 5] if side == 1 else h[p - 5]))
    for j in range(e, min(e + limit + 1, n)):
        # 1) stop, then the half target, then the target
        if (l[j] <= stop) if side == 1 else (h[j] >= stop):
            px = stop if j == e else (min(o[j], stop) if side == 1 else max(o[j], stop))
            return finish(part, done_half, side, entry, px, risk)
        if policy == "X3" and not done_half and j > e and ((h[j] >= entry + risk) if side == 1 else (l[j] <= entry - risk)):
            part, done_half = 0.5 * BE - 0.5 * FEE * (2 * entry + risk * side) / risk, True
        if target is not None and j > e and ((h[j] >= target) if side == 1 else (l[j] <= target)):
            px = max(o[j], target) if side == 1 else min(o[j], target)
            return finish(part, done_half, side, entry, px, risk)
        # 2) exits decided at the close of bar j
        if policy == "X6":
            rg = h[j] - l[j]
            body = abs(c[j] - o[j])
            wick = (h[j] - max(o[j], c[j])) if side == 1 else (min(o[j], c[j]) - l[j])
            pos = (c[j] - l[j]) / rg if rg > 0 else 0.5
            if rg > 0 and wick >= 2 * body and wick >= WICK * a[j] and ((pos <= 0.4) if side == 1 else (pos >= 0.6)):
                return finish(part, done_half, side, entry, c[j], risk)
        if B.daily and policy in ("X0", "X2", "X6", "X7", "X8") and j >= CHANNEL:
            if (c[j] < c[j - CHANNEL:j].min()) if side == 1 else (c[j] > c[j - CHANNEL:j].max()):
                return finish(part, done_half, side, entry, c[j], risk)
        if (B.pl5[j] if side == 1 else B.ph5[j]):
            lows5.append((j - 5, l[j - 5] if side == 1 else h[j - 5]))
        if policy == "X7" and len(lows5) >= 2:
            (j1, y1), (j2, y2) = lows5[-2], lows5[-1]
            rising = (y2 > y1) if side == 1 else (y2 < y1)
            if rising and j2 > j1:
                line = y2 + (y2 - y1) / (j2 - j1) * (j - j2)
                if (c[j] - line) * side < 0:
                    return finish(part, done_half, side, entry, c[j], risk)
        # 3) stop updates effective from the next bar
        best = max(best, h[j]) if side == 1 else min(best, l[j])
        if policy == "X1" or (policy == "X3" and done_half):
            stop = max(stop, best - TRAIL * a[j]) if side == 1 else min(stop, best + TRAIL * a[j])
        if policy == "X2" and (best - entry) * side >= BE * risk:
            stop = max(stop, entry) if side == 1 else min(stop, entry)
        if policy == "X5" and (B.pl3[j] if side == 1 else B.ph3[j]) and j - 3 >= e:
            y = (l[j - 3] - 0.1 * a[j]) if side == 1 else (h[j - 3] + 0.1 * a[j])
            if (c[j] - y) * side > 0:
                stop = max(stop, y) if side == 1 else min(stop, y)
    j = min(e + limit, n - 1)
    return finish(part, done_half, side, entry, c[j], risk)


def finish(part, done_half, side, entry, px, risk):
    w = 0.5 if done_half else 1.0
    return part + w * (side * (px - entry) / risk - FEE * (entry + px) / risk)


def entries(coin, bars):
    """-> list of (kind, Bars, e, side, entry, stop, target, time) for one coin."""
    out = []
    d4 = bars["4h"][["open", "high", "low", "close"]]
    B4 = Bars(d4, False)
    from portfolio import b1_signals
    for s in b1_signals(bars):
        e = int(d4.index.searchsorted(s.time))
        if e < len(d4):
            out.append(("B1", B4, e, s.side, B4.o[e], s.stop, s.target, d4.index[e]))
    top, bot, a = R2.boxes(d4)
    for e, side, entry, stop, tgt in R3.x1(d4, top, bot, a):
        out.append(("BOX", B4, e, side, entry, stop, tgt, d4.index[e]))
    for e, side, entry, stop, tgt in R2.signals(d4, top, bot, a)["C"]:
        out.append(("FADE", B4, e, side, entry, stop, tgt, d4.index[e]))
    d1 = bars["1d"][["open", "high", "low", "close"]]
    B1d = Bars(d1, True)
    atr20 = MT.atr_of(B1d.h, B1d.l, B1d.c, 20)
    busy = {1: -1, -1: -1}
    for i in range(80, len(d1) - 1):
        for side in (1, -1):
            if i <= busy[side]:
                continue
            ref = B1d.c[i - 50:i].max() if side == 1 else B1d.c[i - 50:i].min()
            if (B1d.c[i] - ref) * side > 0:
                e = i + 1
                entry = B1d.o[e]
                stop = entry - side * 2 * atr20[i]
                out.append(("TREND", B1d, e, side, entry, stop, None, d1.index[e]))
                # occupancy follows the baseline channel exit, as in trend-v1
                for j in range(e, len(d1)):
                    if (B1d.l[j] <= stop) if side == 1 else (B1d.h[j] >= stop):
                        break
                    if j >= CHANNEL and ((B1d.c[j] < B1d.c[j - CHANNEL:j].min()) if side == 1 else (B1d.c[j] > B1d.c[j - CHANNEL:j].max())):
                        break
                busy[side] = j
    return out


def main():
    from evaluate import holdout_bars
    rows = []
    for name_set, coins, (t0, t1) in (("dev", R4.MAJORS, DEV), ("holdout", R4.LARGE, HOLD)):
        for coin in coins:
            for kind, B, e, side, entry, stop, tgt, t in entries(coin, holdout_bars(coin)):
                if not t0 <= t < t1:
                    continue
                row = dict(set=name_set, coin=coin, kind=kind, time=t, side=side)
                for x in EXITS:
                    row[x] = trade(B, e, side, entry, stop, tgt, x)
                rows.append(row)
            print(f"{coin} {name_set}: {sum(r['coin'] == coin and r['set'] == name_set for r in rows)} entries", flush=True)
    T = pd.DataFrame(rows).dropna(subset=list(EXITS))
    with gzip.GzipFile(f"{HERE}/trades.csv.gz", "wb", mtime=0) as f:
        f.write(T.to_csv(index=False, float_format="%.6g").encode())
    names = {"X0": "baseline", "X1": "ATR trail 3", "X2": "breakeven 1R", "X3": "half at 1R + trail", "X4": "time only",
             "X5": "structure trail", "X6": "wick rejection", "X7": "trend-line break", "X8": "level target"}
    out = ["exit-v1: same entries, nine exits; avg R on the initial risk, net of 0.06%/side; paired difference vs baseline",
           "(95% coin-then-trade bootstrap); development = 17 majors 2018-2022, holdout = 20 large caps 2023-2026", ""]
    adopted = []
    for kind in ("B1", "BOX", "TREND", "FADE"):
        out.append(f"{kind}:")
        for x in EXITS:
            cells, lows = [], []
            for s in ("dev", "holdout"):
                z = T[(T.kind == kind) & (T.set == s)]
                if x == "X0":
                    lo, hi = R2.coin_boot(z.assign(R=z.X0, control=0.0))
                    cells.append(f"{s} n {len(z):5d} avg R {z.X0.mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
                    lows.append(lo)
                    continue
                lo, hi = R2.coin_boot(z.assign(R=z[x], control=z.X0))
                lo_raw, _ = R2.coin_boot(z.assign(R=z[x], control=0.0))
                cells.append(f"{s} avg R {z[x].mean():+.3f}, vs baseline {(z[x] - z.X0).mean():+.3f} [{lo:+.3f}, {hi:+.3f}]")
                lows.append(lo_raw if kind == "FADE" else lo)
            out.append(f"  {x} {names[x]:<19} " + "   |   ".join(cells))
            if x != "X0" and min(lows) > 0:
                adopted.append(f"{kind}:{x}" if kind != "FADE" else f"FADE rescued by {x}")
        out.append("")
    claim2 = not any(a.startswith("FADE") for a in adopted)
    out.append("decision, claim 1 (exits adopted, beating baseline on both sets): " +
               (", ".join(a for a in adopted if not a.startswith("FADE")) or "none"))
    out.append(f"decision, claim 2 (no exit rescues box fades): {'STANDS' if claim2 else 'FALSIFIED: ' + ', '.join(a for a in adopted if a.startswith('FADE'))}")
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
