"""Exploratory, development data only (iteration coins, fills 2018-2022): an R-1 order entered late, at the same limit,
when price trades back to it inside the 10-day validity window while the original trade is still open. The late
entry shares the original's stop and target, so its R is the original's R. Raw R, no fees, no random-entry control,
trade bootstrap (not clustered). Not a registered rule. Usage: python loop/r1_retouch.py"""
import os, sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine as E  # noqa: E402
import family_r as FR  # noqa: E402

T0,T1=pd.Timestamp("2018-01-01",tz="UTC"),pd.Timestamp("2023-01-01",tz="UTC")
allR,reR,reR1=[],[],[]
for coin in E.ITER_COINS:
    d=E.bars(coin)["1d"]; S=FR.state(d); o,h,l,c,a,tr=S["o"],S["h"],S["l"],S["c"],S["a"],S["trend"]
    cand=[]
    for i,kind,p in S["events"]:
        if kind not in("break_high","break_low") or i+1>=len(c) or np.isnan(a[i]): continue
        side=1 if kind=="break_high" else -1
        if tr[i]!=side: continue
        lvl,edge=p[1],p[2]; lower=max(edge,lvl-a[i]) if side==1 else min(edge,lvl+a[i]); stop=lower-side*FR.BUF*a[i]
        k,px=FR.fill(S,i+1,side,lvl)
        if k is None or (px-stop)*side<=0: continue
        cand.append((k,i,side,lvl,px,stop))
    busy=-1
    for k,i,side,lvl,px,stop in sorted(cand,key=lambda x:x[0]):  # the first fill takes the slot (as family_r.signals)
        if k<=busy: continue
        tgt=px+side*2*abs(px-stop); ex=FR.exit_bar(S,k,side,stop,tgt); busy=ex
        if not(T0<=d.index[k]<T1): continue
        risk=abs(px-stop); e=min(ex,len(c)-1)
        stopped=(side==1 and l[e]<=stop) or (side==-1 and h[e]>=stop)
        hit=(side==1 and h[e]>=tgt) or (side==-1 and l[e]<=tgt)
        R=-1 if stopped else (2 if hit and e>k else (c[e]-px)*side/risk)
        allR.append(R)
        # a later bar, before the order expires (i+10) and before the exit, trades back through the limit;
        # the late entry shares the stop and target, and an exit on that bar counts against it (stop first)
        for m in range(k+1,min(i+1+FR.VALID,e+1)):
            if (side==1 and l[m]<=lvl) or (side==-1 and h[m]>=lvl):
                reR.append(R)
                mfe=max(((px-l[q]) if side==-1 else (h[q]-px)) for q in range(k,m))/risk
                if mfe>=1.0: reR1.append(R)
                break
allR,reR,reR1=np.array(allR),np.array(reR),np.array(reR1)
print(f"all R-1 trades: n {len(allR)}, avg {allR.mean():+.3f}R, win {np.mean(allR>0):.0%}")
print(f"late re-entry at the same limit (price came back within the 10-day window): n {len(reR)}, avg {reR.mean():+.3f}R, win {np.mean(reR>0):.0%}")
rng=np.random.default_rng(1); bs=[rng.choice(reR,len(reR)).mean() for _ in range(4000)]
print(f"  re-entry avg 95% interval [{np.percentile(bs,2.5):+.3f}, {np.percentile(bs,97.5):+.3f}] (trade bootstrap, not clustered)")
print(f"  of which the trade had first run +1R or more in its favour: n {len(reR1)}, avg {reR1.mean():+.3f}R, win {np.mean(reR1>0):.0%}")
bs=[rng.choice(reR1,len(reR1)).mean() for _ in range(4000)]
print(f"  interval [{np.percentile(bs,2.5):+.3f}, {np.percentile(bs,97.5):+.3f}]")
