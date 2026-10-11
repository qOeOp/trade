# WS2 研究账本字段评审（2026-10-11）

按 AGENTS.md，新增表和字段前做了独立子代理评审。本文记录评审意见和最终决定，表结构以 [`research/records/schema.sql`](../../research/records/schema.sql) 为准。设计前提见 [重构计划](rd-round-audit-refactor-plan.zh.md) WS2 第 11 条，这里不重议。

## 评审对象和方式

- 对象：实施前的表结构草稿，包括 goal、source_note、strategy_revision、trial、run 及其报告子表、freeze、confirmation_plan、confirmation_verdict、correction、evidence，外加 ledger_head 和 ledger_schema。
- 方式：一个不了解实现过程的子代理，只读重构计划、AGENTS.md、运行器的报告代码、analysis.py 和 feasibility.md，逐表回答三个问题：谁读这一列、为了什么决定；它记录的独立事实是什么；能否由已有字段、关系或推导表达。

## 采纳的意见

| 意见 | 决定 |
|---|---|
| source_note 只是"哪个 bundle 里的 claims.json 是本 goal 的笔记"的指针 | 删除该表。freeze 外键到 `evidence_bundle`，写入时检查该 bundle 里有 `claims.json` |
| evidence 一次写一整份 bundle，`op_id` 不该挂在文件行上 | 新增 `evidence_bundle(bundle, op_id, created_at)` 头表，文件行不带 `op_id` |
| `sha256`、`byte_length`、`source_sha256` 都能从内容算出 | 改成 `SHA2(...)` / `LENGTH(...)` 的 STORED 生成列，唯一键保留 |
| 镜像和窗口同时存在 trial、run 和 `effective_config` 里，会漂移 | trial 是唯一来源（`image_ref`，digest 为生成列；`input_start`、`trade_start`、`trade_end`）。run 不再有这些列，也不再有 strategy 列：运行 → trial → 源码哈希 → strategy_revision（源码哈希唯一） |
| `return_drawdown`、`plan_win_rate` 可推导 | 改为生成列：`annual_return / max_drawdown`，`plans_won / (plans_closed + plans_open)` |
| `annual_return`、`final_equity_usdt` 已在 summary 里 | 改为从 summary 取的生成列 |
| 版本类字段已在 `runtime_inspection` 里 | `runtime_contract`、`nautilus_version`、`dependency_lock_sha256` 改为生成列 |
| `effective_config_sha256`、`input_identity_sha256` 存下来会与 Dolt 规范化后的 JSON 对不上 | 删除，需要时重算 |
| `cost_basis` 没有新事实 | 改为视图 `run_cost_basis`：按流动性方向从成交行算出的费率；账户条款读 `effective_config.native_account`。不由 Agent 填写 |
| 报告子表的类型列和 `raw` 是同一事实 | 以 `raw`（原生 CSV 行的字符串原样）为准，类型列由它生成。例外：`run_order.tags` 和成交、账户的纳秒时间戳，原生格式是 Python repr 或带时区的时间文本，SQL 无法可靠转换，由写入代码一次算出；`ledger audit` 按 `raw` 重算读数来核对 |
| 时间精度不一致 | 原生报告行一律纳秒 BIGINT；记录层的窗口（goal、trial、confirmation_plan）用 UTC `DATETIME(6)` |
| `failure_reasons` 与 `status` 要互相约束 | 加 CHECK：invalid 必有原因，passed 必无；invalid 运行不得有读数和 exposures |
| `integrity` 既是结果 invalid 又是失败部件之一 | 规则：invalid 只来自产品（运行审计不过），此时失败部件为空；审计通过、但 Agent 自己发现的完整性问题，记为 failed + integrity |
| 冻结要的 MARK 回撤不在产品读数里 | 产品新增 `max_drawdown` 读数（交易窗口内原生 MARK 权益回撤，规则同 nautilus-report-analysis 的资本占用规则），写入 run 的真实列 |
| 读数由宿主机代码算，镜像的 main 检查覆盖不到 | run、freeze、confirmation_verdict 各记 `reader_revision`，即写入时 CLI 所在的 Git commit |
| goal 不限行数 | 单行主键 `singleton`，另有提交测试 |
| 同一运行可能被重复引用 | `freeze.run_id`、`confirmation_verdict.run_id` 唯一；提交测试拒绝冻结运行被拿去做确认 |
| `trial.end` 是保留字；停止规则要按时间统计 | 改名 `trade_end`；`created_at` 加索引 |
| `confirmation_plan.rule` 若复述门槛则冗余，若自定则无法核验 | 删除。确认的判定由产品按用户三项目标、全额回撤预算和 100 个计划的样本下限计算 |

## 没有采纳或改了做法的意见

- **`ledger_head.op_id` 保留。** 评审认为它与各记录自己的 `op_id` 重复，建议删掉。实测（Dolt 2.4.2）证明不能删：两个并发写入如果只把 `seq` 改成同一个值，Dolt 认为是相同的修改而自动合并，后到者不会收到 1213。每次写入把这一行改成自己唯一的 `op_id`，两次修改才互相冲突。集成测试 `test_a_retry_returns_the_original_and_a_race_is_refused_not_merged` 正是先在没有这一列时失败，才发现这一点。
- **进度检查没有记录载体。** 两类记录的决定不变，进度检查写在下一次冻结的 note 里，或停下时写给用户；`round status` 给出计数（失败冻结数、上次冻结以来的不同策略源数、是否到检查点）。"连续两次检查既无排除也无佐证就交给用户"只由 skill 约束。
- **缩放修订。** 冻结引用缩放后那次运行，门槛在冻结里一次算完，包括年化收益下限。缩放修订是另一个策略源，计入 `distinct_sources`；feasibility.md 写明这一点。
- **WS8b 的输入身份。** 现在 `run.input_identity` 仍是目录树哈希（含本机路径）。WS8b 改为市场数据 commit 时，再按本流程评审新字段。

## 按年拆分（#1530）不新增字段

`closed_by_year` 是产品读数，但能从 `run_position` 和 `run_fill` 的已存行完整推导出来（周期的 `ts_last`、价格现金流、手续费和资金费），所以读时计算，不存成 run 表的列。规则见 [closed-by-year-field-review.zh.md](closed-by-year-field-review.zh.md)。

## 每张表留下的独立事实

| 表 | 独立事实 | 主要读者 |
|---|---|---|
| ledger_schema | 当前 schema 代数 | CLI、读旧标签的人 |
| ledger_head | 写入序号和最后一次写入的 `op_id`（并发守卫） | 写入路径 |
| goal | 用户三项目标、回撤口径、开发窗口、已暴露窗口 | 冻结、确认判定，试验计数 |
| evidence_bundle / evidence | 派生证据的原始字节 | 来源笔记、冻结 |
| strategy_revision | 源码字节、入口类、运行时契约、父修订与差异 | 运行器、冻结、确认 |
| trial | 每次回放的模式、源码哈希、镜像、币种、窗口、服务器时间 | 冻结的试验计数、停止规则 |
| run | 运行时检查结果、生效配置、输入身份、审计结论、产品读数、读数所用代码版本 | 冻结、确认、审计 |
| run_order / fill / position / account / return / order_event，`run.exposures` | 原生报告的行 | 描述统计（`tables()`）、审计重算、WS4 的裸仓审计 |
| freeze | 判定、失败部件、冻结当时的试验数、引用的来源笔记 | 停止规则、确认、更正 |
| confirmation_plan | 预登记的窗口 | 确认判定（再配合该计划提交的 RFC 3161 时间戳） |
| confirmation_verdict | 确认判定 | 收尾、更正 |
| correction | 对某一判定的追加更正 | `freeze_latest`、`verdict_latest` 视图 |
| witness | 冻结或确认计划提交的 RFC 3161 时间戳凭证 | `confirm verdict`（计划盖戳早于窗口起点）、`ledger audit` |

## 补充评审：外部见证改为 RFC 3161 时间戳（2026-10-11）

GitHub 免费账号的私有仓库不能加规则集（API 返回 403），用户选择不用见证仓库，改为 RFC 3161 时间戳：冻结或确认计划的提交落地后，CLI 把 32 位 Dolt commit hash 的 SHA-256 发给公共时间戳机构（DigiCert，失败再试 Sectigo），签名回执由第二次写入存进新表 `witness`。验证离线进行：`openssl ts -verify` 对照仓库里固定的根证书 `research/records/tsa-roots.pem`，按凭证自身的时间（`-attime`）验证，所以签名证书过期后仍可验证。新增表前做了独立子代理评审：

| 列 | 结论 |
|---|---|
| `commit_hash` | 保留：被盖戳的事实，两个读者（`confirm verdict`、`ledger audit`）靠它找凭证。加长度约束 |
| `token` | 保留：genTime、机构身份和签名只在这里。加非空约束；写入前核对 granted、消息摘要和证书链 |
| `op_id` | 保留：幂等，且每次写入要改 `ledger_head` |
| `tsa_url` | 删除：没有读者，是客户端自报、无法核验的值；身份看凭证里的签名证书 |
| `created_at` | 删除：权威时间是凭证的 genTime，另存服务器时间容易被误当成盖戳时间 |
| genTime、kind、record_id | 不存：genTime 存成列就是没验过的副本；记录由 `dolt_diff_freeze` / `dolt_diff_confirmation_plan` 的 `to_commit` 得出 |

约束：提交测试 `witnesses_stamp_freeze_or_plan_commits` 要求每个凭证对应本分支上新增冻结或计划的提交；CLI 写入前自己再查一次（提交测试可被 `--skip-verification` 跳过），`ledger audit` 复查。一个提交只存一份凭证：事后补戳的时间一定晚于原提交，对"盖戳早于窗口起点"没有用处。

残余风险：时间戳只证明记录在那时已经存在，不证明它是唯一的一份。GitHub 只追加清单能看出登记过什么；换成时间戳后，用 root 在别的分支上多登记几份、只亮出有利的那份，查不出来。写入账号只能写当前一轮的分支，这需要 root；兜底靠试验计数和停止规则。
