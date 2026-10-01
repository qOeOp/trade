"""Gatekeeper of the R&D loop (protocol amendment 5): the only code that scores the validation and final tiers.

The iterating agent never reads validation or final details. A fresh-context evaluator runs this script and relays
only its stdout, which is a verdict:
- validation tier, by Thresholdout (Dwork et al., 2015, "The reusable holdout", Science): if the validation edge is
  within THRESHOLD + noise of the iteration edge, the iteration edge is returned; otherwise the validation edge plus
  Laplace noise. Each answer that goes over the threshold spends one unit of a fixed budget; when the budget is spent
  the tier is closed.
- final tier: PASS or FAIL only, at the deflated level, once per candidate.
Full details (per coin, per year, buckets, IC decay) are written to loop/sealed/<loop>_<stage>.json for audit, a store
the iterating agent does not read.

Usage: python loop/gatekeeper.py <family module> <loop id> validate|final|reserve (reserve: PASS/FAIL like final)
"""
import importlib, json, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine as E  # noqa: E402

THRESHOLD, SIGMA, BUDGET = 0.10, 0.03, 10
STATE = os.path.join(HERE, "sealed", "thresholdout_state.json")


def main():
    mod, loop, stage = sys.argv[1], sys.argv[2], sys.argv[3]
    fam = importlib.import_module(mod)
    cfg = fam.LOOPS[loop]
    fn, _ = fam.make(cfg)
    tier = {"validate": "val", "final": "final", "reserve": "reserve"}[stage]
    z = E.run(loop, fn, cfg["tf"], cfg["hold"], (tier,), ts=cfg.get("ts"))
    it = pd.read_csv(os.path.join(HERE, "out", f"{loop}_iteration.csv.gz"))
    it_edge = float((it.R - it.control).mean())
    rng = np.random.default_rng()
    sealed = dict(loop=loop, stage=stage, n=len(z))
    if len(z):
        sealed.update(edge=float((z.R - z.control).mean()),
                      per_year={str(k): float(v) for k, v in (z.R - z.control).groupby(pd.to_datetime(z.time).dt.year).mean().items()},
                      per_coin={k: float(v) for k, v in (z.R - z.control).groupby(z.coin).mean().items()})
    if stage == "validate":
        st = json.load(open(STATE)) if os.path.exists(STATE) else {"spent": 0}
        if st["spent"] >= BUDGET:
            print(f"{loop} validation: CLOSED (Thresholdout budget of {BUDGET} spent)")
            return
        level, k = E.validation_level()
        lo, hi = E.boot(z, level) if len(z) else (np.nan, np.nan)
        v_edge = sealed.get("edge", np.nan)
        if abs(v_edge - it_edge) > THRESHOLD + rng.laplace(0, SIGMA):
            st["spent"] += 1
            answer = v_edge + rng.laplace(0, SIGMA)
            src = "holdout (over threshold, budget spent 1)"
        else:
            answer, src = it_edge, "iteration (within threshold)"
        passed = bool(lo > 0)
        json.dump(st, open(STATE, "w"))
        E.log(loop, mod, "validation", dict(n=len(z), edge=answer, lo=np.nan, hi=np.nan), passed, f"thresholdout {src}")
        print(f"{loop} validation: {'PASS' if passed else 'FAIL'} at {level:.2f}% (k={k}); thresholdout edge {answer:+.2f} [{src}]; "
              f"budget left {BUDGET - st['spent']}")
        sealed.update(level=level, lo=float(lo), hi=float(hi), passed=passed)
    else:
        k = int(os.environ.get("FINAL_K", 1))
        level = 100 - 5 / k
        lo, hi = E.boot(z, level) if len(z) >= 5 else (np.nan, np.nan)
        passed = bool(lo > 0)
        E.log(loop, mod, "final", dict(n=len(z), edge=np.nan, lo=np.nan, hi=np.nan), passed, f"sealed; level {level:.2f}")
        print(f"{loop} final: {'PASS' if passed else 'FAIL'} at {level:.2f}% (k={k})")
        sealed.update(level=level, lo=float(lo), hi=float(hi), passed=passed)
    json.dump(sealed, open(os.path.join(HERE, "sealed", f"{loop}_{stage}.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
