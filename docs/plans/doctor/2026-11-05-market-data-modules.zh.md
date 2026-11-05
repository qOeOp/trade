# 2026-11-05 市场数据模块的作用与 basket 的人群

用户要求讲清市场数据各模块在项目里的作用，讲不清的就是没有或 ROI 低。这是聚焦诊断，不审研究会话，只读代码、账本和市场目录。

| Item | Value |
|---|---|
| Sessions | 无被审研究会话 |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `0269fe77-2b1b-4291-bdb9-070210095215`，只写这份记录与索引；两个只读子代理（IDE 行情页的数据来源、修复方案的对抗评审） |
| Checkout / ledger | 读取起点 main `924b62b31`，复核到 origin/main `2bb13e460`（`market/`、`engine/`、`deploy/`、`paper/` 无差别）。账本读取起点 `pl0iirhfharu9cskl8gn2d7l60mm1qpl`；研究会话在写，输入回执读到 687 个 trial，随后 trial 表为 691 个。市场提交 `20261103000000000000000000000000` |
| Coverage | `market/` 全部模块及其产品内消费者，`deploy/compose.yaml`，`ide/overview` 与行情页，`report/` 的 basket 读取，skill 与评测的引用；账本 trial 输入回执、judgment、registration；市场目录的大小与内容。**缺口**：`/tmp` 脚本直接读文件的用法和隔离库里的工程试验不计入使用统计；用户是否常看行情页测不了；只交易 BTC 的候选能否通过验证未实跑，由单独的诊断会话确认，本记录不下结论 |
| Cost | 研究代价 unknown。产品造成的无效试验：0 个观察到。审计自身：子代理 253,523 token（92,820、160,703），约 5 分钟；主会话 unknown |
| Net change | 拒绝码 257（上份记录 257）。skill 词数 27,731（上份记录 27,732，同口径）。提议（估计）：代码约 +10 行减约 3 行，skill 约 +25 词；增长的理由：报告输出与实际人群不符，只能在产品说明和读法里改。没有新增机制、分支或存储字段 |

## 各模块的作用

687 个 trial 的输入回执（`counts` 里 `trade`、`metrics` 只在请求时才有这个键，`market/export.py:505-507`）：

| 输入 | 用到它的 trial |
|---|---|
| BTCUSDT 的 1 分钟 LAST、MARK、日线、资金费 | 687 / 687 |
| 其他任何合约 | 0（691 / 691 的 `instruments` 都只有 BTCUSDT） |
| quotes | 2：trial 198（explore，`execution` 为 quotes，3 天窗口）、trial 212（precheck，`execution` 为 bars） |
| `--trade-ticks` | 0 |
| `--metrics` | 0 |
| 下架事件 | 0（`instrument_close`、`instrument_status` 全为 0，没有一个合约分成多段） |

每次回放都依赖：`sources.py`（下载与校验）、`series.py`（拼接与冲突拒绝）、`store.py`（K 线、资金费、条款、成员的导入）、`files.py`（目录、市场提交、读写、锁）、`instrument.py`（条款转 Nautilus instrument）、`export.py`（转 Catalog）、`coverage.py`（缺口事实与导出回执）、`read.py`（`market bars`、IDE 图表、paper 对账、报告）。`follow.py` 负责每天更新，其中约 200 行只服务 aggTrades 和 quotes。

使用很少的部分见 Removal list。市场目录：`agg_trade` 56G、`quote` 23G、`bar` 2.1G、`metrics` 54M、`funding` 804K、`universe_month` 328K。`ide/overview` 的数字自述不是研究证据（`ide/overview/src/main.ts:21`），研究和 paper 都不读它。

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-18 | basket 被当作规则描述的市场来读，实际是部署配置里一份没有选入标准的名单 | 见下节 | fix（说明与读法；数值不变） | wrong output | open |
| 20261105-19 | 没人读的 10 月 aggTrades 和 quotes 让 `market-import` 一直 unhealthy，这段时间新故障不易看出 | Binance 没有 2026-10-28 的归档（`BTCUSDT-aggTrades-2026-10-28.zip` 404，10-27 为 200）；状态文件 trades、quotes 六项 `lagging`，bars、metrics 为 `waiting`；`market/follow.py` 的 `check` 把 `lagging` 算不健康；11 月归档全部发布后这个月才被跳过，推算在 12 月初（未实测）；judgment 736 写明 October quotes “absent and unused”，K 线不受影响 | none（一次性，到期自行消失；到时核对恢复） | none | open |

### 20261105-18 的证据

**产品说的与实际的。** `market/universe.py:4-8` 的规则是每个符合条件的合约，不排名、不取前 N。`deploy/compose.yaml:105-108` 的 `--bar-symbols` 列 30 个合约，其中 BTCDOM、DEFI、USDC、XAU 被规则排除，目录实际有 26 个合约的 K 线，近月成员约 22 个。同一时刻 exchangeInfo 有 519 个交易中的币本位 USDT 永续。`docs/plans`、`deploy/README.md`、`market/README.md` 都没有写名单的选入标准。旧记忆里有“历史 top-50 池”的说法，和这 30 个对不上。`market/read.py:47-50` 算出的 `members_per_day` 除测试外没有读者，读报告的人看不到人数。

**消费者。** `report/measures.py` 在读取时用 basket 算 `beta_basket`、`alpha_basket`、`up_month_notional`、`down_month_notional` 和 6 个 `*_vol_*`。`research-round/SKILL.md:136` 让 Agent 用 `alpha_basket`、`alpha_btc` 判断超出市场暴露的收益；`v_judgments` 里提到 `alpha_basket` 的 recommendation 有 52 行（一份判断可有多个 subject），judgment 732 是其中之一。

**实测。** 用 Binance 全部 USDT 永续的日线（REST 取在列合约，下架合约取月归档；符合规则 682 个，其中下架 29 个）按规则算成员和等权收益。这是近似：用 LAST 收盘代替 MARK，下架合约按名字分类。**对照**：同样的方法只算 26 个合约，与产品 basket 的日收益相关性不低于 0.9993，日均差 2–4bp。

| 窗口 | 日收益相关性 | 平均成员（现有 / 全量） | 累计：现有 | 累计：全量 | 累计：BTC |
|---|---|---|---|---|---|
| 2025-10-01 至 2026-10-01 | 0.9415 | 22.1 / 517.2 | -41.9% | -29.4% | -26.7% |
| 2025-01-01 至 2026-10-01 | 0.945 | 22.8 / 459.7 | -45.6% | -60.7% | -10.7% |
| 2022-10-01 至 2026-10-01 | 0.9525 | 22.0 / 316.3 | +112.4% | -35.9% | +330.6% |
| 2020-10-01 至 2026-10-01 | 0.9518 | 20.2 / 246.4 | +1068.3% | +99.9% | +675.9% |

对 239 个通过的 research run 中能回归的 235 个，用 `measures.market_regression` 重算：

| 读数 | 现有与全量之差 |
|---|---|
| `alpha_basket` 年化差 | 中位数 0.24%，p90 2.83%，最大 6.51% |
| `beta_basket` 差 | 中位数 0.006，p90 0.018，最大 0.027 |
| alpha 正负号 | 2 个翻转 |
| \|t\| ≥ 2 | 18 个改变（现有 35 个，全量 49 个）；现有与 BTC 之间 7 个改变（BTC 42 个） |
| 波动 regime 标签 | 15%–19% 的天数不同（三个窗口：19.2%、16.0%、15.3%） |
| 月度涨跌方向 | 最近 12 个月 0 个不同；2025-01 起 2 / 21；2022-10 起 6 / 48 |

累计差距符合名单带事后选择的情况，但没有选入标准，证明不了。全量等权又被大量小币主导，也不能当正确答案。

**补救的比较。**

- 不选 `none`：Agent 无从知道人群，读数已进入推荐。
- 选：一段共用的 `MEASURE_NOTES`（经 `report/measures.py:400` 和 `report/attribution.py:201` 到两种报告），改 `research-round/SKILL.md:136` 与 `templates/report.md` 第 13、16、18 行（只交易 BTC 的候选先读 `alpha_btc`；regime 和涨跌月没有 BTC 版本，说明它们只是这份名单的标签），更正 `market/read.py`、`market/README.md`、`docs/rd/concepts` 中英文，删掉 `members_per_day`。不改数值和版本，不加存储字段。不改 `market/universe.py`：它在 `EXPORTER_FILES` 里（`market/export.py:549-551`），改 docstring 会让导出全部重建。
- 全部合约导入 K 线：只交易 BTC 的 run 复现不受影响（成员文件只有 run 自己的合约，`registration/inputs.py:223`），但市场提交是当前文件上的日切（`market/files.py:10-11`），所有旧 run 的 basket 指标会在同一提交下悄悄变化；已完整的月份 `MONTH_EXISTS`（`market/store.py:378`），要替换目录，需用户授权。BTC 研究也用不上。
- 新增全合约日线表：只有 basket 一个消费者，多一张表和一个更新步骤。
- 删 basket，regime 和涨跌月改用 BTC：要改 registration 共用的指标目录（`registration/duties.py:59`），历史读数也变；只有用户确定研究长期只做 BTC 才值得，那时再提。

局限：这个修复不消除偏差，只让读者知道。研究转向多合约时需要一份有标准的名单，再重新设计基准。

## Removal list

下面都不提议现在拆。按用户 11-05 的决定，研究没被卡住就不改产品；是否拆取决于研究是否长期只做 BTC。涉及 refusal 和已存数据的需要逐项授权；旧 run 的复现是否受影响未验证。

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `market/lifecycle.py`（158 行）、`market lifecycle`、`--lifecycle-bundle` | 回放到下架合约时的结算 | 无 | 账本没有 `lifecycle-<commit>` 记录，0 个 trial 有下架事件；非测试 Python 里 290 行提到，7 个 `LIFECYCLE_*` 拒绝码 | 代价最大、用得最少；只做 BTC 时优先考虑 |
| `market/metrics.py`（202 行）、`--metrics`（54M） | 持仓量和多空比信号的输入 | 无 | 0 个 trial；2326 行 judgment 没有一行提到 open interest | 其次 |
| `--trade-ticks` 与 `agg_trade`（`market/aggtrades.py` 252 行，56G） | 成交级信号；quotes 的来源 | 生成 quotes 仍要读它 | `--trade-ticks` 0 个 trial；占目录约 69% | 拆 flag 可单独考虑；文件是 quotes 的输入 |
| `market/quotes.py`（102 行）、`quote`（23G） | 模拟爆仓 | `bars` 按设计距离报告不建模 | 2 个 trial，1 个真正用 quotes 撮合；ETH、SOL 的 0 个 | 保留 BTC 作保险；ETH、SOL 的 aggTrades 和 quotes 可停 |
| `--bar-symbols` 里 BTCDOM、DEFI、USDC、XAU | 无 | 规则已排除 | 没有 K 线，只存条款 | 可从配置删，代价很小 |
| `ide/overview`（1205 行，另有约 770 行前端） | 给人看的行情 | 无 | 研究和 paper 都不读 | 不算冗余研究代码；值不值取决于用户是否常看，没测 |

## Decisions

- 2026-11-05 用户看过方案后说“按方案做”：20261105-18 只改说明与读法，不改数值。修复从本记录出发，在新会话里提 PR。
