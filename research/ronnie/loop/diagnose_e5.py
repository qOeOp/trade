"""Amendment-4 diagnosis of E-5 (confirmed long fades), extended iteration tier; ablations logged as 'ablation'.
(a) target the box middle; (b) time-only exit; (c) skip persistent approaches (efficiency ratio of the 20 bars into the
edge at least 0.5). Writes loop/diagnose_e5.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402
import family_e as FE  # noqa: E402


def variant(mode):
    base_fn, _ = FE.make(FE.LOOPS["E-5"])

    def fn(d1, d4):
        d = d4[["open", "high", "low", "close"]]
        c = d.close.values
        top, bot, _ = FE.R2.boxes(d)
        out = []
        for e, side, entry, stop, tgt in base_fn(d1, d4):
            i = e - 1
            if mode == "mid":
                tgt = (top[i] + bot[i]) / 2 if not np.isnan(top[i]) else tgt
                if (tgt - entry) * side <= 0:
                    continue
            elif mode == "time":
                tgt = entry + side * 1000 * abs(entry - stop)
            elif mode == "er":
                net = c[i] - c[i - 20]
                path = np.abs(np.diff(c[i - 20:i + 1])).sum()
                if path > 0 and abs(net) / path >= 0.5:
                    continue
            out.append((e, side, entry, stop, tgt))
        return out
    return fn


def main():
    out = ["Diagnosis of E-5 (confirmed long fades, extended iteration tier): ablations", ""]
    for name, mode in (("target the box middle", "mid"), ("time-only exit", "time"), ("skip persistent approaches (ER >= 0.5)", "er")):
        z = E.run(f"E-5 ablation: {name}", variant(mode), "4h", 30, ("iterx",))
        passed, st = E.iteration_gate(z)
        E.log("E-5", f"ablation: {name}", "ablation", st, passed)
        out.append(f"  {name:<42} {E.fmt(st)}; edge in ATR {((z.R - z.control) * z.stop_atr).mean():+.3f}")
    t = "\n".join(out)
    print(t)
    open(os.path.join(HERE, "diagnose_e5.txt"), "w").write(t + "\n")


if __name__ == "__main__":
    main()
