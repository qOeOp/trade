"""Resolve each exported order on 1-minute bars (true intrabar order), same one-at-a-time rule as the replay."""
import json, sys, numpy as np, pandas as pd
MAKER, TAKER, SLIP = 0.0002, 0.0005, 0.0001
a = pd.read_csv("btc1m.csv.gz"); b = pd.read_csv("btc1m_latest.csv")
m = pd.concat([a, b]).drop_duplicates("timestamp").sort_values("timestamp")
m = m[m.timestamp >= 1483228800 - 86400 * 30]
ts = (m.timestamp.values.astype(np.int64) + 60) * 10**9  # minute close, ns
o, h, l, c = (m[x].values for x in ("open", "high", "low", "close"))

orders = json.load(open("orders.json"))

def run(plans, touch):
    res = []; busy_until = -1
    for p in sorted(plans, key=lambda x: x["submit_ns"]):
        if p["submit_ns"] < busy_until: continue
        s = p["side"]; i = int(np.searchsorted(ts, p["submit_ns"], side="right"))  # first minute after submit
        if p["kind"] == "MARKET":
            e = o[i] * (1 + s * SLIP); fee_in = TAKER; fi = i
        else:
            j_end = int(np.searchsorted(ts, p["expire_ns"], side="right"))
            E = p["entry"]; fi = None
            for j in range(i, j_end):
                hit = (l[j] <= E if touch else l[j] < E) if s == 1 else (h[j] >= E if touch else h[j] > E)
                if hit:
                    fi = j; e = min(E, o[j]) if s == 1 else max(E, o[j]); fee_in = MAKER; break
            if fi is None:
                res.append(dict(id=p["id"], status="EXPIRED")); continue
        stop, tgt = p["stop"], p["target"]; dl = int(np.searchsorted(ts, p["deadline_ns"], side="left"))
        why = None
        for j in range(fi, min(dl + 1, len(ts))):
            st = l[j] <= stop if s == 1 else h[j] >= stop
            tp = (h[j] > tgt if s == 1 else l[j] < tgt) and not (j == fi and p["kind"] == "LIMIT" and False)
            if st:
                x = (min(o[j], stop) if s == 1 else max(o[j], stop)) * (1 - s * SLIP) if j > fi else stop * (1 - s * SLIP); why = "SL"; fee = TAKER; break
            if tp:
                x = max(o[j], tgt) if s == 1 else min(o[j], tgt); why = "TP"; fee = MAKER
                if j == fi: x = tgt
                break
        if why is None:
            j = min(dl, len(ts) - 1); x = c[j] * (1 - s * SLIP); why = "TIME"; fee = TAKER
        risk = abs(e - stop)
        R = (s * (x - e) - e * fee_in - x * fee) / risk if risk > 0 else np.nan
        res.append(dict(id=p["id"], status="CLOSED", R=R, why=why, entry_px=e, exit_px=x, entry_ns=int(ts[fi]), exit_ns=int(ts[j])))
        busy_until = ts[j]
    return pd.DataFrame(res)

for key in ("s2b", "s6"):
    for touch in ((False, True) if key == "s6" else (False,)):
        r = run(orders[key], touch); r.to_csv(f"path1m_{key}{'_touch' if touch else ''}.csv", index=False)
        cl = r[r.status == "CLOSED"]
        print(f"{key} {'touch' if touch else 'strict'}: filled {len(cl)} expired {(r.status=='EXPIRED').sum()} | avgR {cl.R.mean():.3f} win {(cl.R>0).mean():.3f} | exits {cl.why.value_counts().to_dict()}")
