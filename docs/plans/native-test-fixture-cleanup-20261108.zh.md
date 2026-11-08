# 原生测试对象在所属线程收尾

2026-11-08。问题出现在组合测试，不是本次Live模块提取引入的生产缺陷。

## 诊断

同顺序加载构造、runtime、Live、entry、connection、web控制、请求和源码身份测试，R1–R4组合166项断言通过却出现5条 `PyStrategy is unsendable, but is being dropped on another thread`；旧R1相同组合165项也有5条。触发位置为后续Web请求线程的分配/GC。Entry和Connection测试在native dispose之后仍保留source._live与session.source双向引用；原生PyStrategy为unsendable，不可由稍后线程收集。

独立只读诊断看到16个残留source；另两个隔离机制探针分别在main/worker收集15个对象，前者无异常、后者15条同类异常。探针改变了分配时序，因此不把这15个等同原始5个，也不声称生产有同样故障。生产execute和构造失败路径已经在正常dispose后断开session.source/node。

## 修复

仅清理测试夹具：保留end/dispose原顺序；随后释放夹具持有的session/source/node/engine引用，并在创建对象的测试线程调用gc.collect。复用rc7的python/tests/conftest.py::collect_node_cycles模式。没有关闭GC、调整阈值、拦截stderr、修改232项原业务断言或改生产生命周期。未增加存储字段、放开检查或改变验收标准。

独立审查确认顺序和范围。组合166项原样回归通过且不再有unsendable；独立main线程weakref探针看到64个跟踪source在main释放，无残留。其他原生日志仍保留，不能把本项解释为所有日志都干净或实盘生命周期全部通过。原样日志、机制探针与审查均在/tmp/trade-live-refactor-goal-20261108/INTEGRATION-NATIVE-CLEANUP-*.md及对应日志。

## 独立main分支验证

基于main 3b8fbe0f7，两个测试文件只增加17行相同清理；Ruff及Mypy两文件通过。完整标准Python测试1450项通过，9项按环境跳过；未出现unsendable。全部隔离测试使用假账户或本地fixture，无真实连接、凭据或容器操作。
