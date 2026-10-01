"""Hypotheses from the visual review of F-2's 6 worst and 6 best trades, quantified on all iteration-tier trades.
H-a compression before the break: pre-entry 40-bar range in ATR (low = flat) and wickiness (mean wick/range).
H-b stop inside the noise: stop distance over the median 4h range of the 20 bars before entry.
H-c BTC moving with the trade: BTC's return over the 6 bars before entry, signed by the trade's side, in BTC ATRs.
Each is reported with attrib.evaluate (IC, ICIR, buckets) and a beta check on random entries. Writes
loop/visual_hypotheses_f2.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402


def features(coin, z, tf="4h"):
    d = E.bars(coin)[tf]
    o, h, l, c = (d[k].values for k in ("open", "high", "low", "close"))
    a = E.MT.atr_of(h, l, c)
    rg = h - l
    wick = rg - np.abs(c - o)
    b = E.bars("BTC")[tf]
    bc = b.close.reindex(d.index).ffill().values
    ba = E.MT.atr_of(b.high.reindex(d.index).ffill().values, b.low.reindex(d.index).ffill().values, bc)
    e = d.index.get_indexer(pd.to_datetime(z.time))
    out = []
    for k, side, sa in zip(e, z.side.values, z.stop_atr.values):
        i = k - 1
        w = slice(i - 40, i)
        out.append(dict(range40=(h[w].max() - l[w].min()) / a[i], wickiness=np.nanmean(wick[w] / np.where(rg[w] > 0, rg[w], np.nan)),
                        stop_vs_noise=sa * a[i] / np.median(rg[i - 20:i]), btc6=side * (bc[i] - bc[i - 6]) / ba[i]))
    return z.assign(**pd.DataFrame(out, index=z.index))


def main():
    z = pd.read_csv(os.path.join(HERE, "out", "F-2_iteration.csv.gz"), parse_dates=["time"])
    z = pd.concat([features(c, g) for c, g in z.groupby("coin")])
    feats = ["range40", "wickiness", "stop_vs_noise", "btc6"]
    text, ev = attrib.report(z, feats, "F-2: hypotheses from the visual review, on all iteration-tier trades")
    out = [text]
    for f in ("range40", "wickiness", "btc6"):
        out.append(attrib.beta_check(z, f, E.ITER_COINS, "4h", hold=30, stop_atr=1.5, target_r=1000.0, step=6, feat_fn=features))
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "visual_hypotheses_f2.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
