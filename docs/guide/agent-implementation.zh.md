# Agent 实现指南

本页连接目标产品架构与当前 VibeTrader 引擎。它保留有价值的开发知识，但不会把旧正文、crate 布局、
示例或可调用 API 变成第二套产品权威。

## 两层文档

规范层由已发布的 `guide`、`architecture`、`owners`、`scenarios` 根目录以及 canonical 架构契约组成。
它决定一次变更的写入者、消费者、身份以及 accepted、rejected、unknown、replay 行为。

实现参考层继续保留在仓库中。它解释当前工具链、API、引擎机制、测试工具、扩展点与示例。
这些页面没有被删除，但它们不是产品权威；文件存在也不代表内容自动符合当前版本。

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

实现参考与新架构冲突时，以 canonical Owner 契约为准。实现参考包含过期 symbol 或命令时，以当前源码和
仓库检查为准。无论源码可调用还是旧示例曾成功，都不能证明目标契约已经实现。

不得在实现另一个切片时悄悄修复过期页面。应记录差异；依赖该差异的有界实现继续停止；只有 Main 接纳后，
才创建独立文档修正。这样可防止 Agent 把一个任务扩张成未记录的迁移。

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

- **`scripts/ci/test-rd-owner-postgres.bash` 在非 Linux 宿主上以状态 1 退出。** 所以本机跑一轮有序链路
  必然是跑一份改过的副本，而改了哪里决定了那一轮意味着什么：换掉比较对象会保留容器、数据库、
  角色授权以及它前面的每一个条目，而直接调用测试二进制则把这些全部跳过。后者的失败不是那个条目的失败。

## 为什么旧指南不进入产品权威

产品用户需要稳定的 Owner 旅程，而不是所有引擎 API。开发 Agent 两者都需要：稳定契约用于约束变更，
精确的当前实现知识用于让变更可行。明确分层既能保留 Developer Guide 的价值，也能防止历史设计或示例代码
覆盖 R&D、Backtest、Qualification、Market Data、Risk、Execution、Recovery 或 Observability 边界。
