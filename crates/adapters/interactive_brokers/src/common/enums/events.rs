/// Event kind for the rust-ibapi place-order response enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbPlaceOrderEvent {
    OrderStatus,
    OpenOrder,
    ExecutionData,
    CommissionReport,
    Message,
}

/// Event kind for the rust-ibapi order-update enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbOrderUpdateEvent {
    OrderStatus,
    OpenOrder,
    ExecutionData,
    CommissionReport,
    Message,
}

/// Event kind for the rust-ibapi cancel-order response enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbCancelOrderEvent {
    OrderStatus,
    Notice,
}

/// Event kind for the rust-ibapi order query response enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbOrdersEvent {
    OrderData,
    OrderStatus,
    Notice,
}

/// Event kind for the rust-ibapi executions response enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbExecutionsEvent {
    ExecutionData,
    CommissionReport,
    Notice,
}

/// Event kind for the rust-ibapi exercise-options response enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbExerciseOptionsEvent {
    OpenOrder,
    OrderStatus,
    Notice,
}

/// Event kind for rust-ibapi historical bar update streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbHistoricalBarUpdateEvent {
    Historical,
    Update,
    End,
}

/// Event kind for rust-ibapi realtime market-depth streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbMarketDepthEvent {
    MarketDepth,
    MarketDepthL2,
    Notice,
}

/// Event kind for rust-ibapi realtime tick streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbTickEvent {
    Price,
    Size,
    String,
    Efp,
    Generic,
    OptionComputation,
    SnapshotEnd,
    Notice,
    RequestParameters,
    PriceSize,
}

/// Event kind for rust-ibapi account summary streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbAccountSummaryEvent {
    Summary,
    End,
}

/// Event kind for rust-ibapi position update streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbPositionUpdateEvent {
    Position,
    PositionEnd,
}

/// Event kind for rust-ibapi model-code scoped position update streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbPositionUpdateMultiEvent {
    Position,
    PositionEnd,
}

/// Event kind for rust-ibapi account update streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbAccountUpdateEvent {
    AccountValue,
    PortfolioValue,
    UpdateTime,
    End,
}

/// Event kind for rust-ibapi model-code scoped account update streams.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(
        module = "vibe_trader.adapters.interactive_brokers",
        from_py_object,
        rename_all = "SCREAMING_SNAKE_CASE"
    )
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass_enum(
        module = "vibe_trader.adapters.interactive_brokers"
    )
)]
pub enum IbAccountUpdateMultiEvent {
    AccountMultiValue,
    End,
}
