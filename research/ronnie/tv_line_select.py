"""Which lines Ronnie keeps (2026-10-03). tv_line_fidelity.py found that 83% of his near-price lines exist among the
lines through two order-3 pivots, but most of them have been closed through (median 15% of bars), so "never broken,
most touches" ranks them about 1,000th. This script learns his selection: every candidate line at publish (order-3 pivots over 2,000 bars, plus order-1 and order-2 pivots over the last 150
bars for the short, steep lines he draws along the latest leg) gets
features (touches from its own side and from the other side, closes through it over its life and over the last 100
bars, crossings, span, bars since the last touch, distance from price, slope against side, body or wick anchor), a
logistic score is fitted on the charts of ideas published on odd days, and the top N lines per side (no two within the
match tolerance of each other) are scored on even days: recall of his lines against the same lines moved 1.5 ATR.
Usage: python tv_line_select.py   (writes results/tv_line_select.txt)"""
import itertools

import numpy as np
import pandas as pd

import tv_line_fidelity as F
import tv_line_method as M

CONFIGS = ((3, 2000, 0.0), (1, 150, 1.0), (2, 150, 1.0))  # (pivot order, look-back bars, minor flag)
FEATS = ["t_same", "t_opp", "t_recent", "through", "through_recent", "cross", "log_span", "log_age", "dist", "slope_ok", "body", "minor"]


def candidates(sym, tf, now):
    return pd.concat([candidates_k(sym, tf, now, *cfg) for cfg in CONFIGS], ignore_index=True)


def candidates_k(sym, tf, now, K, LOOK, minor):
    d = M.bars(sym, tf)
    o, h, l, c, a = (d[x].values[: now + 1] for x in ("o", "h", "l", "c", "atr"))
    hi, lo = M.pivots(d.iloc[: now + 1], K)
    lo0 = max(0, now - LOOK)
    PH, PL = np.flatnonzero(hi[lo0: now - K + 1]) + lo0, np.flatnonzero(lo[lo0: now - K + 1]) + lo0
    rows = []
    for body in (False, True):
        hh, ll = (np.maximum(o, c), np.minimum(o, c)) if body else (h, l)
        for typ, piv, ext in (("low", PL, ll), ("high", PH, hh)):
            for u, v in itertools.combinations(range(len(piv)), 2):
                j1, j2 = piv[u], piv[v]
                sl = (ext[j2] - ext[j1]) / (j2 - j1)
                v_now = ext[j1] + sl * (now - j1)
                if abs(v_now - c[now]) > 3 * a[now]:
                    continue
                side = 1 if v_now < c[now] else -1
                idx = np.arange(j1, now + 1)
                y = ext[j1] + sl * (idx - j1)
                rel = (c[j1:now + 1] - y) * side
                th = rel < -0.1 * a[j1:now + 1]
                sgn = np.sign(c[j1:now + 1] - y)
                yh, yl = ext[j1] + sl * (PH - j1), ext[j1] + sl * (PL - j1)
                mh, ml = PH >= j1, PL >= j1
                th_h = mh & (np.abs(h[PH] - yh) <= 0.2 * a[PH])
                th_l = ml & (np.abs(l[PL] - yl) <= 0.2 * a[PL])
                same, opp = (th_l, th_h) if side == 1 else (th_h, th_l)
                same_idx = PL if side == 1 else PH
                touched = np.r_[PH[th_h], PL[th_l]]
                rows.append(dict(side=side, body=float(body), v_now=v_now, v_back=ext[j1] + sl * (now - 100 - j1),
                                 t_same=same.sum(), t_opp=opp.sum(), t_recent=int(np.sum(same & (same_idx >= now - 100))),
                                 through=th.mean(), through_recent=th[-100:].mean(),
                                 cross=np.log1p(np.sum(sgn[1:] != sgn[:-1])), log_span=np.log(j2 - j1),
                                 log_age=np.log1p(now - touched.max()) if len(touched) else np.log1p(now - j2),
                                 dist=abs(v_now - c[now]) / a[now], slope_ok=float(np.sign(sl) == side), minor=minor, a=a[now]))
    return pd.DataFrame(rows)


def fit(X, y, l2=1.0, iters=3000, lr=0.1):
    w = np.zeros(X.shape[1] + 1)
    Xb = np.c_[np.ones(len(X)), X]
    pw = (len(y) - y.sum()) / max(y.sum(), 1)  # class weight for the rare positives
    sw = np.where(y == 1, pw, 1.0)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Xb @ w))
        g = Xb.T @ (sw * (p - y)) / sw.sum() + l2 * np.r_[0, w[1:]] / len(y)
        w -= lr * g
    return w


def pick(z, n):
    """top n per side by score, skipping lines within the match tolerance of one already picked"""
    out = []
    for _, g in z.groupby("side"):
        kept = []
        for r in g.sort_values("score", ascending=False).itertuples():
            if all(abs(r.v_now - q.v_now) > 0.5 * r.a or abs(r.v_back - q.v_back) > 1.0 * r.a for q in kept):
                kept.append(r)
            if len(kept) == n:
                break
        out += kept
    return out


def main():
    H = F.his_lines()
    C = {key: candidates(*key) for key in H.key.unique()}
    rows = []
    for key, z in C.items():
        if not len(z):
            continue
        his = H[H.key == key]
        lab = np.zeros(len(z), int)
        for r in his.itertuples():
            lab |= ((z.side == r.side) & (abs(z.v_now - r.v_now) <= 0.5 * r.a) & (abs(z.v_back - r.v_back) <= 1.0 * r.a)).values
        z = z.assign(y=lab, key=[key] * len(z), odd=his.odd.iloc[0])
        rows.append(z)
    Z = pd.concat(rows, ignore_index=True)
    cal = Z[Z.odd]
    mu, sd = cal[FEATS].mean(), cal[FEATS].std().replace(0, 1)
    w = fit(((cal[FEATS] - mu) / sd).values, cal.y.values)
    Z["score"] = np.c_[np.ones(len(Z)), ((Z[FEATS] - mu) / sd).values] @ w
    out = [f"Learning which lines Ronnie keeps: {len(H)} lines of his, {len(Z)} candidate lines on {Z.key.nunique()} charts,"
           f" {int(Z.y.sum())} candidates match one of his",
           "logistic weights (standardised features, fitted on the calibration half):",
           "  " + ", ".join(f"{f} {x:+.2f}" for f, x in zip(FEATS, w[1:]))]
    for n in (2, 3, 4):
        for half, lab in ((True, "calibration"), (False, "check")):
            hit = moved = 0
            hs = H[H.odd == half]
            for r in hs.itertuples():
                z = Z[Z.key == r.key]
                chosen = [q for q in pick(z, n) if q.side == r.side]
                m = lambda s: any(abs(q.v_now - (r.v_now + s * r.a)) <= 0.5 * r.a and abs(q.v_back - (r.v_back + s * r.a)) <= 1.0 * r.a for q in chosen)  # noqa: E731
                hit += m(0.0)
                moved += np.mean([m(-1.5), m(1.5)])
            out.append(f"  top {n} per side, {lab}: recall {hit / len(hs):.0%}, moved {moved / len(hs):.0%}, fidelity {(hit - moved) / len(hs):+.0%} ({len(hs)} lines)")
    out.append("reference (tv_line_fidelity.py): never-broken drawer, check half recall 26%, moved 3%")
    t = "\n".join(out)
    print(t)
    open("results/tv_line_select.txt", "w").write(t + "\n")
    Z.drop(columns=["key"]).to_csv("/tmp/claude-0/-home-user-trade/bbd6b895-498e-57c8-ae26-b834b0e509ed/scratchpad/line_candidates.csv.gz", index=False)


if __name__ == "__main__":
    main()
