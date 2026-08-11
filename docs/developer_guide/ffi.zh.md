# FFI 内存契约

VibeTrader 仅通过 `vibe-core` 和 `vibe-model` 暴露 C 外部函数接口（FFI）。这两个 crate
都使用各自的 `ffi` Cargo feature 控制该接口，并将导出模块分别放在
`crates/core/src/ffi/` 和 `crates/model/src/ffi/` 下。

工作区中的其他 crate 使用 Rust API 或 PyO3 绑定。独立的 `vibe-plugin` crate 定义了
面向来宾插件的公共 ABI，并不共用本内存契约。

以下规则必须严格遵守。违反这些规则可能引发未定义行为，包括重复释放、内存泄漏和无效指针访问。

## Panic 处理

Rust panic 绝不能跨越 `extern "C"` 函数展开。可能发生 panic 的导出函数必须通过
`vibe_core::ffi::abort_on_panic` 执行其实现；该函数会记录 panic，并在展开越过 C 边界前
终止进程。

## `CVec` 所有权

`CVec` 是 Rust 向量分配元数据的 C 兼容表示。从 `Vec<T>` 创建 `CVec` 时，分配的唯一所有权
会转移给外部调用方。Rust 有意不为它实现 `Copy` 或 `Clone`，但 C 仍能复制其字段，因此调用方
必须同样执行"恰好一次"的所有权规则。

| 步骤 | 所有者 | 操作                                                     |
| ---- | ------ | -------------------------------------------------------- |
| 1    | Rust   | 将 `Vec<T>` 转换为 `CVec`，把分配转移给调用方。          |
| 2    | 外部方 | 读取元素，不得更改 `ptr`、`len` 或 `cap`。               |
| 3    | 外部方 | 恰好调用一次匹配具体类型的 `vec_drop_*` 函数以释放分配。 |

忘记调用 drop 会造成分配泄漏。多次释放同一分配可能破坏分配器并导致进程崩溃。

空 `CVec` 的 `len == 0` 且 `cap == 0`。其指针是不透明的哨兵值，不得解引用。Rust 使用方必须
调用 `CVec::into_vec`；它会先处理空值，再检查指针。借用数据的使用方必须出于同样原因调用
`CVec::as_slice`。

这两个方法都是 unsafe，因为公开元数据无法证明分配来源、对齐、初始化状态或独占所有权。
任何接收调用方提供的 `CVec` 并调用其中任一方法的导出函数都必须：

- 是 `unsafe extern "C" fn`。
- 在 `# Safety` 章节中说明调用方义务。
- 在重建或借用数据前验证 `len`、`cap` 和空指针不变量。
- 使用与原始 `Vec<T>` 分配相匹配的具体元素类型。

## 类型专用的释放函数

不存在通用的 `cvec_drop`。如果把每个分配都重建为 `Vec<u8>`，其他类型会向分配器提供错误的
元素布局。每个跨越边界的自有向量都需要针对其确切元素类型提供释放函数，例如
`vec_drop_book_levels`、`vec_drop_book_orders` 或 `vec_drop_fills`。

应将释放函数放在生产函数旁边，以便评审时成对核验。测试必须覆盖空哨兵值，以及使用方实现的
所有元数据检查。

## 借用外部缓冲区

不得把 Rust 之外分配的内存重建为 `Vec<T>`。应使用 `CVec::as_slice` 借用；当 Rust 需要自有存储时，
使用 `to_vec()` 复制。外部调用方保留所有权，并且必须使用创建原始缓冲区的分配器释放它。

## 以 Box 为后备存储的 API 包装器

无法按值跨越 ABI 的模型对象，会使用一个围绕 Rust 分配的轻量 `repr(C)` 包装器。每个消费所有权的
构造函数都必须有匹配的释放函数：

```rust
#[repr(C)]
pub struct OrderBook_API(Box<OrderBook>);

#[unsafe(no_mangle)]
pub extern "C" fn orderbook_new(id: InstrumentId, book_type: BookType) -> OrderBook_API {
    OrderBook_API(Box::new(OrderBook::new(id, book_type)))
}

#[unsafe(no_mangle)]
pub extern "C" fn orderbook_drop(book: OrderBook_API) {
    drop(book);
}
```

外部所有者必须恰好调用一次释放函数。不得复制具有所有权的包装器后再消费两个副本。

## 评审清单

对于每个新增或变更的 FFI 导出：

- 将实现保留在 `vibe-core` 或 `vibe-model` 中。
- 对布局会跨越边界的每种类型使用 `repr(C)`。
- 阻止 panic 跨越边界展开。
- 为每个自有分配配对一个类型专用的释放路径。
- 在 `# Safety` 文档中完整说明指针与所有权义务。
- 为所有权和验证规则添加针对性测试。
