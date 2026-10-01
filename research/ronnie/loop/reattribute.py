"""Recompute the tercile attribution of every loop after the feature-key fix (workflow note 17).

Signals are regenerated per coin with the coin-keyed features and merged onto each loop's saved iteration trades;
gates and decompositions are unaffected by the bug. Writes loop/reattribution.txt.
"""
import os, sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_a as FA  # noqa: E402
import family_b as FB  # noqa: E402
import family_c as FC  # noqa: E402

FAMILIES = [(FA.LOOPS.copy(), FA.make), (FB.LOOPS, FB.make), (FC.LOOPS, FC.make)]


def main():
    out = ["Tercile attribution recomputed with coin-keyed features (edge = R - control, iteration tier)", ""]
    for loops, make in FAMILIES:
        for loop, cfg in loops.items():
            path = os.path.join(HERE, "out", f"{loop}_iteration.csv.gz")
            if not os.path.exists(path):
                continue
            z = pd.read_csv(path, parse_dates=["time"])[["coin", "time", "side", "R", "control", "stop_atr", "target_R"]]
            fn, feats = make(cfg)
            coins = E.ITER_COINS + (E.ITER_EXT_COINS if cfg.get("iter_set") == "iterx" else ())
            for coin in coins:
                if coin in set(z.coin):
                    b = E.bars(coin)
                    E.CURRENT["coin"] = coin
                    fn(b["1d"], b["4h"])
            f = pd.DataFrame([feats.get((k, t, s), {}) for k, t, s in zip(z.coin, z.time, z.side)])
            z = pd.concat([z, f], axis=1)
            out.append(f"{loop} (n {len(z)}, features matched {f.notna().all(axis=1).mean():.0%}):")
            out.append(FA.attribute(z))
            out.append("")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "reattribution.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
