# 研究线封盘：语义化线名、tag 与线总结

2026-10-21，依据 origin/main 0b675a3ad。本文是提案，尚未实现。已经过独立审阅（见第六节），等用户过目定稿后再实现。

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

- 同一时间只有一条当前线，就是编号最大的那条。除它之外，所有线都已结束。
- 同一方向中断后回来接着做，仍是同一条线：research-start 读到已选的线会直接继续。只有换了起点、窗口、市场提交或备注，才会写一条新编号的线。
- 封盘点：设第 n+1 条线的证据包是在提交 B 中新增的，第 n 条线就封在 B 的父提交。
  - B 由 `dolt_diff_evidence_bundle` 中 `to_bundle` 为该包、`diff_type = 'added'` 的那一行确定。
  - research branch 是线性的（writer 不能 merge），父提交是唯一的。
  - 一条线跨几天、中间断几天，都只是一条，与日期无关。
- 当前线不封。最后一条线在被下一条接替之前不会封，这一点接受。

## 二、语义化命名

原则：名字只放别处没有记录的事实。起点、窗口、币池、市场提交已经在线记录里，不进名字；outcome（有没有推荐）会随后来补充的判断变化，也不进名字。

### 研究线名：`research-line-<n>-<slug>`

`slug` 写这条线的方向，例如 `ema-trend-vol-sizing`。它是目前唯一没被记录的事实：`note` 记的是用户的研究目标，不是方向。

- 选线时由 Agent 按用户的选择拟定，作为 `line select --slug` 的必填参数。
- 格式 `[a-z0-9]+(-[a-z0-9]+)*`，最长 48 个字符，只用 ASCII。`--at` 的引用格式只认 ASCII；Dolt 也会拒绝中文、`//`、`.lock` 结尾的名字（实测）。
- 保留 `n`：它给出先后顺序，也是唯一性的依据。

审阅指出两个必须一并修的缺陷：

1. 保留命名空间要扩到 `research-line-.*`（`ledger/evidence.py` 的 RESERVED）。否则 Agent 能用 `evidence add` 写一个 `research-line-99-x`，冒充当前线。
2. 线号唯一要在写事务里检查。现在 `select_line` 在事务外读出最新线号，靠同名包冲突（BUNDLE_EXISTS → LINE_CONFLICT）防止重号。名字带上 slug 后，两次 slug 不同的选线会产生两条同号的线。所以要在写入事务里检查 `research-line-<n>-%` 是否已存在。

重放语义：除 slug 外其余选择都相同时，按重放处理，返回原来那条线，不改名；只改 slug 不算换方向。

要改的地方：

- 代码：`ledger/lines.py`（LINE 正则、排序、`select_line`、`line_trials`）、`ledger/judgments.py`（用到 `lines.LINE`）、`ledger/evidence.py`（RESERVED）、`ledger/refusals.py` 的提示文字、`cli/main.py` 的 `line select` 与各处 `--line` 的 help；
- skill：research-start（SKILL.md 和它的评测 start-sets-goal）；
- 文档：docs/rd 下的 design 文档；
- 相关测试。

不受影响的地方：判断表的 CHECK `line_bundle LIKE 'research-line-%'`；登记的 `retry_of`（它指的是登记，不是线）。正式账本刚重建、还没有线，不存在旧名兼容问题。

### tag 名：`line/<n>-<slug>`

例如 `line/3-ema-trend-vol-sizing`。

- 一条线只有一个 tag：Dolt 拒绝同名 tag，这一点直接保证唯一。
- 名字里不放 outcome。名字带 outcome 时，Dolt 不会把 `line/3-x/recommended` 和 `line/3-x/explored` 当成同名，两个能同时存在，唯一性就保不住了；而且封盘后线上还能追加或取代推荐，名字会过时。按结果过滤改为读时从判断表现算。

检索：

```sql
SELECT tag_name, message FROM dolt_tags WHERE tag_name LIKE 'line/%' AND message LIKE '%资金费%';
SELECT tag_name FROM dolt_tags WHERE tag_name LIKE 'line/%-funding-%';
```

## 三、tag 消息：只放总结

- 消息只放 Agent 写的这条线的总结。事实（窗口、币池、起点、候选、运行、推荐）不写进去：它们都能从账本推出，按 AGENTS.md「只存一次、不存可推导的」，读时现算。
- 读事实的入口是现成的：`research state --line <线> --at line/<n>-<slug>` 给出这条线的记录和当时有效的判断，不需要新的读命令。
- 总结写成什么样，由 research-round 或 research-start 的 skill 规定：建议的小标题是方向、试过什么、结果、失败与原因、教训、给后来者的建议，并且不写数字结论。代码只设长度上限，例如 32 KB，不检查格式。

**代价（用户需要知道）**：tag 消息不受「只增不改」保护，拿到管理员口令就能删掉 tag 再重建。tag 被删后，下一次备份同步里也不再有它（实测）。总结只是检索目录，证据仍在账本里；丢了，下一次 research-start 会把这条线当成未封，重新封一次。

**替代方案**：如果希望总结和证据一样只增不改，可以改为由 Agent 用现有的 `evidence add` 写一个普通证据包，例如 `line-summary-<n>-<slug>`，tag 消息留空或只写包名。这样不建新表，也不需要管理员权限。用户点名要 tag 关联摘要，所以本提案默认用 tag 消息。

## 四、谁来做

产品只加一条命令：`line close --line <线> --summary <文件>`。只有它能用管理员权限打 tag，所以必须是产品代码；`ledger export` 同步备份时用管理员连接，就是先例。这条命令做以下几件事：

1. 只接受已经结束、还没封过的线。当前线拒绝，例如 LINE_OPEN；已封的线由 Dolt 的同名拒绝挡住，转成 LINE_CLOSED。
2. 自己算出封盘点。
3. 总结超过长度上限就拒绝。
4. 用服务管理员连接执行 `DOLT_TAG('-m', 总结, 'line/<n>-<slug>', 封盘提交)`。tag 不改工作集，不碰 `ledger_head`，所以和主会话的写入不冲突。

另外，`research state` 的输出里增加「已结束未封的线」列表。

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
  2. 线名格式改为 `research-line-<n>-<slug>`，`line select` 新增必填的 `--slug`。

## 六、独立审阅

一个只读子代理按 AGENTS.md 做了审阅。它没有参与起草，Dolt 行为都在一次性服务上实测。初稿到本稿的改动如下：

| 初稿 | 审阅结论 | 本稿 |
|---|---|---|
| 封盘点＝下一条线新增提交的父提交 | 采纳 | 不变 |
| `research-line-<n>-<slug>` | 修改后采纳 | 补上 RESERVED 扩展、事务内线号检查、重放语义、漏列的读者 |
| tag 名带 outcome `line/<n>-<slug>/<outcome>` | 否决：会过时，也让同名拒绝失效 | `line/<n>-<slug>` |
| 消息事实区（代码写） | 否决：可推导的事实存了两份；`line_trials` 按窗口和市场提交匹配，共用窗口的两条线会重复计数，误导读者 | 只放总结，事实读时现算 |
| 总结区的固定小标题和格式校验 | 交给 skill | 代码只设长度上限 |
| `summary_by`、`ended_by`、`sealed_commit` | 删除：无法核实，或可以推出 | 删除 |
| `ledger review` 新核对 | 否决（可选） | 不加 |

其他实测结果：

- 带斜杠的 tag 名可以使用；`AS OF`、`read_as_of`、`check_ref` 都能处理它。
- 修订库连接 `research/line/3-x` 用 root 和 reader 账号都能连上。
- writer 账号打 tag、删 tag 都会被拒绝。
- dolt_backup 会带上 tag。
