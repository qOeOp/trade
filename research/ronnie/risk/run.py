"""TrialFamily risk-v1: position rules for the crypto book (one per coin, risk caps, confidence size, drawdown brake,
volatility target). See risk/INTENT.md. Writes risk/result.txt and risk/fig_risk.png.
"""
import os, sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "combo"), os.path.join(ROOT, "combo", "candidates")):
    sys.path.insert(0, p)
import harness as H  # noqa: E402
import line_break_ridge as C3  # noqa: E402
import portfolio as P  # noqa: E402
import trendline_break_strong as C2  # noqa: E402
from evaluate import COINS, holdout_bars  # noqa: E402

RISK = 0.005
PRIORITY = {"B1": 0, "trendline": 1, "ridge": 2}
PERIODS = {"design 2018-2022": ("2018-01-01", "2023-01-01"), "check 2023-2026": ("2023-01-01", "2026-10-01")}
VARIANTS = ("V0", "V1", "V2", "V3", "V4", "V5", "V6")
COLORS = {"V0": "#8a8984", "V1": "#2a78d6", "V2": "#1baf7a", "V3": "#eb6834", "V4": "#7a4fd1", "V5": "#c9a227", "V6": "#0b0b0b"}


def build():
    coins = {"BTCUSD": H.load("BTCUSD"), "ETHUSDT": H.load("ETHUSDT")}
    coins.update({c: holdout_bars(c) for c in COINS})
    rows, closes = [], {}
    for name, bars in coins.items():
        d4, d1 = bars["4h"], bars["1d"]
        closes[name] = pd.Series(d4.close.values, index=d4.index + pd.Timedelta(hours=4))
        sma = d1.close.rolling(200).mean()
        known = pd.Series(np.sign(d1.close - sma).values, index=d1.index + pd.Timedelta(days=1))  # closed daily bars
        for strat, fn in (("B1", P.b1_signals), ("trendline", C2.signals), ("ridge", C3.signals)):
            for s in fn(bars):
                if s.time < P.START:
                    continue
                p = P.trade_path(d4, s)
                if p:
                    k = known.index.searchsorted(s.time, side="right") - 1
                    trend = known.iloc[k] * s.side if k >= 0 and not np.isnan(known.iloc[k]) else 0.0
                    rows.append(dict(coin=name, strat=strat, side=s.side, stop=s.stop, t_in=p[0], t_out=p[1],
                                     px_in=p[2], px_out=p[3], trend=trend))
        print(f"{name}: {sum(r['coin'] == name for r in rows)} trades", flush=True)
    tr = pd.DataFrame(rows)
    dist = (tr.px_in - tr.stop).abs()
    tr["R"] = tr.side * (tr.px_out - tr.px_in) / dist - P.FEE * (tr.px_in + tr.px_out) / dist
    tr["agree"] = tr.groupby(["coin", "side", "t_in"]).strat.transform("nunique")
    grid = pd.date_range(P.START, tr.t_out.max(), freq="4h")
    cl = pd.DataFrame({k: v[~v.index.duplicated()].reindex(grid, method="ffill") for k, v in closes.items()})
    return tr, cl


def merged(tr):
    """V1 trade list: one trade per coin, side and entry bar, the highest-priority strategy's."""
    t = tr.assign(pr=tr.strat.map(PRIORITY)).sort_values(["coin", "side", "t_in", "pr"])
    return t.drop_duplicates(["coin", "side", "t_in"]).drop(columns="pr")


def simulate(trades, closes, per_coin, risk_cap=None, side_cap=None, confidence=False, brake=False, vol_target=False):
    grid = closes.index
    cash, peak = 1.0, 1.0
    open_pos, curve, daily = [], np.empty(len(grid)), []
    ins = {t: g for t, g in trades.sort_values("t_in").groupby("t_in")}
    for k, t in enumerate(grid):
        still = []
        for p in open_pos:
            if p["t_out"] <= t:
                cash += p["side"] * (p["px_out"] - p["px_in"]) * p["qty"] - p["px_out"] * p["qty"] * P.FEE
            else:
                still.append(p)
        open_pos = still
        if k % 2 == 0:
            cash -= sum(p["qty"] * closes.at[t, p["coin"]] for p in open_pos) * P.FUND_8H
        mtm = cash + sum(p["side"] * (closes.at[t, p["coin"]] - p["px_in"]) * p["qty"] for p in open_pos)
        peak = max(peak, mtm)
        if k % 6 == 0:
            daily.append(mtm)
        for _, r in ins.get(t, pd.DataFrame()).iterrows():
            if len(open_pos) >= P.MAX_POS:
                continue
            if any(p["coin"] == r.coin and (per_coin or p["strat"] == r.strat) for p in open_pos):
                continue
            if side_cap and sum(p["side"] == r.side for p in open_pos) >= side_cap:
                continue
            m = 1.0
            if confidence:
                m *= (1.0 if r.trend > 0 else 0.5) * (1.5 if r.agree >= 2 else 1.0)
            if brake:
                dd = mtm / peak - 1
                m *= 0.25 if dd < -0.30 else 0.5 if dd < -0.15 else 1.0
            if vol_target and len(daily) > 31:
                v = np.std(np.diff(np.log(daily[-31:])))
                m *= float(np.clip(0.015 / v, 0.25, 1.0)) if v > 0 else 1.0
            rf = RISK * m
            if risk_cap and sum(p["rf"] for p in open_pos) + rf > risk_cap:
                continue
            qty = rf * mtm / abs(r.px_in - r.stop)
            notional = sum(p["qty"] * closes.at[t, p["coin"]] for p in open_pos)
            if notional + qty * r.px_in > P.MAX_LEV * mtm:
                continue
            cash -= qty * r.px_in * P.FEE
            open_pos.append(dict(coin=r.coin, strat=r.strat, side=r.side, qty=qty, px_in=r.px_in, px_out=r.px_out,
                                 t_out=r.t_out, rf=rf))
        curve[k] = cash + sum(p["side"] * (closes.at[t, p["coin"]] - p["px_in"]) * p["qty"] for p in open_pos)
    return pd.Series(curve, index=grid)


def metrics(curve, a, b):
    d = curve[a:b].resample("1D").last().dropna()
    d = d / d.iloc[0]
    r = d.pct_change().dropna()
    yrs = (d.index[-1] - d.index[0]).days / 365.25
    cagr = d.iloc[-1] ** (1 / yrs) - 1
    dd = (d / d.cummax() - 1).min()
    sd = r.std() * np.sqrt(365)
    scaled = (1 + r * (0.30 / sd)).cumprod() if sd > 0 else d
    return dict(CAGR=cagr, maxDD=dd, Sharpe=r.mean() / r.std() * np.sqrt(365) if r.std() > 0 else np.nan,
                Calmar=cagr / -dd if dd < 0 else np.nan, DD30=(scaled / scaled.cummax() - 1).min())


def main():
    tr, cl = build()
    out = ["risk-v1 (INTENT.md): position rules on the crypto book (17 coins, B1 + trendline + ridge)", ""]
    out.append("Confidence inputs, trade-level average R (all strategies, net of fees):")
    for per, (a, b) in PERIODS.items():
        z = tr[(tr.t_in >= a) & (tr.t_in < b)]
        wt, at = z[z.trend > 0].R, z[z.trend <= 0].R
        ag = z.groupby(np.minimum(z.agree, 2)).R.agg(["mean", "count"])
        out.append(f"  {per}: with daily trend {wt.mean():+.3f} (n {len(wt)}), against {at.mean():+.3f} (n {len(at)}); "
                   f"one strategy {ag.loc[1, 'mean']:+.3f} (n {int(ag.loc[1, 'count'])}), two or three "
                   f"{ag.loc[2, 'mean']:+.3f} (n {int(ag.loc[2, 'count'])})")
    out.append("")
    m1 = merged(tr)
    cfg = {"V0": (tr, dict(per_coin=False)), "V1": (m1, dict(per_coin=True)),
           "V2": (m1, dict(per_coin=True, risk_cap=0.03, side_cap=4)), "V3": (m1, dict(per_coin=True, confidence=True)),
           "V4": (m1, dict(per_coin=True, brake=True)), "V5": (m1, dict(per_coin=True, vol_target=True)),
           "V6": (m1, dict(per_coin=True, confidence=True, brake=True))}
    curves, res = {}, {}
    for v in VARIANTS:
        trades, kw = cfg[v]
        curves[v] = simulate(trades, cl, **kw)
        for per, (a, b) in PERIODS.items():
            res[(v, per)] = metrics(curves[v], a, b)
        print(f"{v} done", flush=True)
    for per in PERIODS:
        out.append(f"{per}:   CAGR     maxDD   Sharpe  Calmar  maxDD at 30% vol")
        for v in VARIANTS:
            m = res[(v, per)]
            out.append(f"  {v}   {m['CAGR']:+7.1%}  {m['maxDD']:7.1%}  {m['Sharpe']:6.2f}  {m['Calmar']:6.2f}  {m['DD30']:7.1%}")
        out.append("")
    wins = [v for v in VARIANTS[1:] if all(res[(v, p)]["Sharpe"] > res[("V0", p)]["Sharpe"] and
                                           res[(v, p)]["Calmar"] > res[("V0", p)]["Calmar"] for p in PERIODS)]
    out.append("Decision (beat V0 on Sharpe and Calmar in both periods): " +
               (f"{', '.join(wins)} qualify; adopt the simplest, {wins[0]}" if wins else "none qualifies; keep V0"))
    fig, ax = plt.subplots(figsize=(11, 5.5), facecolor="#fcfcfb")
    ax.set_facecolor("#fcfcfb")
    for v, c in curves.items():
        d = c.resample("1D").last()
        ax.plot(d.index, d.values, color=COLORS[v], lw=2 if v in ("V0", "V6") else 1.3, label=v)
        ax.annotate(v, (d.index[-1], d.values[-1]), xytext=(4, 0), textcoords="offset points", fontsize=9, va="center")
    ax.axvline(pd.Timestamp("2023-01-01", tz="UTC"), color="#8a8984", lw=1, ls=(0, (3, 3)))
    ax.set_yscale("log")
    ax.set_ylabel("equity (start 1.0, log scale)", color="#52514e")
    ax.grid(color="#e6e5e0", lw=0.8)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.legend(frameon=False, fontsize=9, loc="upper left", ncol=2)
    ax.set_title("Position rules on the crypto book; dashed line splits design (left) and check (right)", loc="left", fontsize=11)
    fig.tight_layout()
    fig.savefig(os.path.join(HERE, "fig_risk.png"), dpi=110)
    text = "\n".join(out)
    print(text)
    open(os.path.join(HERE, "result.txt"), "w").write(text + "\n")


if __name__ == "__main__":
    main()
