//! Binance instrument projection and derived-catalog custody for Program consumers.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use anyhow::Context;
use vibe_binance::common::{enums::BinanceProductType, symbol::format_instrument_id};
use vibe_model::{
    data::{BarType, CustomData},
    identifiers::{InstrumentId, Symbol},
    instruments::{InstrumentAny, crypto_perpetual::CryptoPerpetual, currency_pair::CurrencyPair},
    types::{Currency, Price, Quantity},
};

pub(crate) struct PreparedBinanceProgramDataset {
    pub(crate) catalog_root: PathBuf,
    pub(crate) bar_types: BTreeSet<BarType>,
    pub(crate) instruments: BTreeMap<InstrumentId, InstrumentAny>,
    pub(crate) custom_data: Vec<CustomData>,
    pub(crate) source_manifest_digest: String,
    pub(crate) source_event_count: usize,
    pub(crate) executable_bar_count: usize,
}

pub(crate) fn validate_derived_catalog_target(
    raw_root: &Path,
    target: &Path,
) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(
        fs::symlink_metadata(target).is_err(),
        "derived catalog target must be new"
    );
    let parent = target.parent().context("derived target has no parent")?;
    anyhow::ensure!(
        target.file_name().is_some() && !parent.as_os_str().is_empty(),
        "derived target must name a child directory"
    );
    let metadata = fs::symlink_metadata(parent)?;
    anyhow::ensure!(
        metadata.is_dir() && !metadata.file_type().is_symlink(),
        "derived parent must be a real directory"
    );
    let raw = fs::canonicalize(raw_root)?;
    let target = fs::canonicalize(parent)?.join(target.file_name().unwrap());
    anyhow::ensure!(
        !target.starts_with(&raw) && !raw.starts_with(&target),
        "raw and derived custody must be disjoint"
    );
    Ok(target)
}

pub(crate) fn binance_program_instruments<'a>(
    bindings: impl Iterator<Item = (BinanceProductType, &'a str)>,
) -> anyhow::Result<Vec<InstrumentAny>> {
    let mut unique = BTreeMap::new();
    for (product, symbol) in bindings {
        let instrument_id = format_instrument_id(&symbol.into(), product);
        if let Some(previous) = unique.insert(instrument_id, (product, symbol)) {
            anyhow::ensure!(
                previous == (product, symbol),
                "instrument binding collision"
            );
        }
    }
    unique
        .into_values()
        .map(|(product, symbol)| {
            let base = symbol
                .strip_suffix("USDT")
                .context("Program symbol is not USDT quoted")?;
            let instrument_id = format_instrument_id(&symbol.into(), product);
            let instrument = match product {
                BinanceProductType::UsdM => InstrumentAny::CryptoPerpetual(
                    CryptoPerpetual::builder()
                        .instrument_id(instrument_id)
                        .raw_symbol(Symbol::from(symbol))
                        .base_currency(Currency::get_or_create_crypto(base))
                        .quote_currency(Currency::from("USDT"))
                        .settlement_currency(Currency::from("USDT"))
                        .is_inverse(false)
                        .price_precision(8)
                        .size_precision(8)
                        .price_increment(Price::from("0.00000001"))
                        .size_increment(Quantity::from("0.00000001"))
                        .min_quantity(Quantity::from("0.00000001"))
                        .margin_init("0.1".parse()?)
                        .margin_maint("0.05".parse()?)
                        .maker_fee("0.0002".parse()?)
                        .taker_fee("0.0004".parse()?)
                        .ts_event(0.into())
                        .ts_init(0.into())
                        .build()?,
                ),
                BinanceProductType::Spot => InstrumentAny::CurrencyPair(
                    CurrencyPair::builder()
                        .instrument_id(instrument_id)
                        .raw_symbol(Symbol::from(symbol))
                        .base_currency(Currency::get_or_create_crypto(base))
                        .quote_currency(Currency::from("USDT"))
                        .price_precision(8)
                        .size_precision(8)
                        .price_increment(Price::from("0.00000001"))
                        .size_increment(Quantity::from("0.00000001"))
                        .maker_fee("0.0002".parse()?)
                        .taker_fee("0.0004".parse()?)
                        .ts_event(0.into())
                        .ts_init(0.into())
                        .build()?,
                ),
                _ => anyhow::bail!("unsupported Binance Program product {product}"),
            };
            Ok(instrument)
        })
        .collect()
}
