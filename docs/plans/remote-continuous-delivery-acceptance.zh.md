# 自动发布生产验收

2026-11-07（Asia/Tokyo），对应 UTC 2026-11-06。用户明确授权 main 检查和构建通过后自动上线、
健康检查、切流与失败回滚，并要求不打断运行中的 Paper。
实现 [#2227](https://github.com/qOeOp/trade/pull/2227)，首次接入权限修复
[#2228](https://github.com/qOeOp/trade/pull/2228)。架构与操作状态独立审阅见
[设计记录](remote-continuous-delivery.zh.md)。

## 已完成的接入验证

- PR 的完整质量、前端、文档、双架构镜像和原生部署测试通过后合并；main 再独立运行检查和构建。
- CI 将测试后的原生 digest 与 main revision 追加到 `deploy-ready` 分支；目标机匿名 Git 拉取成功，
  不依赖匿名 Actions API（目标机该接口返回 504），没有新增部署密钥或 GitHub token。
- 第一次候选去掉全部 capabilities 后无法读取既有服务 UID 的 0600 reader 配置，健康检查拒绝
  切流。恢复程序验证旧路由并停止候选；保留其容器为
  `trade-release-retained-web-535c0733-26a275939e39`，没有删除镜像、研究数据或运行数据。
- 修复保留旧 IDE 默认的 `DAC_OVERRIDE`，其余 capabilities 移除；账户文件与权限未修改。
  双架构和目标机的不同 UID、0600 隔离 fixture 验证可读，写入仍为 EROFS。
- 再次接入完成稳定镜像 `535c0733b356077e89206e47bc8ddfdcda622f1a` 的预热、独立 Agent 单写者
  交接、内部切流与 90 秒观察。首次拆分有短暂网页重连；Paper 不受生命周期管理。
- `trade-release.timer` 已 enabled；2026-11-06 16:24:10 UTC 自动触发首次 `tick`，从 CI channel
  自动选择 `6c161981a78a9f6e8974b4b43b7178945e34b499`，开始拉取
  `ghcr.io/qoeop/trade-ide@sha256:7b06efe3e47fbc1652b330e56ff231b823cd34a57ea8d3c709c7406f74413b73`。
  此步骤没有手工指定目标版本或手工启动发布服务。

## 自动切流最终结果

定时器已自动完成候选预热、原子切流、90 秒观察与事务提交。最终核对：

- 运行中的 Web 和唯一 Agent 均为 `6c161981a78a9f6e8974b4b43b7178945e34b499`；Web 的
  `Config.Image` 与上述 CI 原生 digest 完全一致。Caddy 内存配置和 `router/active.json`
  均指向新 Web，`transaction.json` 不存在。
- `trade-release.service` 为 `Result=success`、`ExecMainStatus=0`；timer 保持 enabled。
- 活动研究线 `research-line-20261104-price-action-breakout-retest-15m` 的图表返回就绪；
  Paper/overview/Agent health 与 Agent 配置列表探测通过。公网匿名 Paper 和 Agent API 仍为 401。
- 原始五个容器的 ID、StartedAt、Running、OOMKilled、RestartCount 与发布前逐项完全相同。
  下表保留短 ID 与完整启动时间；五个容器均 running、OOM=false、RestartCount=0。

| 容器 | ID 前缀 | StartedAt（UTC） |
|---|---|---|
| trade-ide-paper-1 | 031adafd6d59 | 2026-11-06T10:15:43.534533287Z |
| trade-ide-ledger-1 | 8b4beee8c878 | 2026-11-06T10:15:29.306419357Z |
| trade-ide-docker-api-1 | 0913edb6de83 | 2026-11-06T09:25:58.485314512Z |
| trade-paper-2e3129d37c9c-3-runner | 67b761f71762 | 2026-11-06T13:50:51.503569905Z |
| trade-paper-2e3129d37c9c-3-egress | 41313a894fe9 | 2026-11-06T13:50:47.912039914Z |

Paper #3 仍为 running；`last_bar_ns` 从 `1793980199999000000` 推进到
`1793982899999000000`。发布器自己的切流后观察也要求既有运行的行情继续前进。
旧 Web `535c0733...` 继续热保留，旧 Agent 停止并保留；没有剪除容器镜像或业务数据。
首次失败的 `failed/535c0733...` 历史标记保留，未通过清除审计状态来重试自动发布；
稳定镜像的重新接入是验证回滚后人工修复安装，失败候选已改名保留。

主机已安装的控制器源码 SHA-256 与 main 逐项匹配：
`release.py=066048056681b4892662afd643b69dbe55bd7d62697c92686ae5c742c7d2a83d`，
`release_host.py=9cae13321439479373f1e151dff11c3f5a8110da73f4c0947e5cd2e93d721ed7`。
工程核对结果在本机 `/tmp/trade-release-production-final.json`；主机服务日志通过
`journalctl -u trade-release.service` 查看。临时核对文件不是研究记录，也不是复现策略的输入。


## 回滚证据与边界

固定版本原生 Caddy 的隔离测试实际验证旧 SSE 保持、新请求切到新路由、健康失败恢复旧路由、
无效配置 reload 留在旧路由，以及独立 Paper 心跳持续。17 项控制器测试覆盖切流前后失败、
进程中断恢复、磁盘提交窗口、资格撤回、未知独立路由/Agent 变化和行情进度停滞。
7 项 CI 准入测试覆盖触发 SHA、迟到检查、失败重跑、部分重跑、精确 digest 和并发追加。
生产环境实际验证了首次健康拒绝、旧路由恢复及失败候选保留；未人为注入生产切流后故障。

Web/Agent 由此流水线发布；Paper 控制器、账本及正在运行的策略镜像不随网页发布重建。
协议或存储的破坏性变更仍需兼容升级；本记录不声称单机灾难容错或任意负载下的无中断。
首次使用 nonce 续期客户端需要刷新已打开的旧页面；新客户端只对确定未转发的同源拒绝重试一次。
已安装的主机控制代码需审阅后单独更新，不从 main 执行任意主机脚本。
