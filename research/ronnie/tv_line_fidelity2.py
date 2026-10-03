"""Second fidelity round (2026-10-03): three kinds of line, drawn at publish from bars up to publish.
- clean: through two order-3 pivots over 2,000 bars, never closed through (the first round's drawer);
- broken: through two order-3 pivots, never closed through until a break after the later pivot, the break within the
  last W bars, and price on the new side since on at least 70% of closes: a broken trend line being retested, the
  diagonal form of role reversal (the selection model gave lines whose slope opposes their current side a negative
  weight: his support lines are often falling, broken resistance);
- minor: through two order-1 or order-2 pivots of the last 150 bars, never closed through: the short, steep lines he
  draws along the latest leg.
Each kind keeps its top lines per side by touches (then span), no two within the match tolerance. The combination is
chosen on ideas published on odd days and checked on even days, against his lines moved 1.5 ATR.
Usage: python tv_line_fidelity2.py   (writes results/tv_line_fidelity2.txt)"""
import itertools

import numpy as np
import pandas as pd

import tv_line_fidelity as F
import tv_line_method as M


def lines(sym, tf, now, k, look, kind, window=200):
    d = M.bars(sym, tf)
    h, l, c, a = (d[x].values[: now + 1] for x in ("h", "l", "c", "atr"))
    hi, lo = M.pivots(d.iloc[: now + 1], k)
    lo0 = max(0, now - look)
    rows = []
    for typ, piv, ext in (("low", np.flatnonzero(lo[lo0: now - k + 1]) + lo0, l), ("high", np.flatnonzero(hi[lo0: now - k + 1]) + lo0, h)):
        own = 1 if typ == "low" else -1  # the side the line held price on before any break
        pe = ext[piv]
        for u, v in itertools.combinations(range(len(piv)), 2):
            j1, j2 = piv[u], piv[v]
            sl = (ext[j2] - ext[j1]) / (j2 - j1)
            v_now = ext[j1] + sl * (now - j1)
            if abs(v_now - c[now]) > 3 * a[now]:
                continue
            idx = np.arange(j1, now + 1)
            y = ext[j1] + sl * (idx - j1)
            th = (c[j1:now + 1] - y) * own < -0.1 * a[j1:now + 1]
            if kind in ("clean", "minor"):
                if th.any() or (c[now] - v_now) * own <= 0:
                    continue
                side, t_end = own, now
            else:
                br = np.flatnonzero(th)
                if not len(br) or br[0] + j1 <= j2:
                    continue
                b = br[0] + j1
                if now - b > window or np.mean((c[b:now + 1] - y[b - j1:]) * own < 0) < 0.7 or (c[now] - v_now) * own >= 0:
                    continue
                side, t_end = -own, b
            m = (piv >= j1) & (piv <= t_end)
            touches = int(np.sum(m & (np.abs(pe - (ext[j1] + sl * (piv - j1))) <= 0.2 * a[piv])))
            rows.append(dict(side=side, touches=touches, span=j2 - j1, v_now=v_now, v_back=ext[j1] + sl * (now - 100 - j1), a=a[now]))
    return pd.DataFrame(rows)


def top(z, n):
    out = []
    if not len(z) or n == 0:
        return out
    for _, g in z.groupby("side"):
        kept = []
        for r in g.sort_values(["touches", "span"], ascending=False).itertuples():
            if all(abs(r.v_now - q.v_now) > 0.5 * r.a or abs(r.v_back - q.v_back) > 1.0 * r.a for q in kept):
                kept.append(r)
            if len(kept) == n:
                break
        out += kept
    return out


def main():
    H = F.his_lines()
    keys = H.key.unique()
    L = {}
    for key in keys:
        L[(key, "clean")] = lines(*key, 3, 2000, "clean")
        L[(key, "minor")] = pd.concat([lines(*key, kk, 150, "minor") for kk in (1, 2)], ignore_index=True)
        for w in (50, 200):
            L[(key, f"broken{w}")] = lines(*key, 3, 2000, "broken", w)
    grid = []
    for nc, nb, nm, w in itertools.product((1, 2), (0, 1, 2), (0, 1, 2), (50, 200)):
        drawn = {key: top(L[(key, "clean")], nc) + top(L[(key, f"broken{w}")], nb) + top(L[(key, "minor")], nm) for key in keys}
        for half in (True, False):
            hs = H[H.odd == half]
            hit = moved = 0
            for r in hs.itertuples():
                ch = [q for q in drawn[r.key] if q.side == r.side]
                m = lambda s: any(abs(q.v_now - (r.v_now + s * r.a)) <= 0.5 * r.a and abs(q.v_back - (r.v_back + s * r.a)) <= 1.0 * r.a for q in ch)  # noqa: E731
                hit += m(0.0)
                moved += np.mean([m(-1.5), m(1.5)])
            grid.append(dict(clean=nc, broken=nb, minor=nm, window=w, half="calib" if half else "check",
                             lines_per_side=nc + nb + nm, recall=hit / len(hs), moved=moved / len(hs), fidelity=(hit - moved) / len(hs)))
    G = pd.DataFrame(grid)
    cal = G[G.half == "calib"].sort_values(["fidelity", "lines_per_side"], ascending=[False, True])
    best = cal.iloc[0]
    sel = lambda g: g[(g.clean == best.clean) & (g.broken == best.broken) & (g.minor == best.minor) & (g.window == best.window)]  # noqa: E731
    chk = sel(G[G.half == "check"]).iloc[0]
    out = [f"Second fidelity round: clean, broken (retested) and minor lines; {len(H)} lines of his",
           "top calibration cells:", cal.head(10).round(3).to_string(index=False), "",
           f"chosen: clean {best.clean}, broken {best.broken} (break within {best.window} bars), minor {best.minor} per side",
           f"  check half: recall {chk.recall:.0%}, moved {chk.moved:.0%}, fidelity {chk.fidelity:+.0%}",
           "first round (clean only, top 2): check recall 26%, moved 3%",
           "mean check recall by kind added: broken " + ", ".join(f"{k} {v:.0%}" for k, v in G[G.half == 'check'].groupby('broken').recall.mean().items())
           + "; minor " + ", ".join(f"{k} {v:.0%}" for k, v in G[G.half == 'check'].groupby('minor').recall.mean().items())]
    t = "\n".join(out)
    print(t)
    open("results/tv_line_fidelity2.txt", "w").write(t + "\n")


if __name__ == "__main__":
    main()
