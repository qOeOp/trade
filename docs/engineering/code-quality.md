---
title: Quality Assurance System Contract
role: engineering-contract
status: active
owner: engineering
last_verified: 2026-07-31 CST
---

# Quality Assurance System Contract

## 0. 结论

当前项目不是“缺少质量保障”，而是**保障密度高、体系化不足**：

- 基础正确性、架构约束、仓库卫生和静态安全检查较强；
- PR 闸门速度尚可，但所有改动普遍支付全语言、Replay 与 CodeQL 成本，缺少风险分流；
- package 有测试不等于用户旅程被验证；production consumer 仍主要由 Agent 文字流程要求，未形成稳定的可执行证据；
- Replay 已有 release certification，项目整体仍缺 release artifact、provenance、运行前 smoke 与运行后反馈的统一闭环；
- 同仓候选可以同时修改实现和验收它的 workflow / judge，现有 required context 不能独立消除自证风险。

因此，当前成熟度判断为：

| 维度 | 判断 |
| --- | --- |
| 保护强度 | 中高 |
| 层级清晰度 | 中低 |
| 本地反馈效率 | 中 |
| CI 成本效率 | 中低 |
| 独立裁判可信度 | 低 |
| release / runtime 闭环 | 局部具备 |
| 可观测与持续改进 | 低 |

本合同是项目质量保障体系的唯一总入口。它定义层级、authority、风险路由和升级条件；不复制检查命令或领域验收细节。

## 1. 当前证据与技术债

截至 2026-07-30：

| 观察 | 仓库证据 | 影响 |
| --- | --- | --- |
| 质量路径高频修订 | 自 2026-07-22 起，当前 first-parent 历史中质量 workflow、脚本和三份工程合同被 74 个提交触及 | 反复修补集中在流程边界，不是单个 checker 缺陷 |
| 中央编排器过载 | `scripts/quality-check.sh policy` 同时运行 whitespace、shell、helper、secret、lint、judge regression、docs、convergence、architecture、storage、logical store 与 test boundary | 一个 scope 的失败域、维护域和输出过宽；`policy` 已不再是单一概念 |
| 影响面选择缺失 | 已删除仅支持单 owner / docs、硬编码 Replay consumer 且无 production consumer 的 changed gate；当前由 Check Contract 人工路由 | 不再维护伪自动化，但选择正确性与时延仍不可度量 |
| PR 反馈尚快但不分流 | 最近 45 次 PR `repository-quality` 平均约 239 秒；最新 main run 约 4 分钟。仅修改工作流 skill 的 PR 仍执行 TypeScript 双分片、Replay、native 与四语言 CodeQL | 未超过 10 分钟上限，但无关算力、噪声和重跑成本持续增长 |
| 测试存在性强、层次证据弱 | TypeScript owner 必须有 colocated test，根 judge 直接编译和执行；但没有统一记录 unit / contract / integration / consumer journey / release test 的覆盖关系 | “有测试文件”可以阻止空套件，不能证明高价值行为闭合 |
| merge enforcement 部分可靠 | GitHub ruleset 要求最新 `main`、`quality`、四语言 CodeQL、review thread resolution，且无 bypass；Actions 使用只读权限和完整 SHA pin | 普通候选已有强机械阻断 |
| 裁判可被候选控制 | workflow、质量脚本与实现位于同仓；required checks 都由 GitHub Actions integration 签发 | 修改裁判的候选可以影响自己的验收，普通代码绿灯不能证明治理候选可信 |
| 供应链保障不完整 | CodeQL、secret scanning、push protection、Dependabot alerts/security updates、lockfile 与 action SHA pin 已启用；Actions 仍允许任意 action，PR 无 dependency-review required gate | 已知依赖风险可被发现，但新增依赖的准入、许可与 action allowlist 未闭合 |
| 重证据只在 Replay 成熟 | nightly Replay release certification 平均约 352 秒；其他 runtime 没有统一 release candidate、构建 provenance、部署 smoke 或 post-deploy verification | CI correctness 容易被误当成交付完成 |
| 没有质量运营指标 | workflow 有原始运行记录，但未分类 flake、真实回归、基础设施失败、首次失败时间、修复时间、逃逸缺陷或无效检查成本 | 无法证伪“规则更多就更安全”，也无法按收益删闸 |

这些问题的根因不是工具数量，而是**政策、选择、执行、签发、发布和运行反馈没有按 authority 分开**。

## 2. Authority 分工

| Surface | 唯一职责 | 不得承担 |
| --- | --- | --- |
| 本合同 | 定义质量层级、风险类别、required 条件、SLO 与升级原则 | 罗列每个 owner 命令 |
| [Check Contract](./check-contract.md) | “改了什么 → 跑什么”的可执行目录；登记 check id、owner、consumer 与命令 | 决定 merge/release authority、复制质量理念 |
| [Development Convergence Contract](./development-convergence.md) | 约束责任面增长、production consumer 与交付证据 | 编排语言工具、定义 checker 实现 |
| `AGENTS.md` | 保留少量仓库硬约束 | 重写工程合同、复制 check catalog |
| owner `CONTRACT.md` / package | 定义领域行为、consumer、owner test 与 release-specific acceptance | 自行签发项目级 merge 结论 |
| `scripts/check-*.{ts,sh}` | 实现一个边界清楚、可单独复现的 checker | 决定风险等级、自动扩张必跑范围 |
| `scripts/quality-check.sh` | 本地兼容入口与 CI leaf 编排适配器 | 继续吸收新的领域政策或成为所有改动的默认本地总闸 |
| GitHub workflow | 在隔离 runner 上执行既定 checks、上传原始证据 | 定义产品正确性或让 job 名替代 acceptance |
| GitHub ruleset / 外置 verifier | 对不可变 candidate 签发 merge 或 governance 结果 | 依赖 Agent 的自述或候选内可改结论 |
| release / runtime owner | 验证 artifact、环境、smoke、shadow/canary、rollback 与运行事实 | 用 PR 绿灯替代真实运行验收 |

跨文档冲突沿用 [Documentation Contract](../README.md) 的顺序：产品边界 > 当前架构合同 > domain/module contract > 历史施工记录；runtime 安全合同在其行为边界内优先于工程质量规则。质量保障内部的优先级为：本合同 > Check Contract > workflow / script 投影。低层实现不得反向创造上层政策。

## 3. 六层质量闸

质量闸不是一条越来越长的脚本，而是六个不同失败域：

| 层 | 目的 | 触发 | 典型证据 | Authority | 目标时延 |
| --- | --- | --- | --- | --- | --- |
| Q0 Admission | 在写代码前明确结果、风险与 consumer | 非平凡产品/工程判断 | admission evidence、owner/consumer 路径 | 主任务上下文 | 开工前完成 |
| Q1 Fast local | 尽早发现本次改动的直接错误 | 每次候选修订 | diff check、owner lint/type/unit、最小 consumer exercise | 开发者/Agent，本地非签发 | P95 ≤ 2 分钟 |
| Q2 PR candidate | 证明候选在仓库集成面可合并 | 每个 PR head | policy、受影响 owner/consumer、集成/合同测试、CodeQL、完整 diff | GitHub required checks | P95 ≤ 10 分钟 |
| Q3 Governance | 防止候选修改并自证裁判、workflow 或 merge policy | 触及质量 trust surface | 外置、不可由候选修改的 verifier 结果 | 独立 required workflow / GitHub App / 等价 owner | Q2 之外独立签发 |
| Q4 Release | 证明可发布 artifact 在目标约束下可重复 | release-bound 或高风险 runtime 改动 | immutable artifact、provenance、certification、性能/迁移/部署 smoke | release owner | 与 PR 快闸解耦，有界完成 |
| Q5 Runtime | 证明真实环境行为可观测、可回退 | 部署、shadow、live-small | health、shadow/canary、reconciliation、SLO、rollback receipt | runtime/operator owner | 按运行合同 |

硬规则：

1. Q0 是准入，不签发代码质量；Q1 是反馈，不签发 merge。
2. Q2 只验证可在隔离候选环境中确定复现的事实，不执行真实 Binance 写动作。
3. Q3 与普通实现候选必须分离；缺少候选不可控 authority 时不得接纳治理候选。
4. Q4/Q5 只在真实 artifact 或运行 consumer 存在时建立，不为空架构提前造平台。
5. 低层绿灯不能替代高层：unit test 不能替代 consumer journey，PR 绿灯不能替代 release/runtime evidence。
6. 每个 hard gate 必须有 owner、失败处置和删除条件；没有明确消费者的检查不进入 required 集合。

## 4. 风险路由

当前采用单 owner、黑灯工厂式 PR：ruleset 强制最新 `main`、`quality`、四语言 CodeQL 与
review thread resolution，且无 bypass。普通开发候选默认不要求 approving review、
required reviewer、CODEOWNER / last-push approval、repository variable 管理员确认或其他
人在环 authority gate。

先按**改变的语义**分类，再选择闸门；文件路径只是输入，不是结论。

| 类别 | 典型改动 | 最低闭包 |
| --- | --- | --- |
| R0 文档/元数据 | 不改变运行、裁判或 authority 的 current docs | Q1 doc/diff；Q2 policy/doc leaf |
| R1 单 owner | owner 内部实现与局部合同 | Q0（非机械时）+ Q1 owner + Q2 owner/直接 consumer/security |
| R2 跨 owner/runtime | shared contract、schema、store、rail、跨语言或 runtime behavior | Q0 + Q1 所有受影响边界 + Q2 integration/architecture + 必要 Q4 |
| R3 高风险交易/数据 | execution、risk、资金、凭证、不可逆数据迁移 | R2 + 独立安全验收 + Q4 + 授权后的 Q5 |
| R4 治理/trust surface | `.github/workflows`、quality judge、ruleset、签发 policy | 独立治理候选；Q3 必需，不能与普通实现同候选 |

影响面规划器未来可以输出 `risk_class / owners / consumers / checks / reasons`，但必须 fail closed：

- 无法归属、跨语言、shared contract 或规划器自身改动时升级，不猜测缩小范围；
- stable aggregate context 始终上报成功/失败/不适用，避免 required context 因 path skip 永久 pending；
- “不适用”必须附带可重放理由，不能只靠 workflow condition；
- 规划器只选择已登记 check，不创造新 policy。

## 5. 质量指标与预算

质量体系按结果运营，不按 checker 数量运营。至少保留 30 天窗口：

| 指标 | 初始目标 | 用途 |
| --- | --- | --- |
| Q1 time-to-signal P95 | ≤ 2 分钟 | 保证 Agent 愿意频繁运行 |
| Q2 wall time P95 | ≤ 10 分钟 | 维持快速 PR 闭环 |
| 首个可行动失败时间 P95 | ≤ 3 分钟 | 优先运行高信号快闸 |
| flaky rerun rate | < 1% | 超标先修 flake，不增加 retry 掩盖 |
| broken-main 恢复时间 | 可在一个有界修复周期内闭合 | 红灯优先于能力扩张 |
| failure classification coverage | 100%：candidate / flaky / infra / policy / external | 防止因不明失败盲目加规则 |
| escaped defect | 记录触发层与缺失 acceptance | 只把可重复根因转成新 gate |
| gate utility | 每个 hard gate 有近 90 天命中或高后果 justification | 删除长期无消费者、无命中的噪声 |

不设置全仓覆盖率、函数复杂度或 LOC 的统一硬阈值。它们只能作为定位信号；只有与高价值行为、风险合同和已校准反例绑定后，才可升级为 owner gate。

## 6. 测试有效性治理

权威顺序是：冻结的用户结果与当前产品/runtime 合同 > 真实 production consumer 行为 >
owner 与兼容跨 owner 合同 > 测试、fixture、mock、snapshot 和实现假设。测试是证据，不是
最终判官。任何红灯在改变生产代码前必须先说明它主张的行为、上层 authority 和失败分类；
禁止为了迎合未分类、错误或过期测试而劣化正确生产行为。绿灯同样不能替代未执行的 consumer。

失败只归入一个有证据的主类；证据不足时保持 unresolved：

| 类别 | 判定问题 |
| --- | --- |
| 真实行为回归 | 当前合同要求且 consumer 行为确已退化吗？ |
| 过期合同/断言 | 测试是否仍主张已被当前合同替代的行为？ |
| 实现耦合 change-detector | 测试是否只镜像调用顺序、私有结构或代码变换？ |
| 场景缺口 | 关键状态、边界或序列是否从未执行？ |
| oracle/断言缺口 | 场景执行后，断言能否区分正确与错误行为？ |
| 选择/路由缺口 | 受影响 owner、consumer 或 path 是否没有被选中？ |
| mock/fake 隔离失真 | double 是否偏离真实边界或隐藏 integration 行为？ |
| 环境/并发/时间缺口 | 环境、顺序、并发、clock 或 timing 是否缺席？ |
| flake/infra | 信号是否非确定或来自 harness/infrastructure？ |

已有测试未发现缺陷时，必须在加测前回答：本应由哪层或 consumer 发现；为什么既有选择、
场景、边界或 oracle 没发现；哪些相邻问题共享盲点；能否加强/替换已有测试；哪些旧测试因此
冗余，以及什么独特价值证据阻止删除。禁止把“一个 bug 再加一个测试”当作默认结论。

`.agents/skills/run-bounded-mission/scripts/test-effectiveness-audit.ts` 只接受两个完整
40/64 位小写 Git commit hash，symbolic ref、缩写与 revision expression 均 fail closed；它只读
diff 与 tracked test/source/`CONTRACT.md`/`package.json` 元数据，输出可审阅 JSON 提案。它
不得执行测试或 mutation、估算 coverage、修改/删除测试、写数据库或签发 acceptance；静态
import、名称、重复内容、规模、mock、时间/并发信号都只是调查线索。动作仅为
`keep / strengthen / replace / lower_layer / delete_candidate / further_investigation`，其中
`delete_candidate` 仍须人工证明没有独特行为价值；未找到 changed test 或 direct import 只能
表述为 `no_direct_static_candidate_evidence`，不得改写成“没有测试”，transitive 与 deleted
source 关系保持未知。

只有同时满足以下条件才派发独立 Test Refactor Mission：动作集包含 replace、降层、删除候选
或至少两项协调测试修改；当前合同与 consumer acceptance 可冻结不变；test-only candidate
能与生产行为修复及其验收 authority 分离；预期价值、成本证据、affected owner 与 stopping
evidence 已命名。局部权威回归测试可留在当前 Mission；authority 有争议或仍需改业务行为时
回到 Plan/进一步调查。这些只是测试有效性 necessary signals，不产生派发 authority；独立
Test Refactor Mission 还必须在 accept 后满足现有 `refactor-mission-proposal.md` 的至少两个
已集成 accepted Missions、reachable evidence、结构原因、consumer、consent 与 native dispatch
合同。

## 7. 迁移方案

迁移不提高 [Convergence Baseline](./convergence-baseline.json)，也不在普通开发 candidate 中修改 trust surface。

### M0：冻结扩张，建立单一语言

- 本合同成为体系总入口；
- 新增质量要求先归入 Q0–Q5、R0–R4 和唯一 owner，无法归位则不新增；
- 对现有失败只定向修复，不继续向 `quality-check.sh policy` 塞职责。

退出：后续方案和交付都能引用唯一 layer、risk class 与 authority。

### M1：去重文档与入口

- `check-contract.md` 只保留路由与命令目录；
- `development-convergence.md` 只保留表面积、consumer 与交付证据；
- `AGENTS.md` 只保留真正仓库 invariant；
退出：每条规范只在其 owner surface 出现，不建立同义副本或文档依赖网。

### M2：快慢闸和影响面

- 先测量现有 leaf 时延与失败类型，再把 `policy` 拆成可单独复现的静态、architecture、docs、security leaf；
- 以现有 owner/package 元数据生成最小计划，保留 shared/unknown/full fallback；
- stable `quality` aggregate 不变，先降低无关执行，再考虑调整 required contexts；
- Replay release、性能和长时测试继续离开 PR 快闸。

退出：R0/R1 不再执行无关语言与 Replay；R2/R3 仍能 fail closed；Q2 P95 不退化。

### M3：独立治理与供应链

- 将 workflow、judge、ruleset、签发 policy 作为单独 governance candidate；
- 引入候选不可控的 verifier，再把 governance context 设为 R4 required；
- 增加 PR dependency review；依据实际依赖来源收紧 Actions allowlist；
- 保留 SHA pin、最小 token permissions、CodeQL、secret scanning 与 Dependabot。

退出：普通候选无法通过修改验收器自证；新增高风险依赖在进入 `main` 前被阻断。

### M4：release 与 runtime 闭环

- 只为已有 production consumer 定义 release candidate；
- 复用 Replay certification 模式，但不复制其领域 schema；
- 出现可部署 artifact 时再生成 provenance / SBOM，并由 build platform 而非候选脚本签发；
- 为 shadow/live-small 建立环境 smoke、reconciliation、rollback 与运行 SLO receipt。

退出：能从 exact source → immutable artifact → target environment → runtime observation 追溯；PR 绿灯不再被表述为上线完成。

### M5：删除债务

- 已删除无 consumer 的 changed gate；继续删除重复文案和无 consumer checker；
- 根据 90 天指标合并低收益 leaf，修复高频 flake；
- 每季度只审查失败分布、逃逸缺陷、时延和治理例外，不开展“增加检查数量”运动。

退出：质量表面积不增长，反馈更快，逃逸和误报可解释。

## 8. 当前保留与明确不做

当前应保留：

- exact-head required `quality` 与四语言 CodeQL；
- strict latest-main、无 bypass、review thread resolution；
- action full-SHA pin、只读默认权限、secret scanning/push protection；
- owner direct test/typecheck、architecture/doc/hygiene judges；
- Replay semantic 快闸与 nightly release certification 分离；
- 本地不默认运行全仓总闸、CI 失败只定向复现 leaf。

在 M1 将依赖安装前置迁入 Check Contract 前，fresh checkout 或 `bun.lock` 变化后保留这一条可复现命令：

```bash
env -u BINANCE_API_KEY -u BINANCE_API_SECRET -u SILICONFLOW_API_KEY bun --no-env-file install --frozen-lockfile --ignore-scripts
```

当前不做：

- 不恢复普通候选的人工 approval、CODEOWNER 或 manual exact-SHA gate；
- 不把 IDE inspection、统一覆盖率、复杂度或 LOC 变成仓库硬门；
- 不为尚不存在的通用发布 artifact 预建 SBOM/provenance 平台；
- 不让 Agent、workflow 或脚本同时成为 policy owner、executor 与最终 signer；
- 不用自动 retry、baseline、批量 ignore 或降低标准隐藏既存债务。

## 9. 外部基准

本方案采用以下原则，不照搬其组织结构：

- [DORA Continuous Integration](https://dora.dev/capabilities/continuous-integration/)：每次提交自动验证、快速反馈、可靠测试、broken build 优先修复，长测试移出快闸；
- [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final)：定义并维护安全检查标准，进行代码审查和可执行代码验证，把安全实践纳入 SDLC；
- [GitHub Actions Secure Use](https://docs.github.com/en/actions/reference/security/secure-use)：最小权限、完整 commit SHA pin、避免不可信输入进入 workflow 解释；
- [GitHub Dependency Review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)：在 PR 引入依赖时检查已知漏洞和依赖变化；
- [SLSA Build Requirements v1.2](https://slsa.dev/spec/v1.2/build-requirements)：由 build platform 生成 provenance，并把 hosted、isolated、unforgeable 作为逐级能力，而不是让候选自签。
- [Google Change-Detector Tests](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html)：测试实现变换而非行为会同时制造漏检与维护成本。
- [Google Long Term Effects of Mutation Testing](https://research.google/pubs/long-term-effects-of-mutation-testing/)：人工 fault 可作为探测缺口信号，但不自动授权全仓 mutation gate。
- [pytest Flaky Tests](https://docs.pytest.org/en/stable/explanation/flaky.html)：状态隔离、顺序、并发、时间与过严断言需要和真实行为回归分开分类。
- [Call Stack Coverage for Test Suite Reduction](https://www.cs.umd.edu/~atif/papers/McMasterMemonICSM2005-abstract.html)：suite reduction 会在成本与 fault detection 间产生权衡，重复信号本身不足以证明删除安全。
