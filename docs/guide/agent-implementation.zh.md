# Agent 实现指南

本页连接目标产品架构与当前 VibeTrading 引擎。它保留有价值的开发知识，但不会把旧正文、crate 布局、
示例或可调用 API 变成第二套产品权威。

用户确认的产品基础是：在原生 Nautilus 数据/回测服务上扩展并分别提供 MCP，另有自研 R&D 服务。
Owner 名称表示内部事实与权限边界，不是重写引擎的任务。R&D 内部调用与直接 MCP 调用执行同样的准入、
预算、保护读取与恢复检查；按[能力扩展图](../architecture/capability-adoption/)选择实现位置。

## 两层文档

规范层由已发布的 `guide`、`architecture`、`owners`、`scenarios` 根目录以及 canonical 架构契约组成。
它决定一次变更的写入者、消费者、身份以及 accepted、rejected、unknown、replay 行为。

实现参考层继续保留在仓库中。它解释当前工具链、API、引擎机制、测试工具、扩展点与示例。
这些页面没有被删除，但它们不是产品权威；文件存在也不代表内容自动符合当前版本。

## 研究任务入口映射

实现前先过滤设计问题：先检查当前仓库保留的 Nautilus 机制、原生扩展点及官方文档，已有成熟机制
优先沿用，不把引擎已有的常规设计重新变成用户选择或策略参数。只有用户意图不能从已有场景确定，或测量证明原生机制
无法承接时才提问；问题说明已有能力、具体缺口和需要用户决定的取舍。框架能力、当前版本代码及产品消费接线分别验证，
不以新版官方文档证明本候选已实现；复用不移走已有 Owner 权威，不放宽已冻结研究协议或保护边界。

先读[研究场景](../scenarios/research/)与准确当前候选版本，选择最早缺失转换，再按此表读取生产者、消费者与边界依赖。

| 有界交付结果                       | 所属设计                                                  | 验收消费者                                                   |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| 在用户范围内登记家族并恢复计数实验 | R&D Intent、census、读取血缘、支出上限；Product Edge 授权 | 代理在结果读取前登记，并按原生身份恢复试验                   |
| 将 R‑1u/R‑1s JSON 编译成不可变工件 | R&D 编写；Strategy Factory 共享生命周期/订单契约          | 真实模拟器驱动挂单、到期、保护、分段退出、成交反馈与事件顺序 |
| 异步产出永续研究报告               | Market Data 托管；R&D 运行准入；Backtest Result           | 原生报告含资金费、成本、组合风险收益、重叠、比较与逐交易诊断 |
| 诊断、暂停、停止或复核新证据       | R&D Iteration Decision 与知识台账                         | 亏损与未决试验可见，未合格不关闭机制                         |
| 资格评估与只记录前向证据           | Qualification；Backtest 共享回放语义                      | 二级公开判决、内部保护细节、持久模拟订单且没有交易效果       |
| R‑1 后复现动态 B3 与多腿 carry     | Strategy Factory 动态标的池；Market Data 与 Backtest      | 换成员时权益/状态连续，多腿资本、资金费与保证金可计量        |

此表不宣称实现成熟度，也不准入 Dashboard 路由。在当前候选核对生产者与读回，旧 `CURRENT` 标签不是证据。
每项任务点名一个用户可见结果、一个 Owner、被扩展或取代的既有路径以及正向/拒绝读回；设计被否定时把测量与修改
放在同一交付里。不能为了补缺失原生 operation 而加第二 registry、模拟器或任务台账。

## Agent 必须遵循的工作流

1. 选择并验证一个[开发切片契约](./development-chunk-contract/)。
2. 在[能力采用](../architecture/capability-adoption/)中解析相关源能力和目标 Owner。
3. 在同一个精确候选版本检查当前源码、`Makefile`、pre-commit 配置和 CI workflow。
4. 只打开与该有界切片相关的实现参考，并对照同一版本验证其中每个路径、symbol、命令和前置条件。
5. 对该切片验证通过的页面标为 `CURRENT_IMPLEMENTATION_REFERENCE`。不匹配或已被替代的页面标为
   `LEGACY_REFERENCE`，不得复制其中的命令、写入者、拓扑或 API 假设。
6. 把每个源码 locator 记录到切片 `evidence-receipt.implementationReferenceBindings` 非空列表中。
   即使有界切片只使用一个实现参考，该列表也不可省略或为空。
7. 冻结一个准确的 `evidence-receipt.candidateRevision`；每个 binding 都重复同一准确 revision。
   证据缺失、冲突、过期或来自不同版本时停止实现，并返回 Main 重新规划。

每个 locator 只能采用一个准确分类分支：

- `CURRENT_IMPLEMENTATION_REFERENCE` 必须使用 `VERIFIED_AT_CANDIDATE_REVISION`，提供 typed immutable
  `verificationReceipt`，revision 与 receipt 严格相等，并让 `mismatchDisposition` 为 JSON `null`。
- `LEGACY_REFERENCE` 必须使用 `MISMATCHED_OR_SUPERSEDED`，保留同样的 typed immutable receipt，
  revision 与 receipt 严格相等，并采用终态处置 `DO_NOT_USE_AND_REPLAN`。

"checked"这类自由文字不是证据。Typed receipt 重复已解析 candidate revision，把准确规范化仓库相对
locator 绑定到 Git blob 与 SHA-256 内容身份，并且对 `PATHS`、`SYMBOLS`、`COMMANDS`、
`PREREQUISITES` 各包含恰好一个结果。Locator identity 的严格格式为
`tree-path:<locator>@git-blob:<40 lowercase hex>@content-sha256:<64 lowercase hex>`；
`contentSha256` 以 `sha256:<64 lowercase hex>` 重复同一 digest。

Record 不能自证。Main 必须另行提供 immutable 40-hex Git tree 与逐 locator verification-context digest。
公共校验器先证明对象确为 tree，再用 `git ls-tree` 解析准确 path、用 `git cat-file` 读取 blob，并根据
实际 bytes 重新计算 Git blob ID 与 SHA-256，最后与 typed receipt 的每项 identity 比较。即使 record
内部格式完整且彼此一致，只要缺少 resolver、tree 错误或过期、locator 不存在、ID 伪造或 bytes 不同，
仍然无效。

每项检查只能是 `PASS`（具体 evidence、null basis）或 `NOT_APPLICABLE_WITH_BASIS`（null evidence、
具体 basis）。检查 kind 缺失、重复、未知、乱序或增加时失败关闭。CURRENT 与 LEGACY 都保留完整 receipt；
两者都必须经过同一 immutable Git 解析并匹配 Main 在 record 外提供的 context digest。LEGACY 没有
"无法解析但仍有效"的例外：locator 不可用或已删除时 record 无效并返回 Main；LEGACY 表示已解析内容
仍绝对不得使用。

未知分类、空列表、重复 locator、部分字段、identity 或 digest 格式错误、revision/content/locator 被修改
或额外字段都无效。`LEGACY_REFERENCE` 不是降级执行路径：
Agent 不得使用该 locator，必须返回 Main。

实现参考可以解释如何调用或扩展引擎，但不能创建 Owner、改变业务事实写入者、绕过 Market Data 或
effect admission、暴露受保护的 Qualification 细节、授权 Paper 或 Live effect，也不能替代切片的
accepted、rejected、unknown、replay 语义。

## 参考映射

| 开发需要                 | 仓库实现参考                                                                                                                 | 必须采用的解释方式                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 环境与工具链             | `docs/developer_guide/environment_setup.md`                                                                                  | 使用前对照当前项目 pin、`Makefile` 与 CI 验证命令。                 |
| Rust、Python 与 FFI 边界 | `docs/developer_guide/rust.md`、`docs/developer_guide/python.md`、`docs/developer_guide/ffi.md`                              | 复用语言和内存安全指导，但不得通过 binding 转移 Owner 权威。        |
| Adapter 实现             | `docs/developer_guide/adapters.md`、`docs/developer_guide/spec_data_testing.md`、`docs/developer_guide/spec_exec_testing.md` | 拆分 Market Data 与 Execution port；provider crate 不获得产品权威。 |
| 测试与数据集             | `docs/developer_guide/testing.md`、`docs/developer_guide/test_datasets.md`                                                   | 把当前 harness 和 fixture 用作证据，不得当作生产能力或经济证明。    |
| 性能工作                 | `docs/developer_guide/benchmarking.md`                                                                                       | 测量有界实现 seam 时保持所选契约不变。                              |
| 扩展与插件               | `docs/developer_guide/plugins.md`                                                                                            | 把可调用性视为基础设施；所有业务 effect 仍经过相应 Owner 契约。     |
| 文档工作                 | `docs/developer_guide/docs.md`、`docs/developer_guide/markdown_style.md`                                                     | 遵循当前仓库门禁，并保持 canonical 投影只有一个来源。               |
| 引擎语义                 | `docs/concepts/` 与各 crate 的 `README.md`                                                                                   | 用于解释当前机制，随后验证精确源码 symbol 与行为。                  |
| 任务示例                 | `docs/how_to/`、`docs/getting_started/` 与 `examples/`                                                                       | 把示例视为参考输入，而不是架构、生产接纳或 Live 权威。              |

## 冲突与过期规则

把已记录 Owner 契约作为当前设计阅读，再对照真实消费者与当前源码检验。引用过期 symbol 或命令的参考已过时；
源码可调用或旧示例曾成功不能证明目标产品路径。无法承接所需用户故事的设计要带着迫使它改变的观测显式修改，
不能被当作最终蓝图。

Main 可把范围内的过时设计与实现一起修正并交付审阅。记录差异、重规划依赖它的切片并验证新契约，
不要求独立文档 PR。`AGENTS.md` 对产品目的或用户路径变化、生产效果以及移除拒绝、封口、界或不变量的
用户授权边界仍适用；保留无关工作。

## 在这个仓库里读数会出错的量具

下面每一条都是对本仓做过的测量，记下工具实际返回什么，以及改用什么来回答同一个问题。
它们之所以被记下来，是因为每一条都曾换来一个错误结论，而且这里的错误读数落在答案的合法值域之内，
不是以报错的形式出现的。

- **agent shell 里的 `grep` 解析到 ugrep。** 一个三分支 ERE 交替
  （`grep -rl "a\|b\|c"`）在整棵 crate 树上返回零个文件，而同样三个词逐个搜分别返回 46、17、13 个。
  以 `^+++` 开头的模式在那里是语法错误，因为 `+` 是量词。每次只搜一个词，或改用 `rg` 或一小段脚本，
  都能回答它。一个来自交替分支的零，值得先换一个引擎再决定信不信。
- **`repos/O/R/commits/<sha>/check-runs` 返回该提交上【每一轮】的检查**，不是最新那一轮。
  重跑之后，先前那轮的失败仍在列表里，而 GitHub 自己算出的合并状态用的是每个检查名的最新一轮。
  按 `.name` 分组并按 `.started_at` 取最后一条，给出的就是合并按钮所用的那个视图。
- **一个 pull request 的 head 提交在 squash 合并之后永远不是 `main` 的祖先。** 于是
  `git merge-base --is-ancestor <pr-head> <tree>` 对每一个已 squash 合并的改动都答「不含」，
  包括确实含有它的树，所以它分不开这两种情况。真正落地的那个提交是
  `gh pr view <n> --json mergeCommit`。而检查该改动引入的某个字符串
  ， `git show <tree>:<file> | grep -q <marker>` ， 根本不需要提交身份，并且经得起 rebase 与 cherry-pick。
- **本仓以 `squash_merge_commit_message: COMMIT_MESSAGES` 合并。** pull request 正文从不进入 `main`，
  提交信息才会。评审后改了描述，原来的说法仍留在分支里；而
  `gh pr merge --squash --body-file` 可以在合并那一刻替换掉那段信息，不需要 force push。
- **`sysctl vm.swapusage` 报出的已用交换在内存压力缓解后不会回落**：macOS 不回收已经换出的页，
  所以在一台已经不紧张的机器上，这个数仍然停在接近峰值的位置。`vm_stat` 的空闲页计数会随真实状态变化。
- **`rg` 看不见本仓 6145 个被跟踪文件里的 179 个，成因有两个且互相独立。** 其中 99 个住在点开头的
  路径下，ripgrep 默认跳过：`.github/workflows` 全部 21 个、`.github/actions` 九个、`.docker` 五个。
  另外 79 个被 `.gitignore` 排除却仍被跟踪，ripgrep 同样跳过：`scripts/ci` 下 28 个、装着全部
  `CREATE TABLE` 与迁移与 `GRANT` 的 `postgres-init` 脚本、以及约 45 个测试夹具。还有一个文件要两个
  开关同时打开。搜一个出现两次的字符串，就能看出为什么只开一个开关不是解法：

  ```text
  rg -l <pattern> .              0    两个成因各藏一处
  rg -l <pattern> .github/       1    显式点名点目录，破解第一个成因
  rg -l --hidden <pattern> .     1    破解第一个，不破解第二个
  rg -l --no-ignore <pattern> .  1    破解第二个，不破解第一个
  rg -l -uu <pattern> .          2
  git grep -l <pattern>          2
  ```

  `git check-ignore` 只预测得了第二个成因，而且预测得并不可靠：忽略规则对已跟踪文件不生效，所以 git
  正确地答「不忽略」，而 ripgrep 只按忽略文本过滤它的遍历，不查跟踪状态。`git grep` 与 `rg -uu` 能回答
  这个问题；`rg --files <dir> | wc -l` 则说明这个零是在几个文件里搜出来的。一条来自遍历的否定断言值得
  连同产生它的那条命令一起记下来，就像一个计数值得连同它的修订号一起记下来；而一条「没有任何 workflow、
  CI 脚本或迁移提到它」的断言值得重跑一次，因为这三样恰好就是默认遍历读不到的东西。

- **`-E` 模式里的 `\b` 与 `\s` 在 Linux 上有效、在 macOS 上一个都匹配不到**，而危险的是方向。
  它们是 GNU 扩展不是 POSIX ERE：glibc 的匹配器接受，BSD 的忽略它们并报告"无匹配"而不是报错。
  同一份文件树、同一条命令，Linux 上 git 2.54.0 与 macOS 26.6 上 git 2.55.0：

  ```text
  pattern                    Linux   macOS
  \bBindingDigest\b            1       0
  \s                           1       0
  [[:space:]]                  1       1
  ```

  **所以一个在 Linux 或 CI 上写好并验过的模式，到开发机上会空手而归；反过来在 macOS 上写则会当场得零而被发现。**
  坏掉的那一侧恰好是"已经验过了"的那一侧，而 CI 绿证明不了同一个模式在本机有效。
  部分丢失比完全丢失更糟：在 macOS 上 `git grep -cE '^\s*pub fn'` 返回 540 个文件，
  `'^[[:space:]]*pub fn'` 返回 1503 个，**坏掉的模式返回了一个大到像答案的数**。
  要写 `[[:space:]]`、`[[:alnum:]]` 和显式的 `(^|[^A-Za-z0-9_])`（两种匹配器都读得懂），或者用 `-P`。
  上表的 macOS 一列与那两个 540/1503 的计数是在本机量的；Linux 一列是另一条 lane 在容器内、
  在一棵为此对照而建的树上量的。

- **`scripts/ci/test-rd-owner-postgres.bash` 在非 Linux 宿主上以状态 1 退出。** 所以本机跑一轮有序链路
  必然是跑一份改过的副本，而改了哪里决定了那一轮意味着什么：换掉比较对象会保留容器、数据库、
  角色授权以及它前面的每一个条目，而直接调用测试二进制则把这些全部跳过。后者的失败不是那个条目的失败。
- **`cargo` 的 `--message-format` 决定同一轮能报出多少条死码，而三种格式里有两种会无声少报。**
  `--message-format=short` 把一个实现里的每一个死成员折成一行
  `multiple associated items are never used`，锚在第一个死成员上，且一个成员名都不带；默认的
  渲染格式每条诊断打一个 `-->`，不是每成员一个，所以数 `-->` 行数得到的也是诊断数。只有 `--message-format=json` 把被折叠的成员逐个
  作为 primary span 给出。同一条 `cargo check -p vibe-data --lib` 在 `3560a3aa1` 上，对
  `crates/data/src` 可以答 387 也可以答 623，取决于数的是哪一个，因为其中 68 条诊断带着不止一个
  primary span。要数就从 JSON 输出里对 primary span 去重；要问某一条在不在集合里，就按名字查，
  不要比数字。
- **`--all-targets` 会打开一个命令行里根本没提到的 feature。** `crates/qualification` 与
  `crates/backtest_owner` 在 `[dev-dependencies]` 里带 `sealed-strategy-input-acceptance`，于是
  `cargo check --workspace` 是关的，而 `cargo clippy --workspace --all-targets` 是开的。常用的
  「在前者里死、在后者里活」差集因此同时动了两个变量，分不出 `cfg(test)` 调用方和 feature 门内
  模块里的调用方。把 feature 放进它自己的一次构建、保持目标集不变，就能分开：在 Market Data 那
  一族上，这把「九十二条里有六条在非默认 feature 门后」变成了「163 条全都在，而且没有一条有
  `cfg(test)` 调用方」。
- **`#[allow(dead_code)]` 的注释里写明了它何时该退休，而条件满足之后它仍旧在压制那条 lint。**
  这个仓库里有七条压制在被测量时已经活过了它自己写下的理由，而在此之前什么都没红过，因为那条
  压制正是本该报告它的量具。`#[expect(dead_code)]` 是同一条注释加上有效期：一旦条目不再是死码，
  构建就会失败。但它只适用于那些在每一种目标配置下都是死码的条目 - 把其中三条被测试用到的这样改，在 `--all-targets` 下产生三条未兑现的预期和五个错误，而 `cargo check` 仍然是绿的，
  那正是「只有测试在调」的位置。
- **`check:i18n:structure` 只说有东西不一样，不说是什么、也不说在哪。** 它的几个提取器并不同质：
  强调和 inline code 按数量比，所以它们的失败会给出两个能指向那处改动的数字；而受保护的
  Markdown skeleton 是按一个序列化后的值整体比的，所以它的失败永远写成
  `(English 1, Chinese 1)` - 那两个 1 是"各有一个 skeleton"，不是差异数。中文页面把一段
  inline code 折了行就会改掉那个值，而所有计数仍然一致 - 一个页面可以在强调 12 对 12、
  inline code 112 对 112 的情况下失败。对两个文件各调一次
  `protectedMarkdownSkeleton()`，报出序列化结果里第一行不同的位置，就能把这种失败变回一个位置。

## 能力成熟度与开发入口

| 产品能力   | 当前范围                                                                      | 任务入口                                       |
| ---------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| 领域 MCP   | 数据、策略编写与回测有独立 workspace；研究 MCP 仍待开发                       | Product Edge 服务合同与对应 `services` 源码    |
| JSON 编写  | 有界 T0 子集已实现；完整 R‑1 挂单、条件撤单及分段退出待扩展                   | R&D authoring 与 Strategy Factory typed BFP    |
| 原生回放   | 已有输入托管、执行服务与 Result 身份分支；接通范围由 feature/实际 wiring 决定 | Backtest 与 R&D run composition                |
| 报告链     | 当前回测 run report 路由仍返回 `RUN_HAS_NO_RESULT`                            | 从真实持久 Result 到报告读回，不用运维日志代替 |
| 多周期数据 | 原生周期数据与点时托管有具体接线；数据服务周期不等于执行白名单                | Market Data，执行白名单 `1w/1d/4h/1h`          |
| 复杂策略   | 直接 BFP Host、多笔/多策略、动态选币、分段保护与局部下钻是有依赖的目标        | 所属章节的前置条件与正向/失败验收              |
| 用户界面   | 自研 Dashboard preview 有按路由准入的切片                                     | Dashboard 精确路由/组件合同，不默认扩大实现集  |
| 交易节点   | 原生节点和产品信任层是目标；Paper/Live 未准入                                 | 架构规则与 Runtime/Risk/Execution 的唯一职责   |

状态以准确源码版本、服务接线和消费者结果核对。已合并局部代码、当前目标或开放 PR 都不是完整产品能力。
按最早缺口交付：数据覆盖 → 请求/编写 → 原生执行 → Result/报告 → 研究决定；不能倒置依赖或另造替代引擎。
文档变更融入所属正文并同步直接链接，不留修订日记、旁路蓝图或待读者调和的旧规则。
