# 2026-10-28 读取输入前失败的预检被算作源码暴露

| 项 | 值 |
|---|---|
| 会话 | Codex，`rollout-2026-10-28T19-00-35-01a181f4-5250-7872-8de2-2f815b6388fd.jsonl`，2026-10-28 10:01–10:15 UTC |
| 诊断会话 | Claude Code，claude-opus-5-5，会话 680521a4-f8b9-4e89-976d-14adf4ed4a12；聚焦诊断（用户提问：镜像版本切换造成的不兼容能否靠更新策略代码兼容，而不是硬性拒绝） |
| 检出 / 账本 | 检出 904fd386f；账本 `fun77fsckr446e3o1rqjkapg4dkrbdhm`（只读 `ledger sql`） |
| 覆盖 | 只读了与 trial 212 相关的调用、`replay/entry.py` 预检流程、`runtime/image.py` 探针、`engine/run.py` 阶段、`engine/load.py` 读取、`registration/register.py` 与 `registration/precheck.py` 的暴露判定；未分工作流，未做整场审计 |
| 时间拆分 | 10:10 预检失败，10:11–10:15 定位与停等授权，此后 Goal 标为 blocked；研究时间未单独计量 |
| 产品造成的无效试验 | 1（trial 212，策略未收到行情） |
| 按动作的发现 | fix/authority 1（-10）；authority 1（-11） |
| 复发项 | 无 |
| 用户先发现 | 0 |
| skill 体量 | 未改 skill |

## 发现

| id | 发现 | 证据 | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261028-10 | 预检在读取输入时失败（策略未收到任何行情），仍被登记的暴露检查算作源码已运行；换用正确镜像重新预检后，同一源码仍被 `SOURCE_ALREADY_EXPOSED` 拒，研究线 A 只能改用另一份实质不同的源码 | 会话 10:10 `replay precheck` 用旧镜像 `sha256:9ab421a9…`（构建版本 5d1ebea4e，Nautilus 2.0.0rc3）读 rc7 导出的 Catalog，trial 212 在 `inputs` 阶段报 `INSTRUMENT_NOT_UNIQUE`（`engine/load.py:297-299`），封存原件 native 退出码 1、唯一一条运行失败回执阶段为 `inputs`；`register._check_exposure`（`registration/register.py:448-488`）对同源码的每个试验只按“被引用且身份一致的短预检”免除，镜像不同即拒；会话 10:14 Agent 以只读复算确认登记会被拒，停下请求授权。改策略代码无助：不兼容在镜像与 Catalog 之间，换当前 main 镜像（rc7）即可；为过检改无关字节违反 `research-round/references/changes.md:15` | authority（用户 2026-10-28 授权放宽）+ fix：封存原件显示失败在 `load`/`inputs` 阶段的预检不算暴露，不论镜像、输入与窗口；失败记录保留，其余暴露检查不变 | 研究线 A 停在登记前，Goal blocked；三轮重复请求授权 | in PR |
| 20261028-11 | 预检在开 trial 之前已在镜像内跑 `--describe` 探针并挂载导出输入（`replay/entry.py:437`），但探针只核身份、不读 Catalog，镜像读不了当前导出的 Catalog 时要到开 trial 后才失败，留下一条试验记录 | 同上 trial 212；`runtime/image.py:178-240` 只核契约、路径与配置哈希 | authority（把读 Catalog 提到开 trial 之前属新增拒绝，需用户定）；-10 修复后这条只影响多留一条失败记录，不再卡住源码 | 一条无效试验 | open |

## 移除清单

无。

## 决定

- 2026-10-28 用户授权 -10：预检的封存原件显示停在 `load` 或 `inputs` 阶段、策略未收到任何行情时，不再算源码暴露；其余暴露检查不变。
- -11 用户未选，保持 open。
