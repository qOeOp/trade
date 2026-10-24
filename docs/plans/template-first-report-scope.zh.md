# 模板首报范围与最小充分预检

2026-10-25，用户确认：Agent 按技术行为选择最小充分原生预检；正式首报覆盖已选研究路线的完整开发窗口和合约范围，不新增“先导首报”阶段。

## 当前实现与决定

- `registration/register.py:_check_window` 要求登记窗口等于当前研究路线的开发窗口；`registration/inputs.py:market_inputs` 支持全池或明确合约子集，锁定合约、成员区间、市场提交与导出内容身份。正式回放按登记绑定，不因预检较小就允许修改正式范围。
- 预检范围由 Agent 按技术行为确定：单合约问题用最少合约和足够短的窗口；资金分配、成员切换及双腿异常覆盖对应场景。不能按收益选窗口，也不能把未触发的分支写成通过。既有预检身份、来源暴露及独立审查检查继续适用。
- 正式首报按用户已选择的完整开发窗口和可交易范围，无父、无对照登记回放。用户选全池就覆盖全池，用户明确选子集就完整覆盖子集，不要求所有模板一律全池。预检或探索不替代正式首报，不另加阶段、字段、队列或调度机制。
- 环境、数据或容量阻碍完成原范围时，报告具体缺口和影响范围，不认定为策略失败、不自行删币或截短窗口、不弱化检查或换输入后复用旧登记。用户可以选择有界正式研究，经既有选线和登记明确范围；结论仅适用于实际范围，不外推全池或宣称样本外。
- 扩展范围需要新的登记，改变开发窗口须按既有选线流程处理。这些是必要条件，不保证同一源码可以再次登记。当前 `_check_exposure` 按源码查既有试验，已完成的有界正式回放仍属于来源暴露；成功运行也不能为改变输入而滥用 `retry_of`。本项保留原检查，不增加扩池豁免，也不建议通过无实质源码变动规避检查。
- 当前 `engine/README.md` 已记载流式加载及历史规模测量，不能直接拿旧演练“成本高”断言当前全池不可行；本项未实测当前全池报价回放的资源需求，也未承诺其可行性。

## 文档与证据范围

- 在现有 `L.2.2.1` 及步骤说明中区分预检与正式首报，引用现有 `registration.market_inputs` 和 `E.1.2.3`；同步模板 runtime reference 与双语 skill 设计说明。
- 移除本章与总清单的已决首报范围事项，本章暂无待用户定事项，总清单剩 1 项。保留“不进文档”的两条既有编辑决定及其他待验证能力。
- 复用既有能力节点；索引只更新 `L.2.2.1` 正文和相应 skill 规则标题，图谱只新增从 `L.2.2.1` 到两项既有条目的关系。
- 三个新增只读离线决策评测覆盖：技术范围预检后完整首报、正式范围受阻不擅改、用户明确选择有界正式研究。题设不是实际账本事实，回答评分不证明真实首报执行可靠；原有无父无对照、修复仍为根和重试规则也需回归检查。

## 验证

- 最终 `npm run check:i18n --prefix docs-site`：47 组双语章节通过。
- 最终 `npm run build --prefix docs-site`：通过，日志 `/tmp/trade-root-scope-docs-build-final.log`；`npm run check:routes --prefix docs-site`：98 条期望／导出路由通过，94 个本地化页面有导航父级。
- `/tmp/trade-check-root-scope-docs.py`：双语导出正文、来源暴露限制、待定移除及剩余 1 项、目标锚点通过；本轮双语改动一致；既有首批、转写、根修复和中断重试文字保持不变；悬浮正文与源段落同步，元数据仅更新预期条目及关系，生成索引和图谱匹配源文件。
- 首轮命令：`env -u ANTHROPIC_API_KEY claude plugin eval .agents --case 'root-*' --ablation with-without --runs 1 --judge-model haiku --concurrency 2 --no-publish --trust-plugin --json /tmp/trade-root-scope-eval.json`。Claude 2.1.309，5 个用例每臂各实际运行 1 次，耗时 226 秒；结果完整、无运行错误或跳过评分，命令退出 1。加载 skill 臂回答评分 4/5 通过，未加载臂 1/5 通过。三个新增首报范围用例和原有 `root-registered-without-control` 均三票一致通过，且都实际调用 `research-round`。
- 原有 `root-repair-stays-root` 回答评分三票一致失败，`skill-fired` 为失败（0 次调用）；不能写成全套通过。人工逐项复核该回答：无父／无 difference 重新发布、先预检重审、审查通过后以新版本选线、根登记明确无父无对照且 changed_duties 为空，均有文字覆盖，也明确拒绝 E1 派生路径。评分未提供逐条失败理由，本轮不能判定为产品回归或评分误判；保留未解决的验证缺口，没有修改该用例或降低规则以换取通过。
- 首轮本地报告 `.agents/evals/results/2026-10-24T20-02-14-822Z/report.html`（忽略文件），JSON `/tmp/trade-root-scope-eval.json`。这是补明来源暴露限制前的候选结果，不能冒充最终新增说明的验证。
- 源码核对发现范围扩展仍受 `_check_exposure` 和 `_check_retry` 限制后，在正文及 skill 补明“新登记是必要条件，不保证准入”，没有调整代码检查。同时完善 `root-scope-bounded-choice` 的题设和评分，要求拒绝用成功有界运行的 retry_of 绕过扩池暴露检查；随后定向复测命令：`env -u ANTHROPIC_API_KEY claude plugin eval .agents --case root-scope-bounded-choice --ablation with-without --runs 1 --judge-model haiku --concurrency 2 --no-publish --trust-plugin --json /tmp/trade-root-scope-exposure-eval.json`，每臂各 1 次，耗时 49 秒，完整无运行错误或跳过评分，退出 0。加载 skill 回答评分 1/1（PASS/PASS/FAIL），未加载 0/1（三票 FAIL）；加载臂实际调用 skill。
- 最终扩池回答正确保留来源暴露检查，明确新登记不保证准入，拒绝用成功运行的 retry_of 扩池；但结尾仍写“如果你确认”，与题设已明确授权的事实冲突。即使 runner 多数评分通过，也不能把“已有授权后不重复询问”这一行为记作已验证。未调整规则或评分来消除失败，旧根修复回归及此项行为可靠性继续作为验证缺口，规则本身不再待用户决定。
- 定向复测完整报告 `.agents/evals/results/2026-10-24T20-07-10-074Z/report.html`（忽略文件），JSON `/tmp/trade-root-scope-exposure-eval.json`；没有发布外部评测报告。
- 本轮评测只验证回答与 skill 调用，未执行真实策略首报、原生预检或全池成本测量；题设和单次对照不能证明可靠的实际研究行为。没有 Python 产品代码变更，未重跑 Python 全量套件，未操作活动账本或市场库。

- 最终 `git diff --check`：通过。改动保留在工作区，未提交或创建 PR。
