# 2026-10-20 Codex 首轮 EMA 根研究

| 项 | 值 |
|---|---|
| 会话 | Codex，rollout-2026-10-20T10-32-56-01a156f0…（主会话，01:32–02:07 UTC）；审查子会话 01a156ff… |
| 检出 / 账本 | 18556105a 起，会话中途另开 worktree；账本提交 jukomjhc … 2ed36vub，共 27 个；market 未写 |
| 用时构成（估算） | 研究约 35%，摸索命令与代码约 25%，修复约 30%，等待约 10%；回放本身约 2 分钟，占第二个回合（共 27 分钟）的 7% |
| 产品导致的无效试验 | 1（run 1，绑定字段名错配） |
| 按动作统计 | fix 10 / skill 9 / authority 6（含删减清单 U1–U5）/ measure 0 / none 1 |
| 复发 | 无（首份记录） |

## 发现

| id | 发现 | 证据（会话；产品） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261020-01 | 工作树不干净时，只读命令也被拒绝 | CALL 2；旧 metrics_revision(clean) | authority | 开局另开 worktree | 已修 #1594 |
| 20261020-02 | 写入端绑定字段名与加载器不一致 | CALL 59–63；replay/entry.py | fix | 1 次无效试验，约 6 分钟 | 已修 #1593 |
| 20261020-03 | 跑完基线就停；优先级没有报告依据 | 会话末尾；research-round | skill | 研究中断 | 已修 #1594 |
| 20261020-04 | 预检不走正式回放的加载路径 | CALL 48→60；replay/entry.py 预检参数 | fix | 绑定缺陷漏到正式回放 | 进行中 |
| 20261020-05 | 封存报告丢掉运行器的 6 条局限 | run_sealed.limitations=[]；ledger/metrics.py | fix | 用户报告缺警示 | 进行中 |
| 20261020-06 | 失败原因里看不到加载阶段的拒绝码 | run.failure_reasons；engine/run.py | fix | 要翻 stderr 才知原因 | 进行中 |
| 20261020-07 | 同一运行期失败逐条记录：10087 条，账本写入 9 MB | CALL 40–44；engine/run.py、ledger/problems.py | fix | 输出约 37 万 token | 进行中 |
| 20261020-08 | 拉镜像无超时 | CALL 13、32–35；runtime/image.py | fix | 卡 6.5 分钟 | 进行中 |
| 20261020-09 | `candidate new` 骨架用的是旧构造参数 | 探针改 3 轮；cli/main.py STRATEGY_STUB | fix | 读 engine 代码约 10 次 | 进行中 |
| 20261020-10 | `ledger sql` 报错丢掉服务器原文，修复建议是错的 | CALL 11、14；ledger/db.py | fix | 猜错表名、列名 | 进行中 |
| 20261020-11 | 空账本上 `research state` 拒绝执行，修复建议又指回它自己 | CALL 5–8；report/status.py | fix | 开局报错 | 进行中 |
| 20261020-12 | 读源码审查时扫全部提交历史 | qualification/availability.py | fix | 随轮数约成平方增长 | 进行中 |
| 20261020-13 | strategy-authoring 漏写 equity 返回字典、make_qty 抛错 | CALL 42 | skill | 1 轮修复，约 4 分钟 | 进行中 |
| 20261020-14 | skill 中的命令写法与 CLI 不一致 | USAGE_ERROR | skill | 1 次报错 | 进行中 |
| 20261020-15 | 根策略首份报告之前的修复被迫按“派生”登记 | 登记正文；template L.2.2.1 对 diagnosis F.1.1.2 | skill | 4 条空预测，起点不对 | 进行中 |
| 20261020-16 | 单次运行报告没有读信号表 | attribution.md 适用范围 | skill | 下一步选题无据 | 进行中 |
| 20261020-17 | 审查子代理继承作者的全部上下文 | spawn_agent 未设 fork_turns | skill | 独立性打折 | 进行中 |
| 20261020-18 | 仓位上限直接丢掉超额部分，规模被单分钟成交量随机决定 | positions.csv（约 9/27 笔） | skill | 配对比较混入噪声 | 进行中 |
| 20261020-19 | 缺完整命令序列、登记模板、参与率读法、典型耗时 | 17 次 --help，约 80 次读源码，30 次轮询 | skill | 约 100 万 token | 进行中 |
| 20261020-20 | 自写脚本算的指标未记 search_exposure | judgment 表 | skill | 搜索暴露少记 | 进行中 |
| 20261020-21 | run 2 的 metrics_revision 指向只存在于 PR 分支上的提交 | run_sealed.metrics_revision | none | 分支清理后无法在原版本重读 | 已打本地 tag 保留 |

## 删减清单

| 机制 | 防的风险 | 已被谁覆盖 | 会话所见 | 提议 |
|---|---|---|---|---|
| strategy binding.json / BINDING_MISMATCH | 跑的源码不是登记的源码 | CONTENT_HASH_MISMATCH、SOURCE_NOT_PUBLISHED、EXECUTION_IDENTITY | 只暴露了它自己的字段名错误 | 删（U1） |
| 试验计数把重放和产品先拒绝的试验算进去 | 多重检验漏计 | — | 越重放验证，结论越吃亏 | 排除（U2） |
| 无对照也要填比较设计；被重试的无效运行也要写解释 | — | — | 只产生仪式 | 放宽（U3） |
| `metric` 字段 / METRIC_UNSUPPORTED、NOT_A_CHECKOUT | 无 | — | 从未起作用 | 删（U4） |
| `ledger sql` 关键字黑名单 | 经 SQL 写账本 | reader 账号 | 误拦只读的 REPLACE() | 删（U5） |
| 捕获中的重复存储（源码 3 份、覆盖回执 2 份、指纹 2 份） | — | Dolt 按块去重 | 实际占盘 2.1 MB | 暂缓（U6） |
| REVIEW_CADENCE_RAISED | 复审到期前调高节奏，躲开复审 | — | 未触发 | 保留 |

## 决定

- 2026-10-20：用户批准 U1–U5，U6 暂缓；同时要求建立 doctor 机制，即本 skill。
