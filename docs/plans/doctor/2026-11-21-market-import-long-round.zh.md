# 2026-11-21 market-import 长轮次被健康检查判为过期

生产 Telegram 审计：2026-11-20 11:41 UTC 用户收到「The market-import service reports unhealthy: an import is stopped
or lagging, or its status is a day old.」。当时的原因已无法取回：容器在 v0.4.4 发布（11-21 01:07）时重建，
`status.json` 只留最新一轮，Docker 不留旧的健康日志。

| Item | Value |
|---|---|
| Sessions | 协调会话的生产 Telegram 审计（2026-11-21）；本记录由 deploy 线子 agent（Claude Code，Claude Opus 5.5）写 |
| Checkout / ledger | `origin/main`；未读写账本、市场或主机 |
| Cost | unknown（一条误导的通知；未计量） |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-21 | 每日轮次跑得久时，market-import 的健康检查在轮次进行中就报过期（不健康） | `market/follow.py`：`run_round` 的 `at` 是该轮开始时刻，状态只在一轮结束时写；一轮开始时 `follow` 保留上一轮的 `at`，只加 `running_since`；`check` 只看 `at` 是否超过 `STALE`（26 小时）。00:30 UTC 开始的每日轮次跑过约 02:30 就报不健康。主机上该轮的 K 线文件写于 11-20 08:30 UTC，与长轮次相符，未证实。[#3287](https://github.com/qOeOp/trade/pull/3287) 起检查会打印原因 | authority（改健康检查判定） | unknown | in PR |

## 决定

2026-11-21：用户委托：「需要我定的部份最后也是一样由你决定按推荐做」。协调会话据此定：进行中的轮次在
`running_since` 不满 `STALE`（26 小时）时算新鲜；超过即不健康，原因写作「a round running since … is stuck」。
这样长的每日轮次不再读作过期，真正卡住的轮次仍会被发现；已结束而过期的状态照旧不健康。
