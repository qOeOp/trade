import numpy as np, pandas as pd
from ronnie_bt import load, features, signals, backtest
d=load(); f=features(d)
lo,sh=signals(d,f); curve,tr=backtest(d,lo,sh)
real=curve.iloc[-1]-1
yr=curve.resample('YE').last(); yv=(yr/yr.shift(1).fillna(1.0)-1).values
bc=d.close.resample('YE').last(); bv=(bc/bc.shift(1).fillna(d.open.iloc[0])-1).values
tr['year']=pd.to_datetime(tr.exit_time).dt.year
print(pd.DataFrame({'S2b':yv,'BTC':bv,'trades':tr.groupby('year').size().values},index=yr.index.year).round(3).to_string())
# stop distance of real trades in ATR units
ent=pd.to_datetime(tr.entry_time); pos=d.index.get_indexer(ent)
atr=f.atr.values; risk_atr=(np.abs(tr.entry.values-d.low.values[pos-1]*(tr.side=='L')-d.high.values[pos-1]*(tr.side=='S'))/atr[pos-1])
risk_atr=risk_atr[np.isfinite(risk_atr)]
print(f"\nreal stop distance in ATR: median {np.median(risk_atr):.2f}")
rng=np.random.default_rng(7); out=[]
for k in range(300):
    rl=pd.Series(False,index=d.index); rs=rl.copy()
    for y,g in tr.groupby('year'):
        bars=np.where(d.index.year==y)[0]; bars=bars[bars>40]
        pick=rng.choice(bars,size=len(g),replace=False); sides=rng.permutation(g.side.values)
        for p_,s_ in zip(pick,sides): (rl if s_=='L' else rs).iloc[p_]=True
    sd=rng.choice(risk_atr,size=len(d))*np.nan_to_num(atr,nan=np.nanmedian(atr))
    c,t=backtest(d,rl,rs,stop_dist=sd); out.append(c.iloc[-1]-1)
out=np.array(out)
print(f"random-entry control (300 runs, same count/year, same side mix, same stop-distance distribution, same 2R/30-bar exits):")
print(f"  median total {np.median(out):.3f}, 5-95% [{np.percentile(out,5):.3f}, {np.percentile(out,95):.3f}]; real {real:.3f}; share >= real {(out>=real).mean():.3f}")
