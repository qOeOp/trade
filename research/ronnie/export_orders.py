"""Export the exact order intents of two Python simulators, plus their own per-trade outcomes, for engine replay."""
import json, numpy as np, pandas as pd
from ronnie_plan import load, features
import s6_confluence as s6
import ronnie_bt as rb
H4 = 4 * 3600 * 10**9
d4, d1 = load(); F = features(d4, d1)
t = d4.index; ns = t.as_unit("ns").asi8  # bar open, ns
close_ns = lambda i: int(ns[i]) + H4
out = {}
# --- S6 confluence limit, k=3 (orders valid for the next bar only)
log = []; tr = s6.run(F, "confluence", k=3, log=log)
orders = []
for (i, side, E, stop, tgt) in log:
    if i + 1 + s6.C["max_hold"] >= len(t): continue
    orders.append(dict(id=f"S6-{i}", submit_ns=close_ns(i), side=side, kind="LIMIT", entry=round(E, 2), stop=round(stop, 2),
                       target=round(tgt, 2), expire_ns=close_ns(i + 1), deadline_ns=close_ns(i + 1 + s6.C["max_hold"])))
out["s6"] = orders
tr.assign(entry_ns=[int(pd.Timestamp(x).as_unit("ns").value) for x in tr.entry_time]).to_csv("py_s6_trades.csv", index=False)
# --- S2b standalone (ronnie_bt), market at the next open
d = rb.load(); f = rb.features(d); lo_, sh_ = rb.signals(d, f); curve, trb = rb.backtest(d, lo_, sh_)
ti = d.index; o, h, l = d.open.values, d.high.values, d.low.values
orders = []
for _, r in trb.iterrows():
    i0 = ti.get_loc(r.entry_time); side = 1 if r.side == "L" else -1
    stop = l[i0 - 1] if side == 1 else h[i0 - 1]; risk = (o[i0] - stop) * side
    if i0 + 30 >= len(ti): continue
    orders.append(dict(id=f"S2b-{i0}", submit_ns=int(ti.as_unit("ns").asi8[i0 - 1]) + H4, side=side, kind="MARKET", entry=round(o[i0], 2),
                       stop=round(stop, 2), target=round(o[i0] + side * 2 * risk, 2), expire_ns=0, deadline_ns=int(ti.as_unit("ns").asi8[i0 + 30]) + H4))
out["s2b"] = orders
trb.to_csv("py_s2b_trades.csv", index=False)
json.dump(out, open("orders.json", "w"))
print({k: len(v) for k, v in out.items()}, "python trades:", len(tr), len(trb))
# bars for the engine: ts = bar close
b4 = d4[["open", "high", "low", "close", "volume"]].copy(); b4["ts"] = ns + H4; b4.to_csv("engine_bars_4h.csv", index=False, float_format="%.2f")
print("4h bars", len(b4))
