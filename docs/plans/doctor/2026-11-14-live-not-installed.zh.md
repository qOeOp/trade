# 2026-11-14 Live 不随发布可用：靠主机上手写的声明

| Item | Value |
|---|---|
| Sessions | 无研究会话；用户在 v0.3.1 上线后看 Live 页（截图：“Live is not set up for this IDE”，Candidate/Contracts/Leverage 写着 “Live settings on the server”） |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `c6ee7b85-8de9-4ef4-8eca-13f68718117e`；只读设计子 agent 在 `origin/main` 3f2c99c 上出方案 |
| Checkout / ledger | `origin/main` 3f2c99c；未读写账本 |
| Coverage | `deploy/live_configuration.py`、`deploy/live_host.py`、`deploy/release.py` 的 Live 配对分支，`live/` 的 configuration/control/authority/runs/credentials/serve，`ide/web` Live 页，对照 Paper 的选择与校验路径；主机只读确认 `/var/lib/trade-release/live/` 不存在 |
| Cost | 实测：trade-sgp-01 自 11-11 重装以来 Live 页始终不可用；本会话把它说成“不是故障、你想用的话可以准备”，被用户纠正 |
| Net change | 提案删掉主机声明、源目录、`purpose`、`universe_file` 文件与只读文件绑定、`require_live_installation` 与未配对分支；新增产品建的 Live 根与锁、按选择派生的 universe、两个只读 Live 候选接口。拒绝码不增 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261114-20 | Live 不随发布可用：Live 控制只在操作员手写 `/var/lib/trade-release/live/configuration.json`（托管根、`account.lock`、universe 与读者文件、带候选哈希与合约的 `sources`、`research_at`、杠杆）后才配对，没有任何发布创建它；候选、合约、杠杆只能在主机文件里定，Paper 则在页面上选 | 用户先指出（来源 user，本应由 Product contracts and delivery 工作流发现）。`deploy/release.py:343-346` 只在声明存在时启用 Live；`install()` 拒绝 Live（592-593）；`live/control.py:187-189` 不在声明目录里的候选拒绝 `LIVE_SOURCE_MISSING`；`ide/web/src/model/liveLaunch.ts:71-79` 三行来源都是 server settings；README “Optional Live control pairing” 要求操作员 SSH 建根、锁、文件并暂停 timer。Paper 由 `paper/serve.py:279-317` 从页面选的版本读头部候选 | authority（用户 2026-11-14 批准：发布默认安装 Live；候选、合约、杠杆在 Live 页选，与 Paper 同一候选校验，Live 的实盘检查保留；保存密钥、账户检查、启动仍归用户） | hours | open |

## Decisions

2026-11-14 用户：“按你说的三点做”。放弃“只有主机操作员能声明哪些候选可以实盘交易”这条边界。Live 在候选身份上与 Paper 一致，并保留自己的回放证据、运行时契约、市场条款与仅 USDT 合约的检查（不放宽）；`purpose` 标签随源目录一起删除。
