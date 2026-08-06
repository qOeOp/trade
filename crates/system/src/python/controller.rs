use std::{
    cell::RefCell,
    rc::{Rc, Weak},
};

use pyo3::prelude::*;
use pyo3_stub_gen::derive::{gen_stub_pyclass, gen_stub_pymethods};
use vibe_common::{
    actor::data_actor::{DataActorConfig, ImportableActorConfig},
    python::actor::PyDataActor,
};
use vibe_core::python::to_pyruntime_err;
use vibe_model::identifiers::{ActorId, StrategyId};
use vibe_trading::ImportableStrategyConfig;

use crate::{controller::Controller, trader::Trader};

/// Provides a trading controller for managing actors and strategies at runtime.
///
/// Subclass this to author a controller in Python. The trader reference is bound when the
/// controller is registered, so control methods are only available from that point on.
#[gen_stub_pyclass(module = "vibe_trader.trading")]
#[pyclass(
    module = "vibe_trader.trading",
    name = "Controller",
    extends = PyDataActor,
    subclass,
    unsendable
)]
#[derive(Debug, Default)]
pub struct PyController {
    trader: Option<Weak<RefCell<Trader>>>,
}

impl PyController {
    pub(crate) fn bind_trader(&mut self, trader: &Rc<RefCell<Trader>>) {
        self.trader = Some(Rc::downgrade(trader));
    }
}

/// Returns a Rust controller carrying this controller's identity, which
/// [`Controller::remove_actor`] needs to refuse removing the controller itself.
fn controller_for(slf: &PyRef<'_, PyController>) -> PyResult<Controller> {
    let trader = slf
        .trader
        .as_ref()
        .ok_or_else(|| to_pyruntime_err("Controller is not registered with a trader"))?
        .upgrade()
        .ok_or_else(|| to_pyruntime_err("Controller trader is no longer available"))?;

    Ok(Controller::new(
        trader,
        Some(DataActorConfig {
            actor_id: Some(slf.as_super().actor_id()),
            ..Default::default()
        }),
    ))
}

#[gen_stub_pymethods]
#[pymethods]
#[allow(
    clippy::needless_pass_by_value,
    reason = "PyO3 and the stub generator only recognize an owned `PyRef<'_, Self>` as the receiver"
)]
impl PyController {
    #[new]
    #[gen_stub(override_return_type(type_repr = "typing.Self", imports = ("typing",)))]
    #[pyo3(signature = (config=None))]
    fn py_new(config: Option<Py<PyAny>>) -> PyClassInitializer<Self> {
        PyClassInitializer::from(PyDataActor::from_py_config(config)).add_subclass(Self::default())
    }

    #[pyo3(name = "create_actor_from_config", signature = (actor_config, start=true))]
    fn py_create_actor_from_config(
        slf: PyRef<'_, Self>,
        actor_config: ImportableActorConfig,
        start: bool,
    ) -> PyResult<ActorId> {
        controller_for(&slf)?
            .create_actor_from_config(&actor_config, start)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "create_strategy_from_config", signature = (strategy_config, start=true))]
    fn py_create_strategy_from_config(
        slf: PyRef<'_, Self>,
        strategy_config: ImportableStrategyConfig,
        start: bool,
    ) -> PyResult<StrategyId> {
        controller_for(&slf)?
            .create_strategy_from_config(&strategy_config, start)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "start_actor")]
    fn py_start_actor(slf: PyRef<'_, Self>, actor_id: ActorId) -> PyResult<()> {
        controller_for(&slf)?
            .start_actor(&actor_id)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "start_actor_from_id")]
    fn py_start_actor_from_id(slf: PyRef<'_, Self>, actor_id: ActorId) -> PyResult<()> {
        Self::py_start_actor(slf, actor_id)
    }

    #[pyo3(name = "stop_actor")]
    fn py_stop_actor(slf: PyRef<'_, Self>, actor_id: ActorId) -> PyResult<()> {
        controller_for(&slf)?
            .stop_actor(&actor_id)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "stop_actor_from_id")]
    fn py_stop_actor_from_id(slf: PyRef<'_, Self>, actor_id: ActorId) -> PyResult<()> {
        Self::py_stop_actor(slf, actor_id)
    }

    #[pyo3(name = "remove_actor")]
    fn py_remove_actor(slf: PyRef<'_, Self>, actor_id: ActorId) -> PyResult<()> {
        controller_for(&slf)?
            .remove_actor(&actor_id)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "remove_actor_from_id")]
    fn py_remove_actor_from_id(slf: PyRef<'_, Self>, actor_id: ActorId) -> PyResult<()> {
        Self::py_remove_actor(slf, actor_id)
    }

    #[pyo3(name = "start_strategy")]
    fn py_start_strategy(slf: PyRef<'_, Self>, strategy_id: StrategyId) -> PyResult<()> {
        controller_for(&slf)?
            .start_strategy(&strategy_id)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "start_strategy_from_id")]
    fn py_start_strategy_from_id(slf: PyRef<'_, Self>, strategy_id: StrategyId) -> PyResult<()> {
        Self::py_start_strategy(slf, strategy_id)
    }

    #[pyo3(name = "stop_strategy")]
    fn py_stop_strategy(slf: PyRef<'_, Self>, strategy_id: StrategyId) -> PyResult<()> {
        controller_for(&slf)?
            .stop_strategy(&strategy_id)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "stop_strategy_from_id")]
    fn py_stop_strategy_from_id(slf: PyRef<'_, Self>, strategy_id: StrategyId) -> PyResult<()> {
        Self::py_stop_strategy(slf, strategy_id)
    }

    #[pyo3(name = "market_exit_strategy")]
    fn py_market_exit_strategy(slf: PyRef<'_, Self>, strategy_id: StrategyId) -> PyResult<()> {
        controller_for(&slf)?
            .exit_market(&strategy_id)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "market_exit_strategy_from_id")]
    fn py_market_exit_strategy_from_id(
        slf: PyRef<'_, Self>,
        strategy_id: StrategyId,
    ) -> PyResult<()> {
        Self::py_market_exit_strategy(slf, strategy_id)
    }

    #[pyo3(name = "remove_strategy")]
    fn py_remove_strategy(slf: PyRef<'_, Self>, strategy_id: StrategyId) -> PyResult<()> {
        controller_for(&slf)?
            .remove_strategy(&strategy_id)
            .map_err(to_pyruntime_err)
    }

    #[pyo3(name = "remove_strategy_from_id")]
    fn py_remove_strategy_from_id(slf: PyRef<'_, Self>, strategy_id: StrategyId) -> PyResult<()> {
        Self::py_remove_strategy(slf, strategy_id)
    }
}

/// Binds the registered trader to a user-authored Python controller instance.
pub(crate) fn bind_controller_trader(
    python_controller: &Py<PyAny>,
    trader: &Rc<RefCell<Trader>>,
) -> anyhow::Result<()> {
    Python::attach(|py| -> anyhow::Result<()> {
        let mut controller = python_controller
            .bind(py)
            .extract::<PyRefMut<PyController>>()
            .map_err(|e| {
                anyhow::anyhow!(
                    "Controller must inherit from `vibe_trader.trading.Controller`: {e}"
                )
            })?;

        controller.bind_trader(trader);

        Ok(())
    })
}
