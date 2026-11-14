# Live 安装级账户占用范围

> 2026-11-14 起被取代（doctor 20261114-20，用户批准）：每次发布都在每台主机配对 Live 控制，托管根固定为 `/var/lib/trade-release/live-root`，由产品首次配对时连同 `account.lock` 一起创建；操作员声明 `live/configuration.json` 与只由主机操作员声明可交易候选的边界都已删除，候选、合约与杠杆在 Live 页按次选择。下文关于安装声明的部分只作历史记录。

2026-11-07。用户已明确授权本次跨目录拒绝检查的产品代码及离线测试；不包含服务器安装、凭据读取、真实连接、真实订单或接管其他会话的运行。

## 问题与选择

原 CLI 接受任意 `--root`。每个目录都有自己的 `account.lock`、`account.jsonl` 和请求记录；网页和发布器只检查配置中的目录。因此同一账户的两次执行可以分别取得两个目录的占用，网页和发布器还会把自己的目录判为空闲。API key 的哈希是凭据绑定，不能充当账户 ID：同一账户可能使用不同 key。

选择复用已有安装声明 `/var/lib/trade-release/live/configuration.json` 的 `root`，所有当前支持的新效果必须使用它。CLI 的 `--root` 成为一致性断言，不再是创建另一个账户空间的入口。新连接命令还必须断言实际已选服务版本的 `--release-web`；宿主 recipe 先通过已有 `deploy.images` 校验 CI/OCI provenance，再固定该版本与镜像，不能从当前路由反推调用者身份。缺少声明或只读挂载不会退回 standalone。原 `account.lock`、原持久占用及请求记录仍负责串行化与崩溃后的未决状态；没有新账户账本、订单状态、策略语言或调度器。

独立方案复审确认此边界足够修复当前单账户安装，不需要 Nautilus 补丁。Nautilus 继续拥有订单、成交、持仓和原生缓存；应用这里只约束哪个受支持的进程可取得执行占用。这个保证不约束拥有主机/Docker 权限的人运行旧镜像、直接执行 native entrypoint、复制 key 或从另一主机连接。

## 新效果与历史访问

`live.authority` 从固定安装目录读取已有声明、完整 release snapshot 和提交路由。它不接受环境变量或新的路径参数。初次检查在读取凭据、准备运行之前；同一次 CLI 调用把首次捕获的同一个 Authority 传给准备、源码确认和启动；真正效果在原账户锁内再次检查声明、snapshot、当前 release 与捕获的目录、锁各自的 device/inode。选定 A 镜像后 B 才提交、以及 A 命令执行中切到 B，都拒绝 A 的后续新效果，不重新把 A 标记为 B。新准备、预检、启动、对账、凭据变更及会改状态的请求恢复都走此入口。发布器检查相同声明，持有原 inode 直到元数据切换完成。锁顺序仍为发布锁 → 账户锁；没有改变既有发布等待、超时或失败策略。

历史查询、已确定请求结果和 STOP 使用原本可信的 snapshot/root/run，不要求该 snapshot 仍是当前写入者。`serve.command → live web-command` 子进程也执行这个区分；保留旧 listener 本身并不足以保证 STOP 可用。STOP 不会把旧 run ID 映射到新目录，也不能被用来放行 reconcile、maintenance 或未知请求恢复。CLI `status` 和 `logs` 只读；当前负责的控制服务才做本地归档、回收和占用释放。

本修复统一的是 `run` / native `reconcile` 的持久执行占用，不承诺互斥每个 REST 请求。原 REST-only preflight 在构造 native node / user stream 前结束，可以保留原有的同目录并行行为。它不取得执行占用，不证明后续启动时仍为空仓；启动继续执行原账户检查。独立复审用离线反例确认了此限制，未发现它提交订单或创建/删除 listenKey。本次不增加同目录预检互斥规则。

## 其他目录的执行证据

新工作与发布检查使用既有 Docker 调用检查全部带 `trade.live.run` 标记的容器。目录由绑定 mount 确认，不依赖容器名称或 key 哈希；原 lifecycle、manifest 和完整原生容器身份验证仍负责证明归属。无法读取外部目录、身份不明确、仍活动或未决的资源都会拒绝新工作。若外部历史可读，只在其原锁的非阻塞共享读取下，复用已有整目录 idle 检查证明闭合；不等待另一个账户锁，不采用或移除外部资源。

控制服务不会新增任意私有目录挂载，也不会创建临时 helper 去读取发现的路径。原始历史被保留。Docker 发现不了容器已消失的未知历史目录，所以安装切换前必须另外核对所有已知旧目录。已有其他会话运行须由原负责人正常收尾及回收，再进行单独授权的切换；不能仅以当前网页目录空闲认定整台主机已无未决执行。

旧目录的只读访问与 STOP 保留。旧目录 native reconcile 是新连接，不能作为例外绕过当前权威；若将来需要，必须另行设计并授权独占安装切换，在原目录、缓存和凭据绑定上恢复。本修复不提供或宣称已验证该安装操作，也不搬迁旧记录。

## 存储审查

| 数据 | 消费者与决定 |
| --- | --- |
| 已有安装声明 root | 这是操作员已声明的安装范围；CLI、控制服务和发布器共同消费，不复制到每个运行。 |
| 已有 release snapshot / router / transaction | 导出当前新效果或 maintenance 的归属，不新建 active-root 指针。 |
| 已有 account / request / lifecycle 记录 | 继续表达持久执行占用、请求身份及未决阶段；不建立第二份状态。 |
| 临时 Authority 对象及 Docker 清单 | 单次调用的验证结果及目录、锁各自的 device/inode，只有内存值；不是新增持久字段。 |
| 旧目录清单、真实账户 UID、跨目录 owner | 本次不新增。任意旧目录在线恢复若需要新的持久事实，须独立重新审查。 |

此选择经过独立源码与设计复审；原有字段、关系和原生身份足以表达当前边界。没有新增 manifest、凭据、请求或账户日志字段。

## 打包与验证边界

stdlib-only 声明/snapshot parser 在 `deploy.live_configuration`，宿主与 Live 使用同一实现。`deploy` 现纳入 wheel；Live 只导入声明契约，宿主执行模块没有导入时效果。服务镜像的 Dockerfile 专属 ignore 文件显式纳入 `deploy/*.py`，所以经过真实构建上下文筛选的 `COPY .` 仍能构建 wheel；宿主两个模块安装清单和 CI 路径也包含新模块。验证必须从筛选后的上下文构建并安装，而非仅从完整源码构建 wheel。宿主必须按新的完整模块集准备后再发布，不能只更新服务镜像。

`pyproject.toml` 是 runtime 构建输入。即使 engine 与 Native 依赖版本未变，后续也必须等待新 CI 配对 runtime，不能沿用输入不匹配的旧摘要。本次离线宿主测试不声明 Native 行为 parity；配对原生验收与实际部署是后续工作。

目录身份的回归通过实际 CLI：源码确认后重命名原目录，在原路径创建新目录并移动原锁；保留原未决 owner，必须在新 reserve、凭据读取或启动之前拒绝。这个捕获期检查不宣称识别捕获前已完成的重装，也没有为此新增持久身份。

CI 的父进程在暴露 `/validation` 前预导入 `deploy` 与 `deploy.live_configuration`；子进程保留 `PYTHONSAFEPATH`，即使 cwd 为 `/validation` 也要求 CLI、Live、deploy 与共享 parser 来自镜像 `/opt/trade`，不再用临时 symlink 引用测试挂载的 deploy。runtime 镜像仍只要求其原有 engine 包。

验证包含缺声明/缺挂载、任意 root/config、声明和 inode 竞态、旧 snapshot 子进程 STOP、原请求重复读取、跨 root 相同 run ID 与凭据绑定、未决与不可读取外部历史、旧日志纯读取、整目录 closed 证据及原维护规则。全部使用临时私有目录、假凭据、模拟 Docker/venue；不接触活动账本或真实账户。
