# 开发者指南

本指南介绍如何开发和扩展 VibeTrader，以及如何为项目贡献代码。

VibeTrader 采用**以 Rust 为核心并提供 Python 绑定**的架构：

- **Rust** 负责网络通信、数据解析、订单撮合及其他性能关键型操作。
- **Python** 为策略开发、配置和系统集成提供面向用户的 API。
- **PyO3** 连接两者，以极低的额外开销向 Python 暴露 Rust 功能。

这种方式兼具 Python 的简洁性和生态优势，以及 Rust 的性能与内存安全性。

## 内容

- [环境设置](environment_setup.md)
- [设计原则](design_principles.md)
- [编码标准](coding_standards.md)
- [Rust](rust.md)
- [Python](python.md)
- [测试](testing.md)
- [测试数据集](test_datasets.md)
- [文档风格](docs.md)
- [Markdown 风格](markdown_style.md)
- [适配器](adapters.md)
- [数据测试规范](spec_data_testing.md)
- [执行测试规范](spec_exec_testing.md)
- [基准测试](benchmarking.md)
- [FFI 内存契约](ffi.md)
- [插件](plugins.md)
