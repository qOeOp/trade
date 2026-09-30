"""TrialFamily filters-v1, iteration 1: see filters/INTENT.md (registered before this file was written).

Real events: s6_confirm.run_confirm(mode="zone_only", k=3) per market. Filters are computed at the signal bar (the bar
before entry) by one function for real and placebo events alike, from the same per-bar zone schedule and trend-line
rule run_confirm uses (tv_effect.zone_schedule with the default map reproduces run_confirm's zones exactly).
Outputs: filters/census.csv (every trial scored), filters/result.txt, filters/events.csv.gz (real events and filters).
"""
import gzip, itertools, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import s6_confirm as S  # noqa: E402
import tv_fx_mtf  # noqa: E402
import tv_hourly  # noqa: E402
from ronnie_plan import features, load  # noqa: E402
from s6_confluence import C  # noqa: E402
from tv_effect import DEFAULT, zone_schedule  # noqa: E402
from tv_mtf import overlap, weekly  # noqa: E402

AGG = {"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}
SEGMENTS = {"train": ("2017-01-01", "2020-12-21"), "validation": ("2021-01-01", "2022-12-21"),
            "test": ("2023-01-01", "2026-09-30")}
FILTERS = ["weekly_trend", "daily_trend", "calm", "squeeze", "resonance", "trend_line", "rr3", "tested", "strong_candle",
           "tight_stop"]
COMBOS = [()] + [c for k in (1, 2, 3) for c in itertools.combinations(range(len(FILTERS)), k)]
PLACEBO_SETS, PERMUTATIONS = 50, 200
RNG = np.random.default_rng(2026)


def markets():
    d4, d1 = load()
    yield "BTCUSD", d4, d1
    t0, t1 = int(pd.Timestamp("2016-10-01").value // 10**9), int(pd.Timestamp("2026-09-30").value // 10**9)
    e = tv_hourly.binance("ETHUSDT", t0, t1).drop_duplicates("time").sort_values("time")
    e.index = pd.to_datetime(e.time, unit="s", utc=True)
    e["volume"] = 1.0
    yield "ETHUSDT", *resample(e)
    for pair in tv_fx_mtf.PAIRS:
        yield pair, *resample(tv_fx_mtf.hourly(pair))


def resample(h):
    h = h[["open", "high", "low", "close", "volume"]]
    d4 = h.resample("4h", label="left", closed="left").agg(AGG).dropna()
    d1 = h.resample("1D", label="left", closed="left").agg(AGG).dropna()
    return d4[d4.index >= "2017-01-01"], d1


class Market:
    """Per-bar context for one market: zones known at each bar's close, trend-line values, daily trend."""

    def __init__(self, name, d4, d1):
        self.name, self.F = name, features(d4, d1)
        F = self.F
        self.o, self.h, self.l, self.c, self.atr = F["o"], F["h"], F["l"], F["c"], F["atr"]
        self.n = len(self.c)
        t4 = d4.index.as_unit("s").asi8 + 4 * 3600
        self.z4 = zone_schedule(d4, t4, t4, DEFAULT)
        w1 = weekly(d1)
        D = zone_schedule(d1, d1.index.as_unit("s").asi8 + 86400, t4, DEFAULT)
        W = zone_schedule(w1, w1.index.as_unit("s").asi8 + 7 * 86400, t4, DEFAULT)
        self.res = [overlap(a, b) for a, b in zip(D, W)]
        sma = d1.close.rolling(50).mean()
        sign = np.sign(d1.close - sma).fillna(0)
        sign.index = sign.index + pd.Timedelta(days=1)  # known at the day's close
        self.dtrend = sign.reindex(d4.index + pd.Timedelta(hours=4), method="ffill").fillna(0).values
        self.atr_med = pd.Series(self.atr).rolling(120, min_periods=60).median().values
        self._pivots()

    def _pivots(self, k=3):
        """Last two confirmed pivot highs and lows as known at each bar (s6 keeps the last four; the rule uses two)."""
        h, l, n = self.h, self.l, self.n
        hp, lp = [], []
        self.hp, self.lp = [None] * n, [None] * n
        for i in range(n):
            if i >= 2 * k:
                j = i - k
                if h[j] == h[j - k:j + k + 1].max():
                    hp = (hp + [(j, h[j])])[-2:]
                if l[j] == l[j - k:j + k + 1].min():
                    lp = (lp + [(j, l[j])])[-2:]
            self.hp[i], self.lp[i] = list(hp), list(lp)

    def line_val(self, side, i):
        """s6_confirm's trend-line rule at bar i, with the pivots known at bar i's close (run_confirm adds the pivot
        confirmed at bar i before it reads the line)."""
        pts = (self.lp if side == 1 else self.hp)[i]
        if len(pts) < 2:
            return None
        (j1, v1), (j2, v2) = pts
        if j2 - j1 < C["min_gap"] or i - j2 > C["max_age"]:
            return None
        if side == 1 and not v2 > v1 or side == -1 and not v2 < v1:
            return None
        idx = np.arange(j2, i + 1)
        vals = v2 + (v2 - v1) * (idx - j2) / (j2 - j1)
        c = self.c
        if side == 1 and (c[j2:i] < vals[:-1]).any() or side == -1 and (c[j2:i] > vals[:-1]).any():
            return None
        return vals[-1]

    def zone(self, side, i):
        zs = self.z4[i - 1] if i > 0 else []
        if side == 1:
            cands = [z for z in zs if z.hi < self.c[i - 1]]
            return max(cands, key=lambda z: z.hi) if cands else None
        cands = [z for z in zs if z.lo > self.c[i - 1]]
        return min(cands, key=lambda z: z.lo) if cands else None

    def feats(self, side, i, stop_atr, target_r, tight_cut):
        a = self.atr[i]
        z = self.zone(side, i)
        tl = self.line_val(side, i)
        rng_ = self.h[i] - self.l[i]
        near = lambda lo, hi, w: w.lo - 0.5 * a <= hi and lo <= w.hi + 0.5 * a  # noqa: E731
        return [self.F["dirn"][i] == side,
                self.dtrend[i] == side,
                bool(a < self.atr_med[i]) if not np.isnan(self.atr_med[i]) else False,
                bool(self.F["squeezed"][i]),
                z is not None and any(near(z.lo, z.hi, w) for w in self.res[i]),
                z is not None and tl is not None and z.lo - C["zone_pad_atr"] * a <= tl <= z.hi + C["zone_pad_atr"] * a,
                target_r >= 3,
                z is not None and z.touches >= 3,
                rng_ > 0 and abs(self.c[i] - self.o[i]) >= 0.6 * rng_,
                stop_atr <= tight_cut]

    def outcome(self, i0, s, stop_atr, target_r):
        """s6_confluence.random_control's market-entry simulation, entry at bar i0's open."""
        o, h, l, c = self.o, self.h, self.l, self.c
        e = o[i0] * (1 + s * C["slip"])
        risk = stop_atr * self.atr[i0 - 1]
        stop, tgt = e - s * risk, e + s * target_r * risk
        fund, px, fee = 0.0, None, C["taker"]
        for i in range(i0, i0 + C["max_hold"] + 1):
            fund += s * c[i] * C["funding_8h"] * 4 / 8
            if s == 1 and l[i] <= stop or s == -1 and h[i] >= stop:
                px, fee = (min(o[i], stop) if s == 1 else max(o[i], stop)) * (1 - s * C["slip"]), C["taker"]
                break
            if i > i0 and (s == 1 and h[i] > tgt or s == -1 and l[i] < tgt):
                px, fee = (max(o[i], tgt) if s == 1 else min(o[i], tgt)), C["maker"]
                break
        if px is None:
            px = c[i0 + C["max_hold"]]
        return (s * (px - e) - e * C["taker"] - px * fee - fund) / risk


def segment(ts):
    for name, (a, b) in SEGMENTS.items():
        if pd.Timestamp(a, tz="UTC") <= ts < pd.Timestamp(b, tz="UTC"):
            return name
    return None  # embargo gap


def score(ev, segs):
    """-> {combo: {seg: (n, avgR)}} over the requested segments."""
    X = ev[FILTERS].values.astype(bool)
    out = {}
    for combo in COMBOS:
        m = X[:, list(combo)].all(axis=1) if combo else np.ones(len(ev), bool)
        out[combo] = {s: (int((m & (ev.seg == s)).sum()), float(ev.R[m & (ev.seg == s)].mean()) if (m & (ev.seg == s)).any() else np.nan)
                      for s in segs}
    return out


def select(sc):
    ok = [(c, v) for c, v in sc.items() if c and v["train"][0] >= 30 and v["validation"][0] >= 15 and v["train"][1] > 0]
    if not ok:
        return None
    return max(ok, key=lambda cv: (cv[1]["validation"][1], -len(cv[0])))[0]


def test_avg(ev, combo):
    X = ev[FILTERS].values.astype(bool)
    m = (X[:, list(combo)].all(axis=1) if combo else np.ones(len(ev), bool)) & (ev.seg == "test").values
    return int(m.sum()), float(ev.R[m].mean()) if m.any() else np.nan


def main():
    real_rows, mk = [], {}
    for name, d4, d1 in markets():
        M = Market(name, d4, d1)
        mk[name] = M
        tr = S.run_confirm(M.F, "zone_only", k=3)
        t = pd.DatetimeIndex(M.F["t"])
        tr["seg"] = [segment(x) for x in tr.entry_time]
        train_stops = tr.loc[tr.seg == "train", "stop_atr"]
        M.tight = float(train_stops.median()) if len(train_stops) else np.inf
        for r in tr.itertuples():
            i0 = int(t.get_loc(r.entry_time))
            real_rows.append(dict(market=name, entry_time=r.entry_time, seg=r.seg, side=r.side, R=r.R, stop_atr=r.stop_atr,
                                  target_R=r.target_R, **dict(zip(FILTERS, M.feats(r.side, i0 - 1, r.stop_atr, r.target_R, M.tight)))))
        print(f"{name}: {len(tr)} base events", flush=True)
    ev = pd.DataFrame(real_rows)
    ev = ev[ev.seg.notna()].reset_index(drop=True)
    with gzip.GzipFile(f"{HERE}/events.csv.gz", "wb", mtime=0) as f:
        f.write(ev.to_csv(index=False).encode())

    # real: train and validation for every trial, test only for the selected combination and the base
    sc = score(ev, ("train", "validation"))
    chosen = select(sc)
    census = [dict(kind="real", set=0, combo="+".join(FILTERS[i] for i in c) or "base", seg=s, n=v[s][0], avgR=v[s][1])
              for c, v in sc.items() for s in ("train", "validation")]
    base_test = test_avg(ev, ())
    sel_test = test_avg(ev, chosen) if chosen else (0, np.nan)
    census += [dict(kind="real", set=0, combo="base", seg="test", n=base_test[0], avgR=base_test[1])]
    if chosen:
        census += [dict(kind="real", set=0, combo="+".join(FILTERS[i] for i in chosen), seg="test", n=sel_test[0], avgR=sel_test[1])]

    # placebo sets: one random signal bar per real event, same market, year, side, stop and target geometry
    null_test = []
    for p in range(PLACEBO_SETS):
        rows = []
        for r in ev.itertuples():
            M = mk[r.market]
            t = pd.DatetimeIndex(M.F["t"])
            yr = t.year == r.entry_time.year
            bars = np.flatnonzero(yr & (np.arange(M.n) > 600) & (np.arange(M.n) < M.n - C["max_hold"] - 2))
            i = int(RNG.choice(bars))
            rows.append(dict(market=r.market, seg=segment(t[i + 1]), R=M.outcome(i + 1, r.side, r.stop_atr, r.target_R),
                             **dict(zip(FILTERS, M.feats(r.side, i, r.stop_atr, r.target_R, M.tight)))))
        pe = pd.DataFrame(rows)
        pe = pe[pe.seg.notna()].reset_index(drop=True)
        psc = score(pe, ("train", "validation"))
        pc = select(psc)
        pt = test_avg(pe, pc) if pc else (0, np.nan)
        null_test.append(pt[1])
        census.append(dict(kind="placebo", set=p + 1, combo="+".join(FILTERS[i] for i in pc) if pc else "none", seg="test", n=pt[0], avgR=pt[1]))
        print(f"placebo {p + 1}: {census[-1]['combo']} test {pt[1]:+.3f} (n={pt[0]})", flush=True)

    # secondary (added, not in the registration): permute R across events within market and segment
    perm_val = []
    for _ in range(PERMUTATIONS):
        q = ev.copy()
        q["R"] = q.groupby(["market", "seg"]).R.transform(lambda x: RNG.permutation(x.values))
        qc = select(score(q, ("train", "validation")))
        perm_val.append(score(q, ("validation",))[qc]["validation"][1] if qc else np.nan)

    pd.DataFrame(census).to_csv(f"{HERE}/census.csv", index=False)
    null_test = np.array([x for x in null_test if not np.isnan(x)])
    perm_val = np.array([x for x in perm_val if not np.isnan(x)])
    lines = [f"filters-v1 iteration 1: {len(ev)} base events over {ev.market.nunique()} markets "
             f"(train {int((ev.seg == 'train').sum())}, validation {int((ev.seg == 'validation').sum())}, test {int((ev.seg == 'test').sum())})",
             f"base (no filter): train {sc[()]['train'][1]:+.3f} (n={sc[()]['train'][0]}), validation {sc[()]['validation'][1]:+.3f} "
             f"(n={sc[()]['validation'][0]}), test {base_test[1]:+.3f} (n={base_test[0]})"]
    if chosen:
        v = sc[chosen]
        lines.append(f"selected: {' + '.join(FILTERS[i] for i in chosen)}: train {v['train'][1]:+.3f} (n={v['train'][0]}), "
                     f"validation {v['validation'][1]:+.3f} (n={v['validation'][0]}), test {sel_test[1]:+.3f} (n={sel_test[0]})")
        top = sorted(((c, s) for c, s in sc.items() if c and s["train"][0] >= 30 and s["validation"][0] >= 15 and s["train"][1] > 0),
                     key=lambda cs: -cs[1]["validation"][1])[:8]
        lines.append("  next eligible by validation avgR: " + "; ".join(
            f"{'+'.join(FILTERS[i] for i in c)} {s['validation'][1]:+.3f}/{s['validation'][0]}" for c, s in top[1:]))
    else:
        lines.append("selected: none eligible")
    lines.append(f"placebo-selected test avgR over {len(null_test)} sets: median {np.median(null_test):+.3f}, "
                 f"95th percentile {np.percentile(null_test, 95):+.3f}")
    lines.append(f"permutation (secondary): best validation avgR after selection on shuffled outcomes: median {np.median(perm_val):+.3f}, "
                 f"95th percentile {np.percentile(perm_val, 95):+.3f}; real selected validation "
                 f"{sc[chosen]['validation'][1] if chosen else np.nan:+.3f}")
    passed = bool(chosen) and sel_test[1] > base_test[1] and sel_test[1] > np.percentile(null_test, 95)
    lines.append(f"falsifier: selected test > base test: {bool(chosen) and sel_test[1] > base_test[1]}; "
                 f"selected test > placebo 95th percentile: {bool(chosen) and sel_test[1] > np.percentile(null_test, 95)}; "
                 f"decision: {'READY_FOR_SELECTION (scratch; authorizes a report only)' if passed else 'FALSIFIED -> STOP'}")
    by_market = ev.groupby(["market", "seg"]).R.agg(["size", "mean"]).unstack("seg")
    lines.append("base events by market (n, avgR): " + "; ".join(
        f"{m} " + " ".join(f"{s}:{int(by_market.loc[m, ('size', s)]) if not np.isnan(by_market.loc[m, ('size', s)]) else 0}/{by_market.loc[m, ('mean', s)]:+.2f}"
                           for s in ("train", "validation", "test")) for m in by_market.index))
    text = "\n".join(lines)
    print(text)
    open(f"{HERE}/result.txt", "w").write(text + "\n")


if __name__ == "__main__":
    main()
