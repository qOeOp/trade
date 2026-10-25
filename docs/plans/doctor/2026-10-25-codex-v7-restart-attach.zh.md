# 2026-10-25 v7 重启研究线（Codex 会话，attach 跟读）

按 product-doctor 跟读一个正在运行的 Codex 研究会话（attach 试运行）：Claude Code 会话只读跟随 Codex rollout，同时审计会话触及的模块（活动账本服务日志、DoltHub 发布、trade-ide 同步、市场覆盖）。没有给研究会话发消息，也没有写账本或市场库。发现由主代理逐项回到代码与日志核对，未另派 fresh 子代理复核。

| 项 | 值 |
|---|---|
| 会话 | local Codex Desktop（cli 0.164.0-alpha.11.1），`rollout-2026-10-25T16-06-41-01a171e2-0813-70f0-b1eb-5c8e8095c13c.jsonl`，2026-10-25T07:06:41Z–10:08:22Z；7 个子会话（`01a171ff`、`01a17204`、`01a17211`、`01a1721e`、`01a1722a`、`01a1723e`、`01a1725b`：六个预检审查与一个关线），工作目录 `~/.codex/worktrees/b6c8/trade`（检出 `8c5cd561f`） |
| 审计会话 | Claude Code desktop，claude-opus-5-5，会话 `2ceeb9f3-f087-4470-be17-84f10fed74dc`（宿主、模型与研究会话不同；同一会话此前做过 trade-ide 改名） |
| 检出 / 账本 | 审计时 main `5d1ebea4e`；活动账本 `research` 自 `27j95akj…` 起（会话开始时的 head），至 `odeo1h7mc6e429dohb6qrjt6vd89eusi`（judgment 270/271 后，本地、`dolt_backup`、DoltHub 一致）；市场固定 `l1kfbo4b2of54ijpjnpn02ijdm175aqd` |
| 覆盖 | 行为：主会话全部用户轮、调用与输出（长输出两端各 2,500 字符），Goal 事件，提问与回答时序。数据：账本服务日志 `server.log`、trade-ide `/api/events` 时间戳、Codex 重定向到 `/tmp/ema-*` 的 CLI 结果文件、进程采样（08:36–08:40Z）。契约：`ledger/publish.py`、`cli/main.py` `_publish_after`、`registration/register.py` `_check_lineage`、`registration/validation.py`、`services/ide/research_graph/serve.py`、research-start（SKILL、readiness、selection、recommendation）、research-round（SKILL、template）。缺口：子会话只读了元数据，审查简报为密文、审查过程未读；每次推送的成功连接不记日志，只能由拒绝与结果文件推断；市场库与 `dolt_backup` 未单独查；Codex 读的宿主记忆文件未审 |
| 用时构成 | 3 h 02 min。主研究轮 7,423 s（research-start、关旧线、6 次正式研究 trial、6 次预检、1 次复现、推荐复核）；其后四轮约 22 min，含等待用户。发布被拒的排查与重试：两次各约 2.5 min，另有 08:36–08:40Z 一次只读自诊。研究、发现、等待的细分未逐段计 |
| 产品导致的无效试验 | 0（trial 199–211 全部 passed）；两次发布被误报为远端分叉 |
| 新发现按动作 | fix 3（-12、-16、-22）/ skill 4（-13、-15、-19，-14 的 skill 部分）/ authority 3（-14 的检查部分、-20、-21）/ measure 2（-17、-18）/ none 0 |
| 复发项 | 无 |
| 用户先发现 | 0 |
| skill 体积 | 各 skill 目录 `.md` 空白分词：research-round 8,393、product-doctor 2,555、research-start 2,409、nautilus-report-analysis 2,125、research-sources 1,925、video-evidence 4,830。上份记录按全部文件计，口径不同，增长原因未查 |

## 经过

07:06Z research-start 读出唯一一条线停在 v6（`RUNTIME_UNSUPPORTED`），给出 A/B，用户选 B（在 v7 上以条件数量 EMA 重启），建 Goal。07:34Z 发布 `ema-entryvar-rollingref@1`（父 `ema-entryvar@2`），07:35:52Z 就 37 个零成交预热分钟提问，未等回答就加证据并跑预检 199，用户 07:38:31Z 答“保留原范围”。之后 fresh 审查、选线、登记（派生、对照为空）、子代理关旧线，trial 200 年化 22.49%、回撤 8.47%、Sharpe 1.711。随后五组对照（逆波动 203、固定 0.4 BTC 205、入场名义预算 207、持有只减 209、不利半方差 211）都没有改变工作参考；只有 207 把回撤降到 7.17%。09:45Z 换线条件触发，Goal 完成，Codex 给出 A/B。用户问推荐后选 A，再选“BTC 2022–2024 多年历史”；Codex 先后查到暴露检查与市场只能向后追加两道阻塞。10:07Z 用户结束研究，先修产品。

## 发现（按会话代价和影响面排序）

| id | 发现 | 证据（会话；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261025-12 | 两次发布同时推同一个 head 时，输的一方被报成“公开副本被别处改过、覆盖需用户授权”，实际远端已是本地 head | 第二个发布者是另一会话 worktree `.claude/worktrees/ide-agent-chat` 里本地模式的 IDE（`ide.py serve --ledger=research --port=8775`），每 5–11 s 跑一次 `cli.main ledger sql --ledger=research SELECT 1`（`services/ide/research_graph/serve.py:74`，main 同码）；`ledger sql` 带账本，`_publish_after`（`cli/main.py:866-888`）在本地领先时就发布。`server.log` 17:10–17:32 JST 有 16 次 `[rejected] main -> main (non-fast-forward)`，绝大多数紧挨 Codex 结果文件里的成功发布约 4 s 之前，含 2–4 s 内成对的连接（7276/7316、8316/8322）；进程采样 08:36–08:40Z 抓到该轮询。Codex 输了两次：trial 200（07:46:58Z，连接 2410）与 trial 207（08:32Z），两次 trade-ide 都随即拉到了被“拒绝”的提交，本地与远端 head 相同。`_push`（`ledger/publish.py:133-146`）凡文本含 rejected 就报 `PUBLISH_REJECTED`，`publish()` 不加锁、被拒后不 fetch。Codex 第一次对用户说“远端 main 出现了本地历史未包含的提交”（不实）并排查数轮 | fix（用户 2026-10-25 批准：发布在服务上持命名锁串行；推送被拒后先 fetch，远端 head 等于本地 head 即视为已发布，只有远端不是本地祖先时才报 `PUBLISH_REJECTED`；拒绝本身不放宽） | 两次误报，各约 2.5 min 排查加一次 4 min 自诊；用户被告知不实的远端分叉 | open |
| 20261025-22 | 只读的读者也是发布者：任何带账本的命令在本地领先时都推送，所以轮询最新提交的页面会和写入方抢推 | 同上；`_publish_after` 只排除 `ledger publish`、`market publish`、`ledger service`。本地模式 IDE 每次轮询都启动一个 `uv run` 并可能推一次 DoltHub | fix（另一根因：IDE 本地模式取 head 不走会发布的命令，或读命令不发布；与 -12 分开交付） | 本地 IDE 运行期间每 5–11 s 一个进程 | open |
| 20261025-14 | 派生登记可以空对照，只要 `rationale.local` 非空；schema 说的豁免条件（父运行故障或零活动）没有被检查。v7 重启登记成 v6 候选的派生、对照为空 | 登记 `registration-ema-entryvar-rollingref-v7-20261025`（账本 `4b9l2iai`，07:44:46Z），理由写的是父契约已不能运行，不是故障或零活动；`registration/register.py:255-268` 只查非空。template.md 说新起点是根（无父、无对照、`changed_duties` 为空），research-start 没有“从旧契约候选重启”的规则。结果：首报同时改了环境与 B3/E1 两项职责，对着一个不能重放的父，它登记的方向预测（mean_notional 下降）不可检，Codex 自己也这样写了 | skill（research-start：在新契约上重启，以根开始，携带旧候选的思路）；检查部分 authority（只在父运行故障或无活动时允许空对照，需用户授权） | 首报不可比；未造成无效 trial | open |
| 20261025-19 | 换线条件第一次在真实会话里按时触发，但给用户的选项只有同一方向的两项，没走 research-start 的列线 | 09:45Z 连续五次比较未改变推荐、差均在可检出差内，停止登记；research-round `SKILL.md:66-69` 要求经 research-start 把本线与其他选项一起给出。Codex 09:33–09:45Z 未读 research-start、recommendation.md、selection.md，也未跑 `candidate list`，只给 A（同方向新范围）、B（以 trial 207 为起点）；用户问“你推荐呢”后才于 09:50Z 读这些文件 | skill（换线时先跑 research-start 的列线，再提问） | 用户在缩小的选项里选了 A | open |
| 20261025-13 | readiness 要求凡覆盖异常都以数据/范围问题结尾，Goal 规则说只问阻塞本线的问题；Agent 问了又没等 | readiness.md “Coverage disposition” 第 4 项；research-start `SKILL.md:66-67`。07:35:52Z 问 37 个零成交预热分钟（在开发窗口外，不在日线收盘），07:37:18Z 说“按已选的原提交、原窗口”，07:37:26Z 加证据、07:37:49Z 跑预检 199，用户 07:38:31Z 才答 | skill（只在异常落在窗口内或策略读取的输入上时提问；否则报告后继续） | 约 2.5 min；对用户称“已选” | open |
| 20261025-21 | 冻结源码不能换窗口或资产再登记：暴露检查按源码全局判断，延长历史只能改检查 | 10:02Z Codex 方案；`SOURCE_ALREADY_EXPOSED`。不改检查的路：`validation registration` 只收登记见证之后开始的窗口（`registration/validation.py:199`），套不到历史；`replay explore` 不算证据；新候选须有实质改动（不为绕过暴露做字节改动，见 20261025-04）。Codex 给用户的消息说需要授权，未列这些替代 | authority（用户决定是否允许已暴露源码在声明的新增开发范围上登记，保留全部暴露历史） | 用户所选范围无法执行 | open |
| 20261025-20 | 市场库只能按月向后追加，2021–2024 年补不进现有库 | 10:06Z Codex 读 `market/store.py` 后更正 10:05Z 的“会进 dolt”；历史原档已核：2022–2024 LAST 1,578,240 行、缺 0 分钟、零成交 271 分钟，MARK 缺 4,322 分钟，资金费无缺（`/tmp/ema-next-line-audit/stopped-handoff.md`） | authority（补录更早月份需改导入拒绝；或换范围） | 同上 | open |
| 20261025-15 | 没有任何研究 skill 说明 `--execution bars|quotes` 怎么选 | 预检 199 用 bars（不开强平）；BTCUSDT 2025-10..2026-09 有推算报价，与本线窗口重合。本线 1 倍杠杆影响小，带杠杆的线影响大 | skill | 未量 | open |
| 20261025-16 | `replay report --exposures` 没有复现时返回 `exposures: null`，不说原因 | `report/runs.py` `tables()` 无复现时为 None；Codex 对用户说“详细 exposure 表缺失” | fix（给出 null_reason） | 小 | open |
| 20261025-17 | `candidate list` 一次 24,205 token（69 个候选），研究入口每次都要读；首轮读了三次，只用到两个候选 | exec 输出 `original_token_count` | measure（先量按线或按状态过滤能否满足入口） | 约 73k token | open |
| 20261025-18 | 每次调用重读的上下文从约 24.5 万涨到约 37.5 万 token；会话累计 45.2M | `token_count` 累计：08:07Z 每调用 +245k，09:19Z +375k；09:59:43Z 首次压缩（约 40.5M 时）；Goal 自报 `tokensUsed` 944,416，与累计口径不同。单次输出 24k–26k 字符的读数此后每次调用都在上下文里 | measure（量大输出与重定向文件读取对每调用上下文的贡献） | 45.2M 累计（大部分为缓存输入） | open |

其他观察，不立项：Codex 把多数 CLI 结果重定向进 `/tmp` 文件，只读 rollout 会漏掉产品结果（本次 16 次拒绝只在 rollout 里出现 2 次）；Codex 的推荐两处引用其宿主记忆文件（`~/.codex/memories/MEMORY.md:269`、`:280`），research-start 说会话记忆不是记录，规则本身合理但对其他宿主不可见；非零退出均为 Codex 自写的 `/tmp` 脚本；trial 200、203、205、209、211 的最大回撤都是 8.47%（同一 10 月回撤段，Codex 08:21Z 自己指出）；`DOLT_PULL` 会带上 `line/` 标签（trade-ide 副本里有 `line/20261022-ema-cross-btc-daily`）。

## 测量：写入到 trade-ide 显示

真实账本写入到 trade-ide `ready`：31 s（`c5rkcqi6`，源码审阅）、26 s（`acir1u71`，选线）、26.5 s（`4b9l2iai`，登记）；其后多次 7–12 s（从 IDE 收到新 head 起算）。前两次拆分：提交到发布返回约 10–12 s（DoltHub 推送），发布到 IDE 开始绘制约 9–11 s（5 s 轮询加拉取），绘制约 7–8 s。

## 已修项的本次读数

| id | 本次 | 状态 |
|---|---|---|
| 20261022-10 | 换线条件按可观测规则在第五次不变后触发，停止登记并回问 | verified（本记录）；回问的完整性另立 20261025-19 |
| 20261023-04 | 六次预检各派一个新的审查子代理，没有跨版本复用 | verified（本记录） |
| 20261023-03 | 推荐只在首报后与 REVIEW_DUE 时各写一次（judgment 270），每次运行只写解读与优先级 | verified（本记录） |
| 20261022-11 | 只对 trial 200 做了一次复现，没有无条件复现每次运行 | 部分改善；token 成本见 20261025-18 |
| 20261020-38 | 七次 `fork_turns: none`；简报仍为密文 | 不变 |
| 20261023-07 | 一次压缩后重读 research-start 四个文件与宿主记忆一次 | 仍为 measure |
| 20261025-06 | 有 Goal 时提问后未空转（修复未合入，不算验证） | open |
| 20261022-13、20261022-16、20261023-02、20261023-06 | 未读审查子会话，路径是否触发不判定 | unobserved |

## 删除清单

无。

## 决策

- 2026-10-25 用户批准修 20261025-12：发布串行加锁，推送被拒先 fetch 比对；拒绝本身不放宽。
- 2026-10-25 用户选择在 BTC 2022–2024 上继续本线后又结束研究，先修产品；这一选择不授权修改暴露检查或导入检查（20261025-20、-21 待裁定）。
