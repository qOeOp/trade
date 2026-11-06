# Paper 自动发布生产验收

2026-11-07（Asia/Tokyo），服务日志为 2026-11-06 UTC。
用户明确要求 Paper 执行面的升级自动化：已有策略沿用原版本，新启动使用新版本，发版不能
打断已有 Paper。实现 [#2231](https://github.com/qOeOp/trade/pull/2231)，并发首次准入修复
[#2234](https://github.com/qOeOp/trade/pull/2234)；架构与字段审阅见
[设计记录](paper-continuous-delivery.zh.md)。

## 发布前与 CI

生产旧 Paper controller 为 service digest `a9e98e37d6d7ff8870e3efe4ced8c6bfc0bb8b6a655af759533cb50ef13e84d6`，
源码 revision `f217f838abf1d8c2137d0e777e454ce4e6a9879d`，UID/GID 1000:1000。
已实际读取其锁函数，确认声明与 Docker 启动整体使用同名 Dolt lifecycle advisory lock。
Paper #3 的 runner/egress 固定为 runtime
`sha256:8948075d6cfe47231ae39cc4ce945ed24239e65bc21ec3f993f6b1f7bee25268`。

两项 PR 的检查通过后合并；main 独立检查、原生镜像与 runtime 的来源检查通过后才准入。
生产首次 V2 准入期间出现连续 main：较新 service-only 提交写入 withheld，较旧 runtime
来源的 callback 被单调性挡住。修复验证祖先来源的全部最新工作流/第三方检查及精确原生产物后，
自动回填缺省 runtime；不解析 mutable tag，也没有手工指定上线版本或触发部署服务。

GitHub channel 的实际准入：

- revision：`e60fbfc0f292dc82b1d550acf4a928c6c77e205e`。
- IDE：`ghcr.io/qoeop/trade-ide@sha256:b89799f5817d56dad34d589ce864851c949d0c8aa591b8210d169668ffdbe629`。
- service：`ghcr.io/qoeop/trade-service@sha256:387cac06d61c95404a7f017947b60dbb742ff6a1e2729c51b8addd5bf050e718`。
- runtime：`ghcr.io/qoeop/trade-runtime@sha256:51ed9424a10e93c31dd798d35feef8cc1a541f0824b80d6f5f06e87518d10971`，
  来源为已检查的祖先 `a038ebf302249cd6c1d37e8df8eb183d397ed874`。

主机先只建立指向旧控制器的内部 Paper router；未重建原控制器、账本、Docker proxy 或策略。
定时器于 17:48:06 UTC 自动触发发布，17:48:39 开始准备 Web 候选，先将 Web 上游迁至
稳定 Paper router，再进入控制器升级；原运行继续使用旧镜像。

## 最终生产结果

服务日志确认：17:58:26 UTC Web 完成提交；17:58:33 准备 Paper，18:00:35 完成 Paper
切流、观察与提交（日本时间 2026-11-07 03:00:35）。整轮自动发布 12 分 28 秒，
`trade-release.service` 为 `Result=success`、`ExecMainStatus=0`，timer 保持 enabled。

- 新控制器为 `trade-release-paper-e60fbfc0f292dc82b1d550acf4a928c6c77e205e`，
  CID 前缀 `f5fc698ad64c`；实际 service digest 与 CI 准入完全一致。
- 控制器不可变 Docker 启动参数及 `/api/paper/health` 的 runtime 均为上述 `51ed9424...`，
  active=true。新 start 从这个固定默认值启动，观察期 start 暂缓已解除。
- Paper 的 Caddy 内存/磁盘路由均为新控制器完整未冻结配置；Web 的内存/磁盘路由也匹配
  准入版本。两个发布事务文件均不存在，Paper failed 标记为空。
- 新控制器实际通过现有旧 runtime、checkpoint 身份/格式和 journal 兼容检查；经公网入口
  的图表、Paper/overview/Agent health 检查通过，匿名 Paper/Agent API 仍为 401。
- 旧控制器已停止并保留，旧 service/runtime 镜像没有剪除。

原有策略及共享执行依赖与安装前逐项对比：

| 容器 | ID 前缀 | StartedAt（UTC） |
|---|---|---|
| trade-ide-ledger-1 | 8b4beee8c878 | 2026-11-06T10:15:29.306419357Z |
| trade-ide-docker-api-1 | 0913edb6de83 | 2026-11-06T09:25:58.485314512Z |
| trade-paper-2e3129d37c9c-3-runner | 67b761f71762 | 2026-11-06T13:50:51.503569905Z |
| trade-paper-2e3129d37c9c-3-egress | 41313a894fe9 | 2026-11-06T13:50:47.912039914Z |

上述四个容器的完整 ID、StartedAt、Running、OOMKilled 和 RestartCount 与发布前完全一致，
均 running、OOM=false、RestartCount=0。Paper #3 的 runner 和 egress 的实际 Config.Image
仍是 `8948075d...`，执行记录的 image_ref 也完全相同。

Paper #3 始终 running；行情 bars 从 236 增至 251，
`last_bar_ns` 从 `1793987159999000000` 前进到
`1793988059999000000`；missing_bars、late_bars、exceptions
前后均为 0。原有三个 run ID 保持不变，没有为了验收新建生产策略。

主机控制代码的四个文件 SHA-256 与已合并实现逐项相同；控制面没有从 main 执行任意脚本。
临时核对结果在本机 `/tmp/trade-paper-production-final.json`，服务日志使用
`journalctl -u trade-release.service` 查看；临时文件不是策略研究记录。


## 检查与范围

隔离原生 Caddy 检查覆盖热切流、SSE、失败 reload/回退、暂停全部 POST/仅暂停 start、
旧控制器要求的 Host 保留。真实隔离 Dolt 的跨进程测试验证屏障等待在途操作，并在 PIPE EOF
释放锁；状态测试覆盖崩溃、回滚、未知独立路由与未提交候选被独立 unfreeze 的保护。
初始执行面 suite 8 项状态测试、17 项既有 Web 状态测试及 16 项组合 native 测试通过；
后续 CI publisher 的 11 项 Node 准入回归通过。完整 CI 使用固定 Dolt 2.4.2。

工程核对未在生产创建额外 Paper trade，未修改既有 run 的 source、image_ref、checkpoint
或账户，也未迁移活动 ledger/market；临时工程证据只在 `/tmp`。
生产最终核对与隔离故障注入区分记录，未人为制造生产策略故障。
接口交接时 API/SSE 可能短暂重连；观察期暂缓新 start，已有策略仍执行，stop/resume 可用。
不兼容候选留在旧版本；存储或 native 格式迁移需单独兼容处理，不能转换既有账户充当升级。
