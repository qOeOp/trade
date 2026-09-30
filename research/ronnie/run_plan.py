import time, numpy as np, pandas as pd
from ronnie_plan import load, features, simulate, curve_stats, trade_stats, IS, OOS, SETUPS
d4,d1=load(); F=features(d4,d1)
t0=time.time(); curve,tr=simulate(F); print(f"sim {time.time()-t0:.1f}s, trades {len(tr)}")
tr.to_csv('plan_trades.csv',index=False); curve.to_csv('plan_curve.csv')
rows=[]
for nm,(a,b) in (("IS 2017-22",IS),("OOS 2023-26",OOS)):
    seg=d4[(d4.index>=a)&(d4.index<b)]; bh=seg.close/seg.open.iloc[0]; yrs=(seg.index[-1]-seg.index[0]).days/365.25
    rows.append(dict(period=nm,what="BTC buy&hold",total=bh.iloc[-1]-1,CAGR=bh.iloc[-1]**(1/yrs)-1,maxDD=(bh/bh.cummax()-1).min()))
    rows.append(dict(period=nm,what="PLAN portfolio",**curve_stats(curve,a,b),**trade_stats(tr,a,b)))
    for s in SETUPS: rows.append(dict(period=nm,what=s,**trade_stats(tr[tr.setup==s],a,b)))
pd.set_option('display.width',220)
print(pd.DataFrame(rows).set_index(['period','what']).to_string(float_format=lambda x:f"{x:,.3f}"))
print("\nby setup & side (full):"); print(tr.groupby(['setup','side']).agg(n=('R','size'),win=('R',lambda r:(r>0).mean()),avgR=('R','mean')).round(3))
print("\nexit reasons:"); print(tr.groupby(['setup','why']).size().unstack(fill_value=0))
