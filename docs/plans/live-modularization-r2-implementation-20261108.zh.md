# R2：Live runtime 职责提取

2026-11-08，独立 main 基线7b66fea79。保持rc7、v7、现有拒绝与验收协议。本PR不堆叠R1；共同构造暂时仍调用主线 `engine.run` 的现有owner。R1合并后应将三个消费模块转向 `engine.strategy`，同步迁移故障路径全局owner，不能只复制变量。

## 所有权与依赖

- `engine.live` 保留进程信号屏蔽（必须在导入原生网络模块前）、manifest、execute/finally、持久缓存和最终账户读取边界；`python -m engine.live`不变。
- `live_runtime.commands` 拥有现有异步账户观察、唯一pending intent和准入函数。原Session八个命令方法提取为显式Session参数；线程仅返回snapshot，原生线程最后复核、先清引用再submit、失败停止顺序不变。没有自造订单、成交或取消回报。
- `session` 保留运行内状态、日志、STOP/断线、保护/亏损与原生cache读取。现主线断线/observer failure会取消未减仓入场的既有行为原样保留，包括未知结果的原重发策略；未按较早设计文字移除。
- `source` 保留原生配置分配、受限命令覆盖、回调和Clock封装；订单动作仍调用原生Strategy。
- `lifecycle` 持有原Observer与source_outcome；`node` 只组装原生Binance/LiveNode配置；`records` 是既有私有原件写入与策略ID函数的唯一owner。

模块只显式传现Session及原生对象；commands对Session仅类型引用，无运行时循环依赖、DI容器、第二套订单状态或调度器。Session保留原字段，不新增持久事实。Observer/LiveClock/_LiveConfigured保留 `engine.live` 类导入身份，入口兼容导出同一对象；测试patch改为真实owner，没有双写副本。

Dockerfile显式COPY新子包；既有runtime输入fingerprint已递归覆盖engine Python文件，未修改该准入判据。未创建空责任层或GenericRunner。

## 验证与限制

固定基线AST比较55个函数/方法，正规化命令owner与显式Session参数后全部相同。130项原生Live、entry、connection、cache、venue回归通过，Mypy128文件和Ruff通过。第一次测试漏迁移6个回调引用，已修正为partial显式参数；旧断言与失败日志保留。完整标准测试1450项通过、9项按环境跳过（r2-full-tests-3.log）。首轮全测发现另一个构造测试仍patch旧read_universe owner，迁移时又出现组合import拼接错误；9项构造测试已单独通过，最终完整回归通过，原两次失败日志保留。所有修正仅迁移测试引用，未改断言。

仍须独立审查和固定CI镜像四场景原生联合实验，不能以本机绿测宣称runtime parity。上述native回归只使用合成数据/本地fixture，不连接交易所、读取真实凭据或部署。四场景实验需先完成镜像、身份绑定和执行方案；旧GTD失败保持原结论。
