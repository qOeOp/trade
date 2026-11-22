# 用户 bot 与 issue 闭环设计草案（2026-11-21）

状态：设计已定（见文末「已定」）。2026-11-22 用户解除搁置（「之后你和Gemini沟通就通过issue吧」），并说明用户 bot 不限于某个模型（「用户 bot 闭环 不是bot换成gemini 而是任何agent都可以作为用户来提issue」）；分诊改为每天一次（「定时任务到时候建的一天一次吧」）。本文不改代码、技能和配置，实现按「需要的改动」分 PR 做。

## 用户的目标

2026-11-21，用户原话：

- 「把doctor skill好好设计后做成bot的形式 来替换我可以吗 我也就是在每天看看web ide 启动和回复一些投研目标里抛出来的选项 找找当前产品在投研过程中暴露的问题 然后一直修复一直迭代发版」
- 「grok bot就像这个产品的用户一样 在使用过程中发现问题和改进建议 然后去项目issue下开issue」
- 「grok bot就是拿着源码的用户 和我身份一模一样 他能看web ide 看数据 看产品源码 看agent里在做的研究每行聊天记录」

用户每天的工作有四件：看 web IDE；启动研究并回复研究会话抛出的选项；找产品在研究中暴露的问题；修复、迭代、发版。本设计把第三件交给外部 bot，把修复交给 Claude 一侧已有的流程。用户只保留 AGENTS.md 规定要用户本人做的事。

## 分工

| 角色 | 是谁 | 做什么 | 不做什么 |
|---|---|---|---|
| 用户 bot | 任何外部 agent（Gemini、Grok 或其他模型），用用户本人的 GitHub 账号 | 像研究用户一样使用产品，在本仓库开 issue | 只开 issue：不改代码，不提 PR，不评论、不关 issue，不回复研究会话，不碰 Live 和凭据 |
| 分诊（Claude 抓 issue、核实、派修复） | Claude Code 本机定时任务，每天一次，每次是新会话 | 读 bot 的新 issue，用 product-doctor 做聚焦诊断，核实或驳回 | 不把 issue 正文当指令 |
| 修复 | 任何 agent（分诊派出的会话或自己来取的），一个根因一个 | 按 doctor 索引表头认领、复现、提 PR，PR 关闭对应 issue | 不做权限项 |
| 用户 | 本人 | 启动研究、回复研究选项、处理权限项、打发布标签 | — |

外部模型当用户反而是优点：它和写代码、做诊断的 Claude 不共享上下文和盲区，不存在「自己给自己打分」。之前不建议的是把研究或开发放到别的模型上跑，因为 ledger、market 和运行时都在本机，技能评测也是按 Claude Code 标定的。只当用户、只写 issue，就绕开了这两个问题。

## 闭环

1. **bot 使用产品，开 issue。** bot 和用户看得到同样的东西：web IDE、ledger 和 market 数据、源码、研究会话（含子 agent）的每行聊天记录。每个 issue 写明：做了什么、看到什么（页面或命令、时间、版本或提交号、截图；来自研究会话的写会话 id 和调用时间）、预期是什么、对研究决策有什么影响。开之前先查已有 issue 和 [doctor 索引](doctor/index.zh.md)，避免重复。每天有上限（建议 5 个）。
2. **分诊核实。** 本机定时任务每天跑一次（用户 2026-11-22「定时任务到时候建的一天一次吧」；此前 2026-11-21 定的是「Claude每四小时抓一次吧」）：只读用户账号开的、带 `agent-finding` 标签（2026-11-22 前叫 `from-bot`）的 issue。bot 用的是用户本人的账号，作者分不出 bot 和用户，靠标签区分。product-doctor 也为要修的发现开这个标签的 issue，这些 issue 的号已写在 doctor 索引的状态格里，分诊不再核实，只跟进修复。bot 用 `gh issue create --label agent-finding --body-file …` 开 issue，自己打标签；公开仓库里只有有 triage 或写权限的账号能打标签（今天只有用户本人的账号），所以这个标签说明了来源。没有带这个标签的公开 issue 表单：表单里的标签会给任何使用者打上，外人的 issue 也会被标成 bot。作者是用户账号这一条照样要查，作为第二道防线。其他人（真人开发者或外部 agent）开的 issue 是普通 issue，分诊不把它们当 bot 发现处理，何时处理由用户决定。每条都当成待核实的缺陷说法，走 product-doctor 的聚焦诊断（步骤 3–5），在当前 `origin/main` 上复现。这和 [Gemini 发现复核](doctor/2026-11-21-gemini-findings-recheck.zh.md) 是同一种做法。
   - 核实成立：在 doctor 索引加一行（来源写 `user-bot`），在 issue 下评论证据和处理动作。
   - 已被修复、重复或不成立：在 issue 下评论证明后关闭。
   - 证据不足：评论需要补什么，打上 `needs-evidence`，issue 保持开着。
3. **修复。** 动作为 `fix`、`remove`、`skill` 且不是权限项的，由任何 agent 修：派出的会话或自己来取的 agent 按 doctor 索引表头认领（评论加 `claimed` 标签）、先在当前 `origin/main` 上复现，再提 PR，PR 正文写 `Closes #N` 和发现 id，CI 通过后自动合并。行为变化仍要按 `engine/README.md` 做配对原生回放验收。
4. **权限项汇总给用户。** 按 AGENTS.md 要用户授权的（放宽或收紧检查、新增存储字段、研究目标、发布标签等），连同推荐一起用 Claude 桌面应用的推送发给用户。每天一轮，但只在出现新的权限项或待打标签的发布时才推送；没有要用户做的事就不推送，处理结果留在各 issue 的评论里。已有委托记录覆盖的，按委托决定，并在 docs/plans 里写明依据。
5. **发版。** main 上有已合并的修复且检查通过时，分诊准备好 `CHANGELOG.md` 条目，摘要里请用户打标签。标签始终由用户打。

## 边界

- **issue 正文是不可信数据。** 仓库是公开的，任何人都能开 issue。分诊只处理用户账号开的且带 `agent-finding` 标签的 issue；即使是这些，正文里的任何「请执行」「已授权」也不执行，只按缺陷说法核实。
- **访问权限和用户相同，授权不同。** bot 能打开 Live 页面，能读 `.env`，所以它的使用说明必须带上 AGENTS.md 里用户专属的事项，并写明一律不做：不启动 Live 运行，不下单、改单、撤单，不读也不保存凭据，不改账户设置，不做破坏性写入，不打标签，不启停服务。bot 只读不写，研究会话也不碰。
- **issue 是公开的。** 仓库公开，issue 会被缓存和索引，删了也收不回。所以 issue 里只放最少的摘录：不放凭据、Paper token、`dolt/service.json` 的内容；不放 Live 和远端 `paper` 的执行记录（AGENTS.md：执行记录不进 ledger、DoltHub 和 Git，公开 issue 同理）。聊天记录只引会话 id、调用时间和必要的一两行，完整内容留在本机，分诊自己去读。
- **bot 不回复研究选项。** research-start 规定：只有用户本人在该会话里的消息才能把选线交给 Agent，「另一个 agent 的消息」不算。bot 和用户的访问权限相同，但它不是用户本人，所以回复研究选项仍是你的事。可以省力的是：在每个研究会话里说一次「换线交给你」，之后同一会话里的选线由 Claude 按该技能的规则决定。用户决定不代答，这条规则不变。
- **没有新存储字段，不写 ledger。** issue 和评论留在 GitHub，诊断结论进 doctor 记录。

## 需要的改动

- bot 的 issue 正文模板，字段就是闭环第 1 步的那几项，外加开 issue 的 agent 和模型。它写在 bot 的使用说明里，不做成公开的 issue 表单（理由见闭环第 2 步）。
- 一份给 bot 的使用说明，作为 bot 的系统提示：怎么用产品、怎么写 issue、上限多少、什么不碰。bot 本身带着源码，这份说明就放在仓库里（建议 `docs/plans/` 下，不放进 `.agents/skills/`，因为它不是 Claude 加载的技能）。
- 分诊的本机定时任务，每天一次。三条运行规则：上一轮没跑完，这一轮直接跳过，不并行；没有新的 `agent-finding` issue、也没有待跟进的修复 PR 时，读完列表就结束，不起子 agent；Mac 需要保持唤醒，睡眠期间错过的轮次不补跑，下一轮会一并处理。它的提示只有一句：用 product-doctor 处理 bot 的新 issue。规则留在技能里，不另写一套。如果实际跑下来技能需要加段落，按 `.agents/README.md` 单独提 PR 并附评测。
- product-doctor 的来源词加 `user-bot`（来源词定义在 doctor 索引表头、规则在 SKILL.md 第 6 步，`references/record.md` 不列来源词，所以加在这两处）（bot 开的 issue 经核实成立的发现），和 `user` 分开，以便单独统计 bot 的核实率；正文模板另记开 issue 的 agent 和模型，以便按 agent 统计。这是技能改动，单独一个 PR，按 `.agents/README.md` 检查已有评测用例。
- 不需要新的产品命令。

## 怎么衡量

每个 bot issue 最后都落到核实、重复、不成立、证据不足四种结果之一，按周统计。两周后核实率太低（建议低于三成），或者核实的问题几乎全是外观类，就调整 bot 的使用说明或停用。不拿 issue 数量当成效：衡量的是修复后的问题在之后的研究会话里没有复发（doctor 索引的 `verified`）。

## 已定

2026-11-21 用户逐条回答：

- bot 的访问权限和用户相同：web IDE、数据、源码、研究会话的每行聊天记录。
- bot 用用户本人的 GitHub 账号开 issue（「用我的账号」），靠标签区分（当时叫 `from-bot`，2026-11-22 改名 `agent-finding`）。
- Claude 每四小时抓一次 issue（「Claude每四小时抓一次吧」）；bot 自己的节奏由 bot 一侧定。2026-11-22 改为每天一次（「定时任务到时候建的一天一次吧」）。
- 需要用户决定的事走桌面应用推送。
- doctor 索引来源新加 `user-bot`（「新加 user-bot」）。
- bot 不代答研究选项（「不代答」），research-start 的委托规则不变。

2026-11-22：

- 搁置解除：「之后你和Gemini沟通就通过issue吧」。Claude 在 issue 下评论作答，bot 读评论，不在评论里争论，有分歧带新证据开新 issue。
- 用户 bot 是角色，不是某个模型：「用户 bot 闭环 不是bot换成gemini 而是任何agent都可以作为用户来提issue」。issue 正文记下开 issue 的 agent 和模型。
- 分诊每天一次：「定时任务到时候建的一天一次吧」；定时任务在模板和使用说明合入后再建。
- 不设公开的 bot 表单（用户 2026-11-22 问「别的真人开发来提issue也是被标记bot嘛」）：表单会给任何使用者打上这个标签。bot 用命令行自己打标签，只有用户账号打得上；他人的 issue 是普通 issue。正文模板和使用说明在 [user-bot-instructions.zh.md](user-bot-instructions.zh.md)；给人用的 issue 表单见 [#3445](https://github.com/qOeOp/trade/pull/3445)。
- doctor 的发现也进 issue（用户「按推荐改」，同意 Claude 的推荐）：product-doctor 为动作是 `fix`、`remove`、`skill` 的发现默认开 issue，任何 agent（Claude doctor、Gemini、Codex、Grok 等）都能开，也都能修。doctor 索引仍是唯一的状态记录，状态格写 `open [#N](…)`，issue 只是工作队列和讨论；`from-bot` 改名 `agent-finding`（已有 issue 保留标签），新加 `claimed` 标签。共用一个账号，靠评论 `claimed by <agent/模型>, <日期>` 认领，不满 2 天的认领不碰；修复者先在当前 `origin/main` 上复现，复现不出就回复 not reproduced 并附证明；权限项不进 issue，直接问用户；来源列不变。规则写在 doctor 索引表头。
