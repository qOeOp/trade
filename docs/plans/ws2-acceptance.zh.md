# WS2 验收记录：研究流程与记录层重写（2026-10-11）

范围见[重构计划](rd-round-audit-refactor-plan.zh.md) WS2（含原 WS3、WS6 和存储重新设计）。字段评审见 [ws2-ledger-field-review.zh.md](ws2-ledger-field-review.zh.md)，新库启用见 [ws2-ledger-enablement.zh.md](ws2-ledger-enablement.zh.md)。

## 1. 删掉了什么、加了什么

- **删除。** 以下内容整体删除：
  - 通用 objects/relations 存储和 attempt 契约：`dolt_store.py`、`store.py`、`contracts.py`、`projections.py`、`history.py`/`history.json`、`evidence.py`、`strategies.py`、`schemas/`；
  - 封存托管：托管目录、manifest 哈希、`artifacts verify/backup/restore/register`、0700 目录检查；
  - `find/show/compare/validate/contract/publish attempt/material retain`、强制 dry-run、写后回读、回执；
  - 研究用配对对照和 `compare --analysis`；
  - `runtime.LAYOUTS` 中 v1–v3 的旧布局（WS4 已合并，并已只读重读过 D11/D19）。
  
  `research/records` 的 Python 从 5,132 行（15 个文件）减到 2,995 行（12 个文件），另有 371 行 `schema.sql`；`tests/records` 从约 4,200 行减到约 1,500 行。
- **新增。** 主要有以下几部分：
  - 有类型的表 `schema.sql`；
  - 具名档案和服务生命周期 `ledger.py`；
  - 单连接、单事务的写入协议 `db.py`；
  - 记录 `records.py`；
  - RFC 3161 时间戳 `witness.py`；
  - 整轮审计 `audit.py`；
  - 产品的 MARK 回撤读数；
  - 探索读数 `artifacts report --dir`；
  - Parquet 导出和只读 SQL。

## 2. 测试

```bash
RESEARCH_DOLT_BINARY=/Users/vx/.local/share/trade/ledger-probe/dolt-20261009/bin/dolt-darwin-arm64/bin/dolt \
  uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'
```

全部 129 个测试通过，没有跳过。集成测试由测试自己在 `/tmp` 起临时 Dolt 2.4.2 服务，用完关闭并删除目录。如果当前使用的档案目录里有活动账本，测试拒绝运行。CI 现在只下载 Dolt 二进制、设置 `RESEARCH_DOLT_BINARY`，不再起常驻服务。

覆盖内容：
- 轮次与分支权限：写入只落在当前轮的分支；结束本轮后写入被拒；main 不可写；
- 写入账号只能插入：UPDATE、DELETE、REPLACE、TRUNCATE、DROP、`dolt_reset`、`dolt_tag`、`dolt_branch`、`dolt_checkout` 都被拒；
- `created_at` 取服务器时间；
- 幂等重放；
- 两个并发写入一个成功、一个收到 `CONCURRENT_WRITE`，没有被静默合并；
- 证据拒收空文件和媒体文件；
- 运行整份入库；审计不过的运行只保留原因；
- 冻结判定由产品计算，并核对窗口和试验计数；
- 确认要求窗口在未来、时间戳早于窗口、使用冻结源码；
- 更正走 `*_latest` 视图；
- 审计能发现绕过写入路径的改动；
- Parquet 导出和只读 SQL；
- 备份；
- 隔离账本不能用活动库的库名；临时账本命令结束后消失；
- 落后于 origin/main 的 checkout 不能冻结；
- 每条命令只开一个连接；
- 一份真实的 DigiCert 时间戳凭证能离线验证，换一个 commit 或改动字节都会被拒。

实施中测试抓到一个真实问题：只把 `ledger_head.seq` 改成同一个值时，两个并发写入会被 Dolt 当作相同修改合并。所以 `ledger_head` 保留了每次写入唯一的 `op_id`，详见字段评审。

## 3. 产品读数核对

rebase 到 #1530 之后，新结构保留了它的两项行为：
- `closed_by_year`：按平仓年份拆分已平仓周期的价格盈亏、手续费和资金费。它不存成 run 表的列，而是从已存的持仓行和成交行读出时算出（`artifacts report` 和 `tables()` 都会给出），所以不新增字段。规则沿用 [closed-by-year-field-review.zh.md](closed-by-year-field-review.zh.md)：整个周期归平仓年；未平仓的不计；没有平仓时为 `{}`；`ts_last` 缺失时只有这一项为 null。
- 探索回放的结果带 `readings`：与正式报告同一套读数，从未经校验的临时报告读出；报告不完整或回放没过检查时，读数为 null 并写明原因。

#1530 的 5 条测试已按新结构改写保留。失败部件的取值与 WS9 共识第 5 项的表一致：完整性对应"审计判 invalid"，在新结构里记为判定 `invalid`、失败部件为空；`failed` + `integrity` 只用于审计通过、但 Agent 自己发现的完整性问题。


新的 MARK 回撤读数在两份旧封存的报告上重算，结果如下：
- D19-C37：5.85%；
- D11-C37：9.70%。

当时 Codex 的读数是 5.85% 和 9.71%。WS1 验收脚本对 D19 给出 5.91%，原因是它把账户事件时间截到整秒，下一根 K 线收盘时刻的成交被算进了上一根。产品采用的规则与 nautilus-report-analysis 一致：取下一根 K 线时间之前的最新账户状态。

## 4. 规模（约本轮 10 倍）

在临时库里造出以下数据：
- 1,500 条 trial；
- 50 个策略修订；
- 250 个封存运行，每 5 个里 4 个用 D19-C37 的真实报告，1 个用 D11-C37 的；
- 100 条冻结；
- 110 个证据 bundle，共 6,160 个文件、1.21GB。

运行子表共 57.7 万行订单、27.3 万行成交、6.95 万行持仓、209 万行账户。数据目录 2.5GB。

入库耗时（中位数）：D19 规模每个运行 1.4 秒，D11 规模（1 万张订单）每个 10.0 秒。

| 常用操作 | 耗时 | 连接数 |
|---|---|---|
| `round status` | 0.009 秒 | 1 |
| `artifacts report`（D19 / D11 规模） | 0.011 / 0.026 秒 | 2（已修为 1，见下） |
| `ledger sql`：250 个运行的订单按运行聚合（57.7 万行） | 0.997 秒 | 1 |
| `ledger sql`：单个运行按品种和状态聚合 | 0.003 秒 | 1 |
| `ledger sql`：冻结最新结果、运行读数、不同策略源数 | 0.002–0.004 秒 | 1 |
| 写冻结（含按开发窗口统计试验） | 0.071 秒 | 2（已修为 1） |
| 写 trial | 0.016 秒 | 1 |
| `tables(run)`（D19 规模；带账户和暴露序列） | 0.14 秒（0.91 秒） | 1 |

- **连接数恒定。** 测量时 `artifacts report` 和冻结各开了 2 个连接（读一次、写一次），之后改为整条命令共用一个连接，并用 `test_every_command_uses_one_connection` 守住。旧 `find` 一次要约 12,450 个连接，现在连接数与账本规模无关。
- **两个读取并发：** `round status` 与 `artifacts report` 各连续 10 次同时进行，没有错误。
- **两个写入并发：** 重复 5 次，每次都是一方写入、另一方收到 `CONCURRENT_WRITE`，没有一次被静默合并。
- **整轮审计：** `ledger audit` 在这个规模上用时 390 秒，因为它要从存储的行重算 250 个运行的读数。它不是常用查询，这个耗时只作记录。

## 5. 端到端演示

演示在临时隔离账本 `ws2-demo` 上进行：服务在 `/tmp/w2d`，镜像为 main 镜像 `ghcr.io/qoeop/trade-runtime@sha256:c863014e…`，revision `411faf2c`。输入为 R1 Catalog 中的 BTC、ETH 两个币，全年窗口。策略是 WS1 演示策略的 v4 版本（每小时一个原生 bracket，一个工程演示，不是研究）。演示用的库和目录用完已删除。

1. `ledger init`、`round open --goal`：开轮，goal `WS2-DEMO-2`，提交 `bf09c8vs…`。之前还有一次失败的开轮：goal `WS2-DEMO-1` 的窗口与 Catalog 区间不符，探索回放被运行器拒绝。按规则，改窗口就是新 goal，所以先 `round close` 打了 `closed/WS2-DEMO-1` 标签，再开新的 goal。这次失败发生在第一版演示里，可以看作对"目标不可改"的一次实操检验。
2. 探索回放：耗时 9 秒，写了 1 条 trial。随后 `artifacts report --dir` 给出门槛：878 个已平计划，计划胜率 0.503，年化 −0.82%，MARK 回撤 2.07%，收益回撤比 −0.40。**从开轮到第一次经济读数用了 12 秒**；基线约为 1 小时 50 分。
3. 发表 `plan-demo@1` 和 `plan-demo@2`（后者是派生修订，名义仓位由 2% 改为 3%）。生成输入身份，作为 `/tmp` 里的工作副本。
4. 两次封存回放：每次约 15 秒，审计（含 WS4 的裸仓审计）通过后整份入库，得到 run 1 和 run 2，提交分别为 `sdkivu87…` 和 `2dmm9fob…`。前后检查 `/tmp/trade-run-*` 都是 0 个，临时目录已被删除。
5. `freeze --run 2 --failed-part gross_edge`：
   - 新鲜度检查通过；main 镜像检查通过；
   - 判定 `failed`：计划胜率、年化和收益回撤比三道门槛未过；
   - `distinct_sources = 2`，即一份草稿加 `plan-demo@2` 的源码；
   - 冻结提交 `e5p84mfc…` 由 DigiCert 盖了 RFC 3161 时间戳（`2026-10-11T07:16:03Z`），凭证另起一个提交入库。
6. `ledger audit`：`ok`，核对了 2 个运行、1 条冻结。`round close` 打标签 `closed/WS2-DEMO-2`，提交 `qo7kgv4j…`。
7. `ledger export --at closed/WS2-DEMO-2`：每张表导出一个 Parquet，其中 run_order 7,674 行、run_order_event 29,072 行、run_account 20,022 行。在标签上用 SQL 跨运行统计订单：两个运行各 3,837 张订单，成交名义分别为 345 万和 517 万 USDT。Parquet 的计数与 SQL 一致。
8. `ledger backup`、`ledger status`。

## 6. 纸面重放（本轮 RONNIE-RESTART-20261011 按新流程走一遍）

做法：由一个只读子代理读取本轮目录（`RD-history-audit.zh.md`、`goal-contract.json`、各视频 bundle 的 identity、文件时间戳）和旧账本（`find --text RONNIE-RESTART-20261011`，47 条，账本提交 `870q3p8c…`），逐个 attempt 映射到新流程。

| 原来 | 新流程 |
|---|---|
| S01、S04/S05 的来源部分、S09/S11/S16/S18 复核 | 8 个视频 bundle 加 1 份笔记 bundle；复核轮次删除 |
| D01–D04、S02/S03、S07、S22/S23 | 不登记的探索（定义、调试） |
| D05、D15–D18、D23/D24 | 约 8 次探索回放，各写 1 条 trial，`report --dir` 当场给出门槛 |
| D06（换镜像加 exposures、配对对照）、D11-CONTROL | 删除：exposures、MARK 回撤已是标准报告，研究不再做配对对照 |
| D07–D10、D12–D14、D20/D21（风险、保护、分次成交 reader，为 5% 上限申请授权） | 删除：WS4 只留完整性，裸仓由产品审计；仓位是 Agent 的设计变量 |
| S06/S08/S10/S13 及 S15/S17/S19/S20/S22 的容量部分 | 删除：WS1 去掉了跑前的容量扫描 |
| D11 | P3：封存 37 币回放，写失败冻结（gross_edge） |
| D19 + D22 | P5：封存回放，按产品读数写失败冻结（gross_edge） |
| D25 和各探针 | `/tmp` 里的 Nautilus 探针，不写账本；出现裸仓的运行由审计判 invalid |

| 指标 | 基线 | 新流程（估算） |
|---|---|---|
| 登记记录 | 47 个 attempt（102 个 revision）、605 个 material | 2 条冻结（都失败），0 条确认 |
| 账本写入 | — | 约 26–35 次：开轮和结轮 2 次、策略修订 2–7 次、trial 约 10–12 次、封存运行 2 次、证据 bundle 9–13 次、冻结 2 次 |
| 持久文件 | 1,543 个（dry-run 加回执占 639 个，41%） | 0 个 |
| 不再需要的手写 reader | 64 个、6,205 行 | 约 2,450 行不再需要：风险和保护 reader 约 1,600 行、经济 reader 约 260 行、容量 reader 约 590 行 |
| 到第一次经济读数 | 约 1 小时 50 分 | 约 25–45 分钟：P1 或 P3 发表后直接跑 37 币探索（全 37 币回放约 1 分钟），用 `report --dir` 读门槛；两币 pilot 只有 76 个已平计划，达不到样本门槛 |

几点观察：
- **会改变的。** 有两处：
  - P5 的读数在 D19 回放结束时就有了，不必经过 D20/D21（约省 25 分钟），也不会出现 D21 那次授权申请。
  - P4 在第一次探索时就会因样本不足（S06 只找到 10 个几何）被否掉。
- **停止规则不会触发。** 失败冻结只有 2 条，不到 3 条；不同策略源约 7 个，不超过 20 个。S 线约 2 小时 40 分的事件研究照样可以做，少掉的只是容量那一半。
- **规则漏洞（已修）。** 旧写法"只冻结准备确认的修订"会让失败的候选永远不被冻结，停止规则的计数器也就永远不动。现在 feasibility.md 和 SKILL.md 改为：每个候选在停止开发时冻结一次；没过门槛的按原样记为失败冻结；过了门槛的先缩放，再冻结缩放后的修订。
- **防不住的。** 以下几类问题新流程也防不住：
  - 来源本身的歧义（锚点、档位权重）；
  - 在不同题目之间来回切换（family 删掉了，但换题不受限）；
  - 毛收益为负；
  - 所有窗口都已暴露、无法确认；
  - 写出部分成交后保护被撤的代码：审计只会判这类运行 invalid，正确写法靠 strategy-authoring；
  - 探索时调用已退役服务：新鲜度检查只在冻结和确认时拦。

## 7. 评测

做法沿用 [skill 产品形态审计](skill-product-form-audit.zh.md) 第十二节：`claude plugin eval`，被测 Opus 5.5，评分 Sonnet 5.5，每臂 3 次，每个回答三票、两票通过即算通过。结果放在 Git 外的 `~/.local/share/trade/skill-evals/research-round/20261011-ws2/` 和 `.../nautilus-report-analysis/20261011-ws2/`。

用例按新流程改写：
- 去掉 attempt、封存、登记确认实验等说法；
- `gate-fail-not-rescued-by-size` 第 4 题改为：允许把现有开发期运行记为失败冻结，但不允许放大仓位或改目标来冻结；
- `own-sizing-not-user-constraint` 第 4、5 题改为：缩放一次后跑一次、冻结那次运行；
- `trigger-negative`、`reads-through-tables` 改为"已入库的运行"。

| 轮次 | skill | 结果（加 skill / 不加） |
|---|---|---|
| 第 1 轮（初版重写） | — | 5 个通过；own-sizing 2/3：回答没有用数字核对与仓位无关的门槛，缩放也没有指向预算的 2/3 |
| 第 2 轮（把门槛和缩放写进 SKILL.md） | — | own-sizing 3/3；vague-direction 2/3：把一个组合的失败当成"支撑阻力本身不成立"，原因是重写时丢了"整体结果只评判这一组组合"这句 |
| 第 3 轮（补回这句） | — | vague-direction 2/3：先安排了事件研究，却只给后面的回放写了结果对应的动作 |
| **最终**（"先写结果对应的动作"适用于任何测试） | `SKILL.md` SHA-256 `37fee56e…` | **18/18 对 4/18**：exposed-window 3/3 对 0/3，gate-fail 3/3 对 1/3，l3-touch 3/3 对 0/3，own-sizing 3/3 对 2/3，stability 3/3 对 1/3，vague-direction 3/3 对 0/3 |

- 触发用例跑在 SKILL.md 正文最后几处修改之前，描述行没有变：该触发时 5/5 触发，不该触发时 3/3 没触发且答对。
- nautilus-report-analysis（措辞改为"已入库的运行"，`tables(run_id)` 从账本读）3 个用例：加 skill 9/9，不加 3.75/9。
- 最终一轮评测进行期间，runs.md 补进了 #1530 的两句说明（探索读数、按年拆分），SKILL.md 没有改。
- 花费约 27 美元（订阅额度内的估算）：方法用例 4 轮，约 23.6；触发 0.8；nautilus-report-analysis 2.8。
- 局限：每臂只有 3 次；只评了 Claude；没有跑 Git 外的留出用例，它们仍按旧流程出题，需要另行改写后再作验收。
