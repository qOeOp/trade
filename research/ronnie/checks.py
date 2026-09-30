import numpy as np, pandas as pd
from ronnie_bt import load, features, signals, backtest, stats
d=load(); f=features(d)
lo,sh=signals(d,f)
curve,tr=backtest(d,lo,sh)
tr['year']=pd.to_datetime(tr.exit_time).dt.year
print("S2b full 2017-2026:", {k:round(v,3) if isinstance(v,float) else v for k,v in stats(curve,tr,'x').items()})
print("\nby side:"); print(tr.groupby('side').agg(n=('R','size'),win=('R',lambda r:(r>0).mean()),avgR=('R','mean'),sumR=('R','sum')).round(3))
print("\nexit reason:"); print(tr.groupby('why').agg(n=('R','size'),avgR=('R','mean')).round(3))
yr=curve.resample('YE').last(); yr=yr/yr.shift(1).fillna(1.0)-1
bh=d.close.resample('YE').last(); bh=bh/bh.shift(1).fillna(d.open.iloc[0])-1
print("\nyearly:"); print(pd.DataFrame({'S2b':yr,'BTC':bh,'trades':tr.groupby('year').size().reindex(yr.index.year).values},index=yr.index.year).round(3))
# random-entry control: same side mix, same count per year, same exit rules
rng=np.random.default_rng(7); res=[]
real_sum=tr.R.sum()
for k in range(300):
    rl=pd.Series(False,index=d.index); rs=rl.copy()
    for y,g in tr.groupby('year'):
        bars=d.index[(d.index.year==y)]
        pick=rng.choice(len(bars),size=len(g),replace=False)
        sides=rng.permutation(g.side.values)
        for p,s in zip(pick,sides):
            (rl if s=='L' else rs)[bars[p]]=True
    c,t=backtest(d,rl,rs); res.append((c.iloc[-1]-1, t.R.sum() if len(t) else 0))
res=np.array(res)
print(f"\nrandom-entry control (300 runs): median total {np.median(res[:,0]):.3f}, 95th pct {np.percentile(res[:,0],95):.3f}; real total {curve.iloc[-1]-1:.3f}")
print(f"share of random runs >= real: {(res[:,0]>=curve.iloc[-1]-1).mean():.3f}")
