"""Check Ronnie's title-level calls against realised BTC prices, each against a placebo.

t0 = publish date (US Pacific) + 1 day 09:00 UTC, which is after any publish time on that date, so nothing
the video could not have known is used.
"""
import json
from collections import Counter

import numpy as np
import pandas as pd

H = 7 * 24            # hours to look ahead
TOUCH = 0.003         # touched when within 0.3%
BOUNCE, BREAK = 0.02, 0.01

px = pd.read_csv("btc_1h.csv", index_col=0, parse_dates=True)
hi, lo, cl = px.high.values, px.low.values, px.close.values
idx = px.index


def at(t0):
    return int(idx.searchsorted(pd.Timestamp(t0)))


def level_test(i0, L, role):
    """Return (touched, held) for a support (role=1) or resistance (role=-1) level from bar i0."""
    end = min(i0 + H, len(cl))
    for i in range(i0, end):
        touched = lo[i] <= L * (1 + TOUCH) if role == 1 else hi[i] >= L * (1 - TOUCH)
        if touched:
            for j in range(i, min(i + H, len(cl))):
                if role == 1:
                    if cl[j] < L * (1 - BREAK):
                        return True, False
                    if hi[j] >= L * (1 + BOUNCE):
                        return True, True
                else:
                    if cl[j] > L * (1 + BREAK):
                        return True, False
                    if lo[j] <= L * (1 - BOUNCE):
                        return True, True
            return True, None
    return False, None


def target_hit(i0, T):
    end = min(i0 + H, len(cl))
    return bool((hi[i0:end] >= T).any()) if T > cl[i0] else bool((lo[i0:end] <= T).any())


def main():
    inp = {r["id"]: r for r in json.load(open("yt/claims_input.json"))}
    ann = [json.loads(l) for i in range(3) for l in open(f"yt/out{i}.jsonl")]
    rng = np.random.default_rng(1)
    rows = []
    for a in ann:
        r = inp[a["id"]]
        for lv in a.get("levels", []):
            rows.append(dict(id=a["id"], published=r["published"], t0=r["t0"], p0=r["p0"], title=r["title"], **lv))
    L = pd.DataFrame(rows)
    print(f"annotated titles {len(ann)}, with any level {sum(1 for a in ann if a.get('levels'))}, level rows {len(L)}")
    print(L.groupby(["role", "forward"]).size().to_string())

    # ---- support / resistance
    print("\n== forward SUPPORT / RESISTANCE: touched within 7d, then +2% bounce before a 1% close through ==")
    for role_name, role in (("SUPPORT", 1), ("RESISTANCE", -1)):
        sub = L[(L.role == role_name) & L.forward]
        real, plac = [], []
        for _, s in sub.iterrows():
            i0 = at(s.t0)
            p0 = cl[i0]
            if (role == 1 and s.price >= p0) or (role == -1 and s.price <= p0):
                real.append(("wrong_side", None)); continue
            real.append(level_test(i0, s.price, role))
            d = abs(p0 - s.price)
            for _ in range(20):
                Lp = p0 - role * d * rng.uniform(0.5, 1.5)
                plac.append(level_test(i0, Lp, role))

        def rate(xs):
            xs = [x for x in xs if x[0] != "wrong_side"]
            t = [x for x in xs if x[0]]
            h = [x for x in t if x[1] is True]
            b = [x for x in t if x[1] is False]
            return len(xs), len(t), len(h), len(b)
        n, t, h, b = rate(real)
        pn, pt, ph, pb = rate(plac)
        ws = sum(1 for x in real if x[0] == "wrong_side")
        print(f"  {role_name:10} calls {len(sub)} (already on the wrong side at t0: {ws}) | touched {t}/{n} | held {h}, broke {b} -> hold rate {h/max(h+b,1):.2f}"
              f" | placebo hold rate {ph/max(ph+pb,1):.2f} (touched {pt}/{pn})")
        if h + b:
            # binomial z against the placebo rate
            p = ph / max(ph + pb, 1); k = h + b
            z = (h - k * p) / np.sqrt(k * p * (1 - p)) if 0 < p < 1 else np.nan
            print(f"             z vs placebo {z:.2f}")

    # ---- targets
    print("\n== forward TARGETS: reached within 7d vs the mirrored target at the same distance ==")
    for role_name in ("TARGET_UP", "TARGET_DOWN"):
        sub = L[(L.role == role_name) & L.forward]
        hits, mirror, n = 0, 0, 0
        for _, s in sub.iterrows():
            i0 = at(s.t0); p0 = cl[i0]
            if abs(s.price / p0 - 1) < 0.002:
                continue
            n += 1
            hits += target_hit(i0, s.price)
            mirror += target_hit(i0, 2 * p0 - s.price)
        print(f"  {role_name:11} n {n} | hit {hits/max(n,1):.2f} | mirrored target hit {mirror/max(n,1):.2f}")

    # ---- stance
    print("\n== STANCE: forward BTC return after t0 (mean, t, share up) ==")
    st = []
    for a in ann:
        r = inp[a["id"]]; i0 = at(r["t0"])
        rec = dict(stance=a.get("stance"))
        for hh, name in ((24, "1d"), (72, "3d"), (168, "7d")):
            j = min(i0 + hh, len(cl) - 1)
            rec[name] = cl[j] / cl[i0] - 1 if j > i0 else np.nan
        st.append(rec)
    S = pd.DataFrame(st).dropna()
    for name in ("1d", "3d", "7d"):
        line = []
        for s in ("BULL", "BEAR", "NEUTRAL", "NONE"):
            x = S[S.stance == s][name]
            if len(x) > 2:
                line.append(f"{s} n={len(x)} mean {x.mean()*100:+.2f}% (t {x.mean()/(x.std()/np.sqrt(len(x))):+.1f}, up {np.mean(x>0):.2f})")
        allx = S[name]
        print(f"  {name}: " + " | ".join(line) + f" | ALL mean {allx.mean()*100:+.2f}% up {np.mean(allx>0):.2f}")
    bb = S[S.stance.isin(["BULL", "BEAR"])]
    for name in ("1d", "3d", "7d"):
        sign = np.where(bb.stance == "BULL", 1, -1)
        hit = np.mean(np.sign(bb[name]) == sign)
        print(f"  directional hit rate {name}: {hit:.3f} over {len(bb)} BULL/BEAR titles")

    # ---- methods
    print("\n== METHODS mentioned in titles (count, share of BTC titles) by year ==")
    yr = Counter(); mc = Counter(); tf = Counter()
    by = {}
    for a in ann:
        y = inp[a["id"]]["published"][:4]; yr[y] += 1
        for m in set(a.get("methods", [])):
            mc[m] += 1; by.setdefault(m, Counter())[y] += 1
        for t in set(a.get("timeframes", [])):
            tf[t] += 1
    years = sorted(yr)
    print("  " + "method".ljust(20) + "total  " + "  ".join(years))
    for m, k in mc.most_common():
        print("  " + m.ljust(20) + f"{k:5}  " + "  ".join(f"{by[m][y]:4}" for y in years))
    print("  titles/year        " + "  ".join(f"{yr[y]:4}" for y in years))
    print("  timeframes:", dict(tf.most_common()))
    L.to_csv("yt/levels.csv", index=False)


if __name__ == "__main__":
    main()
