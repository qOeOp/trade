# 环境搭建

使用支持当前 Rust 和 Python 语言功能的编辑器，例如 PyCharm 或 Visual Studio Code。

[uv](https://docs.astral.sh/uv) 是管理所有 Python 虚拟环境和依赖的首选工具。

[prek](https://github.com/j178/prek) 用于在提交时自动运行各种 pre-commit 检查、自动格式化器和 lint 工具。

VibeTrader 使用的 [Rust](https://www.rust-lang.org) 越来越多，因此系统中也应安装 Rust
（[安装指南](https://www.rust-lang.org/tools/install)）。

[Cap'n Proto](https://capnproto.org/) 是编译序列化 schema 所必需的。所需版本在仓库根目录的
`tools.toml` 中指定。Ubuntu 的默认软件包通常过旧，因此可能需要从源代码安装（见下文）。

:::info
VibeTrader *必须*能在 **Linux、macOS 和 Windows** 上编译和运行。请始终考虑可移植性
（使用 `std::path::Path`，避免在 shell 脚本中使用 Bash 特有写法等）。
:::

## 设置

以下步骤适用于类 UNIX 系统，并且只需完成一次。

### 快速设置

这是一条适用于新 Linux 或 macOS 开发机器的精简设置路径。下方详细章节会解释每一步并介绍替代方案。

首先安装平台工具：

```bash tab="Ubuntu"
sudo apt-get update
sudo apt-get install -y build-essential clang lld curl git make pkg-config
```

```bash tab="macOS"
xcode-select --install
```

然后克隆仓库并安装项目固定版本的工具：

```bash
git clone --branch develop https://github.com/qOeOp/trade
cd vibe_trader

curl https://sh.rustup.rs -sSf | sh
source "$HOME/.cargo/env"

curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

cargo install cargo-binstall --locked
make install-tools
./scripts/install-capnp.sh

make sync
source .venv/bin/activate

export PYO3_PYTHON="$PWD/.venv/bin/python"

if [ "$(uname -s)" = "Linux" ]; then
  PYTHON_LIB_DIR="$("$PYO3_PYTHON" -c 'import sysconfig; print(sysconfig.get_config_var("LIBDIR"))')"
  export LD_LIBRARY_PATH="$PYTHON_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

export PYTHONHOME="$("$PYO3_PYTHON" -c 'import sys; print(sys.base_prefix)')"

prek install
make build-debug
```

Windows 用户应按照[安装指南](../getting_started/installation.md#source-checkout)中的源代码安装步骤操作，
然后使用本指南中的相应命令。

### 1. 安装依赖

按照[安装指南](../getting_started/installation.md)操作，然后从仓库根目录同步开发和测试依赖：

```bash
make sync
```

经常进行开发时，把包的 debug 构建安装到根目录 `.venv`：

```bash
make install-debug
```

### 2. 安装开发工具

VibeTrader 会固定每个开发工具的版本，使所有贡献者和 CI 使用完全相同的版本。
一个 Makefile target 会安装完整工具集：

```bash
make install-tools
```

该命令会安装：

- 在 `Cargo.toml` 的 `[workspace.metadata.tools]` 下固定版本的 **Cargo CLI**：`cargo-audit`、
  `cargo-deny`、`cargo-edit`、`cargo-fuzz`、`cargo-llvm-cov`、`cargo-machete`、`cargo-nextest`、
  `flamegraph`、`lychee`。
- 在 `tools.toml` 中固定版本的**预编译二进制文件**：`prek`（pre-commit runner）和 `osv-scanner`
  （漏洞扫描器）。
- **uv**，同步到 `python/pyproject.toml` 要求的版本。

Cap'n Proto 也在 `tools.toml` 中固定版本，但需单独安装；请参阅下方 [Cap'n Proto](#capn-proto) 章节。

由于 `cargo-fuzz` 使用 `libfuzzer-sys` 和不稳定编译器 flag，fuzz target 在运行时还需要 Rust nightly
工具链：

```bash
rustup toolchain install nightly
```

#### 一次性前置条件：cargo-binstall

`make install-tools` 使用 [`cargo-binstall`](https://github.com/cargo-bins/cargo-binstall) 获取预编译的
`prek` 二进制文件，而不是从源代码编译。每台机器只需安装一次 `cargo-binstall`：

```bash
cargo install cargo-binstall --locked
```

这是一次性步骤。后续运行 `make install-tools` 会复用已安装的 `cargo-binstall`。

#### 版本的唯一事实来源

仓库 manifest 是依赖和工具版本的规范来源。除非没有基于 manifest 的读取方式，否则不要把当前版本号
复制到文档、runner 镜像或脚本中。

| 源文件或章节                              | 定义内容                                    |
| ----------------------------------------- | ------------------------------------------- |
| `rust-toolchain.toml`                     | Rust 工具链。                               |
| `Cargo.toml` and `Cargo.lock`             | Rust 工作区依赖及其精确解析。               |
| `Cargo.toml` `[workspace.metadata.tools]` | 可通过 Cargo 安装的开发工具。               |
| `python/pyproject.toml`                   | Python 依赖、支持的 Python 范围和 uv。      |
| `python/uv.lock`                          | Python 依赖的精确解析。                     |
| `tools.toml`                              | 没有原生 manifest 的外部 CLI 和二进制文件。 |

`tools.toml` 中固定的外部工具包括 `prek`、`pip-audit`、`pypi-attestations`、`osv-scanner` 和 `capnp`。

Makefile 通过 `scripts/cargo-tool-version.sh`、`scripts/tool-version.sh` 和 `scripts/uv-version.sh`
读取这些版本，因此只需在源文件中提升版本。若要对照 crates.io 检查固定的 Cargo 工具版本，请运行：

```bash
make outdated
```

### 3. 设置 pre-commit

设置会在提交时自动运行的 pre-commit hook：

```bash
prek install
```

打开拉取请求前，在本地运行格式和 lint 套件，使 CI 尽量一次通过：

```bash
make format
make pre-commit
```

确保 Rust 编译器报告**零错误**--损坏的构建会拖慢所有人。

### 4. 配置环境变量

**Rust/PyO3 必需（Linux 和 macOS）**：在 Linux 或 macOS 上使用通过 `uv` 安装的 Python 时，
从仓库根目录运行 `make sync` 后设置以下环境变量：

```bash
# Set the Python executable path for PyO3
export PYO3_PYTHON="$PWD/.venv/bin/python"

# Linux only: Set the library path for the uv-managed Python runtime
PYTHON_LIB_DIR="$("$PYO3_PYTHON" -c 'import sysconfig; print(sysconfig.get_config_var("LIBDIR"))')"
export LD_LIBRARY_PATH="$PYTHON_LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# Set the Python home path (required for Rust tests)
export PYTHONHOME="$("$PYO3_PYTHON" -c 'import sys; print(sys.base_prefix)')"
```

:::note
`LD_LIBRARY_PATH` 导出只适用于 Linux，macOS 或 Windows 不需要。

- `PYO3_PYTHON` 告诉 PyO3 使用哪个 Python 解释器，减少不必要的重新编译。
- 使用 `uv` 安装的 Python 运行 `make cargo-test` 时需要 `PYTHONHOME`。如果不设置，依赖 PyO3 的测试
  可能无法找到 Python 运行时。

:::

验证环境是否配置正确：

```bash
python -c "import sys; print('Python:', sys.executable, sys.version)"
echo "PYO3_PYTHON: $PYO3_PYTHON"
echo "PYTHONHOME: $PYTHONHOME"
```

## 依赖管理

Python 依赖由 [uv](https://docs.astral.sh/uv) 管理。`python/pyproject.toml` 中的 `[tool.uv]` 章节
强制执行三项供应链安全设置：

- **`required-version`**：所有开发者和 CI 使用相同的 uv 版本。`scripts/uv-version.sh` 会提取该版本，
  供 Makefile、CI 和 Docker 构建使用。如果本地 uv 偏离固定版本，`uv lock`/`uv sync` 会失败并显示
  `Required uv version ... does not match the running
  version ...`。运行 `make update-uv` 安装固定版本
  （或按照 uv 自身的 `uv self update <version>` 提示操作）。stub target 在运行 `uv` 前会检查相同的
  固定版本；请参阅[生成的 Python 制品](rust.md#generated-python-artifacts)。
- **`exclude-newer = "3 days"`**：`uv lock` 会忽略最近 3 天内发布的软件包版本。这为社区检测并隔离
  受入侵版本留出时间，避免它们进入 lockfile。该值接受 RFC 3339 时间戳（`"2026-03-30T00:00:00Z"`）、
  友好时长（`"3 days"`、`"1 week"`、`"24 hours"`）或 ISO 8601 时长（`"P3D"`、`"P1W"`、
  `"PT24H"`）。uv 0.11.8+ 会在 `python/uv.lock` 中把友好/ISO 形式存为 `exclude-newer-span`，
  同时输出一个 `exclude-newer` 哨兵时间戳以保持向后兼容。`python/uv.lock` 使用这种格式。
- **`no-build-package`**：列出 `python/uv.lock` 中锁定的所有第三方包。`uv` 拒绝从源代码构建其中任何
  软件包。正常情况下 uv 优先使用 wheel，因此该设置不起作用；只有列出的包停止为目标平台发布 wheel 时
  才会触发，此时 `uv lock` 会失败，而不是静默从 sdist 构建。本地工作区包有意不在列表中，因为它必须由
  工作区自身的构建后端构建。`scripts/check-no-build-packages.sh` 会使该列表与 `python/uv.lock` 保持同步；
  该脚本也会在 lockfile 或 manifest 变更时作为 pre-commit hook 运行。

### 绕过冷却期

需要立即引入安全补丁或关键错误修复时，在命令行覆盖 `exclude-newer`。所有形式都接受时间戳、友好时长或
ISO 时长；软件包级覆盖还接受 `false`，用于让指定软件包完全免于冷却期。

```bash
# Shorten the cooldown for a single package (friendly duration)
uv lock --project python --exclude-newer-package "somepackage=1 day"

# Pin a single package to an absolute cutoff
uv lock --project python --exclude-newer-package "somepackage=2026-03-30T00:00:00Z"

# Exempt a single package from the cooldown entirely
uv lock --project python --exclude-newer-package "somepackage=false"

# Disable the cooldown for the whole resolution
uv lock --project python --exclude-newer "0 seconds"
```

CLI flag 只覆盖本次调用的 `python/pyproject.toml` 值，后续运行的配置保持不变。

### 更新 uv

若要更新固定的 uv 版本，修改 `python/pyproject.toml` 中的 `required-version`，然后更新
`.pre-commit-config.yaml` 中匹配的 `rev`。运行 `make update-uv` 在本地安装新的固定版本。

## 构建

修改 Rust 绑定或 Python 包代码后，使用以下命令重新构建扩展：

```bash
make build
```

如果正在频繁开发和迭代，debug 模式通常已经足够，并且比完全优化构建*快得多*。
使用以下命令以 debug 模式编译：

```bash
make build-debug
```

## Cap'n Proto

[Cap'n Proto](https://capnproto.org/) 是编译序列化 schema 所必需的。
所需版本在仓库根目录的 `tools.toml` 中定义。

为当前平台安装正确版本：

```bash tab="Script (Linux/macOS)"
./scripts/install-capnp.sh
```

```bash tab="macOS (Homebrew)"
brew install capnp
```

```bash tab="Linux (source)"
CAPNP_VERSION=$(bash scripts/tool-version.sh capnp)
cd ~
wget https://capnproto.org/capnproto-c++-${CAPNP_VERSION}.tar.gz
tar xzf capnproto-c++-${CAPNP_VERSION}.tar.gz
cd capnproto-c++-${CAPNP_VERSION}
./configure
make -j$(nproc)
sudo make install
sudo ldconfig
```

```bash tab="Windows (Chocolatey)"
choco install capnproto
```

验证已安装版本是否与 `tools.toml` 匹配：

```bash
capnp --version
```

安装脚本会确保安装固定版本。如果 Homebrew 或 Chocolatey 提供的版本较旧，请从源代码安装，
或参阅 [Cap'n Proto 安装指南](https://capnproto.org/install.html)。

## 更快的构建

Cranelift 代码生成后端可以缩短开发、测试和 IDE 检查的本地构建时间。
它需要 nightly Rust 工具链，并需要本地修改 `Cargo.toml`：

```bash
rustup toolchain install nightly --component rust-analyzer
```

保存下面的补丁，然后用 `git apply <patch>` 应用。推送变更前使用 `git apply -R <patch>` 删除它。

:::warning
不要提交这些变更。cranelift 补丁只用于本地开发，推送后会破坏 CI。
:::

```diff
diff --git a/Cargo.toml b/Cargo.toml
--- a/Cargo.toml
+++ b/Cargo.toml
@@ -1,3 +1,5 @@
+cargo-features = ["codegen-backend"]
+
 [workspace]
 resolver = "2"
 members = [
@@ -424,6 +426,7 @@
 lto = false
 panic = "unwind"
 incremental = true
+codegen-backend = "cranelift"

 # Compile third-party deps at opt-level=1 in dev/test profiles. Workspace
 # members keep opt-level=0 (fast iteration); deps recompile rarely so the
@@ -444,6 +447,7 @@
 strip = false
 lto = false
 incremental = true
+codegen-backend = "cranelift"

 [profile.test.package."*"]
 opt-level = 1
@@ -452,6 +456,7 @@
 inherits = "test"
 debug = false # Improves compile times
 strip = "debuginfo" # Improves compile times
+codegen-backend = "cranelift"

 [profile.ci-pr]
 inherits = "test"
```

使用 `RUSTUP_TOOLCHAIN=nightly` 运行本地构建命令，例如：

```bash
RUSTUP_TOOLCHAIN=nightly make build-debug
```

使用该本地补丁时，在 [rust-analyzer 设置](#rust-analyzer-设置)中使用相同工具链。

## 服务

从仓库根目录初始化 PostgreSQL、Redis 和 pgAdmin：

```bash
make init-services
```

该命令会启动容器并初始化 VibeTrader 数据库 schema。若只启动容器而不重新初始化 schema，运行
`make start-services`。若只启动一项服务，直接使用 Compose 文件：

```bash
docker compose -f .docker/docker-compose.yml up -d postgres
```

开发服务包括：

- `postgres`：PostgreSQL，默认使用 `POSTGRES_USER=vibe`、`POSTGRES_PASSWORD=pass` 和
  `POSTGRES_DB=vibe`。
- `redis`：Redis server。
- `pgadmin`：用于数据库管理的 pgAdmin 4。

:::info
请只将该设置用作开发环境。生产环境应使用适当且更安全的设置。
:::

使用 `make stop-services` 停止容器但保留其数据。只有在确实要删除开发 volume 时，才使用
`make purge-services`。

## Vibe CLI 开发者指南

## 简介

Vibe CLI 是用于与 VibeTrader 生态交互的命令行界面工具。
它提供管理 PostgreSQL 数据库和处理各种交易操作的命令。

:::warning
在使用 GNOME 桌面的 Linux 系统上，`vibe` 命令通常指 GNOME 文件管理器（`/usr/bin/vibe`）。
安装 VibeTrader CLI 后，可能需要通过以下任一方式确保 Cargo 二进制文件具有更高优先级：

- 在 shell 配置中添加别名：`alias vibe="$HOME/.cargo/bin/vibe"`
- 使用完整路径：`~/.cargo/bin/vibe`
- 确保 `PATH` 中的 `~/.cargo/bin` 位于 `/usr/bin` 之前

:::

## 安装

可以使用下面的 Makefile target 安装 Vibe CLI，它会在内部使用 `cargo install`。
该命令把 `vibe` 二进制文件放入 Cargo 的二进制目录。Windows 源代码安装需要通过 MSYS2 或 WSL
使用 GNU Make；夜间工作流也会发布 Windows x86-64 CLI 压缩包。

```bash
make install-cli
```

## 命令

运行 `vibe --help` 可以查看 CLI 结构和可用命令组：

### 数据库

这些命令处理 PostgreSQL 数据库的引导设置。使用时需要通过命令行参数，或位于根目录或当前工作目录的
`.env` 文件，提供正确的连接配置。

- `--host` 或 `POSTGRES_HOST`：数据库 host
- `--port` 或 `POSTGRES_PORT`：数据库 port
- `--user` 或 `POSTGRES_USERNAME`：根管理员（通常为 postgres 用户）
- `--password` 或 `POSTGRES_PASSWORD`：根管理员密码
- `--database` 或 `POSTGRES_DATABASE`：数据库**名称和拥有该数据库权限的新用户**
    （例如提供 `vibe` 时，会创建名为 vibe 的新用户，密码取自 `POSTGRES_PASSWORD`，并以该用户为
    所有者引导建立 `vibe` 数据库）。

`.env` 文件示例

```
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USERNAME=postgres
POSTGRES_PASSWORD=pass
POSTGRES_DATABASE=vibe
```

命令列表：

1. `vibe database init`：引导创建 schema、role，以及根 `schema` 目录中的所有 SQL 文件
   （例如 `tables.sql`）。
2. `vibe database drop`：删除目标 Postgres 数据库中的所有表、role 和数据。

## Rust analyzer 设置

Rust analyzer 是常用的 Rust language server，可与多种 IDE 集成。配置其 `VIRTUAL_ENV` 以使用
根目录 `.venv`。如果 PyO3 分析无法找到 Python，还应提供[配置环境变量](#4-配置环境变量)
中的 `PYO3_PYTHON` 和 `PYTHONHOME` 值。以下示例涵盖 VS Code 和 AstroNvim。其他设置请参阅
[rust-analyzer 配置](https://rust-analyzer.github.io/book/configuration.html)。

```json tab="VSCode"
{
    "rust-analyzer.restartServerOnConfigChange": true,
    "rust-analyzer.linkedProjects": [
        "Cargo.toml"
    ],
    "rust-analyzer.cargo.features": "all",
    "rust-analyzer.check.workspace": false,
    "rust-analyzer.check.extraEnv": {
        "VIRTUAL_ENV": "<path-to-your-virtual-environment>/.venv",
        "CC": "clang",
        "CXX": "clang++"
    },
    "rust-analyzer.cargo.extraEnv": {
        "VIRTUAL_ENV": "<path-to-your-virtual-environment>/.venv",
        "CC": "clang",
        "CXX": "clang++"
    },
    "rust-analyzer.runnables.extraEnv": {
        "VIRTUAL_ENV": "<path-to-your-virtual-environment>/.venv",
        "CC": "clang",
        "CXX": "clang++"
    },
    "rust-analyzer.check.features": "all",
    "rust-analyzer.testExplorer": true
}
```

```lua tab="Neovim (AstroLSP)"
config = {
  rust_analyzer = {
    settings = {
      ["rust-analyzer"] = {
        restartServerOnConfigChange = true,
        linkedProjects = { "Cargo.toml" },
        cargo = {
          features = "all",
          extraEnv = {
            VIRTUAL_ENV = "<path-to-your-virtual-environment>/.venv",
            CC = "clang",
            CXX = "clang++",
          },
        },
        check = {
          workspace = false,
          command = "check",
          features = "all",
          extraEnv = {
            VIRTUAL_ENV = "<path-to-your-virtual-environment>/.venv",
            CC = "clang",
            CXX = "clang++",
          },
        },
        runnables = {
          extraEnv = {
            VIRTUAL_ENV = "<path-to-your-virtual-environment>/.venv",
            CC = "clang",
            CXX = "clang++",
          },
        },
        testExplorer = true,
      },
    },
  },
}
```
