# 2026-11-07 随 trial 增长的性能与表现

| Item | Value |
|---|---|
| Sessions | 无被审研究会话。用户在本会话问：项目各环境是否会随长期研究 trial 增加而性能大幅恶化、表现大幅下降 |
| Audit session | Claude Code（桌面应用），claude-opus-5-5；worktree `trade-wt-trial-growth`，分支 `docs/doctor-trial-growth` |
| Checkout / ledger | origin/main ae3a2244a（本地 main 677413757 与它在 `report/`、`ledger/`、`qualification/`、`registration/` 无差别）。活动账本只读，head `dm80lcig3emlk5b68gdbnp62kk8c91rh`：2,399 trial（explore 1,194）、555 运行、598 候选、637 来源审查、1,932 判断、9,324 个 Dolt 提交、17 条线 |
| Coverage | 三个只读子代理：本地 CLI 与账本读写路径；IDE 与服务器；回放、Dolt 存储、市场、CI、paper/live 与多重检验。主会话实测：同一命令在 6 个历史账本提交（423→2,399 trial）上计时，`research status` 两种形式做 cProfile。**未覆盖**：服务器（#2415、#2423 之后未重测，需用户许可的只读 SSH）；写命令的耗时（审计不写账本，只读码）；前端在千级版本下的帧时间；DoltHub 克隆耗时 |
| Cost | 无研究时间可拆。审计：子代理合计 576,873 tokens，串行 1,058 s；主会话计时命令约 15 min 墙钟；主会话 tokens 未测。产品造成的无效 trial：无 |
| Net change | 拒绝码 254（上份记录 254）；skill 词数 25,624（同口径，上份 26,365）。提议：拒绝码、存储字段、skill 词数、机制均 +0；-154 到 -157 只改读路径的算法与批量，输出不变 |

结论：每条线自己的读数（`research state --line`、`research graph --line`）在账本 trial 从 680 增到 2,399 时保持约 7 s，不随别线增长；回放单个 trial、市场目录、CI、paper 都不随 trial 数增长。恶化集中在**按全账本计算的读数**：`research status` 与 IDE 的线列表，其中两处是平方级。按近三天每天约 700–1,000 个 trial 的速度，`research status --line` 会在一到两周内从 25 s 涨到几分钟。

## 历史提交上的同命令计时（Mac，本地 compose 账本）

| 账本提交 | trial | 运行 | `research status` | `line list` | channel 线 `research state` | channel 线 `research graph` |
|---|---|---|---|---|---|---|
| map44e8（10-29） | 423 | 140 | 1.95 s / 2.1 KB | 0.88 s | 9.4 s | 4.9 s |
| f0nd4dc（11-04） | 679 | 231 | 3.18 s / 2.9 KB | 1.19 s | 6.3 s | 6.7 s |
| i2h6egd（11-05） | 1,363 | 423 | 4.96 s / 5.5 KB | 2.57 s | 7.4 s | 6.5 s |
| dm80lci（11-07） | 2,399 | 555 | 6.94 s / 14.3 KB | 4.61 s | 7.7 s | 7.0 s |

channel 线 11-04 后不再增长，所以它的两列反映别线增长的影响。`research status --line`（skill 要求的形式）在 head 上：最长线 24.75 s / 256 KB，短线 26.0 s / 458 KB。

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261107-154 | **`research status --line` 的平均相关是全账本平方级纯 Python** | **产品**：`multiple_testing`（`report/status.py:357`）取与线同合约、窗口重叠的所有研究运行，跨线；现有运行全是 BTCUSDT 且窗口重叠，所以总体就是全账本。`mean_correlation`（`status.py:308`）逐对 `statistics.correlation`。**实测**：cProfile 134,421 对（约 519 个运行），13.2 s / 31.7 s，`multiple_testing` 共 15.5 s。**消费者**：research-round `review.md:8` 每次写推荐前读 `research status`、research-start 每次开会话读、nautilus-report-analysis 取 DSR 输入；`research state --full` 的 facts。**推算**：运行 ×5 → 约 5.5 min，×20 → 约 1.5 h（平方，不计查询） | fix（同一总体与同一结果，向量化成一次相关矩阵；numpy 已随 pyarrow 在环境中，需与现输出逐值对照） | minutes（实测 13 s/次，平方增长） | open |
| 20261107-155 | **`research status` 逐个重算全账本每个通过运行的可用性** | **产品**：`status.py:240-261` 对每个登记尝试调 `assess_listed`，各自 `load_run`（`ledger/metrics.py:252`，约 9 次查询并读全部 return 与 cycle 行），`--line` 也不缩小；`comparison_table`（`status.py:425`）再对窗口内运行各读一遍。**实测**：无 `--line` 时 78% 时间在 554 次 `assess_listed`（8.4 s / 10.8 s，3,461 次查询）；`--line` 时 808 次 `load_run` 10.9 s。耗时随 trial 1.95 s → 6.94 s（上表）。**推算**：线性，运行 ×5 → 约 40 s | fix（批量读运行事实；结果不变） | minutes（实测约 10 s/次，线性） | open |
| 20261107-156 | **`counted_trials` 对每个 explore trial 扫全部 trial 两遍** | **产品**：`status.py:174-221`，两处 `any(... for earlier in trials)`，E×T。**实测**：生成器 3.68M 次迭代，1.55 s。**消费者**：`research status`、`research counts`、`research graph`（`report/graph.py:152, 349`）；IDE 按（线，提交）缓存，所以每次 head 移动每条打开的线各算一遍全账本。**推算**：trial ×5 → 约 39 s，×20 → 约 10 min | fix（按身份元组建索引，单遍；结果不变） | minutes（实测 1.6 s，平方增长） | open |
| 20261107-157 | **`line list` 逐 trial 读、逐线重读全部线；IDE 在每次 head 移动时同步跑它** | **产品**：`report/graph.py:85` 对每条线 `line_members`；`ledger/lines.py:245-280` 对窗口内每个研究 trial 读一次启动收据（`_market_commit`，`:302`），`_keyed`（`:122`）每次重读全部线。IDE `ide/research_graph/serve.py:351-356` 在设新 head 前同步调用，图刷新等它。**实测**：0.88 s → 4.61 s（trial 423 → 2,399，线 6 → 17）。服务器早前比 Mac 慢 3–5 倍，约 15–23 s（推算，未测）。发布预热 `/api/lines` 探针 15 s 超时（`deploy/release_host.py:112`），失败每 5 s 重试、总限 1,800 s，第二次一般命中缓存，所以当前不会挡发布；产品子进程上限 600 s（`serve.py:142`）超过后才会每次失败 | fix（批量读启动收据，一次读线记录） | minutes（实测 4.6 s/次，线数与 trial 同增时超线性） | open |
| 20261107-158 | **本地账本数据目录 2.0 GB，其中 1.59 GB 是 11-01 起无人清理的 Dolt 临时文件；备份不剪枝** | **实测**：`trade-ide-ledger-1:/var/lib/trade-dolt/.dolt/tmp/buffered_file_byte_sink_1974208896` 1,593,835,520 字节，11-01 03:51；真实 noms 489 MB，blob 合计约 116 MB。`dolt-backups/research` 641 MB，11-07 一次同步新写 403 MB 归档，旧归档仍在。产品从不调 `dolt_gc`（ledger、cli、deploy 无此调用）。成因未查明，可能与 11-01 的整库恢复有关（未证实） | measure（查成因；删临时文件或剪备份属破坏性写，需用户授权） | unknown（磁盘，不随单个 trial 增长） | open |
| 20261107-159 | **写路径在事务内读全部来源审查、全部判断** | **产品**：`registration add` 经 `registration/seams.py:209` 与 `register.py:724` 的绑定步，各调一次 `availability.review_records`（`qualification/availability.py:209`）而不传已读记录，每次约 2 次 AS OF 查询 × 637 条审查；作为读实测 0.66 s/次。`require_line_records`（`register.py:540-582`）对每个线 trial 查一次 judgment × judgment_subject 全表合并（EXPLAIN 为 MergeJoin，OR 让索引失效）。写事务变长，并行线下 `CONCURRENT_WRITE` 窗口变大（-06 只修了重试）。写耗时未实测 | measure（隔离库按当前规模计时一次写） | unknown | open |
| 20261107-160 | **服务器在 #2415、#2423 之后未重测** | 11-07 的 209 s → 53 s 与 32 s 复用检查都早于这两项。-154 到 -157 在服务器的倍数未知 | measure（需用户许可只读 SSH） | unknown | open |

不列为发现（读过、无需动作）：

- **每线读数**：`research state --line`、`research graph --line` 在别线增长时不变（上表）；按本线长度线性增长，75 个版本的线 graph 9.8 s / 2.9 MB（含全部源码，供 IDE，skill 不要求 Agent 读）。-09（#2291）与 11-07 的审查重读（#2329，`graph.py:350` 一次读入后传下）在 main 上成立。
- **回放单个 trial**：提交检查各 0–0.1 s（`ledger/schema.sql:378-400`）；`_check_exposure` 只读同源 trial；推荐的比较表在写事务外（-08），每 5 个 trial 一次。
- **市场目录** 81 GB，随合约与月份增长，不随 trial；**CI** 不读账本与市场；**paper** checkpoint 删旧代（`engine/paper_redis.py:190-193`）。
- **Agent 读到的量**：`research state --line` 53–132 KB、`research status --line` 256–458 KB，research-start `SKILL.md:27` 已要求重定向到文件、只读所需键。
- **多重检验门槛不随 trial 数收紧**：按设计只报读数，-12 已改文字、-13 已驳回。

## Removal list

无。

## Decisions

无。
