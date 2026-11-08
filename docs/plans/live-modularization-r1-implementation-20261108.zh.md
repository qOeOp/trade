# R1：公共策略边界提取与验证记录

2026-11-08。产品基线 `a00b4f1b8748e8b858423c8e85a270985e0c1931`，独立 worktree `/tmp/trade-live-modularization-r1-20261108`，分支 `codex/live-modularization-r1-20261108`。主工作区的另一会话正在修改 UI，本批没有操作那些文件。

本批对应[正式设计](live-modularization-single-source-20261108.zh.md) R1：`engine.strategy` 持有原公共 native 分配、构造失败边界、callback/cache/clock guard、subscription声明、进程内source与失败记录。`engine.fill` 只是原 native fill-model 工厂的提取。Paper/Live/恢复会话不再导入 Replay runner。Replay 动态类仍注册于 `engine.run`，`StrategyInputs`和原函数入口保持；可变全局不在旧模块假转发，全部内部读写迁到一个 owner。

16个提取后的类/函数经 AST 对比确认主体保持（只正规化 `_Subscriptions` 改名与共同构造函数的mode factory默认值；默认值仍在旧 Replay 入口）。没有更换任何拒绝条件、reason、失败计数上限、Paper hold或交易执行顺序。既有测试只调整 owner/import/mock路径，不放宽断言。新增三项测试检查：全新解释器中Paper/Live不载入Replay、连续两轮失败文件及源归属、共用cache拒绝记录。

## 当前检查

- 159项相关回归通过；包括原生构造、loader、Paper、恢复、Live入场和连接。
- Ruff 全仓通过；Mypy 123文件通过。
- 完整标准命令 `uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'`：1448项，1439通过、9跳过，耗时343s；跳过项是本地缺少固定版本 Caddy / OAuth2 Proxy 二进制的集成测试。两份独立实施评审已完成：迁移主体未发现行为差异；均提出下述源码身份覆盖P1，阻断发布。
- 首次完整运行额外套临时网络sandbox，阻止了Dolt Unix socket/ps及控制服务本地socket，报告208 errors/2 failures；其中一项是漏迁移的 DATA_CALLBACKS 测试导入，已修复。保留原始失败日志，按仓库标准命令重跑，未改测试标准或产品配置。
- 尚未完成CI固定镜像的reference/candidate成对CLI replay；不能用本地通过或AST等价宣称parity。U1原生观察见[独立实验报告](live-modularization-native-validation-20261108.zh.md)。

## 发布前必须核对：代码身份覆盖

`deploy.runtime_inputs.project`/Dockerfile会覆盖新engine文件；但 `engine.config.RUNTIME_SOURCE_PATHS` 与 `runtime.image.LAYOUTS` 的v7固定源码map只包含原config/run/load/report/compare，加单独audit/lock。提取到新strategy/fill的代码不再包含在旧runner文件逐字节hash中。构建输入配对、image digest和逐源文件证明是不同层，不能互相冒充。

本批尚未改该审计边界，不能直接合并发布。独立评审需判定这是否削弱现 `require_main_build` 的覆盖，并审查最小兼容方案：保持旧v7历史可读，确保新代码身份实际包含新模块，而不是任意接受probe自报的文件清单。若需要增加hash map项/调整layout或新contract，必须先列明消费者、不可由现检查代替的事实、旧版兼容和负例，再按AGENTS取得检查变更授权；不能为保持“纯重构”名称而忽略。

源码身份检查未解决与固定镜像成对回放未完成前，本批只是已做本地验证的重构候选。R2–R4不在此批，正式源迁移U2也未开始。

## 评审结果与下一步

两位reviewer独立复核了冻结候选 `cc56fccbe7654401dfdb5906db74da03b8901f25`。代码评审还确认fill_model逐AST等价；原生评审核对六组原始JSON/log，未将模拟venue能力误称Binance。两者均要求先修复源码map缺口、再完成固定镜像成对验收。具体最小修复及独立字段审查见[源码身份提案](live-modularization-r1-source-identity-proposal-20261108.zh.md)。候选已提交草稿PR #2480，未合并、未部署。
