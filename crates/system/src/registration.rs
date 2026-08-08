use std::{any::type_name, fmt::Debug};

use vibe_common::{
    actor::DataActorNative,
    component::Component,
    msgbus::{Endpoint, MStr},
};
use vibe_model::identifiers::StrategyId;
use vibe_trading::strategy::{Strategy, StrategyNative};

pub(crate) fn strategy_control_endpoint(strategy_id: StrategyId) -> MStr<Endpoint> {
    format!("{strategy_id}.control").into()
}

pub(crate) fn strategy_registration_id<T>(strategy: &T) -> String
where
    T: Strategy + StrategyNative + DataActorNative + Component + Debug + 'static,
{
    StrategyNative::strategy_core(strategy)
        .config
        .strategy_id
        .map_or_else(
            || {
                let strategy_type = type_name::<T>()
                    .rsplit("::")
                    .next()
                    .unwrap_or_else(|| type_name::<T>());
                strategy_type.to_string()
            },
            |strategy_id| strategy_id.to_string(),
        )
}

pub(crate) fn base_strategy_id(strategy_id: &str) -> String {
    strategy_id
        .rsplit_once('-')
        .map_or_else(|| strategy_id.to_string(), |(base, _)| base.to_string())
}

pub(crate) fn ensure_unique_order_id_tag(
    existing_order_id_tags: &[&str],
    order_id_tag: &str,
) -> anyhow::Result<()> {
    if existing_order_id_tags.contains(&order_id_tag) {
        anyhow::bail!(
            "Strategy order_id_tag conflict for '{order_id_tag}', explicitly define unique order_id_tag values",
        );
    }

    Ok(())
}
