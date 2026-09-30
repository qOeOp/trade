import numpy as np, pandas as pd
from ronnie_plan import load, features, simulate, curve_stats, trade_stats, IS, OOS, SETUPS, P
d4,d1=load(); F=features(d4,d1)
def summ(curve,tr,tag):
    out={'variant':tag}
    for nm,(a,b) in (("IS",IS),("OOS",OOS)):
        cs=curve_stats(curve,a,b); out[f'{nm}_CAGR']=cs['CAGR']; out[f'{nm}_Sharpe']=cs['Sharpe']
        for s in SETUPS:
            ts=trade_stats(tr[tr.setup==s] if len(tr) else tr,a,b); out[f'{nm}_{s}_avgR']=ts.get('avgR',np.nan); out[f'{nm}_{s}_n']=ts.get('n',0)
    return out
base=summ(*simulate(F),'plan')
rows=[base, summ(*simulate(F,use_f2=False),'no F2 (direction)'), summ(*simulate(F,use_f1=False),'no F1 (state)'),
      summ(*simulate(F,use_f1=False,use_f2=False),'no F1, no F2')]
for s in SETUPS: rows.append(summ(*simulate(F,only=[s]),f'{s} alone'))
tab=pd.DataFrame(rows).set_index('variant')
pd.set_option('display.width',250)
cols=['IS_CAGR','IS_Sharpe','OOS_CAGR','OOS_Sharpe']+[f'{p}_{s}_avgR' for p in ('IS','OOS') for s in SETUPS]
print(tab[cols].to_string(float_format=lambda x:f"{x:,.3f}"))
print('\ntrade counts IS/OOS:'); print(tab[[f'{p}_{s}_n' for s in SETUPS for p in ('IS','OOS')]].to_string())
# placebo zones
rz=[summ(*simulate(F,zone_rng=np.random.default_rng(s)),'z') for s in range(30)]
rz=pd.DataFrame(rz)
print('\nPLACEBO ZONES (30 runs, zones displaced 2-6 ATR, same width/touches) vs real:')
for key in ['IS_Sharpe','OOS_Sharpe']+[f'{p}_{s}_avgR' for p in ('IS','OOS') for s in ('S1','S3','S4','S5','S2b')]:
    v=rz[key].dropna(); print(f"  {key:14} real {base[key]:7.3f} | placebo median {v.median():7.3f} [5-95% {v.quantile(.05):7.3f},{v.quantile(.95):7.3f}] | share placebo>=real {(v>=base[key]).mean():.2f}")
# placebo fib ratios
rng=np.random.default_rng(11); rf=[]
for k in range(30):
    while True:
        x=np.sort(rng.uniform(0.3,0.8,3))
        if np.diff(x).min()>=0.05 and not np.allclose(x,P['fib_levels'],atol=0.03): break
    rf.append(summ(*simulate(F,fib_levels=tuple(x),only=['S4']),'f'))
rf=pd.DataFrame(rf); b4=summ(*simulate(F,only=['S4']),'S4')
print('\nPLACEBO FIB RATIOS for S4 alone (30 random triplets in 0.3-0.8):')
for key in ['IS_S4_avgR','OOS_S4_avgR','IS_Sharpe','OOS_Sharpe']:
    v=rf[key].dropna(); print(f"  {key:12} real {b4[key]:7.3f} | placebo median {v.median():7.3f} [5-95% {v.quantile(.05):7.3f},{v.quantile(.95):7.3f}] | share placebo>=real {(v>=b4[key]).mean():.2f}")
