# 用户旅程与门禁联合可满足性实测审计报告（2026-11-27）

- **被测目标**：`exp/integration-preview` @ `9a9230502`（全量 15 分支总装预览；只读审计）
- **审计协议**：`product-doctor` 新增 `journey` 透镜（联合可满足性 `A∧B∧C∧D∧E`、逐条件独立非冗余 `¬X∧⋀(Y≠X)`、拒绝→字面修复→解锁闭环）+ `doctor.py gates-map` 静态门禁链图谱
- **复现探针目录**：`/tmp/doctor-rd-sources/journey_audit/`（`probe1_closed_line_explore_deadlock.py`、`probe2_live_launch_ui_remedy_deadend.py`、`probe2_ui_check.mjs`、`probe3_redundant_shadowed_dead_gates.py`、`probe4_happy_path_joint_satisfiability.py`）

---

## 一、核心结论

用户关于“Live 等核心旅程是否存在**联合条件永远无法满足**或**冗余/被遮蔽死门禁**”的直觉被 **100% 实证命中**：
- **1 个严重上游-下游死锁（`D1`）**：按正常流程闭线（满足 `LIVE_HISTORY_UNDECIDED`）后，按文档补钱包余额 `replay explore` 被 `LINE_ENDED` 卡死；跨季度另开新线可能数学无解。
- **3 个严重 UI 拒绝→补救死胡同（`R-UI-1`、`R-UI-2`、`R-UI-3`）**：补完证据后 LiveLaunch 永不刷新且点 `Check again` 无限复用冻结的旧 `preparedId`；杠杆不匹配时预读全绿 PASS，预检失败后 UI 完全不展示拒绝原因并误导至空的 Requests。
- **8 个实证冗余 / 被遮蔽 / 废弃死门禁（`R1`–`R8`）** 与 **1 个部分遮蔽门禁（`R9`）**。
- 同时确认 `Research → Precheck → Review → Registration → Validation`、`Paper` 准入与 `live/reconcile.py` 7 条对账子句均**联合可满足且彼此独立**。

---

## 二、Confirmed Unsatisfiable / Deadlock（联合不可满足死锁）

### `[D1]` HIGH — 闭线历史检验（Gate A）与钱包余额/杠杆回放补救（Gate B）互斥死锁
- **触发链路**：
  1. `live/runs.py:511` → `live/admission.py:27-40` → `report/history.py:406-418` (`require_unfalsified`)；前端 `ide/web/src/model/liveLaunchText.ts:23` 提示：*"Close its line first, or select a candidate the test passed."*
  2. 研究默认初始资金 `100,000 USDT`（`engine/config.py:116`）。实盘/测试钱包（如 `200/500 USDT`）不在 ±10% 范围内时，`engine/live_venue.py:358-378` 拒绝 `LIVE_EVIDENCE_BALANCE` 或 `LIVE_EVIDENCE_MISSING`。
  3. 唯一文档化补救（`live/README.md:49-51`）：`candidate export` → `replay explore --starting-balance <wallet> --symbols ...`（且 `live/runs.py:385` 要求交易窗口落在该源码原 `research` trial 的 `[trade_start, trade_end]` 内）。
  4. **死锁点**：`cli/replay_commands.py:119-120` 强制 `replay explore` 必传 `--line`；`replay/entry.py:426` → `ledger/lines.py:313` → `open_line()`（`ledger/lines.py:78-79`）对已关闭研究线直接拒绝 **`LINE_ENDED: <line> is closed`**。若另开新线 `L2` 绕过，当 `[L2.dev] ∩ [L.dev] = ∅` 时 `WINDOW_OUTSIDE_DEVELOPMENT` 与 `LIVE_EVIDENCE_MISSING` 互斥无解。
- **为何现有单测漏检**：`tests/live/test_replay_evidence.py:85-91` 直接手写 DB 行绕过了 `replay.entry.explore` 且未调用 `close_line`。
- **实测复现**（`probe1_closed_line_explore_deadlock.py`）：`line close` 后，`live preflight` 报 `LIVE_EVIDENCE_BALANCE`（nearest: `100000` vs wallet `500`），按提示执行 `replay explore --line rsi-root` 被 `LINE_ENDED: rsi-root is closed` 拦截；开非重叠新线报 `WINDOW_OUTSIDE_DEVELOPMENT`。

---

## 三、Confirmed Refusal → Remedy Dead-Ends（报错修复死胡同）

1. **`[R-UI-1]` HIGH — 补回放证据后 LiveLaunch 永不刷新，且 `Check again` 无限复用旧的不可变 `preparedId`**
   - `ide/web/src/state/liveRun.ts:77`：`GET /evidence/` 返回 `"found"`（旧 `100,000 USDT` 回放）或 `"missing"` 后轮询永久停止。
   - `ide/web/src/widgets/live/LiveLaunch.tsx:15, 69-70`：`STARTABLE` 包含 `"preflight_failed"`，首次点 Check 时 `backed = true`，之后即便补完 `500 USDT` 回放，`(backed || !evidence)` 仍恒为 `true`，点 `Check again` / `Start` 永远复用冻结在旧 `research_at` 的 `run_id`，反复撞旧 `LIVE_EVIDENCE_BALANCE`，除非硬刷新整页。
2. **`[R-UI-2]` HIGH — 杠杆不匹配预读全绿 PASS，预检失败原因在 UI 彻底失踪且误导至 Requests**
   - `live/control.py:160`（`GET /evidence/`）不返回 `leverage`；用户有 `3×` 回放却选 `5×` 时，前端 `launchColumns()` 全绿 PASS，`prepare_locked(leverage="5")` 静默写入 `manifest["evidence"] = []`，preflight 以 exit `2` 失败。
   - 3 处用户可见 `LIVE_EVIDENCE_MISSING` 文案（`live/control.py:44`、`live/runs.py:53-55`、`liveLaunchText.ts:20`）全部漏提 `leverage`；且 `live/views.py:408-554` 返回的 `run_view` **不包含** preflight 的拒绝码或 stderr，而 `liveLaunch.ts:125-126` 误导用户看 `Requests`（实际仅记录 HTTP 202 `effect_recorded`）。
3. **`[R-UI-3]` LOW — 2 处事实不符文案**
   - `liveLaunchText.ts:35` 将 Launch 期 `LIVE_BUDGET` 误述为 `3×` 敞口上限（实际为 `wallet * 0.85` 向下取整为 `0.00`）；
   - `ide/web/src/widgets/paper/PaperDialogs.tsx:114-116` 误称删除 Paper 运行后旧研究账本与 DoltHub 仍保留（与 `AGENTS.md` 执行记录不上账本/DoltHub 冲突）。

---

## 四、Confirmed Redundant / Shadowed / Dead Gates（冗余/被遮蔽/死门禁）

| 编号 | 位置 | 类型 | 实证摘要（`probe3`） |
|---|---|---|---|
| `R1` | `cli/live_commands.py:112-116` (`--action resolve`) | 废弃死 CLI 参数 | E8 删除 request log 后残留，`live/control.py:354-390` 无对应分支，恒返 HTTP 400 `LIVE_CONFIG` |
| `R2` | `engine/live_errors.py:7` (`LIVE_CREDENTIAL_CONFLICT`) | 零引用死拒绝码 | 仅在 `REFUSALS` 声明，全仓生产代码 0 处抛出 |
| `R3` | `live/runs.py:349-350` (`_candidate` SHA-256 → `LIVE_IDENTITY_CHANGED`) | 100% 被遮蔽不可达 | `runnable()` 先调 `ledger/strategies.py:100-120` 抛 `LEDGER_CORRUPT` 且未捕获，349-350 行永不执行 |
| `R4` | `live/runs.py:618-619` + `control.py:283` / `runs.py:629` (`sent_locked`) | 被 `_require_unused` 遮蔽 + 同锁双调 | `control.py:394` 同锁下已先拒 `LIVE_REQUEST_CONFLICT`，且 `sent_locked` 被连续调用两次 |
| `R5` | `control.py:255` + `runs.py:489` (`prepared_locked`) & 3× config 校验 | 同锁重复校验 | 单次 prepare 在独占锁内调 2 次 `prepared_locked`、3 次 `symbols`/`run_config` 校验 |
| `R6` | `live/control.py:266, 288` (`runs.review`) | 空转 DB 查询并丢弃结果 | `prepare_locked` 刚读完不可变 `research_at` 后立刻二读 Dolt 比较自身 SHA 并丢弃返回值 |
| `R7` | `live/runs.py:317-326, 634` (`_bound_credential`) | 生产路径不可达 | 全部 2 处调用方同锁刚取 `run_path_locked` 传入，函数内重算并比对自身 |
| `R8` | `live/control.py:36-42, 45` (5 条 `MESSAGES`) | 死 HTTP 错误文案 | `LIVE_ACCOUNT_NOT_FLAT`/`MODE`/`FUNDS`/`CLOCK`/`EVIDENCE_BALANCE` 仅在 detached 容器抛出，永不走 HTTP 控制面 |
| `R9` | `registration/register.py:481-483` (`validate()` 缺 bundle) | `register()` 中被 `SOURCES_REQUIRED` 遮蔽 | 仅在 `bind()` 中仍可达 |

---

## 五、已确认干净且独立的核心门禁链（Self-Refute 通过）
- `Research → Precheck → Review → Registration → Research Run → Interpretation → Validation Register` 全链联合可满足且各门禁独立；
- `paper/runs.py` `PAPER_RECOVERY_UNDECLARED` AST 门禁与 `live/reconcile.py:48-68` 全部 **7 条对账子句**逐一变异实证独立且联合可满足；
- `engine/live_venue.py:304-305`（`LIVE_BUDGET` 在 `0.01 USDT` 可达）、`live/runs.py:303`（`LIVE_ACCOUNT_CHANGED` 磁盘篡改纵深防御）、`live/runs.py:637` vs `659`（按 `mode` 互斥）均确认非死代码。
