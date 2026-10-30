# 运行指纹不再存逐 UTC 日哈希

2026-10-30。doctor 发现 20261025-33（诊断记录 `docs/plans/doctor/2026-10-30-codex-01a1856e-full-audit.zh.md`，PR #1899）。用户 2026-10-30 批准移除存储指纹里的 `by_utc_day`，旧行不改。按 AGENTS.md，存储字段变更先经独立子代理评审，本文记录决定与评审。

## 决定

- 运行行 `run.fingerprints` 每表只存 `rows`、`sha256` 与（逐字节稳定的表）`file_sha256`；入账时由宿主去掉镜像写出的 `by_utc_day`（`ledger.stored_fingerprint`，经 `ledger.capture_fingerprint` 取指纹的各处都拿到这一形态）。
- 比较两份指纹时两边都去掉 `by_utc_day`：`replay.reproduce` 与 `report.verify_reproduction` 把运行行一侧也过一遍 `stored_fingerprint`。早先入账、仍带逐日映射的行照常匹配；账本只追加，旧行不改写。
- 不改镜像与 `engine/`：`engine/compare.py` 属运行身份（`fingerprint_source_sha256`），改它要新镜像摘要并影响旧运行的复现。镜像照旧写出完整的 `fingerprint/fingerprint.json`，执行封存照旧记它的哈希。

## 为什么

- 无读取方：`by_utc_day` 只由 `engine/compare.py` 产出；`replay/reproduce.py`、`report/runs.py` 比较整个字典，`qualification/availability.py` 与 `ledger.sealed_rows` 只读 `rows`；skill、IDE 服务与设计站没有读它的地方。
- 体量：01a1856e 会话 47 个运行指纹合计 10.99 MB，占会话 blob 增长约 18.7 MB 的 59%；01a1856b 会话 65%。10-25 计量单个运行约 95 KB。

## 评审

独立子代理只读代码评审，结论：批准，附意见。

| 问题 | 评审所见 | 处理 |
|---|---|---|
| 消费者 | `by_utc_day` 无宿主读取方；`run.fingerprints` 只被整字典比较（`replay/reproduce.py`、`report/runs.py`）、只读 `rows`（`qualification/availability.py` `_counts`、`ledger.sealed_rows`）或原样转出（`ledger/admin.py` 的 `replay_identity.fingerprints`、`ledger/metrics.py`）；`report/review.py` 读了但不用 | 如上决定 |
| 独立事实 | 无：逐日哈希与整表 `sha256` 出自同一批规范化行，每行含时间列，整表相等即逐日相等；它只帮助定位，不加强任何判定 | 去掉 |
| 核对强度 | 不减：正式运行的执行封存仍记完整 `fingerprint.json`（含逐日映射）的哈希，`ledger/reproduction.py` `matches` 比较两边文件哈希，两处宿主比较都要求它；逐日哈希不同的复现照旧拒绝（新测试 `new-row-moved` 覆盖） | 保留不动 |
| 定位复现失配 | 失配时复现目录保留，其 `fingerprint.json` 仍有逐日映射；旧行仍有原逐日映射可对照。`run_return` 可定位日收益与当日平均名义敞口的首个不同日；`run_cycle` 可定位不同的持仓周期及其时刻；`engine/compare_reports.py` 只能比较两次新的重放（原件是缓存，已不在），定位的是不确定性而非与原件的偏离。新行定位不到的只有：只出现在订单、成交、账户、订单事件或敞口、而不影响日收益与持仓周期的失配所在的那一天；哪张表仍由每表 `sha256` 指出 | 接受：本会话与 10-25 会话都未触发过这种定位需求，体量是 blob 增长的大头 |
| 差异正确性 | 未见缺陷：None 与非映射原样返回，两边同一函数，新旧行都正确 | — |
| 意见：`ledger/admin.py` 导出原样给出 `fingerprints`，新旧行形态不同 | 外观问题 | 不改：导出给的是所存事实，形态差异正是存储变化本身 |

## 不在本项

- 预检的执行封存保留指纹文件原件（`ledger/execution.py` `_capture_files`），其中仍有逐日映射。那是镜像输出的封存字节，按哈希核对；去掉它要改镜像，不在用户批准的范围。
- 设计站「报告存储字段决定」（`report-storage-fields.zh.md`）审阅表里「每表给行数、整表哈希与逐 UTC 日哈希」是当时的决定，本项只改存储，不改那份历史记录。
- 索引行在 #1899 合并前不动，由合并后的索引更新跟进。
