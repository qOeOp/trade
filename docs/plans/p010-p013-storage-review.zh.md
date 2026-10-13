# P010–P013 证据关联字段审阅

2026-10-13，起始提交 fbb19684911da7c3ea7ee6420cbc8ebc669125a7。仅测试分支，旧 ledger/tag 与 market 只读。
独立 `/root/storage_review` 读取冻结 P010-r2/P011-r1/P012-r1/P013-r1 及现有 records 后审阅：复用 evidence/trial/run；无需新增 SQL 列或表。

| JSON 事实 | 消费者及必要性 | 不能用既有事实推导的原因 |
|---|---|---|
| execution-start 的 phase、source/image/config、工作目录 | 登记、恢复：原生启动前的用途和身份 | trial.mode 不能区分工程预检；事后日志无法证明目的事前确定 |
| execution 的真实命令、退出/中断、日志 hash/长度/状态 | report/compare/audit/恢复 | run.status 不代表实际进程退出、回调异常或 stderr；不能从退出码猜日志 |
| structured runtime failures | 当前经济可用性 | 干净退出、空订单和任意 WARN 文本不能证明回调成功或失败 |
| exact-source 预检及 Agent causal/readiness review | prereg/源码诊断 | G 账户审计明确不重建信号；代码只核对身份/原生事实，Agent 负责源码因果解释 |
| coverage receipt | 登记/入口/诊断 | market commit 身份不能表达成员/暖机/持仓覆盖、缺口与实际就绪 |

trial-<id>-execution-start 与 trial 同事务写入，明确 phase=source-precheck 或 replay。trial-<id>-execution 由执行入口捕获；通用 evidence add 禁止占用保留命名。写入与读取校验 trial、源码、镜像、用途和文件哈希。零字节日志只在 manifest 留 captured-empty/length=0/SHA256(empty)，不伪造占位内容；missing、not-started、capture-failed 分开。
finally 尽力封存失败、中断与 invalid 的已有日志。宿主 SIGKILL 无法保证即时封存，开始回执留工作目录与缺失状态；恢复只追加 recovery bundle，原始封存不替换。后来的探针不能填成旧日志。

P010 的实质活动只管经济证据，不增加频率、样本量、收益门槛。故障父源码可以派生修复，父版本与经济比较控制分开；不能把经济可用性接成版本资格。
预检会产生同源码 trial，登记只承认启动前已固定 source-precheck 用途且身份匹配的预检；不豁免任意 exploration，防止事后把已见经济回放改称工程预检。
