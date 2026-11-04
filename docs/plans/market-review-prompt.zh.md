# 独立审阅：market data 的存储、采集、使用和服务器准备

你是独立审阅者。这个仓库是一个人用的加密货币永续合约策略研究工具。请审阅它的市场数据这一块：数据怎么采、怎么存、丢了怎么恢复、
用的时候怎么对待缺口，以及搬上服务器的准备。这次审阅的起因是币安缺了一整天的归档，用户从中看到存储和采集可能有不少缺口和隐患，
数据使用对缺口的处理和兼容也不一定到位。

下面的描述由参与实现的 Agent 写于 2026-11-04 05:11 UTC，对应 `main` 的提交 `48da8dd2e`。**它可能有错、有遗漏，也可能带着实现者的
偏见。** 一切以代码和数据为准，发现描述和事实不符，本身就是一条发现。

## 规则

**只读。** 不提交、不开 PR、不改任何文件和配置；不写账本、市场目录、R2；不启停容器和主机进程。

- 只读你需要的：从 Git 读代码（`git show 48da8dd2e:<路径>` 或一个干净的检出）。
- 不要读任何凭据：`~/.config/trade/r2-market.json`、主检出的 `.env`、`~/.dolt` 和浏览器 cookie 都不碰，也不要 `cat` 或列这些目录。
- 不要在正式市场目录（`~/.local/share/trade/market`）上跑重读取：机器的瓶颈是内存，全表扫描要用户同意。查文件名、大小、Parquet
  尾部统计可以。
- 公开来源（`data.binance.vision`、`fapi.binance.com`、GitHub issue）可以查，请控制下载量，下载内容放临时目录并用完删除。
- 项目规则见仓库根的 `AGENTS.md`。放宽或收紧拒绝规则、破坏性写入、切换正式数据库都要用户授权，所以你只提建议，并标明哪条建议需要授权。
- `docs/plans/` 里有不少文档已被取代，读的时候先看日期和开头的说明。

## 必读

| 文件 | 内容 |
|---|---|
| `market/README.md` | 当前设计的代码说明，最先读 |
| `docs/plans/market-plain-files.zh.md` | 最近一次重构的计划和它的审阅摘要 |
| `deploy/README.md`、`deploy/compose.yaml` | 服务、恢复步骤、更新方式 |
| `market/files.py`、`store.py`、`follow.py`、`publish.py`、`series.py`、`aggtrades.py`、`quotes.py`、`metrics.py`、`liquidations.py`、`record.py`、`coverage.py`、`export.py` | 实现 |
| `engine/config.py`、`engine/load.py`、`engine/run.py`、`ledger/lines.py`、`ledger/coverage.py`、`market/universe.py`、`paper/runs.py` | 数据的使用方 |
| `.agents/skills/research-start/references/readiness.md` | Agent 遇到缺口时该怎么做 |
| `docs/plans/liquidation-recording.zh.md`、`monthly-market-import.zh.md`、`aggtrades-source-import.zh.md`、`market-archive-retention-inventory.zh.md` | 采集的决定和实测 |
| `docs/plans/collection-server.zh.md` | 服务器计划。**写于 11-02，未提交到 Git，只在主检出里（`/Users/vx/WebstormProjects/trade/docs/plans/`），基于已被取消的 Dolt 市场库** |

## 最近的修改

- **11-03 之前**：市场数据在 Dolt 里（本机 207 GB，备份 205 GB，公开副本在 DoltHub 的 `vincent/trade-market`）。
- **11-03**（#2076–#2080）：转成 Parquet 目录加 Cloudflare R2，内容寻址文件、版本文件、head、每次导入一份回执。
- **11-03 到 04**（#2082、#2083、#2087、#2088、#2092）：决定“能重算的一律不存”，转换来的大文件和 K 线、资金费率不再上传。
- **11-04 决定**：回执和版本文件都是治理，不是金融数据，不存。用户原话：“我相信同样的脚本每次导出金融数据应该一直一样的，即使真的会有
  说这个月导这个月数据和下个月导入这个月数据数据是不一样的情况，也应该是差异极小不至于说直接改变策略整体表现”。
- **#2081**（53a309c06）：爆仓记录器的落盘文件按收盘日导入市场目录。
- **#2095**（c1a11c99c，03:33 UTC 切换）：目录改成固定路径的普通文件，`market_commit` 改成“数据截至哪一天”。
- **#2096**（48da8dd2e）：`--quotes-from` 从 2020-01 改成 2021-03，首轮不补 BTC 2020-01 到 2021-01 的旧报价。这个参数三个合约共用，
  目录全丢重建时要先放宽，否则 ETH 从 2020-01、SOL 从 2020-10 到 2021-02 的报价不会重算。
- **本地 Dolt 市场库、备份、转换用的卷已删除**（共释放约 634 GB）。账本仍是 Dolt。

**拒绝规则的变化（用户授权）：**
- 删除：市场一侧的 `HASH_MISMATCH`、`HISTORY_REWRITTEN`，以及 `ENTRY_OVERLAP`、`HEAD_INCOMPLETE`、`WRITER_MISSING`、`SCHEMA_VERSION_MISMATCH`、
  `AMBIGUOUS_REF`、导入里的 `RULE_VERSION_MISMATCH`。
- 改含义：`UNKNOWN_REF`、`MARKET_EMPTY`、`IMPORT_SCOPE`、`PUBLISH_DIVERGED`、`CONCURRENT_IMPORT`、`UNIVERSE_CHANGED`。
- 新增 `TRADES_NOT_HELD`；收紧 `MONTH_INVALID`（报价、成交不能导没结束的月份）；放宽补导时的 `MONTH_EXISTS`（没有 K 线、资金费率行和重算相同就继续）。

**切换时做过的核对：**
- 新旧目录逐（表、合约、月）比较行摘要：2279 组全同，约 123 亿行。
- 11 组导出指纹相同，正向对照能发现单个资金费率 1e-8 的改动。
- 试验 521、460 复现指纹一致（`dbng`、`1kcb`）；试验 512（`l1kf`）`REPRODUCTION_MISMATCH`，这是计划预期的。
- 182 个研究运行里 111 个用 `l1kf`，要按 11-03 的规则重跑并折叠，还没重跑。
- 重算能否还原：转换文件用当前代码重做，核到 572 个逐字节相同后用户免核其余 45 个；K 线、资金费率只抽了 14 个文件。

## 现在的设计

**目录：**
```
<table>/<YYYY-MM>.parquet            bar, funding, universe_month, liquidation_watch
<table>/<YYYY-MM>/<symbol>.parquet   agg_trade, quote, metrics, binance_force_order, bybit_all_liquidation
instrument.parquet                   合约条款，只追加
lock                                 导入锁（fcntl，跨 Docker 虚拟机无效，改名前另核 inode 和修改时间）
```

**大小（`du`，含 APFS 克隆）：** agg_trade 56G、quote 22G、bar 2.1G、metrics 54M、binance_force_order 7.5M、bybit_all_liquidation 2.7M、其余不到 1.2M。

**范围（部署配置，目录本身不记录）：**
- K 线和资金费率：30 个合约，从 2020-01。
- metrics：BTC、ETH、SOL，从 2021-12-01。
- 成交：BTC、ETH、SOL，从 2020-01。
- 报价：BTC、ETH、SOL，从 2021-03，由已存的成交推算（最优买卖价是推断的，不是观测的）。
- 爆仓：币安、Bybit 的推送，从 2026-11-02。

**`market_commit`：** 写成 `YYYYMMDD` 加 24 个 0，含当天。不带版本时取 K 线、跟随的 metrics、爆仓 watch 三者最后完整日里最早的一天；月末那天要等下月合约名单写好。
旧的 8 个版本号（`files.LEGACY`）映射到日期，不承诺导出和当时相同。没有版本文件和回执，文件内容如果变了，导入时不会拦；复跑时 `REPRODUCTION_MISMATCH` 才看得到。

**R2（公开）：**
- 只上传 `instrument`、`universe_month`、爆仓两张表和 watch，共 1499 个对象，约 7.7 MB。
- 其余（K 线、资金费率、metrics、成交、报价）只在本机，丢了从币安重算。
- 旧对象 1393 个（`files/` 1377、`versions/` 15、`head`），约 85 GB，还没删。

**恢复：** `deploy/README.md` 写了步骤。**没有做过从零恢复的完整演练**，也没有测过耗时。

**旧数据，都还在、都待删：**
- 本机 `~/.local/share/trade/market-old`（80G，和新目录共用 APFS 克隆）。
- R2 上的旧对象。
- DoltHub 的 `vincent/trade-market`。
- 用户已同意：最新截至日往前走一次、再复跑试验 521 和 460 仍相同后就清理，由用户亲手执行。**这些删除还没执行。**

**服务（都在一台 Mac 上，Docker Compose 项目 `trade-ide`，只构建 arm64 镜像）：**

| 服务 | 作用 | 当前镜像 |
|---|---|---|
| `market-import` | `market follow`，市场目录唯一的写者，每轮后发布 R2 | 48da8dd2e |
| `market-record` | 爆仓推送落盘，spool 在 Docker 卷里，发布 7 天后删除 | 53a309c06 |
| `ide`、`paper` | 只读市场目录 | c1a11c99c |
| `ledger` | 研究账本（Dolt） | d0fec2464 |
| `docker-api` | paper 访问 Docker 的唯一入口 | HAProxy |

- 归档缓存在 Docker 卷 `trade-market-import`，现在 6.4G。
- 账本公开副本在 DoltHub，本机 `dolt-backups/research` 停在 10-25（211 个试验，账本已有 523 个）。

## 数据使用怎么对待缺口（我读代码得到的，请核实）

| 缺口 | 采集时 | 使用时 |
|---|---|---|
| K 线缺分钟 | 月度、日度、REST 依次拼接，都没有就留空并报告 | 没有这根 K 线，也不撮合；高周期 K 线用现有分钟合成，一分钟都没有的周期不存在 |
| MARK 缺分钟 | 同上 | 持仓时沿用最新 MARK，最多 `MARK_CARRY_MAX_MINUTES`；超过则 `CAPITAL_VALUATION_GAP`，运行不合格 |
| 零成交分钟 | 保留 | 策略收到 K 线，订单不成交 |
| 资金费率缺一次 | 报告 | 不结算，账户结果少这笔 |
| 成交 id 不连续 | `SEQUENCE_GAP`，**整月跳过**，每月重试 | 该月没有成交和报价 |
| 成交、报价缺整月 | `skipped`，文件没有 | 报价环境 `QUOTES_MISSING`，成交 `TRADES_MISSING`，按“某个 UTC 月没有”判断 |
| metrics 缺一天 | 3 天内等，之后算洞（`unpublished`），进程重启前不再问 | 请核实 |
| 爆仓没记到 | watch 没有这段 | `coverage` 报告；没有记录的时段不是“没有爆仓”，消费方如何区分请核实 |
| 合约条款 | 只有观测到的，历史用当前快照近似 | 报告里写 `CURRENT_SNAPSHOT_APPROXIMATION` |

产品不替 Agent 决定：不丢合约、不缩窗口、不填数据。`market coverage` 报事实，`readiness.md` 让 Agent 向用户报告并交还选择。

## 已知的缺口和异常

- **2026-10-28，币安 U 本位和币本位：** 日度 K 线、标记价、指数价、溢价、aggTrades 都是 404，文件列表里也没有。
  - 月度文件校验和正确，但只有 30 天，缺这一天，BTC 的 agg id 跳过 961,120 个。
  - 原始 `trades`、metrics、现货文件都有。原始成交总量和 REST K 线成交量相等，id 和前后两天的 aggTrades 首尾相接。按价格、时间、方向简单合并得到 1,137,933 组，对不上。
  - REST aggTrades 只能查最近 2 天。已有 issue：[binance-public-data#525](https://github.com/binance/binance-public-data/issues/525)，币安未回复。
  - 市场里 10-28 的 K 线有 1440 分钟（来自 REST）。2026-10 的成交、报价在等，约 12-11 跳过，11 月也被排在它后面。
- **币安补文件的历史：** [#291](https://github.com/binance/binance-public-data/issues/291) 部分合约几周、部分两年半；[#385](https://github.com/binance/binance-public-data/issues/385) 约 14 个月；[#432](https://github.com/binance/binance-public-data/issues/432) 仍未补。BTC 的 aggTrades 有不少文件最后修改时间比数据日晚很多，2026-04-16 还一次写了 47 个旧文件。
- **成交 id 缺口（现有）：** BTC、ETH 的 2020-04、2021-02、2021-05、2022-09，SOL 的后三个月。用户 11-02 决定 `SEQUENCE_GAP` 维持现状。
  - 11-02 的核对：BTC/ETH 2020-04、三个合约的 2021-02 和 2022-09-06 的小缺口可用原始成交证明完整；2021-05-19 和 2022-09-06 约 17:09–17:20 证明不了。
  - ETH、SOL 的 2022-09-11 日度文件每行写了两遍。BTC 2020-04 月度文件截断在 2000 万行，2022-09 月度文件乱序。
- **报价：** BTC 从 2021-03 起，缺 2021-05、2022-09；ETH、SOL 也缺相应月份。
- **爆仓：** 从 2026-11-02 约 09:30 UTC 才开始有，两家都没有免费历史，采集中断就永久丢失。没有第二份记录。主机休眠时虚拟机暂停，靠墙上时钟和单调时钟的差判断。
- **这次切换后的首轮：** 币安 11-03 归档未出（最近一周 K 线通常在次日 08:30–09:35 UTC 发布，最晚 13:32），所以最新截至日还没有真正往前走过。月初名单的路径要到 12-01 才第一次实跑。

## 服务器设计和准备

- **现状：** 我所知没有开通任何服务器，`collection-server.zh.md` 的步骤一步都没执行。请向用户确认。
- **该计划的方向（11-02）：** 服务器做唯一的写者，跑 `market-import` 和 `market-record`，爆仓记录最先上；本机改成跟随 DoltHub 的副本；paper、研究账本、ide 留在本机；拆部署不拆代码；要求 arm64、不在美国和中国大陆、磁盘 400–500 GB、内存按 16 GB 规划；候选 Oracle Ampere A1、netcup；有专用 DoltHub 写账号。
- **已经失效的前提：** 市场库不在 Dolt 了，DoltHub 副本、`DOLT_PULL`、207 GB、角色标记那部分都不再成立。现在 R2 只有不可重算的 7.7 MB，**服务器写的 80 GB 怎么到本机没有设计**。两边各导一份，还是同步文件，还是本机读服务器，都没定。
- **其他还没定的：** paper 上不上服务器（将来可能的目标是 arm64 + rootless Docker）；研究和回放放在哪台机器；爆仓记录迁移时两边数据怎么分界（旧计划有规则，基于 spool）。
- **币安和 Bybit 的地域限制：** GitHub 托管 runner 访问 fapi 返回 451，Bybit 文档写明拒绝美国和中国大陆 IP，本机靠当前网络路径连通。这些没有在候选机器上实测。

## 已定的决定

下面是用户定的，不要仅因为你偏好别的做法就推翻。但如果你发现某个决定的**后果**用户可能没看到，请用证据说明。

- 只用免费公开数据（不用 Tardis、Crypto Lake 这类付费源）。
- 存储只放金融数据，不存版本文件和回执；能重算的不存。用户接受“重算的差异极小”。
- 不做复杂的治理和中间层，一个人用的工具，按个人工具的标准判断，不按 SaaS 标准。
- 产品代码只为信任边界、已有缺陷或 Agent 做不到的事而加；不新增字段，除非现有结构表达不了。
- 不填充、不插值、不伪造行情。

## 请回答的问题

**A. 存储和恢复**
1. 列出每张表丢了之后的恢复路径和它依赖的外部条件。有哪些数据其实已经无法从公开来源重算？（比如来自 REST 的分钟、币安后来改过或删掉的归档、`instrument` 的历史观测。）
2. “能重算”的前提有多可靠？用证据判断，而不是引用用户的前提。币安重写归档时，我们能发现什么，发现不了什么？
3. 现有的异地和第二份副本够吗？本机盘坏、Docker 卷丢、Mac 换机各会丢什么？归档缓存、爆仓 spool、账本备份分别怎么看？
4. **上面待删的旧数据（`market-old`、R2 旧对象、DoltHub `trade-market`）现在删合适吗？** 给出删前必须满足的条件，或者说明为什么可以直接删。
5. 从零恢复的步骤按代码走得通吗？估一下时间和下载量。

**B. 采集**
6. 从单点故障、静默失败和无人发现的角度，逐个服务走一遍：记录器停了、连接半死、时钟异常、磁盘满、币安限流或改格式、R2 不可用，各会发生什么，用户多久才知道？
7. `market follow` 的状态和健康检查能不能让人及时发现问题？`skipped`、`unpublished` 不算不健康，这样对吗？
8. 10-28 这类“文件缺失”和“文件在但内容不全”，现在分别能不能发现？月度文件校验和正确却少一天时，代码走哪条路？还有哪些类似的异常检测不到（比如重复行、截断、合约下架、改名、tick 变化）？
9. 一个坏日子导致整月跳过，一个等待中的月份挡住后面的月份：这个粒度和排队方式合理吗？代价有多大？

**C. 数据使用和兼容**
10. 对每种缺口，走一遍回放（bars 和 quote 两种环境）、复现、paper、报告和 IDE，确认上表是否属实。有没有缺口被静默吞掉、结果看起来正常但其实有偏差的情况？
11. 报价是从成交推断的，遇到缺口、跨月、月初时，状态怎么带？`QUOTES_MISSING` 按月判断，够不够？
12. 研究窗口跨过缺口时，Agent 拿到的信息够它做判断吗？`market coverage` 和 `readiness.md` 有没有漏掉的？
13. 同一个 `market_commit` 的数据可能变（补洞、晚到的归档、月内重写）。对锁定的登记、可比性、复现、已封存的结果有什么影响？研究的统计和防过拟合依赖什么不变量，还成立吗？
14. 策略或 Agent 如果把“没有爆仓记录”“没有 metrics”读成零或读成没事，代码能防住吗？

**D. 服务器**
15. 按现在的目录和 R2 设计，服务器方案应该是什么？服务器和本机的数据怎么流动、谁是写者？给一个最简单且能满足上面可靠性问题的方案，并说明放弃了什么。
16. 爆仓记录是唯一一旦中断就永久丢失的数据。它应不应该先单独上服务器？要不要多地记录？最低成本的做法是什么？
17. 上服务器前必须先改或验证的代码和配置有哪些（arm64、路径、锁、密钥、地域、健康检查、告警）？`deploy/compose.yaml` 说“同一份工作站和服务器都能用”，属实吗？

**E. 这份描述**
18. 本文哪里写错了，或者漏了什么重要的？

## 输出

用中文写，不造新词，用代码里的字段名和普通的话。

1. **结论：** 最多 10 行。最该先处理的 3 件事，以及现在是否可以删旧数据。
2. **发现：** 按严重程度排序，每条写：
   - 严重程度（会永久丢数据、会让研究结论错、会让服务静默停、只是不方便）；
   - 具体场景：什么输入或状态，产生什么错误结果；
   - 证据：`文件:行号`，或你实际运行的命令和结果。没有验证的明确写“未验证”；
   - 建议的最小改法，以及是否需要用户授权（改拒绝规则、新字段、破坏性操作、切换数据库、动主机配置）。
3. **需要用户决定的事：** 每条写清楚选项和代价，不要把工程细节推给用户。
4. **你查过但没问题的：** 简短列出，方便别人知道覆盖面。
5. **没查到或查不了的：** 说明原因。

宁可少而准。不要列风格意见，不要为了凑数报低价值的问题，也不要提议搭一套新的治理或监控系统来解决简单问题。
