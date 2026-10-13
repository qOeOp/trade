# P001–P009 测试分支的存储边界审阅

起始 Git：`99db440e06e79ecc1bbb48c2ac6591a3c052a6bd`。分支：`codex/rd-proposals-test-20261013`。
规范仅为用户指定 toc 与 proposal.md；P008/P009 替代旧逐步采纳语义。

2026-10-13，独立 Agent `/root/storage_review` 只读审阅现有 schema、records、artifacts、db 与提案。
结论：复用不可改的 evidence bundle 保存经产品验证的登记 JSON；复用 strategy_revision 的源码、父版本、difference。
不增加 research_plan、research_result、推荐状态、优先级分数或预算字段。

唯一新关系 `research_execution`：

| 字段 | 消费者及独立事实 | 为什么不能仅推导 |
|---|---|---|
| bundle | artifacts / audit：本次执行依据的事前登记 | 时间相近或同源码不能唯一确定登记 |
| strategy_source_sha256 | artifacts：被消耗的登记网格点 | 与 trial 重复是为 `(bundle, source)` 唯一约束，不产生第二种源码身份 |
| trial_id INT | CLI / audit：实际尝试，包括中断、无效 | 仅备注无法在并发写入时保证一次登记每点只执行一次 |

PK(bundle, source)，UNIQUE(trial_id)，外键指向 evidence_bundle、strategy_revision、trial；与 trial 在同一写事务内插入。
不新增时间字段：登记时间从 bundle、尝试时间从 trial 的服务器时间与 Dolt 插入历史读取。
执行前重验登记正文、父版本、对照、源码、输入与配置；不依赖 bundle 名称作为资格。
登记比较对照与研发父版本分开；父版本无需显著或目标达标，但要有通过完整性审计的登记回放。
无效、中断消耗该登记点，修复后另登记，不伪造独立经济证据。
比较结果只读派生；Agent 通过既有 evidence add 追加事实解释、优先级与推荐理由。

仅新建隔离 schema-v2 ledger 支持该入口；不迁移或修改活跃 schema-v1 ledger 和旧记录。
完整性、目标与已有 freeze/confirmation 保护保持原检查。freeze 是旧目标快照入口，不控制新候选的存在、派生或推荐。

## WS8b 与一分钟输入身份增补

用户追加授权真实 1m LAST/MARK 撮合。复用 WS8b 已审阅 market 表和 profile kind；没有新增 market 列。
独立 `/root/storage_review` 再审阅通过：现有 run.input_identity JSON 增加 export_content_sha256 与 exporter_source_sha256，登记锁定相同身份。
消费者为登记、回放、比较、恢复核验：market commit 证明源数据，不能证明主机导出器的版本和实际消费的 Catalog 字节。
内容指纹含相对路径、Catalog 字节、pool 正文及 export.json 语义，只排除导出用时 seconds。
另用完整原始目录临时指纹核验回放前后未变；不新增永久原始目录或时间字段。
实际执行周期由 receipt timeframe、effective_config.execution_bar_minutes 和 runtime-v6 共同核对，不添加重复列。

exporter_source_sha256 是规范化实现清单的总哈希：market/export.py、store.py、universe.py、records/artifacts.py 和 uv.lock 各自 SHA256；不声称覆盖未列出的主机代码。
