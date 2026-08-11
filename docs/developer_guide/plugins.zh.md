# 插件

`vibe-plugin` crate 定义了 VibeTrader 插件的制品契约：插件是独立编译的 Rust `cdylib`，
通过带版本的清单标识自身，并跨越 C ABI 边界交换值。该 crate 只涵盖制品身份和边界原语，
不会加载、注册或运行插件；加载宿主属于 Vibe 内部部署细节，不在本仓库的范围内。

:::warning
插件 ABI 尚处于早期 alpha 阶段，契约并不稳定。构建插件时，请固定与其匹配的
`vibe-plugin` 版本。
:::

## 制品契约

插件是一个 Rust `cdylib`，仅导出一个入口符号 `vibe_plugin_init`。`vibe_plugin!` 宏会生成
该符号，以及携带构建身份的静态清单：

```rust
vibe_plugin::vibe_plugin! {
    name: "example-plugin",
    vendor: "Vibe",
    version: env!("CARGO_PKG_VERSION"),
}
```

`name` 和 `version` 是必填项，`vendor` 默认为空字符串。每个制品应在模块作用域调用该宏一次，
在制品的 `Cargo.toml` 中设置 `crate-type = ["cdylib"]`，并依赖与之匹配的 `vibe-plugin` 版本。

## 清单兼容性

`vibe_plugin_init` 接收一个不透明的宿主指针，并返回存放在进程生命周期存储区中的
`PluginManifest`；如果宿主指针为空或调用发生 panic，则返回 null。注册前，
`PluginManifest::validate` 会检查宿主所依赖的不变量。它会报告发现的所有结构问题，
并在以下情况下失败：

- `abi_version` 不等于 `VIBE_PLUGIN_ABI_VERSION`，或 `build_id.schema_version` 不等于
  `PLUGIN_BUILD_ID_VERSION`。
- `plugin_name` 或 `plugin_version` 为空。
- 任一清单字符串格式错误：指针为空但长度非零，或者字节不是有效的 UTF-8。
- `build_id.precision_mode` 或 `build_id.fixed_precision` 与宿主构建不同。

之所以验证精度，是因为它会改变跨边界模型类型的布局。其余构建身份字段（`vibe-plugin` 版本、
`rustc` 版本、目标三元组和构建配置）仅用于诊断。

## 边界规则

只有 `vibe_plugin::boundary` 中的 `#[repr(C)]` 类型，以及由这些类型构成的 `#[repr(C)]` 类型，
才能出现在跨边界的函数签名中。`String`、`Vec` 和 `Box<dyn Trait>` 依赖 Rust 不稳定的 ABI，
绝不能跨越该边界。panic 也不得跨边界展开；生成的入口符号会捕获 panic 并返回 null。

在当前 ABI 下，插件不会被卸载，因此清单存储在整个进程生命周期内始终有效。

边界实现和测试请参阅 [`crates/plugin/`](../../crates/plugin/)。
