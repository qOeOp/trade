# 2026-10-22 PR #1636 独立复审

| Item | Value |
|---|---|
| Sessions | 当前 chat 01a15f8b-e253-72d0-a67b-76d3e2e8377e；用户要求再次独立审查，无阻塞则合并 |
| Checkout / ledger | 固定代码 3c6eeb038edbb4b062108e8492dd50f4651430dd；base f7e7c1df974da88d2478ec5731551f13689a649c；补充测试只写自动销毁的隔离 Dolt，现有账本不动 |
| Coverage | pr1636_exposure_audit、pr1636_cache_audit、pr1636_contract_audit，均 fresh、fork_turns:none、只读；暴露、缓存完整性、CLI/结果契约；主代理另做反例验证 |
| Time split | 16 项补充反例 17.250 秒；15 项缓存与运行时重试回归 19.226 秒；其他阶段未知 |
| Invalid trials caused by the product | 未证实本 PR 新增；测试失败场景均为隔离夹具 |
| Findings by action | none；未发现应阻塞本 PR 的新缺陷；记录一处未改变的描述计数边界 |
| Recurred items | 未证实 20261022-04/05 修复复发 |
| Found by the user first | 本轮 0；04/05 的原始用户发现仍见前次记录 |
| Skill size | 本轮未改 skill |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261022-05 | 新豁免仅承认实际引用且本身可豁免的预检及其完整相同再生 | registration/register.py 的 _check_exposure 与 ledger/reproduction.py；16 项隔离反例实际调用登记入口：精确成功可登记；长于 7 天、未引用、镜像/市场/输入/账户/窗口/合约变化、执行或审计失败/缺失、中断、运行期错误、指纹缺失/变化均拒绝且不写登记 | none | 未测物理空间或研究时间收益 | 复审通过 |
| 20261022-05 | 缓存读取绑定原始清单或再生自己的清单，原始技术事实与经济资格分开 | tests.replay.test_precheck_cache 与 tests.registration.test_continuity 共 15 项通过，包含缓存篡改/缺失/额外文件/链接拒绝、丢失后再生审查登记、失败原件及失败审查不可替代；核对七表均有语义指纹覆盖 | none | 本轮未重跑 OCI；前次原生配对证据仍限于原记录的工程范围 | 复审通过 |

正式结果的 explore 再生在 report/status.py 的旧计数分支中，按既有源码、镜像、窗口、合约和输入身份
归类，不要求当次配置、审计或指纹成功。因此失败再生也可能被排除在描述性的试验总数外。
base f7e7c1df 已有同一分支，本 PR 仅把结果行存在判断从 run_id 改为 status；新增预检分支采用完整
reproduction.matches 核验。此计数不参与登记暴露豁免，不授予经济资格；不把它当作本 PR 新增漏洞，
也不在本轮改动已有计数规则。失败执行的原始记录仍保留。

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 实际引用、短窗与完整再生核验 | 借缓存再生绕开既有暴露 | 独立三路复核及 16 项隔离补充测试 | 本轮未证实新绕过 | 保留 |
| 原缓存/再生缓存的独立清单核验 | 混用目录、篡改报告或替代失败事实 | 15 项现有消费者回归与前次原生配对 | 所测路径通过 | 保留 |

## Decisions

2026-10-22 用户明确授权：再独立审查 #1636，重点暴露与缓存再生，无问题则合并。
本轮不改产品代码、检查、schema 或 skill；仅补充这份复审记录。当前代码 CI 的 454 tests、文档、标题
与安全检查通过；记录提交后的 CI 结果以 PR 为准。现有账本及备份不迁移、不清理、不切换；
不得把代码合并解释为跨代研究接续或 EMA 经济验证。
