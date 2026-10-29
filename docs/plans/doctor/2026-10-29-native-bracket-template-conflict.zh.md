# 2026-10-29 原生 bracket 指令与无目标模板冲突（聚焦诊断）

| 项目 | 内容 |
|---|---|
| 会话 | Codex，本研究会话 `01a1856e-6167-7772-a524-6d4e98db5608`；聚焦核对时间 2026-10-29 08:22 UTC 附近；不是本会话的完整质量审计 |
| 诊断者 | 当前研究会话的 Codex；没有冒称跨宿主独立 doctor |
| 检出 / 主分支 | 检出 `773ac59b4c5c6043668961703c0294cef7e58e5f`；只读 fetch 后的 `origin/main` 为 `b9c36da7fde70edbcb3f41c4f2747452fae4c92e`，相同强制条文仍在 |
| 账本证据 | 原始 precheck trial 263；独立审查 `source-review-263-ba5fc6e4d5414993`，commit `ecpmkihbp6mudch1l3ns7ojffnql8uth` |
| 覆盖 | 一个问题：通用强制 bracket 是否与模板忠实转写及固定 Nautilus API 相容；检查技能引用、模板规定、现有评测、订单工厂、运行器/审计消费者 |
| 显式缺口 | 未做完整研究过程审计；没有在 CI OCI 镜像内单独运行 bracket 构造探针；本机探针使用 `uv.lock` 固定且实际导入为 `2.0.0rc7` 的包；同纳秒分组不证明原子性 |
| 时间拆分 | 精确归因的研究/修复/等待时间未知，不把此前策略实现修复时间算作本产品问题成本 |
| 产品造成的无效正式运行 | 未观察；已观察为一个技术检查正常、api 指导冲突 unresolved 的失败源码审查，后续登记被阻断 |
| 动作 | authority + skill：以产品通用契约处理；不申请研究线特例；改变技能准入要求前等待明确授权 |
| 复发 / 用户首见 | 未发现索引中同根因记录；发现来自独立源码 reviewer；用户随后要求“按产品方式来” |
| 拟议净变化 | 改写一个过度指定实现方式的技能条目，新增本发现自己的一个评测案例；不增加产品字段、拒绝码、运行机制或逐情形豁免；具体 diff 尚未实施 |

## 发现

| id | 发现 | 证据、消费者与决定 | 动作 | 已观察成本 | 状态 |
|---|---|---|---|---|---|
| 20261029-37 | `strategy-authoring.md` 要求每个入场都以带 stop 和 limit-target children 的原生 bracket 提交；模板转写却禁止增加出处没有的 stop/target，固定工厂也不支持原策略的 STOP_MARKET bracket 入场。健康的原生 OCO/回调保护因此被指导冲突挡住 | 技能第 108–110 行；`template.md` Transcription；现有 `template-no-unsourced-additions` 评测要求保留无止损/无止盈的 RSI(2)；trial 263 独立审查的 causal/activity/readiness 均 passed、api 仅因指令冲突 unresolved，整体 failed；`registration/precheck.py` 按 review verdict 拒绝，未伪造原生 API 故障 | authority + skill | 一次源码审查因冲突 failed；没有统计成正式经济损失；影响跨模板而非仅 BTC 线 | in PR [#1889](https://github.com/qOeOp/trade/pull/1889)，用户 2026-10-29 授权通用技能修复 |

## 当前产品证据

`research-round/references/strategy-authoring.md:108-110` 原文要求：

> Submit each entry with its protection as one native bracket

随后具体指定 OTO entry、OUO stop-market 和 limit-target children，并指定 `submit_order_list`。同文件开头又声明运行规则以 `engine/{config,load,run,report}.py` 为准。

`research-round/references/template.md` 的 Transcription 明确禁止给原模板增加没有的 stop、target、filter 或参数。已有无额外规则评测的 RSI(2) 示例明确没有 stop 和 target。这不是本线独有的经济选择。

本机 `uv run --frozen` 的固定 Nautilus 2.0.0rc7 原生订单工厂构造探针只创建订单对象，不提交订单、不写账本、不计算收益。观察到：

- `bracket(entry_order_type=STOP_MARKET, ...)`：`ValueError: invalid entry_order_type, was STOP_MARKET`。
- MARKET 入场而没有目标价：`ValueError: tp_price is required for a LIMIT take-profit`。
- 显式 `tp_order_type=None`：`TypeError: None is not an instance of OrderType`。

工作证据在 `/tmp/trade-15m-bracket-feasibility.json`。这证明已试的工厂调用不满足原模板，不宣称所有可能的原生委托图都不可能，也不将本机探针冒称为 CI 镜像内验证。

`engine/audit.py` 文件头与 `engine/README.md:210-222` 的契约是原生订单/成交/账户核对、因果提交、成员/生命周期边界及工作 reduce-only stop 的数量覆盖；明确不重建策略价格几何。保护不足超过一个一分钟 bar 才拒绝；通过不证明连续保护或原子附件。产品没有检查“所有源码必须调用 bracket 工厂”。

原始 trial 263 的独立审查完整核对了原生 OCO、撤单确认后保护替换、有效价格/数量、输入时钟和退出后等待，没有观察到工作状态错误。审查没有把回调保护称为原子 bracket，而是诚实记录了上述指导冲突；失败事实应保留。

## 收敛判断

| 选项 | 结论 |
|---|---|
| none / 原样继续 | 不足：明确强制条文已让独立 reviewer 无法通过；不能靠口头把它解释为不存在 |
| 研究线特例 | 不采用；用户要求按产品方式处理，不能推断为允许本线绕过通用要求 |
| 仅新增模板 target 或换入场类型 | 不采用；改变了原模板的经济规则，不是实现修复 |
| 扩展订单工厂或另建撮合/保护层 | 不采用；Nautilus 应拥有原生订单和状态，尚无证据需要产品代码或新机制 |
| 按现有契约重述技能条目 | 推荐：停止把某个工厂封装当作所有策略的准入条件，保留原生订单所有权、原声明的生命周期、工作保护覆盖、严格输入时钟与独立原生证据要求；不新增逐模板例外 |

这会放宽“必须以 bracket 原子附件提交”的技能层要求，而非证明原生 OCO/回调与原子 bracket 等价。因此属于 AGENTS.md 明确需要授权的规则改变，不能称为无行为影响的文字润色。运行器的现有保护阈值、因果、生命周期和经济资格检查不在拟议修改范围内。

## 可审核的实施范围（尚未实施）

- `.agents/skills/research-round/references/strategy-authoring.md`：仅改通用 bracket/GTD 实现处方，按现有原生订单、所声明生命周期和保护覆盖契约表述，不要求增加模板没有的目标或伪称原子性。
- `.agents/evals/research-round/`：只增加本发现自己的无目标 STOP_MARKET/native OCO 场景及 grader；不改其他案例的 grader。
- `docs/rd/design-skill-research-round.mdx` 及 `.zh.mdx`：若对该段的概述需要同步，仅对齐同一处说明。
- 本诊断和索引：保留授权/实施/后续观察状态；本记录写完后不改。

验收需同时证明：忠实无目标模板能在既有原生契约下继续；没有添加额外止盈或擅自换信号/订单经济规则；没有把回调保护描述为原子性；现有超阈值保护不足、输入同钟、生命周期不合规和失败资格仍被原检查拒绝。新评测只覆盖本根因；没有声称已运行评测。

旧的 ModifyRejected 价格错误与本指导冲突是两件事。旧经济证据的撤回不因技能修改而解除。`source-review-263-ba5fc6e4d5414993` 和所有历史审查不重写；修复后仍需按新有效规则发布/预检并取得新的独立审查，不能把本记录当作 passed review。

## 决定

2026-10-29：用户回复“按产品方式来”。本诊断据此转为通用产品/技能处理，不推断为已经批准删除原子 bracket 要求、修改运行审计或允许研究线特例。待用户明确批准上述规则改变范围。后续修复从本记录和索引开始，在新的修复会话处理；本研究会话不自审自修。

2026-10-29：用户明确授权，原话：“授权改写 strategy-authoring.md 里的 bracket 规则：围绕止损覆盖审计重写，有止损和止盈、单型支持时 bracket 仍为默认；新开修复会话从诊断 20261029-26 出发提 PR，只加这一个评测。”本记录原编号 20261029-26，与已入索引的整合审计 20261029-26（CI 仪式机制）重号，入库时改为 20261029-37；授权原话中的 20261029-26 即本发现。修复在 [#1889](https://github.com/qOeOp/trade/pull/1889)：`strategy-authoring.md` 的保护条目改为以止损覆盖审计为准，有止损和止盈且入场类型为固定 `bracket` 工厂所接受时仍默认原生 bracket，否则提交出处自己的原生订单（例如 STOP_MARKET 入场加 OCO、成交后提交 reduce-only 止损），声明的入场有效期用原生到期或已确认撤单，不为凑 bracket 增加出处没有的止损/止盈，分开提交的保护不称原子；预检核对句和设计站 C.4.2.1 同句对齐；新增评测 `template-stop-entry-no-target`。不改 `engine/audit.py`、拒绝码、字段或研究目标。历史审查 `source-review-263-ba5fc6e4d5414993` 不改写；该线须按新规则重新预检并取得新的独立审查。
