"""Export the new studies' order intents for the repository's BacktestEngine (replay/), with Python's own outcomes.

Cross-checked, every signal in each:
  setups-v1 on BTC (B1, P1, P2, P3, R1): engine on the same 4h bars and on 1-minute bars
  setups-v1 on EURUSD and USDJPY: engine on hourly bars
  fxrevert-v1 (M1, M2, M3) on the nine FX majors: engine on hourly bars; the indicator or time exit day that Python
    computes from closes (it never depends on fills) is passed as the deadline, and the target sits 50 ATR away
  altcoins-v1 (B1) on the 15 coins: engine on hourly bars
The replay program holds one position at a time, so each study's signals are split into lanes that never overlap.
Prices are multiplied by a power of ten so that two decimals keep at least five significant digits; R is scale-free.
Python outcomes here are gross (no cost), with the role of the exit (TP, SL, TIME), for comparison with the engine's
fill prices.
Writes xcheck/work/<key>.json (orders), xcheck/work/bars_<market>_<res>.csv and xcheck/work/python.csv.
"""
import gzip, json, math, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WORK = os.path.join(HERE, "work")
for p in (ROOT, os.path.join(ROOT, "setups")):
    sys.path.insert(0, p)
import ronnie_bt as B  # noqa: E402
import run as SR  # noqa: E402  (setups/run.py)
import tv_fx_mtf  # noqa: E402
import tv_hourly  # noqa: E402
from ronnie_plan import load  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "fxrevert"))
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("fxrevert_run", os.path.join(ROOT, "fxrevert", "run.py"))
FXR = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(FXR)
_spec = importlib.util.spec_from_file_location("alt_run", os.path.join(ROOT, "altcoins", "run.py"))
ALT = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ALT)

NS = 10**9
AGG = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}


def scale_of(prices):
    return 10.0 ** max(0, 5 - math.floor(math.log10(float(np.median(prices)))))


def write_bars(df, path, step_s, scale):
    """Engine bars: ts is the bar's close in ns."""
    b = df[["open", "high", "low", "close"]].astype(float) * scale
    b["volume"] = 1.0
    b["ts"] = (df.index.as_unit("s").asi8 + step_s) * NS
    b.to_csv(path, index=False, float_format="%.2f")


def sim(o, h, l, c, i, side, stop, tp, last):
    """Python's rule, gross: stop first, target from the bar after entry, time exit at bar `last`'s close."""
    e = o[i]
    for j in range(i, last + 1):
        if side == 1 and l[j] <= stop or side == -1 and h[j] >= stop:
            return side * ((min(o[j], stop) if side == 1 else max(o[j], stop)) - e) / abs(e - stop), "SL"
        if j > i and (side == 1 and h[j] >= tp or side == -1 and l[j] <= tp):
            return side * ((max(o[j], tp) if side == 1 else min(o[j], tp)) - e) / abs(e - stop), "TP"
    return side * (c[last] - e) / abs(e - stop), "TIME"


def lanes(orders):
    out, ends = [], []
    for od in sorted(orders, key=lambda x: x["submit_ns"]):
        for k, end in enumerate(ends):
            if end < od["submit_ns"]:
                out[k].append(od)
                ends[k] = od["deadline_ns"]
                break
        else:
            out.append([od])
            ends.append(od["deadline_ns"])
    return out


def orders_4h(tag, d4, sigs, scale, python_rows, hold=SR.HOLD):
    o, h, l, c = (d4[x].values for x in ("open", "high", "low", "close"))
    ts = d4.index.as_unit("s").asi8
    orders = []
    for setup, lst in sigs.items():
        for i, side, stop, tgt in lst:
            e = i + 1
            if e + hold >= len(c):
                continue
            risk = (o[e] - stop) * side
            if risk <= 0:
                continue
            tp = tgt if tgt is not None else o[e] + side * 2 * risk
            if tgt is not None and (tp - o[e]) * side < risk:
                continue
            r, role = sim(o, h, l, c, e, side, stop, tp, e + hold)
            oid = f"{tag}-{setup}-{i}"
            orders.append(dict(id=oid, submit_ns=int(ts[i] + 4 * 3600) * NS, side=side, kind="MARKET", entry=o[e] * scale,
                               stop=stop * scale, target=tp * scale, expire_ns=0, deadline_ns=int(ts[e + hold] + 4 * 3600) * NS))
            python_rows.append(dict(id=oid, study=tag.split(":")[0], market=tag.split(":")[1], setup=setup, py_R=r, py_role=role))
    return orders


def fx_hourly(pair):
    h = tv_fx_mtf.hourly(pair)
    return h


def main():
    os.makedirs(WORK, exist_ok=True)
    py, jobs = [], []

    # setups-v1 on BTC: 4h and 1m engine bars
    d4, d1 = load()
    sigs, _ = SR.signals(d4, d1)
    orders = orders_4h("setups:BTCUSD", d4, sigs, 1.0, py)
    write_bars(d4, f"{WORK}/bars_BTCUSD_4h.csv", 4 * 3600, 1.0)
    m1 = pd.read_csv(os.path.join(ROOT, "btc1m.csv.gz"))
    m1 = pd.concat([m1, pd.read_csv(os.path.join(ROOT, "btc1m_latest.csv"))]).drop_duplicates("timestamp").sort_values("timestamp")
    m1.index = pd.to_datetime(m1.timestamp, unit="s", utc=True)
    m1 = m1[m1.index >= "2016-12-01"]
    write_bars(m1, f"{WORK}/bars_BTCUSD_1m.csv", 60, 1.0)
    for k, lane in enumerate(lanes(orders)):
        jobs.append(dict(key=f"setups_BTCUSD_4h_{k}", bars="bars_BTCUSD_4h.csv", orders=lane))
        jobs.append(dict(key=f"setups_BTCUSD_1m_{k}", bars="bars_BTCUSD_1m.csv", orders=lane))

    # setups-v1 on two FX pairs: hourly engine bars
    for pair in ("EURUSD", "USDJPY"):
        h = fx_hourly(pair)
        a4 = h.resample("4h", label="left", closed="left").agg(AGG).dropna()
        a1 = h.resample("1D", label="left", closed="left").agg(AGG).dropna()
        a4 = a4[a4.index >= "2017-01-01"]
        s = scale_of(a4.close)
        sg, _ = SR.signals(a4, a1)
        orders = orders_4h(f"setups:{pair}", a4, sg, s, py)
        write_bars(h, f"{WORK}/bars_{pair}_1h.csv", 3600, s)
        for k, lane in enumerate(lanes(orders)):
            jobs.append(dict(key=f"setups_{pair}_1h_{k}", bars=f"bars_{pair}_1h.csv", orders=lane))

    # fxrevert-v1: daily signals, hourly engine bars; deadline = Python's exit day ignoring the stop
    for pair in tv_fx_mtf.PAIRS:
        h = fx_hourly(pair)
        d = FXR.daily(pair)
        x = pd.concat([d, FXR.indicators(d)], axis=1)

        class A:
            pass
        X = A()
        for col in x.columns:
            setattr(X, col, x[col].values)
        s = scale_of(d.close)
        ts = d.index.as_unit("s").asi8
        orders = []
        for setup in ("M1", "M2", "M3"):
            busy = -1
            for i in range(60, len(x) - 12):
                if i <= busy or np.isnan(X.atr[i]):
                    continue
                side = FXR.signal(setup, X, i)
                if side == 0:
                    continue
                e = i + 1
                r_py, j_py = FXR.trade(setup, X, e, side, X.atr[i])
                if r_py is None:
                    continue
                busy = j_py
                last = min(e + FXR.MAX_DAYS[setup] - 1, len(x) - 1)
                j_plan = next((j for j in range(e, last + 1) if FXR.exit_hit(setup, side, X, j)), last)
                risk = FXR.STOP_ATR * X.atr[i]
                stop, tp = X.open[e] - side * risk, X.open[e] + side * 50 * X.atr[i]
                r, role = sim(X.open, X.high, X.low, X.close, e, side, stop, tp, j_plan)
                oid = f"fxrevert:{pair}-{setup}-{i}"
                orders.append(dict(id=oid, submit_ns=int(ts[i] + 86400) * NS, side=side, kind="MARKET", entry=X.open[e] * s,
                                   stop=stop * s, target=tp * s, expire_ns=0, deadline_ns=int(ts[j_plan] + 86400) * NS))
                py.append(dict(id=oid, study="fxrevert", market=pair, setup=setup, py_R=r, py_role=role))
        write_bars(h, f"{WORK}/bars_{pair}_1h.csv", 3600, s)
        for k, lane in enumerate(lanes(orders)):
            jobs.append(dict(key=f"fxrevert_{pair}_1h_{k}", bars=f"bars_{pair}_1h.csv", orders=lane))

    # altcoins-v1: 4h signals, hourly engine bars
    t0, t1 = int(pd.Timestamp("2017-07-01").value // NS), int(pd.Timestamp("2026-09-30").value // NS)
    for coin in ALT.COINS:
        h = tv_hourly.binance(f"{coin}USDT", t0, t1).drop_duplicates("time").sort_values("time")
        if h.empty:
            continue
        h.index = pd.to_datetime(h.time, unit="s", utc=True)
        h["volume"] = 1.0
        a4 = h.resample("4h", label="left", closed="left").agg(AGG).dropna()
        lo, sh = B.signals(a4, B.features(a4))
        sg = {"B1": [(i, 1 if lo.values[i] else -1, a4.low.values[i] if lo.values[i] else a4.high.values[i], None)
                     for i in np.flatnonzero((lo | sh).values) if i >= 150]}
        s = scale_of(a4.close)
        orders = orders_4h(f"altcoins:{coin}", a4, sg, s, py)
        write_bars(h, f"{WORK}/bars_{coin}_1h.csv", 3600, s)
        for k, lane in enumerate(lanes(orders)):
            jobs.append(dict(key=f"altcoins_{coin}_1h_{k}", bars=f"bars_{coin}_1h.csv", orders=lane))

    closes = {}
    for j in jobs:
        if j["bars"] not in closes:
            closes[j["bars"]] = pd.read_csv(f"{WORK}/{j['bars']}", usecols=["ts"]).ts.values
        cl = closes[j["bars"]]
        for od in j["orders"]:
            # the engine submits on the bar whose close equals submit_ns, so snap both times to the last engine bar
            # closing at or before them (weekends and gaps leave nominal 4h or daily closes without an engine bar)
            od["submit_ns"] = int(cl[np.searchsorted(cl, od["submit_ns"], side="right") - 1])
            od["deadline_ns"] = int(cl[np.searchsorted(cl, od["deadline_ns"], side="right") - 1])
        json.dump({j["key"]: j["orders"]}, open(f"{WORK}/{j['key']}.json", "w"))
    with open(f"{WORK}/jobs.txt", "w") as f:
        f.writelines(f"{j['key']} {j['bars']}\n" for j in jobs)
    pd.DataFrame(py).to_csv(f"{WORK}/python.csv", index=False)
    print(f"{len(jobs)} engine jobs, {len(py)} orders")


if __name__ == "__main__":
    main()
