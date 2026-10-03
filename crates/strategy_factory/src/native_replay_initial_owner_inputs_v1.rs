//! Fixed Strategy Factory adapter for the first Native Replay Market Data Owner read.

use thiserror::Error;
use vibe_data::owner::{
    instrument_master_v2::InstrumentMasterReadbackV2,
    native_replay_scheduling_v1::{
        NativeReplayInitialMarketReadbackV1, NativeReplayInitialMarketRequestV1,
        NativeReplayInitialUniverseRoleV1, NativeReplaySchedulingErrorV1,
        NativeReplaySchedulingResolverV1,
    },
    source_binding::BindingDigest,
    strategy_input_binding::{MarketDataFieldSemantic, StrategyInputChannel, StrategyInputUnit},
};
use vibe_model::identifiers::InstrumentId;

use crate::{
    native_replay_preparation_inputs_v2::NativeReplayPreparationInputsV2,
    strategy_design_v2::{InputFactClassV2, InputScopeV2},
    strategy_plan_v2::{StrategyPlanV2, strategy_input_role_identity_v2},
    target_set_members::is_admitted_member_count,
};

/// Why the initial Owner inputs of a native Replay are unavailable, one variant per refusal.
///
/// Each refusal is named rather than folded into one: callers report the error's text as the
/// cause of their own refusal coordinate, and that text is the only record of which check failed.
/// Market Data's refusal is carried as Market Data stated it.
#[derive(Debug, Error)]
pub(crate) enum NativeReplayInitialOwnerInputsErrorV1 {
    #[error("the Plan binds no Owner universe selection")]
    PlanHasNoUniverseSelection,
    #[error("the Replay's {0} is not a canonical sha256 content coordinate")]
    ReplayCoordinateMalformed(&'static str),
    #[error("the Plan's universe selection holds {0} members, a count no native Replay admits")]
    MemberCountNotAdmitted(usize),
    #[error("the Plan's universe selection and the Instrument Master cut name different members")]
    MembersDisagreeWithInstrumentMaster,
    #[error("the Plan's input role {0} is not a Market Data role over the universe members")]
    RoleNotUniverseMarketData(String),
    #[error("the Plan's input role {role} states an unknown {coordinate}")]
    RoleCoordinateUnknown {
        role: String,
        coordinate: &'static str,
    },
    #[error("the Instrument Master cut's member {0} is not a canonical instrument")]
    MemberInstrumentMalformed(String),
    #[error("Market Data refused the initial market inputs: {0}")]
    MarketData(#[from] NativeReplaySchedulingErrorV1),
}

pub(crate) async fn resolve_native_replay_initial_owner_inputs_v1<R>(
    preparation: &NativeReplayPreparationInputsV2,
    plan: &StrategyPlanV2,
    instrument_master: &InstrumentMasterReadbackV2,
    resolver: &R,
) -> Result<
    (
        NativeReplayInitialMarketRequestV1,
        NativeReplayInitialMarketReadbackV1,
    ),
    NativeReplayInitialOwnerInputsErrorV1,
>
where
    R: NativeReplaySchedulingResolverV1 + ?Sized,
{
    let replay = preparation.replay().request().as_dto();
    let selection = plan
        .universe_selection()
        .ok_or(NativeReplayInitialOwnerInputsErrorV1::PlanHasNoUniverseSelection)?;
    // The Replay names the Universe Selection Record its composition depends on, not the
    // strategy-input selection the Plan was bound under; the two are different objects with
    // different identities. Both go to Market Data, which checks each against the frame's
    // verified batch.
    let record_identity = parse_sha256(
        replay.universe_selection.identity.as_str(),
        "universe selection identity",
    )?;
    let record_digest = parse_sha256(
        replay.universe_selection.digest.as_str(),
        "universe selection digest",
    )?;
    let snapshot_identity = parse_sha256(
        replay.pit_snapshot.identity.as_str(),
        "PIT snapshot identity",
    )?;
    let snapshot_fact_digest =
        parse_sha256(replay.pit_snapshot.digest.as_str(), "PIT snapshot digest")?;
    let master_members = instrument_master.cut().members();

    if !is_admitted_member_count(selection.members().len()) {
        return Err(
            NativeReplayInitialOwnerInputsErrorV1::MemberCountNotAdmitted(
                selection.members().len(),
            ),
        );
    }

    if !members_agree(
        selection.members().iter().map(|member| member.instrument()),
        master_members
            .iter()
            .map(|member| member.fact().canonical_identity()),
    ) {
        return Err(NativeReplayInitialOwnerInputsErrorV1::MembersDisagreeWithInstrumentMaster);
    }

    let roles = plan
        .input_roles()
        .iter()
        .map(|role| {
            let unknown =
                |coordinate| NativeReplayInitialOwnerInputsErrorV1::RoleCoordinateUnknown {
                    role: role.semantic_id.clone(),
                    coordinate,
                };

            if role.fact_class != InputFactClassV2::MarketData
                || role.scope != InputScopeV2::UniverseMembers
            {
                return Err(
                    NativeReplayInitialOwnerInputsErrorV1::RoleNotUniverseMarketData(
                        role.semantic_id.clone(),
                    ),
                );
            }
            let field_semantic = MarketDataFieldSemantic::from_identity(&role.field_semantic_id)
                .ok_or_else(|| unknown("field semantic"))?;
            let channel = match role.channel.as_str() {
                "MARKET" => StrategyInputChannel::Market,
                "REFERENCE" => StrategyInputChannel::Reference,
                "ECONOMIC" => StrategyInputChannel::Economic,
                _ => return Err(unknown("channel")),
            };
            let unit = match role.unit.as_str() {
                "PRICE" => StrategyInputUnit::Price,
                "QUANTITY" => StrategyInputUnit::Quantity,
                "SCALAR" => StrategyInputUnit::Scalar,
                _ => return Err(unknown("unit")),
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
            let instrument = member.fact().canonical_identity();
            instrument.parse::<InstrumentId>().map_err(|_| {
                NativeReplayInitialOwnerInputsErrorV1::MemberInstrumentMalformed(
                    instrument.to_owned(),
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let request = NativeReplayInitialMarketRequestV1::new(
        BindingDigest::from_untrusted_bytes(snapshot_identity),
        BindingDigest::from_untrusted_bytes(snapshot_fact_digest),
        plan.research_request_identity(),
        plan.design_identity(),
        selection.selection_identity(),
        selection.selection_digest(),
        BindingDigest::from_untrusted_bytes(record_identity),
        BindingDigest::from_untrusted_bytes(record_digest),
        selection.instrument_master_digest(),
        selection.source_binding_lineage_root(),
        selection.market_semantics_identity(),
        roles,
        member_instruments,
        replay.window.start_event_ns,
        replay.window.end_event_ns_exclusive,
    );
    // The request leaves with the readback it produced, by value, in one move. A later caller
    // needing the request to resolve the window's whole frame sequence takes it from here rather
    // than rebuilding an equivalent one, because "equivalent" would be a proposition with no
    // prover, and reading it back a second time is the same fault the sequence resolver exists to
    // prevent. Pairing them in one return makes that correspondence hold by construction instead
    // of by a check somebody has to remember to run.
    let readback = resolver
        .resolve_native_replay_initial_market_inputs_v1(&request)
        .await?;
    Ok((request, readback))
}

fn parse_sha256(
    value: &str,
    coordinate: &'static str,
) -> Result<[u8; 32], NativeReplayInitialOwnerInputsErrorV1> {
    let malformed = NativeReplayInitialOwnerInputsErrorV1::ReplayCoordinateMalformed(coordinate);
    let hex = value.strip_prefix("sha256:").ok_or(malformed)?;

    if hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(NativeReplayInitialOwnerInputsErrorV1::ReplayCoordinateMalformed(coordinate));
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

/// Whether a selection and an Instrument Master cut name the same instruments, in the same order.
///
/// Both lengths are compared before the members are. `zip` stops at the shorter side, so without
/// that a one-member cut would agree with a two-member selection on its first member alone - the
/// length used to be fixed by both sides' types, and once a cut may hold one member it is not.
fn members_agree<'a>(
    selected: impl ExactSizeIterator<Item = &'a str>,
    master: impl ExactSizeIterator<Item = &'a str>,
) -> bool {
    selected.len() == master.len() && selected.zip(master).all(|(left, right)| left == right)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use rstest::rstest;
    use vibe_data::owner::native_replay_scheduling_v1::NativeReplaySchedulingErrorV1;

    use super::{NativeReplayInitialOwnerInputsErrorV1 as Refusal, members_agree, parse_sha256};

    #[rstest]
    #[case::same_two(&["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"], &["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"], true)]
    #[case::same_one(&["BTCUSDT-PERP.BINANCE"], &["BTCUSDT-PERP.BINANCE"], true)]
    #[case::one_member_cut_under_a_two_member_selection(&["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"], &["BTCUSDT-PERP.BINANCE"], false)]
    #[case::two_member_cut_under_a_one_member_selection(&["BTCUSDT-PERP.BINANCE"], &["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"], false)]
    #[case::another_member(&["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"], &["BTCUSDT-PERP.BINANCE", "SOLUSDT-PERP.BINANCE"], false)]
    fn a_selection_and_a_cut_agree_only_on_the_same_members(
        #[case] selected: &[&str],
        #[case] master: &[&str],
        #[case] agree: bool,
    ) {
        assert_eq!(
            members_agree(selected.iter().copied(), master.iter().copied()),
            agree
        );
    }

    /// Callers report a refusal's text as the cause of their own coordinate, so each refusal must
    /// read differently from every other; the Owner warning is the only place that says which
    /// check failed. The two that decide F's H8 are on this list: a Plan whose members disagree
    /// with the Instrument Master cut, and Market Data refusing a Replay that names another
    /// Universe Selection Record than the frame's batch binds.
    #[rstest]
    fn each_refusal_reads_differently_and_market_datas_arrives_as_it_stated_it() {
        let record_mismatch = NativeReplaySchedulingErrorV1::UniverseSelectionRecordMismatch;
        let refusals = [
            Refusal::PlanHasNoUniverseSelection,
            Refusal::ReplayCoordinateMalformed("universe selection identity"),
            Refusal::ReplayCoordinateMalformed("PIT snapshot digest"),
            Refusal::MemberCountNotAdmitted(3),
            Refusal::MembersDisagreeWithInstrumentMaster,
            Refusal::RoleNotUniverseMarketData("close".to_owned()),
            Refusal::RoleCoordinateUnknown {
                role: "close".to_owned(),
                coordinate: "unit",
            },
            Refusal::MemberInstrumentMalformed("LINKUSDT".to_owned()),
            Refusal::from(NativeReplaySchedulingErrorV1::OwnerBindingMismatch),
            Refusal::from(record_mismatch),
        ];
        let texts = refusals
            .iter()
            .map(ToString::to_string)
            .collect::<BTreeSet<_>>();

        assert_eq!(texts.len(), refusals.len(), "{texts:#?}");
        let Refusal::MarketData(carried) = &refusals[refusals.len() - 1] else {
            panic!("a Market Data refusal converts into its own variant");
        };
        assert_eq!(carried, &record_mismatch);
        assert!(
            refusals[refusals.len() - 1]
                .to_string()
                .ends_with(&record_mismatch.to_string())
        );
    }

    #[rstest]
    #[case::canonical(&format!("sha256:{}", "ab".repeat(32)), Some([0xab; 32]))]
    #[case::another_algorithm(&format!("blake3:{}", "ab".repeat(32)), None)]
    #[case::uppercase(&format!("sha256:{}", "AB".repeat(32)), None)]
    #[case::short(&format!("sha256:{}", "ab".repeat(31)), None)]
    fn a_replay_coordinate_parses_only_as_canonical_sha256_and_names_itself_when_it_does_not(
        #[case] value: &str,
        #[case] expected: Option<[u8; 32]>,
    ) {
        match (parse_sha256(value, "PIT snapshot identity"), expected) {
            (Ok(bytes), Some(expected)) => assert_eq!(bytes, expected),
            (Err(Refusal::ReplayCoordinateMalformed(coordinate)), None) => {
                assert_eq!(coordinate, "PIT snapshot identity");
            }
            (answer, expected) => panic!("{answer:?} for {expected:?}"),
        }
    }
}
