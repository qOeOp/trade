# common

## 职责

- 提供跨模块共享的确定性 helper、类型和 contract 小工具。
- 当前包含 repo path resolution、display path、runtime output path guard、基础 JSON record coercion。

## 输入

- 纯函数参数与进程环境，例如 `TRADE_REPO_ROOT`。

## 输出

- 规范化路径、repo-relative display path、runtime path validation result。

## 边界

- 不读写项目数据文件。
- 不调用外部 API。
- 不包含 R&D、review、execution、Binance 等领域判断。
- 不反向 import 任何业务模块。
