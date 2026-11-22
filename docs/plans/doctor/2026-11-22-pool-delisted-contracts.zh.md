# 2026-11-22 币池里当月停止交易的合约

来源：0.5.0 发布前 Docker 端到端运行（2026-11-22）。`replay explore --universe pool`，市场日 2026-10-30，窗口 `--start 2024-09-20 --trade-start 2024-09-24 --end 2024-09-27`，审计报 `DATA_ENDS_WITHOUT_TERMINATION: MATICUSDT-PERP.BINANCE: its last bar closes at no bar, the window end is 2024-09-27…`，运行无效。0.5 研究线的开发期止于 2024-09-30，不带生命周期证据包的币池运行都会这样作废。

| Item | Value |
|---|---|
| Sessions | 0.5.0 端到端运行的步骤日志（`48-pool`、`50-pool2`）；诊断与修复 lane（Claude Code，Claude Opus 5.5） |
| Checkout / market | `origin/main` `48851741e`；活动市场（681 个合约，只读），市场日 2026-10-30 |
| Coverage | `market/universe.py`、`market/export.py`、`registration/inputs.py`（币池选择）、`engine/audit.py`（`lifecycle_findings`）、`engine/load.py`（`trading_end`、`episode_membership`）、设计站 W.3.1、W.3.2、G.3.3.3；活动市场全部 82 个 `bar` 月文件与 `universe_month` 的逐合约统计 |
| Cost | wrong output：MATIC 一类（成交 K 线在窗口末前断掉）运行判无效；僵尸尾一类（见下）运行有效但输入里有已结算的合约 |

## 证据

**MATIC 的档案。** `bar/2024-09.parquet` 里 MATICUSDT 的 LAST 最后一根有成交量的分钟开在 2024-09-04 08:59 UTC；其后 10,123 根零成交量分钟，OHLC 恒为 0.3846，到 2024-09-11 09:42 为止，之后没有 LAST。Binance 公告 USDⓈ-M MATICUSDT 永续于 2024-09-04 09:00 UTC 平仓自动结算并下架（[Binance Will Support the Polygon (MATIC) Token Swap to Polygon (POL)](https://www.binance.com/en/support/articles/6a6de383727f4659a3050f7982e1620f)），与数据对得上：合约是被结算下架的，不是暂停。POLUSDT 是另一个合约，市场里第一根 MARK 在 2024-09-13 10:08、第一根 LAST 在 12:15。

2024-09-11 以后 MATICUSDT 的 MARK 与资金费不属于一个在交易的合约：MARK 每分钟递减几个 1e-8（2024-10 起 39401966、39401962、39401958…），2026-10 约 0.198，同期 POLUSDT 约 0.113（比值 2.08），不是 POL 的标记价；资金费每 8 小时一条、恒为 0.0001（没有溢价成分）。这是档案对一个已结算代码的残留。

**成员怎么算。** `universe.monthly_universe`：月 M 的成员是 M 前一天有成交、连续成交日不少于 30 天的合约，“后来下架的照收”（设计站 W.3.1.1）。MATIC 在 2024-08-31 有成交，所以是 2024-09 的成员，成员时段 `[2024-09-01, 2024-10-01)`；2024-10 起不是成员。`registration.inputs.market_inputs` 在 `--universe pool` 时选出成员时段与 `[trade_start, end)` 相交的合约，MATIC 因此进了 09-20 到 09-27 的输入。没有证据包时导出只有一个片段、没有终止事件；该片段在窗口里没有一根 LAST，`lifecycle_findings` 判 `DATA_ENDS_WITHOUT_TERMINATION`（`last is None` 时文字是 “closes at no bar”，措辞错误）。

**其他停止交易的合约。** 按全部 `bar` 月文件逐合约统计（最后一根有成交的 LAST、最后一根 LAST、最后一根 MARK）与 `universe_month`：

- 161 个合约在 2026-10-27 前停止成交，全部在停止后仍有 MARK（多数延续到市场末端 2026-11-01），153 个停止后还有超过 1 小时的零成交量 LAST 尾巴。
- 160 个合约、162 个成员月里，合约在当月月末前停止成交（OMG、ALPACA 在月末最后一天停，下一个整月仍是成员）。42 个日历月受影响（共 81 个成员月）。
- 其中 16 个合约月是“断档”：LAST 在月末前就没有了，窗口跨过断点即 `DATA_ENDS_WITHOUT_TERMINATION`，运行无效：BZRX 2021-12、BTT 2022-01、KEEP 2022-02、1000BTTC 与 YFII 2022-04、AKRO、ANC、DODO、LUNA 2022-05、AUDIO 与 MBL 2024-05、GAL 与 RNDR 2024-07、MATIC 2024-09、EOS 2025-05、AERGO 2026-07。
- 另 146 个合约月是“僵尸尾”：结算后 LAST 仍是一价到底的零成交量分钟（AGIX 2024-06：8,099 根、只有一种 OHLC），MARK 漂移，资金费恒定（FTM 2025-01 还有 0.0045）。审计不报，运行有效，但合约在结算后的输入里仍可下单、仍按漂移的 MARK 估值、仍收资金费。
- 0.5 开发期 2021-10 到 2024-09：33 个合约月（14 断档、19 僵尸尾），触及 18 个月；跨整个开发期的币池运行必然跨过 14 个断档，一律无效。留出期 2024-10 到 2026-09：121 个合约月（2 断档、119 僵尸尾），触及 22 个月。统计一遍读完全部 `bar` 月文件的 `symbol`、`price_type`、`ts_open`、`volume` 四列，单线程 83 s，可随时在只读市场上重做。

一个窗口受影响，当且仅当它的交易段与某个受影响的成员月相交、且窗口末晚于该合约的停止时刻；只落在其余 39 个月里的窗口不受影响。

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261122-04 | 当月停止交易（结算下架）的币池成员没有终止事件：成交 K 线在窗口末前断掉的（16 个合约月）使币池运行无效，结算后仍有零成交量 K 线的（146 个合约月）照常作为可交易合约导出；审计对窗口里没有 K 线的合约写 “closes at no bar” | 上文；`market/universe.py` `monthly_universe`、`registration/inputs.py` `market_inputs`、`engine/audit.py` `lifecycle_findings` | authority（根因修复要改终止时刻的证据规则或加存储字段，见下）；措辞已改 | wrong output | open |

## 根因修复的选项

设计站 W.3.2.2 与用户 2026-10-25 的决定：终止时刻与结算价只来自证据包里的交易所原件；“首末两条数据只是上市和下架的替代线索，不当作交易所事实”（W.3.3.1）。今天没有证据包就没有终止，上面的两类情形都由此而来。不改这条规则、不加存储字段、不改写市场，产品里没有能让普通币池运行有效的改法。可选：

1. **由已存数据推出终止时钟（推荐）。** 导出时对“最后一根有成交的 LAST 之后、到市场日为止再无成交”的合约，在其最后成交分钟收盘处给一条无价 `InstrumentStatus CLOSE`（不给 `InstrumentClose`，不造结算价），与证据包给的终止走同一条路：成员时段截到终止（`episode_membership`），审计按 G.3.3.3 要求此前清仓撤单，之后的数据不导出。不加字段，不改写市场，审计检查本身不变；但它把“数据末端”当作终止时钟，改变了 W.3.2.2 的证据规则，也让此前有效的僵尸尾运行在持仓跨过终止时变为无效（收紧）。需要用户授权。停一阵又恢复成交的合约不受影响：判定看的是到市场日为止的全部数据。
2. **改成员规则（`usdt-perp-listed30d-v2`）：成员时段止于停止成交。** 规则是存进 `universe_month` 的常量，改规则就要删掉并重算该表（改写活动市场）；持仓跨过停止时刻仍没有终止，断档一类照样无效。不推荐。
3. **存交易所的终止时刻。** 例如在条款里记 exchangeInfo 的 `status` 与 `deliveryDate`：新存储字段，需评审并逐字段问用户；早已退出 exchangeInfo 的合约（MATIC 的条款是 `inferred`）仍拿不到，要逐个补公告。
4. **维持现状，补技能文字说明何时需要证据包。** 每条币池线都要手工为 160 个合约写清单并找公告；技能绕道，任务说明已排除。

## Decisions

- 2026-11-22：措辞修正（窗口里没有 K 线时写 “the input holds no bar of it”）随本记录的 PR 合入，检查本身不变。根因修复在选项 1–3 之间等用户决定；本 lane 未改成员、导入或导出。
- 2026-11-22：协调者依用户委托「需要我定的部份最后也是一样由你决定按推荐做」（2026-11-21）与「需要我拍板的都按照你的建议来」定为选项 1。标签、Live、凭据和活动账本仍不在范围内。

## 选项 1 的实现

- 停止时钟：钉住的市场日为止全部已存 `bar` 中，最后一根成交量大于零的 LAST 分钟的收盘（`market.data_end_stops`）。只在它早于窗口末、且离市场日结束至少 7 天时才推出。证据包列出的合约只按证据包。
- 表示：复用生命周期片段的现有字段（`market.derived_episode`）。只有一条 InstrumentStatus CLOSE；`start_ns` 为 0，`sources` 为空表（证据包的片段至少引一份原件）。不给 InstrumentClose，不造结算价，不加存储字段。片段仍是合约本身（`SYMBOL-PERP.BINANCE`），停止之后的 K 线、日 K、MARK 和资金费不导出；导出缓存键包含推出的停止时钟。
- 引擎信任：`engine.load.derived_piece` 认可这种片段：唯一一个片段，CLOSE 恰在最后一根导出 K 线收盘处，或窗口内没有 K 线。认可后不需要证据包，计数核对与证据包片段相同。其他片段没有证据包仍拒绝（`LIFECYCLE_BUNDLE_MISSING`）。
- 审计：持仓或挂单跨过停止时刻，按现有 G.3.3.3 检查判无效。在窗口起点之前就已终止的合约，不再报 `DATA_ENDS_WITHOUT_TERMINATION`：W.3.2.1 规定这种合约不建实例，引擎原本就跳过它。这是检查的一处边界改动，属于选项 1 的授权范围，在 PR 中写明。
- 独立设计评审（fresh subagent，只给代码路径与设计）结论为 sound with changes。已采纳的改动：
  - 币池不删去在窗口起点前已停止的成员，改为审计跳过。
  - 停止时刻须离市场日至少 7 天（原设计为 24 小时）。
  - 信任检查要求停止时刻与导出末根 K 线对齐。
  - 缓存键按停止时钟本身。
- 评审提出、本 PR 未做的三项，只在文档里写明局限：
  - 证据包列出某合约、但其最后一个片段没有终止时，不推、也不拒。
  - 窗口内停了又恢复的代码不推。
  - 用 scope 导入的工程市场，可能对没有导入后续月份的合约推出停止。
- 实测（活动市场，只读，市场日 2026-10-30）：
  - 推出的停止：2024-09-20..27 币池 259 个合约，只有 MATICUSDT 一个（2024-09-04 09:00）；2022-05 币池 137 个合约，推出 AKRO、ANC、DODO、LUNA 四个（LUNA 2022-05-12 15:33）。推出耗时 0.6–2.5 s。
  - 导出字节：BTCUSDT 单合约 2024-09-20..27 的 export_sha256 为 0b9386620a12…，每字节哈希为 c37f2a943554…，与 main 相同。
  - 同一窗口的币池导出：258 个合约逐文件与 main 相同，只有 MATICUSDT 不同（日 K 截到 09-04，MARK 与资金费不再导出）。
