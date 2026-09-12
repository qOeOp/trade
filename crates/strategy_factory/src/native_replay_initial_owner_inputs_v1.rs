//! Fixed Strategy Factory adapter for the first Native Replay Market Data Owner read.

use thiserror::Error;
use vibe_data::owner::{
    instrument_master_v2::InstrumentMasterReadbackV2,
    native_replay_scheduling_v1::{
        NativeReplayInitialMarketReadbackV1, NativeReplayInitialMarketRequestV1,
        NativeReplayInitialUniverseRoleV1, NativeReplaySchedulingResolverV1,
    },
    source_binding::BindingDigest,
    strategy_input_binding::{MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit},
};
use vibe_model::identifiers::InstrumentId;

use crate::{
    native_replay_preparation_inputs_v2::NativeReplayPreparationInputsV2,
    strategy_design_v2::{InputFactClassV2, InputScopeV2},
    strategy_plan_v2::{StrategyPlanV2, strategy_input_role_identity_v2},
};

const MEMBER_COUNT: usize = 2;

#[derive(Debug, Error)]
pub(crate) enum NativeReplayInitialOwnerInputsErrorV1 {
    #[error("Native Replay initial Owner inputs are unavailable")]
    Unavailable,
}

pub(crate) async fn resolve_native_replay_initial_owner_inputs_v1<R>(
    preparation: &NativeReplayPreparationInputsV2,
    plan: &StrategyPlanV2,
    instrument_master: &InstrumentMasterReadbackV2,
    resolver: &R,
) -> Result<NativeReplayInitialMarketReadbackV1, NativeReplayInitialOwnerInputsErrorV1>
where
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let replay = preparation.replay().request().as_dto();
    let selection = plan
        .universe_selection()
        .ok_or(NativeReplayInitialOwnerInputsErrorV1::Unavailable)?;
    let request_selection_identity = parse_sha256(replay.universe_selection.identity.as_str())?;
    let request_selection_digest = parse_sha256(replay.universe_selection.digest.as_str())?;
    let snapshot_identity = parse_sha256(replay.pit_snapshot.identity.as_str())?;
    let snapshot_fact_digest = parse_sha256(replay.pit_snapshot.digest.as_str())?;
    let master_members = instrument_master.cut().members();
    if selection.selection_identity().as_bytes() != &request_selection_identity
        || selection.selection_digest().as_bytes() != &request_selection_digest
        || selection.members().len() != MEMBER_COUNT
        || !selection
            .members()
            .iter()
            .zip(master_members)
            .all(|(selected, master)| selected.instrument() == master.fact().canonical_identity())
    {
        return Err(NativeReplayInitialOwnerInputsErrorV1::Unavailable);
    }

    let roles = plan
        .input_roles()
        .iter()
        .map(|role| {
            if role.fact_class != InputFactClassV2::MarketData
                || role.scope != InputScopeV2::UniverseMembers
            {
                return Err(NativeReplayInitialOwnerInputsErrorV1::Unavailable);
            }
            let field_semantic = MarketDataFieldSemantic::from_identity(&role.field_semantic_id)
                .ok_or(NativeReplayInitialOwnerInputsErrorV1::Unavailable)?;
            let channel = match role.channel.as_str() {
                "MARKET" => StrategyInputChannel::Market,
                "REFERENCE" => StrategyInputChannel::Reference,
                "ECONOMIC" => StrategyInputChannel::Economic,
                _ => return Err(NativeReplayInitialOwnerInputsErrorV1::Unavailable),
            };
            let unit = match role.unit.as_str() {
                "PRICE" => StrategyInputUnit::Price,
                "QUANTITY" => StrategyInputUnit::Quantity,
                "SCALAR" => StrategyInputUnit::Scalar,
                _ => return Err(NativeReplayInitialOwnerInputsErrorV1::Unavailable),
            };
            Ok(NativeReplayInitialUniverseRoleV1::new(
                strategy_input_role_identity_v2(role),
                field_semantic,
                channel,
                role.timeframe.clone(),
                unit,
                role.scale,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let member_instruments = master_members
        .iter()
        .map(|member| {
            member
                .fact()
                .canonical_identity()
                .parse::<InstrumentId>()
                .map_err(|_| NativeReplayInitialOwnerInputsErrorV1::Unavailable)
        })
        .collect::<Result<Vec<_>, _>>()?
        .try_into()
        .map_err(|_| NativeReplayInitialOwnerInputsErrorV1::Unavailable)?;
    let request = NativeReplayInitialMarketRequestV1::new(
        BindingDigest::from_untrusted_bytes(snapshot_identity),
        BindingDigest::from_untrusted_bytes(snapshot_fact_digest),
        plan.research_request_identity(),
        plan.design_identity(),
        selection.selection_identity(),
        selection.selection_digest(),
        selection.instrument_master_digest(),
        selection.source_binding_lineage_root(),
        selection.market_semantics_identity(),
        roles,
        member_instruments,
        replay.window.start_event_ns,
        replay.window.end_event_ns_exclusive,
    );
    resolver
        .resolve_native_replay_initial_market_inputs_v1(&request)
        .await
        .map_err(|_| NativeReplayInitialOwnerInputsErrorV1::Unavailable)
}

fn parse_sha256(value: &str) -> Result<[u8; 32], NativeReplayInitialOwnerInputsErrorV1> {
    let hex = value
        .strip_prefix("sha256:")
        .ok_or(NativeReplayInitialOwnerInputsErrorV1::Unavailable)?;
    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(NativeReplayInitialOwnerInputsErrorV1::Unavailable);
    }
    let mut bytes = [0_u8; 32];
    for (output, pair) in bytes.iter_mut().zip(hex.as_bytes().chunks_exact(2)) {
        let nibble = |byte| match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            _ => unreachable!("canonical hexadecimal was checked above"),
        };
        *output = (nibble(pair[0]) << 4) | nibble(pair[1]);
    }
    Ok(bytes)
}
