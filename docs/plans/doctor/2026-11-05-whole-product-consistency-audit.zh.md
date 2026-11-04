# 2026-11-05 全产品审计：一致性与退役功能的依赖清理

用户要求全面审计，重点是一致性和退役功能留下的依赖。本记录审产品，不是单个研究会话的审计。行为证据来自 11-01 审计之后的转录，其中真正的研究只有五个仍在进行的 Codex 会话。

| Item | Value |
|---|---|
| Sessions | Codex 研究会话（只读到 16:36Z，未结束，不评判研究）：`rollout-2026-11-05T01-12-27-01a1a755-4a95`（价格行为）、`01-12-47-01a1a755-99f6`（道氏）、`01-12-55-01a1a755-b9df`（缠论）、分叉 `01a1a758-f47d`、`01a1a75a-1313`，以及 `01a1a760`、`01a1a761`、`01a1a762` 审查子会话。非研究：Codex `01a1958e`、`01a1a503` 等；Claude `44b8d305`（trial 522–576 的工程搬运）、`9682b55d` |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `9de10c38-5927-4c61-a6f8-0ab396701521`，worktree `doctor-consistency-audit`；四个只读子代理（产品契约、残留与依赖、数据与成本、行为与决策）。本会话只写这份记录与索引，没有写修复 PR |
| Checkout / ledger | 审计起点 main `c0e0c01ba`；审计期间 #2116 合入，main 到 `987649db3`，文中行号都在 `987649db3` 上复核。账本读取点 `h6rknqlflujgbcl6uf8recilaittk5bt`（575 个 trial）；复核时头 `9qhqggh69a2nhut72h9hm29libkk23vl`（588 个 trial，研究会话在写） |
| Coverage | 残留：`773ac59b4..c0e0c01ba` 共 246 个提交的删除与改名，代码、测试、skill、评测、蓝图、README、`deploy/`、`docs-site/`、`ide/`，含点路径与忽略文件；Python 与 Node 依赖、镜像、compose、workflow。契约：257 个拒绝码普查，skill 与评测里的命令和标志，事实从属主到消费者的追踪，main CI 日志。数据：账本全部表与列、身份与计数对账、市场目录、物理规模、11-01 后的 token。行为：上述转录的失败、拒绝与绕行。**缺口**：`ledger review`（读全表历史，三个会话在跑，未运行）；账本保真测试（没有已结束的研究会话）；评测未运行；镜像未构建；`next build` 未跑；IDE 未渲染，只读 `/api/lines`、`/api/market-import`；DoltHub 远端内容只看本地跟踪分支；16:36Z 之后的会话；研究方法规范只查到标题，`effective_trials` 公式出处未定位 |
| Cost | **研究**：11-01 审计之后没有已结束的研究会话写过记录，无新的研究成本数据。运行中实测：三个 Goal 被 20261105-01 卡住，累计 token 见该条。**trial 524–576** 是用户授权的工程搬运（13:43–14:39Z），未计入研究。产品造成的无效试验：0 个观察到。**审计自身**：子代理 426,353 token（106k、94k、130k、97k），各 15–23 分钟；主会话 token unknown |
| Net change | 拒绝码 257（上份记录 264）。skill 词数 27,732（上份记录 26,604，同口径）。提议：拒绝码 −4（20261105-10，需授权）；代码约 −150 至 −190 行（-10 约 −133，-11 约 −8，-12 约 −10 至 −50）；依赖 −1 Python、−5 Node；skill 约 +92 词（-02 +35，-03 +12，-04 +10，-05 +25，-14 +10）。skill 增长的理由：都是产品没有的运行时指引，已确认无法由现有输出得到；-07 的词替换净约 0 |

## Findings

证据格式：会话调用与时间（UTC）；当前产品的文件和行；消费者与它影响的决定。「测」为实测，「估」为推断。

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-01 | **`LINE_DATA_TAKEN` 在预检和审查之后才拒，修复建议把关别人的线列为出路；并行开线的问题里没有“两条都留”。第二天默认提交就不再拒** | **会话**：`99f6` 16:29:50、`01a1a75a` 16:30:19、`01a1a758` 16:32:47 被拒，三个 Goal 16:32–16:35 blocked，拒绝时累计 token 5.66M、4.14M、8.52M（含缓存与分叉继承，非净增）。三个会话都没运行 `line close`，这是对的。**产品**：`ledger/lines.py:237` 在写入事务内按字符串比较提交和窗口；`ledger/refusals.py:162-165` 的 next_actions 写 “close it with `line close`”，没说那条线可能属于别的活会话；`research-start/SKILL.md:59-61` 只在提问时要求窗口没被占，提问时这些线还不存在。**消费者**：用户被问“关哪条”；用户在分叉里对同一窗口选了不同方案，是否想都做 unverified。提交是日切，默认 `main` 过 UTC 日界就是另一个值，同窗口同数据第二天不拒（读代码，未实跑） | authority。none 不合适：三条 Goal 真的停了。guard 本身有理由：线靠提交加窗口认领试验（`ledger/lines.py:146-154`）。选项：(a) 拒绝不变，next_actions 改为问用户、不关别的会话的线，skill 在 `line select` 前读开放线（净约 +15 词，竞态仍在）；(b) 登记时写明线名，允许同窗口并行，碰存储字段，要走独立审阅；(c) 维持，一次一条线。建议先 (a)；用户要并行同窗口才走 (b) | minutes（测到 16:42，用户未答）；估计还在增长 | open |
| 20261105-02 | **Nautilus 是编译绑定，读 API 的常规办法落空，skill 没说，作者和审查者每次试错** | **会话**：11 个 rollout 46 次 API 查询 27 次非零退出（正则统计）。例：`01a1a755-4a95` #20–23（16:17:58–16:18:25）、`01a1a761-a0d1` #8–9。**产品**：复现 `nautilus_trader.trading.Strategy.cancel_order` 是 `method_descriptor`，`__doc__` 为 None；`nautilus_trader.trading.strategy` 无此模块；签名在 `.venv/.../nautilus_trader/trading/__init__.pyi`；`.gitignore:2` 让 `rg 'def cancel_order' .venv` 0 个文件，`rg -uu` 7 个。`research-round/references/strategy-authoring.md:177` 的一节不提这些。**消费者**：source review 的 api 项要求逐个核对原生调用（`research-round/SKILL.md:48`），空结果看着像“没有”；到 16:36 尚无审查者据此下错结论 | skill：Verify Nautilus 一节加一句，约 +35 词。none 不合适：每个新会话重来，且空结果陷阱落在审查项上 | minutes（测 27 次失败）；token 估 | open |
| 20261105-03 | **账本判断写“换线到期”，那是旧规则的计数，Agent 照搬告诉用户** | **会话**：`4a95` #8（16:13:44）读 judgment 589（11-01 02:36，channel-breakout 线），16:14:06、16:15:59 选项 C 说到了重新选线的节点。**产品**：`research-round/SKILL.md:110-112` 现在要求三个区间都含零才算；20261101-06 记 trial 510 的学生化和年化区间排除零，按现规则序列断开（510 的数取自 11-01 记录，512 未查，unverified）。`research state` 无到期字段。**消费者**：这次用户本来要新方向，没改决定；将来选这条线的会话读到判断里的 Stop 就会停 | skill：到期按现规则从比较重算，判断里记的计数不算，约 +12 词。fix 不合适：到期字段不是信任边界 | unknown | open |
| 20261105-04 | **readiness 给的导入服务读法在它要求的检出里跑不通；“镜像唯一”没有命令** | **会话**：`99f6` #10（16:15:50）照 `readiness.md:91` 跑 `docker compose ... ps market-import`，报 `TRADE_UID` 缺失；#11–13 改 `docker ps`、读 `market/follow.py` 找路径；`4a95` #5 猜 `market status`，`USAGE_ERROR`。“镜像唯一”（`readiness.md:78`）：`4a95` #9、#18，`b9df` #9–10 用 `from runtime.image import resolve`，`99f6` #6 `rg image_ref`。**产品**：`deploy/compose.yaml:19` 要 `.env`，只有主检出有；`readiness.md` 又要求不在主检出工作。**消费者**：最后都报对了，多绕几步 | skill：改成 `docker ps --filter label=...` 和 `docker exec <name> cat <status 路径>`，约 +10 词。“镜像唯一”半句：authority（删它是净减，但 AGENTS.md 把 skill 里的检查算在内），`replay precheck` 本身返回 `image_ref` | minutes（`99f6` 4 次调用约 30 s；每会话 2–4 次） | open |
| 20261105-05 | **skill 让 Agent 在主机写市场，部署文档说必须在容器内** | **规范**：`deploy/README.md:50` “Market writes run in market-import ... the import lock excludes only processes that share the Docker VM's kernel”。**产品**：`research-start/SKILL.md:8` 命令都是 `uv run --frozen python -m cli.main`，`references/readiness.md:59-61,94-95` 让 Agent 列 `market import-quotes`、`market import`；`.agents/skills` 无 `compose exec`。`market-import` 持续跑 follow。**消费者**：用户同意补导入后，Agent 在主机写入并与 follow 并发；`CONCURRENT_IMPORT` 只挡一部分。本轮无人走到 | skill：一句路由，约 +25 词。fix 不合适：拒绝主机写入是新拒绝且需授权，一句足够 | unknown（估：并发破坏未观察到） | open |
| 20261105-06 | **IDE 留着 Dolt 市场时代的说法：对话模型的工具说明和状态栏** | **产品**：`ide/agent/src/chat.ts:18-19` “A market database holds Binance market data”；`ide/agent/src/tools.ts:64` “market commit, tag or branch”，而 `market/files.py:381-383` 对 tag、branch 报 `UNKNOWN_REF`；`ide/web/src/shell/StatusBar.tsx:31` 取 `market.slice(-4)`，日切提交（8 位日期加 24 个 0）恒显示 `market …0000`。#2095、#2116 都没动 `ide/`。**消费者**：对话模型拿到错的工具说明；用户从状态栏分不清运行用的哪天市场。8 个旧 id 不受影响 | fix，净约 0 行 | wrong output（状态栏确定性错误，测）；工具说明无观察到的后果 | open |
| 20261105-07 | **#2116 合入后仍留下的市场旧说法，部分与它的说明相反** | **产品（main `987649db3`）**：`.agents/evals/research-start/missing-market-commit-offers-runnable-lines/graders/criteria.md:5` “no branch of the active market database”（#2116 说明称已改）；`docs/plans/market-data-sources.zh.md:35` 仍提已删的 `market-review-prompt.zh.md`，`:82` 仍写 `market-old` 清理“暂停”，而目录已不存在（`ls $TRADE_DATA`）；`readiness.md:54-55` “market\n database holds”（换行漏过）；`research-start/SKILL.md:63` “market head”、`:67` “restoring a market commit”；`report/status.py:569,590`、`report/seams.py:55` “holds no version”；`registration/inputs.py:4,183`、`registration/validation.py:244`、`tests/registration/test_inputs.py:1` “AS OF”；`README.md:116` “Both are public.”，市场目录没有公开副本；`deploy/README.md:26` config `market-import`，同文件 `:31` 与 compose 都是 `market`；评测 `sequence-gap-month-hands-back-choice/prompt.md:14` “生成新市场提交 p7r2x1a”，`readiness.md:61-62` 说提交不动。**另**：#2116 说明写 doctor 记录保留，却删了 `doctor/2026-10-29-ide-market-replica.zh.md` 和索引行 20261029-25；`record.md` 规定记录写成后不改。无断链（`rg` 0 处）。**消费者**：`README.md:116` 影响恢复判断（估）；其余本轮无后果 | fix + skill，净词约 0；grader 按 AGENTS.md 自成一个 PR。被删记录：要不要从 Git 恢复，是用户的“不留痕”决定和 `record.md` 的冲突，由用户定 | none | open |
| 20261105-08 | **设计站和部署注释与代码不符** | `docs/rd/comparison.mdx:128` “比较时只比摘要，不同就判不可比”，`registration/comparability.py` 与同页 `:244` 是运行加复现取结果，#2113 后搬过的运行不再如此；`docs/rd/design-code-ledger.mdx:2924` `matches` “original fingerprint”，`ledger/reproduction.py:87` 是 RESULT_TABLES 的语义哈希；`docs/rd/platform-architecture.mdx:35` 镜像 `strategy-runtime`，`runtime/image.py:45` 是 `trade-runtime`（20261031-10 的剩余）；`docs/rd/design-code-engine.mdx` 称 `add_venue` 用 `account_contract`，代码 0 次调用；`deploy/compose.yaml:3` “docker compose pull && docker compose up -d”，`deploy/README.md` 说只按名字更新受影响的服务（照注释会重建 ledger，估）；`ledger/reproduction.py` 的 Source 锚点 #L37，实际 L82，全量 264 节中 161 个行号不对（脚本统计，抽样 1 个）。扩展 20261029-108 | fix，文字净约 0。锚点：去掉行号或校验，由修这条的 PR 定 | none；compose 注释潜在高后果（估） | open |
| 20261105-09 | **`websockets` 与 `service` 依赖组无导入者，#2102 说明称已删，实际没动** | **搜索**：`rg --hidden --no-ignore -l '^\s*(import\|from)\s+websockets\b' -g '*.py'` 排除 `.venv`、worktree 后 0。**产品**：`pyproject.toml:13,17,23-25`（注释“The long-running services' own needs”已不实）、`deploy/Dockerfile:35,37`、`uv.lock`；`git show 647bd3a8e --stat -- pyproject.toml uv.lock deploy/Dockerfile` 为空。保留的决定只在本机 memory（“等 `uv.lock` 下次变更”）。**消费者**：无。**代价依据**：`uv.lock` 在 `market/export.py` `EXPORTER_FILES` 内且触发 `runtime-image.yml`；`report/status.py` `_behind` 按摘要比较，新摘要让所有线的运行进 `runs_behind_image`（读代码；镜像内容是否真变 unverified） | remove，但和下一次必须的镜像变更同做（一起带上 -12 的 `account_contract`、`engine/runtime/Dockerfile.dockerignore` 的冗余行），不单独触发。若下一次变更在搬完剩余 112 个运行之前，就少搬一次 | none | open |
| 20261105-10 | **`report/reproduce.py` 的 `compare_runs` 从未接入产品，四个拒绝码只由它引发** | **搜索**：`git grep -n compare_runs -- '*.py'` 只有定义和 `tests/report/test_review.py`；`report/reproduce.py:27,44,53,74` 是 `RUN_INCOMPLETE`、`SAME_RUN`、`PAIR_INPUT_MISMATCH`、`EXPORT_INCOMPLETE` 的唯一引发处。`cli/replay.py:13`、`report/seams.py:70` 的 `reproduce` 是 `replay.reproduce`，另一个模块。蓝图 `docs/rd/design-code-report.mdx:827-860`。配对回放走 `engine.compare_reports`（`engine/README.md`），不受影响 | authority（删拒绝码），然后 remove：约 −83 行代码、−50 行测试、4 个码、蓝图一节。替代是接 CLI，没有需求证据 | none | open |
| 20261105-11 | **`LedgerProfile.holds` 分支只认 Dolt 时代的市场 profile 文件** | `ledger/db.py:97-98,631`；`cli/main.py:148-149` 已覆盖市场路径。今天的 `market.json` 键是 name、kind、role、root（测），没有 `database`，`from_json` 抛 KeyError 后 `profiles()` 跳过，结果 `LEDGER_UNKNOWN`。`tests/ledger/test_db.py:141-142` 用伪造对象。`deploy/compose.yaml` 的 `"holds": "research"` 随之去掉 | authority（碰拒绝路径），然后 remove，约 −8 行；`LEDGER_KIND` 码保留 | none | open |
| 20261105-12 | **无消费者的名字** | 每项 `git grep -w` 复核（抽样 10 个我自己再查）：`engine/config.py:118` `account_contract`（改它出新摘要，并入 -09）、`ledger/paper.py:34` `DAY_NS`、`paper/serve.py:48` `READINGS_SECONDS`、`registration/duties.py:14` `GROUPS`、`registration/register.py:48` `OPTIONAL`、`registration/register.py:513` `validate`、`ledger/publish.py:88` `_install_key`（仅测试）、`replay/entry.py:222` `summary_problems`（仅测试）、`report/attribution.py:404` `attribution`（仅测试，连带 `report/comparison.py:364,388` 的 `part`）、`ide/research_graph/serve.py:324` 参数 `line`、`ide/research_graph/cli.py:71` `TRADE_IDE_BUILD`、`ide/web/src/lib/paperApi.ts:93` `priceText`、`ide/web/src/components/RunTile.tsx:38` `returnOf`、`ide/web/src/lib/agentApi.ts:14` `AgentInput`、`ide/research_graph/layout.py:198` `meeting_targets`（或接到 20261031-09 的显示上） | remove，约 −10 至 −50 行（估）。`report/review.py:28` `FINDINGS` 有文档价值，不删 | none | open |
| 20261105-13 | **Node 依赖无直接导入，docs-site 带旧项目名** | `ide/web/package.json` `@visx/shape` 0 导入；`docs-site/package.json` `cnfast`、`remark-gfm`、`remark-parse`、`unified` 0 导入（测）；`docs-site/package.json:2` `vibe-trading-docs-site`。`ai`、`@fontsource`、`react-dom`、`postcss` 要保留。未跑 `next build`，传递依赖行为 unverified | remove，−5 依赖加 lock，构建通过后才算 | none | open |
| 20261105-14 | **`REPRODUCTION_MISMATCH` 比 skill 说的宽** | `research-round/references/changes.md:18` “means the result changed”；`replay/reproduce.py:82,94` 还在配置不同、预检在另一镜像时用同一个码，且未写任何东西。**消费者**：Agent 可能把配置错误报成结果变了，把运行列成历史。未观察到 | skill：按 `message` 分开读，约 +10 词 | unknown（估） | open |
| 20261105-15 | **两处规则字面冲突** | (1) `AGENTS.md:39-40` `replay reproduce` “are research records of exposure”，`changes.md:15` “no exposure”，`registration/register.py:431-462` 匹配的复现不计新暴露。(2) `research-start/SKILL.md:37` “Only a gate no research step can lift stops a line”，同段把 `RUNTIME_UNSUPPORTED` 的解除写成搬运行，那正是研究步骤 | authority：AGENTS.md 和停止规则由用户定。措辞建议：AGENTS.md 加 “a match adds none”；`RUNTIME_UNSUPPORTED` 归为下一步，搬被拒才停 | none | open |
| 20261105-16 | **`docker-api` 容器绑定已删除的 worktree** | `docker inspect trade-ide-docker-api-1`：配置挂载 `.claude/worktrees/log-rotation/deploy/docker-api.cfg`，working_dir 同（测）；该路径不存在（测）。`services/ide/docker/docker-api.cfg` 是未跟踪的空目录，可能是同样机制留下的（unverified）。**消费者**：`paper` 经它访问 Docker；容器在跑，配置已在内存，重启后果 unverified，估计失败或挂到空目录 | authority（宿主操作）：用户从主检出运行 `docker compose -f deploy/compose.yaml up -d --no-deps docker-api`。产品不改 | none；潜在影响 paper（估） | open |
| 20261105-17 | **新起点选项不要求机制和前人结果** | `4a95` 16:15:59 选项 A 没有来源调用和成本承担者，用户 35 秒选定，`research-sources` 16:17:58 才开始；`99f6`、`b9df` 提问前查了。`research-start/SKILL.md:72-76` 的清单没有这一项，`hypothesis.md` 登记前才生效 | skill，约 +8 词，优先级低；方向是用户定的，这条可以不做 | unknown | open |

### 沿用旧 id

| id | 新证据 | 处理 |
|---|---|---|
| 20261031-09 | `rg 'gates\|runs_behind_image' ide report/graph.py` 0 处；现场 rsi 线有 `INTERPRETATION_REQUIRED`、34 个运行落后、4 个未审，IDE 上不可见。Nielsen #1。决策错误未观察到 | 仍 open，fix：把已有读数接到线菜单，约 +40–80 行（估），先给用户看预览 |
| 20261026-05 | 同一根因换路径：`.claude/launch.json`、`.codex/`、`.review-shots/` 未跟踪未忽略（`git check-ignore` rc=1），宿主复制进新 worktree，5 个会话 `git status` 都不干净（`4a95` #2，16:12:40），各自造 `/tmp` 检出，`01a1a758` 和 `4a95` 共用一个 | recurred，fix：`.gitignore` 加三项，不动检查 |
| 20261022-14 | 备份 `manifest` 修改时间 10-25 18:38 JST（测，确切头未读）；`dolt_log` 之后 1,644/2,708 个提交（61%）；trial ≥ 214 全在备份外；DoltHub 跟踪分支与头一致（测）。`report/review.py:97-98` 仍报 `ancestor`。用户 10-22 定“暂不加同步步骤，也不改 review”，当时差 122 个提交。`AGENTS.md:56`、`README.md:112` 仍把它算副本 | 用户决定过，所以不算新缺陷；差距变了，再问一次。authority：(a) 关线时同步一次；(b) 承认 DoltHub 是实际第二份，改两处说法 |
| 20261031-10 | 四服务和 market-supply 已修；`strategy-runtime` 仍在；research-start 页未核 | 仍 open，并入 -08 |
| 20261101-05 | `4a95` 选项 C 有目标达成和区间，没有 `detectable_annual_return_difference_80pct_normal_approx` 0.0734。从 `01a19154` 抽 16 对，15 对观察差小于可检测差（正则配对，未逐条核对），连续分不开多半反映窗口分辨力 | recurred（部分）。这次不是换线主路径，暂不加词；规则是否要看可检测差由用户定 |
| 20261027-07 | main CI 41846260218 无 `BrokenPipeError`、`ConnectionResetError`（测） | unobserved |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `report/reproduce.py` 与 4 个拒绝码 | 跨镜像比较两个运行 | `replay reproduce` 的结果表比较；`engine.compare_reports` | 无调用路径 | 删（需授权，-10） |
| `LedgerProfile.holds` 分支 | 把市场 profile 当账本用 | `LEDGER_UNKNOWN`；`cli/main.py:148-149` | 今天的文件走不到 | 删（需授权，-11） |
| `websockets`、`service` 组 | 无 | — | 无导入者 | 删，随下次镜像（-09） |
| IDE 镜像里的 Dolt（`deploy/Dockerfile:22,28-30`，约 160 MB） | `backup_head`、服务管理要二进制 | service 阶段 | IDE 无 Dolt 能否完整运行 unverified，`replay report` 经 `report/review.py:84-89` 可能走到 | 不提议，先 measure |
| `WITNESS_UNAVAILABLE`（目录项，`ledger/witness.py:155` 只作 reason） | 见证不可用时说明原因 | — | 有 2 个测试，silent，无独立价值 | 不动，只是文档作用 |
| `AUDIT_NOT_RUN`（`qualification/availability.py:133-134`） | 审计没跑的运行 | `run.audit` 对 `passed` 恒定 | `passed` 行不可达，invalid 路径仍可达 | 不动，不是残留 |
| 10 个 `v_*` 视图 | 人临时查询 | — | 无产品读者，`ledger/refusals.py:110` 指向 `v_evidence` | 维持 20261031-16 的 measure |
| 收据里无读者的项（`commands`、`mounts`、`exporter_source_sha256` 等，估约 3 MB） | 无 | — | 无读者 | 不动：占证据 5%，改要动格式且不能重写旧行 |
| `agg_trade`、`quote`（78.7 GiB，97%） | 报价撮合 | — | 575 个 trial 里 1 个用过 | 不提议，用户定过 `--quotes-from 2020-01`；只记比例（measure） |

### 查过且干净

退役的拒绝码、命令、标志、表和服务名在产品路径里都是 0 或合法用法。每个拒绝码都有引发处或明确用途。skill 和评测里的命令、标志、snake_case 字段全部存在。`pyarrow`、`pymysql`、`jsonschema` 都有导入者；`[visualization]` 要保留（`nautilus-report-analysis`）。`docker-api.cfg` 允许列表都被用到。compose 的卷、配置、环境变量都有消费者；`trade-market-record` 已不在。账本身份、计数对账、8 个旧市场 id、旧格式读取都对得上，没有失败尝试留下的坏行。市场目录 7/7 张表与注册表一致，无 spool、receipt、version、liquidation 残留。ruff、mypy 干净；CI 的 warning 都有归属，只有 7 条 `SubscribeFundingRates` 在测试中的原因未验证。退役后三个主会话 3.5–4.7 分钟走到提问，没有一个去找已退役的东西。

### 本机清理（产品不改，删除由用户定）

- `~/.config/trade/r2-market.json`：R2 已在 #2105 弃用，未读内容，key 是否吊销由用户定。
- Dolt 卷 `.dolt/tmp/buffered_file_byte_sink_1974208896` 1.59 GB，11-01，无进程打开，是账本 170 MB 的 9.4 倍；与 11-01 内存事故的关联 unverified。
- `/private/tmp/trade-market-cache` 3.8 GB；`trade-ide:pr-2048` 1.49 GB；`trade-runtime:pr-1979` 881 MB（保留的运行镜像，需授权）；`$TRADE_DATA/ledger-probe` 195 MB；`rd-chain-draft-20261012`、`video-evidence-drafts-20261010`、`worktree-cleanup-20261022` 38 MB；`ledgers/prefix-probe.json`。
- 主检出未跟踪：`backtest/__pycache__`、`services/ide/docker/docker-api.cfg` 空目录、`.claude/launch.json:8` 指向已不存在的 `services/ide/ide.py`。`git worktree list` 46 行。

### 问用户的事实，不算发现

`ide/overview/src/main.ts:13,160-219` 仍有内存里的爆仓推送，页面写明不作研究证据，与已退役的录制器无关。用户 11-04 “不自采”是否也覆盖它，unverified。

## 索引状态校准

契约工作流把约 24 行报成“已过时”。这些行修复已合入，状态是 `unobserved`；按 `record.md`，这个词的意思就是修了但没有研究会话走到，所以不改。真正变化的只有下面这些。

| id | 变化 | 依据 |
|---|---|---|
| 20261031-08 | `in PR` → `fixed 0228a2b0d` | #2100 已合入 |
| 20261101-01 | → verified | `99f6` 16:22:54 `tags: 0`，`4a95`、`b9df` 同（测） |
| 20261101-03 | → verified | 四个会话读到 RSI 线 `INTERPRETATION_REQUIRED`，无人称其停线 |
| 20261026-08 | → verified | `99f6` #8、`4a95` #31 的来源说明记 no key 并照常检索 |
| 20261028-12 | → verified | `99f6`、`01a1a75a` 的 `replay precheck` 无 `RUNTIME_*` 拒绝 |
| 20261025-24 | → verified（提问部分） | 三次提问都没给必拒或缺数据方案；之后的竞态记 -01 |
| 20261025-06 | recurred | `99f6` 16:31:28 提问后又复核两轮，16:32:17 才 blocked |

## Decisions

用户 2026-11-05 从主检出重建了 `docker-api`（20261105-16）。复核：挂载 `deploy/docker-api.cfg` 在主检出，`paper` 容器访问 `docker-api:2375/_ping` 返回 OK，paper 运行容器未受影响。这是宿主状态，直接检查就是对应的证据，所以索引记 verified，没有等研究会话。

其余待决：20261105-01、-04（半句）、-07（被删记录）、-10、-11、-15，20261022-14。
