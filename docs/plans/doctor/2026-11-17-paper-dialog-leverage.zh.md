# 2026-11-17 Paper 启动对话框写错杠杆

| Item | Value |
|---|---|
| Sessions | Claude 桌面版 Code 标签页，研究会话 `76a990ad-7313-41f0-9550-cd8a281d3382.jsonl`（价格行为学研究线），2026-11-17 回答用户关于 Paper 合约范围的提问时发现 |
| Audit session | 同一研究会话，Claude Opus 5.5；研究检出 `/tmp/research-76a990ad`，本记录在 `/tmp/doctor-paper-lev` 写成；不是 doctor 审计会话 |
| Checkout / ledger | `origin/main` 38e0c0753；未读账本 |
| Coverage | 只读了 Paper 启动路径：`ide/web/src/components/PaperDialogs.tsx`、`paper/serve.py` 的启动处理、`cli/paper_commands.py` 的 `--leverage`、`engine/config.py` 的 `ACCOUNT_CONTRACT`；没有起 IDE、没有启动 Paper、没有看 Live 启动页 |
| Cost | 发现与记录约 10 分钟；没有因此作废的试验 |
| Net change | 本记录不改代码；拒绝码与技能字数不变 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261117-01 | Paper 启动对话框写“Same as the replay: 100,000 USDT margin, 1× leverage”，实际 Paper 与回放都按默认杠杆 3 运行 | `PaperDialogs.tsx:50` 手写 `1× leverage`；页面启动经 `paper/serve.py` 调 `paper start` 时不传 `--leverage`，`cli/paper_commands.py:115` 取 `ACCOUNT_CONTRACT["default_leverage"]`，即 `engine/config.py:118` 的 `"3"`；研究回放同样默认 3。读者是在页面上启动 Paper 的用户，据此判断这次运行的保证金与风险；读到 1× 会低估三倍。只是显示错，运行本身与回放一致 | fix（文字；对话框写出实际杠杆，最好从同一个默认值读出，不再手抄） | unknown | in PR [#3163](https://github.com/qOeOp/trade/pull/3163)：对话框从 `/api/paper/defaults` 读 `ACCOUNT_CONTRACT` 的保证金与杠杆 |

## Removal list

无。

## Decisions

无。
