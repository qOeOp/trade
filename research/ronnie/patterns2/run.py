"""TrialFamily patterns-v2: flags and pennants after an impulse, traded with the impulse (F-raw, F-trend). See INTENT.md.

Scoring reuses patterns/run.py (events, controls, bootstrap). Writes patterns2/events.csv.gz and patterns2/result.txt.
"""
import gzip, importlib.util, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo")):
    sys.path.insert(0, p)
_spec = importlib.util.spec_from_file_location("patterns_run", os.path.join(ROOT, "patterns", "run.py"))
PR = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PR)

POLE_BACK, POLE_NEAR, POLE_LEN, POLE_ATR, FLAG_MIN, FLAG_MAX, RETRACE, MAX_STOP = 25, 5, 12, 4.0, 4, 20, 0.5, 6.0
HOLD = (pd.Timestamp("2022-01-01", tz="UTC"), pd.Timestamp("2026-09-01", tz="UTC"))
HOLDOUT = ("PYR", "CVX", "TLM", "SLP", "QI", "MOVR", "AGLD", "RAD", "XVS", "BNT", "RLC", "CVC", "POWR", "PHA")
VARIANTS = ("F-raw", "F-trend")


def signals(d4, has_volume=False):
    o, h, l, c = (d4[x].values.astype(float) for x in ("open", "high", "low", "close"))
    n = len(c)
    atr = PR.atr_of(h, l, c)
    d1 = d4.resample("1D", label="left", closed="left").agg({"close": "last"}).dropna()
    trend = np.sign(d1.close - d1.close.rolling(50).mean())
    trend.index = trend.index + pd.Timedelta(days=1)  # known once the day has closed
    dtrend = trend.reindex(d4.index + pd.Timedelta(hours=4), method="ffill").fillna(0).values
    out = {v: [] for v in VARIANTS}
    used = set()
    for i in range(POLE_BACK + POLE_LEN + 1, n - 1):
        for side in (1, -1):
            win = slice(i - POLE_BACK, i - POLE_NEAR + 1)
            ext = h if side == 1 else -l
            p = win.start + int(np.argmax(ext[win]))
            if not FLAG_MIN <= i - 1 - p <= FLAG_MAX or (p, side) in used:
                continue
            pole = slice(max(0, p - POLE_LEN), p + 1)
            if side == 1:
                b = pole.start + int(np.argmin(l[pole]))
                height = h[p] - l[b]
            else:
                b = pole.start + int(np.argmax(h[pole]))
                height = h[b] - l[p]
            if height < POLE_ATR * atr[p]:
                continue
            fh, fl = h[p + 1:i].max(), l[p + 1:i].min()
            if side == 1:
                ok = fl > h[p] - RETRACE * height and fh <= h[p] and c[i] > fh and c[i - 1] <= fh
                stop, tgt = fl, o[i + 1] + height
            else:
                ok = fh < l[p] + RETRACE * height and fl >= l[p] and c[i] < fl and c[i - 1] >= fl
                stop, tgt = fh, o[i + 1] - height
            if not ok or abs(o[i + 1] - stop) > MAX_STOP * atr[i]:
                continue
            used.add((p, side))
            out["F-raw"].append((i, side, stop, tgt))
            if dtrend[i] == side:
                out["F-trend"].append((i, side, stop, tgt))
    return out, atr


def main():
    import harness as H
    from evaluate import holdout_bars
    PR.signals, PR.VARIANTS = signals, VARIANTS
    FR = PR._load("filters_run", "filters/run.py")
    rows = []
    for name in ("BTCUSD", "ETHUSDT"):
        rows += PR.events(name, "crypto", H.load(name)["4h"], False)
        print(f"{name}: {sum(r['market'] == name for r in rows)} signals", flush=True)
    for name, d4, _d1 in FR.markets():
        if name not in ("BTCUSD", "ETHUSDT"):
            rows += PR.events(name, "fx", d4, False)
            print(f"{name}: {sum(r['market'] == name for r in rows)} signals", flush=True)
    for coin in HOLDOUT:
        rows += PR.events(coin, "holdout", holdout_bars(coin)["4h"], False, *HOLD)
        print(f"{coin}: {sum(r['market'] == coin for r in rows)} signals", flush=True)
    ev = pd.DataFrame(rows).dropna(subset=["control"])
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False, float_format="%.6g").encode())
    oos = ev.entry_time >= PR.DEV_END
    out = ["patterns-v2: flags and pennants after an impulse, with the impulse; avgR net of costs; control = random entries",
           "variant  set               n     win   avgR    control  minus control [interval]"]
    verdict = []
    for v in VARIANTS:
        res = {}
        for label, m, lvl in (("crypto dev 17-22", (ev.cls == "crypto") & ~oos, 95), ("fx IS 17-22", (ev.cls == "fx") & ~oos, 95),
                              ("fx OOS 23-26", (ev.cls == "fx") & oos, 90), ("holdout 14 coins", ev.cls == "holdout", 95)):
            z = ev[(ev.variant == v) & m]
            if label.startswith("holdout"):
                d, (lo, hi) = (z.R - z.control).mean(), PR.coin_boot(z, lvl)
            else:
                d, lo, hi = PR.SR.ci(z.R - z.control, lvl)
            res[label] = lo
            out.append(f"{v:<8} {label:<16} {len(z):5d}  {np.mean(z.R > 0):.0%}  {z.R.mean():+.3f}  {z.control.mean():+.3f}   "
                       f"{d:+.3f} [{lo:+.3f}, {hi:+.3f}] ({lvl}%)")
        verdict.append(f"{v}: crypto {'HOLDS' if res['crypto dev 17-22'] > 0 and res['holdout 14 coins'] > 0 else 'fails'}, "
                       f"FX {'HOLDS' if res['fx IS 17-22'] > 0 and res['fx OOS 23-26'] > 0 else 'fails'}")
    out.append("decision: " + "; ".join(verdict))
    text = "\n".join(out)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
