# Crypto Trade Workspace

这是一个自用的 agent-native 加密交易工作仓库：把市场观察、账户恢复、技术分析、策略 R&D、执行预演、真实下单与复盘审计，拆成可被 Codex / Claude / Gemini 等 agent 直接调用的 skills。

本仓库默认面向真实 Binance USDM `live-small` 运行；安全边界不靠默认 dry-run，而靠权限配置、preflight、execution contract、显式 `--yes` 与交易所事实回读 / reconcile。

项目已经不再只是文档编辑阶段。`docs/` 仍是产品和架构契约入口，`.agents/skills/` 已经承载主要可运行能力。

## 当前状态

| 层级 | 已有实现 |
| --- | --- |
| 市场观察 | 全市场初筛、单标的快照、aggTrades、liquidation-like zones、OHLCV 落盘 |
| 账户恢复 | Binance USDM 余额、持仓、普通挂单、保护单、symbol-scoped 历史订单 |
| 技术分析 | 多周期指标、支撑阻力、趋势线、结构验证、BTC beta、feature series |
| 计划收敛 | order preview、execution contract 编译、preflight hard guards、decision card |
| 执行动作 | USDM 主单、保护腿、减仓 / 全平、撤单；真实写接口均需显式授权 |
| 事件流 | `trade.db`、`plan_event`、observe / order_fill / review、reconcile、flow state |
| 调度运行 | 单 automation supervisor、subagent fan-out、slow / fast dry-run、cron runtime、shadow / live-small 相关契约 |
| 策略研发 | replay、benchmark、calibration suite、strategy R&D campaign、evidence ledger、promotion gate |
| 运维通知 | notify dispatch 配置、cron log fallback、helper scripts、项目级 quality check |

## 目录地图

| 路径 | 作用 |
| --- | --- |
| `.agents/skills/` | agent 可调用能力。每个 skill 自带 `SKILL.md`、脚本、测试与本地依赖 |
| `strategies/` | 项目级 strategy policy；frontmatter + `## Trade Contract`，进 Git、可 review、可 diff |
| `docs/` | vision / PRD / 架构 / 技术契约 / 检查契约 / R&D 记录 |
| `data/` | 可审计运行数据，如 trade DB、strategy evidence、R&D ledger、OHLCV |
| `profile/` | 本地交易配置、账户/通知兼容配置；凭证通过环境变量进入 |
| `scripts/` | 仓库级 helper 与质量入口 |
| `tmp/` | 本地实验、panel、replay、report 等可再生成材料 |

## 主要能力

### Observe

- `binance-market-scan`：Binance USDM 全市场 long / short 候选初筛。
- `binance-symbol-snapshot`：单标的 24h、盘口、mark/index、funding、OI 与轻量 K 线快照。
- `binance-account-snapshot`：账户余额、持仓、普通挂单、保护单与 symbol 历史订单恢复。
- `binance-aggtrades-fetch`：近期聚合逐笔成交原始材料。
- `binance-liquidation-zones`：基于公开成交与快照推断 liquidation-like cluster。

### Data And Analysis

- `ohlcv-fetch`：抓取 Binance USDM OHLCV，写出 `CSV + manifest.json`。
- `tech-indicators`：读取 manifest，计算指标、结构、支撑阻力、趋势线、BTC beta 与 feature series。

### Plan And Execute

- `binance-order-preview`：只读预演订单形状、路由、参考价、warnings，并编译 execution contract。
- `plan-preflight`：EXECUTE 前最后一道只读闸，输出 `armable / blocked / abstain`。
- `binance-order-place`：USDM 主单开仓 / 加仓。
- `binance-position-protect`：止损、止盈、trailing 保护腿。
- `binance-position-adjust`：已有仓位部分减仓或全平。
- `binance-order-cancel`：普通单与 algo 条件单撤单。

### Flow, Recovery, R&D

- `trade-flow` 是主流程 glue：初始化 `trade.db`、写入事件流、执行 dry-run / shadow / live-small、恢复 flow state、补 reconcile 事件、跑 replay / benchmark / strategy R&D / calibration / promotion review。
- `notify-dispatch` 是通知出口：按 `profile/notify_config.json` 和环境变量发送通知，并始终落 `data/cron.log` fallback。

## 运行模型

核心链路：

```text
OBSERVE
  -> current plan / action_intent
  -> preflight
  -> execution_contract
  -> execute skill 或 mock executor
  -> order_fill / reconcile / review
```

一条外部 automation 先生成 supervisor task graph，再用 subagent 隔离分发慢轨、快轨、R&D 与保洁任务。慢轨负责战略判断、完整 observe、thesis、risk、action_intent；快轨负责执行层守护、轻量对账、条件触发、防御动作与确定性 guards。平仓 review 在交易 / 对账之后串行收尾。各 worker 通过 `plan_event` 与 artifact 通信，不共享隐藏状态。

真实交易所事实优先级高于本地事件、artifact、memory 和自然语言摘要。

## 安全边界

- 真实 Binance 写操作必须显式带 `--yes`。
- 写操作前应先完成 preview / preflight / contract 收敛。
- `profile/trading-config.json` 可默认允许 `live-small`；这表示项目运行目标，不等于绕过执行闸门。
- 默认检查、dry-run、preview、replay 不应触发真实下单。
- 凭证不写入仓库；API key、通知 token、chat id 等只从环境变量读取。
- Automation memory 路径统一用 `scripts/automation-memory-path.sh <automation-id>` 解析，不手写 `$CODEX_HOME`。
- Python 命令统一用 `scripts/resolve-python.sh` 解析，不假设 `python` 存在。

## 常用入口

仓库级检查：

```bash
scripts/quality-check.sh
```

helper smoke：

```bash
sh scripts/resolve-codex-home.sh
sh scripts/automation-memory-path.sh demo
sh scripts/resolve-python.sh
```

单个 TS skill：

```bash
cd .agents/skills/trade-flow
bun install
bun run check
```

Go 指标 skill：

```bash
cd .agents/skills/tech-indicators
go test ./...
```

具体改动域要跑哪些最小检查，以 [docs/check-contract.md](docs/check-contract.md) 为准。

## 文档契约

`README.md` 是仓库入口，不替代项目契约。当前核心文档仍优先看：

- [docs/vision.md](docs/vision.md)：为什么做
- [docs/prd.md](docs/prd.md)：做什么
- [docs/user-story.md](docs/user-story.md)：谁在什么场景下要什么
- [docs/chat-history.md](docs/chat-history.md)：高价值对话、决策变化与素材来源
- [docs/design-architecture.md](docs/design-architecture.md)：流程与架构设计
- [docs/tech-spec.md](docs/tech-spec.md)：实现口径
- [docs/trading-config.md](docs/trading-config.md)：统一交易配置与 runtime policy 设计
- [docs/check-contract.md](docs/check-contract.md)：改动后的最小检查
- [docs/code-quality.md](docs/code-quality.md)：质量与品位线
