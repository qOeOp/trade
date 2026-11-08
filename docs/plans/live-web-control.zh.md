# Web IDE Live 控制入口

页面是 operator 的操作入口：配置凭据、准备并审阅固定源码、检查账户、明确启动、请求停止、查看原生结果与必要对账。SSH 不属于日常操作流程。

本设计沿用现有 `live` CLI 与 Nautilus；不新建订单/账户账本、策略调度器、交易语言或自动恢复交易工作流。网页只显示已经观察到的事实。首版仍是一个可信 operator、一个固定 custody root、串行运行；多策略并发和连续多次入场需要独立后端设计。

## 调用与私有边界

公网登录代理 → IDE 同源代理 → 私有 Unix socket → Live control → 固定 CLI 命令 → 原 Live 生命周期 → Nautilus。

Live control 不监听 TCP。只有 Web 和 Live control 挂载 socket 目录，Web 挂载只读；凭据目录不挂 Web、Agent 或 Paper。control 保持该 custody 的原 operator UID，不能为了 socket 变更历史目录所有者或 runner 身份。

UDS 只保护最后一跳，不能独自阻止其他后台容器借 Web 代理访问。`/api/live` 的全部请求还要验证实际 TCP peer 为固定部署的 `ide-router`：该 router 仅在隔离 frontend 网络且不发布端口，其他后台容器不接入此网络。地址经受信 Docker DNS 解析，解析失败或空集不转发，不无限保留旧 IP。不信任 X-Forwarded-For、Host 或用户名头作为代理身份；原 same-origin/nonce 检查继续承担 CSRF 防护。

这依赖可信宿主、Docker 网络与命名配置，不防御宿主管理员。持续发布部署的 Agent 与 Web 是独立容器；本地默认 entrypoint 可以共进程，不能把工具只读声明当作 OS 隔离。单 operator 是部署前提，不能擅自把所有 IDE 登录者扩成 Live operator。

控制服务仅接受固定 source ID、合规 run ID、有限 JSON 配置、凭据版本引用和原 source SHA 确认。不接受客户端文件路径、entry class、镜像字符串、argv、环境变量或手工通过检查标志。写操作调用固定 `python -m cli.main live ...` 参数，不经 shell。

## 命令与恢复

每次明确操作有 request ID。唯一权威是私有 `requests/<id>.jsonl` 的非秘密 canonical 声明；没有第二份任务状态表或通用队列。

在既有 root 锁内先声明请求，再产生该次效果。`launch_requested` 保持原 runner Docker 调用前的位置，仅增加必要 request 关联，不能前移到网络创建前：现有 never-armed 判断要求每个 launch 都有可核验退出容器，前移会让网络失败变成无法收敛的虚假启动尝试。

重复请求只查回原效果；同 ID 不同内容拒绝。未知结果不自动重派发，也不能换 ID 或通过不带 ID 的 legacy CLI 绕过冲突检查。此检查只覆盖会重复/混淆效果的准备、预检、启动、对账和凭据变更；既有 STOP 意图、纯读和宿主维护仍可用。

崩溃后重新取得同一锁，且完整证据证明该请求没有进入 runner 调用边界时，可以记录本次 runner 未派发；这不代表 key 查询、网络或账户占用未发生，已有资源仍走原核实收尾。有 launch 关联但容器缺失/身份未知时继续 unresolved，不改变原释放条件。

凭据上传是特殊的不可重放 body：声明后重复 POST 只查原非秘密结果，不再次保存/选择，不比较已删除的 secret，不持久保存 secret 摘要。响应丢失后客户端清空秘密并 GET 查回。

prepare 固定研究 commit、源码、runtime、universe、配置和凭据版本。部分文件只有在固定输入完整可证且缺项确实未写时才能补齐；已有不一致字节不覆盖。后续查询沿首次 prepared/request 关联获取 exact research_at，不能改用最新研究登记。

启动复用现有 `--confirm-real-orders` 的实际 source SHA，服务端不补填确认，不新建 approved 状态。主线 key/clock/account/source 检查保留；preflight 成功不免除启动复核，也不新增“预检必须先通过”的门槛。

## 凭据生命周期

凭据是独立私有目录的不可变版本，使用原私有文件规则与原子持久化；这是文件权限保护，不是加密 vault。页面只收一次秘密，响应/日志/URL/browser storage 不保存它，GET 不读 key 来制作掩码。

新版本选择与启动在同一 root 锁域串行。活动/身份未知 runner（包括 preflight）、未解决 run 或冲突请求存在时，不能轮换/移除相关版本。新 preflight/start 使用 prepared 版本且必须仍为当前选择；换版本后重新准备。历史 reconcile 使用原版本，不能猜测不同 key 属于同一账户。

移除只删除本地秘密，不在交易所撤销 key，也不表示停止连接。已结束记录保留非秘密引用。旧 CLI 记录没有 credential_ref 时不补猜、不迁移已挂载路径，保持原恢复路径；旧 unresolved 未解决前不启用新的受管账户写操作。

## 独立存储评审决定

新增字段在实现前经独立 agent 两轮评审，第二轮按原 `launch`/`prepare`/恢复源码核对。以下是最小消费者与独立事实；均属于私有执行控制或静态部署声明，不进入研究 ledger、DoltHub 或执行记录的 Git 副本。

| 事实 | 消费者及不可推导的原因 | 位置与裁决 |
|---|---|---|
| credential_ref、saved 事件 | 版本路径与设置页；key binding 不能确定秘密文件版本 | 私有凭据 journal，接受。时间只用事件 envelope |
| selected(ref)、removed(ref) | 以后准备与移除恢复；mtime/文件缺失不能证明用户选择或合法移除 | 同一 journal，接受。不存 current/unselected/verified |
| prepared.credential_ref | 首次 launch 前的版本绑定、历史对账及引用分析 | 原 prepared 事件，接受。不增加第二份 manifest |
| request_id、canonical 非秘密命令 | 效果发生前的独立用户意图；run ID 不能区分多次预检/对账 | 单一请求记录，接受。不再存 fingerprint 或 processing 列 |
| 首次 prepare 的 exact research_at | 同次审阅与重试的研究快照；同候选 revision 可有不同登记集合，现 manifest 无该 commit | 首次 request 一次存储，接受。review 列表派生 |
| prepared / launch_requested 的 request_id | 原效果与意图的准确归属，不能按时间猜测 | 两个必要锚点，接受。保留原事件位置，其余事件沿原关系追溯 |
| 无对应效果的拒绝/中断 code | 请求未执行/被拒也可能没有其他效果事件 | 按需接受。成功关联可由锚点推导，不再存反向成功副本 |
| 路由对象的 Caddy `@id`（`live-<revision>`） | 准入、退役、恢复所需的 owner control；只换 Web 的发布之后 owner 不再等于 Web 版本，不能从路由名推导 | `router/active.json` 与路由一次原子写入，接受。owner 等于 Web 版本时不写（见 [只换 Web 的发布](live-web-only-release.zh.md)） |
| 事务的 `candidate_owner`、`previous_owner` | 恢复与准入区分只换 Web 的事务和从非同版本 owner 出发的成对事务；candidate/previous 名字不含 owner | 原 `transaction.json`，接受。只在需要时写入 |
| 静态 source ID → origin/hash/class/purpose | 管理员允许暴露哪些执行入口及用途，不能从文件存在或研究登记推导 | 部署目录接受。不建 source registry/approved/verified 状态 |
| 静态 source 的 single_order_source_reviewed | 原 prepare/source_for_run 与冻结输入比对；operator 是否审阅 exact SHA/class 的单订单生命周期，不能从允许列出、用途或文件 hash 推导 | 独立代码评审确认必要：必须显式 boolean，无默认 true；首次请求冻结此意图，复用原 manifest.config 同名字段，不增加通过状态表 |
| 尚未 claimed 的 request ID 永久关闭 | 网页显式恢复与迟到 dispatch 防重；一次“未找到”只是当前观察，无法表达此 ID 以后也不得接受 | 独立评审接受最小 `{event: closed_unclaimed, observed_ns}`，只在原 root 锁内、该请求路径确实不存在时 O_EXCL 写入并 fsync。请求 ID 由路径确定；code、unknown action 与空 target 均派生，不重复存储 |

请求中的固定输入表达首次意图，原 manifest 表达实际落地；成功后不把 request 当第二份可更新 manifest。自然信号与受控执行用途明确区分，原研究登记不会验证改写副本。

源码目录成员身份不是审阅声明。控制层只传递该条目中显式的 `single_order_source_reviewed`，false 保留原生 `LIVE_SOURCE_REVIEW` 拒绝；该位随首次准备固定，重试、预检和本地恢复不能使用更新后的目录替代。它也不是启动许可，原实际 source SHA 确认仍由用户明确提交。

显式恢复一个尚未被控制层接受的请求 ID 会永久关闭该 ID，即使原 HTTP 处理还在锁外验证、稍后才到 dispatch，也不能再接受。关闭只证明 ID 在 durable claim 前已被关闭，不证明 HTTP 从未到达。已 claimed 的请求继续依据原效果恢复，尤其不能将未知 launch 改写为关闭；损坏、非普通文件或不完整尾行都不是“未找到”。GET 不创建关闭记录，重复恢复/POST 不追加或覆盖记录，终态关闭不阻塞其他请求。

## 状态与验证

请求接受、宿主进程、原生连接、订单事件、仓位、停止意图、最终 venue flat、custody release 与资源归档分别显示。STOP 返回不等于已平仓，OrderFilled 事件不自动等于整单全填，无证据不是空仓。

GET 纯读，不能调用有释放/归档/回收副作用的原 status。共享锁只约束宿主 writer，原生 journal 有独立 writer；按来源给水位/观察时间，损坏或尾部不完整标未知。HTTP 只返回审核字段与固定错误文字，不透传 source_reason、native reason、tags、异常、私有路径或原日志。

控制服务观察有限的既有 runner，结束后复用原宿主 status 收尾；启动补查只核对旧记录，不启动策略或连接 venue，不依赖网页打开。维护失败保留显式重试。前端刷新、重登、重连只 GET 查回；不能照搬 Paper 的待确认启动自动重发。

必测：请求内容冲突、未知结果和 legacy 绕过、各 crash 边界、秘密上传重放、并发轮换/启动、活动 preflight 移除、缺失/撤销凭据、损坏 journal、缺容器、纯读无副作用、部分成交显示、非 router peer 伪造 nonce、正常 OAuth/router/UDS 链路。页面需桌面/手机、浅深主题验证，原生组装需匹配当前 CI runtime。

新增拒绝检查按 AGENTS.md 逐项授权后实现；宿主配置在具体差异准备完成后确认。普通纯读与前端呈现可先做。下一次真实运行须等完整页面入口，由用户明确启动；软件测试不能替代真实成交闭环与持续观测。

## 成对发布与独立存储决定

用户随后明确授权 Web/Live control 成对发布的检查与测试；实际主机安装、权限与进程操作仍须按最终差异单独确认。普通 CD 由 `deploy.release_host.DockerHost.create()` 创建 Web，不运行 Compose，因此 socket 目录挂载和 `--live-socket`、`--live-router` 参数必须进入每次创建路径；Agent 不接收这些能力。

独立部署评审接受 `/var/lib/trade-release/live/configuration.json` 作为首次安装的 operator 声明：`format=live-deployment-v1`，仅含已有 root、research reader/commit、universe、symbols、source catalog、defaults、memory。root 是既有私有执行根，不能从 Paper 的 data 目录推导；目录存在、研究记录和镜像也不能表达 operator 选择暴露哪些 source。声明不保存 runtime、socket 或另一个 enabled/active 字段。

每个 revision 的完整 `live-control-v1` 配置是部署缓存：runtime 只取本次已通过原资格检查的 deploy-ready 记录，socket 只从 release state、revision 与固定 suffix 派生。正常更新继承上一次已提交配置的 operator 字段，并要求安装声明语义一致；不一致须显式安装变更，不自动择新或择旧。原 `single_order_source_reviewed` 布尔声明原样继承，不能由文件存在推断。已提交 Web 使用 Live 时，安装声明缺失或损坏不能降级成 Web-only，发布保持原 pair；运行中的 STOP 与纯查询不依赖新的声明解析。

发布复用唯一 `Release.transaction.json`、Web 的 `router/active.json` 和原 `account.lock`。新建的 control 与其 Web 的实际 OCI revision 必须相同；从 owner 版本起只改动 control 不加载的路径时，只换 Web、沿用 owner control，不检查也不锁账户（见 [只换 Web 的发布](live-web-only-release.zh.md)）。runtime 实际 revision 的完整构建输入必须与 service 相同，沿用既有 main、CI 与镜像源/平台/digest 检查。没有第二个 Live 发布状态机、调度器或账户状态表。现有 run 仍使用自己的 source/runtime/原件。

独立并发评审否决了“子进程持账户锁、回复 held、宿主再写事务”的初稿：子进程回复后死亡会释放锁，宿主却可能继续写；增加心跳不能使两步原子。最终由实际写 metadata 的宿主进程以 `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` 打开原 0600 regular account.lock，并持 `flock(LOCK_EX)`，覆盖一次只读 `live release-inspect` 与原 transaction/route/clear 写入。缺失锁不新建，symlink 或 inode 改变不接受。检查子进程不再取锁或写 metadata，宿主死亡时两个锁和 metadata writer 一起终止，遗留 inspector 只读。此设计要求同一本地文件系统 inode；安装时核实 systemd sandbox 中的路径、UID 和本地 flock 语义，不能通过另建锁或放宽 custody 权限绕过。

初次 busy/unknown 只是延后本次发布，不建立失败标记。事务开始时必须 idle；提交前再次在同一原锁内检查。事务中的新增 prepare/preflight/start/reconcile/凭据变更及实际 resolve 修复被暂停，精确 request 查回与 STOP 保留。后台/显式 maintenance 仅由已提交 owner 或合法事务 previous 执行。若途中发现独立 CLI 或未知状态，恢复旧 pair 不要求重新 idle，不终止真实 runner。candidate 未提交时不能开始新 runtime 的运行，旧 control 等锁后也必须重新核对归属。

成功提交后才退任旧 control：核对容器完整 Id 与当前 selector，先取消其自动重启，再仅发送协作 SIGTERM；handler、已接受的 CLI 和当前维护完成前进程与原件保留。没有 20 秒后 SIGKILL、自动删除或持久 draining 字段。Web/Agent/Paper 现有收尾规则不因此扩展到 Live runner。
