# Domain Runtime Design

## 定位

`domain-runtime` 是全系统唯一的底层责任域生命周期契约，所有责任域共用；它不是某个业务域的私有 runtime，也不是消息中间件。

它吸收 Spring Boot 里 lifecycle / interceptor / health / validation / failure analyzer 的优点，但在交易系统里必须显式、可审计、少魔法：

```text
domain inbox
  -> pre_accept
  -> pre_handle
  -> handler
  -> post_handle
  -> post_commit
  -> domain outbox
```

## System Runtime 与 Control Tower Lifecycle

系统只有一套底层 `domain-runtime`。`control tower lifecycle` 是 `orchestration-ops` 基于这套底层 runtime 做出的 cycle 编排特化，不是第二套平行 runtime。

| 层 | Owner | 作用 |
| --- | --- | --- |
| `system domain-runtime` | `contracts/domain-runtime` | 所有责任域共享：`pre_accept / pre_handle / post_handle / post_commit / on_error` |
| `control tower lifecycle` | `orchestration-ops` | 使用 system domain-runtime 管 cycle 生命周期：`pre_cycle / pre_job / post_job / post_cycle` |

`control tower lifecycle` 负责本轮怎么跑；`system domain-runtime` 负责任意责任域如何安全接收、处理、提交和输出。

`pre_job` 是 job 出塔前的派发前处理：读取 health facts、trading profile-mode、cadence、lock、concurrency group、write owner 和 permission scope，过滤或标注 job ticket。它不判断行情、不改业务事实、不替代 domain preflight。

当前运行形态是主 agent 分发 subagent job，再由 subagent 汇报给主 agent；因此暂不单独设计 `job result rail`。job result refs 先进入 `control tower` inbox，由 `post_job / post_cycle` processor 统一验收。只有当多个独立 worker、异步队列、ack/retry/dead-letter 成为硬需求时，才把 job result 抽成独立 rail。

控制塔只发布 `ops rail`：health facts、incident refs、cycle summary、next-cycle constraints。`policy rail` 只能由 `policy-risk / risk authority` 发布，用来表达 runtime policy 与 trading profile-mode。

## Hook 语义

| Hook | 允许 | 禁止 |
| --- | --- | --- |
| `pre_accept` | 校验 inbox envelope、schema、idempotency、permission scope | 读取域内业务 store 后替 handler 下判断 |
| `pre_handle` | 加载 owner-owned refs、构造 handler context、检查 trading mode / write scope | 扩大 job 权限、改写输入事实 |
| `handler` | 执行业务能力，产出 draft result | 越过 owner store / outbox 直接跨域写 |
| `post_handle` | 校验 result envelope、blocked reason、write surface、outbox shape | 补造业务事实、替 handler 改结论 |
| `post_commit` | 提交 owner store、生成 refs、登记 audit metadata | 写非 owner store、隐式触发外部 side effect |
| `on_error` | 分类 `blocked / failed / retryable / needs_review`，产出 incident ref | 吞掉失败、把失败伪装成成功 |

## 标准结果

每个 domain job 的结果必须能被 control tower post-processor 统一收口：

```json
{
  "ok": true,
  "status": "ok",
  "domain": "live-execution-control",
  "job_id": "fast_track_guard",
  "idempotency_key": "cycle-.../J02",
  "input_refs": [],
  "output_refs": [],
  "writes": [],
  "incidents": []
}
```

失败不是自由文本：

```json
{
  "ok": false,
  "status": "blocked",
  "blocked_by": ["trading_mode_reduce_only"],
  "retryable": false,
  "incidents": []
}
```

## 横切能力

`domain-runtime` 只定义可复用横切能力：

- envelope/schema validation
- idempotency key check
- permission/write-scope check
- trading mode gate
- owner-store commit boundary
- outbox contract validation
- failure classification
- audit metadata

## Incident 与控制复盘

系统问题进入 `incident store`，不进入 `trade.db`。`trade.db` 只记录真钱交易事实。

incident 记录系统层问题：

- API / DB / lock / notify failure
- reconcile mismatch
- job timeout
- write-scope violation
- invalid subagent result envelope
- repeated blocked job
- mode change caused by system health

incident 生命周期：

```text
open
  -> acknowledged
  -> resolved
  -> reopened

open / acknowledged
  -> ignored
```

`control effectiveness review` 消费 incident store、cycle summary、overrides 与 repeated failures，输出系统控制改进项。它复盘的是控制塔和 runtime 是否有效，不复盘单笔交易盈亏。

不定义：

- 策略 thesis
- risk budget 计算
- Binance 请求细节
- replay / shadow / promotion 结论
- transport middleware
- 自动插件扫描

## 接入规则

每个域接入 runtime 前必须声明：

- inbox contract
- handler capability id
- owner store
- allowed write surface
- outbox contract
- idempotency key
- failure classes
- hook list

最小接入顺序：

1. `live-execution-control`：先接 `pre_accept / pre_handle / post_handle`，锁住执行权限和写面。
2. `exchange-gateway`：接 `post_commit`，强化 request/result ledger 与幂等。
3. `portfolio-execution-state`：接 owner-store commit boundary，确保真钱事件只 append。
4. `research-strategy-development`：接 trial budget / holdout / artifact outbox 校验。
5. `governance-review-compliance`：接 evidence freshness / promotion result 校验。
6. `artifact-knowledge`、`market-data-products`：接 manifest/ref/schema/freshness 校验。

## 不提前做

- 不把 hooks 做成动态插件市场。
- 不做类 Spring 的自动扫描注册。
- 不在 runtime 里放业务策略。
- 不把 protocol fabric 升级成消息总线。
- 不把所有旧模块一次性迁移。

先让关键真钱路径接入，再逐域扩展。
