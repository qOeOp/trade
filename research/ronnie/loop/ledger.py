"""Cross-loop factor ledger (workflow note 26). For every loop's saved iteration trades, recompute the common features
(engine.common_features) and the family features, run attrib.evaluate, and write one row per (loop, feature) to
loop/ledger.csv. Then summarise per (family, feature): loops tested, loops flagged reliable, sign consistency, and
whether the factor is admissible under protocol amendment 3. Writes loop/ledger.csv and loop/ledger.txt.
"""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402
import family_b as FB  # noqa: E402
import family_c as FC  # noqa: E402

FAMILIES = {"A": (dict(FA.LOOPS), FA.make), "B": (dict(FB.LOOPS), FB.make), "C": (dict(FC.LOOPS), FC.make)}
FAM_FEATS = ("trend_atr", "touches", "age", "depth", "n_levels")


def loop_trades(loop, cfg, make):
    path = os.path.join(HERE, "out", f"{loop}_iteration.csv.gz")
    if not os.path.exists(path):
        return None
    z = pd.read_csv(path, parse_dates=["time"])
    z = z[[c for c in ("coin", "time", "side", "R", "control", "stop_atr", "target_R", "set") if c in z]]
    parts = [E.common_features(coin, cfg["tf"], g.drop(columns=[c for c in E.COMMON_FEATURES if c in g and c not in
                                                                 ("stop_atr", "target_R")]))
             for coin, g in z.groupby("coin")]
    z = pd.concat(parts).reset_index(drop=True)
    fn, feats = make(cfg)
    for coin in z.coin.unique():
        b = E.bars(coin)
        E.CURRENT["coin"] = coin
        fn(b["1d"], b["4h"])
    f = pd.DataFrame([feats.get((k, t, s), {}) for k, t, s in zip(z.coin, z.time, z.side)])
    f = f[[c for c in FAM_FEATS if c in f]]
    return pd.concat([z, f], axis=1)


def main():
    rows = []
    for fam, (loops, make) in FAMILIES.items():
        for loop, cfg in loops.items():
            z = loop_trades(loop, cfg, make)
            if z is None:
                continue
            feats = [c for c in list(E.COMMON_FEATURES) + list(FAM_FEATS) if c in z]
            ev = attrib.evaluate(z, feats)
            rows.append(ev.assign(family=fam, loop=loop, trades=len(z)))
            print(f"{loop}: {len(z)} trades, {int(ev.reliable.sum())} flagged", flush=True)
    L = pd.concat(rows)
    L.to_csv(os.path.join(HERE, "ledger.csv"), index=False, float_format="%.4g")
    out = ["Cross-loop factor ledger (protocol amendment 3). admissible = flagged in >= 2 loops of the family, one sign",
           "wherever flagged, no opposite-sign flag", ""]
    for fam, g in L.groupby("family"):
        out.append(f"Family {fam}:")
        for f, h in g.groupby("feature"):
            fl = h[h.reliable]
            signs = np.sign(fl.ic)
            adm = len(fl) >= 2 and signs.nunique() == 1
            share = np.mean(np.sign(h.ic) == np.sign(h.ic.mean())) if len(h) else np.nan
            out.append(f"  {f:<12} loops {len(h):2d}  flagged {len(fl):2d} {'(' + ', '.join(f'{l}:{i:+.2f}' for l, i in zip(fl.loop, fl.ic)) + ')' if len(fl) else '':<40} "
                       f"mean IC {h.ic.mean():+.3f}, IC sign agrees in {share:.0%} of loops  {'ADMISSIBLE' if adm else ''}")
        out.append("")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "ledger.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
