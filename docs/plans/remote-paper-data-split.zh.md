# 研究展示与远程Paper的数据路径分离

2026-11-06。用户明确授权实施本地研究、DoltHub发布、云端只读展示与独立Paper执行，并要求IDE有同步按钮；亚洲4核8GB只评估不购买，Live后接。不迁移活动账本/市场目录、已有Paper运行或DNS。

## 实现边界

一个云端Dolt服务承载两个数据库，避免为小主机再增加第二套数据库进程：

- research是公开DoltHub研究账本的本地只读镜像。研究写入、回测、Agent和批量历史行情处理仍在本地。IDE通过现有reader SQL/CLI查询该镜像，页面请求继续固定到完整commit；不是每个图表请求直接调用DoltHub SQL API。
- paper从空库开始，沿用既有Dolt schema、paper_run、evidence和原生运行目录。只保存本执行端的声明、封存及固定源码输入，不从研究副本承接旧Paper运行；没有新订单、结算或账户引擎。
- ledger mirror从空目录创建这条布局。普通ledger service run仍要求原有DoltHub密钥，原有活动研究账本的规则不变。镜像模式不安装发布密钥，也拒绝接管带research writer的已有服务。
- Paper start/serve的--research-ledger指定固定研究读取源。新start先固定research commit并校验输入，在既有运行限制和market检查后复制所选源及必要父行，再声明执行；重试先查执行库原op_id，resume/stop/日志/封存只依赖执行原件。研究sync不替换正在运行的源码、镜像或账户。

Paper库使用现有isolated生命周期，禁止将其发布到DoltHub研究origin；它没有origin。持久执行目录与备份仍必须保留，isolated不是清理授权。IDE只挂载reader账户。当前Paper CLI的封存删除及发布状态查询仍需要service管理员，因此Paper控制器保留既有管理员权限，但不挂DoltHub key。这不是针对被攻破控制器的数据库隔离；其现有Docker socket代理也是特权边界。不能宣称research缺少writer就能抵挡持有root的控制器。

## 同步协议与按钮

认证后的IDE通过同源/api/research/sync访问内部镜像控制器：GET读状态，POST无请求体，使用现有页面token与same-origin检查。HTTP不能指定URL、branch、路径或数据库。云端只开放原有HTTPS入口，不开放Dolt、同步服务或Docker端口。

后台只调用CLI ledger sync；固定读取research中已有origin。advisory lock串行化所有CLI同步；fetch到remote refs后先在不可变目标commit核对schema、产品原生测试定义并运行测试，然后仅允许fast-forward main。不reset、不force、不修改Paper库。失败仍展示旧commit和错误；成功由IDE原有head/SSE机制刷新研究视图，固定历史页面不跳转到新head。GUI显示Sync DoltHub、同步中、已是最新、更新成功和可重试错误；登录过期提示重新登录，Paper不因浏览器状态而停止。

## 独立存储评审与决定

按AGENTS.md要求，recovery_storage_review独立检查了消费者、现有关系和派生能力：source bytes/hash、entry_class/runtime_contract、image_ref、symbols、market_commit及config已经表达运行输入，不需要新增source_commit列；同步中的状态可用内存表示，显示版本由Dolt main派生，不新增持久sync_status/last_success_at。若未来要求跨重启记录每次无变化的检查时间，再单独评审该新观察。

评审指出，复用publish_candidate做保真复制会把runtime_contract改为当前值，并按MAX(revision)+1重新编号；为凑编号复制整个版本前缀又带入没有执行消费者的源码。因此实现专门的Paper输入捕获，沿用既有candidate字段，保留精确ID@revision、源码、原runtime_contract与必要父关系，不复制无关中间版本。created_at是执行端捕获时间、op_id是该捕获操作，不冒充研究端原始发布行。来源权威仍是DoltHub研究版本；执行输入副本是让长期执行、恢复和后续本地对账不依赖研究同步在线所需的最小身份。

没有新增SQL表或字段。研究/执行profile的绑定只在部署配置声明；origin复用数据库现有remote，不再保存一个重复URL。工程验证只用隔离账本，策略源码与验收原件留/tmp，不入Git。

## 8GB评估与部署

remote overlay关闭云端研究聊天Agent和默认全量market-import，不修改本地一体化Compose。云端仍需要按现有CLI准备有效的最小执行market cache（至少当月membership；研究图表所需历史日线按需准备），不是从研究账本伪造membership或复制整个81GiB本地缓存。缺少数据时保留现有拒绝，不自动换池或放宽对账。

2GB ledger cap只是新布局的评估预算，不是峰值测量结果。4核8GB先验证1–4个低频Paper与24–72小时运行；当前4条上限不变，不承诺6–20条或Live容量。当前CI镜像只有ARM64，亚洲x86主机仍需独立构建和成对原生验证后才能选用。未购买服务器、未做现有生产迁移。

## 已运行的验证

- 本地完整Python回归854项通过（5项需单独认证二进制的探针跳过）；最后的固定research snapshot传递和后台CLI串行验证后，44项聚焦测试通过。Ruff、mypy通过；前端85项测试、TypeScript/结构规则及生产build通过。
- 固定Dolt 2.4.2隔离验证：公开形态的无key初始化、reader权限、快进/no-op同步、旧commit读取、无效目标与分叉保留旧head、断网错误、精确源码/必要父链捕获、真实后台CLI单次同步；同源HTTP拒绝错误token、跨站和调用方指定target。
- 实际CLI+隔离本地发布源+research镜像+paper执行库+HTTP+固定Nautilus runtime验收：运行中同步研究新版本后原源码未变；重复start、真实SIGTERM后同run恢复（1 started/1 resumed且原journal前缀保留）、stop封存、封存日志和再次重试不新建账户均通过。验收处于日线预热等待阶段，不声称验证了任意活跃持仓或任意崩溃恢复。工作副本/tmp/trade-remote-split-flow-final/result.json。
- 公开DoltHub SQL接口匿名只读访问成功，读取了研究HEAD与候选数量；这不是对云端完整克隆或资源上限的压测。
- 隔离浏览器深色1440×1000及浅色1200×900（DPR1.5）复查同步按钮、成功/错误状态和重试，已有研究视图保留，相关交互未观察到JS异常；生产数据只作展示夹具，按钮不操作生产。
- dummy Compose解析验证公网仅80/443、无研究发布key挂载、镜像控制器与独立Paper路由，shell语法与diff检查通过。未在新亚洲主机做公网OAuth/证书或8GB容量验收。
