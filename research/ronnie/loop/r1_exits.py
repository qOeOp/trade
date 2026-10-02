"""Exit iteration X-R1 (loop/LOG.md): R-1 entries with a grid of zone caps, stop buffers and targets; weekly R Sharpe at
fixed risk; plateau selection; CSCV PBO. Writes loop/r1_exits.txt."""
import itertools, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402

T0, T1 = pd.Timestamp("2018-01-01", tz="UTC"), pd.Timestamp("2023-01-01", tz="UTC")
CAPS, BUFS, TGTS = (0.25, 0.5, 1.0), (0.1, 0.25, 0.5), ("1.5R", "2R", "3R", "structure", "none")
FEE = 0.0006


def pivots(h, l, k=FR.K):
    ph, pl = [], []
    for j in range(k, len(h) - k):
        if h[j] == h[j - k:j + k + 1].max():
            ph.append((j + k, h[j]))
        if l[j] == l[j - k:j + k + 1].min():
            pl.append((j + k, l[j]))
    return ph, pl


def walk(S, k, side, px, stop, tgt):
    o, h, l, c = S["o"], S["h"], S["l"], S["c"]
    risk = abs(px - stop)
    for m in range(k, min(k + FR.HOLD, len(c))):
        if (side == 1 and l[m] <= stop) or (side == -1 and h[m] >= stop):
            ex = min(o[m], stop) if side == 1 and m > k else (max(o[m], stop) if side == -1 and m > k else stop)
            return (ex - px) * side / risk - 2 * FEE * px / risk, m
        if tgt is not None and m > k and ((side == 1 and h[m] >= tgt) or (side == -1 and l[m] <= tgt)):
            ex = max(o[m], tgt) if side == 1 else min(o[m], tgt)
            return (ex - px) * side / risk - 2 * FEE * px / risk, m
    m = min(k + FR.HOLD, len(c)) - 1
    return (c[m] - px) * side / risk - 2 * FEE * px / risk, m


def trades(coin):
    d = E.bars(coin)["1d"]
    S = FR.state(d)
    ph, pl = pivots(S["h"], S["l"])
    out, cand = {}, {}
    for i, kind, p in S["events"]:
        if kind not in ("break_high", "break_low") or i + 1 >= len(S["c"]) or np.isnan(S["a"][i]):
            continue
        side = 1 if kind == "break_high" else -1
        if S["trend"][i] != side:
            continue
        lvl, edge, a = p[1], p[2], S["a"][i]
        k, px = FR.fill(S, i + 1, side, lvl)
        if k is None:
            continue
        for cap, buf, tg in itertools.product(CAPS, BUFS, TGTS):
            v = (cap, buf, tg)
            lower = max(edge, lvl - cap * a) if side == 1 else min(edge, lvl + cap * a)
            stop = lower - side * buf * a
            if (px - stop) * side <= 0:
                continue
            risk = abs(px - stop)
            if tg == "none":
                tgt = None
            elif tg == "structure":
                cands = [q for j, q in (ph if side == 1 else pl) if j <= i and (q - px) * side > 0]
                tgt = (min(cands) if side == 1 else max(cands)) if cands else px + side * 3 * risk
            else:
                tgt = px + side * float(tg[:-1]) * risk
            R, m = walk(S, k, side, px, stop, tgt)
            cand.setdefault(v, []).append((k, m, R))
    # one trade per coin: the first fill takes the slot, which frees at the exit (as loop/family_r.signals)
    for v, rows in cand.items():
        busy = -1
        for k, m, R in sorted(rows, key=lambda x: x[0]):
            if k <= busy:
                continue
            busy = m
            if T0 <= d.index[k] < T1:
                out.setdefault(v, []).append((d.index[k], R))
    return out


def main():
    allv = {}
    for coin in E.ITER_COINS + E.ITER_EXT_COINS:
        for v, rows in trades(coin).items():
            allv.setdefault(v, []).extend(rows)
    idx = pd.date_range(T0, T1, freq="W-MON", inclusive="left")
    W = pd.DataFrame({v: pd.Series([r for _, r in rows], index=[t for t, _ in rows]).resample("W-MON").sum().reindex(idx).fillna(0)
                      for v, rows in allv.items()})
    sh = W.mean() / W.std() * np.sqrt(52)
    n = pd.Series({v: len(r) for v, r in allv.items()})
    avg = pd.Series({v: np.mean([x for _, x in r]) for v, r in allv.items()})
    def nb(v):
        cap, buf, tg = v
        ci, bi = CAPS.index(cap), BUFS.index(buf)
        return [(CAPS[a], BUFS[b], tg) for a in range(max(0, ci - 1), min(3, ci + 2)) for b in range(max(0, bi - 1), min(3, bi + 2))
                if abs(a - ci) + abs(b - bi) <= 1]
    plateau = pd.Series({v: np.mean([sh[u] for u in nb(v) if u in sh]) for v in sh.index})
    best = plateau.idxmax()
    base = (1.0, 0.25, "2R")
    # CSCV PBO
    M = W.values
    blocks = np.array_split(np.arange(len(M)), 12)
    logits = []
    for comb in itertools.combinations(range(12), 6):
        ins = np.concatenate([blocks[i] for i in comb]); oos = np.concatenate([blocks[i] for i in range(12) if i not in comb])
        si = M[ins].mean(0) / M[ins].std(0); so = M[oos].mean(0) / M[oos].std(0)
        b = int(np.argmax(si)); w = ((so < so[b]).sum() + 1) / (len(so) + 1)
        logits.append(np.log(w / (1 - w)))
    pbo = float((np.array(logits) <= 0).mean())
    tab = pd.DataFrame({"n": n, "avgR": avg, "sharpe": sh, "plateau": plateau}).sort_values("plateau", ascending=False)
    lines = [f"X-R1: R-1 entries, 45 exit variants (zone cap, buffer, target), 53 coins 2018-2022; weekly R Sharpe",
             f"R-1 as registered {base}: n {n[base]}, avg R {avg[base]:+.3f}, Sharpe {sh[base]:.2f}",
             f"plateau choice {best}: n {n[best]}, avg R {avg[best]:+.3f}, Sharpe {sh[best]:.2f} (neighbourhood {plateau[best]:.2f})",
             f"best single cell {sh.idxmax()}: Sharpe {sh.max():.2f}; PBO {pbo:.2f} -> {'adopt plateau choice as forward candidate R-1x' if pbo <= 0.5 else 'no adoption'}",
             "", "Sharpe by target (mean over zone caps and buffers): " + ", ".join(f"{t} {sh[[v for v in sh.index if v[2] == t]].mean():.2f}" for t in TGTS),
             "Sharpe by zone cap: " + ", ".join(f"{c} {sh[[v for v in sh.index if v[0] == c]].mean():.2f}" for c in CAPS),
             "Sharpe by buffer: " + ", ".join(f"{b} {sh[[v for v in sh.index if v[1] == b]].mean():.2f}" for b in BUFS), "",
             tab.head(12).round(3).to_string()]
    t = "\n".join(lines)
    print(t)
    open(os.path.join(HERE, "r1_exits.txt"), "w").write(t + "\n")
    E.log("X-R1", "R-1 exits", "iteration", dict(n=int(n[best]), edge=float(sh[best]), lo=np.nan, hi=np.nan), pbo <= 0.5,
          f"exit grid of 45; plateau choice {best}; PBO {pbo:.2f}; edge column holds the Sharpe")


if __name__ == "__main__":
    main()
