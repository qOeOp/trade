"""R-1u as an account (exploratory, development 2018-2022): each trade risks a fixed share of equity at entry, at most N
open trades, R per trade from the hourly walk (loop/out/X-2_1h_trades.csv.gz). Idealised: survivor universe, fees
0.06% a side, no slippage or funding. Usage: python loop/r1_portfolio.py"""
import sys, numpy as np, pandas as pd
sys.path.insert(0,'loop')
import engine as E, family_r as FR, r1_lines as L1
x1h=pd.read_csv('loop/out/X-2_1h_trades.csv.gz',parse_dates=['time']).set_index(['coin','time','side'])
rows=[]
for coin in E.ITER_COINS+E.ITER_EXT_COINS:
    d=E.bars(coin)["1d"]; h,l,c=d.high.values,d.low.values,d.close.values
    for t in L1.trades(d):
        k=t["k"]
        if not (L1.T0<=d.index[k]<L1.T1): continue
        ex=min(FR.exit_bar({"h":h,"l":l},k,t["side"],t["stop"],t["tgt"]),len(c)-1)
        key=(coin,d.index[k],t["side"])
        if key not in x1h.index: continue
        r=x1h.loc[key]
        rows.append(dict(coin=coin,entry=d.index[k],exit=d.index[ex],base=float(r["base"]),P1=float(r["P1"])))
z=pd.DataFrame(rows).sort_values("entry").reset_index(drop=True)
def sim(col,f,maxn):
    eq=1.0; curve=[(pd.Timestamp("2018-01-01",tz="UTC"),1.0)]; held={}; taken=0; skipped=0
    ev=[]
    for i,r in z.iterrows():
        ev.append((r.entry,1,i)); ev.append((r.exit,0 if r.exit>r.entry else 2,i))
    for t,typ,i in sorted(ev,key=lambda e:(e[0],e[1])):
        if typ in (0,2):
            if i in held: eq+=held.pop(i)*z.at[i,col]; curve.append((t,eq))
        else:
            if len(held)<maxn: held[i]=f*eq; taken+=1
            else: skipped+=1
    s=pd.Series(dict(curve)); s=s.groupby(level=0).last()
    yrs=5.0; cagr=eq**(1/yrs)-1; dd=(s/s.cummax()-1).min()
    by=s.groupby(s.index.year).last(); prev=1.0; yr={}
    for y,v in by.items(): yr[y]=v/prev-1; prev=v
    return cagr,dd,taken,skipped,yr,eq
print(len(z),"trades,",len(z)/5,"per year")
for col in ("base","P1"):
    for f,maxn in ((0.005,10),(0.01,10),(0.01,20)):
        cagr,dd,n,sk,yr,eq=sim(col,f,maxn)
        print(f"{col:4s} risk {f:.1%}/trade, max {maxn} open: CAGR {cagr:+.0%}, max DD {dd:.0%}, taken {n} skipped {sk}, x{eq:.2f} in 5y | "+", ".join(f"{y} {v:+.0%}" for y,v in yr.items() if y<2023))
