# 2026-11-13 遗留项圆桌

用户 2026-11-13：“同样开圆桌会议解决 Handed off or left for later … 为什么每次解决完还是会留下未解决”。这句委托是本记录各项裁决的依据。

| 项 | 值 |
|---|---|
| 会话 | Mac，Claude Desktop 会话 e70e87b9（“Research runs unattended: decide, don't stop”），2026-11-12 至 11-13 |
| 审计会话 | 同上，Opus 5.5，worktree `vigorous-chandrasekhar-40db25`；本会话自己写的 PR：#2817、#2818、#2828、#2829、#2838、#2844 |
| 检出 / 账本 | `main` d4348cf88；账本 pio1ucfkr3muki15rspcnf0ijl4jvqe5 至 mu1blaq9792c5gr89ajk7tvdvqbrhir0 |
| 覆盖 | 无人值守研究两次圆桌留下的四项（L1–L4）和“为什么每轮都有遗留”；两个只读证据员，三个席位（完成、诚信、产品），主持人裁决 |
| 代价 | 圆桌约 13 分钟、约 64 万子代理 token；研究时间与无效试验未计量 |
| 净变化 | 新增拒绝码 0，skill 字数 0；这条发现的修复只改一处拒绝的 expected 文字 |

## 发现
| id | 发现 | 证据 | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261113-04 | `ledger/db.py:314-315`：compose 运行的服务一直不接受连接时，`LEDGER_START` 的 expected 写的是 `` `docker compose up -d ledger` ``。`up` 会在镜像 digest 变了时重建容器，也会把已删除的容器建出来；这是产品 .py 里唯一写 `up` 的地方，其余拒绝文字都写 restart 或 stop。AGENTS.md（#2838）把启停部署服务留给用户，research-start 也只让用户运行 `start` | `git grep 'compose up' origin/main -- '*.py'` 只命中这一处；`shared/refusals.py` 的 LEDGER_UNAVAILABLE、SERVICE_MANAGED、PUBLISH_FAILED 都写 restart/stop；`tests/ledger/test_db.py:533-535` 只断言 NoAnswer 分支，没有测试断言这段文字；读者是在账本服务起不来时照着 expected 操作的人或 Agent | fix（只改 expected：让用户 `docker compose start ledger`，拒绝码和条件不变） | none | open |

## 移除清单
无。

## 决定
用户委托（见开头）。

- L1 两份 `DECISION_OPENINGS`：现在做。#2850 把 `report/graph.py` 的副本改成从 `ledger.judgments` 导入，本会话跟到合入。撤回：revert #2850。
- L2 dow-theory-btc-eth 的计数锚点：现在做。用户 2026-11-12 10:11 UTC 在会话 b5788262 回复“1: failed-rally exit”，此前只在判断 68 的散文里。本会话已写入 priority 判断 69，以 `Change of approach.` 开头、写明 `chosen by the user`，subject 是 trial 110、111；账本提交 mu1blaq9792c5gr89ajk7tvdvqbrhir0。撤回：判断不能删，写一条 `--supersedes 69` 的 priority 判断说明撤回和原因。
- L3 `LEDGER_START` 写 `up`：本记录立为 20261113-04。修复按 AGENTS.md 从本记录和索引行开始，由不带本会话上下文的执行者做。撤回：revert 修复 PR；本记录不改，以后的记录把该行记为 `rejected` 并写原因。
- L4 harness 对 docker 启停命令的 ask 规则：属于主机配置，AGENTS.md 要用户明确授权，圆桌的委托也不能代替。只问用户一次是或否，附上确切改动（`~/.claude/settings.json` 的 `permissions.ask`）；用户说不或这一轮没回答，就记为撤回，不再列为遗留。
- 遗留反复出现的原因：
  1. 给遗留项贴“后续 PR”“下一个研究会话”“doctor 发现”这类标签，却没写进下一个负责人会读的地方（L3 不在索引里，L2 不在账本里）。
  2. 并行会话之间的约定，到合入时没人核对（#2845 第二个合入，却带着副本）。
  3. 父会话自己设的范围限制（例如“不碰 IDE”）被当成规则用。
  4. 顺带发现的问题只列出来，没有放进本轮去做。
  5. 用户授权项只写“已提议”，从没问过一个是或否的问题。
  6. 证据过时：第一版圆桌漏了用户第 7 次选择。
- 改动：用户记忆 `feedback_work_through_the_list.md` 加一条收尾规则。最终报告前，每项必须处在下面五种状态之一：
  - 已合入并验证；
  - 有具名的 PR 或会话在跟，跟到合入；
  - 已写进下一个负责人会读的地方，并且对应的 PR 或会话已经开始；
  - AGENTS.md 授权项，作为一个附确切改动的是或否问题来问；
  - 已撤回并写明原因。

  “后续”“下次”不算状态。
