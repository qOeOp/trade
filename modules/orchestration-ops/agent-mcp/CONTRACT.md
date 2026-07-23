# orchestration-ops/agent-mcp

面向本地 Agent 的 MCP 门面；通过 stdio 暴露显式白名单读取能力与受控异步研发入口，并沿用 Owner CLI JSON 契约。

## Responsibilities

- 提供 toolset 能力搜索与单项读取。
- 提供 artifact catalog 查询、按 ID 的哈希校验正文读取、Market Data owner exact / bounded-page L2 retention/reference 审计、active L2 service health、resident book-watch consumer health、runtime parity 状态、RD program 状态和 ops cycle 摘要读取。
- 提供 RD memory + Control Plane 的只读 designer brief、hypothesis contract 校验/queue projection，以及 J04 研发任务的幂等提交、状态读取与终态结果读取。
- 固定调用目标、参数结构、超时和输出上限。
- 将 MCP 请求适配到既有 Owner CLI，不复制领域逻辑。

## Boundaries

- 仅支持本地 stdio，不提供网络监听。
- 不提供任意命令、脚本或路径执行能力。
- `research_job_submit` 只直接写 ops cycle/lock；后台执行必须经过既有 `trade-flow` J04 supervisor，领域写入仍由 research owner 完成。
- MCP 不接受裸 queue item；hypothesis 必须经过 `research.strategy-hypothesis-designer validate/queue_item`，且只有 `ready=true` 才能提交。
- `research_hypothesis_brief` 只调用 program-control `plan_next` 与 designer `context/render_prompt`；它不调用 LLM、不生成 contract、不写 program state。
- 新 program 由验证后的 queue item 初始化；已有可继续的 program 只能经 program-control owner 追加并恢复 `active`，暂停、预算耗尽和已有 shadow candidate 的 program 拒绝追加。
- `objective` 与 `budget` 只初始化尚不存在的 program；已有 RD program state 始终是权威来源。
- 不调用 Binance write，不修改交易或 governance 状态；`allow_live_writes` 固定为 `false`。
- `l2_retention_reference_audit` 只按 exact epoch ID 调用固定 Market Data owner action；不接受数据库路径、不直接查询 SQLite、不扫描文件，并继承 owner 的 `forbidden_no_gc_authority` 结论。
- `l2_retention_reference_audit_page` 只转发可选 `after_epoch_id` 与 `limit<=50`；游标排序、page hash、状态计数和无删除候选结论全部由 Market Data owner 生成。
- `l2_service_health` 无输入，只调用固定 L2 owner 脚本；不暴露 PID、receipt/log 路径或 lifecycle control，并在多 active supervisor 时继承 owner 的 fail-closed 结果。
- `l2_book_watch_consumer_health` 无输入，只调用固定 resident consumer owner read；仅返回 readiness、latest epoch/hash/timestamps、累计 reliability counters 与最近一次净化后的 failure timestamp/operation/class/attempt，不提供原始错误、depth delivery、策略信号、PID/路径或 lifecycle control。
- `runtime_parity_status` 无输入，只读取 ops owner 的累计 match/mismatch、最新双侧 hash 与 supervisor lease state；不返回 holder/PID/path/detail projection，不生成 cutover verdict。
- 同一 `request_id` 幂等；经 MCP 提交的研发任务共享带过期时间的 `research-rd` 锁。
- status/result 以 J04 状态为任务语义，并单独返回聚合 `cycle_status`；例如 J04=`blocked` 不会被 cycle=`failed` 覆盖。
- toolset 搜索结果只表示能力发现，不构成执行授权。
- Owner CLI 仍是领域行为和返回契约的权威入口。

## Run

```bash
bun modules/orchestration-ops/agent-mcp/src/scripts/main.ts
```

MCP host 必须以 stdio 启动该命令。当前只注册：`trade_tool_search`、`trade_tool_read`、`artifact_catalog_query`、`artifact_read`、`l2_retention_reference_audit`、`l2_retention_reference_audit_page`、`l2_service_health`、`l2_book_watch_consumer_health`、`runtime_parity_status`、`rd_program_read`、`ops_cycle_summary`、`research_hypothesis_brief`、`research_hypothesis_prepare`、`research_job_submit`、`research_job_status`、`research_job_result`。

可信仓库中的 Codex 会从 `.codex/config.toml` 加载 `trade-agent`；修改配置后需新建任务或重启当前 Codex 客户端，再用 `/mcp` 或 `codex mcp list` 检查连接。
