# 定时扫描场景

Scanner 是定期判断哪些受治理策略当前适用的慢轨。每轮只生成一个终态 Scanner Receipt；只有 `PROPOSED` 携带部署提案，永不执行部署或交易。

## Entry / 入口

准确 schedule-definition version、scan-scope identity/version 和规范无歧义 due-slot boundary 在执行前
派生唯一稳定 attempt identity。clock epoch 与 continuity 是准入证据，不属于该身份。重复投递 并发
重启或迟到执行都加入该 attempt 与终态回执；scope 或 clock continuity 未知、due slot 冲突时不创建
attempt 或提案。扫描内部没有交互式批准。

## Value path / 价值路径

Strategy Loader 从 Strategy Governance 读取可部署 ArtifactRef 激活条件 数据要求 版本和生命周期限制。
Market Snapshot 为每个策略绑定外部提供的 universe-selection rule、所需标的 窗口 质量规则 PIT 事实、
calendar session/time zone corporate action 历史 membership 和 Market Semantics Compatibility 身份，
或记录负面 disposition。
Strategy Matcher 独立评估每个策略。若已发布激活条件要求 Capacity View，它必须绑定准确容量 scope
候选无关 capacity scope、账户事实截面、估值与流动性输入、资金池方法与假设版本、测量时间和
有效期。策略 generation 特定经济条件保持为独立输入。
Proposal Builder 只收录证据完整的匹配。
一个策略缺失或失败的输入不得压制其他策略的有效提案。

## Owner handoffs / Owner 交接

Strategy Governance → Scanner 提供注册表事实与激活条件。Market Data → Scanner 提供带时间戳的
市场事实。Portfolio → Scanner 可选提供仅供提案规划使用的 Capacity View。Scanner → Strategy
Governance 提交终态 Scanner Receipt，不存在 Scanner → Runtime 交接。
Governance 只能在既有已授权无人值守生命周期血缘内考虑 `PROPOSED`，并提交自己的生命周期决定和
Capital Allocation Disposition。

## Proof / 证明

每轮只以 `PROPOSED` `NO_MATCH` `INSUFFICIENT_DATA` `COMPLETED_NO_PROPOSAL` 或 `FAILED` 之一闭合。完整回执绑定相等 expected 与 observed 集，并为每个成员绑定终态 disposition。
至少一个策略证据完整且匹配时为 `PROPOSED`，提案只含这些策略且保留其他负面 disposition。
全部策略可评估且均无匹配时为 `NO_MATCH`；无匹配 无 `CONDITION_FAILED` 且有数据阻断时为
`INSUFFICIENT_DATA`。完整集合没有 `MATCHED` 且至少一个本地 `CONDITION_FAILED` 时为
`COMPLETED_NO_PROPOSAL`，并保留每个成员。`FAILED` 仅属于 batch，且只表示 `INCOMPLETE_FAILED` 或有
独立证据的 `BATCH_OPERATIONAL_FAILED`。不完整回执按以下方式闭合：expected 成员已知时绑定准确 expected
observed 和 missing 集；成员未解析时则绑定权威未解析 disposition observed 事实 missing-members-unavailable 标记和
终态原因，绝不编造成员。operational failure 必须绑定 `SCHEDULER_ORCHESTRATION_FAILURE`
`SCANNER_SERVICE_FAILURE` 或 `SHARED_DEPENDENCY_OPERATIONAL_FAILURE` 之一，以及 failure identity、证据
source cut 与 Time Evidence。只有有独立证据的上述 batch 系统故障或 disposition 集不完整时，才先闭合为 batch `FAILED`；
包括 `CONDITION_FAILED` 在内的本地 disposition 都不能创建该 batch
failure。总优先级为独立 batch `FAILED`、完整 `PROPOSED`、完整 `COMPLETED_NO_PROPOSAL`、
`INSUFFICIENT_DATA`、`NO_MATCH`。

## Development outcome / 开发结果

- **受益者** — 需要定期发现机会又不能让定时器直接部署或交易的策略运营者。
- **可观测结果** — 每次定时触发覆盖完整受治理注册表，并返回准确匹配 负面处置 缺失成员和唯一终态回执。
- **未改变伤害** — 过期或数据不足策略可能被静默提升，有效匹配可能被其他失败隐藏，Scanner 也可能变成隐蔽部署权威。
- **终态负例** — `NO_MATCH` `INSUFFICIENT_DATA` `COMPLETED_NO_PROPOSAL` 或 `FAILED` 不产生部署；Governance 只能考虑完整 `PROPOSED` 回执中的准确成员。

## Fail closed and forbidden transitions / 失败关闭与禁止转换

- 历史不足 行情过期 标的身份未知或生命周期不允许时，只阻断依赖它的策略。
- 被数据阻断的策略不能进入提案，也不能隐藏其他策略的完整匹配。
- `INCOMPLETE_FAILED` 导致 disposition 集不完整或有独立证据的 `BATCH_OPERATIONAL_FAILED` 生效时，
  已有匹配也不能生成 `PROPOSED`。
- 不完整 `FAILED` 视图只在 expected 已知时显示准确 missing，否则显示未解析 disposition 和
  missing-members-unavailable 标记；operational `FAILED` 视图显示独立类型化 category 与 evidence
  identity。两者都不能假装集合完整；本地 `CONDITION_FAILED` 改为让完整无匹配集合闭合为
  `COMPLETED_NO_PROPOSAL`。
- Governance 只能激活同一回执里的准确 matched proposal member，负面或非成员策略不能激活。
- Portfolio 容量只是建议性事实投影，Scanner 不能据此分配资金。
- 除非已发布条件明确要求，否则 Capacity View 是可选输入；一旦要求，任一字段缺失 过期 不可用 部分或身份不匹配都提交 `INPUT_UNAVAILABLE`，不能生成 `MATCHED`。
- 提案不是激活、资格、交易意图或订单命令。
- 提案只是证据，不是授权。即使准确匹配，缺少已授权无人值守 lineage 或独立 Governance 决定也不
  创建 Runtime application。
- Scanner 不能启动 Runtime、绕过 Governance 或重试外部交易效果。
- cadence calendar time zone fold/gap misfire 或 backfill rule 变化时必须创建后继 schedule definition，
  不能重新解释已提交 slot，也不能用 clock epoch 改写 attempt 身份。
