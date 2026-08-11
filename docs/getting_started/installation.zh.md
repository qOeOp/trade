# 安装

Vibe Trader 通过源代码检出进行安装；本仓库尚未定义公开发行渠道。

## 前置条件

- 通过 `rustup` 安装 Rust；仓库在 `rust-toolchain.toml` 中固定工具链版本。
- Python 3.12 至 3.14。
- 使用 `python/pyproject.toml` 中固定版本的 `uv`。
- 当前平台上的 `make` 和 C/C++ 构建工具链。
- 在 Linux 上构建 Python 扩展时需要 `patchelf`。

Cap'n Proto、数据库服务等可选适配器依赖记录在各自的集成指南中。

## 检出源代码

```bash
git clone https://github.com/qOeOp/trade.git
cd trade
make sync
```

`make sync` 会根据 `python/uv.lock` 创建或更新仓库的 Python 环境，但不会构建本地包。

## 构建 Python 包

构建 PyO3 扩展并将其安装到仓库环境中：

```bash
make build-debug
```

需要优化的本地构建时使用：

```bash
make build
```

导入包为 `vibe_trader`；其编译扩展为 `vibe_trader._libvibe`。

## 仅开发 Rust

无需安装 Python 包即可检查 Rust 工作区：

```bash
cargo check --workspace --all-targets
```

单个包使用各自的 `vibe-*` Cargo 名称，例如：

```bash
cargo check -p vibe-core
cargo test -p vibe-model
```

## 精度模式

常规 Python 构建和大多数适配器配置会启用 `high-precision` feature。选择禁用默认 feature 的 Rust
使用方，必须在所有交换定点模型值的 crate 中一致选择精度 feature。

不要在同一进程或持久化数据集中混用不同精度模式构建的制品。

## 扩展依赖

Python 依赖组和可选可视化依赖声明在 `python/pyproject.toml` 中，并由 `python/uv.lock` 锁定。
使用 Makefile target，使所选依赖组与构建保持一致：

```bash
make sync
make build-debug
make pytest
```

## Redis

Redis 支持是一个 Cargo feature，并且只在测试或运行时配置明确选择它时，才需要可访问的 Redis 服务。
默认源代码设置不会启动外部服务，也不会创建实盘交易连接。

## 重新构建与清理

修改 PyO3 绑定后，应在测试前重新生成 stub：

```bash
make py-stubs
make build-debug
```

删除本地构建制品：

```bash
make clean
```
