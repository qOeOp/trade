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

- 导入白名单：计算类标准库，加 `nautilus_trader` 的 common、config、core、indicators、model、trading。
  运行器（engine、market）、行情目录（persistence）、撮合与回测（execution、backtest）、文件与进程（os、
  sys、pathlib、glob、subprocess、importlib）都不在内；相对导入和裸 `nautilus_trader` 也拒绝。
- 名字：open、eval、exec、compile、getattr、setattr、delattr、globals、locals、vars、input、breakpoint。
- `__init__`、`__name__` 以外的双下划线名字与属性；栈帧与代码内省属性（f_globals、gi_frame、mro 等）。
- 赋值或删除的属性链根是导入的名字，或不是名字（如 `type(self).x = ...`）。

放在 `engine/load.py`：回放、探索、预检、复现与纸面运行都经过它，规则只有一处。检查随新镜像生效，旧镜像
复现旧运行不受影响。

## 不误伤的依据

导出账本里全部 199 个候选源码逐个检查：0 个有发现。它们只导入 decimal、collections、statistics、datetime、
calendar、math 和 nautilus_trader 的 config、model、trading、indicators；双下划线属性只有 `__init__`；没有
任何对导入对象的赋值。因此运行契约不升版本，已有候选照常可跑。

## 不做的与剩下的

- 不是沙箱。别名（`cls = type(self); cls.x = ...`）、引擎公开接口上的写操作（如向缓存加合约）仍能绕开，
  但写法都留在源码里，由源码审查来看。
- 审计按可信费率独立重算手续费，可以作为与途径无关的第二道检查，另议。
- 不在 `candidate publish` 时检查：账本不导入引擎，同一规则不放两处；预检第一次加载就会报出。
