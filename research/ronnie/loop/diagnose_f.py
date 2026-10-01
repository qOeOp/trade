"""Amendment-4 diagnosis of loop F-1 (4h trend-line breaks), iteration tier only; no rule change.
H1 beta: BTC's trend carries the edge (beta check: random entries show the same bucket pattern).
H2 exit: winners are cut or stopped trades first reach +1R (decomposition; ablation of the target).
H3 line quality: edge by the line's span and slope (in ATR per bar).
Ablations: no strong-candle condition; time-only exit; stop at the line instead of the bar's extreme.
Writes loop/diagnose_f.txt."""
import os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attrib  # noqa: E402
import engine as E  # noqa: E402
import family_f as FF  # noqa: E402

TL = FF.TL


def main():
    z = pd.read_csv(os.path.join(HERE, "out", "F-1_iteration.csv.gz"), parse_dates=["time"])
    z["edge"] = z.R - z.control
    out = ["Diagnosis of F-1 (4h trend-line breaks, iteration tier, %d trades)" % len(z), ""]
    for sd in (1, -1):
        k = z[z.side == sd]
        out.append(f"side {sd:+d}: n {len(k)}, avg R {k.R.mean():+.3f}, edge {k.edge.mean():+.3f}")
    out.append(attrib.beta_check(z, "btc_trend", E.ITER_COINS, "4h", hold=30, stop_atr=1.5, target_r=2.0, step=6))
    out.append("")
    out.append("ablation (iteration tier):")
    variants = {"no strong-candle condition": dict(BODY_ATR=0.0, CLOSE_POS=0.0),
                "time-only exit (no 2R target)": dict(RR=1000.0)}
    saved = {k: getattr(TL, k) for k in ("BODY_ATR", "CLOSE_POS", "RR")}
    for name, patch in variants.items():
        for k, v in patch.items():
            setattr(TL, k, v)
        fn, _ = FF.make(FF.LOOPS["F-1"])
        za = E.run(f"F-1 ablation: {name}", fn, "4h", 30, ("iter",))
        for k, v in saved.items():
            setattr(TL, k, v)
        passed, st = E.iteration_gate(za)
        E.log("F-1", f"ablation: {name}", "ablation", st, passed)
        out.append(f"  {name:<34} {E.fmt(st)}")
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "diagnose_f.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
