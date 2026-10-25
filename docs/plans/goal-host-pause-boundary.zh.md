# Goal 提问与暂停的宿主权限边界（2026-10-25）

用户确认先同步远程 main，再修正 Goal 提问与暂停指导，同步 skill 和文档，新增对应评测，不改产品代码，先交付验证结果、不提交。已 fetch 并从当时最新远程 main `fe944effaa9d277ac376455ab6674f5ed5147b27` 新建分支。

## 诊断与实施范围

从既有 [v7 会话诊断的 20261025-06](doctor/2026-10-25-codex-v7-stranding.zh.md)及 [Doctor 索引](doctor/index.zh.md)落实修订；原诊断只读，不改写。本项不是新的整体产品或研究会话审计。

原 research-start 以“有暂停工具／无暂停工具”决定动作，没有区分工具存在与宿主当前是否授权。Codex 的暂停工具要求用户明确请求暂停，不能由 Agent 因为要提问就自行调用。

- `research-start/SKILL.md` 改为先核宿主权限，包括其要求的明确用户请求；工具存在不授予暂停权限。
- 当前允许时，仍可在阻塞提问前调用暂停工具，且只在成功后确认已暂停。无工具或当前无权调用时，把暂停请求／操作说明与阻塞选择合在同一次提问中结束回合；不新增报告格式等次要问题。
- 未答的续跑保留原问题，不做依赖答案的工作；只按宿主权限和阈值处理状态变更（包括 blocked），然后结束回合。不通过完成、重建 Goal 或额外轮询绕过权限。用户后来只要求暂停，不等于回答了研究选择。
- 入口、skill 设计页及总待验证清单中英文同步，保留能力锚点和待验证标签；Doctor 只更新本项实施进度，仍未结。产品代码、Agent 规则、其他 skill 与全部既有评测保持不变。

这不能消除宿主自行安排的续跑回合，也不证明暂停立即中断正在执行的工作。宿主暂停延迟 `20261021-29` 继续 open；本项不创建调度器、重试计数或新存储字段。

## 新增评测与结果边界

新增 `.agents/evals/research-start/goal-host-pause-permission/`，覆盖：工具存在但暂停须明确请求、第一次未答续跑、宿主规定的第三个连续阻塞回合、后续用户仅请求暂停，以及允许自动暂停的另一宿主。三个回合来自情景中的宿主契约，不写入通用 skill 作为新阈值。

用例只允许 Read、Glob、Grep、Skill，要求给出离线行为与预期调用，不连接真实 Goal、活动账本或数据库。行为评分和实际 skill 触发分别检查。它验证回答中的权限判断，不证明宿主工具真实执行、暂停延迟或研究效果。

所有运行使用 `env -u ANTHROPIC_API_KEY claude plugin eval .agents --case <用例> --ablation with-without --runs <次数> --judge-model haiku --concurrency <并发> --no-publish --trust-plugin`，另指定 `/tmp` JSON、HTML 和输出目录。Claude Code 2.1.309；主答模型沿用 CLI 默认，结果 JSON 未记录其具体型号；LLM grader 每次三票。未发布报告或启动真实服务。

- 旧 skill 的新增情景基线：每臂一次，with 1/1、without 0/1；with 实际调用 research-start，三票 PASS。旧指导并非每次都导致错误，不能用本次比较宣称修订有稳定增益。
- 初始修订候选：新增情景每臂三次，with 3/3、without 1/3；with 均实际触发 skill，三票 PASS。人工复读后明确保留续跑“按宿主状态规则处理后结束回合”，再运行最终候选；前一结果不冒充最终候选。
- 用例首次加载因新增触发 grader 的元数据类型写错而失败，没有行为评分；改为仓库既有 `tool_used` 格式后执行基线。此后新用例正文及全部 graders 的 SHA-256 冻结，未按得分调整；既有用例和 graders 均未改。

## 本次验证

| 最终候选用例 | 每臂次数 | with | without | 实际触发 research-start |
|---|---:|---:|---:|---:|
| goal-host-pause-permission | 3 | 3/3 | 0/3 | 3/3 |
| goal-question-waits（既有回归） | 1 | 1/1 | 0/1 | 1/1 |

有 skill 的四次回答均三票 PASS，无执行错误或未完成评分。新增情景 112 秒、回归 53 秒；并发分别为 3 和 2。人工复读最终回答，核对未授权时不暂停、不提前 blocked、不替用户选窗口；满足情景中宿主条件时才改变状态；后续明确暂停请求不被当作窗口选择；另一宿主允许自动暂停时也未一概禁止。

- `quick_validate.py .agents/skills/research-start` 通过；这里只验证 skill 结构，不代替行为评分。
- 临时 SHA-256 核对确认全部既有评测 prompt／grader、其他 skill 及新增用例冻结后的正文和 grader 均未改；只修改本项 skill 入口。
- 文档构建、类型、47 组双语、98 条静态路由与 94 个本地化导航页面检查通过。六个中英文导出页包含新用例，入口正文输出宿主权限、未答结束回合及 blocked 边界；原有能力锚点及 Ref 身份保留。
- Git 范围核对确认未改产品、DDL、Agent 规则、其他 Doctor 行或历史诊断；`git diff --check` 通过。没有运行全量产品测试，因为本项没有产品代码变更。

工程日志和各候选原始结果保留在 `/tmp/trade-goal-host-pause/`，不覆盖失败或先前候选，也不作为永久研究记录。最终结果为 `final-v2.json` 和 `regression.json`，实际回答另存为对应 Markdown，原始 trace 路径保存在 JSON 中。有限次数的离线情景结果不证明普遍行为提升，也不证明真实宿主已执行暂停。

没有创建、暂停或改变真实 Goal，没有运行研究回放、写账本或修改产品代码。本项状态在合入及真实宿主会话验证前不写为 fixed 或 verified。
