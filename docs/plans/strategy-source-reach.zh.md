# 策略源码伸进运行器：加载前静态检查

2026-11-01。用户授权收紧（“你自己决定 按排名高到低一个个开始”）。

## 问题

策略源码和运行器在同一个 Python 进程里执行。`engine.load_strategy` 只核对内容哈希和入口类形态，
文档也写明“不担保任意 Python 的安全”。容器挡住了网络和宿主文件，挡不住进程内的改写和读导出目录。

临时账本里的实测（同一 ETH 窗口、同一策略逻辑，`replay explore`）：

- 源码导入后执行 `engine.run.fee_model = lambda rows: MakerTakerFeeModel(Decimal("0"), Decimal("0"))`：
  162 笔成交，手续费合计 0.0；诚实版本 808.11。审计通过，0 条发现。
- 源码从 `sys.argv` 取 `--market-root`，用 `ParquetDataCatalog` 读整段导出的 1 分钟线，挂单前看后 60 分钟
  有没有触及边界：审计同样通过。

审计只核对各份报告之间是否一致；源码改的是产生报告的对象，报告自洽，审计看不出来。

## 决定

`engine.source_findings` 在执行源码之前静态检查，有发现即拒绝 `SOURCE_REACH`，列出全部发现：

- 导入白名单：计算类标准库（bisect、calendar、collections、dataclasses、datetime、decimal、enum、heapq、
  itertools、math、statistics），加 `nautilus_trader` 的 common、config、core、indicators、model、trading。
  运行器（engine、market）、行情目录（persistence）、撮合与回测（execution、backtest）、文件与进程（os、
  sys、pathlib、glob、subprocess、importlib）都不在内；相对导入、星号导入和裸 `nautilus_trader` 也拒绝。
  typing（get_type_hints 会 eval 字符串注解）、operator（attrgetter 按名字取属性）、functools
  （singledispatch 经 get_type_hints）不在内。
- 允许的模块身上挂着别的模块（`statistics.sys`、`typing.sys`、`import nautilus_trader.model` 绑定的包名上的
  `persistence`）：检查时导入允许的模块，沿属性链解析，取到白名单外的模块就记一条；模块名字只能用来取
  属性，不能改名保存或传参。
- 名字：open、eval、exec、compile、getattr、setattr、delattr、globals、locals、vars、input、breakpoint。
- `__init__`、`__name__` 以外的双下划线名字、属性和 match 类模式关键字；栈帧与代码内省属性
  （f_globals、gi_frame、mro 等）；十进制共享上下文（getcontext、setcontext、DefaultContext：运行器和审计
  都用 Decimal）。
- 单参数 `type(x)` 只能立即取属性、比较、放进 isinstance/issubclass/str/repr 或 f-string，不能保存或
  传出（否则可改运行器包装类的方法）。
- `self` 以外对象的单下划线私有属性（`self.clock._clock` 是守护时钟底下的原生时钟）。
- 一切写入或删除的属性（赋值、for、with、推导式目标都算）：根是导入的名字或不是名字，或属性名是运行器
  包在源码外的东西（引擎基类的 on_ 回调、两个钩子、shutdown_system、clock、cache）。

静态检查管不到引擎公开接口。原生报告在回放结束后从缓存读出，源码在 `on_stop` 里调
`cache.purge_closed_orders` 等就能把自己的成交从报告里抹掉（评审实测：订单、成交、仓位行从 2、2、1 变成
0、0、0）。所以运行器给源码的 `self.cache` 换成只读代理 `ReadOnlyCache`，与守护时钟同一做法：add、
purge_*、reset、dispose、snapshot_position 一调就在该回调里拒绝（`CACHE_WRITE`），运行失败。语料里只用到
instrument、order、orders_open、orders_inflight、positions_open、orders 这些读接口。

两轮独立评审。第一版只有名单，评审用验证过的代码找到五类绕过（`from typing import sys`、包名上取
persistence、match 关键字取 `__globals__`、for/with 目标、局部别名改十进制上下文）；第二轮找到清缓存和
`self.clock._clock`，以及 `self.on_cooldown`、`isinstance(a, type(b))` 两处误拒。都已处理，测试里各有一例。

放在 `engine/load.py`：回放、探索、预检、复现与纸面运行都经过它，规则只有一处。检查随新镜像生效，旧镜像
复现旧运行不受影响。

## 不误伤的依据

导出账本里全部 199 个候选源码逐个检查：0 个有发现。它们只导入 decimal、collections、statistics、datetime、
calendar、math 和 nautilus_trader 的 config、model、trading、indicators；双下划线属性只有 `__init__`；没有
任何对导入对象的赋值。因此运行契约不升版本，已有候选照常可跑。

## 不做的与剩下的

- 不是沙箱。经消息总线发命令等其余引擎公开接口、`str.format` 按名字读属性（只得到文本）仍在；写法都留在
  源码里，由源码审查来看。评审确认账户经 `self.portfolio.account` 拿到的是副本，改不动；`request_bars` 的
  结束时间晚于当前会被原生拒绝。
- 审计按可信费率独立重算手续费，可以作为与途径无关的第二道检查，另议。
- 不在 `candidate publish` 时检查：账本不导入引擎，同一规则不放两处；预检第一次加载就会报出。
