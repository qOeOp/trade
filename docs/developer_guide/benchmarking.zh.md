# 基准测试

本文是编写和运行 VibeTrader 基准测试的实践参考，涵盖工具细节、目录布局、示例代码、
本地执行和火焰图分析。

有关策略（测试什么、何时测试、采用何种严谨程度，以及如何与 CI 关联），请参阅仓库根目录的
[`/BENCHMARKING.md`](../../BENCHMARKING.md)。

---

## 工具概览

VibeTrader 使用两个互补的 Rust 基准测试框架：

| 框架                                                         | 衡量内容                               | 优先使用场景                           |
| ------------------------------------------------------------ | -------------------------------------- | -------------------------------------- |
| [**Criterion**](https://docs.rs/criterion/latest/criterion/) | 带置信区间的实际耗时                   | 任何 ≥ 100 ns 的操作；绝对测量；比较。 |
| [**iai**](https://docs.rs/iai/latest/iai/)                   | 已执行的 CPU 指令数（通过 Cachegrind） | 低于 100 ns 的函数；CI 回归检测。      |

大多数热点代码路径同时使用两者都会受益。Criterion 提供用户可见的数值；iai 提供不受噪声影响的
回归信号。

:::note
iai 是确定性的（不受系统噪声影响），但结果与机器有关。应在 CI 内用于回归检测，不要用于跨机器比较。
:::

---

## 目录布局

每个 crate 都将基准测试放在本地 `benches/` 文件夹中：

```text
crates/<crate_name>/
└── benches/
    ├── foo_criterion.rs
    └── foo_iai.rs
```

在 crate 的 `Cargo.toml` 中显式注册每个基准测试，使 `cargo bench` 能发现它：

```toml
[[bench]]
name = "foo_criterion"
path = "benches/foo_criterion.rs"
harness = false

[[bench]]
name = "foo_iai"
path = "benches/foo_iai.rs"
harness = false
```

若要加入夜间 CI 性能工作流，请把该 crate 添加到工作区 `Makefile` 的 `cargo-ci-benches` 配方中。

---

## 编写 Criterion 基准测试

1. **在计时循环外设置。** 迭代之间不会变化的工作应放在外围代码或 `iter_batched_ref` 的
   设置闭包中，而不是传给 `iter` 的主体中。
2. **使用 `black_box` 包装输入**，防止优化器将其折叠掉。
3. **可变基准测试使用 `iter_batched_ref`。** 它会把输入的 `Drop` 排除在计时区域之外；
   对持有大型结构的基准测试而言，否则释放成本会主导测量结果。
4. **向按规模参数化的组添加 `Throughput::Elements(n)`**，使 Criterion 报告逐元素吞吐量。
5. **注释意图。** 说明基准测试测量什么（热点路径、最坏情况或冷缓存情况），让未来读者理解
   该测试发生回归意味着什么。

```rust
use std::hint::black_box;

use criterion::{BatchSize, BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};

const SIZES: &[usize] = &[10, 100, 1_000];

fn bench_my_op(c: &mut Criterion) {
    let mut group = c.benchmark_group("module/my_op");

    for &n in SIZES {
        group.throughput(Throughput::Elements(n as u64));
        group.bench_with_input(BenchmarkId::from_parameter(n), &n, |b, &n| {
            b.iter_batched_ref(
                || populate(n),
                |state| state.run(black_box(n)),
                BatchSize::SmallInput,
            );
        });
    }

    group.finish();
}

criterion_group!(benches, bench_my_op);
criterion_main!(benches);
```

---

## 编写 iai 基准测试

`iai` 要求函数不接收参数。保持函数简短，使指令数有意义，并避免函数之外的变化渗入测量。

```rust
use std::hint::black_box;

fn bench_add() -> i64 {
    let a = black_box(123);
    let b = black_box(456);
    a + b
}

iai::main!(bench_add);
```

不同运行之间会变化的设置（分配、随机性、系统调用）会以误导方式增加指令数。
iai 最适合纯函数和无分配函数。

---

## 在本地运行基准测试

| 目标                        | 命令                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| 一个 crate 中的所有基准测试 | `cargo bench -p vibe-execution`                                   |
| 一个核心基准模块            | `cargo bench -p vibe-execution --bench matching_core`             |
| 一个引擎基准模块            | `cargo bench -p vibe-execution --bench matching_engine`           |
| 一个核心基准名称模式        | `cargo bench -p vibe-execution --bench matching_core -- iterate`  |
| 一个引擎基准名称模式        | `cargo bench -p vibe-execution --bench matching_engine -- submit` |
| 快速冒烟运行（低样本数）    | `cargo bench ... -- --quick`                                      |
| CI 跟踪的全部基准测试       | `make cargo-ci-benches`                                           |

Criterion 将 HTML 报告写入 `target/criterion/`。打开 `target/criterion/report/index.html`。
报告包含每个基准测试的小提琴图、置信区间，以及与上次运行所保存基线的比较。

---

## 生成火焰图

`cargo-flamegraph` 为一个基准测试生成采样调用栈剖析。当基准测试显示回归，但无法确定由哪个内部调用
引起时，它很有用。

1. 每台机器安装一次：

   ```bash
   cargo install flamegraph
   ```

2. 使用 `bench` profile 运行指定基准测试：

   ```bash
   cargo flamegraph --bench matching -p vibe-common --profile bench
   ```

3. 在浏览器中打开 `flamegraph.svg`，放大热点路径。

### Linux

必须能够使用 `perf`。在 Debian/Ubuntu 上：

```bash
sudo apt install linux-tools-common linux-tools-$(uname -r)
```

如果 `perf_event_paranoid` 阻止运行：

```bash
sudo sh -c 'echo 1 > /proc/sys/kernel/perf_event_paranoid'
```

值为 `1` 通常就足够。之后将它恢复为 `2`（默认值），或通过 `/etc/sysctl.conf` 持久化。

### macOS

`DTrace` 需要 root 权限，因此必须通过 `sudo` 运行 `cargo flamegraph`。

:::warning
使用 `sudo` 运行会在 `target/` 中创建 root 所有的文件，导致后续 `cargo` 命令遇到权限错误。
你可能需要手动删除 root 所有的文件，或运行 `sudo cargo clean`。
:::

```bash
sudo cargo flamegraph --bench matching -p vibe-common --profile bench
```

`bench` profile 保留完整调试符号，因此火焰图可以显示可读的函数名，同时不会使生产二进制文件膨胀
（后者仍使用 `panic = "abort"`，并通过 `[profile.release]` 构建）。

> **注意** 基准测试二进制文件使用工作区 `Cargo.toml` 中定义的自定义 `[profile.bench]` 编译。
> 该 profile 继承自 `release` 并设置 `debug = "full"`，在保留完整优化的*同时*保留调试符号，
> 从而让 `cargo flamegraph` 或 `perf` 等工具生成可读的调用栈。

---

## 模板

可直接复制的起始文件位于 [`docs/dev_templates/`](../dev_templates/)：

- **Criterion**：[`criterion_template.rs`](../dev_templates/criterion_template.rs)
- **iai**：[`iai_template.rs`](../dev_templates/iai_template.rs)

将模板复制到目标 crate 的 `benches/`，调整导入和组名称，在 `Cargo.toml` 中注册，然后开始测量。
