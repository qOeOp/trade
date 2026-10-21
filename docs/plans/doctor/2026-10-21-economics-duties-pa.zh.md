# 2026-10-21 研发迭代、27 职责与绩效归因复审

| 项目 | 值 |
|---|---|
| 会话 | local；Start research / 01a15c14-1259-7392-97a5-58c24cdf4250；主 transcript rollout-2026-10-21T10-29-41-01a15c14-1259-7392-97a5-58c24cdf4250.jsonl，2026-10-21 01:29:42.543–03:27:48.704 UTC；连同 11 个源码审阅子会话，固定截止 03:28:35 UTC。清单与逐调用时间线见 /tmp/trade-econ-audit-20261021/summary.json |
| checkout / ledger | 修复前 be4d87f6e8413d001846ea3bf95579641ae68acd；市场 l1kfbo4b2of54ijpjnpn02ijdm175aqd；研究账本固定 0btfr1k758hlujq64mcfp86jjrtnml2m。只读复核既有 8 次正式运行；没有把持续增长的活动账本当成固定样本 |
| 时间分配 | 未可靠辨识研究/发现/修复/等待百分比；报告读取至下次 priority 的复合区间共 45.83 分钟，包含重放、查源和推理，不能当作浪费或纯研究时间 |
| 产品造成的无效试验 | 这 8 次正式运行 valid 8 / invalid 0；预检与工程失败另列，不能据此声称所有工程路径正确 |
| 新发现动作 | fix 6 / skill 4 / authority 1 / measure 2；旧项 20261021-08、09 同时澄清 |
| 复发项 | M3 仍开放：current facts 的增长与整个输出的字节预算未解决；新增历史分页不等于解决全部输出增长 |
| 用户先发现 | 1：20261021-18 的 skill/code 耦合疑问由用户先提出，应由产品现状镜头提前检查分发产物 |
| skill 大小 | 按 Git 文件空白分词，research-round 7392→7497（两个模板移入 CLI 包，另加经会话证明必要的统计语义、历史读取和职责边界）；product-doctor 2145→2178（目录及外部规范/本库政策归属）。不得把移走的模板当成产品总文本减少 |

## 结论和证据边界

执行、核算与证据绑定可靠，不等于 PA 已识别经济机制，也不等于研发具有已证明的正向期望。八轮都有新声明和条件比较，其中有反证及有用的局部学习；它们使用同一开发窗口，不能视作八份独立样本。不能把它们统称为无意义调参，也不能用登记合规替代信息价值判断。

本次六个只读镜头的报告在 /tmp/trade-econ-audit-20261021/：duty-method-review.md、duty-mechanism-review.md、duty-product-review.md、fix-data-review.md、fix-failures-review.md、fix-efficiency-review.md。父代理复核了下列高优先级数学、历史读取和分发证据。外部规范仅用于评价设计，不给本策略提供经济有效性证明：[NIST 因子设置](https://www.itl.nist.gov/div898/handbook/pri/section3/pri333.htm)、[uv 分发文件规则](https://docs.astral.sh/uv/concepts/build-backend/#file-inclusion-and-exclusion)、[skill 编写规范](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)。

## 发现与处理

| id | 问题 | 会话与当前产品证据 | 动作、成本与状态 |
|---|---|---|---|
| 20261021-13 | timing_term 被当成规模无关品质和主动配置能力 | J3/J6/J28 用其引导数量研究；report/measures.py 的 level_timing 使用同期标价名义敞口与账户 PnL。固定一单位且价格单调上升也可为负，数量减半则该项减半 | fix；会持续误导优先级。报告直接附定义与局限，修正 diagnosis、S4/S5；保持公式及版本 |
| 20261021-14 | 去掉最好五天的文字不符合负总和时算法，且单侧差与配对裁剪不同 | 会话已追加 correction-residual-direction-label-20261021；residual_after_top 按总和方向裁剪。attribute 的 difference 是两侧分别裁剪后相减，pairwise.value 是先求日差再裁剪 | fix；单运行与比较输出说明两种口径，技能和设计站同步；原 @1 数值不变 |
| 20261021-15 | 同号预测、单项规则、职责独立效应被混为一谈 | daily 行动触及七项职责，多项共享 turnover；hypothesis 允许非父版本作对照，predictions 只查符号 | skill；同号仅方向一致，一次行动可触及多职责，只有实际候选/对照源码隔离改动才称条件消融；四角交互也限所选窗口与设置 |
| 20261021-16 | 跨不同 trial 的 interpretation 被逐条 supersede，默认读取只剩最后一条 | 历史链 1→4→7→10→17→20→23→26，分别指向不同 trial；固定账本共 29 条判断、24 条被替代，当前投影藏起了 7/8 条 trial 解释。ledger/judgments.py 允许同 kind/line 替代，report/status.py 只选未替代行 | fix；新增 research state --history 的原文/subjects/替代关系分页，每页至多 20 条；默认仅附计数。两页实读恢复全部 8 条原解释；current selection、schema、写校验、gate 不变。说明跨 trial 不应当作纠错替代 |
| 20261021-17 | 展示工作被当作每轮义务 | 8 个运行至少 20 次 HTML、9 次 overview；报告模板要求章节，并未要求每轮 HTML。没有把重放或所有重复读取判成浪费 | skill；JSON 作工作证据，按需要生成展示，重复读取须考虑 ledger identity；无可可靠归属的节省分钟数 |
| 20261021-18 | CLI 从 skill 安装路径读取模板，wheel 与 checkout 行为不同 | 同目录说明碰撞见主时间线 01:52:47；旧 wheel 86 项无模板。cli/main.py 原 TEMPLATES 指向 .agents | fix；两个字节完全相同的模板移入 cli/templates，importlib.resources 读取，skill 使用命令输出。包外 /tmp 调用生成三文件、missing_templates 为空。保留原新路径、临时目录、源码 hash 和同目录检查。未发现代码解析根 AGENTS 的权限语义；生成的工作目录 AGENTS 是另一份工作说明 |
| 20261021-19 | 实际职责立场混淆，F2/F4 把全退出重复计入 | 根/派生把技术时钟、原生记账当 G2/H1/H3/I2 经济采用；F1/D2 因未使用方法写不适用；amplitude/entry-only 的 F2 与 F4 都指向全退出。源码/登记位置见 method 镜头，固定源 hash 由 data 镜头核对 | skill；职责目录澄清采用/缺省/不适用，单次进入属于 F1 的选择，全退出归 F4，技术事实不证明经济响应；不要求补齐所有方法。历史策略与登记原件未改 |
| 20261021-20 | 设计站声称四项技术审阅还逐项认证 27 职责 | strategy-file 原 C-1-4、C-6-2-1 与 research-round 的 only four checks、precheck.ITEMS 不一致 | fix；删除不受现有审查支持的覆盖承诺，保留四项、绑定与资格检查；没有暗中新增审阅义务 |
| 20261021-21 | REVIEW_DUE missing 列 priority，实际 recommendation 已可清除 | require_line_records 只读 recommendation；既有测试已证明仅 recommendation 清除此停点 | fix；missing 改成 recommendation，下一步仍解释独立 priority；比较条件、计数、触发时机与 REVIEW_EVERY=5 均未改 |
| 20261021-22 | 每轮全推荐掩盖五轮复核的边际作用 | 每个运行后均写 recommendation，based_on 起点反复前移，八轮不触发 REVIEW_DUE 是符合当前语义，不是计数失效 | skill；说明 cadence 不等于独立验证，不要求每轮重写全推荐；复核看改变了哪些结论、竞争解释和下一步能区分什么。不是给第六轮设经济淘汰线 |
| 20261021-23 | correction 与原始来源的自动联读不完整 | source-read-extent 的修正原件保留，后续 source 引用未必带修正；当前 CLI 要先知道 bundle 名才能导出 | measure；暂不加关系表/知识图。历史 judgment 分页只改善发现路径，未声称已实现全部 correction/source 的反向发现；先审现有正文关系能否可靠读取 |
| 20261021-24 | product-doctor 把改 stored field 一概列为单项授权，而根规则是新增字段先独立审阅与计划 | 两处文字的权限要求不同 | authority；未改任一边界。建议另行确认权限唯一来源后精确去重，不能借修辞调整新增字段权限；本次无新增持久字段 |
| 20261021-25 | 九项职责没有 PA 目录直接提示，但不能据此增设九个指标 | registration/duties.py 的目录 union 未包含 B3、D1、E4、F1、F2、G2、H2、H3、I2；登记只检查度量成员和每职责预测覆盖，不证明 duty→measure 的经济关系 | measure；不把无映射视作职责不适用、实现失败或研究无效。先区分经济代理、技术约束及不可观测部分；保留 null/reason 路径，不扩充检查或目录 |

旧项 -08 现明确只禁止 judgment body 复制绩效事实，工作报告可展示引用的产品值；-09 明确 eval 外置是本库 AGENTS 政策，不冒称外部 skill 通则。没有改这些规则的拒绝条件。

## 9 组 27 项的覆盖审计

全量 27 行的登记/预测/目录对照是工作分析 /tmp/trade-econ-audit-20261021/duties-27-matrix.{json,md}，输入是固定登记与当前产品目录，不是新增研究统计。下表给出产品层结论，既不复制策略体，也不把标签覆盖写成独立效果。

| 组 | 直接目录提示 | 无直接提示 | 实际流程的主要风险 |
|---|---|---|---|
| A | A1、A2、A3 | 无 | 过滤前后差异仍需竞争解释，不能由集中切片直接推过滤参数 |
| B | B1、B2 | B3 | 期限、组合信号可共用观察；缺少分别识别时不能声称多个机制同时获证 |
| C | C1、C2 | 无 | 交易配对是描述，不能变成独立检验单位或绕过账户日收益配对 |
| D | D2 | D1 | 没用对冲方法不自动等于全部经济构型问题不适用 |
| E | E1、E2、E3 | E4 | 敞口改变先看规模与路径；账户状态、调用顺序或引擎拒单不等于组合分配规则已验证 |
| F | F3、F4、F5 | F1、F2 | 一次全退出不能同时当作主动减持路径的独立证据 |
| G | G1、G3 | G2 | 订单技术安全与经济等待/刷新规则是不同结论 |
| H | H1 | H2、H3 | 原生资金费记账与策略对融资/保证金条件的响应是不同结论 |
| I | I1 | I2 | 能发出退出单不证明对未来资源或退出可行性的经济规划 |

## 保留、移除与权限

| 机制 | 独立风险 | 是否重复/会话所见 | 处理 |
|---|---|---|---|
| 职责声明及预测覆盖 | 改动与预测缺少可定位对象 | 有共享观察和错误立场，但不能证明整个索引无价值 | 保留 ID、覆盖、null 路径；修解释，不增语义评分器 |
| 四项独立技术审阅 | 作者自证接口、时钟、活动与初始化 | 本会话有真实初始化修复；不覆盖全部经济职责 | 保留；扩张 27 项审阅范围需具体方案与单独授权 |
| 五轮 cadence | 长时间缺少推荐比较 | 本窗口每轮提前推荐，无未复核累积；不代表未来无用 | 保留计数与 gate；变更其政策须单项授权 |
| 模板的 skill 路径依赖 | 不防护独立风险，却导致包分发退化 | checkout/wheel 探针复现 | 移除反向路径依赖；保留模板单一所有者和原写边界 |
| 每轮 HTML/overview | 不保管经济事实 | 多次生成而无用户展示请求 | 移除作为常规义务的解读；展示按需 |
| 原判断与原策略 | 留存反证和来源 | 原行没有删除，但默认读路径不完整 | 保留原件并提供历史读取；不迁移、不改写活动账本 |

## 验证与决定

用户于 2026-10-21 授权可修复项直接修复/优化，并追加 27 职责与 PA 审计。本次未改变 research targets、拒绝/审计的通过条件、资格、四项审查范围、五轮计数、持久 schema 或历史记录；REVIEW_DUE 只修拒绝输出的缺项说明。

- 固定 Dolt 2.4.2 的隔离全套：429 tests / 347.351s / OK；ResourceWarning 检查未发现告警。目标测试 23 项、数值测试 36 项也通过。
- Ruff、Mypy（64 source files）、compileall 通过。
- wheel 构建通过；在 repo 外解包后运行 candidate_new，三文件完整，模板与原版本逐字节相同。证据 fixed-wheel-proof.json、template-byte-parity.json。
- 固定活动账本仅作只读，history-first/second 两页读取 29 个原判断及全部 8 条解释；gates 仍空。测试同时验证分页不重叠、原对象/替代关系和旧提交不受后来替代影响。
- 文档 34 组双语检查、站点构建、72 条路由检查通过；构建前安装依赖，不修改锁文件。所有结果以本分支 PR 为发布单元，尚未合并。

收敛判断：有针对错误解释与读取缺口的修复，并移除一个 CLI→skill 路径依赖及不必要的展示义务；尚未测得研发速度或经济信息质量的提升，correction 发现及完整输出预算仍开放，不能据本次代码检查宣布经济研发机制已经验证。
