"""Confirmation variant: a 4h bar touches the level and closes back on the right side; enter at the next open."""
import math, numpy as np, pandas as pd
from ronnie_plan import build_zones, load, features, P as PLAN
import s6_confluence as s6
C = s6.C

def run_confirm(F, mode="confluence", k=3, zone_rng=None, zone_sched=None):
    """zone_sched: optional per-bar zone lists known at each bar's close (e.g. daily/weekly zones); replaces the 4h map."""
    o,h,l,c,atr,t = (F[x] for x in ("o","h","l","c","atr","t"))
    n=len(c); highs,lows,hp,lp=[],[],[],[]; zones=[]; trades=[]; pos=None; last_exit=-10**9; order=None
    def line_val(pts, side, i):
        if len(pts)<2: return None
        p1,p2=pts[-2],pts[-1]
        if p2[0]-p1[0]<C["min_gap"] or i-p2[0]>C["max_age"]: return None
        if side==1 and not p2[1]>p1[1]: return None
        if side==-1 and not p2[1]<p1[1]: return None
        idx=np.arange(p2[0],i+1); vals=p2[1]+(p2[1]-p1[1])*(idx-p2[0])/(p2[0]-p1[0])
        # the line may be pierced by the signal bar's wick, but no earlier close may break it
        if side==1 and (c[p2[0]:i]<vals[:-1]).any(): return None
        if side==-1 and (c[p2[0]:i]>vals[:-1]).any(): return None
        return vals[-1]
    for i in range(n):
        if pos is None and order is not None:
            side,stop,tgt_rule=order
            e=o[i]*(1+side*C["slip"]); risk=(e-stop)*side
            if risk>0:
                tgt=tgt_rule(e,risk)
                if tgt is not None:
                    pos=dict(side=side,fill=e,stop=stop,tgt=tgt,i0=i,fees=e*C["taker"],fund=0.0)
        order=None
        if pos is not None:
            s=pos["side"]; pos["fund"]+=s*c[i]*C["funding_8h"]*F.get("bar_h",4)/8; px=None
            if (s==1 and l[i]<=pos["stop"]) or (s==-1 and h[i]>=pos["stop"]):
                px=(min(o[i],pos["stop"]) if s==1 else max(o[i],pos["stop"]))*(1-s*C["slip"]); why="stop"; fee=C["taker"]
            elif (s==1 and h[i]>pos["tgt"]) or (s==-1 and l[i]<pos["tgt"]):
                px=max(o[i],pos["tgt"]) if s==1 else min(o[i],pos["tgt"]); why="target"; fee=C["maker"]
            elif i-pos["i0"]>=C["max_hold"]:
                px=c[i]*(1-s*C["slip"]); why="time"; fee=C["taker"]
            if px is not None:
                risk=abs(pos["fill"]-pos["stop"]); net=s*(px-pos["fill"])-pos["fees"]-px*fee-pos["fund"]
                trades.append(dict(entry_time=t[pos["i0"]],side=s,R=net/risk,why=why,bars=i-pos["i0"],stop_atr=risk/atr[pos["i0"]],target_R=abs(pos["tgt"]-pos["fill"])/risk))
                pos=None; last_exit=i
        if pos is not None or i<600 or i+1>=n or i-last_exit<C["cooldown"]:
            # still update pivots below
            pass
        # zones as known at the previous close (the signal bar must not build its own level)
        zones_prev=zones
        if i>=2*k:
            j=i-k
            if h[j]==h[j-k:j+k+1].max():
                highs.append((h[j],max(o[j],c[j]))); highs[:]=highs[-PLAN["reactions_per_side"]:]; hp.append((j,h[j])); hp[:]=hp[-4:]
                zones=build_zones(highs,lows,atr[i],zone_rng)
            if l[j]==l[j-k:j+k+1].min():
                lows.append((l[j],min(o[j],c[j]))); lows[:]=lows[-PLAN["reactions_per_side"]:]; lp.append((j,l[j])); lp[:]=lp[-4:]
                zones=build_zones(highs,lows,atr[i],zone_rng)
        if zone_sched is not None:
            zones_prev=zone_sched[i-1] if i>0 else []
        if pos is not None or i<600 or i+1>=n or i-last_exit<C["cooldown"]: continue
        a=atr[i]; pad=C["zone_pad_atr"]*a
        for side in (1,-1):
            if side==1:
                cands=[z for z in zones_prev if z.hi < c[i-1]]
                zone=max(cands,key=lambda z:z.hi) if cands else None
                tl=line_val(lp,1,i)
                if mode=="confluence":
                    if tl is None or zone is None or not (zone.lo-pad<=tl<=zone.hi+pad): continue
                    level=max(tl,zone.hi) ; floor=min(tl,zone.lo)
                elif mode=="zone_only":
                    if zone is None: continue
                    level=zone.hi; floor=zone.lo
                else:
                    if tl is None: continue
                    level=tl; floor=tl
                if not (l[i]<=level and c[i]>level and c[i]>o[i]): continue
                stop=min(l[i],floor)-C["stop_pad_atr"]*a
                res=sorted([z.lo for z in zones_prev if z.lo>c[i]])
                def rule(e,risk,res=res):
                    t_=res[0] if res else e+C["min_rr"]*risk
                    return t_ if t_-e>=C["min_rr"]*risk else None
                order=(1,stop,rule); break
            else:
                cands=[z for z in zones_prev if z.lo > c[i-1]]
                zone=min(cands,key=lambda z:z.lo) if cands else None
                tl=line_val(hp,-1,i)
                if mode=="confluence":
                    if tl is None or zone is None or not (zone.lo-pad<=tl<=zone.hi+pad): continue
                    level=min(tl,zone.lo); ceil=max(tl,zone.hi)
                elif mode=="zone_only":
                    if zone is None: continue
                    level=zone.lo; ceil=zone.hi
                else:
                    if tl is None: continue
                    level=tl; ceil=tl
                if not (h[i]>=level and c[i]<level and c[i]<o[i]): continue
                stop=max(h[i],ceil)+C["stop_pad_atr"]*a
                sup=sorted([z.hi for z in zones_prev if z.hi<c[i]],reverse=True)
                def rule(e,risk,sup=sup):
                    t_=sup[0] if sup else e-C["min_rr"]*risk
                    return t_ if e-t_>=C["min_rr"]*risk else None
                order=(-1,stop,rule); break
    return pd.DataFrame(trades)

if __name__=="__main__":
    d4,d1=load(); F=features(d4,d1)
    IS,OOS=("2017-01-01","2023-01-01"),("2023-01-01","2027-01-01")
    rows={}; out=[]
    for k in (3,5):
        for mode in ("confluence","zone_only","line_only"):
            tr=run_confirm(F,mode,k=k); rows[(k,mode)]=tr
            for pn,(a,b) in (("IS",IS),("OOS",OOS)):
                out.append(dict(k=k,mode=mode,period=pn,**s6.summary(tr,a,b)))
    pd.set_option("display.width",200)
    print(pd.DataFrame(out).set_index(["k","mode","period"]).to_string(float_format=lambda x:f"{x:,.3f}"))
    for k in (3,5):
        real=rows[(k,"confluence")]
        st=real[real.why=='stop']
        print(f"\n== k={k} confirmed confluence: stops within 3 bars {np.mean(st.bars<=3):.2f}; by side:")
        print(real.groupby("side").agg(n=("R","size"),win=("R",lambda r:(r>0).mean()),avgR=("R","mean")).round(3).to_string())
        rc=s6.random_control(F,real)
        print(f"random-entry control avgR median {np.median(rc):.3f} [5-95% {np.percentile(rc,5):.3f},{np.percentile(rc,95):.3f}]; real {real.R.mean():.3f}; share>=real {(rc>=real.R.mean()).mean():.3f}")
        pz=np.array([[s6.summary(x,*IS).get("avgR",np.nan),s6.summary(x,*OOS).get("avgR",np.nan),len(x)] for x in (run_confirm(F,"confluence",k=k,zone_rng=np.random.default_rng(200+s)) for s in range(30))])
        for col,pn,(a,b) in ((0,"IS",IS),(1,"OOS",OOS)):
            r=s6.summary(real,a,b)["avgR"]; v=pz[:,col][~np.isnan(pz[:,col])]
            print(f"placebo zones {pn}: real {r:.3f} | placebo median {np.median(v):.3f} [5-95% {np.percentile(v,5):.3f},{np.percentile(v,95):.3f}] | share>=real {(v>=r).mean():.2f} | placebo n median {int(np.median(pz[:,2]))}")
        real.to_csv(f"s6_confirm_k{k}_trades.csv",index=False)
