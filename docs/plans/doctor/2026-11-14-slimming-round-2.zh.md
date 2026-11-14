# 2026-11-14 瘦身审计第二轮：用户决定、实施结果与副发现

| Item | Value |
|---|---|
| Sessions | 无研究会话；接续 [瘦身审计](2026-11-13-whole-product-slimming-audit.zh.md) 与 [第一轮授权](2026-11-13-slimming-authority.zh.md) |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `c6ee7b85-8de9-4ef4-8eca-13f68718117e`（与瘦身审计同一会话）；实施由 workflow 子 agent 在各自 worktree 完成 |
| Checkout / ledger | `origin/main` 从 cf095d174 到写本记录时的头；账本只多了配对验收的 explore 试验 118–135（活动账本，见下） |
| Coverage | 瘦身审计 60 批的实施收尾、第二轮授权项 20261114-01..07、0.x 不兼容决定的全仓清扫（16 个 agent）、实施中发现的副问题；未重跑研究会话 |
| Cost | 未测：本会话总时长与 token 数宿主不给出；no-compat 清扫 16 个子 agent 约 223 万 token、64 分钟 |
| Net change | 第二轮与 no-compat 清扫按 PR 计：删除 Live runtime switch、runner 接管、Web 先行与协议基线、Paper 发布兼容检查、`LIVE_RUN_FORMAT`、跨契约 `RUNTIME_UNSUPPORTED` 线门；新增 `live.runs.earlier()` 一个跳过谓词。拒绝码只减不增；skill 文字的增减见各 PR |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261114-01 | 保留的旧清单格式 Live 运行让凭据保存、准备、删除和 `GET /api/live` 都拒绝 `LIVE_CREDENTIAL_BUSY`，整个 Live 页不可用 | `live/credentials.py` `_runs` 对每个保留运行调 `runs.read_manifest`，把 `LIVE_RUN_FORMAT` 转成 busy；[#2950](https://github.com/qOeOp/trade/pull/2950) 先按无清单事实放行，随后 0.x 不兼容决定改为跳过更早格式运行 | fix | wrong output | fixed（#2975） |
| 20261114-02 | -136 实施者列出、未做的三处对手改状态的凭据托管规则 | [#2956](https://github.com/qOeOp/trade/pull/2956) 并成一条未绑定运行的托管规则 | merge | none | fixed |
| 20261114-03 | `ledger init --name X` 覆盖已存在的 `X.json` market profile | 临时 `TRADE_LEDGER_HOME` 复现：`market init --name probe` 后 `ledger init --name probe` 成功并替换；`ledger.db.init` 只查读得出的 profile | fix | wrong output | fixed |
| 20261114-04 | 研究图 JSON 的 `bundle` 指线与评审两种标识 | [#2953](https://github.com/qOeOp/trade/pull/2953) 拆成真实名字；存储列改名延到下一代 schema（-11） | restate | none | fixed |
| 20261114-05 | `add_judgment` 不收整数 `line_id`，其余线查找都收 | `ledger.judgments.add_judgment` 对整数 `line_id` 拒绝 `LINE_UNKNOWN`，`ledger.lines.read_line` 收名字或 id | fix | none | fixed |
| 20261114-06 | Paper 运行列表把当前读数叫 `live`，同一对象在流事件里叫 `readings` | `paper/serve.py` `live_readings()`；发布门 probe 同步改读新名 | restate | none | fixed |
| 20261114-07 | 设计站首页架构图没有 Live 节点 | [#2951](https://github.com/qOeOp/trade/pull/2951)；它删掉了地图里最后提到 `lines.py`、`judgments.py` 的文字，`skill-names` 规则 2 因而拒绝一条评测题面，题面改称模块，用例重跑 3/3 通过 | restate | none | in PR |
| 20261114-08 | `replay explore` 记录的 `export_sha256` 随共享缓存窗口里别的合约变化 | -148 配对验收（试验 121/132，BTC/ETH 2021-10-01..2024-10-01，市场日 2026-11-10）两侧 BTC/ETH 文件逐字节相同，哈希却是 bf24f808 与 85183449：`registration/inputs.py` `export_fingerprint` 遍历整个导出根，explore 是唯一用 `export_catalogs(fresh=False)` 共享缓存的路径，另一会话同时把 23 个池合约写进了同一窗口目录。消费者是 `report/status.py` `counted_trials`：explore 对 explore 的精确复现要求 `export_sha256` 相等，哈希不同时同一 explore 重跑被算成新测试（偏保守）。fresh 导出（precheck、research、validation、history）只含所选合约，不受影响；`INPUTS_CHANGED` 只在 fresh 导出的封存路径上检查，也不受影响 | fix | none（一对实测） | in PR |
| 20261114-09 | Live 的 reduce-only 退出单把 `params` 静默丢掉，没有像入场单那样按 `ORDER_RULE` 拒绝 | -118 实施者在 [#2959](https://github.com/qOeOp/trade/pull/2959) 读到：退出提交给 `OrderRules.submit_order` 只传 `client_id`；未构造出实际带 params 的退出，代价未测 | authority（收紧下单规则） | unknown | open |
| 20261114-10 | 发布改了 `uv.lock` 时不重建回放镜像，发布后的 Live 证据对不上 | -147 的副缺陷，focused diagnosis 在 e83c331ca 上成立 | fix | wrong output | fixed |
| 20261114-11 | 存储列：删 `run_reading.computed_at`（-123），`trial_instrument.instrument_id` 改 `symbol`、`trial_capture.table_hashes` 改成 `run.fingerprints` 形状（-04） | 用户已批准，等下一代 schema 一起做；本代不改存储 | authority（已批准，延期） | none | open |

## Decisions

**第二轮授权（2026-11-14，一道多选题四项全选）**

1. Live 旧格式运行锁死整个 Live 页：放行（-01）。
2. `ledger init` 不覆盖同名 profile，与 `market init` 共用检查（-03）。
3. 命名：图 JSON 的 `bundle` 现在拆（-04）；存储列改名延到下一代 schema（-11）。
4. 三项我建议撤回的低价值改动，用户保留：`LINE_UNKNOWN` 收整数 `line_id`（-05）、-136 的三处凭据托管调整（-02）、Paper 读数字段 `live` → `readings`（-06）、设计站首页 Live 节点（-07）。

**0.x 版本之间不保留兼容（2026-11-14）**

用户原话："马上都要升0.3.0了 后面还会有更多版本 现在前期快速迭代期 变动很大 真的要保留这么多兼容代码嘛 很多时候老研究能直接删了在新版本上重新开始研究的吧"，随后选了"按这个做"：

- 新版本跳过更早格式的 Live/Paper 运行、图和 profile，留在磁盘上不读、不迁移、不特判；
- 删除所有读或迁移更早格式的代码，包括 #2950 刚加的无清单分支；
- 升级时 Live 必须空闲；
- 规则写进 AGENTS.md（[#2971](https://github.com/qOeOp/trade/pull/2971)，[#2978](https://github.com/qOeOp/trade/pull/2978) 按实际实现改了最后一句）。

清扫先核对了发布门：当时 `deploy/release.py` 的 adopt 路径在 runner 契约相同时让新控制程序接管运行中的 runner（2026-11-10 第 6 步授权），Web-only 与 Web 先行发布也会在 Live 忙时换 Web。这些都是跨版本兼容机制，按"升级时 Live 必须空闲"删除（[#2975](https://github.com/qOeOp/trade/pull/2975)），取代 2026-11-13 持续运行设计 §3.8 的 runtime switch 与"控制和 Web 随时更新"。后果：装了 Live 的主机上，Live 有运行时任何发布（包括只改 Web 的）都等到 Live 空闲。runner 的执行镜像本来就从不在发布里换。

清扫保留了 20 处看似兼容、实为单一当前格式检查或 gen-1 自身复现所需的代码（`MANIFEST_FORMAT`、`EARLIER_SOURCE_PATHS`、`replay-contract@v8`、schema 代次检查、Paper `reconcile.json` 格式等值等），理由逐条写在清扫结果里，不需要用户决定。

no-compat 的 PR：[#2970](https://github.com/qOeOp/trade/pull/2970)、[#2971](https://github.com/qOeOp/trade/pull/2971)、[#2972](https://github.com/qOeOp/trade/pull/2972)、[#2975](https://github.com/qOeOp/trade/pull/2975)、[#2976](https://github.com/qOeOp/trade/pull/2976)、[#2977](https://github.com/qOeOp/trade/pull/2977)、[#2978](https://github.com/qOeOp/trade/pull/2978) 已合入；[#2973](https://github.com/qOeOp/trade/pull/2973)（删跨契约 `RUNTIME_UNSUPPORTED` 线门）、[#2974](https://github.com/qOeOp/trade/pull/2974)（删建立在它上面的两个评测用例和五处题面）、[#2979](https://github.com/qOeOp/trade/pull/2979)（网页只读配对的 Live 控制）待 CI。

**撤回与延期**

- -118 里把 Live 止损缺口计时并到 `protection.Gaps`：会把边界从 `≥` 改成 `>`，只省约 3 行，撤回，-118 其余部分照做。
- -123 删 `run_reading.computed_at`、-04 的两处存储列改名：等下一代 schema（-11）。
- 第一轮里我建议保留 `legacy_only` 的意见被 0.x 不兼容决定取代。

## 实施结果

60 批里 53 批已合入，-116、-118、-120、-121、-122、-131 这条 engine 链在 PR 中（已过配对原生重放验收，正在合入 #2975 之后的 main），-117 由 [#2880](https://github.com/qOeOp/trade/pull/2880) 修复，-114 与 -113 同在 [#2916](https://github.com/qOeOp/trade/pull/2916)。逐行状态见索引。

engine 改动的配对验收：`replay explore` 在 `ghcr.io/qoeop/trade-runtime:main` 与各 PR 镜像上跑 dow-theory@66（线 dow-theory-btc-eth，市场日 2026-11-10），三对窗口：BTC/ETH 2024-01-01..2024-04-01、23 合约池 2021-10-01..2024-10-01、BTC/ETH 同三年。`engine.compare_reports` 对 #2959（含 #2955、#2958）、#2960（含 #2955、#2958）、#2954 都是 0 处不一致，最终权益两侧相同（试点 112147.50736796）。这些试验以 explore 记进了活动账本：试验 118–135，共 18 个。
