Automation: PEPE突破监控
Automation ID: pepe
Automation memory: $CODEX_HOME/automations/pepe/memory.md
Last run: 2026-04-07T10:04:28.970Z (1775556268970)

监控 Binance U 本位合约 1000PEPE/USDT 是否出现值得追随的有效突破。使用 OHLCV Fetch 和 Tech Indicators。先看 1d 和 4h，判断当前属于上升趋势、下跌趋势、大区间震荡还是区间边缘；如果 4h 仍在大区间中部，默认结论优先为“不追”。再看 1h 和 15m，判断是否出现有效向上或向下突破，必须检查是否有收线确认、是否放量、是否连续站在突破方向一侧，以及是否立刻回到区间内。最终只输出“追多 / 追空 / 不追”三选一结论，并给出现价、4h 大级别环境、15m/1h 突破状态、结论原因，以及下一次值得关注的上破价和下破价；若判断可追，再给出触发价、失效位、第一目标、第二目标。时间统一使用 Asia/Shanghai，避免泛泛而谈，必须先给大级别该不该做的判断，再给低周期触发。



已处理 3m 26s
不追

现价：0.0033820（按 2026-04-07 18:15 CST 附近最新 15m 未收线价格看）

4h 大级别环境：大区间震荡中部偏下，不该追。近 120 根 4h 主要区间约 0.0031627 - 0.0036834，现价只在区间约 42% 位置；最近一个已收 4h 收在 0.0033547，成交量只有近 20 根均量的 0.62x，说明大级别没有进入值得追随的边缘突破状态。

15m/1h 突破状态：有短线上破，但还不够成“追”。1h 在 2026-04-07 17:00 CST 这根已收线收上 0.0033713 至 0.0034059，量能约 1.13x 均量；15m 从 17:00 CST 到 18:00 CST 连续多根收在 0.0033713 上方，18:00 CST 这根量能约 2.84x 均量，说明小级别确实完成了对旧箱体上沿的突破确认。但价格冲到 0.0034117 - 0.0034141 后没有继续扩展，已经回落到 0.0033820 一带，本质更像 4h 大区间中部的反弹，而不是顺大级别的有效突破追击点。

结论原因：先看大级别，4h 还在区间中部，所以默认不追；再看低周期，虽然 1h/15m 已上破旧小箱体，但突破发生在大区间中段，且上方第一段冲高后没有继续打开空间，盈亏比不够好。

下一次值得关注的价位：

上破价：0.0034141。只有 15m/1h 再次放量收上并继续站稳，才有资格继续看 0.00354 - 0.00356 的 4h 压力带。
下破价：0.0033713。如果 15m/1h 重新收回这个价位下方，当前这次短线上破基本按失败处理。

1 个文件已更改
撤销
/Users/vx/.codex/automations/pepe/memory.md
我们已经很多轮了一直是不追 你现在这套思考逻辑拿去回测历史一个月数据 能找到几次要追的判断呢



已处理 6m 47s
能找到，但不多。按你现在这套口径，我把 1000PEPE/USDT 近 30 天的 1d/4h/1h/15m 历史滚动回放了一遍，结论是：

近一个月一共能筛出 6 次独立“要追”的判断，且全部是 追空，追多 = 0。

这 6 次分别是：

2026-03-29 06:00 CST 追空
2026-03-29 18:15 CST 追空
2026-03-30 06:45 CST 追空
2026-03-31 03:00 CST 追空
2026-04-02 09:30 CST 追空
2026-04-07 06:30 CST 追空
核心原因很直接：这一个月里，4h 大结构大部分时间都偏弱，所以真正满足“4h 不在中部，且 1h/15m 有放量、收线确认、连续站在突破一侧”的窗口，几乎都只出现在向下突破时。也就是说，这套逻辑不是没信号，而是很偏“顺大级别弱势去追空”，对追多非常苛刻。

我还顺手看了下这些信号后面 12 小时的大致表现，6 次里有几次顺得不错，比如 2026-04-02 09:30 CST 那次，后面 12h 最大顺向扩展大约 2.26%，逆向波动大约 0.64%；但也有几次会被反抽得很难受，比如 2026-03-30 06:45 CST 那次，后面 12h 顺向只有 0.12%，逆向却有 5.27%。所以它说明“这套规则能抓到一些空头追击窗”，但还不能说明“拿来直接做就稳”。

如果你愿意，我下一步可以继续做两件更有价值的事里的一个：

把这 6 次逐条拆开，看看哪些是真该追、哪些其实是假信号。
反过来找“历史上明明值得追，但这套规则没抓到”的漏判样本，看看该放松哪一条。

1 个文件已更改
撤销
/Users/vx/.codex/automations/pepe/memory.md
我当前这个自动化任务只在找追多的机会嘛 没有识别追空嘛 导致的一直说不追


不是，当前这版自动化任务本身是同时识别 追多 / 追空 / 不追 的，不是只找追多。

你这轮之所以总看到 不追，主要是两个原因：

大级别过滤太强。
当前 prompt 明确写了：先看 1d/4h，如果 4h 还在大区间中部，默认优先判 不追。这条规则会先把很多低周期动作压掉，不管它是向上还是向下。

最近这段 PEPE 的结构，不常给“干净追空”。
虽然回放近 30 天能找到 6 次 追空，但你最近几轮实时监控时，价格大多处在 4h 区间中部附近，或者只是小级别先动了一下，还没形成“大级别位置也支持、低周期也确认”的那种追空窗口，所以不会轻易改成 追空。

也就是说，问题不在“它只看追多”，而在“它先问大级别该不该追”，这会让结论非常保守。你现在这套更像“只抓很干净的顺大级别突破”，不是“只要低周期向下破就给追空”。

如果你要，我下一步可以直接帮你把这个自动化改成更符合你的真实意图的两种之一：

保守版：继续三选一，但明显增强对 追空 的识别率。
做多专用版：明确只监控 追多 / 不追，不再讨论追空。

后面找到的6 次 追空 机会 胜率和盈亏比怎么样



已处理 1m 16s
先说结论：这 6 次 追空 机会，方向上不算完全错，但如果真按统一规则去做，胜率和盈亏比都不够好，暂时不能说这套信号有稳定交易价值。

我用的是一个很轻量但统一的评估口径：

入场：信号出现当根 15m 收盘价
简化止损：入场前最近 9 根 15m 的最高点
观察窗口：后续 4h / 8h / 12h
看四个值：持有到窗口末的收益、最大顺向扩展 MFE、最大逆向波动 MAE、以及最多打到几倍 R
结果是：

4h 视角：胜率 66.7%，但平均收益 -0.26%
8h 视角：胜率 50.0%，平均收益 -0.87%
12h 视角：胜率 33.3%，平均收益 -0.60%
盈亏比这边更关键：

12h 内平均最大顺向扩展 1.15%
12h 内平均最大逆向波动 2.07%
6 次里只有 1 次摸到过 1R
0 次摸到过 2R
所以这 6 次更像是：
“有时能抓到短线下破方向，但经常没有足够延续，或者先给一点利润又被反抽，最后很难做成一个舒服的追空单。”

拆开看，最好的一次是 2026-04-02 09:30 CST：

后续 12h 最大顺向扩展大约 2.26%
最大逆向波动大约 0.64%
这次是比较像样的
最差的一次是 2026-03-30 06:45 CST：

后续 12h 顺向只有 0.12%
逆向却有 5.27%
这是典型“看着像下破，结果被狠狠干回去”
所以如果只回答你这句“胜率和盈亏比怎么样”：

胜率：短窗口还行，拉长就明显下降
盈亏比：整体偏差，不够好
结论：这套当前追空筛法能找出一些机会，但还没有筛到“少而精”的程度
如果你愿意，我下一步最有价值的是直接做这两个方向中的一个：

把这 6 次逐条复盘，找出“为什么只有 1 次像样，其余大多一般”。
直接调规则，把那些“会先破一下但没延续”的追空信号过滤掉，再重新回放一遍。

1 个文件已更改
撤销
/Users/vx/.codex/automations/pepe/memory.md
1



我就按你选的方向来，把这 6 次逐条拆开，重点看为什么只有少数像样，大多数只是“看起来破了但不够值得追”。我先把每次信号前后的关键区间、量能和后续路径拉出来，尽量给你可落地的共性。

后台终端已完成以及 python3 - <<'PY' import csv from datetime import datetime, timedelta, timezone from statistics import mean from pathlib import Path base=Path('/tmp/pepe-backtest') CST=timezone(timedelta(hours=8)) def load(tf): out=[] with open(base/f'{tf}.csv') as f: for row in csv.DictReader(f): out.append({ 'ts': datetime.fromisoformat(row['date'].replace('Z','+00:00')), 'open': float(row['open']), 'high': float(row['high']), 'low': float(row['low']), 'close': float(row['close']), 'volume': float(row['volume']), }) return out bars={tf:load(tf) for tf in ['1d','4h','1h','15m']} start = bars['15m'][-1]['ts'] - timedelta(days=30) def last_closed(tf, t): arr=bars[tf] lo, hi = 0, len(arr)-1 ans = None while lo <= hi: mid=(lo+hi)//2 if arr[mid]['ts'] <= t: ans=mid lo=mid+1 else: hi=mid-1 return ans signals=[] for i, bar in enumerate(bars['15m']): t=bar['ts'] if t < start: continue i15=i; i1h=last_closed('1h', t); i4h=last_closed('4h', t); i1d=last_closed('1d', t) if None in [i1h,i4h,i1d] or i15 < 40 or i1h < 25 or i4h < 130 or i1d < 30: continue h4=bars['4h']; d1=bars['1d']; m15=bars['15m']; h1=bars['1h'] prev120=h4[i4h-120:i4h] rng_low=min(x['low'] for x in prev120); rng_high=max(x['high'] for x in prev120) width=rng_high-rng_low if width <= 0: continue pos=(bar['close']-rng_low)/width outside_down = bar['close'] < rng_low * 0.997 lower_ok = pos <= 0.32 or outside_down mid_block = 0.38 <= pos <= 0.62 and not outside_down ema20_4h=mean(x['close'] for x in h4[i4h-20:i4h]); ema60_4h=mean(x['close'] for x in h4[i4h-60:i4h]) ema10_1d=mean(x['close'] for x in d1[i1d-10:i1d]); ema20_1d=mean(x['close'] for x in d1[i1d-20:i1d]) daily_down = d1[i1d]['close'] < ema10_1d < ema20_1d h4_down = h4[i4h]['close'] < ema20_4h < ema60_4h prebox15 = m15[i15-18:i15-2]; prebox1h = h1[i1h-14:i1h-2] dn15=min(x['low'] for x in prebox15) dn1h=min(x['low'] for x in prebox1h) vol15_avg=mean(x['volume'] for x in m15[i15-20:i15]); vol1h_avg=mean(x['volume'] for x in h1[i1h-20:i1h]) c15_0=m15[i15]['close']; c15_1=m15[i15-1]['close']; c1h_0=h1[i1h]['close']; c1h_1=h1[i1h-1]['close'] down_confirm = (((c15_0 < dn15 and c15_1 < dn15) or (c1h_0 < dn1h and c1h_1 < dn1h)) and (m15[i15]['volume'] >= vol15_avg*1.2 or h1[i1h]['volume'] >= vol1h_avg*1.2) and c15_0 <= dn15*1.002) if (not mid_block) and down_confirm and lower_ok and (daily_down or h4_down or outside_down): signals.append({ 'ts':t,'entry':bar['close'],'i15':i15,'i1h':i1h,'i4h':i4h,'i1d':i1d, 'pos':pos,'dn15':dn15,'dn1h':dn1h,'vol15r':m15[i15]['volume']/vol15_avg,'vol1hr':h1[i1h]['volume']/vol1h_avg, 'outside_down':outside_down,'daily_down':daily_down,'h4_down':h4_down, }) collapsed=[] for s in signals: if not collapsed or s['ts']-collapsed[-1]['ts'] > timedelta(hours=8): collapsed.append(s) m15=bars['15m']; h1=bars['1h']; h4=bars['4h'] for s in collapsed: idx=s['i15'] prev8=m15[max(0,idx-8):idx] future12=m15[idx+1:idx+49] future4h=h4[s['i4h']+1:s['i4h']+4] stop=max(x['high'] for x in m15[max(0,idx-8):idx+1]) min12=min(x['low'] for x in future12) if future12 else s['entry'] max12=max(x['high'] for x in future12) if future12 else s['entry'] t_min=min(future12, key=lambda x:x['low'])['ts'].astimezone(CST).strftime('%m-%d %H:%M') if future12 else '-' t_max=max(future12, key=lambda x:x['high'])['ts'].astimezone(CST).strftime('%m-%d %H:%M') if future12 else '-' print('---') print('ts', s['ts'].astimezone(CST).strftime('%Y-%m-%d %H:%M')) print('entry', s['entry'], 'stop', stop, 'risk_pct', round((stop-s['entry'])/s['entry']*100,2)) print('pos', round(s['pos'],3), 'dn15', s['dn15'], 'dn1h', s['dn1h'], 'v15', round(s['vol15r'],2), 'v1h', round(s['vol1hr'],2), 'outside_down', s['outside_down']) print('prev8 closes', [round(x['close'],7) for x in prev8]) print('next8 closes', [round(x['close'],7) for x in future12[:8]]) print('next12h min/max', min12, t_min, max12, t_max) print('next3 4h closes', [round(x['close'],7) for x in future4h]) PY


我已经把 6 次都拆完了，规律比数字本身更重要。接下来我会把它们分成“真正像样”和“容易假破”的两类，直接给你可用的过滤条件。

已编辑
memory.md
+8
-0
已处理 1m 11s
6 次里，真正“像样”的我只会算 2 次，剩下 4 次大多是“破是破了，但不值得追”。

我先直接给分类：

相对像样：2026-03-29 06:00 CST、2026-04-02 09:30 CST
边际或失败：2026-03-29 18:15 CST、2026-03-30 06:45 CST、2026-03-31 03:00 CST、2026-04-07 06:30 CST
这 2 次为什么相对像样：

2026-03-29 06:00 CST
信号后前 2 小时就继续往下走，后面 3 根 4h 收盘也没有立刻反包，属于“破位后还能延续”的类型。虽然利润不算巨大，但至少不是刚追就被抽脸。

2026-04-02 09:30 CST
这是 6 次里最好的一次。15m/1h 都有放量，信号后首小时就继续顺着走，12 小时内最大顺向扩展大约 2.26%，逆向只有 0.64%，这才比较像一个可跟随的追空窗口。

另外 4 次的问题其实很一致，都是“缺延续”：

2026-03-29 18:15 CST
先破了，但破完没有继续砸，后面开始横，随后被拉回去。这种就是典型“有破位形状，没有趋势推进”。

2026-03-30 06:45 CST
这是最典型的坏样本。量能极大，看起来很像强下破，但更像低位宣泄。信号后几乎立刻被大幅反抽，后面 12 小时逆向波动高达 5.27%。这类很容易追在一段下跌的尾巴上。

2026-03-31 03:00 CST
下破后只给了很短一点顺向空间，随后几个 4h 开始收回，说明大级别并没有继续配合。

2026-04-07 06:30 CST
早盘下破当时是成立的，也给过一点顺向，但 4h 还是没真正脱离整理，到了当天后面又被拉回去，所以只能算“短时有效，不够值得追”。

所以这 6 次复盘完，最重要的共性不是胜率数字，而是这个：

当前这套追空规则最大的问题，不是“抓不到破位”，而是“会抓到末端宣泄和无延续破位”。

如果把它说得更交易一点，就是现在少了一层“延续质量过滤”。只靠：

15m/1h 两根收破
放量
4h 不在中部
还不够。还应该再加至少一条：

信号后 1h 内不能快速收回原箱体
下一根 1h 不能立刻反包突破位
或者信号后首个 4h 不能明显回收
这会明显砍掉那几次最差的追空。

如果你愿意，我下一步就直接做这个最有价值的动作：
把自动化 prompt 里的 追空 条件补一条“破后延续过滤”，然后我再把近 30 天重跑一遍，看看 6 次会不会缩成更干净的 2-3 次。