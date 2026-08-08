//! Factory functions for creating Binance clients and components.

use std::{cell::RefCell, rc::Rc};

use vibe_common::{
    cache::CacheView,
    clients::{DataClient, ExecutionClient},
    clock::Clock,
    factories::{ClientConfig, DataClientFactory, ExecutionClientFactory},
};
use vibe_live::ExecutionClientCore;
use vibe_model::{
    enums::{AccountType, OmsType},
    identifiers::ClientId,
};

use crate::{
    common::{
        consts::{BINANCE, BINANCE_VENUE},
        enums::BinanceProductType,
    },
    config::{BinanceDataClientConfig, BinanceExecClientConfig},
    futures::{data::BinanceFuturesDataClient, execution::BinanceFuturesExecutionClient},
    spot::{data::BinanceSpotDataClient, execution::BinanceSpotExecutionClient},
};

/// Factory for creating Binance data clients.
#[derive(Debug, Clone)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.binance", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.adapters.binance")
)]
pub struct BinanceDataClientFactory;

impl BinanceDataClientFactory {
    /// Creates a new [`BinanceDataClientFactory`] instance.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for BinanceDataClientFactory {
    fn default() -> Self {
        Self::new()
    }
}

impl DataClientFactory for BinanceDataClientFactory {
    fn create(
        &self,
        name: &str,
        config: &dyn ClientConfig,
        _cache: CacheView,
        _clock: Rc<RefCell<dyn Clock>>,
    ) -> anyhow::Result<Box<dyn DataClient>> {
        let binance_config = config
            .as_any()
            .downcast_ref::<BinanceDataClientConfig>()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid config type for BinanceDataClientFactory. Expected BinanceDataClientConfig, was {config:?}",
                )
            })?
            .clone();

        let client_id = ClientId::from(name);

        binance_config.validate()?;

        let product_type = binance_config.product_type;

        match product_type {
            BinanceProductType::Spot => {
                let client = BinanceSpotDataClient::new(client_id, binance_config)?;
                Ok(Box::new(client))
            }
            BinanceProductType::UsdM | BinanceProductType::CoinM => {
                let client =
                    BinanceFuturesDataClient::new(client_id, binance_config, product_type)?;
                Ok(Box::new(client))
            }
            _ => {
                anyhow::bail!("Unsupported product type for Binance data client: {product_type:?}")
            }
        }
    }

    fn name(&self) -> &'static str {
        BINANCE
    }

    fn config_type(&self) -> &'static str {
        stringify!(BinanceDataClientConfig)
    }
}

/// Factory for creating Binance Spot execution clients.
#[derive(Debug, Clone)]
#[cfg_attr(
    feature = "python",
    pyo3::pyclass(module = "vibe_trader.adapters.binance", from_py_object)
)]
#[cfg_attr(
    feature = "python",
    pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.adapters.binance")
)]
pub struct BinanceExecutionClientFactory;

impl BinanceExecutionClientFactory {
    /// Creates a new [`BinanceExecutionClientFactory`] instance.
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for BinanceExecutionClientFactory {
    fn default() -> Self {
        Self::new()
    }
}

impl ExecutionClientFactory for BinanceExecutionClientFactory {
    fn create(
        &self,
        name: &str,
        config: &dyn ClientConfig,
        cache: CacheView,
    ) -> anyhow::Result<Box<dyn ExecutionClient>> {
        let binance_config = config
            .as_any()
            .downcast_ref::<BinanceExecClientConfig>()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid config type for BinanceExecutionClientFactory. Expected BinanceExecClientConfig, was {config:?}",
                )
            })?
            .clone();

        let product_type = binance_config.product_type;

        binance_config.validate()?;

        match product_type {
            BinanceProductType::Spot => {
                // Spot uses cash account type and hedging OMS
                let account_type = AccountType::Cash;
                let oms_type = OmsType::Hedging;

                let core = ExecutionClientCore::new(
                    binance_config.trader_id,
                    ClientId::from(name),
                    *BINANCE_VENUE,
                    oms_type,
                    binance_config.account_id,
                    account_type,
                    None, // base_currency
                    cache,
                );

                let client = BinanceSpotExecutionClient::new(core, binance_config)?;
                Ok(Box::new(client))
            }
            BinanceProductType::UsdM | BinanceProductType::CoinM => {
                let account_type = AccountType::Margin;
                let oms_type = binance_config.oms_type.unwrap_or(OmsType::Netting);

                let core = ExecutionClientCore::new(
                    binance_config.trader_id,
                    ClientId::from(name),
                    *BINANCE_VENUE,
                    oms_type,
                    binance_config.account_id,
                    account_type,
                    None, // base_currency
                    cache,
                );

                let client = BinanceFuturesExecutionClient::new(core, binance_config)?;
                Ok(Box::new(client))
            }
            _ => {
                anyhow::bail!(
                    "Unsupported product type for Binance execution client: {product_type:?}"
                )
            }
        }
    }

    fn name(&self) -> &'static str {
        BINANCE
    }

    fn config_type(&self) -> &'static str {
        stringify!(BinanceExecClientConfig)
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, rc::Rc};

    use rstest::rstest;
    use vibe_common::{
        cache::Cache,
        factories::{DataClientFactory, ExecutionClientFactory},
    };

    use super::*;

    #[rstest]
    fn test_binance_data_client_factory_creation() {
        let factory = BinanceDataClientFactory::new();
        assert_eq!(factory.name(), BINANCE);
        assert_eq!(factory.config_type(), "BinanceDataClientConfig");
    }

    #[rstest]
    fn test_binance_data_client_factory_default() {
        let factory = BinanceDataClientFactory;
        assert_eq!(factory.name(), BINANCE);
    }

    #[rstest]
    #[case(BinanceProductType::Spot, Some(OmsType::Netting), OmsType::Hedging)]
    #[case(BinanceProductType::UsdM, None, OmsType::Netting)]
    #[case(BinanceProductType::UsdM, Some(OmsType::Hedging), OmsType::Hedging)]
    fn test_binance_execution_client_factory_selects_oms_type(
        #[case] product_type: BinanceProductType,
        #[case] oms_type: Option<OmsType>,
        #[case] expected: OmsType,
    ) {
        let factory = BinanceExecutionClientFactory::new();
        let config = BinanceExecClientConfig {
            product_type,
            use_ws_trading: false,
            oms_type,
            api_key: Some("test_key".to_string()),
            api_secret: Some("test_secret".to_string()),
            ..Default::default()
        };
        let cache = Rc::new(RefCell::new(Cache::default()));

        let client = factory
            .create("BINANCE-TEST", &config, cache.into())
            .unwrap();

        assert_eq!(client.oms_type(), expected);
    }
}
