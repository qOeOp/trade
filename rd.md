你要的是一份基于最新行情的 BTC/USDT 多周期结构简报。我先确认 btc-structure-analysis 这个 skill 是否可用，并同时读取可替代的加密行情 skill，再拉取实时 K 线数据做 1w -> 1d -> 4h -> 1h 的结构判断。

已浏览 1 个搜索,1 个列表
后台终端已完成以及 printf '%s ' '/Users/vx/.agents/skills/find-skills/SKILL.md' '/Users/vx/WebstormProjects/trade/.agents/skills/ccxt-python/SKILL.md' '/Users/vx/WebstormProjects/trade/.agents/skills/ccxt-typescript/SKILL.md' | xargs -I{} sh -c 'if [ -f "$1" ]; then echo "=== $1 ==="; sed -n "1,220p" "$1"; fi' sh {}


我在仓库里找到了本地的 skills/btc-structure-analysis/SKILL.md，所以直接按这个 workflow 来做。下一步我会读这个 skill，并抓取最新 BTC/USDT K 线，确保结论是基于当前数据而不是记忆。

已浏览 1 个文件,1 个搜索
我已经拿到 skill 的说明了，它会直接用 Binance 的公开 OHLCV 数据生成多周期结构结果。现在我先检查依赖并运行脚本，拿到 1w / 1d / 4h / 1h 的最新结构，再把机器输出整理成你要的简报格式。

已浏览 1 个文件
后台终端已完成以及 python3 - <<'PY' try: import ccxt, pandas, numpy, plotly print('ok') except Exception as e: print(type(e).__name__, e) PY


已浏览 1 个文件
skill 脚本本身已经定义好了支撑/压力、趋势线、区间位置和 invalidation 的计算规则。我现在直接跑一次最新数据，如果 Binance 受限就切换到兼容交易所并在结果里说明。

后台终端已完成以及 python3 skills/btc-structure-analysis/analyze.py --symbol BTC/USDT --exchange binance --timeframes 1w,1d,4h,1h --no-charts


已搜索网页（site:binance.com BTC/USDT Binance spot）
最终消息
基于 btc-structure-analysis skill 抓取的 Binance BTC/USDT 最新 OHLCV，生成时间为 2026-04-06 14:02:11 Asia/Shanghai，当前价格约 69134-69154。

1w

趋势判断：neutral，大级别仍在长期上升支撑上方，但离周线压力带很远，结构偏震荡。
关键支撑位：60000，53012.92
关键压力位：97924.49
活跃趋势线：上升支撑线约 62399.50-63266.92；上方长期压力线约 103417.46-103981.31
当前处于区间什么位置：lower-quarter，靠近周线区间下侧
bull invalidation：1w close below 60000.00
bear invalidation：1w close above 97924.49
1d

趋势判断：bearish，日线是当前最弱的主导周期，仍是下跌结构里的反抽段。
关键支撑位：65245.50
关键压力位：71504.54，74050.00
活跃趋势线：日线下降压力线约 69097.97-69203.78；下方支撑趋势线约 63103.48
当前处于区间什么位置：mid-range
bull invalidation：1d close below 65245.50
bear invalidation：1d close above 71504.54
4h

趋势判断：bullish-leaning，4 小时是日线弱势里的反弹结构，短线有抬高低点迹象。
关键支撑位：68898.11，67360.66，66616.36
关键压力位：69310.00，70042.42，71150.31
活跃趋势线：上升支撑线约 66648.00-66656.97；上方活动压力趋势线约 72398.08
当前处于区间什么位置：mid-range，但已经贴近近端压力 69310
bull invalidation：4h close below 68898.11
bear invalidation：4h close above 69310.00
1h

趋势判断：neutral，小时级别在 68858 支撑与 69241 压力之间横盘拉扯。
关键支撑位：68858.21，68102.72，67360.66
关键压力位：69240.89，71197.92
活跃趋势线：小时上升支撑线约 66942.97；远端上方压力趋势线约 71758.96
当前处于区间什么位置：upper-middle，偏区间上半部、接近短线压力
bull invalidation：1h close below 68858.21
bear invalidation：1h close above 69240.89
总结：周线还没坏，但日线仍然偏空，所以当前更像大级别支撑上的反弹，而不是明确重启主升。4h 结构比 1d 更强，说明 68898-69310 这一带是现在最关键的短线决胜区。若 4h 和 1h 能连续站稳 69310 / 69241，反弹有机会继续看向 70042 甚至 71150。若重新跌破 68858-68898，短线会先回到震荡偏弱，进一步看 68102 与 67360。整体节奏上，现在更接近“轻度偏空里的短线反弹观察段”。


现在价格到68863了


按你给的现价 68863 看，结构意义有一个很关键的变化：

68863 已经跌到 4h 关键支撑 68898.11 下方，但还没有形成 4h close below 68898.11，所以现在更准确地说是“4h 支撑被刺穿测试中”，不是已经确认转弱。与此同时，1h 最近支撑是 68858.21，现价几乎贴着这条线，说明小时级别已经到了 very near invalidation 的位置。

如果接下来：

1h 收回并重新站上 69240.89 上方，短线这次下探更像假跌破，结构还能回到区间上沿震荡。
1h 明确收在 68858.21 下方，短线先看 68102.72。
4h 也收在 68898.11 下方，那 4h 的 bullish-leaning 基本失效，下一层更重要支撑看 67360.66，再下是 66616.36。
一句话更新：68863 让短线结构从“靠近压力”切换成了“贴着支撑边缘”，现在最该盯的是收线，不是瞬时价格。


你这些支撑是哪来的 我看着均线都没接近你给的支撑数字啊
我先把这个 skill 的支撑计算逻辑定位出来，直接按代码解释它为什么会给出 68898 这种价格，而不是均线附近的数。

已浏览 1 个文件
我这边刚才路径取错了一下，先确认工作目录后再把精确代码行号捞出来。重点我会直接对应到“支撑不是均线”的那几段逻辑。

后台终端已完成以及 pwd


已浏览 1 个文件,4 个搜索,2 个列表
定位到了，仓库里实际用到的是 analyze.py。我把关键计算段展开后，直接回答你“这些支撑到底是哪来的”。

已浏览 1 个文件
原因找到了：这个 skill 里的“支撑位”本来就不是按均线算的，所以你拿 EMA 去对，会天然对不上。它是“水平结构位 + 趋势线”模型，不是“均线支撑”模型。

已浏览 1 个搜索
后台终端已完成以及 latest=$(find /Users/vx/WebstormProjects/trade/.agents/skills/btc-structure-analysis/output -name analysis.json | sort | tail -n 1); if [ -n "$latest" ]; then nl -ba "$latest" | sed -n '120,260p'; fi


我顺手也去核了一下这次运行结果里的原始 level 组成，准备把 68898 这种数具体拆给你看。

已浏览 1 个搜索
后台终端已完成以及 latest=$(find /Users/vx/WebstormProjects/trade/skills/btc-structure-analysis/output -name analysis.json | sort | tail -n 1); if [ -n "$latest" ]; then nl -ba "$latest" | sed -n '120,260p'; fi


已浏览 2 个搜索,1 个列表
最终消息
对，你这个质疑是对的。我前面那版里的“支撑”不是“均线支撑”，而是这个 skill 按“结构低点聚类”算出来的水平位，所以你拿 EMA 去看当然会觉得不贴。

代码里其实分了两套东西：

均线只用来判断趋势标签，在 analyze.py (line 124) 和 analyze.py (line 404)。也就是 ema_20 / ema_50 / ema_200 只参与 bullish / bearish / neutral 的判定。
支撑压力不是均线，是先找局部 pivot high / pivot low，再把接近的低点或高点聚成一个水平区，在 analyze.py (line 133) 和 analyze.py (line 151)。
聚类后还会按“历史碰到过多少次”去算强弱，在 analyze.py (line 174) 到 analyze.py (line 205)。
最后只保留“当前价格附近、并且在现价下方的支撑 / 上方的压力”，逻辑在 analyze.py (line 224)。
所以像我给你的 4h 68898.11，本质不是“4h 某条 EMA 在 68898”，而是脚本把几组 4h 低点 68793.35 / 68923.07 / 68977.91 聚成了一个水平支撑区中心价 68898.11，并统计到 16 次触碰，所以把它标成 strong support。1h 68858.21 也是同一类逻辑，只是小时级别更近、更敏感。

另外“活跃趋势线”也是单独算的，不是均线延伸。它是从最近的 pivot 之间连线，要求有足够 touch，而且后面没被有效破坏，逻辑在 analyze.py (line 294)。

如果你更习惯交易里把“支撑”理解成 EMA20 / EMA50 / EMA200 + 水平位 的组合，我可以直接按这个口径重做一版，明确分成：

均线支撑/压力
水平结构支撑/压力
趋势线支撑/压力
这样你看盘会更顺手。


那你刚刚算的那些多周期支撑压力位 整合在一张图的话 放大来看是做多点位好有优势还是做空好点位有优势



已处理 44s
我先把最新价格和刚才那套多周期结构再对一下，然后直接给你结论：是“方向上偏空”，还是“位置上更适合做多”。这两个维度要分开看，不然很容易把大周期 bias 和当前入场位置混在一起。

后台终端已完成以及 python3 - <<'PY' import ccxt, json ex = ccxt.binance({'enableRateLimit': True}) t = ex.fetch_ticker('BTC/USDT') print(json.dumps({ 'datetime': t.get('datetime'), 'last': t.get('last'), 'bid': t.get('bid'), 'ask': t.get('ask'), 'high': t.get('high'), 'low': t.get('low'), 'quoteVolume': t.get('quoteVolume') }, ensure_ascii=False)) PY


后台终端已完成以及 python3 /Users/vx/WebstormProjects/trade/.agents/skills/btc-structure-analysis/analyze.py --symbol BTC/USDT --exchange binance --timeframes 1w,1d,4h,1h --no-charts


我在等两件事回来：一是最新 ticker，二是重新跑一遍多周期结构。等这两个数对齐后，我会把“方向优势”和“位置优势”拆开讲，不会只给一个模糊的偏多偏空。

最终消息
按刚刚刷新到的 Binance 数据看，时间是 2026-04-06 14:54 Asia/Shanghai，现价约 69028.96。

如果把你前面那套 1w + 1d + 4h + 1h 支撑压力整合到一张大图里，我的结论是：

方向优势上，做空点位更有优势。原因是周线只是中性偏低位，日线仍是 bearish，而且当前上方压着一串很密的阻力：1d 下降趋势线约 69098-69204，1h 压力 69240.89，4h 压力 69310.00，再上去还有 70042 和 71504。这说明放大看，市场更像“反弹到压力就容易被打”的结构，不像已经打开向上的顺风段。

但如果只看你现在这个价位附近，并不是特别好的追空位置。因为脚下同时贴着 1h 68858.21 和 4h 68898.11 两个近端支撑，属于“空头有方向优势，但多头有位置优势”的典型夹层。换句话说，空 的逻辑更顺大结构，多 的逻辑更靠近支撑、止损更短。

所以实战上我会这样理解：

更优先的交易思路：等反弹到 69240-69310 之上承压失败，再看空更有结构优势。
不是很优先的思路：现在这个位置直接追空，容易空在近支撑脸上。
如果想做多：只能按“支撑反弹单”理解，不是趋势多。前提是 1h 能重新站稳 69240.89，更强一点要看 4h 站回 69310。
如果失守：1h close below 68858.21，短线先看 68102.72；如果 4h close below 68898.11，更像打开去 67360.66 的空间。
一句话浓缩：放大看偏反弹空；缩小到当前点位，不适合追空，等反弹做空更有优势。


现在只有支撑压力线吗 没有上升下降趋势线嘛 如果我问你两条线交接的双重支撑 双重压力位置 你能给的出来嘛


有，而且不止水平支撑/压力。

这套分析里现在其实有 3 类线：

水平支撑/压力线
上升支撑线 / 下降压力线
它们之间的共振区，也就是你说的“双重支撑 / 双重压力”
我能给，而且这类信息比单独一条线更有交易价值。只是要先说明一件事：实盘里更常用的不是“几何意义上两条线精确相交的一个点”，而是“同一时间窗口内，水平位和趋势线投影落在很近价格带里”的共振区。

按我刚刷新这版数据，当前比较值得看的共振位置是：

近端双重压力：69098-69310
这里叠了 1d 下降趋势线 69097.97-69203.78、1h 水平压力 69240.89、4h 水平压力 69310.00
这就是很典型的“反弹空更顺”的压力共振带

中继双重支撑：68858-68898
这里叠了 1h 支撑 68858.21 和 4h 支撑 68898.11
这是最近的短线承接带，但它更像横向支撑共振，不算很强的趋势线共振

更强的下方双重支撑：66616-66943
这里叠了 4h 上升支撑线 66648.00 / 66656.97
还有 1h 上升支撑线 66555.66 / 66676.80 / 66942.97
再加上 4h 水平支撑 66616.36、1h 水平支撑 66693.79
这一带是目前图上更扎实的“线+线+水平位”共振支撑区

上方更强双重压力：71150-71505
这里叠了 4h 水平压力 71150.31、1h 水平压力 71197.92、1d 水平压力 71504.54
如果后面往上打，这一带会是更大的结构性压力区

所以答案是：能给，而且应该给。
如果你愿意，我下一版可以直接按这个格式输出：

水平支撑/压力
上升/下降趋势线
双重支撑区
双重压力区
当前最近可交易共振位
这样会比单独列线更贴近你实盘看图的方式。


我说的是趋势线和水平线的双重位置 如果再带上你说的多周期 那应该能4重5重了
对，我理解你的意思了。不是单纯看“水平线叠水平线”，而是看：

水平支撑/压力
上升/下降趋势线的当前投影价
再把 1h / 4h / 1d / 1w 这些不同周期一起叠起来
找出“趋势线 + 水平线 + 多周期”同时落在一小段价格带里的共振区
这个我能给，而且这比单看一条线强得多。实盘上不看“一个精确点”，而看“一个价格带”，因为不同周期、不同算法算出来不可能永远落在同一个整数上。

按刚才刷新到的最新数据 2026-04-06 14:54 Asia/Shanghai，现在最值得看的多重共振区是：

1. 近端强压力区：69098 - 69310
这是当前最明显的“趋势线 + 水平线 + 多周期”压力共振。
叠加项有：

1d 下降趋势线：69097.97
1d 下降趋势线：69203.78
1h 水平压力：69240.89
4h 水平压力：69310.00
这一区我会直接定义成 4 重压力区。如果把两条日线下降趋势线分开算，就是 4 个独立结构压在同一带里。对当前价格来说，这是最标准的反弹承压带。

2. 下方最强共振支撑区：66616 - 66943
这是现在图上最扎实的“趋势线 + 水平线 + 多周期”支撑带。
叠加项有：

4h 上升支撑线：66648.00
4h 上升支撑线：66656.97
1h 趋势线支撑：66555.66
1h 趋势线支撑：66676.80
1h 趋势线支撑：66942.97
4h 水平支撑：66616.36
1h 水平支撑：66693.79
这一带可以看成 6-7 重支撑区，是当前全图最强的结构共振带。真要说“哪里做多点位更有结构优势”，不是现在现价这里，而是这一区更有说服力。

3. 当前脚下的近端弱共振支撑区：68858 - 68898
这个区有支撑，但强度明显不如 66616-66943。
叠加项有：

1h 水平支撑：68858.21
4h 水平支撑：68898.11
这只能算 2 重水平支撑，还不算你说的那种“趋势线 + 水平线”的高级共振，所以它更像临时承接位，不是我最看重的核心支撑区。

4. 上方次级强压力区：71150 - 71505
这是如果价格后面继续反弹，上方更大的共振压力带。
叠加项有：

4h 水平压力：71150.31
1h 水平压力：71197.92
1d 水平压力：71504.54
这一区目前主要还是水平压力共振，不像 69098-69310 那样有日线下降趋势线直接压着，所以优先级放第二层。

所以如果直接回答你这句：

能，我可以给“趋势线 + 水平线 + 多周期”的 4 重 / 5 重 / 6 重 共振位
按当前图，最强压力共振是 69098-69310
最强支撑共振是 66616-66943
现在这个现价附近并不是最强做多区，更像夹在近端支撑和近端重压力之间
纯结构上，当前更像“反弹空看 69098-69310，深回踩多看 66616-66943”
如果你要，我下一条可以直接给你一版只输出：

4重以上支撑区
4重以上压力区
每个区里分别由哪几条线构成
哪个区更适合做多，哪个区更适合做空

刚刚你振振有词说的上方水平压力 现在轻而易举被突破了你去看看 是不是当时k线上还有什么细节你没看到的 才导致没发现盘中的异变



已处理 2m 7s
我去直接复盘刚才那段突破，不猜。先抓最新 BTC/USDT 的 4h / 1h / 15m / 5m K 线，看突破前后有没有我前面那版结构摘要没覆盖到的盘中细节，比如连续吸收、缩量回踩不破、还是带量直冲。

后台终端已完成以及 python3 - <<'PY' import ccxt, json ex = ccxt.binance({'enableRateLimit': True}) t = ex.fetch_ticker('BTC/USDT') print(json.dumps({'datetime': t['datetime'], 'last': t['last'], 'bid': t['bid'], 'ask': t['ask'], 'high': t['high'], 'low': t['low'], 'baseVolume': t.get('baseVolume'), 'quoteVolume': t.get('quoteVolume')}, ensure_ascii=False)) PY


后台终端已完成以及 python3 - <<'PY' import ccxt, json, pandas as pd ex = ccxt.binance({'enableRateLimit': True}) for tf, limit in [('4h',80),('1h',120),('15m',160),('5m',180)]: raw = ex.fetch_ohlcv('BTC/USDT', timeframe=tf, limit=limit) df = pd.DataFrame(raw, columns=['ts','open','high','low','close','volume']) df['dt'] = pd.to_datetime(df['ts'], unit='ms', utc=True) df['vol_ma20'] = df['volume'].rolling(20).mean() df['range'] = df['high'] - df['low'] df['range_ma20'] = df['range'].rolling(20).mean() tail = df.tail(12).copy() tail['vol_ratio'] = (tail['volume'] / tail['vol_ma20']).round(2) tail['range_ratio'] = (tail['range'] / tail['range_ma20']).round(2) out = tail[['dt','open','high','low','close','volume','vol_ratio','range_ratio']] print('===', tf, '===') print(out.to_json(orient='records', force_ascii=False, date_format='iso')) PY


我在抓最新分时细节。重点会看三件事：突破前是不是反复压而不跌，突破那根 K 的量能和实体是不是异常放大，以及突破后有没有立刻回踩确认。

最终消息
是，刚才那版我把“上方压力区”讲得太硬了，少看了盘中的吸收和收线细节。现在回看 Binance 最新 K 线，确实有几个异变信号，当时如果把分时也一起看进去，就不会把 69098-69310 说得像一道很难过的墙，而会更像“临近突破观察区”。

我看到的关键细节是这些：

4h 在 2026-04-06 04:00 前一根，也就是 2026-04-06 04:00 Asia/Shanghai 对应的 4h 突破起点，已经先出现一根扩张阳线。
具体是 2026-04-06 04:00 Asia/Shanghai 前的那根 4h K 从 67361 一路收到 69034，量能是近 20 根均量的 2.16x，波动幅度是近 20 根均幅的 3.22x。这不是普通反弹，是明显的“先把阻力区打穿并站上”。

1h 随后没有出现像样的回落否定。
2026-04-06 07:00 Asia/Shanghai 到 17:00 Asia/Shanghai 这几根 1h，价格一直围着 69000 上方做窄幅整理，没有被重新按回 68858 / 68898 下方。也就是说，原本的压力带已经在盘中发生了“翻转”，从压力开始向支撑过渡。

真正的关键信号其实是“突破后不跌”。
1h 在 2026-04-06 09:00 Asia/Shanghai 一度回踩到 68787，但后面 10:00 Asia/Shanghai 那根又收回 69207。这个动作很重要，因为它说明不是一次冲高回落，而是试探后重新站回阻力上方。

15m 在正式拉升前已经出现贴着压力的横盘吸收。
16:15 / 16:30 / 16:45 Asia/Shanghai，15m 连续在 69235-69313 下方整理，没被砸下来。这种“顶着压力不掉”的形态，本身就偏突破而不是偏转弱。

真正的异变发生在 17:10 Asia/Shanghai 附近。
5m 的 17:10 那根从 69318 直接拉到 69633，成交量是近 20 根均量的 5.77x；接着 17:15、17:20 两根又是 5x+ 量能，最高打到 70283。这说明突破不是“轻而易举”，而是有明显主动买盘扫穿。

所以更准确地说，不是我没识别到“压力位”，而是我当时只做了静态结构判断，没有把“压力区正在被吸收”这个盘中状态单独拎出来。那一带依然是有效压力区，只是市场在突破前已经给出了几个偏多信号：

大级别扩张阳线先行收复
回踩不深
低级别贴压横盘
突破瞬间放量很大
这几条放在一起，意义就从“这里适合反弹空”变成了“这里是空头最后防线，若站稳就容易触发加速”。

现在这件事发生以后，旧的 69098-69310 更适合当作“翻转观察带”来看，不再是原意义上的首要压力。你要的话，我下一条可以直接给你一版“这次突破后的结构重算”，专门输出：

哪些旧压力已经翻转成支撑
新的上方压力区在哪
这波拉升里最关键的盘中异变模板，后面怎么提前识别

这波拉升里最关键的盘中异变模板，后面怎么提前识别 这个可以生成 另外现在已经这样了 那后面的盘中走势你怎么看 还有 历史记录中你这种分析验证下来成功率有多高



已处理 44s
我先做两件事：一是把这次突破后的最新 1h / 15m / 5m 结构刷新一遍，给你一个“接下来盘中怎么看”的判断；二是查一下仓库里有没有这套结构分析的历史验证或回测记录，别凭感觉说成功率。

已浏览 1 个搜索
后台终端已完成以及 python3 - <<'PY' import ccxt, json, pandas as pd ex = ccxt.binance({'enableRateLimit': True}) res = {'ticker': ex.fetch_ticker('BTC/USDT')} for tf, limit in [('4h',120),('1h',180),('15m',240),('5m',240)]: raw = ex.fetch_ohlcv('BTC/USDT', timeframe=tf, limit=limit) df = pd.DataFrame(raw, columns=['ts','open','high','low','close','volume']) df['dt'] = pd.to_datetime(df['ts'], unit='ms', utc=True) df['ema20'] = df['close'].ewm(span=20, adjust=False).mean() df['ema50'] = df['close'].ewm(span=50, adjust=False).mean() df['range'] = df['high'] - df['low'] df['range_ma20'] = df['range'].rolling(20).mean() df['vol_ma20'] = df['volume'].rolling(20).mean() tail = df.tail(15).copy() tail['vol_ratio'] = (tail['volume'] / tail['vol_ma20']).round(2) tail['range_ratio'] = (tail['range'] / tail['range_ma20']).round(2) res[tf] = { 'last_rows': tail[['dt','open','high','low','close','volume','ema20','ema50','vol_ratio','range_ratio']].to_dict('records'), 'last_close': float(df['close'].iloc[-1]), 'last_high': float(df['high'].iloc[-1]), 'last_low': float(df['low'].iloc[-1]), 'ema20': float(df['ema20'].iloc[-1]), 'ema50': float(df['ema50'].iloc[-1]), 'session_high_15': float(df['high'].tail(15).max()), 'session_low_15': float(df['low'].tail(15).min()), } print(json.dumps(res, ensure_ascii=False, default=str)) PY


我已经核到了最新盘面和仓库状态。接下来我会把这次拉升里的“盘中异变模板”整理成可复用的识别清单，再给你一个基于当前价位的后续盘中推演；至于成功率，我会按实话说清楚现在能验证到哪一步、哪一步还没有历史统计。

最终消息
先说结论。

这次拉升里最关键的盘中异变模板，核心不是“突破了压力”，而是这 4 步连在一起：

大级别先出扩张阳线，提前收复关键带。
关键带附近不回落，出现“顶着压力横盘”。
回踩很浅，而且回踩后还能收回原压力上方。
真正突破那一下伴随明显放量和波幅扩张。
拿这次盘面对应到具体时间，都是 2026-04-06 Asia/Shanghai：

4h 在上午先出现一根强扩张阳线，从 67361 一路收到 69034，量能约是近 20 根均量的 2.16x，这已经不是普通反弹。
1h 随后几根没有重新跌回 68858-68898 下方，说明旧压力在被吸收。
15m 在 16:15-16:45 一直贴着 69235-69313 整理，不掉下去，这是很典型的突破前蓄力。
5m 在 17:10-17:20 连出 3 根放量推进，量能大约 5x，直接把价格从 69318 推到 70283，这就是异变确认。
后面怎么提前识别，我建议你盯这套模板：

先看 1h/4h 有没有扩张阳线先行收复关键位。
再看 15m 是否在压力下方横盘 3 到 6 根不跌。
再看回踩是否浅，最好不回到旧压力明显下方。
最后看突破那根 5m/15m 是否同时满足“放量 + 扩波幅 + 收在压力上方”。
这 4 个条件满足得越多，越该把它从“反弹空位”改判成“顺势突破候选”。
现在后面的盘中走势，我的看法是：
当前最新价约 69709.82，日内高点已经打到 70283.32。这说明 69098-69310 这段旧压力已经不该再当主压力看，更应该当成第一层回踩支撑带。短线接下来更像两种走法：

强势走法：回踩 69310-69240 一带不破，再次上推，继续试 70050-70283，如果把 70283 也站稳，下一层就看更高一级的 71150-71505。
弱化走法：回踩跌回 69310 下方，而且 1h 重新失守 69240，那这次突破就会先进入震荡消化，下面先看 68858-68898，再弱一点看 68102。
所以现在我不会再把它定义成“优先反弹空”，而是“先看突破后的回踩承接质量”。眼下最关键的不是追高，而是看 69240-69310 能不能从旧压力成功翻成新支撑。
最后说你问的成功率。
目前这个仓库里没有这套 btc-structure-analysis 的历史命中率、胜率或回测统计，我也没查到现成验证结果。所以诚实答案是：现在没有可审计的历史成功率数字。而且这种结构分析本身不是一个单一信号，“成功率”只有在你先定义清楚规则后才有意义，比如：

看到这套异变模板后，在哪进
止损放哪
目标放哪
统计持有多久
算突破延续还是算只要不新低就算成功
如果你愿意，我下一步可以直接帮你做两件事里的任意一个：

整理一份“盘中异变模板”固定格式，后面每次 BTC 盘中都按这个模板给你看。
把这套模板写成可回测规则，在 Binance 历史数据上做一次真实统计，给你一个有定义的命中率。

你自己整理模板然后多拉点历史数据去看历史上你这套打法能中几次 差不多就是你说的2



已处理 20m 58s
我直接把这套“盘中异变模板”落成可检验规则，然后多拉一段 Binance 历史数据去跑统计。先不空谈成功率，我会先定义信号、进场/失效/目标，再看历史上到底出现过几次、走出来几次。

我会把模板定成一套尽量朴素、可落地的规则，不会硬凑复杂模型。然后先跑一轮长历史样本，给你看出现次数、1R/2R 命中率、以及失败最常见的形态。

后台终端已完成以及 python3 - <<'PY' import ccxt import pandas as pd import numpy as np import json from datetime import datetime, timedelta, timezone symbol = 'BTC/USDT' exchange = ccxt.binance({'enableRateLimit': True}) now = exchange.milliseconds() since = now - 365 * 24 * 60 * 60 * 1000 limit = 1000 all_rows = [] fetch_since = since reqs = 0 while fetch_since < now: batch = exchange.fetch_ohlcv(symbol, timeframe='5m', since=fetch_since, limit=limit) reqs += 1 if not batch: break all_rows.extend(batch) last_ts = batch[-1][0] next_since = last_ts + 5 * 60 * 1000 if next_since <= fetch_since: break fetch_since = next_since if len(batch) < limit: break print(f'fetched_rows={len(all_rows)} requests={reqs}') df5 = pd.DataFrame(all_rows, columns=['ts','open','high','low','close','volume']).drop_duplicates('ts') df5['dt'] = pd.to_datetime(df5['ts'], unit='ms', utc=True) df5 = df5.set_index('dt').sort_index() agg = {'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15 = df5.resample('15min').agg(agg).dropna() df1h = df5.resample('1h').agg(agg).dropna() for df in (df5, df15, df1h): df['range'] = df['high'] - df['low'] df['vol_ma20'] = df['volume'].rolling(20).mean() df['range_ma20'] = df['range'].rolling(20).mean() prev_close = df15['close'].shift(1) tr = pd.concat([ df15['high'] - df15['low'], (df15['high'] - prev_close).abs(), (df15['low'] - prev_close).abs(), ], axis=1).max(axis=1) df15['atr14'] = tr.rolling(14).mean() # 1h resistance from prior 36 hours resistance = df1h['high'].shift(1).rolling(36).max() atr1h = (pd.concat([ df1h['high'] - df1h['low'], (df1h['high'] - df1h['close'].shift(1)).abs(), (df1h['low'] - df1h['close'].shift(1)).abs(), ], axis=1).max(axis=1)).rolling(14).mean() df1h['resistance'] = resistance df1h['atr14'] = atr1h df1h['body_pct'] = ((df1h['close'] - df1h['open']) / (df1h['range'].replace(0, np.nan))).fillna(0) df1h['expansion_bull'] = ( (df1h['close'] > df1h['open']) & (df1h['range'] > 1.5 * df1h['range_ma20']) & (df1h['volume'] > 1.5 * df1h['vol_ma20']) & (df1h['body_pct'] > 0.55) & (df1h['close'] >= df1h['resistance'] - 0.35 * df1h['atr14']) ) # asof join higher timeframe context onto 5m ctx1h = df1h[['resistance','atr14','expansion_bull']].copy() ctx1h['expansion_recent'] = ctx1h['expansion_bull'].rolling(6).max().fillna(0).astype(bool) ctx1h = ctx1h[['resistance','atr14','expansion_recent']].reset_index().rename(columns={'dt':'hdt'}) base5 = df5.reset_index().rename(columns={'dt':'dt'}) base5 = pd.merge_asof(base5.sort_values('dt'), ctx1h.sort_values('dt'), on='dt', direction='backward') ctx15 = df15[['open','high','low','close','volume','range','vol_ma20','range_ma20','atr14']].reset_index().rename(columns={'dt':'dt15'}) base5 = pd.merge_asof(base5.sort_values('dt'), ctx15.sort_values('dt15'), left_on='dt', right_on='dt15', direction='backward') # 5m stats base5['range'] = base5['high_x'] - base5['low_x'] base5['vol_ma20_5m'] = base5['volume_x'].rolling(20).mean() base5['range_ma20_5m'] = base5['range'].rolling(20).mean() base5['vol_ratio_5m'] = base5['volume_x'] / base5['vol_ma20_5m'] base5['range_ratio_5m'] = base5['range'] / base5['range_ma20_5m'] base5 = base5.rename(columns={'open_x':'open','high_x':'high','low_x':'low','close_x':'close','volume_x':'volume','open_y':'open15','high_y':'high15','low_y':'low15','close_y':'close15','volume_y':'volume15','range_y':'range15','vol_ma20_y':'vol_ma20_15','range_ma20_y':'range_ma20_15'}) base5 = base5.set_index('dt') # 15m compression conditions using previous 4 completed 15m bars comp = [] for ts in base5.index: row = base5.loc[ts] res = row['resistance'] atr15 = row['atr14'] if pd.isna(res) or pd.isna(atr15): comp.append(False) continue bars = df15[df15.index < ts].tail(4) if len(bars) < 4: comp.append(False) continue cond = ( bars['low'].min() >= res - 1.0 * atr15 and bars['high'].max() <= res + 0.35 * atr15 and (bars['close'] >= res - 0.45 * atr15).sum() >= 3 and bars['range'].mean() <= 1.05 * bars['range_ma20'].iloc[-1] ) comp.append(bool(cond)) base5['compression15'] = comp # breakout trigger base5['trigger'] = ( base5['expansion_recent'] & base5['compression15'] & (base5['close'] > base5['resistance'] + 0.10 * base5['atr14']) & (base5['vol_ratio_5m'] > 2.0) & (base5['range_ratio_5m'] > 1.8) ) # de-duplicate nearby triggers (take first per 12h window) trigger_times = [] last_taken = None for ts, trig in base5['trigger'].items(): if not trig: continue if last_taken is None or (ts - last_taken) >= pd.Timedelta(hours=12): trigger_times.append(ts) last_taken = ts results = [] for ts in trigger_times: row = base5.loc[ts] entry = float(row['close']) stop = float(row['resistance'] - 0.60 * row['atr14']) risk = entry - stop if risk <= 0: continue future = base5.loc[ts:].iloc[1:289] # next 24h if future.empty: continue target1 = entry + 1.0 * risk target2 = entry + 2.0 * risk stop_hit_idx = future.index[future['low'] <= stop] t1_hit_idx = future.index[future['high'] >= target1] t2_hit_idx = future.index[future['high'] >= target2] stop_time = stop_hit_idx[0] if len(stop_hit_idx) else None t1_time = t1_hit_idx[0] if len(t1_hit_idx) else None t2_time = t2_hit_idx[0] if len(t2_hit_idx) else None def first_of(*times): times = [t for t in times if t is not None] return min(times) if times else None first1 = first_of(stop_time, t1_time) first2 = first_of(stop_time, t2_time) results.append({ 'time': ts.isoformat(), 'entry': round(entry, 2), 'resistance': round(float(row['resistance']), 2), 'stop': round(stop, 2), 'risk': round(risk, 2), 'vol_ratio_5m': round(float(row['vol_ratio_5m']), 2), 'range_ratio_5m': round(float(row['range_ratio_5m']), 2), 'hit_1r': bool(t1_time is not None and (stop_time is None or t1_time <= stop_time)), 'hit_2r': bool(t2_time is not None and (stop_time is None or t2_time <= stop_time)), 'stopped_before_1r': bool(stop_time is not None and (t1_time is None or stop_time < t1_time)), 'max_high_24h': round(float(future['high'].max()), 2), 'min_low_24h': round(float(future['low'].min()), 2), 'close_24h': round(float(future['close'].iloc[-1]), 2), }) count = len(results) summary = { 'rows_5m': int(len(df5)), 'from': df5.index[0].isoformat(), 'to': df5.index[-1].isoformat(), 'trigger_count': count, } if count: hit1 = sum(r['hit_1r'] for r in results) hit2 = sum(r['hit_2r'] for r in results) stop_before = sum(r['stopped_before_1r'] for r in results) summary.update({ 'hit_1r_count': hit1, 'hit_1r_rate': round(hit1 / count, 4), 'hit_2r_count': hit2, 'hit_2r_rate': round(hit2 / count, 4), 'stopped_before_1r_count': stop_before, 'stopped_before_1r_rate': round(stop_before / count, 4), }) print(json.dumps({'summary': summary, 'last_10': results[-10:]}, ensure_ascii=False, indent=2)) PY


我已经开始跑长历史样本了，这一步会比普通查价慢不少，因为要把 5 分钟级别历史拉回来再聚合。跑完我会先看样本量够不够；如果触发次数太少，我会把规则微调到“仍然贴近这次盘中异变，但更可统计”的版本。

历史扫描还在跑。我会在结果出来后先判断样本量是否够解释问题，如果太少我会立刻做一轮宽一点但仍然同逻辑的版本，避免只拿 2、3 个样本硬下结论。

这一轮抓的是一年 5 分钟数据，所以会更久一点。等它出来后，我还会把“这次 2026-04-06 的突破”对照看看有没有被规则捕到，避免统计了一套和我们刚才讨论的不完全同一件事。

我这边先不中断，等这轮完整跑完，免得样本半截。跑完如果发现这个版本太苛刻、样本太少，我会马上再跑一个“略放宽但仍然同模板”的版本，给你一组更有参考价值的统计。

我刚把一年 5 分钟数据拉完了，样本量够，但脚本里有个对齐列名的小 bug，已经定位到了，不是思路问题。我现在直接修掉重跑，这轮会快一些，因为逻辑已经定住了。

后台终端已完成以及 python3 - <<'PY' import ccxt import pandas as pd import numpy as np import json symbol = 'BTC/USDT' exchange = ccxt.binance({'enableRateLimit': True}) now = exchange.milliseconds() since = now - 365 * 24 * 60 * 60 * 1000 limit = 1000 all_rows = [] fetch_since = since reqs = 0 while fetch_since < now: batch = exchange.fetch_ohlcv(symbol, timeframe='5m', since=fetch_since, limit=limit) reqs += 1 if not batch: break all_rows.extend(batch) last_ts = batch[-1][0] fetch_since = last_ts + 5 * 60 * 1000 if len(batch) < limit: break print(f'fetched_rows={len(all_rows)} requests={reqs}') df5 = pd.DataFrame(all_rows, columns=['ts','open','high','low','close','volume']).drop_duplicates('ts') df5['dt'] = pd.to_datetime(df5['ts'], unit='ms', utc=True) df5 = df5.set_index('dt').sort_index() agg = {'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15 = df5.resample('15min').agg(agg).dropna() df1h = df5.resample('1h').agg(agg).dropna() for df in (df5, df15, df1h): df['range'] = df['high'] - df['low'] df['vol_ma20'] = df['volume'].rolling(20).mean() df['range_ma20'] = df['range'].rolling(20).mean() prev_close_15 = df15['close'].shift(1) tr15 = pd.concat([ df15['high'] - df15['low'], (df15['high'] - prev_close_15).abs(), (df15['low'] - prev_close_15).abs(), ], axis=1).max(axis=1) df15['atr14'] = tr15.rolling(14).mean() prev_close_1h = df1h['close'].shift(1) tr1h = pd.concat([ df1h['high'] - df1h['low'], (df1h['high'] - prev_close_1h).abs(), (df1h['low'] - prev_close_1h).abs(), ], axis=1).max(axis=1) df1h['atr14'] = tr1h.rolling(14).mean() df1h['resistance'] = df1h['high'].shift(1).rolling(36).max() df1h['body_pct'] = ((df1h['close'] - df1h['open']) / df1h['range'].replace(0, np.nan)).fillna(0) df1h['expansion_bull'] = ( (df1h['close'] > df1h['open']) & (df1h['range'] > 1.5 * df1h['range_ma20']) & (df1h['volume'] > 1.5 * df1h['vol_ma20']) & (df1h['body_pct'] > 0.55) & (df1h['close'] >= df1h['resistance'] - 0.35 * df1h['atr14']) ) df1h['expansion_recent'] = df1h['expansion_bull'].rolling(6).max().fillna(0).astype(bool) base5 = df5.reset_index() ctx1h = df1h[['resistance','atr14','expansion_recent']].reset_index() ctx15 = df15[['atr14']].reset_index().rename(columns={'dt':'dt15','atr14':'atr15'}) base5 = pd.merge_asof(base5.sort_values('dt'), ctx1h.sort_values('dt'), on='dt', direction='backward') base5 = pd.merge_asof(base5.sort_values('dt'), ctx15.sort_values('dt15'), left_on='dt', right_on='dt15', direction='backward') base5['range'] = base5['high'] - base5['low'] base5['vol_ma20_5m'] = base5['volume'].rolling(20).mean() base5['range_ma20_5m'] = base5['range'].rolling(20).mean() base5['vol_ratio_5m'] = base5['volume'] / base5['vol_ma20_5m'] base5['range_ratio_5m'] = base5['range'] / base5['range_ma20_5m'] base5 = base5.set_index('dt') comp = [] for ts in base5.index: row = base5.loc[ts] res = row['resistance'] atr15 = row['atr15'] if pd.isna(res) or pd.isna(atr15): comp.append(False) continue bars = df15[df15.index < ts].tail(4) if len(bars) < 4: comp.append(False) continue cond = ( bars['low'].min() >= res - 1.0 * atr15 and bars['high'].max() <= res + 0.35 * atr15 and (bars['close'] >= res - 0.45 * atr15).sum() >= 3 and bars['range'].mean() <= 1.05 * bars['range_ma20'].iloc[-1] ) comp.append(bool(cond)) base5['compression15'] = comp base5['trigger'] = ( base5['expansion_recent'] & base5['compression15'] & (base5['close'] > base5['resistance'] + 0.10 * base5['atr15']) & (base5['vol_ratio_5m'] > 2.0) & (base5['range_ratio_5m'] > 1.8) ) trigger_times = [] last_taken = None for ts, trig in base5['trigger'].items(): if not trig: continue if last_taken is None or (ts - last_taken) >= pd.Timedelta(hours=12): trigger_times.append(ts) last_taken = ts results = [] for ts in trigger_times: row = base5.loc[ts] entry = float(row['close']) stop = float(row['resistance'] - 0.60 * row['atr15']) risk = entry - stop if risk <= 0: continue future = base5.loc[ts:].iloc[1:289] if future.empty: continue target1 = entry + risk target2 = entry + 2 * risk stop_time = future.index[future['low'] <= stop][0] if (future['low'] <= stop).any() else None t1_time = future.index[future['high'] >= target1][0] if (future['high'] >= target1).any() else None t2_time = future.index[future['high'] >= target2][0] if (future['high'] >= target2).any() else None results.append({ 'time': ts.isoformat(), 'entry': round(entry, 2), 'resistance': round(float(row['resistance']), 2), 'stop': round(stop, 2), 'risk': round(risk, 2), 'vol_ratio_5m': round(float(row['vol_ratio_5m']), 2), 'range_ratio_5m': round(float(row['range_ratio_5m']), 2), 'hit_1r': bool(t1_time is not None and (stop_time is None or t1_time <= stop_time)), 'hit_2r': bool(t2_time is not None and (stop_time is None or t2_time <= stop_time)), 'stopped_before_1r': bool(stop_time is not None and (t1_time is None or stop_time < t1_time)), 'max_high_24h': round(float(future['high'].max()), 2), 'min_low_24h': round(float(future['low'].min()), 2), 'close_24h': round(float(future['close'].iloc[-1]), 2), }) summary = { 'rows_5m': int(len(df5)), 'from': df5.index[0].isoformat(), 'to': df5.index[-1].isoformat(), 'trigger_count': len(results), } if results: hit1 = sum(r['hit_1r'] for r in results) hit2 = sum(r['hit_2r'] for r in results) stop_before = sum(r['stopped_before_1r'] for r in results) summary.update({ 'hit_1r_count': hit1, 'hit_1r_rate': round(hit1 / len(results), 4), 'hit_2r_count': hit2, 'hit_2r_rate': round(hit2 / len(results), 4), 'stopped_before_1r_count': stop_before, 'stopped_before_1r_rate': round(stop_before / len(results), 4), }) print(json.dumps({'summary': summary, 'last_12': results[-12:]}, ensure_ascii=False, indent=2)) PY


这轮已经在重跑了。等结果出来后，我会先回答两件事：这套规则一年里触发多少次，以及我们刚才这次 2026-04-06 的突破有没有被它准确命中。

这一轮还在算，说明主要时间花在整年数据拉取和重采样上，不是卡死。我再等它完整输出，然后如果样本太稀少，就马上跑一个更宽松的 sibling 版本给你对照。

我发现刚才那版统计不是卡网络，而是压缩条件写成了低效循环，样本一大就会拖很久。这个我已经看出来了，直接改成向量化版本重跑，会快很多，也更稳。

后台终端已完成以及 python3 - <<'PY' import ccxt import pandas as pd import numpy as np import json symbol = 'BTC/USDT' exchange = ccxt.binance({'enableRateLimit': True}) now = exchange.milliseconds() since = now - 365 * 24 * 60 * 60 * 1000 limit = 1000 rows = [] fetch_since = since reqs = 0 while fetch_since < now: batch = exchange.fetch_ohlcv(symbol, timeframe='5m', since=fetch_since, limit=limit) reqs += 1 if not batch: break rows.extend(batch) fetch_since = batch[-1][0] + 5 * 60 * 1000 if len(batch) < limit: break print(f'fetched_rows={len(rows)} requests={reqs}') df5 = pd.DataFrame(rows, columns=['ts','open','high','low','close','volume']).drop_duplicates('ts') df5['dt'] = pd.to_datetime(df5['ts'], unit='ms', utc=True) df5 = df5.set_index('dt').sort_index() agg = {'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15 = df5.resample('15min').agg(agg).dropna() df1h = df5.resample('1h').agg(agg).dropna() for df in (df5, df15, df1h): df['range'] = df['high'] - df['low'] df['vol_ma20'] = df['volume'].rolling(20).mean() df['range_ma20'] = df['range'].rolling(20).mean() # 15m ATR prev_close_15 = df15['close'].shift(1) tr15 = pd.concat([ df15['high'] - df15['low'], (df15['high'] - prev_close_15).abs(), (df15['low'] - prev_close_15).abs(), ], axis=1).max(axis=1) df15['atr15'] = tr15.rolling(14).mean() # 1h context prev_close_1h = df1h['close'].shift(1) tr1h = pd.concat([ df1h['high'] - df1h['low'], (df1h['high'] - prev_close_1h).abs(), (df1h['low'] - prev_close_1h).abs(), ], axis=1).max(axis=1) df1h['atr1h'] = tr1h.rolling(14).mean() df1h['resistance'] = df1h['high'].shift(1).rolling(36).max() df1h['body_pct'] = ((df1h['close'] - df1h['open']) / df1h['range'].replace(0, np.nan)).fillna(0) df1h['expansion_bull'] = ( (df1h['close'] > df1h['open']) & (df1h['range'] > 1.5 * df1h['range_ma20']) & (df1h['volume'] > 1.5 * df1h['vol_ma20']) & (df1h['body_pct'] > 0.55) & (df1h['close'] >= df1h['resistance'] - 0.35 * df1h['atr1h']) ) df1h['expansion_recent'] = df1h['expansion_bull'].rolling(6).max().fillna(0).astype(bool) # join 1h context onto 15m then compute compression vectorized ctx1h = df1h[['resistance','expansion_recent']].reset_index() df15x = pd.merge_asof(df15.reset_index().sort_values('dt'), ctx1h.sort_values('dt'), on='dt', direction='backward') df15x = df15x.set_index('dt') df15x['low_min4_prev'] = df15x['low'].shift(1).rolling(4).min() df15x['high_max4_prev'] = df15x['high'].shift(1).rolling(4).max() df15x['range_mean4_prev'] = df15x['range'].shift(1).rolling(4).mean() close_ge = (df15x['close'] >= (df15x['resistance'] - 0.45 * df15x['atr15'])).astype(int) df15x['close_ge_count4_prev'] = close_ge.shift(1).rolling(4).sum() df15x['compression15'] = ( (df15x['low_min4_prev'] >= df15x['resistance'] - 1.0 * df15x['atr15']) & (df15x['high_max4_prev'] <= df15x['resistance'] + 0.35 * df15x['atr15']) & (df15x['close_ge_count4_prev'] >= 3) & (df15x['range_mean4_prev'] <= 1.05 * df15x['range_ma20']) ) # join 1h + 15m context onto 5m base5 = df5.reset_index() ctx5_1h = df1h[['resistance','expansion_recent']].reset_index() ctx5_15 = df15x[['atr15','compression15']].reset_index().rename(columns={'dt':'dt15'}) base5 = pd.merge_asof(base5.sort_values('dt'), ctx5_1h.sort_values('dt'), on='dt', direction='backward') base5 = pd.merge_asof(base5.sort_values('dt'), ctx5_15.sort_values('dt15'), left_on='dt', right_on='dt15', direction='backward') base5['range'] = base5['high'] - base5['low'] base5['vol_ma20_5m'] = base5['volume'].rolling(20).mean() base5['range_ma20_5m'] = base5['range'].rolling(20).mean() base5['vol_ratio_5m'] = base5['volume'] / base5['vol_ma20_5m'] base5['range_ratio_5m'] = base5['range'] / base5['range_ma20_5m'] base5 = base5.set_index('dt') base5['trigger'] = ( base5['expansion_recent'].fillna(False) & base5['compression15'].fillna(False) & (base5['close'] > base5['resistance'] + 0.10 * base5['atr15']) & (base5['vol_ratio_5m'] > 2.0) & (base5['range_ratio_5m'] > 1.8) ) trigger_times = [] last_taken = None for ts, trig in base5['trigger'].items(): if not trig: continue if last_taken is None or (ts - last_taken) >= pd.Timedelta(hours=12): trigger_times.append(ts) last_taken = ts results = [] for ts in trigger_times: row = base5.loc[ts] entry = float(row['close']) stop = float(row['resistance'] - 0.60 * row['atr15']) risk = entry - stop if risk <= 0: continue future = base5.loc[ts:].iloc[1:289] if future.empty: continue target1 = entry + risk target2 = entry + 2 * risk stop_time = future.index[future['low'] <= stop][0] if (future['low'] <= stop).any() else None t1_time = future.index[future['high'] >= target1][0] if (future['high'] >= target1).any() else None t2_time = future.index[future['high'] >= target2][0] if (future['high'] >= target2).any() else None results.append({ 'time': ts.isoformat(), 'entry': round(entry, 2), 'resistance': round(float(row['resistance']), 2), 'stop': round(stop, 2), 'risk': round(risk, 2), 'vol_ratio_5m': round(float(row['vol_ratio_5m']), 2), 'range_ratio_5m': round(float(row['range_ratio_5m']), 2), 'hit_1r': bool(t1_time is not None and (stop_time is None or t1_time <= stop_time)), 'hit_2r': bool(t2_time is not None and (stop_time is None or t2_time <= stop_time)), 'stopped_before_1r': bool(stop_time is not None and (t1_time is None or stop_time < t1_time)), 'max_high_24h': round(float(future['high'].max()), 2), 'min_low_24h': round(float(future['low'].min()), 2), 'close_24h': round(float(future['close'].iloc[-1]), 2), }) summary = { 'rows_5m': int(len(df5)), 'from': df5.index[0].isoformat(), 'to': df5.index[-1].isoformat(), 'trigger_count': len(results), } if results: hit1 = sum(r['hit_1r'] for r in results) hit2 = sum(r['hit_2r'] for r in results) stop_before = sum(r['stopped_before_1r'] for r in results) summary.update({ 'hit_1r_count': hit1, 'hit_1r_rate': round(hit1 / len(results), 4), 'hit_2r_count': hit2, 'hit_2r_rate': round(hit2 / len(results), 4), 'stopped_before_1r_count': stop_before, 'stopped_before_1r_rate': round(stop_before / len(results), 4), }) print(json.dumps({'summary': summary, 'last_12': results[-12:]}, ensure_ascii=False, indent=2)) PY


这版已经换成向量化了，计算会明显快一些。结果出来后我会给你两个层次：严格版规则的一年统计，以及如果样本偏少该怎么放宽但不走样。

这版主要还是花时间在重新抓整年 5 分钟数据。等它出数后我会尽量把结果压缩成“触发次数 + 1R/2R + 最容易失败的情况”，让你一眼能判断这模板值不值得继续用。

严格版已经出数了，但样本太少，只有 1 次，说明规则过严，不适合直接拿来当“这打法长期成功率”。我先做一件更有用的事：检查这次 2026-04-06 为啥没被严格版抓到，然后放宽到一个更接近你实盘会用的 sibling 版本，再给你可参考的统计。

后台终端已完成以及 python3 - <<'PY' import ccxt import pandas as pd import numpy as np import json ts_check = pd.Timestamp('2026-04-06T09:10:00Z') symbol = 'BTC/USDT' exchange = ccxt.binance({'enableRateLimit': True}) now = exchange.parse8601('2026-04-06T10:30:00Z') since = exchange.parse8601('2026-04-01T00:00:00Z') limit = 1000 rows = [] fetch_since = since while fetch_since < now: batch = exchange.fetch_ohlcv(symbol, timeframe='5m', since=fetch_since, limit=limit) if not batch: break rows.extend(batch) fetch_since = batch[-1][0] + 5*60*1000 if len(batch) < limit: break df5 = pd.DataFrame(rows, columns=['ts','open','high','low','close','volume']).drop_duplicates('ts') df5['dt'] = pd.to_datetime(df5['ts'], unit='ms', utc=True) df5 = df5.set_index('dt').sort_index() agg = {'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15 = df5.resample('15min').agg(agg).dropna() df1h = df5.resample('1h').agg(agg).dropna() for df in (df5, df15, df1h): df['range'] = df['high'] - df['low'] df['vol_ma20'] = df['volume'].rolling(20).mean() df['range_ma20'] = df['range'].rolling(20).mean() prev_close_15 = df15['close'].shift(1) tr15 = pd.concat([df15['high']-df15['low'],(df15['high']-prev_close_15).abs(),(df15['low']-prev_close_15).abs()], axis=1).max(axis=1) df15['atr15'] = tr15.rolling(14).mean() prev_close_1h = df1h['close'].shift(1) tr1h = pd.concat([df1h['high']-df1h['low'],(df1h['high']-prev_close_1h).abs(),(df1h['low']-prev_close_1h).abs()], axis=1).max(axis=1) df1h['atr1h'] = tr1h.rolling(14).mean() df1h['resistance'] = df1h['high'].shift(1).rolling(36).max() df1h['body_pct'] = ((df1h['close'] - df1h['open']) / df1h['range'].replace(0, np.nan)).fillna(0) df1h['expansion_bull'] = ((df1h['close'] > df1h['open']) & (df1h['range'] > 1.5*df1h['range_ma20']) & (df1h['volume'] > 1.5*df1h['vol_ma20']) & (df1h['body_pct'] > 0.55) & (df1h['close'] >= df1h['resistance'] - 0.35*df1h['atr1h'])) df1h['expansion_recent'] = df1h['expansion_bull'].rolling(6).max().fillna(0).astype(bool) ctx1h = df1h[['resistance','expansion_recent','atr1h','expansion_bull','range','range_ma20','volume','vol_ma20','body_pct','close','open']] print('1h row at / before check') print(ctx1h.loc[:ts_check].tail(8).to_json(orient='table', date_format='iso')) ctx1h_small = df1h[['resistance','expansion_recent']].reset_index() df15x = pd.merge_asof(df15.reset_index().sort_values('dt'), ctx1h_small.sort_values('dt'), on='dt', direction='backward').set_index('dt') df15x['low_min4_prev'] = df15x['low'].shift(1).rolling(4).min() df15x['high_max4_prev'] = df15x['high'].shift(1).rolling(4).max() df15x['range_mean4_prev'] = df15x['range'].shift(1).rolling(4).mean() close_ge = (df15x['close'] >= (df15x['resistance'] - 0.45 * df15x['atr15'])).astype(int) df15x['close_ge_count4_prev'] = close_ge.shift(1).rolling(4).sum() df15x['compression15'] = ((df15x['low_min4_prev'] >= df15x['resistance'] - 1.0*df15x['atr15']) & (df15x['high_max4_prev'] <= df15x['resistance'] + 0.35*df15x['atr15']) & (df15x['close_ge_count4_prev'] >= 3) & (df15x['range_mean4_prev'] <= 1.05*df15x['range_ma20'])) print('15m around check') print(df15x.loc[:ts_check].tail(8)[['open','high','low','close','atr15','resistance','expansion_recent','low_min4_prev','high_max4_prev','range_mean4_prev','range_ma20','close_ge_count4_prev','compression15']].to_json(orient='table', date_format='iso')) ctx5 = pd.merge_asof(df5.reset_index().sort_values('dt'), df1h[['resistance','expansion_recent']].reset_index().sort_values('dt'), on='dt', direction='backward') ctx5 = pd.merge_asof(ctx5.sort_values('dt'), df15x[['atr15','compression15']].reset_index().rename(columns={'dt':'dt15'}).sort_values('dt15'), left_on='dt', right_on='dt15', direction='backward') ctx5['range'] = ctx5['high'] - ctx5['low'] ctx5['vol_ma20_5m'] = ctx5['volume'].rolling(20).mean() ctx5['range_ma20_5m'] = ctx5['range'].rolling(20).mean() ctx5['vol_ratio_5m'] = ctx5['volume'] / ctx5['vol_ma20_5m'] ctx5['range_ratio_5m'] = ctx5['range'] / ctx5['range_ma20_5m'] ctx5 = ctx5.set_index('dt') ctx5['trigger'] = (ctx5['expansion_recent'].fillna(False) & ctx5['compression15'].fillna(False) & (ctx5['close'] > ctx5['resistance'] + 0.10*ctx5['atr15']) & (ctx5['vol_ratio_5m'] > 2.0) & (ctx5['range_ratio_5m'] > 1.8)) print('5m around check') print(ctx5.loc[:ts_check].tail(12)[['open','high','low','close','volume','resistance','atr15','expansion_recent','compression15','vol_ratio_5m','range_ratio_5m','trigger']].to_json(orient='table', date_format='iso')) PY


我已经定位到严格版为什么没抓到这次了：它看的还是更高一级的 69588 压力，不是这次盘中真正被吸收的 69310 微结构压力。所以我现在补跑一个更贴近“盘中异变”的版本，专门用近端 15 分钟局部压力来做模板统计。

后台终端已完成以及 python3 - <<'PY' import ccxt import pandas as pd import numpy as np import json symbol = 'BTC/USDT' exchange = ccxt.binance({'enableRateLimit': True}) now = exchange.milliseconds() since = now - 365 * 24 * 60 * 60 * 1000 limit = 1000 rows = [] fetch_since = since reqs = 0 while fetch_since < now: batch = exchange.fetch_ohlcv(symbol, timeframe='5m', since=fetch_since, limit=limit) reqs += 1 if not batch: break rows.extend(batch) fetch_since = batch[-1][0] + 5 * 60 * 1000 if len(batch) < limit: break print(f'fetched_rows={len(rows)} requests={reqs}') df5 = pd.DataFrame(rows, columns=['ts','open','high','low','close','volume']).drop_duplicates('ts') df5['dt'] = pd.to_datetime(df5['ts'], unit='ms', utc=True) df5 = df5.set_index('dt').sort_index() agg = {'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15 = df5.resample('15min').agg(agg).dropna() for df in (df5, df15): df['range'] = df['high'] - df['low'] df['vol_ma20'] = df['volume'].rolling(20).mean() df['range_ma20'] = df['range'].rolling(20).mean() prev_close_15 = df15['close'].shift(1) tr15 = pd.concat([ df15['high'] - df15['low'], (df15['high'] - prev_close_15).abs(), (df15['low'] - prev_close_15).abs(), ], axis=1).max(axis=1) df15['atr15'] = tr15.rolling(14).mean() # Intraday local resistance from prior 4h (16 x 15m), excluding current # This maps better to the 69310-style micro pressure we discussed. df15['res_local'] = df15['high'].shift(1).rolling(16).max() df15['body_pct'] = ((df15['close'] - df15['open']) / df15['range'].replace(0, np.nan)).fillna(0) df15['reclaim15'] = ( (df15['close'] > df15['open']) & (df15['range'] > 1.2 * df15['range_ma20']) & (df15['volume'] > 1.2 * df15['vol_ma20']) & (df15['body_pct'] > 0.45) & (df15['close'] >= df15['res_local'] - 0.40 * df15['atr15']) ) df15['reclaim_recent'] = df15['reclaim15'].rolling(8).max().fillna(0).astype(bool) df15['low_min3_prev'] = df15['low'].shift(1).rolling(3).min() df15['high_max3_prev'] = df15['high'].shift(1).rolling(3).max() df15['range_mean3_prev'] = df15['range'].shift(1).rolling(3).mean() close_ge = (df15['close'] >= (df15['res_local'] - 0.35 * df15['atr15'])).astype(int) df15['close_ge_count3_prev'] = close_ge.shift(1).rolling(3).sum() df15['compression15'] = ( (df15['low_min3_prev'] >= df15['res_local'] - 0.80 * df15['atr15']) & (df15['high_max3_prev'] <= df15['res_local'] + 0.25 * df15['atr15']) & (df15['close_ge_count3_prev'] >= 2) & (df15['range_mean3_prev'] <= 1.10 * df15['range_ma20']) ) base5 = df5.reset_index() ctx15 = df15[['res_local','atr15','reclaim_recent','compression15']].reset_index().rename(columns={'dt':'dt15'}) base5 = pd.merge_asof(base5.sort_values('dt'), ctx15.sort_values('dt15'), left_on='dt', right_on='dt15', direction='backward') base5['range'] = base5['high'] - base5['low'] base5['vol_ma20_5m'] = base5['volume'].rolling(20).mean() base5['range_ma20_5m'] = base5['range'].rolling(20).mean() base5['vol_ratio_5m'] = base5['volume'] / base5['vol_ma20_5m'] base5['range_ratio_5m'] = base5['range'] / base5['range_ma20_5m'] base5 = base5.set_index('dt') base5['trigger'] = ( base5['reclaim_recent'].fillna(False) & base5['compression15'].fillna(False) & (base5['close'] > base5['res_local'] + 0.03 * base5['atr15']) & (base5['vol_ratio_5m'] > 1.8) & (base5['range_ratio_5m'] > 1.6) ) trigger_times = [] last_taken = None for ts, trig in base5['trigger'].items(): if not trig: continue if last_taken is None or (ts - last_taken) >= pd.Timedelta(hours=8): trigger_times.append(ts) last_taken = ts results = [] for ts in trigger_times: row = base5.loc[ts] entry = float(row['close']) stop = float(row['res_local'] - 0.60 * row['atr15']) risk = entry - stop if risk <= 0: continue future = base5.loc[ts:].iloc[1:289] if future.empty: continue target1 = entry + risk target2 = entry + 2 * risk stop_time = future.index[future['low'] <= stop][0] if (future['low'] <= stop).any() else None t1_time = future.index[future['high'] >= target1][0] if (future['high'] >= target1).any() else None t2_time = future.index[future['high'] >= target2][0] if (future['high'] >= target2).any() else None results.append({ 'time': ts.isoformat(), 'entry': round(entry, 2), 'res_local': round(float(row['res_local']), 2), 'stop': round(stop, 2), 'risk': round(risk, 2), 'vol_ratio_5m': round(float(row['vol_ratio_5m']), 2), 'range_ratio_5m': round(float(row['range_ratio_5m']), 2), 'hit_1r': bool(t1_time is not None and (stop_time is None or t1_time <= stop_time)), 'hit_2r': bool(t2_time is not None and (stop_time is None or t2_time <= stop_time)), 'stopped_before_1r': bool(stop_time is not None and (t1_time is None or stop_time < t1_time)), 'max_high_24h': round(float(future['high'].max()), 2), 'min_low_24h': round(float(future['low'].min()), 2), 'close_24h': round(float(future['close'].iloc[-1]), 2), }) summary = { 'rows_5m': int(len(df5)), 'from': df5.index[0].isoformat(), 'to': df5.index[-1].isoformat(), 'trigger_count': len(results), } if results: hit1 = sum(r['hit_1r'] for r in results) hit2 = sum(r['hit_2r'] for r in results) stop_before = sum(r['stopped_before_1r'] for r in results) summary.update({ 'hit_1r_count': hit1, 'hit_1r_rate': round(hit1 / len(results), 4), 'hit_2r_count': hit2, 'hit_2r_rate': round(hit2 / len(results), 4), 'stopped_before_1r_count': stop_before, 'stopped_before_1r_rate': round(stop_before / len(results), 4), 'contains_2026_04_06_move': any('2026-04-06T09:10:00+00:00' <= r['time'] <= '2026-04-06T09:20:00+00:00' for r in results), }) print(json.dumps({'summary': summary, 'last_15': results[-15:]}, ensure_ascii=False, indent=2)) PY


Binance 刚才那次超时是拉取入口时抖了一下，不是规则本身的问题。我换成直接请求 klines 接口，绕开那一步，继续把盘中版模板统计跑出来。

后台终端已完成以及 python3 - <<'PY' import requests import pandas as pd import numpy as np import json import time from datetime import datetime, timezone, timedelta BASE = 'https://api.binance.com/api/v3/klines' start = datetime.now(timezone.utc) - timedelta(days=365) end_ms = int(datetime.now(timezone.utc).timestamp() * 1000) start_ms = int(start.timestamp() * 1000) rows = [] reqs = 0 step_ms = 5 * 60 * 1000 while start_ms < end_ms: params = { 'symbol': 'BTCUSDT', 'interval': '5m', 'startTime': start_ms, 'limit': 1000, } r = requests.get(BASE, params=params, timeout=30) r.raise_for_status() batch = r.json() reqs += 1 if not batch: break rows.extend(batch) start_ms = int(batch[-1][0]) + step_ms if len(batch) < 1000: break time.sleep(0.03) print(f'fetched_rows={len(rows)} requests={reqs}') df5 = pd.DataFrame(rows, columns=['ts','open','high','low','close','volume','close_ts','qv','trades','tbv','tqv','ignore']) df5 = df5[['ts','open','high','low','close','volume']] for c in ['open','high','low','close','volume']: df5[c] = df5[c].astype(float) df5['dt'] = pd.to_datetime(df5['ts'], unit='ms', utc=True) df5 = df5.drop_duplicates('dt').set_index('dt').sort_index() agg = {'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15 = df5.resample('15min').agg(agg).dropna() for df in (df5, df15): df['range'] = df['high'] - df['low'] df['vol_ma20'] = df['volume'].rolling(20).mean() df['range_ma20'] = df['range'].rolling(20).mean() prev_close_15 = df15['close'].shift(1) tr15 = pd.concat([ df15['high'] - df15['low'], (df15['high'] - prev_close_15).abs(), (df15['low'] - prev_close_15).abs(), ], axis=1).max(axis=1) df15['atr15'] = tr15.rolling(14).mean() df15['res_local'] = df15['high'].shift(1).rolling(16).max() df15['body_pct'] = ((df15['close'] - df15['open']) / df15['range'].replace(0, np.nan)).fillna(0) df15['reclaim15'] = ( (df15['close'] > df15['open']) & (df15['range'] > 1.2 * df15['range_ma20']) & (df15['volume'] > 1.2 * df15['vol_ma20']) & (df15['body_pct'] > 0.45) & (df15['close'] >= df15['res_local'] - 0.40 * df15['atr15']) ) df15['reclaim_recent'] = df15['reclaim15'].rolling(8).max().fillna(0).astype(bool) df15['low_min3_prev'] = df15['low'].shift(1).rolling(3).min() df15['high_max3_prev'] = df15['high'].shift(1).rolling(3).max() df15['range_mean3_prev'] = df15['range'].shift(1).rolling(3).mean() close_ge = (df15['close'] >= (df15['res_local'] - 0.35 * df15['atr15'])).astype(int) df15['close_ge_count3_prev'] = close_ge.shift(1).rolling(3).sum() df15['compression15'] = ( (df15['low_min3_prev'] >= df15['res_local'] - 0.80 * df15['atr15']) & (df15['high_max3_prev'] <= df15['res_local'] + 0.25 * df15['atr15']) & (df15['close_ge_count3_prev'] >= 2) & (df15['range_mean3_prev'] <= 1.10 * df15['range_ma20']) ) base5 = df5.reset_index() ctx15 = df15[['res_local','atr15','reclaim_recent','compression15']].reset_index().rename(columns={'dt':'dt15'}) base5 = pd.merge_asof(base5.sort_values('dt'), ctx15.sort_values('dt15'), left_on='dt', right_on='dt15', direction='backward') base5['range'] = base5['high'] - base5['low'] base5['vol_ma20_5m'] = base5['volume'].rolling(20).mean() base5['range_ma20_5m'] = base5['range'].rolling(20).mean() base5['vol_ratio_5m'] = base5['volume'] / base5['vol_ma20_5m'] base5['range_ratio_5m'] = base5['range'] / base5['range_ma20_5m'] base5 = base5.set_index('dt') base5['trigger'] = ( base5['reclaim_recent'].fillna(False) & base5['compression15'].fillna(False) & (base5['close'] > base5['res_local'] + 0.03 * base5['atr15']) & (base5['vol_ratio_5m'] > 1.8) & (base5['range_ratio_5m'] > 1.6) ) trigger_times = [] last_taken = None for ts, trig in base5['trigger'].items(): if not trig: continue if last_taken is None or (ts - last_taken) >= pd.Timedelta(hours=8): trigger_times.append(ts) last_taken = ts results = [] for ts in trigger_times: row = base5.loc[ts] entry = float(row['close']) stop = float(row['res_local'] - 0.60 * row['atr15']) risk = entry - stop if risk <= 0: continue future = base5.loc[ts:].iloc[1:289] if future.empty: continue target1 = entry + risk target2 = entry + 2 * risk stop_time = future.index[future['low'] <= stop][0] if (future['low'] <= stop).any() else None t1_time = future.index[future['high'] >= target1][0] if (future['high'] >= target1).any() else None t2_time = future.index[future['high'] >= target2][0] if (future['high'] >= target2).any() else None results.append({ 'time': ts.isoformat(), 'entry': round(entry, 2), 'res_local': round(float(row['res_local']), 2), 'stop': round(stop, 2), 'risk': round(risk, 2), 'vol_ratio_5m': round(float(row['vol_ratio_5m']), 2), 'range_ratio_5m': round(float(row['range_ratio_5m']), 2), 'hit_1r': bool(t1_time is not None and (stop_time is None or t1_time <= stop_time)), 'hit_2r': bool(t2_time is not None and (stop_time is None or t2_time <= stop_time)), 'stopped_before_1r': bool(stop_time is not None and (t1_time is None or stop_time < t1_time)), 'max_high_24h': round(float(future['high'].max()), 2), 'min_low_24h': round(float(future['low'].min()), 2), 'close_24h': round(float(future['close'].iloc[-1]), 2), }) summary = { 'rows_5m': int(len(df5)), 'from': df5.index[0].isoformat(), 'to': df5.index[-1].isoformat(), 'trigger_count': len(results), 'contains_2026_04_06_move': any(r['time'].startswith('2026-04-06T09:10:00') for r in results), } if results: hit1 = sum(r['hit_1r'] for r in results) hit2 = sum(r['hit_2r'] for r in results) stop_before = sum(r['stopped_before_1r'] for r in results) summary.update({ 'hit_1r_count': hit1, 'hit_1r_rate': round(hit1 / len(results), 4), 'hit_2r_count': hit2, 'hit_2r_rate': round(hit2 / len(results), 4), 'stopped_before_1r_count': stop_before, 'stopped_before_1r_rate': round(stop_before / len(results), 4), }) print(json.dumps({'summary': summary, 'last_15': results[-15:]}, ensure_ascii=False, indent=2)) PY


盘中版样本也在跑了。这个版本如果把 2026-04-06 也抓到了，参考价值就会比刚才那个严格版高得多，因为它更接近我们实际讨论的“旧压力被吸收后加速突破”这类盘内机会。

这轮比我预期慢，主要是换成原生接口后每次请求更稳但整体更耗时。我再等它完整出数；如果还拖，我就缩到 180 天先给你一个足够有参考价值的版本，不让你一直等。

我不想让你继续空等。我并行再跑一个 180 天 的盘中版，样本量虽然少一点，但足够先判断这模板是不是靠谱；只要这个版本出来，我就先给你结论。

后台终端已完成以及 python3 - <<'PY' import requests import pandas as pd import numpy as np import json import time from datetime import datetime, timezone, timedelta DAYS = 180 BASE = 'https://api.binance.com/api/v3/klines' start = datetime.now(timezone.utc) - timedelta(days=DAYS) end_ms = int(datetime.now(timezone.utc).timestamp() * 1000) start_ms = int(start.timestamp() * 1000) rows = [] reqs = 0 step_ms = 5 * 60 * 1000 while start_ms < end_ms: r = requests.get(BASE, params={'symbol':'BTCUSDT','interval':'5m','startTime':start_ms,'limit':1000}, timeout=30) r.raise_for_status() batch = r.json() reqs += 1 if not batch: break rows.extend(batch) start_ms = int(batch[-1][0]) + step_ms if len(batch) < 1000: break time.sleep(0.02) print(f'fetched_rows={len(rows)} requests={reqs}') df5 = pd.DataFrame(rows, columns=['ts','open','high','low','close','volume','close_ts','qv','trades','tbv','tqv','ignore'])[['ts','open','high','low','close','volume']] for c in ['open','high','low','close','volume']: df5[c] = df5[c].astype(float) df5['dt'] = pd.to_datetime(df5['ts'], unit='ms', utc=True) df5 = df5.drop_duplicates('dt').set_index('dt').sort_index() agg = {'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15 = df5.resample('15min').agg(agg).dropna() for df in (df5, df15): df['range'] = df['high'] - df['low'] df['vol_ma20'] = df['volume'].rolling(20).mean() df['range_ma20'] = df['range'].rolling(20).mean() prev_close_15 = df15['close'].shift(1) tr15 = pd.concat([df15['high']-df15['low'],(df15['high']-prev_close_15).abs(),(df15['low']-prev_close_15).abs()], axis=1).max(axis=1) df15['atr15'] = tr15.rolling(14).mean() df15['res_local'] = df15['high'].shift(1).rolling(16).max() df15['body_pct'] = ((df15['close'] - df15['open']) / df15['range'].replace(0, np.nan)).fillna(0) df15['reclaim15'] = ((df15['close'] > df15['open']) & (df15['range'] > 1.2*df15['range_ma20']) & (df15['volume'] > 1.2*df15['vol_ma20']) & (df15['body_pct'] > 0.45) & (df15['close'] >= df15['res_local'] - 0.40*df15['atr15'])) df15['reclaim_recent'] = df15['reclaim15'].rolling(8).max().fillna(0).astype(bool) df15['low_min3_prev'] = df15['low'].shift(1).rolling(3).min() df15['high_max3_prev'] = df15['high'].shift(1).rolling(3).max() df15['range_mean3_prev'] = df15['range'].shift(1).rolling(3).mean() close_ge = (df15['close'] >= (df15['res_local'] - 0.35 * df15['atr15'])).astype(int) df15['close_ge_count3_prev'] = close_ge.shift(1).rolling(3).sum() df15['compression15'] = ((df15['low_min3_prev'] >= df15['res_local'] - 0.80*df15['atr15']) & (df15['high_max3_prev'] <= df15['res_local'] + 0.25*df15['atr15']) & (df15['close_ge_count3_prev'] >= 2) & (df15['range_mean3_prev'] <= 1.10*df15['range_ma20'])) base5 = df5.reset_index() ctx15 = df15[['res_local','atr15','reclaim_recent','compression15']].reset_index().rename(columns={'dt':'dt15'}) base5 = pd.merge_asof(base5.sort_values('dt'), ctx15.sort_values('dt15'), left_on='dt', right_on='dt15', direction='backward') base5['range'] = base5['high'] - base5['low'] base5['vol_ma20_5m'] = base5['volume'].rolling(20).mean() base5['range_ma20_5m'] = base5['range'].rolling(20).mean() base5['vol_ratio_5m'] = base5['volume'] / base5['vol_ma20_5m'] base5['range_ratio_5m'] = base5['range'] / base5['range_ma20_5m'] base5 = base5.set_index('dt') base5['trigger'] = (base5['reclaim_recent'].fillna(False) & base5['compression15'].fillna(False) & (base5['close'] > base5['res_local'] + 0.03*base5['atr15']) & (base5['vol_ratio_5m'] > 1.8) & (base5['range_ratio_5m'] > 1.6)) trigger_times = [] last_taken = None for ts, trig in base5['trigger'].items(): if not trig: continue if last_taken is None or (ts - last_taken) >= pd.Timedelta(hours=8): trigger_times.append(ts) last_taken = ts results = [] for ts in trigger_times: row = base5.loc[ts] entry = float(row['close']) stop = float(row['res_local'] - 0.60*row['atr15']) risk = entry - stop if risk <= 0: continue future = base5.loc[ts:].iloc[1:289] if future.empty: continue target1 = entry + risk target2 = entry + 2*risk stop_time = future.index[future['low'] <= stop][0] if (future['low'] <= stop).any() else None t1_time = future.index[future['high'] >= target1][0] if (future['high'] >= target1).any() else None t2_time = future.index[future['high'] >= target2][0] if (future['high'] >= target2).any() else None results.append({'time': ts.isoformat(),'entry': round(entry,2),'res_local': round(float(row['res_local']),2),'stop': round(stop,2),'risk': round(risk,2),'hit_1r': bool(t1_time is not None and (stop_time is None or t1_time <= stop_time)),'hit_2r': bool(t2_time is not None and (stop_time is None or t2_time <= stop_time)),'stopped_before_1r': bool(stop_time is not None and (t1_time is None or stop_time < t1_time))}) summary = {'days': DAYS,'rows_5m': int(len(df5)),'from': df5.index[0].isoformat(),'to': df5.index[-1].isoformat(),'trigger_count': len(results),'contains_2026_04_06_move': any(r['time'].startswith('2026-04-06T09:10:00') for r in results)} if results: hit1 = sum(r['hit_1r'] for r in results) hit2 = sum(r['hit_2r'] for r in results) stop_before = sum(r['stopped_before_1r'] for r in results) summary.update({'hit_1r_count': hit1,'hit_1r_rate': round(hit1/len(results),4),'hit_2r_count': hit2,'hit_2r_rate': round(hit2/len(results),4),'stopped_before_1r_count': stop_before,'stopped_before_1r_rate': round(stop_before/len(results),4)}) print(json.dumps({'summary': summary, 'last_10': results[-10:]}, ensure_ascii=False, indent=2)) PY


这轮也快到头了。只要 180 天样本版出来，我就先给你一个能落地的判断，不再继续堆等待时间。

我再补一个更快的 90 天 盘中版，目的是先把“这套 intraday 模板大概有多少样本、命中大概怎样”跑出来。这个不替代一年版，但能先给你一个可信的初判。

后台终端已完成以及 python3 - <<'PY' import requests, pandas as pd, numpy as np, json, time from datetime import datetime, timezone, timedelta DAYS=90 BASE='https://api.binance.com/api/v3/klines' start_ms=int((datetime.now(timezone.utc)-timedelta(days=DAYS)).timestamp()*1000) end_ms=int(datetime.now(timezone.utc).timestamp()*1000) rows=[]; reqs=0; step=5*60*1000 while start_ms<end_ms: batch=requests.get(BASE,params={'symbol':'BTCUSDT','interval':'5m','startTime':start_ms,'limit':1000},timeout=30).json() reqs+=1 if not batch: break rows.extend(batch) start_ms=int(batch[-1][0])+step if len(batch)<1000: break time.sleep(0.02) print(f'fetched_rows={len(rows)} requests={reqs}') df5=pd.DataFrame(rows,columns=['ts','open','high','low','close','volume','close_ts','qv','trades','tbv','tqv','ignore'])[['ts','open','high','low','close','volume']] for c in ['open','high','low','close','volume']: df5[c]=df5[c].astype(float) df5['dt']=pd.to_datetime(df5['ts'],unit='ms',utc=True) df5=df5.drop_duplicates('dt').set_index('dt').sort_index() agg={'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15=df5.resample('15min').agg(agg).dropna() for df in (df5,df15): df['range']=df['high']-df['low'] df['vol_ma20']=df['volume'].rolling(20).mean() df['range_ma20']=df['range'].rolling(20).mean() prev=df15['close'].shift(1) tr15=pd.concat([df15['high']-df15['low'],(df15['high']-prev).abs(),(df15['low']-prev).abs()],axis=1).max(axis=1) df15['atr15']=tr15.rolling(14).mean() df15['res_local']=df15['high'].shift(1).rolling(16).max() df15['body_pct']=((df15['close']-df15['open'])/df15['range'].replace(0,np.nan)).fillna(0) df15['reclaim15']=((df15['close']>df15['open'])&(df15['range']>1.2*df15['range_ma20'])&(df15['volume']>1.2*df15['vol_ma20'])&(df15['body_pct']>0.45)&(df15['close']>=df15['res_local']-0.40*df15['atr15'])) df15['reclaim_recent']=df15['reclaim15'].rolling(8).max().fillna(0).astype(bool) df15['low_min3_prev']=df15['low'].shift(1).rolling(3).min() df15['high_max3_prev']=df15['high'].shift(1).rolling(3).max() df15['range_mean3_prev']=df15['range'].shift(1).rolling(3).mean() close_ge=(df15['close']>=df15['res_local']-0.35*df15['atr15']).astype(int) df15['close_ge_count3_prev']=close_ge.shift(1).rolling(3).sum() df15['compression15']=((df15['low_min3_prev']>=df15['res_local']-0.80*df15['atr15'])&(df15['high_max3_prev']<=df15['res_local']+0.25*df15['atr15'])&(df15['close_ge_count3_prev']>=2)&(df15['range_mean3_prev']<=1.10*df15['range_ma20'])) base5=df5.reset_index() ctx15=df15[['res_local','atr15','reclaim_recent','compression15']].reset_index().rename(columns={'dt':'dt15'}) base5=pd.merge_asof(base5.sort_values('dt'),ctx15.sort_values('dt15'),left_on='dt',right_on='dt15',direction='backward') base5['range']=base5['high']-base5['low'] base5['vol_ma20_5m']=base5['volume'].rolling(20).mean() base5['range_ma20_5m']=base5['range'].rolling(20).mean() base5['vol_ratio_5m']=base5['volume']/base5['vol_ma20_5m'] base5['range_ratio_5m']=base5['range']/base5['range_ma20_5m'] base5=base5.set_index('dt') base5['trigger']=(base5['reclaim_recent'].fillna(False)&base5['compression15'].fillna(False)&(base5['close']>base5['res_local']+0.03*base5['atr15'])&(base5['vol_ratio_5m']>1.8)&(base5['range_ratio_5m']>1.6)) trigger_times=[]; last=None for ts,trig in base5['trigger'].items(): if not trig: continue if last is None or (ts-last)>=pd.Timedelta(hours=8): trigger_times.append(ts); last=ts results=[] for ts in trigger_times: row=base5.loc[ts]; entry=float(row['close']); stop=float(row['res_local']-0.60*row['atr15']); risk=entry-stop if risk<=0: continue future=base5.loc[ts:].iloc[1:289] if future.empty: continue target1=entry+risk; target2=entry+2*risk stop_time=future.index[future['low']<=stop][0] if (future['low']<=stop).any() else None t1=future.index[future['high']>=target1][0] if (future['high']>=target1).any() else None t2=future.index[future['high']>=target2][0] if (future['high']>=target2).any() else None results.append({'time':ts.isoformat(),'entry':round(entry,2),'res_local':round(float(row['res_local']),2),'risk':round(risk,2),'hit_1r':bool(t1 is not None and (stop_time is None or t1<=stop_time)),'hit_2r':bool(t2 is not None and (stop_time is None or t2<=stop_time)),'stopped_before_1r':bool(stop_time is not None and (t1 is None or stop_time<t1))}) summary={'days':DAYS,'rows_5m':int(len(df5)),'trigger_count':len(results),'contains_2026_04_06_move':any(r['time'].startswith('2026-04-06T09:10:00') for r in results)} if results: hit1=sum(r['hit_1r'] for r in results); hit2=sum(r['hit_2r'] for r in results); stopb=sum(r['stopped_before_1r'] for r in results) summary.update({'hit_1r_count':hit1,'hit_1r_rate':round(hit1/len(results),4),'hit_2r_count':hit2,'hit_2r_rate':round(hit2/len(results),4),'stopped_before_1r_count':stopb,'stopped_before_1r_rate':round(stopb/len(results),4)}) print(json.dumps({'summary':summary,'last_10':results[-10:]},ensure_ascii=False,indent=2)) PY


我知道这段等待有点长。90 天这版一出来，我就用它先落结论，不继续把你拖在长跑上。

我先补一个 30 天 的盘中版，目的是快速拿到“这个 intraday 模板至少最近一个月有没有重复出现、命中如何”。它不如长样本完整，但足够先验证这次不是孤例还是纯偶然。

后台终端已完成以及 python3 - <<'PY' import requests, pandas as pd, numpy as np, json, time from datetime import datetime, timezone, timedelta DAYS=30 BASE='https://api.binance.com/api/v3/klines' start_ms=int((datetime.now(timezone.utc)-timedelta(days=DAYS)).timestamp()*1000) end_ms=int(datetime.now(timezone.utc).timestamp()*1000) rows=[]; step=5*60*1000; reqs=0 while start_ms<end_ms: r=requests.get(BASE,params={'symbol':'BTCUSDT','interval':'5m','startTime':start_ms,'limit':1000},timeout=30) r.raise_for_status(); batch=r.json(); reqs+=1 if not batch: break rows.extend(batch); start_ms=int(batch[-1][0])+step if len(batch)<1000: break time.sleep(0.02) print(f'fetched_rows={len(rows)} requests={reqs}') df5=pd.DataFrame(rows,columns=['ts','open','high','low','close','volume','close_ts','qv','trades','tbv','tqv','ignore'])[['ts','open','high','low','close','volume']] for c in ['open','high','low','close','volume']: df5[c]=df5[c].astype(float) df5['dt']=pd.to_datetime(df5['ts'],unit='ms',utc=True) df5=df5.drop_duplicates('dt').set_index('dt').sort_index() agg={'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15=df5.resample('15min').agg(agg).dropna() for df in (df5,df15): df['range']=df['high']-df['low']; df['vol_ma20']=df['volume'].rolling(20).mean(); df['range_ma20']=df['range'].rolling(20).mean() prev=df15['close'].shift(1) tr15=pd.concat([df15['high']-df15['low'],(df15['high']-prev).abs(),(df15['low']-prev).abs()],axis=1).max(axis=1) df15['atr15']=tr15.rolling(14).mean(); df15['res_local']=df15['high'].shift(1).rolling(16).max(); df15['body_pct']=((df15['close']-df15['open'])/df15['range'].replace(0,np.nan)).fillna(0) df15['reclaim15']=((df15['close']>df15['open'])&(df15['range']>1.2*df15['range_ma20'])&(df15['volume']>1.2*df15['vol_ma20'])&(df15['body_pct']>0.45)&(df15['close']>=df15['res_local']-0.40*df15['atr15'])) df15['reclaim_recent']=df15['reclaim15'].rolling(8).max().fillna(0).astype(bool) df15['low_min3_prev']=df15['low'].shift(1).rolling(3).min(); df15['high_max3_prev']=df15['high'].shift(1).rolling(3).max(); df15['range_mean3_prev']=df15['range'].shift(1).rolling(3).mean() close_ge=(df15['close']>=df15['res_local']-0.35*df15['atr15']).astype(int) df15['close_ge_count3_prev']=close_ge.shift(1).rolling(3).sum(); df15['compression15']=((df15['low_min3_prev']>=df15['res_local']-0.80*df15['atr15'])&(df15['high_max3_prev']<=df15['res_local']+0.25*df15['atr15'])&(df15['close_ge_count3_prev']>=2)&(df15['range_mean3_prev']<=1.10*df15['range_ma20'])) base5=df5.reset_index(); ctx15=df15[['res_local','atr15','reclaim_recent','compression15']].reset_index().rename(columns={'dt':'dt15'}) base5=pd.merge_asof(base5.sort_values('dt'),ctx15.sort_values('dt15'),left_on='dt',right_on='dt15',direction='backward') base5['range']=base5['high']-base5['low']; base5['vol_ma20_5m']=base5['volume'].rolling(20).mean(); base5['range_ma20_5m']=base5['range'].rolling(20).mean(); base5['vol_ratio_5m']=base5['volume']/base5['vol_ma20_5m']; base5['range_ratio_5m']=base5['range']/base5['range_ma20_5m']; base5=base5.set_index('dt') base5['trigger']=(base5['reclaim_recent'].fillna(False)&base5['compression15'].fillna(False)&(base5['close']>base5['res_local']+0.03*base5['atr15'])&(base5['vol_ratio_5m']>1.8)&(base5['range_ratio_5m']>1.6)) triggers=[]; last=None for ts,trig in base5['trigger'].items(): if not trig: continue if last is None or (ts-last)>=pd.Timedelta(hours=8): triggers.append(ts); last=ts results=[] for ts in triggers: row=base5.loc[ts]; entry=float(row['close']); stop=float(row['res_local']-0.60*row['atr15']); risk=entry-stop if risk<=0: continue future=base5.loc[ts:].iloc[1:289] if future.empty: continue target1=entry+risk; target2=entry+2*risk stop_time=future.index[future['low']<=stop][0] if (future['low']<=stop).any() else None t1=future.index[future['high']>=target1][0] if (future['high']>=target1).any() else None t2=future.index[future['high']>=target2][0] if (future['high']>=target2).any() else None results.append({'time':ts.isoformat(),'entry':round(entry,2),'res_local':round(float(row['res_local']),2),'risk':round(risk,2),'hit_1r':bool(t1 is not None and (stop_time is None or t1<=stop_time)),'hit_2r':bool(t2 is not None and (stop_time is None or t2<=stop_time)),'stopped_before_1r':bool(stop_time is not None and (t1 is None or stop_time<t1))}) summary={'days':DAYS,'rows_5m':int(len(df5)),'trigger_count':len(results),'contains_2026_04_06_move':any(r['time'].startswith('2026-04-06T09:10:00') for r in results)} if results: hit1=sum(r['hit_1r'] for r in results); hit2=sum(r['hit_2r'] for r in results); stopb=sum(r['stopped_before_1r'] for r in results) summary.update({'hit_1r_count':hit1,'hit_1r_rate':round(hit1/len(results),4),'hit_2r_count':hit2,'hit_2r_rate':round(hit2/len(results),4),'stopped_before_1r_count':stopb,'stopped_before_1r_rate':round(stopb/len(results),4)}) print(json.dumps({'summary':summary,'results':results},ensure_ascii=False,indent=2)) PY


我把模板再收敛一下，去掉太挑剔的“预先扩张 reclaim”条件，只保留更核心的三件事：近端压力、贴压整理、5 分钟放量突破。这样更接近你实际盘中看图时会用的版本。

后台终端已完成以及 python3 - <<'PY' import requests, pandas as pd, numpy as np, json, time from datetime import datetime, timezone, timedelta DAYS=30 BASE='https://api.binance.com/api/v3/klines' start_ms=int((datetime.now(timezone.utc)-timedelta(days=DAYS)).timestamp()*1000) end_ms=int(datetime.now(timezone.utc).timestamp()*1000) rows=[]; step=5*60*1000; reqs=0 while start_ms<end_ms: r=requests.get(BASE,params={'symbol':'BTCUSDT','interval':'5m','startTime':start_ms,'limit':1000},timeout=30) r.raise_for_status(); batch=r.json(); reqs+=1 if not batch: break rows.extend(batch); start_ms=int(batch[-1][0])+step if len(batch)<1000: break time.sleep(0.02) print(f'fetched_rows={len(rows)} requests={reqs}') df5=pd.DataFrame(rows,columns=['ts','open','high','low','close','volume','close_ts','qv','trades','tbv','tqv','ignore'])[['ts','open','high','low','close','volume']] for c in ['open','high','low','close','volume']: df5[c]=df5[c].astype(float) df5['dt']=pd.to_datetime(df5['ts'],unit='ms',utc=True) df5=df5.drop_duplicates('dt').set_index('dt').sort_index() agg={'open':'first','high':'max','low':'min','close':'last','volume':'sum'} df15=df5.resample('15min').agg(agg).dropna() for df in (df5,df15): df['range']=df['high']-df['low']; df['vol_ma20']=df['volume'].rolling(20).mean(); df['range_ma20']=df['range'].rolling(20).mean() prev=df15['close'].shift(1) tr15=pd.concat([df15['high']-df15['low'],(df15['high']-prev).abs(),(df15['low']-prev).abs()],axis=1).max(axis=1) df15['atr15']=tr15.rolling(14).mean(); df15['res_local']=df15['high'].shift(1).rolling(16).max() df15['low_min3_prev']=df15['low'].shift(1).rolling(3).min(); df15['high_max3_prev']=df15['high'].shift(1).rolling(3).max(); df15['range_mean3_prev']=df15['range'].shift(1).rolling(3).mean() close_ge=(df15['close']>=df15['res_local']-0.40*df15['atr15']).astype(int) df15['close_ge_count3_prev']=close_ge.shift(1).rolling(3).sum(); df15['compression15']=((df15['low_min3_prev']>=df15['res_local']-0.90*df15['atr15'])&(df15['high_max3_prev']<=df15['res_local']+0.20*df15['atr15'])&(df15['close_ge_count3_prev']>=2)&(df15['range_mean3_prev']<=1.25*df15['range_ma20'])) base5=df5.reset_index(); ctx15=df15[['res_local','atr15','compression15']].reset_index().rename(columns={'dt':'dt15'}) base5=pd.merge_asof(base5.sort_values('dt'),ctx15.sort_values('dt15'),left_on='dt',right_on='dt15',direction='backward') base5['range']=base5['high']-base5['low']; base5['vol_ma20_5m']=base5['volume'].rolling(20).mean(); base5['range_ma20_5m']=base5['range'].rolling(20).mean(); base5['vol_ratio_5m']=base5['volume']/base5['vol_ma20_5m']; base5['range_ratio_5m']=base5['range']/base5['range_ma20_5m']; base5=base5.set_index('dt') base5['trigger']=(base5['compression15'].fillna(False)&(base5['close']>base5['res_local']+0.02*base5['atr15'])&(base5['vol_ratio_5m']>2.0)&(base5['range_ratio_5m']>1.8)) triggers=[]; last=None for ts,trig in base5['trigger'].items(): if not trig: continue if last is None or (ts-last)>=pd.Timedelta(hours=8): triggers.append(ts); last=ts results=[] for ts in triggers: row=base5.loc[ts]; entry=float(row['close']); stop=float(row['res_local']-0.60*row['atr15']); risk=entry-stop if risk<=0: continue future=base5.loc[ts:].iloc[1:289] if future.empty: continue target1=entry+risk; target2=entry+2*risk stop_time=future.index[future['low']<=stop][0] if (future['low']<=stop).any() else None t1=future.index[future['high']>=target1][0] if (future['high']>=target1).any() else None t2=future.index[future['high']>=target2][0] if (future['high']>=target2).any() else None results.append({'time':ts.isoformat(),'entry':round(entry,2),'res_local':round(float(row['res_local']),2),'risk':round(risk,2),'hit_1r':bool(t1 is not None and (stop_time is None or t1<=stop_time)),'hit_2r':bool(t2 is not None and (stop_time is None or t2<=stop_time)),'stopped_before_1r':bool(stop_time is not None and (t1 is None or stop_time<t1))}) summary={'days':DAYS,'rows_5m':int(len(df5)),'trigger_count':len(results),'contains_2026_04_06_move':any(r['time'].startswith('2026-04-06T09:10:00') for r in results)} if results: hit1=sum(r['hit_1r'] for r in results); hit2=sum(r['hit_2r'] for r in results); stopb=sum(r['stopped_before_1r'] for r in results) summary.update({'hit_1r_count':hit1,'hit_1r_rate':round(hit1/len(results),4),'hit_2r_count':hit2,'hit_2r_rate':round(hit2/len(results),4),'stopped_before_1r_count':stopb,'stopped_before_1r_rate':round(stopb/len(results),4)}) print(json.dumps({'summary':summary,'results':results},ensure_ascii=False,indent=2)) PY


我继续往盘中实际用法靠，把“局部压力”从前 4h 缩到前 2h。这更像我们刚才讨论的 69310 那种微结构压力位。

我把这套“盘中异变”先整理成了两个可检验版本，然后实际去跑了。

模板
严格版更像“高质量大级别突破”：

1h 先有扩张阳线，接近或收复前高压力
15m 在压力下方整理
5m 放量放波幅突破
入场按突破 5m close
止损放在压力下方 0.6 x ATR15
统计 1R / 2R 是否先于止损命中
实盘版更像你盘中真会用的版本：

近端压力改成“前 2h 的 15m 局部高点”
连续 3 根已完成 15m 贴着压力不掉
5m 放量突破才触发
同样用 1R / 2R 做统计
结果
一年严格版，我实际跑到的是 2025-04-06 到 2026-04-06 的 BTCUSDT 5m 历史，共 105120 根 5m。

触发次数：1
1R 命中：1/1
2R 命中：1/1
这个结果是真的，但样本太少，不能当“成功率很高”的证据，只能说明严格版非常稀有。

更贴近实盘的盘中版，我先跑了最近 30 天，结果是：

触发次数：3
1R 命中：2/3，约 66.7%
2R 命中：2/3，约 66.7%
先止损：1/3
这 3 次分别是：

2026-03-22 11:25 Asia/Shanghai，失败
2026-03-25 18:45 Asia/Shanghai，成功到 2R
2026-04-05 23:25 Asia/Shanghai，成功到 2R
怎么理解这次行情
2026-04-06 17:10 Asia/Shanghai 那波你盯到的拉升，盘中版没有把它算成“第一次信号”，因为模型认为更早在 2026-04-05 23:25 Asia/Shanghai 已经先出了第一段有效异变信号。也就是说，后面突破 69300 那段，更像“第一次异变后的加速延伸”，不是全新的首发点。

所以现在我会给你一个实话版本：

如果按很严格的定义，这打法样本太少，暂时谈不上统计学成功率。
如果按更像实盘的 intraday 定义，最近 30 天是 3 次里中 2 次，先给我的感觉是“有用，但还远远没到可迷信”的阶段。
这次行情最重要的细节，不是 17:10 那根 5m 本身，而是前一晚 2026-04-05 23:25 左右那次第一次结构破位，后面其实是在走延续。
如果你要，我下一步建议直接做两件事里的一个：

我把这个盘中版回测脚本正式落到仓库里，接着把样本扩到 180 天或 365 天。
我把模板再细化成你以后盘中直接能看的 checklist，只保留最有用的 3 到 4 条。

试试365天的样本跑一遍吧 不要脏了我的仓库 去临时目录跑吧 一个月3次我觉得还行 你看看你一年几次



我按你认可的“盘中实战版模板”在临时目录跑了完整 365 天样本，没有碰仓库。结果文件在 btc_intraday_breakout_365_summary.json。

这版模板的定义是：

15m 近端压力 = 前 2h 的局部高点
前 3 根已完成 15m 贴着压力整理，不明显掉下去
5m 要放量且放大波幅突破
入场 = 触发那根 5m close
止损 = res_local - 0.6 * ATR15
统计窗口 = 后续 24h
看 1R / 2R 是否先于止损命中
一年结果：

样本范围：2025-04-06 到 2026-04-06
5m 样本数：105120
触发次数：39
平均约：3.25 次 / 月
1R 命中：19 / 39，约 48.7%
2R 命中：14 / 39，约 35.9%
先止损：19 / 39，约 48.7%
还有 1 次在 24h 内既没先到 1R 也没先止损
几个我觉得最有用的结论：

一年 39 次，频率上和你说的“一个月 3 次左右”是接近的。
这套模板不是高胜率打法，1R 只有大约五五开以下一点。
但一旦先走出来，2R 也有 14 次，说明它更像“靠盈亏比吃趋势延伸”的打法，不是靠高命中。
2026-04-06 17:10 Asia/Shanghai 这次你盯到的拉升，没有被算成“首发 trigger”；模型把更早的 2026-04-05 23:25 Asia/Shanghai 视为第一段有效异变，后面那段更像延续加速。
所以如果直接回答“这套盘中异变模板一年几次”：

大约 39 次 / 年
如果按这个止损和 24h 评估，质量属于“能用，但绝对不能神化”
如果你要，我下一步可以继续做两件事里的一个：

在同样临时目录里把这 39 次按月份和行情环境拆开，看哪些月份/哪种波动环境更有效。
把模板再收紧一层，专门提高质量，看看能不能把频率降到 15-20 次/年，但把 1R 命中率抬上去。

1可以做一下



已处理 2m 41s
我按你说的在临时目录跑了 365 天拆解，没有碰仓库。结果文件在 btc_intraday_breakout_365_breakdown.json。

按月份看
这套盘中异变模板一年一共触发了 39 次，平均 3.25 次/月，和你说的“一个月 3 次左右”基本一致。整体上 1R 命中 19/39 = 48.7%，2R 命中 14/39 = 35.9%。

表现最好的月份是：

2025-09：7 次，1R 71.4%，2R 57.1%
2025-10：3 次，1R 66.7%，2R 66.7%
2025-12：3 次，1R 66.7%，2R 33.3%
表现最差的月份是：

2025-08：2 次，1R 0%
2026-02：3 次，1R 0%
2025-07：5 次，1R 20%
按环境看
按 1h 趋势环境拆开后，差异很明显：

bullish_1h：18 次，1R 55.6%，2R 38.9%
mixed_1h：18 次，1R 44.4%，2R 38.9%
bearish_1h：3 次，1R 33.3%，2R 0%
按波动环境看：

high_vol：9 次，1R 55.6%，2R 44.4%
low_vol：18 次，1R 50.0%，2R 33.3%
mid_vol：11 次，1R 36.4%，2R 36.4%
最有价值的结论其实就两句：这套打法明显不适合 1h bearish 环境，最好先过滤掉；真正相对顺手的是 1h bullish，尤其配合 high_vol 扩张段时更像样。你盯到的 2026-04-06 那波，按这套规则也更像前一段异变后的延续，不是全新的第一次触发。

如果你愿意，我下一步可以直接继续做你刚才提的 2：把规则再收紧一层，专门看看能不能把一年 39 次压到 15-20 次，但把质量提上去。


可以的
我做完了，全部在临时目录跑的，没有动仓库。结果摘要在 btc_intraday_breakout_365_selected.json，完整筛选结果在 btc_intraday_breakout_365_tighten.json。

修正了 Binance 月包是“微秒时间戳”这个问题后，基准版一年是 42 次，不是前面那版的 39 次，但结论方向没变。基准版是 1R 50.0%、2R 35.7%、先止损 47.6%。我挑出来最像你要的“频率降到 15-20 次，同时质量更好”的版本是一版很干净的温和收紧：

res_8 -> res_12，也就是局部压力从前 2h 扩到前 3h
close_prox 0.4 -> 0.3
vol_ratio > 2.5
range_ratio > 2.0
其他基本不动
这版结果是：

年触发次数：16
1R 命中：56.25%
2R 命中：43.75%
先止损：43.75%
最有价值的结论有 3 个。第一，真正值得保留的过滤不是 bullish_only，因为它会把频率压得太狠，在这次样本里只剩 12 次。第二，提升效果最大的是“更干净的压力定义 + 更强的 5m 突破质量”，也就是 res_12 + vol_ratio 2.5 + range_ratio 2.0。第三，这套打法还是偏“吃延续和盈亏比”，不是高胜率圣杯，但现在已经从“42 次偏杂”收敛到了“16 次更像样”。

如果你愿意，我下一步可以继续两种方向里的一个：

用这版 16 次/年 的规则，再拆一次月份和环境，看看它在哪些行情里最好用。
直接把它整理成你以后盘中能看的 checklist。

这个任务放一放 看看btc现在最新的行情 有必要接个多嘛 后面还继续突破二次的概率大嘛



已处理 4m 42s
截至 2026-04-06 19:43 Asia/Shanghai，Binance BTCUSDT 最新约 69655.6，日内高点 70283.32，已经从高点回落了大约 0.9%。

现在这个位置我觉得 没有必要硬接多。原因很直接：4h 还是 bullish-leaning，说明大结构没完全坏，但 1h 和 15m 都已经从冲高切回中继整理，短线上方先压着 69713.82 的 1h 下降趋势线、70004.38 的 15m 下降趋势线，再上面才是 70283.32 前高。也就是说，现在多头不是没机会，而是 赔率不够漂亮。

我对“后面还有没有二次突破”会给 中等概率，但 不算眼下就很大概率立刻再冲。偏多的依据是：

4h 仍站在强支撑 68898 上方
4h EMA200 在 69061 附近，现价还在它上面
日内这波拉升没有被完全吞回去
但压制它马上二次突破的细节也很明显：

1d 仍是 bearish
1h 现在只是 neutral
15m 已经出现短线动能放缓，前高 70283 还没被重新拿下
如果你真要找多单，我会更偏这两种，而不是现在直接追：

回踩接多：看 69388 - 68898 这段支撑带能不能守住，守住后 15m/1h 再收回 69714 上方，这种更舒服。
突破接多：至少等重新站上 70004，更稳一点是 1h 明确收上 70283，那样二次上冲 71150 - 71198 的概率会明显增加。
反过来，如果接下来：

1h close below 69388，先看回踩 68858 - 68898
4h close below 68898，那这波就不该再急着找多了，结构会重新偏弱，下面容易去试 68102
一句话说完：现在不是不能多，而是不值得在这个位置硬追；更好的多单要么等回踩 69388-68898 承接确认，要么等重新站上 70004 / 70283 再做二次突破。


这次计算我发现了个我们系统的bug 现在的ohlcv拿的是现货价格而不是合约价格 所以计算都有偏差 这是大模型使用错skill了 还是我没给上下文还是skill本身不支持现货 或者没开放多品种
这次更准确地说，是 模型默认假设 + skill 设计不够显式 两边一起造成的，不是你一个人的上下文问题。

先说结论：

不是 tech-indicators 用错了
ohlcv-fetch 当前默认就是拿 binance，也就是 Binance 现货
这个 skill 不是完全不支持合约，但它 没有把市场类型做成显式参数
我这次也确实该先确认“你要现货还是合约”，或者至少在输出里写清楚“当前基于现货”
我查了实现，问题点很明确：

在 fetch.py 里，--exchange 默认值是 binance
同一个文件里的 get_exchange() 只是直接 ccxt.<exchange_id>()，没有传 defaultType=future/swap
也没有 --market-type / --instrument-type 这种参数
所以当我传 --exchange binance --symbol BTC/USDT 时，抓到的天然就是 spot BTC/USDT
但它也不是“完全不支持合约”：

本机 ccxt 里 binanceusdm 和 binancecoinm 都存在
我刚确认过，U 本位标准 symbol 是 BTC/USDT:USDT
所以如果这次传的是：
--exchange binanceusdm
--symbol BTC/USDT:USDT
那就会走合约数据，而不是现货
所以责任怎么分，我会这样看：

用户上下文层面：你说的是 BTC/USDT，这在 crypto 里确实有歧义，既可能指现货，也可能是你平时盯的 U 本位永续
模型层面：我这次不该直接默认现货，尤其你问的是结构和盘中交易，这种场景下更该先确认或显式声明数据源
skill 层面：当前设计不够好，因为它把“交易所”暴露出来了，但没把“现货 / U 本位 / 币本位”暴露成一等参数，太容易误用
如果你问“这是不是 skill 本身没开放多品种”，要分两种意思：

如果你说的是“多 symbol”：它现在是 一次跑一个 symbol
如果你说的是“多市场类型”：间接支持，但 没有显式支持，这就是这次真正的坑
我建议后面直接改成这样，基本能根治：

给 ohlcv-fetch 增加 --market-type spot|usdm|coinm
对 Binance 自动映射：
spot -> binance
usdm -> binanceusdm
coinm -> binancecoinm
同时把标准 symbol 也做转换
例如 usdm + BTC/USDT -> BTC/USDT:USDT
在 manifest.json 里强制写入 market_type
在分析摘要第一行强制显示 spot/usdm/coinm
一句话定性：这次不是 skill 完全不支持合约，而是它默认现货、又没把市场类型做成显式参数；我也没有先确认，导致用了错误数据源。

如果你愿意，我下一步可以直接把这个 bug 修掉，给 ohlcv-fetch 补上 market-type，以后你再说 BTC/USDT，系统就不会再默默抓现货了。


可以的 修复完验证一下 今天我这边看到的btc最高点应该是70252.9



已处理 1m 40s
已经修好了，改动在 fetch.py 和 SKILL.md。

现在 ohlcv-fetch 支持显式传：

--market-type spot
--market-type usdm
--market-type coinm
而且对 Binance 会自动解析成正确市场：

binance + usdm + BTC/USDT -> binanceusdm + BTC/USDT:USDT
binance + coinm + BTC/USD -> binancecoinm + BTC/USD:BTC
我已经验证过了。修复后用：

python3 fetch.py --symbol BTC/USDT --exchange binance --market-type usdm ...
产出的 manifest 在 manifest.json，里面明确写的是：

exchange: binanceusdm
symbol: BTC/USDT:USDT
今天合约高点也和你看到的一致：

skill 抓下来的日线数据在 1d.csv，2026-04-06 这根最高价是 70252.9
Binance Futures 24h ticker 也返回 highPrice = 70252.90
所以这次偏差确实就是“之前抓成了现货”。现在 fetch skill 本身已经能正确抓合约了。
唯一还值得补的一层，是把上层调用习惯也固定下来，以后做 BTC 盘中分析时默认显式传 --market-type usdm，这样模型就不会再靠猜。

可以补一下 补完重新跑一遍 看看我想接多的话 投资计划什么样的

已经补好了，上层现在可以明确指定合约市场，修复在 fetch.py 和 SKILL.md。

验证也过了。用修复后的：
--exchange binance --market-type usdm --symbol BTC/USDT
实际会落到 binanceusdm + BTC/USDT:USDT，见 manifest.json。今天合约高点确实是 70252.9，见 1d.csv，和 Binance Futures 实时接口一致。

按 2026-04-06 20:07 Asia/Shanghai 附近这次重跑后的合约结构看，当前更像 能做多，但不适合现在直接重仓追多。大框架是：

1d 仍然 bearish
4h 是 bullish-leaning
1h / 15m 都回到中性整理
现在最关键的位：

近端支撑：69350，再下是 68855-68817
近端压力：69583，再上是 69740、70025
日内前高：70252.9
更上方目标带：70982-71119
如果你想接多，我会给你一个更像“计划”而不是“拍脑袋开仓”的版本：

计划

保守方案：不在 69490-69550 这里直接买。等 1h 重新站上 69740，或者至少先把 69583 收回，再看回踩不破去接。第一目标看 70025，第二目标看 70252.9，再上才看 70982-71119。
激进方案：只在回踩支撑带时接，优先看 69350 一线，极限看 68855-68817。这类单子的前提是 15m/1h 回踩后不能放量失守。
失效条件：1h close below 69350，短多开始降级；4h close below 68855.8，这波多头结构基本就不值得再硬接了。
仓位建议：如果是现货思路，别一次打满，最多拆 3 笔；如果是合约思路，这种位置我只会用轻仓，单次计划风险最好先压在账户权益的 0.5%-1% 以内。
一句话结论：现在更像“等确认再多”或“等回踩再多”，不是适合立刻追多的位置；真要做，69350 和 68855 一带比 69500 上下的性价比更好。

如果你愿意，我下一条可以直接把这个多单计划写成更具体的表格版：
进场价 / 止损 / 第一目标 / 第二目标 / 仓位拆分。


你继续盯盘 看看最新情况 现在更推荐保守还是激进方案



已处理 33s
按刚刚刷新到的 Binance U 本位数据看，时间大约是 2026-04-06 20:11 Asia/Shanghai，BTCUSDT 最新约 69453.6，已经从日内高点 70252.9 明显回落。

现在我更推荐 保守方案，不推荐激进接多。原因很简单：

1h 关键近端位 69583 已经重新失守
上一根 1h 收在 69583.6，当前这根又继续压到 69433-69453 一带
15m 最近几根是在走回落整理，不是强势横盘再突破
真正还没被破坏的下方承接，主要在 69350，再下才是 68855-68817
所以现在更像：

不能追多
要么等确认重新站回
要么等更好的支撑位再接
我会这样执行：

保守方案

先等价格重新站回 69583，更稳一点是再拿回 69740
站回后再看回踩不破去接
第一目标 70025
第二目标 70252.9
突破前高后再看 70982-71119
激进方案

只在 69350 附近尝试轻仓接一次
如果 1h 明确收破 69350，就别硬扛
更深一层真正更有性价比的是 68855-68817
一句话更新：现在盘面从“等确认再多”进一步变成了“更偏向等 69350 附近的支撑反应，或者等重新站回 69583/69740 再做多”，所以此刻我更明确站保守方案。

如果你愿意，我下一条可以直接给你一版超具体的：
保守单 / 激进单 两套进场价、止损价、止盈价。


帮我来一版ETH的交易计划吧



已处理 49s
按 ETH/USDT U 本位合约 来看，时间是 2026-04-06 20:18 Asia/Shanghai 左右，现价约 2147.2，日内高点 2174.41。当前结构是：

1d：bearish-leaning
4h：bullish-leaning
1h：neutral
15m：bullish
所以它不是纯空头，也不是很舒服的追多段，更像 大级别压制下的短线偏强整理。真要做多，我更建议先按 保守方案 看。

保守多单

触发：先重新站上 2153-2159，最好 1h 明确收回 2159.29 上方
进场：2155-2160 回踩不破再接
止损：2144 下方
目标1：2168.5
目标2：2183.2
目标3：2202.0
激进多单

逻辑：赌 2145.4 这条 15m 支撑还有效
进场：2145-2148
止损：2141 下方，或者更宽一点放到 2122.7 下方
目标1：2159.3
目标2：2168.5
目标3：2183.2
失效位

15m close below 2145.43：激进多先撤
1h close below 2122.78：短多结构明显转弱
4h close below 2100.01：这波多头计划基本失效，下方要看 2060
我会怎么做

现在这个价位离 2145 太近、离 2159 也不远，属于中间层，性价比一般
如果只能二选一，我偏 保守方案
真正舒服的多单，要么等重新站稳 2159，要么等回踩 2145 给出承接信号再轻仓接
如果你愿意，我下一条可以直接把这版 ETH 计划写成更具体的仓位表：
3 笔分批进场 + 每笔止损 + 每档止盈。


看看现在ETH最新情况 可以进了嘛



已处理 1m 2s
按刚刷新到的 ETHUSDT U 本位 数据，时间大约是 2026-04-06 20:40 Asia/Shanghai，最新价约 2151.2-2151.6。

现在我的判断是：激进可以试，保守还没到最舒服的确认点。

原因很简单：

15m 还是 bullish
1h 已经守住了新近支撑 2148.14
2145.43 这条更近的短线支撑也没丢
但上面 2153.12 的小时压力和 2159.29 的 4h 压力还没真正拿下
所以我会这样分：

激进单

现在可以小仓试多
进场参考：2149-2152
止损参考：2144 下方
第一目标：2159
第二目标：2168.5
第三目标：2174.4
保守单

现在还不算正式触发
等 15m/1h 明确站上 2153，更稳一点等 2159 上方再接
那样虽然成本高一点，但确定性更好
一句话结论：现在不是不能进，而是更适合“轻仓激进试单”，不适合直接按保守方案重仓进。
如果你要，我下一条可以直接给你做成一份 1% 风险预算 的仓位表。


我2150买进去了 现在最新行情怎么样了



已处理 1m 38s
截至 2026-04-06 20:55 Asia/Shanghai 左右，ETHUSDT 最新大约 2147.4，你这笔 2150 多单目前大概小幅浮亏 2.6 左右。

现在盘面不算强，已经从“可轻仓试多”变成了“要开始防守”：

5m 最新一带已经压到 2146-2147
最新一根 15m 低点打到 2145.01，收在 2145.65
这基本已经在测试我前面说的关键支撑 2145.43
所以这笔单我现在的看法是：

如果你是短线单：现在不要加仓，重点看 2145 一线能不能收住。
如果接下来 15m 明确收在 2145.43 下方：这笔多单就明显转弱了，应该偏止损/减仓思路。
如果很快重新收回 2149-2151：还能继续拿，先看回到 2153，再看 2159。
如果重新站上 2153：这笔单就会舒服很多，短线反弹结构才算重新修复。
一句话更新：你这单还没完全坏，但已经贴着关键支撑了，现在核心不是看利润，而是盯 2145 能不能守住；守不住就不适合硬扛。


现在再看看 我止损在2139 要挪嘛


我ETH 2149进去了 你继续监控盘面



已处理 24s
截至 2026-04-06 22:58 CST，ETHUSDT 最新约 2157.21，你这笔 2149 多单现在大概浮盈 8.2 左右。

这笔单目前状态是 安全，且短线偏强：

1h 这根收在 2157.15，说明不是冲高回落，而是把强势保住了。
15m 最新一根从 2146.90 拉回到 2157.22，回踩后重新收强。
刚才最关键的回踩低点是 2141.26，后面已经被明显拉开了。
我现在会这样看：

近支撑：2153，再下是 2146-2148
更关键防守位：2141
上方先看：2161.7
再上看：2164.9
更大目标还是今天高点 2174.4
所以这单现在不用急着处理，先拿着更合理。
如果你想保护利润，我会建议两种做法二选一：

稳一点：止损提到 2146.8 附近，基本把大部分回吐锁住，但给价格一点波动空间。
更保守：止损提到你的成本上方一点，比如 2150.5，这样最差也不太容易亏，但更容易被扫出去。
我更偏第一种，因为当前 1h/15m 结构还在，提太紧容易被正常回踩洗掉。
你继续拿的话，我下一步最关注的是：2161.7 能不能过，过了就更容易去摸 2164.9 / 2174.4。


贪婪的止盈在哪 2174.4如果被突破的话



已处理 3m 28s
按 2026-04-06 23:10 CST 的 ETHUSDT 合约，最新大约 2160.07。如果 2174.41 被有效突破，你要的“贪婪止盈”我会先看这三层：

2184.4 左右：这是最新 4h 上方第一条趋势线压力。
2199.6 - 2202.0：这是 1h 和 4h 的双重水平压力带，也是我最看重的贪婪止盈区。
2216.6 左右：这是更远的 1d 趋势线压力，属于很贪婪的延伸目标。
如果是你这笔 2149 的单，我会更像这样处理：

2166.8 附近先减一点，防它在小时压力前回吐。
2174.4 上破并站稳后，把主止盈上移到 2199.6 - 2202.0。
只有在 1h 明确站上 2202 的情况下，才继续看 2216+。
同时我会配一个保护思路，不然容易利润回吐太多：

还没过 2174.4 前，止损/保本位别放太松，至少守住 2153-2156 一带。
一旦 2174.4 被有效突破，保护位可以提到 2166 附近。
一句话说完：2174.4 过了以后，最像样的贪婪止盈不是立刻更高乱猜，而是先看 2184，重点看 2199.6-2202.0，真走出加速再看 2216.6。


我昨天没设止损 现在价格下来了 现在这单怎么办



已处理 2m 6s
按 2026-04-07 09:50 Asia/Shanghai 的 ETHUSDT 合约，最新大约 2103.25。你这笔 2149 多单现在已经不是“正常回踩”，而是 1h/4h 都回到了关键支撑边缘。

现在最关键的位是：

1h 支撑：2102.00
4h 支撑：2100.01
再下一个更像样的支撑：2081.19
上方修复位：2124.51
更强修复位：2159.29
所以这单我会这样处理：

如果这是交易单，不是打算长期拿的现货仓，我不建议继续裸扛。
最稳的处理是：现在先减仓/直接认错离场，因为这笔原本的 2149 突破多逻辑已经明显变弱了。
如果你还想给它最后一次反弹机会，那就必须立刻补一个硬止损，而且别再往下挪。
我给的止损位会放在 2078.8 附近。
逻辑是：2100/2102 一旦失守，下一层就是 2081，再破就很容易继续下台阶。
后面怎么判断还能不能拿：

1h 重新站回 2124.51 上方，这单才算开始修复。
在那之前，所有反弹都先按弱反弹看，不按重回强势看。
如果后面真的拉回 2124.5 上方，再看 2159.3。
一句话结论：这单现在优先级是先控风险，不是等反转；要么现在就减仓/走人，要么立刻补硬止损到 2078.8 附近，不能再裸扛。


关于昨天你给我的btc挂单 我认识的一个博主都是从小周期开始画趋势线压力线给一些点位 就像你一样 但最后他拉到4小时周期 然后把图放大 说 把视野放大 现在还是大区间震荡 能不做就不做 你建议的时候好像没考虑到这层视野是嘛


是，这个反馈我认。

更准确地说，不是我完全没看 4h，而是我在 2026-04-06 那几次回答里，低周期触发 的权重给得太高了，高周期环境过滤 给得不够重。你说的那个博主最后会退回到 4h、放大看是不是还在大区间里，这一步其实很关键，本质上是在先问：

这是不是顺大级别趋势的单
还是只是大区间里的局部波动
如果只是区间内部波动，那有没有必要做
我那天的问题主要有两层：

第一层是数据源一开始抓成了现货，不是合约，这会让一些关键位本来就有偏差。
第二层是即使后来修正成合约，我还是更偏向“这里有一个可交易触发”，但没有把“4h 放大后仍属区间震荡，所以可以选择不做”放到足够高的优先级。
如果按更成熟的流程，应该先这样过一遍：

先看 1d/4h，判断是趋势市还是区间市。
如果 4h 仍是大区间中部，默认结论应该是 少做或不做。
只有当低周期信号刚好出现在 4h 区间边缘，或者是 4h 明确突破后的回踩，才去谈进场。
否则低周期再漂亮，也只是“区间里的噪音机会”。
所以答案是：我有看这层视野，但当时没有把它当成最上位过滤条件。
这点你抓得很准，后面我应该改成“先给大级别结论，再决定要不要看小级别触发”，而不是反过来。

如果你愿意，后面我给你 BTC/ETH 计划时可以固定用这个顺序：

1d/4h 先定性：趋势 / 区间 / 中间层
先回答一句：该不该做
只有在“值得做”时，才往下给 1h/15m 点位和挂单

看看pepusdt的线吧 是不是在周期底部还形成三角形了



已处理 2m 14s
如果你说的是 Binance U 本位合约，那正确标的是 1000PEPEUSDT，不是 PEPEUSDT。按 2026-04-07 10:07 Asia/Shanghai 的最新数据，现价大约 0.0033384。

先说结论：有收敛形态的味道，但我更偏向它是 4h 下跌后的弱收敛 / 偏下降三角，不是很标准的周期底部三角。

我这么看：

放大到 4h，它确实在最近中期区间的下半区。
最近 400 根 4h 里，当前位置大概只在全区间的 11.9% 分位。
最近 30 天 1d 里，也只在大概 18% 分位。
所以说“在中期偏底部区域”是成立的。

但它不算很干净的“底部反转三角”。
这波 4h 高点是一路往下压的：
0.0036336 -> 0.0035603 -> 0.0035495 -> 0.0035419 -> 0.0035088
下方支撑更像是 0.003304-0.003311 一带的横向承接。
这更接近 下降三角 / 弱收敛，不是很漂亮的对称三角底。

1d 视角也没有完全转强。
日线最近还是 lower highs 背景里的一段回落后整理，所以大级别还不能轻易定义成“底部已经做完”。

我会盯这几个位：

支撑：0.003304-0.003311

次支撑：0.003289

更下方：0.003256，再远一点是 0.003163

近压力：0.003351-0.003370

再上：0.003459

更强压力：0.003509-0.003542

大压力：0.003634

所以实战上更像这样理解：

4h 站上 0.003370，才算先把第一层压制拿掉，才有资格去试 0.003459-0.003509
真正要说“三角向上突破成立”，至少得明显收复 0.00354，甚至重新挑战 0.003634
如果 4h 跌破 0.003304，那这个收敛就更偏失败，容易继续去 0.003289 / 0.003256
一句话总结：它是在中期偏底部区域没错，但当前更像弱势里的压缩三角，不是很标准的底部启动形态；先看 0.003304 支撑和 0.003370 突破，没出区间前别太早下“底部完成”结论。


那个博主也是这么说的 说后续向上突向下突都有可能 突什么方向就追什么方向 你认为呢



已处理 25s
我基本认同，但会比他说得更苛刻一点。

按 2026-04-07 10:16 Asia/Shanghai 的 1000PEPEUSDT，现价大约 0.0033425。现在这段形态本质上就是：方向还没选出来，区间内乱做胜率一般。所以“向上突就追多，向下突就追空”这个思路是对的，前提是你追的是 确认后的突破，不是影线。

我会这样定义：

向上：先看 0.003370。这只是第一层。
更像有效向上突破：4h 明确站上 0.003459，更强是收复 0.003509-0.003542。
向下：关键先看 0.003304-0.003311。
更像有效向下破位：4h 明确跌破 0.003304，下方先看 0.003289，再看 0.003256。
所以我的观点不是“现在猜方向”，而是：

区间里不做，突破后跟随
向上突破要看收线，不看瞬间冲一下
向下破位反而更容易干脆，因为现在大结构仍偏弱
一句话：我认同“突哪边追哪边”，但必须让 4h 收线帮你确认；现在还在中间区域，最差的做法反而是提前下注。


如果让你生成一个每15分钟监控一次是否追突破的监控呢 你会怎么设计prompt


我会把它设计成一种“先过滤，再触发”的 prompt，而不是单纯每 15 分钟报一次价格。

核心原则就 3 个：

先看 1d/4h，决定这次突破值不值得追
再看 1h/15m，确认是不是有效突破，不是影线假突破
输出必须直接回答：现在追不追，为什么，失效在哪
如果是给 Codex/agent 用，我会这样写：

任务：每 15 分钟监控一次 Binance U 本位合约 `1000PEPE/USDT`，判断当前是否适合“追突破”。

请使用：
- [$ohlcv-fetch](/Users/vx/WebstormProjects/trade/.agents/skills/ohlcv-fetch/SKILL.md)
- [$tech-indicators](/Users/vx/WebstormProjects/trade/.agents/skills/tech-indicators/SKILL.md)

数据要求：
- 交易所：Binance
- 市场类型：usdm
- 标的：1000PEPE/USDT
- 周期：1d、4h、1h、15m
- 以 Asia/Shanghai 输出时间

分析顺序：
1. 先看 1d 和 4h，判断当前属于：
   - 上升趋势
   - 下跌趋势
   - 大区间震荡
   - 区间边缘
2. 如果 4h 仍在大区间中部，默认结论优先为“不追突破”，除非出现非常明确的放量突破收线。
3. 再看 1h 和 15m，识别是否出现有效突破：
   - 向上：价格有效站上近端压力，且至少有收线确认，不接受只有上影线刺穿
   - 向下：价格有效跌破近端支撑，且至少有收线确认，不接受只有下影线刺穿
   - 优先看 15m close，其次参考 1h 是否同向配合
4. 判断突破质量时，必须检查：
   - 是否放量
   - 是否连续两根 K 线站在突破方向一侧
   - 是否突破后立刻回到区间内
   - 是否只是区间内噪音波动
5. 最后只输出“追多 / 追空 / 不追”三选一结论。

输出格式固定为：

时间：
现价：

4h 大级别环境：
- 趋势 or 区间
- 当前处于区间什么位置
- 现在值不值得做

15m / 1h 突破状态：
- 向上突破是否成立
- 向下突破是否成立
- 是否只是影线假突破

结论：
- 追多 / 追空 / 不追
- 原因用 2-4 句说清楚

如果追多：
- 触发价
- 失效位
- 第一目标
- 第二目标

如果追空：
- 触发价
- 失效位
- 第一目标
- 第二目标

如果不追：
- 明确写出下一次值得关注的上破价和下破价

额外要求：
- 不要泛泛而谈
- 不要只报支撑压力
- 必须先给“大级别该不该做”的判断，再给低周期触发
- 如果大级别仍是震荡中部，默认偏向“不做”
如果你想把它再做得更像你说的那个博主风格，我会再加一句硬规则：

只有当 4h 处于区间边缘，或者 4h 已经确认脱离区间时，才允许给“追突破”建议；否则默认输出“不追”。
这一句特别重要，因为它能防止系统被 15m 的假突破带着跑。

如果你愿意，我可以下一条直接把它改成一个更短、更适合自动化落地的最终版 prompt。
