"""In-sample robustness grid for tv_mtf: daily and resonance zones x 4h line over zone pivot order, reactions per side and
line pivot order. Pass rule declared before the run: most cells positive and most cells with random-entry share < 0.2."""
import sys; import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd, s6_confirm as S, s6_confluence as s6
from ronnie_plan import load, features
from tv_effect import zone_schedule
from tv_mtf import weekly, overlap, in_sample
d4,d1=load(); F=features(d4,d1); t4=d4.index.as_unit("s").asi8+4*3600
w1=weekly(d1); ct1=d1.index.as_unit("s").asi8+86400; ctw=w1.index.as_unit("s").asi8+7*86400
rows=[]
for kz in (2,3,5):
    for per in (3,6,12):
        prm=(kz,per,0.5,2,"wick")
        D=zone_schedule(d1,ct1,t4,prm); W=zone_schedule(w1,ctw,t4,prm); R=[overlap(a,b) for a,b in zip(D,W)]
        for kl in (3,5):
            for name,sc in (("daily",D),("resonance",R)):
                x=in_sample(S.run_confirm(F,"confluence",k=kl,zone_sched=sc))
                if len(x)<3: rows.append(dict(zones=name,kz=kz,per=per,kline=kl,n=len(x))); continue
                rc=np.asarray(s6.random_control(F,x,runs=100))
                rows.append(dict(zones=name,kz=kz,per=per,kline=kl,n=len(x),avgR=x.R.mean(),win=(x.R>0).mean(),rand_share=np.mean(rc>=x.R.mean())))
df=pd.DataFrame(rows); df.to_csv(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results', 'tv_mtf_grid.csv'),index=False)
pd.set_option('display.width',200)
print(df.round(3).to_string(index=False))
for z,g in df.groupby('zones'):
    g=g.dropna(subset=['avgR']); print(z,'cells',len(g),'positive',int((g.avgR>0).sum()),'rand_share<0.2',int((g.rand_share<0.2).sum()),'median avgR',round(g.avgR.median(),3),'median n',int(g.n.median()))
