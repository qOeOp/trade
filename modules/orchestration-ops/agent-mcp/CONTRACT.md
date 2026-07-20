# orchestration-ops/agent-mcp

面向本地 Agent 的只读 MCP 门面；通过 stdio 暴露显式白名单能力，并沿用 Owner CLI JSON 契约。

## Responsibilities

- 提供 toolset 能力搜索与单项读取。
- 提供 artifact catalog 查询、RD program 状态读取和 ops cycle 摘要读取。
- 固定调用目标、参数结构、超时和输出上限。
- 将 MCP 请求适配到既有 Owner CLI，不复制领域逻辑。

## Boundaries

- 仅支持本地 stdio，不提供网络监听。
- 不提供任意命令、脚本或路径执行能力。
- 不调用 Binance write，不修改策略、RD 状态、交易状态或 governance 状态。
- toolset 搜索结果只表示能力发现，不构成执行授权。
- Owner CLI 仍是领域行为和返回契约的权威入口。

## Run

```bash
bun modules/orchestration-ops/agent-mcp/src/scripts/main.ts
```

MCP host 必须以 stdio 启动该命令。当前只注册：`trade_tool_search`、`trade_tool_read`、`artifact_catalog_query`、`rd_program_read`、`ops_cycle_summary`。
