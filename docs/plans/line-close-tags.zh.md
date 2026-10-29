# 研究线封盘：语义化线名、tag 与线总结

> 2026-10-29 起，封盘点（下一条路线诞生提交的父提交）和「当前线不封」两条由 [parallel-research-lines.zh.md](parallel-research-lines.zh.md) 取代（用户 2026-10-29 批准）。

2026-10-21，依据 origin/main 0b675a3ad。用户已定稿并授权实现：线名用「UTC 日期＋slug」、总结放 tag 消息、新增 `line close`（管理员打 tag）与 `line select --slug`。已经过独立审阅（见第六节）。

## 要解决的问题

研究会一直积累。以后开发新策略时，Agent 要能快速查到：以前在哪个方向试过什么、得出了什么、栽在哪。

在账本里逐行翻候选、运行和判断，效率很低。按天拆库也不行，会破坏三件事：

- 试验计数要看全量历史；
- 外键跨不了库；
- 样本外窗口的保留只在单库里生效。

所以不拆库，改为每条研究线结束时封一次盘：

- 打一个语义化的 tag，指向「换方向前最后一刻」。它就是这条线的只读快照：Doltbench 连 `research/<tag>`，`ledger` 命令用 `--at <tag>`，都能读到当时的账本（实测可用）。
- 在 tag 消息里写这条线的总结，作为以后检索的目录。

用户的要求：

- 轻量，不阻塞研究主流程；
- 不为 tag 另建表；
- tag 和研究线的名字本身带语义。

## 一、何时结束、封在哪：由账本确定

- 同一时间只有一条当前线，就是入账时间（服务器 UTC）最晚的那条。除它之外，所有线都已结束。
- 同一方向中断后回来接着做，仍是同一条线：research-start 读到已选的线会直接继续。只有换了起点、窗口、市场提交或备注，才会写一条新编号的线。
- 封盘点：设第 n+1 条线的证据包是在提交 B 中新增的，第 n 条线就封在 B 的父提交。
  - B 由 `dolt_diff_evidence_bundle` 中 `to_bundle` 为该包、`diff_type = 'added'` 的那一行确定。
  - research branch 是线性的（writer 不能 merge），父提交是唯一的。
  - 一条线跨几天、中间断几天，都只是一条，与日期无关。
- 当前线不封。最后一条线在被下一条接替之前不会封，这一点接受。

## 二、语义化命名

原则：名字只放别处没有记录的事实。起点、窗口、币池、市场提交已经在线记录里，不进名字；outcome（有没有推荐）会随后来补充的判断变化，也不进名字。

### 研究线名：`research-line-<UTC 日期>-<slug>`

例如 `research-line-20261021-ema-trend-vol-sizing`。

- 日期是选线当天的服务器 UTC 日期（`YYYYMMDD`），与账本里所有时间同一时钟。它代替了原来无语义的编号：既标出先后，又能按天、按月检索。线结束的时间不用写进名字，tag 的时间在 `dolt_tags` 里。
- `slug` 写这条线的方向。它是现在唯一没被记录的事实：`note` 记的是研究目标，不是方向。
  - 由 Agent 在选线时按用户的选择拟定，作为 `line select --slug` 的必填参数。
  - 格式 `[a-z0-9]+(-[a-z0-9]+)*`，最长 48 个字符，只用 ASCII。`--at` 只认 ASCII；Dolt 也会拒绝中文、`//`、`.lock` 结尾的名字（实测）。
- 唯一性靠日期加 slug。同一天、同一 slug、但选择不同时，拒绝为 LINE_CONFLICT，让 Agent 换一个更准确的 slug，而不是补 `-2`，名字始终有语义。
- 当前线按入账时间判断，不再按编号；线记录里去掉 `line_no`，格式升为 `research-line-v2`。
- 重放：选择完全相同时（不论 slug）按重放处理，返回原来那条线。
- 保留命名空间扩到 `research-line-.*`（审阅指出：否则 Agent 能用 `evidence add` 写一个看起来像线的包冒充当前线）。没有编号以后，审阅提的「同号两条线」问题也不再存在。
- 要改的地方：
  - 代码：`ledger/lines.py`、`ledger/evidence.py`（RESERVED）、`ledger/refusals.py`、`cli/main.py`；
  - `report/status.py`：research state 增加 `unclosed_lines`；
  - research-start skill 及其评测 start-sets-goal；
  - docs/rd 下的 design 文档；
  - 相关测试。
- 不受影响：判断表的 CHECK `line_bundle LIKE 'research-line-%'`；登记的 `retry_of`。

### tag 名：`line/<UTC 日期>-<slug>`

即线名去掉 `research-line-` 前缀，例如 `line/20261021-ema-trend-vol-sizing`。

- 一条线只有一个 tag：Dolt 拒绝同名 tag，这一点直接保证唯一。
- 名字里不放 outcome：封盘后线上还能追加或取代推荐，名字会过时；而且 Dolt 会把 `…/recommended` 和 `…/explored` 当成不同的名字，唯一性就保不住了。按结果过滤改为读时从判断表现算。

检索：

```sql
SELECT tag_name, message FROM dolt_tags WHERE tag_name LIKE 'line/202610%';
SELECT tag_name FROM dolt_tags WHERE tag_name LIKE 'line/%-funding-%';
SELECT tag_name FROM dolt_tags WHERE tag_name LIKE 'line/%' AND message LIKE '%资金费%';
```

## 三、tag 消息：只放总结

- 消息只放 Agent 写的这条线的总结。事实（窗口、币池、起点、候选、运行、推荐）不写进去：它们都能从账本推出，按 AGENTS.md「只存一次、不存可推导的」，读时现算。
- 读事实的入口是现成的：`research state --line <线> --at line/<UTC 日期>-<slug>` 给出这条线的记录和当时有效的判断，不需要新的读命令。
- 总结写成什么样，由 research-round 或 research-start 的 skill 规定：建议的小标题是方向、试过什么、结果、失败与原因、教训、给后来者的建议，并且不写数字结论。代码只设长度上限，例如 32 KB，不检查格式。

**代价（用户需要知道）**：tag 消息不受「只增不改」保护，拿到管理员口令就能删掉 tag 再重建。tag 被删后，下一次备份同步里也不再有它（实测）。总结只是检索目录，证据仍在账本里；丢了，下一次 research-start 会把这条线当成未封，重新封一次。

**替代方案**：如果希望总结和证据一样只增不改，可以改为由 Agent 用现有的 `evidence add` 写一个普通证据包，例如 `line-summary-<UTC 日期>-<slug>`，tag 消息留空或只写包名。这样不建新表，也不需要管理员权限。用户点名要 tag 关联摘要，所以本提案默认用 tag 消息。

## 四、谁来做

产品只加一条命令：`line close --line <线> --summary <文件>`。只有它能用管理员权限打 tag，所以必须是产品代码；`ledger export` 同步备份时用管理员连接，就是先例。这条命令做以下几件事：

1. 只接受已经结束、还没封过的线。当前线拒绝，例如 LINE_OPEN；已封的线由 Dolt 的同名拒绝挡住，转成 LINE_CLOSED。
2. 自己算出封盘点。
3. 总结超过长度上限就拒绝。
4. 用服务管理员连接执行 `DOLT_TAG('-m', 总结, 'line/<UTC 日期>-<slug>', 封盘提交)`。tag 不改工作集，不碰 `ledger_head`，所以和主会话的写入不冲突。

另外，`research state` 的输出增加 `unclosed_lines`：列出每条已结束、未封的线，并给出它的封盘提交、tag 名和接替它的线，Agent 据此 `--at` 读线结束时的状态。

research-start 的 skill 增加一段：

- 读账本时如果有已结束未封的线，就派一个后台子代理去封，自己继续往下走，不等它。
- 子代理用 `--at` 读每条线在封盘点的状态，写总结，然后调用 `line close`。
- 子代理不给旧线追加判断，也不写别的账本记录。
- 宿主没有子代理时，在会话结束前顺手完成。
- 失败只影响目录，不影响研究，下次 research-start 会重试。

## 五、审查与授权

- 不新增 `ledger review` 核对。删掉事实区以后，这条核对只剩「每条线一个 tag、指向封盘点」，和 research state 的未封列表重复，不值得为它收紧审计。
- 需要用户授权的有两处：
  1. 新增 `line close`，由产品命令用管理员权限打 tag；
  2. 线名格式改为 `research-line-<UTC 日期>-<slug>`，`line select` 新增必填的 `--slug`。

## 六、独立审阅

一个只读子代理按 AGENTS.md 做了审阅。它没有参与起草，Dolt 行为都在一次性服务上实测。初稿到本稿的改动如下：

| 初稿 | 审阅结论 | 本稿 |
|---|---|---|
| 封盘点＝下一条线新增提交的父提交 | 采纳 | 不变 |
| `research-line-<n>-<slug>` | 修改后采纳 | 补上 RESERVED 扩展、重放语义、漏列的读者；用户随后把编号换成 UTC 日期，同号问题随之消失 |
| tag 名带 outcome `line/<n>-<slug>/<outcome>` | 否决：会过时，也让同名拒绝失效 | `line/<UTC 日期>-<slug>` |
| 消息事实区（代码写） | 否决：可推导的事实存了两份；`line_trials` 按窗口和市场提交匹配，共用窗口的两条线会重复计数，误导读者 | 只放总结，事实读时现算 |
| 总结区的固定小标题和格式校验 | 交给 skill | 代码只设长度上限 |
| `summary_by`、`ended_by`、`sealed_commit` | 删除：无法核实，或可以推出 | 删除 |
| `ledger review` 新核对 | 否决（可选） | 不加 |

其他实测结果：

- 带斜杠的 tag 名可以使用；`AS OF`、`read_as_of`、`check_ref` 都能处理它。
- 修订库连接 `research/line/<名字>` 用 root 和 reader 账号都能连上。
- writer 账号打 tag、删 tag 都会被拒绝。
- dolt_backup 会带上 tag。

## 七、实现中的实测

- Dolt 2.4.2 没有 `UTC_DATE()`，线名日期用 `DATE(UTC_TIMESTAMP())`，与触发器写 `created_at` 用的是同一个时钟。
- Dolt 存 tag 消息时会去掉末尾换行（和 git 一样），行内的空白保留。所以 `line close` 先去掉总结的首尾空白再存，重放比较也按去掉后的文本。
