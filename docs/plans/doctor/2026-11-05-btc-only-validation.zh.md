# 2026-11-05 只交易 BTCUSDT 的候选能否通过样本外验证

聚焦诊断。来自[市场数据模块](2026-11-05-market-data-modules.zh.md)留下的缺口：只交易 BTC 的候选能否通过验证。产品代码、活动账本、市场目录都没有改。

| Item | Value |
|---|---|
| Sessions | 无被审研究会话 |
| Audit session | Claude Code desktop，诊断会话 `local_a4bfe5f6-8560-4c98-bb94-626ffd5cc09c`（worktree 分支 `claude/nervous-tesla-0207de`）。本记录由市场数据模块的诊断会话 `0269fe77-2b1b-4291-bdb9-070210095215` 按该会话的笔记写入，数字未重跑，引用的行号已在 main 上复核 |
| Checkout / ledger | 诊断时 `2bb13e460`；账本调用时最大 trial 737。市场提交 `20261103000000000000000000000000` |
| Coverage | `registration/validation.py` 的成员检查、绑定、`check_comparable`、报告的登记段；隔离 Dolt 2.4.2 上的绑定；隔离账本上的原生回放。**缺口**：`replay run --validation` 没有端到端跑过（需要未来窗口和 main 构建检查），绑定用替身市场、成员检查用真实市场，是分开验证的；全池窗口内有合约下架且没给 lifecycle bundle 的情形没有专门测试；回放数字是单个候选、单段窗口 |
| Cost | 研究代价：目前 none，验证由用户发起，账本 0 个登记。产品造成的无效试验：0 个。审计自身 unknown |
| Net change | 拒绝码 257（上份记录 257）。skill 词数 27,773（上份记录 27,731，同口径，差额来自期间合入的 PR）。提议未实施：0 个存储字段，0 个拒绝码，一处检查和一个测试，`validation.md` 约 +15 词，设计站两页；未做原型 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-34 | 只交易部分合约的候选不能以自身通过验证：`--symbols` 被 `MEMBERSHIP_CHANGED` 拒绝，全池能通过，但多数候选变成另一个实验 | 见下节 | authority（用户定为等首次验证再决定） | none | open |

### 证据

**成员检查。** `registration/validation.py:111-118` 遍历市场推出的全部成员，`registration/inputs.py:223` 的成员只来自本次 `symbols`。真实市场上，窗口 2026-08-01 至 2026-11-01：

| 选择 | 环境 | `membership_unchanged` |
|---|---|---|
| `{"symbols": ["BTCUSDT"]}` | bars、quotes | `MEMBERSHIP_CHANGED`：1000PEPEUSDT is removed from or shortened in the strategy's membership |
| `{"universe": true}` | bars、quotes | 通过，22 个合约 |

**绑定。** 隔离 Dolt 2.4.2、测试替身市场：`validation_register` 接受，登记里没有合约范围；绑定 `--symbols AAAUSDT` 被拒，不写入、不消耗登记；绑定 `{"universe": true}` 成功。报告的 `registration` 段没有合约范围字段，读者看不出跑的是多少个合约。

**原生回放。** 隔离账本，`replay explore`，来源取 trial 727 的 `dow-structure-fastpivot-freshlow-4h@1`，同一窗口。这些是开发窗口内的工程试验，只说明范围的影响，不是研究证据。

| 用例 | 合约 | 成交 | 年化 | 最大回撤 | 用时 | 峰值内存 |
|---|---|---|---|---|---|---|
| `--symbols BTCUSDT` | 1 | 16 | 16.0% | 1.64% | 33 s | 0.207 GiB |
| `--universe pool` | 22 | 361 | 202% | 22.1% | 182 s | 0.415 GiB |
| 来源里限定 BTC，再 `--universe pool` | 22 | 16 | 16.0% | 1.64% | 64 s | 0.345 GiB |

第一行和第三行的 16 笔成交及日收益完全相同。第二行的盈亏最大来自 AVAXUSDT。另外：

- `chan-third-confirmed-1h@1` 加 `--universe pool`：`on_start` 里 `self.stop()`，原生退出 1，运行 invalid。
- `--universe pool` 加 `--execution quotes`：`QUOTES_MISSING`，22 个里 19 个没有报价。来源里限定 BTC 绕不过这条，它看导出，不看策略是否交易（`engine/run.py:1031-1045`）。
- 导出成本不是障碍：22 个合约的 bars 导出 85.9 MB、22.4 s、峰值 0.66 GiB。

**账本（只读）。** 734 个可读开始回执的 selection 全部是 `{"symbols": ["BTCUSDT"]}`。`validation_registration`、`validation_binding` 各 0 行。已发布候选 273 个：255 个来源里没有合约限制，18 个有字面量（`chan-third-*`）。

**缺陷还是设计。** 检查本身符合设计（`docs/rd/validation.zh.mdx:141`、`tests/registration/test_validation.py:126-128`）。它写于 #1565（10-19），当时研究都是全池。#1681（10-25）允许用户选合约子集做正式研究（`docs/rd/library.zh.mdx:201`），验证一侧没有跟着改。这是两条设计没有对齐，不是代码写错。

**第一次验证会遇到什么。** 登记成功且没有警告。窗口过完后，`--symbols BTCUSDT` 被拒，拒绝的下一步（`ledger/refusals.py:465-469`）和 `validation.md` 都不提合约范围。能走通的只有全池：255 个候选会绑定成功、用掉这次登记、交易 22 个合约，而且必须照实报告，不得另登记窗口或范围。18 个 `chan-third-*` 按代码先绑定再 invalid（`replay/entry.py:535-537`），这一步没有在验证路径上原生跑过。

### 补救的比较

- `none` 不合适：Agent 现有指引没有这条路，能走通的路径又会静默换实验。
- 建议，需用户授权：按它防的风险重述检查。风险是看过窗口后再删成员。绑定时已在原始登记提交上读基准研究运行（`registration/validation.py:296-301`），同一记录带 `input_identity.selection`（`registration/register.py:258`）。基准是全池时与今天相同；基准是 `{"symbols": S}` 时回放必须正好是 S，只查 S 的成员区间。
  - 现在拒绝、改后允许：BTC 研究的候选用 BTC 回放。
  - 现在允许、改后拒绝：子集研究的候选用全池回放，与 `research-round/references/template.md:77` 不外推到全池的规则一致。
  - 事后删成员、事后换范围仍被拒绝。
- 不要授权的办法：来源里限定 BTC 再跑全池。代价是每个待验证候选多一个修订、预检、审查和一次计入次数的研究运行（否则 `registration/validation.py:299` 的 `CONFIG_MISMATCH`），报告也看不出范围，对 quotes、trade ticks、metrics 无效；注册环节没有实际跑过。
- 移除检查不合适：会放开事后删成员。新增存储字段不合适：范围可从现有记录推出。

合约范围不写在登记里，所以这个改动可以等到第一次绑定之前，不耽误窗口。

## Decisions

- 2026-11-10 用户授权修改（见上节），本记录随修复 PR 关闭。
- 2026-11-05 用户选“等首次验证再定”：现在不改产品，也不算授权。用户第一次要做验证时，先在登记之前提出这件事；不要把子集研究的候选用 `--universe pool` 绑定后当作验证了它。到时先复核代码，上面的数字是 11-05 的。

## 2026-11-10 复核与漏报

**复核。** 在 `origin/main` `a21e3c874` 上（`registration/validation.py`、`market/universe.py` 与工作树无差异），市场提交
`20261108000000000000000000000000`，假想窗口 2026-09-01 至 2026-10-01、登记于 2026-08-15，只读调用
`membership_unchanged`：

| 策略收到的成员 | 结果 |
|---|---|
| 窗口内全池 22 个合约（对照） | 通过 |
| 只有 BTCUSDT | `MEMBERSHIP_CHANGED`：1000PEPEUSDT is removed from or shortened in the strategy's membership |

与 11-05 的结论相同，代码行号已移到 `registration/validation.py:107-120`（遍历全部成员）和 `:280-286`（绑定前比对 `instruments`）。

**漏报。** 11-05 的决定要求用户第一次发起验证时，先在登记之前提出这件事。2026-11-10 的研究会话登记了
validation registration 1（`price-action-retest-followquote@1`）和 2（`price-action-retest-midconfirm@1`），两者的开发期
基准运行（trial 2557、1411）都是 `{"symbols": ["BTCUSDT"]}`，登记前没有提出。原因：这条决定只写在本记录里，
`research-round/references/validation.md` 不指向它，Agent 规划验证时没有读 doctor 索引。登记之后，用户另一个问题的独立审阅
读代码时才发现，再由本次聚焦诊断确认。漏掉它的覆盖职责：Behavior and decision evidence。

**代价与时限。** 两条登记的窗口是 2026-11-12 至 2027-05-12。合约范围不写在登记里，按上文的建议改检查，在第一次绑定之前完成即可，
窗口不受影响。若到 2027-05 仍未授权，两条登记只能用 `--universe pool` 绑定，也就是变成交易 22 个合约的另一个实验；
或者不绑定。不改的话，它们实际上无法验证原候选。

**授权与修复。** 用户 2026-11-10 回复"授权修改"，按"补救的比较"里的建议实施：`membership_unchanged` 改为接受基准研究运行的合约选择，基准是 `{"symbols": S}` 时回放必须正好是 S、只核对 S 的成员区间，基准是全池时与原来相同；绑定先在原始登记提交上读出基准，再做成员核对。没有新增存储字段和拒绝码，`MEMBERSHIP_CHANGED` 的说明和下一步改为写明合约选择。
