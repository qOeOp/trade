# 2026-11-13 瘦身审计授权项的用户决定

| Item | Value |
|---|---|
| Sessions | 无研究会话；接续 [瘦身审计](2026-11-13-whole-product-slimming-audit.zh.md) |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `c6ee7b85-8de9-4ef4-8eca-13f68718117e`（与瘦身审计同一会话） |
| Checkout / ledger | `origin/main` 合入 [#2898](https://github.com/qOeOp/trade/pull/2898) 之后；未读账本 |
| Coverage | 只记录用户对瘦身审计授权项的决定；不含新发现 |
| Cost | 无新测量 |
| Net change | 无；各项的增减见瘦身审计记录 |

瘦身审计记录合入时，用户的决定还没写进去，所以单独记在这里。第一波 14 个 PR 已全部合入（-104 由 [#2897](https://github.com/qOeOp/trade/pull/2897)、-112 由 [#2896](https://github.com/qOeOp/trade/pull/2896)，其余见索引）。

## Decisions

2026-11-13，用户用一道多选题批准了全部四组授权项。每项仍然单独开 PR 并配齐测试；engine 改动要配对原生重放，并产生新的镜像 digest。

| 组 | 批次 | 批准的改动 |
|---|---|---|
| 拒绝码与检查合并 | -105、-123、-124、-125（收紧部分）、-126、-132、-133（检查部分）、-134、-155 | 一个条件一个码：市场日 4 码并 1，合约列表与 UTC 区间各 3 码并 1，`USAGE_ERROR` 只留一种机制。删除不可达码、目录里只有测试读的 meaning 字符串，以及 `main` 市场别名。删除 9 处已有别处覆盖的重复检查（含 `NO_CONTROL`、读时复利检查）。回放超时改为结构化拒绝。witness 总是校验 pinned roots。ledger mirror 只认一种 DoltHub 写法。删除 skill 里产品已强制的拒绝步骤 |
| engine 与 Live 规则 | -113、-114、-118、-119、-120、-135（快照解析） | Live 拒绝码移出回放闭包，回放契约布局升版，v8 仍可复现。删除 `STOP_LOSS_DECLARATION_INVALID`、`OBSERVER_COUNT_MISMATCH`。Live 下单形状改走共享 `OrderRules`，撤销 11-13 L1 的 Live 专属码。删除没人读的 Paper summary 与 Live 证据行。kline URL 对符号编码，先量有没有非 ASCII 符号。Live 快照解析统一，`runtime` 改为必填 |
| 存储字段与图格式 | -106（n349）、-123（`run_reading.computed_at`） | `computed_at` 在下次 schema 升版时删除。研究图投影保留目录原名，不再把 `plan_win_rate` 改名为 `win_rate` |
| 主机、CI 门禁与旧决策文档 | -145、-146、-151 | oauth2-proxy 的 upstream 改指 IDE 路由。release 门禁不再依赖 30 天过期的 artifacts。删除被设计站取代的决策副本和旧账本存储评审 |

授权只覆盖上表的改动；之后新发现的拒绝或检查改动要另行询问。-136 只改测试，各批次中不属于上表类别的部分也不需要授权。
