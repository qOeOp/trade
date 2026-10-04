//! The pure authority of one PIT window custody: what the Owner derives from a request and the
//! basis it loaded, and every refusal that needs no store to decide.
//!
//! The Owner loads the Source Binding, the Universe Selection record, the Instrument Master facts
//! of the members and its clock head; nothing here trusts a caller for any of them. The derivation
//! runs in phases, because a custody's identity must not depend on its minting cut or on the chain
//! state a resubmission meets:
//!
//! 1. [`derive_custody_v1`] checks the request and its basis and derives every identity that does
//!    not depend on the chain: timeframes, availability rules, versions, rows and the basis.
//! 2. [`DerivedCustodyV1::identity_at`] places the custody in its chain. A root names no
//!    predecessor and takes its own identity as its chain root.
//! 3. [`DerivedCustodyV1::check_against_chain`] decides a successor against the chain head it
//!    extends: the same basis, and versions that continue the cross-sections they correct.
//! 4. [`DerivedCustodyV1::resolve_at_minting_cut`] places every instant the minting cut decides,
//!    and refuses a row retrieved after that cut.
//!
//! Retrieval instants and routes are custody evidence. They enter the evidence digest and the
//! custody digest, never an identity, so the same versions resubmitted with other retrieval
//! evidence derive the same identity. An availability the rule sets to the retrieval instant is
//! the minting cut, and enters an identity as that rule's tag rather than as an instant, for the
//! same reason.

use std::collections::{BTreeMap, BTreeSet};

use sha2::{Digest as _, Sha256};

use super::{
    CrossSectionVersionKindV1, PIT_WINDOW_CUSTODY_MAX_MEMBERS_V1, PitWindowCustodyRefusalV1,
    UntrustedPitWindowCustodyRequestV1,
};
use crate::owner::{
    bar_schedule::{BarScheduleClockV1, BarScheduleKindV1, BarScheduleLabelV1},
    decimal_rescale_v1::{MARKET_DATA_VALUE_SCALE_V1, RescaleErrorV1, rescale_exact_v1},
    declared_bar_timeframe_v1::{DeclaredBarShapeV1, DeclaredBarTimeframeV1},
    instrument_master::InstrumentClass,
    market_semantics::{
        MarketSemanticsPriceAdjustmentV1, MarketSemanticsTimestampBasisV1, MarketSemanticsValueV1,
    },
    sample_fact::{continuous_bar_timeframe_spec_v1, v2::SampleRowInputV2},
    source_binding::{
        BindingDigest, UntrustedCompleteFrontier, UntrustedSourceAvailabilityRuleV1,
        UntrustedSourceBarTimeframeV1, UntrustedSourceVisibilityV1,
        authority::availability_rule_digest_v1,
    },
    strategy_input_binding::{MarketDataFieldSemantic, STRATEGY_INPUT_FIXED_I128_LE_V1},
};

use PitWindowCustodyRefusalV1 as Refused;

const ROW_DOMAIN: &[u8] = b"market-data.pit-window-row.v1\0";
const TIMEFRAME_DOMAIN: &[u8] = b"market-data.pit-window-timeframe.v1\0";
const VERSION_DOMAIN: &[u8] = b"market-data.pit-window-cross-section.v1\0";
const INSTRUMENT_MASTER_KEY_DOMAIN: &[u8] = b"market-data.pit-window-instrument-master-key.v1\0";
const BASIS_DOMAIN: &[u8] = b"market-data.pit-window-custody-basis.v1\0";
const CUSTODY_DOMAIN: &[u8] = b"market-data.pit-window-custody.v1\0";
const EVIDENCE_DOMAIN: &[u8] = b"market-data.pit-window-custody-evidence.v1\0";
const RECORD_DOMAIN: &[u8] = b"market-data.pit-window-custody-record.v1\0";

/// The longest retrieval route one row may state.
pub(crate) const MAX_RETRIEVAL_ROUTE_BYTES_V1: usize = 128;

/// The fields one member's BAR cross-section holds, in the order a version binds its rows.
const BAR_FIELDS_V1: [MarketDataFieldSemantic; 5] = [
    MarketDataFieldSemantic::BarOpenPrice,
    MarketDataFieldSemantic::BarHighPrice,
    MarketDataFieldSemantic::BarLowPrice,
    MarketDataFieldSemantic::BarClosePrice,
    MarketDataFieldSemantic::BarVolumeQuantity,
];

/// Channel and data-kind codes a custody row carries, as `SampleFactV1` encodes them.
const MARKET_CHANNEL_CODE: u8 = 0x01;
const BAR_DATA_KIND_CODE: u8 = 0x01;

const ZERO: BindingDigest = BindingDigest::from_untrusted_bytes([0; 32]);

/// The verified Source Binding a request names, as the Owner loaded it.
#[derive(Clone, Debug)]
pub(crate) struct CustodyBindingV1 {
    /// Whether the stored binding is admitted and its locator is exactly the request's.
    pub(crate) admitted_under_locator: bool,
    pub(crate) binding_id: BindingDigest,
    pub(crate) fact_digest: BindingDigest,
    pub(crate) lineage_root: BindingDigest,
    pub(crate) lineage_version: u64,
    pub(crate) availability_rule: Option<UntrustedSourceAvailabilityRuleV1>,
    pub(crate) bar_timeframes: Vec<UntrustedSourceBarTimeframeV1>,
    /// The Market Semantics compatibility identity the binding's semantics imply.
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) source_frontier_digest: BindingDigest,
    pub(crate) correction_stream: String,
    pub(crate) correction_frontier_digest: BindingDigest,
    /// The binding's complete source and correction frontiers, as its chain's R0 record binds them.
    pub(crate) source_frontier: UntrustedCompleteFrontier,
    pub(crate) correction_frontier: UntrustedCompleteFrontier,
}

/// The Instrument Master fact the Owner selects for one member at the window's start.
#[derive(Clone, Debug)]
pub(crate) struct CustodyMemberFactV1 {
    pub(crate) fact_digest: BindingDigest,
    pub(crate) class: InstrumentClass,
    pub(crate) time_zone: String,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) effective_until: Option<i128>,
}

/// What the Instrument Master selects for one member at the window's first and last instants.
#[derive(Clone, Debug)]
pub(crate) struct CustodyInstrumentV1 {
    /// `None` when no fact is in force and observable at the window's start.
    pub(crate) at_start: Option<CustodyMemberFactV1>,
    /// The fact selected at the window's last instant, `None` when there is none.
    pub(crate) at_end: Option<BindingDigest>,
    /// Every other fact of the member observable at the cut, except those the selected fact
    /// supersedes: none of them may be in force anywhere inside the window.
    pub(crate) others: Vec<CustodyFactSpanV1>,
}

/// When one Instrument Master fact is in force.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CustodyFactSpanV1 {
    pub(crate) effective_from: i128,
    pub(crate) effective_until: Option<i128>,
}

/// One historical membership record of the Universe Selection record a request names.
#[derive(Clone, Debug)]
pub(crate) struct CustodyMembershipV1 {
    pub(crate) instrument: Vec<u8>,
    pub(crate) included: bool,
    pub(crate) effective_from_ns: i128,
    pub(crate) effective_until_ns: Option<i128>,
}

/// Everything a custody is derived from: the request and what the Owner loaded for it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CustodyInputsV1<'a> {
    pub(crate) request: &'a UntrustedPitWindowCustodyRequestV1,
    /// `None` when no binding is stored under the request's binding identity.
    pub(crate) binding: Option<&'a CustodyBindingV1>,
    /// One entry per member, in member order.
    pub(crate) instruments: &'a [CustodyInstrumentV1],
    pub(crate) membership: &'a [CustodyMembershipV1],
}

/// One stored cross-section version of the chain a successor extends.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StoredVersionV1 {
    pub(crate) identity: BindingDigest,
    pub(crate) timeframe_identity: BindingDigest,
    pub(crate) event_ns: u64,
    pub(crate) kind: CrossSectionVersionKindV1,
    pub(crate) correction_sequence: u64,
    pub(crate) predecessor: Option<BindingDigest>,
    pub(crate) publication_ns: u64,
}

/// The chain a successor extends, read at its head.
#[derive(Clone, Debug)]
pub(crate) struct StoredChainV1 {
    pub(crate) chain_root: BindingDigest,
    pub(crate) head_identity: BindingDigest,
    pub(crate) head_version: u64,
    pub(crate) head_basis_digest: BindingDigest,
    /// Every version of every custody in the chain.
    pub(crate) versions: Vec<StoredVersionV1>,
}

/// An instant the availability rule decides: a derived instant, or the minting cut.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CustodyInstantV1 {
    At(u64),
    MintingCut,
}

impl CustodyInstantV1 {
    const fn resolve(self, minting_cut: u64) -> u64 {
        match self {
            Self::At(instant) => instant,
            Self::MintingCut => minting_cut,
        }
    }

    fn encode(self, out: &mut Vec<u8>) {
        match self {
            Self::At(instant) => {
                out.push(1);
                put_u64(out, instant);
            }
            Self::MintingCut => out.push(2),
        }
    }
}

/// One declared timeframe of a custody, with the spec identity it has for each member.
#[derive(Clone, Debug)]
pub(crate) struct CustodyTimeframeV1 {
    pub(crate) label: String,
    pub(crate) interval_ns: u64,
    label_rule: BarScheduleLabelV1,
    /// What the declared bar is, without its label.
    pub(crate) shape: DeclaredBarShapeV1,
    /// The timeframe identity of each member, in member order: the one a BAR schedule minted from
    /// the same declaration and the member's Instrument Master fact states.
    pub(crate) member_identities: Vec<[u8; 32]>,
    /// The custody's identity of this timeframe over its members.
    pub(crate) identity: BindingDigest,
}

/// One row of a version, in the version's canonical row order.
#[derive(Clone, Debug)]
pub(crate) struct DerivedRowV1 {
    pub(crate) member_ordinal: u8,
    pub(crate) semantic: MarketDataFieldSemantic,
    pub(crate) instrument: String,
    pub(crate) timeframe_identity: [u8; 32],
    pub(crate) row_digest: BindingDigest,
    pub(crate) value_mantissa: i128,
    pub(crate) value_scale: u8,
    pub(crate) retrieval_ns: u64,
    pub(crate) retrieval_route: String,
}

/// One cross-section version, as the Owner derives it.
#[derive(Clone, Debug)]
pub(crate) struct DerivedVersionV1 {
    pub(crate) identity: BindingDigest,
    pub(crate) timeframe_identity: BindingDigest,
    pub(crate) event_ns: u64,
    pub(crate) kind: CrossSectionVersionKindV1,
    pub(crate) correction_sequence: u64,
    pub(crate) predecessor: Option<BindingDigest>,
    /// The instant the version's bar closes.
    pub(crate) close_ns: u64,
    pub(crate) availability: CustodyInstantV1,
    pub(crate) publication: CustodyInstantV1,
    pub(crate) rows: Vec<DerivedRowV1>,
}

/// Where a custody sits in its chain.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ChainPositionV1 {
    pub(crate) predecessor: Option<BindingDigest>,
    /// The root of the chain; zero for a root, whose root is its own identity.
    pub(crate) chain_root: BindingDigest,
    pub(crate) chain_version: u64,
}

impl ChainPositionV1 {
    /// A root custody: no predecessor, version 1.
    pub(crate) const ROOT: Self = Self {
        predecessor: None,
        chain_root: ZERO,
        chain_version: 1,
    };

    /// The successor of `head`, version `head_version + 1`, in the chain rooted at `chain_root`.
    pub(crate) fn successor_of(
        chain_root: BindingDigest,
        head: BindingDigest,
        head_version: u64,
    ) -> Result<Self, Refused> {
        Ok(Self {
            predecessor: Some(head),
            chain_root,
            chain_version: head_version
                .checked_add(1)
                .ok_or(Refused::StoreUnavailable)?,
        })
    }
}

/// Every identity of one custody that does not depend on its chain or its minting cut.
#[derive(Clone, Debug)]
pub(crate) struct DerivedCustodyV1 {
    pub(crate) binding: CustodyBindingV1,
    pub(crate) rule_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    /// The typed Market Semantics value the request claims, checked for shape only.
    pub(crate) market_semantics_value: MarketSemanticsValueV1,
    universe: (BindingDigest, BindingDigest),
    pub(crate) instrument_master_key: BindingDigest,
    pub(crate) members: Vec<String>,
    /// The Instrument Master fact selected for each member, in member order.
    pub(crate) member_fact_digests: Vec<BindingDigest>,
    /// `[start, end)`.
    pub(crate) window: (u64, u64),
    pub(crate) execution: CustodyTimeframeV1,
    inputs: Vec<CustodyTimeframeV1>,
    fill: Option<CustodyTimeframeV1>,
    pub(crate) basis_digest: BindingDigest,
    pub(crate) evidence_digest: BindingDigest,
    pub(crate) max_retrieval_ns: u64,
    pub(crate) versions: Vec<DerivedVersionV1>,
    /// `Some` for a successor: the chain root its claim names.
    pub(crate) claimed_chain_root: Option<BindingDigest>,
}

/// The shape a request must have before anything is loaded for it.
///
/// # Errors
///
/// [`Refused::InvalidRequest`] for every malformed shape this function names.
pub(crate) fn check_request_shape_v1(
    request: &UntrustedPitWindowCustodyRequestV1,
) -> Result<(), Refused> {
    let members = &request.members;

    if members.is_empty()
        || members.len() > PIT_WINDOW_CUSTODY_MAX_MEMBERS_V1
        || members.iter().any(String::is_empty)
        || members.windows(2).any(|pair| pair[0] >= pair[1])
        || request.window_start_ns >= request.window_end_ns_exclusive
        || request.input_timeframes.is_empty()
        || request.input_timeframes.iter().any(String::is_empty)
        || request
            .input_timeframes
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        || !request.input_timeframes.contains(&request.execution_timeframe)
        || request.fill_timeframe.as_ref().is_some_and(String::is_empty)
        || request.cross_sections.is_empty()
        // Every instant is stored as a signed 64-bit count of nanoseconds.
        || i64::try_from(request.window_end_ns_exclusive).is_err()
        || request
            .cross_sections
            .iter()
            .filter_map(|version| version.publication_ns)
            .any(|publication| i64::try_from(publication).is_err())
    {
        return Err(Refused::InvalidRequest);
    }
    let mut previous: Option<(&str, u64, u64)> = None;

    for version in &request.cross_sections {
        let held = request.input_timeframes.contains(&version.timeframe)
            || request.fill_timeframe.as_ref() == Some(&version.timeframe);
        let in_window = version.event_effective_ns >= request.window_start_ns
            && version.event_effective_ns < request.window_end_ns_exclusive;
        let shaped = match version.kind {
            CrossSectionVersionKindV1::Original => {
                version.correction_sequence == 1
                    && version.predecessor_version.is_none()
                    && !version.rows.is_empty()
            }
            CrossSectionVersionKindV1::Correction => {
                version.correction_sequence >= 2
                    && version.predecessor_version.is_some()
                    && !version.rows.is_empty()
            }
            CrossSectionVersionKindV1::Withdrawal => {
                version.correction_sequence >= 2
                    && version.predecessor_version.is_some()
                    && version.rows.is_empty()
            }
        };
        let key = (
            version.timeframe.as_str(),
            version.event_effective_ns,
            version.correction_sequence,
        );

        // Canonical order: by timeframe label, event and sequence. An equal key is a repeated
        // sequence, which is a branch the derivation refuses by name.
        if !held || !in_window || !shaped || previous.is_some_and(|prior| key < prior) {
            return Err(Refused::InvalidRequest);
        }
        previous = Some(key);

        if !version.rows.is_empty() {
            check_row_shape(request, version)?;
        }
    }
    Ok(())
}

/// Exactly one row per member and BAR field, each with a retrieval route of bounded length.
fn check_row_shape(
    request: &UntrustedPitWindowCustodyRequestV1,
    version: &super::UntrustedCrossSectionVersionV1,
) -> Result<(), Refused> {
    let mut seen = BTreeSet::new();

    for row in &version.rows {
        let member = request.members.iter().position(|m| *m == row.instrument);
        let field = BAR_FIELDS_V1
            .iter()
            .position(|semantic| semantic.row_field() == row.field);
        let (Some(member), Some(field)) = (member, field) else {
            return Err(Refused::InvalidRequest);
        };

        if !seen.insert((member, field))
            || row.retrieval_route.is_empty()
            || row.retrieval_route.len() > MAX_RETRIEVAL_ROUTE_BYTES_V1
        {
            return Err(Refused::InvalidRequest);
        }
    }

    if seen.len() != request.members.len() * BAR_FIELDS_V1.len() {
        return Err(Refused::InvalidRequest);
    }
    Ok(())
}

/// Whether `declared` is a fixed interval T0 can enumerate: a continuous clock from the Unix
/// epoch, with a duration of its own.
fn continuous_fixed_interval(declared: &DeclaredBarTimeframeV1) -> Option<u64> {
    if declared.kind() == BarScheduleKindV1::FixedInterval
        && declared.clock() == BarScheduleClockV1::Continuous
    {
        declared
            .fixed_interval_ns()
            .filter(|interval| *interval > 0)
    } else {
        None
    }
}

/// Derives every chain-independent identity of a custody and refuses whatever its basis cannot
/// carry.
///
/// # Errors
///
/// Every refusal of [`PitWindowCustodyRefusalV1`] that needs neither the chain nor the minting cut.
#[expect(
    clippy::too_many_lines,
    reason = "one ordered derivation: each refusal is decided by name before the next is reached"
)]
pub(crate) fn derive_custody_v1(inputs: CustodyInputsV1<'_>) -> Result<DerivedCustodyV1, Refused> {
    let request = inputs.request;
    check_request_shape_v1(request)?;
    let binding = inputs
        .binding
        .filter(|binding| binding.admitted_under_locator)
        .ok_or(Refused::SourceBindingUnavailable)?;
    let rule = binding
        .availability_rule
        .as_ref()
        .ok_or(Refused::SourceBindingDeclaresNoAvailabilityRule)?;

    if request.market_semantics_identity != binding.market_semantics_identity {
        return Err(Refused::MarketSemanticsMismatch);
    }
    let market_semantics_value = request
        .market_semantics_value
        .clone()
        .into_value()
        .map_err(|_| Refused::InvalidRequest)?;

    if [
        market_semantics_value.normalization_identity,
        market_semantics_value.price_unit_identity,
        market_semantics_value.size_unit_identity,
    ]
    .contains(&ZERO)
    {
        return Err(Refused::InvalidRequest);
    }

    // Timeframes: every label the binding declares, the execution one a fixed interval.
    let declared = |label: &str| {
        binding
            .bar_timeframes
            .iter()
            .find(|timeframe| timeframe.row_timeframe == label)
            .map(|timeframe| {
                DeclaredBarTimeframeV1::from_declaration(binding.fact_digest, timeframe)
            })
            .ok_or(Refused::InvalidRequest)
    };
    let execution = declared(&request.execution_timeframe)?;
    let execution_interval =
        continuous_fixed_interval(&execution).ok_or(Refused::ExecutionTimeframeNotFixedInterval)?;

    // A frame is decided at its bar's close: `d_k < e_{k+1}` holds only for frames at close
    // instants, so T0 enumerates frames only from a timeframe labelled at interval close.
    if execution.label() != BarScheduleLabelV1::IntervalClose {
        return Err(Refused::InvalidRequest);
    }

    // A window holds at least one frame: a close instant of the execution grid, which the Unix
    // epoch anchors.
    if request
        .window_start_ns
        .div_ceil(execution_interval)
        .checked_mul(execution_interval)
        .is_none_or(|first| first >= request.window_end_ns_exclusive)
    {
        return Err(Refused::InvalidRequest);
    }
    let mut held = Vec::with_capacity(request.input_timeframes.len() + 1);

    for label in &request.input_timeframes {
        let declaration = declared(label)?;
        let interval = continuous_fixed_interval(&declaration).ok_or(Refused::InvalidRequest)?;
        held.push((declaration, interval));
    }
    let fill = request
        .fill_timeframe
        .as_deref()
        .map(|label| {
            let declaration = declared(label)?;
            let interval =
                continuous_fixed_interval(&declaration).ok_or(Refused::InvalidRequest)?;
            Ok::<_, Refused>((declaration, interval))
        })
        .transpose()?;

    if let UntrustedSourceVisibilityV1::AfterBarClose { lag_ns } = rule.visibility
        && lag_ns >= execution_interval
    {
        return Err(Refused::AvailabilityLagNotBelowBarInterval);
    }

    if let Some((declaration, interval)) = &fill {
        if request
            .input_timeframes
            .iter()
            .any(|label| label == declaration.row_timeframe())
        {
            return Err(Refused::FillTimeframeIsAnInputTimeframe);
        }

        if *interval >= execution_interval {
            return Err(Refused::FillTimeframeNotFinerThanExecution);
        }

        // The quote cut derives a fill bar's open as its close less this one interval, so a fill
        // timeframe of any other declared interval is refused rather than quoted at a wrong open.
        if *interval != super::quote_cut::FILL_BAR_INTERVAL_NS_V1 {
            return Err(Refused::FillTimeframeNotOneMinute);
        }
    }

    // Members: the same Instrument Master fact and an included membership throughout the window.
    if inputs.instruments.len() != request.members.len() {
        return Err(Refused::StoreUnavailable);
    }
    let window_end = i128::from(request.window_end_ns_exclusive);
    let window_start = i128::from(request.window_start_ns);
    let mut facts = Vec::with_capacity(request.members.len());

    for instrument in inputs.instruments {
        let fact = instrument
            .at_start
            .as_ref()
            .ok_or(Refused::WindowMemberNotValidThroughout)?;

        if fact.market_semantics_identity != request.market_semantics_identity {
            return Err(Refused::MarketSemanticsMismatch);
        }

        let another_in_force = instrument.others.iter().any(|other| {
            other.effective_from < window_end
                && other
                    .effective_until
                    .is_none_or(|until| until > window_start)
        });

        if instrument.at_end != Some(fact.fact_digest)
            || fact.effective_until.is_some_and(|until| until < window_end)
            || another_in_force
        {
            return Err(Refused::WindowMemberNotValidThroughout);
        }
        facts.push(fact);
    }

    for member in &request.members {
        let included_throughout = inputs.membership.iter().any(|record| {
            record.instrument == member.as_bytes()
                && record.included
                && record.effective_from_ns <= window_start
                && record
                    .effective_until_ns
                    .is_none_or(|until| until >= window_end)
        });

        if !included_throughout {
            return Err(Refused::WindowMemberNotValidThroughout);
        }
    }

    // Timeframe identities, per member, through the schedule path's own derivation.
    let time_zones = facts
        .iter()
        .map(|fact| {
            crate::owner::bar_schedule::schedule_time_zone_identity_v1(
                fact.class,
                fact.fact_digest,
                &fact.time_zone,
            )
            .map_err(|_| Refused::StoreUnavailable)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let timeframe = |declaration: &DeclaredBarTimeframeV1, interval: u64| {
        custody_timeframe(declaration, interval, &time_zones)
    };
    let execution = timeframe(&execution, execution_interval)?;
    let inputs_timeframes = held
        .iter()
        .map(|(declaration, interval)| timeframe(declaration, *interval))
        .collect::<Result<Vec<_>, _>>()?;
    let fill = fill
        .as_ref()
        .map(|(declaration, interval)| timeframe(declaration, *interval))
        .transpose()?;
    let input_identities = inputs_timeframes
        .iter()
        .map(|timeframe| timeframe.identity)
        .collect::<BTreeSet<_>>();

    // Two labels for one timeframe would split one cross-section in two.
    if input_identities.len() != inputs_timeframes.len() {
        return Err(Refused::InvalidRequest);
    }

    if fill
        .as_ref()
        .is_some_and(|fill| input_identities.contains(&fill.identity))
    {
        return Err(Refused::FillTimeframeIsAnInputTimeframe);
    }
    let instrument_master_key = {
        let mut bytes = Vec::new();
        put_u64(&mut bytes, facts.len() as u64);

        for fact in &facts {
            bytes.extend_from_slice(fact.fact_digest.as_bytes());
        }
        sha256(INSTRUMENT_MASTER_KEY_DOMAIN, &bytes)
    };

    // Versions.
    if !rule.publishes_corrections
        && request.cross_sections.iter().any(|version| {
            version.kind != CrossSectionVersionKindV1::Original || version.publication_ns.is_some()
        })
    {
        return Err(Refused::CrossSectionCorrectionNotPublishedBySource);
    }
    let by_label = inputs_timeframes
        .iter()
        .chain(fill.iter())
        .map(|timeframe| (timeframe.label.as_str(), timeframe))
        .collect::<BTreeMap<_, _>>();
    let mut versions: Vec<DerivedVersionV1> = Vec::with_capacity(request.cross_sections.len());
    let mut keys = BTreeSet::new();
    let mut named = BTreeSet::new();
    let mut max_retrieval_ns = 0;
    let mut evidence = Vec::new();

    for version in &request.cross_sections {
        let timeframe = by_label
            .get(version.timeframe.as_str())
            .ok_or(Refused::InvalidRequest)?;

        if !keys.insert((
            timeframe.identity,
            version.event_effective_ns,
            version.correction_sequence,
        )) {
            return Err(Refused::CrossSectionBranch);
        }

        if let Some(predecessor) = version.predecessor_version {
            if !named.insert(predecessor) {
                return Err(Refused::CrossSectionBranch);
            }

            if let Some(prior) = versions.iter().find(|prior| prior.identity == predecessor) {
                continues(
                    prior.timeframe_identity,
                    prior.event_ns,
                    prior.kind,
                    prior.correction_sequence,
                    timeframe.identity,
                    version,
                )?;
            } else if request.predecessor.is_none() {
                // A root has no chain to name a version from.
                return Err(Refused::InvalidRequest);
            }
        }
        let close = match timeframe.label_rule {
            BarScheduleLabelV1::IntervalClose => Some(version.event_effective_ns),
            BarScheduleLabelV1::IntervalOpen => version
                .event_effective_ns
                .checked_add(timeframe.interval_ns),
        }
        .ok_or(Refused::InvalidRequest)?;
        let availability = match rule.visibility {
            UntrustedSourceVisibilityV1::AfterBarClose { lag_ns } => {
                CustodyInstantV1::At(close.checked_add(lag_ns).ok_or(Refused::InvalidRequest)?)
            }
            UntrustedSourceVisibilityV1::AtRetrieval => CustodyInstantV1::MintingCut,
        };
        let publication = version
            .publication_ns
            .map_or(availability, CustodyInstantV1::At);

        // A source publishes a version no earlier than its bar and its availability. One stated
        // against the minting cut is checked when the cut is fixed.
        if let Some(stated) = version.publication_ns
            && (stated < version.event_effective_ns
                || matches!(availability, CustodyInstantV1::At(at) if stated < at))
        {
            return Err(Refused::InvalidRequest);
        }
        let mut rows = Vec::with_capacity(version.rows.len());

        for (ordinal, member) in request.members.iter().enumerate() {
            for semantic in BAR_FIELDS_V1 {
                let Some(row) = version
                    .rows
                    .iter()
                    .find(|row| row.instrument == *member && row.field == semantic.row_field())
                else {
                    continue;
                };
                // One series has one scale, the fixed Market Data value scale, so one bar's value
                // has one representation however the writer spelled it, and a tick that changed
                // over the instrument's history changes no series.
                let target_scale = MARKET_DATA_VALUE_SCALE_V1;
                let value_mantissa =
                    rescale_exact_v1(row.value_mantissa, row.value_scale, target_scale).map_err(
                        |e| match e {
                            RescaleErrorV1::FinerThanTarget => Refused::ValueFinerThanSeriesScale,
                            RescaleErrorV1::Overflow => Refused::InvalidRequest,
                        },
                    )?;
                max_retrieval_ns = max_retrieval_ns.max(row.retrieval_ns);
                put_u64(&mut evidence, row.retrieval_ns);
                put_var(&mut evidence, row.retrieval_route.as_bytes());
                rows.push(DerivedRowV1 {
                    member_ordinal: u8::try_from(ordinal).map_err(|_| Refused::InvalidRequest)?,
                    semantic,
                    instrument: member.clone(),
                    timeframe_identity: timeframe.member_identities[ordinal],
                    row_digest: row_digest_v1(
                        member,
                        semantic.row_field(),
                        value_mantissa,
                        target_scale,
                    ),
                    value_mantissa,
                    value_scale: target_scale,
                    retrieval_ns: row.retrieval_ns,
                    retrieval_route: row.retrieval_route.clone(),
                });
            }
        }
        let mut bytes = Vec::new();
        put_u16(&mut bytes, 1);
        bytes.extend_from_slice(timeframe.identity.as_bytes());
        put_u64(&mut bytes, version.event_effective_ns);
        bytes.push(kind_tag(version.kind));
        put_u64(&mut bytes, version.correction_sequence);
        put_optional(&mut bytes, version.predecessor_version);
        availability.encode(&mut bytes);
        publication.encode(&mut bytes);
        put_u64(&mut bytes, rows.len() as u64);

        for row in &rows {
            bytes.extend_from_slice(row.row_digest.as_bytes());
        }
        versions.push(DerivedVersionV1 {
            identity: sha256(VERSION_DOMAIN, &bytes),
            timeframe_identity: timeframe.identity,
            event_ns: version.event_effective_ns,
            kind: version.kind,
            correction_sequence: version.correction_sequence,
            predecessor: version.predecessor_version,
            close_ns: close,
            availability,
            publication,
            rows,
        });
    }
    let rule_digest = availability_rule_digest_v1(rule);
    let mut derived = DerivedCustodyV1 {
        binding: binding.clone(),
        rule_digest,
        market_semantics_identity: request.market_semantics_identity,
        market_semantics_value,
        universe: (
            request.universe_selection.request_identity(),
            request.universe_selection.request_meaning_digest(),
        ),
        instrument_master_key,
        members: request.members.clone(),
        member_fact_digests: facts.iter().map(|fact| fact.fact_digest).collect(),
        window: (request.window_start_ns, request.window_end_ns_exclusive),
        execution,
        inputs: inputs_timeframes,
        fill,
        basis_digest: ZERO,
        evidence_digest: sha256(EVIDENCE_DOMAIN, &evidence),
        max_retrieval_ns,
        versions,
        claimed_chain_root: request.predecessor.map(|claim| claim.chain_root),
    };
    derived.basis_digest = derived.basis();
    Ok(derived)
}

/// Refuses `version` unless it continues the version described by the first five arguments: the
/// same cross-section, a predecessor that was not withdrawn, and the next sequence.
fn continues(
    timeframe_identity: BindingDigest,
    event_ns: u64,
    kind: CrossSectionVersionKindV1,
    correction_sequence: u64,
    version_timeframe: BindingDigest,
    version: &super::UntrustedCrossSectionVersionV1,
) -> Result<(), Refused> {
    if timeframe_identity != version_timeframe
        || event_ns != version.event_effective_ns
        || kind == CrossSectionVersionKindV1::Withdrawal
        || correction_sequence.checked_add(1) != Some(version.correction_sequence)
    {
        return Err(Refused::InvalidRequest);
    }
    Ok(())
}

fn custody_timeframe(
    declaration: &DeclaredBarTimeframeV1,
    interval_ns: u64,
    time_zones: &[BindingDigest],
) -> Result<CustodyTimeframeV1, Refused> {
    let member_identities = time_zones
        .iter()
        .map(|time_zone| {
            continuous_bar_timeframe_spec_v1(declaration, *time_zone)
                .map(|spec| spec.identity())
                .map_err(|_| Refused::InvalidRequest)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(CustodyTimeframeV1 {
        label: declaration.row_timeframe().to_owned(),
        interval_ns,
        label_rule: declaration.label(),
        shape: declaration.shape(),
        identity: custody_timeframe_identity_v1(&member_identities),
        member_identities,
    })
}

/// The custody's identity of one timeframe over its members: each member's spec identity, in
/// member order.
pub(crate) fn custody_timeframe_identity_v1(member_identities: &[[u8; 32]]) -> BindingDigest {
    let mut bytes = Vec::new();
    put_u64(&mut bytes, member_identities.len() as u64);

    for identity in member_identities {
        bytes.extend_from_slice(identity);
    }
    sha256(TIMEFRAME_DOMAIN, &bytes)
}

impl DerivedCustodyV1 {
    /// The last frame of the window: the latest close instant of the execution grid before its
    /// end. The derivation refuses a window that holds none.
    pub(crate) const fn last_execution_frame_ns(&self) -> u64 {
        let interval = self.execution.interval_ns;
        (self.window.1 - 1) / interval * interval
    }

    /// The labels of the input timeframes, in canonical order; the fill timeframe is not one.
    pub(crate) fn input_labels(&self) -> impl Iterator<Item = &str> {
        self.inputs.iter().map(|timeframe| timeframe.label.as_str())
    }

    /// Each timeframe's identity with the label it is held under, so a view row can state its
    /// label from the custody alone and a relabelling is another custody.
    fn timeframe_identities(&self, out: &mut Vec<u8>) {
        put_timeframes(
            out,
            (self.execution.identity, &self.execution.label),
            &self
                .inputs
                .iter()
                .map(|timeframe| (timeframe.identity, timeframe.label.as_str()))
                .collect::<BTreeMap<_, _>>(),
            self.fill
                .as_ref()
                .map(|fill| (fill.identity, fill.label.as_str())),
        );
    }

    fn members(&self, out: &mut Vec<u8>) {
        put_u64(out, self.members.len() as u64);

        for member in &self.members {
            put_var(out, member.as_bytes());
        }
    }

    /// What a successor must restate exactly: the source lineage and its rule, Market Semantics,
    /// Instrument Master, members, window and timeframes.
    fn basis(&self) -> BindingDigest {
        let mut bytes = Vec::new();
        put_u16(&mut bytes, 1);
        bytes.extend_from_slice(self.binding.lineage_root.as_bytes());
        bytes.extend_from_slice(self.rule_digest.as_bytes());
        bytes.extend_from_slice(self.market_semantics_identity.as_bytes());
        put_market_semantics_value(&mut bytes, &self.market_semantics_value);
        bytes.extend_from_slice(self.instrument_master_key.as_bytes());
        self.members(&mut bytes);
        put_u64(&mut bytes, self.window.0);
        put_u64(&mut bytes, self.window.1);
        self.timeframe_identities(&mut bytes);
        sha256(BASIS_DOMAIN, &bytes)
    }

    /// The custody identity at `position`, with the canonical bytes it is the digest of.
    pub(crate) fn identity_at(&self, position: ChainPositionV1) -> (BindingDigest, Vec<u8>) {
        let mut bytes = Vec::new();
        put_u16(&mut bytes, 1);
        bytes.extend_from_slice(self.binding.binding_id.as_bytes());
        bytes.extend_from_slice(self.binding.fact_digest.as_bytes());
        bytes.extend_from_slice(self.binding.lineage_root.as_bytes());
        put_u64(&mut bytes, self.binding.lineage_version);
        bytes.extend_from_slice(self.rule_digest.as_bytes());
        bytes.extend_from_slice(self.market_semantics_identity.as_bytes());
        put_market_semantics_value(&mut bytes, &self.market_semantics_value);
        bytes.extend_from_slice(self.universe.0.as_bytes());
        bytes.extend_from_slice(self.universe.1.as_bytes());
        bytes.extend_from_slice(self.instrument_master_key.as_bytes());
        self.members(&mut bytes);
        put_u64(&mut bytes, self.window.0);
        put_u64(&mut bytes, self.window.1);
        self.timeframe_identities(&mut bytes);
        put_optional(&mut bytes, position.predecessor);
        bytes.extend_from_slice(position.chain_root.as_bytes());
        put_u64(&mut bytes, position.chain_version);
        let versions = self
            .versions
            .iter()
            .map(|version| version.identity)
            .collect::<BTreeSet<_>>();
        put_u64(&mut bytes, versions.len() as u64);

        for identity in versions {
            bytes.extend_from_slice(identity.as_bytes());
        }
        (sha256(CUSTODY_DOMAIN, &bytes), bytes)
    }

    /// Decides a successor against the chain head it extends.
    ///
    /// # Errors
    ///
    /// [`Refused::SuccessorBasisChanged`] for another basis; [`Refused::CrossSectionBranch`] for a
    /// version that branches a stored cross-section; [`Refused::InvalidRequest`] for a version
    /// naming no stored version it can continue, and for an original of a cross-section the chain
    /// does not hold, since extending history is a new root.
    pub(crate) fn check_against_chain(&self, chain: &StoredChainV1) -> Result<(), Refused> {
        if self.basis_digest != chain.head_basis_digest {
            return Err(Refused::SuccessorBasisChanged);
        }
        let stored = chain
            .versions
            .iter()
            .map(|version| (version.identity, version))
            .collect::<BTreeMap<_, _>>();
        let named_by_chain = chain
            .versions
            .iter()
            .filter_map(|version| version.predecessor)
            .collect::<BTreeSet<_>>();
        let in_request = self
            .versions
            .iter()
            .map(|version| version.identity)
            .collect::<BTreeSet<_>>();

        for version in &self.versions {
            let same_cross_section = |prior: &&StoredVersionV1| {
                prior.timeframe_identity == version.timeframe_identity
                    && prior.event_ns == version.event_ns
            };

            match version.predecessor {
                None => {
                    if chain
                        .versions
                        .iter()
                        .any(|prior| same_cross_section(&prior))
                    {
                        return Err(Refused::CrossSectionBranch);
                    }
                    return Err(Refused::InvalidRequest);
                }
                Some(predecessor) => {
                    if named_by_chain.contains(&predecessor)
                        || chain.versions.iter().any(|prior| {
                            same_cross_section(&prior)
                                && prior.correction_sequence == version.correction_sequence
                        })
                    {
                        return Err(Refused::CrossSectionBranch);
                    }

                    if in_request.contains(&predecessor) {
                        continue;
                    }
                    let prior = stored.get(&predecessor).ok_or(Refused::InvalidRequest)?;

                    if prior.timeframe_identity != version.timeframe_identity
                        || prior.event_ns != version.event_ns
                        || prior.kind == CrossSectionVersionKindV1::Withdrawal
                        || prior.correction_sequence.checked_add(1)
                            != Some(version.correction_sequence)
                    {
                        return Err(Refused::InvalidRequest);
                    }
                }
            }
        }
        Ok(())
    }

    /// Places every instant the minting cut decides: `(availability, publication)` per version.
    ///
    /// # Errors
    ///
    /// [`Refused::RetrievalAfterMintingCut`] for a row retrieved after `minting_cut`;
    /// [`Refused::RowRetrievedBeforeBarClose`] for a row retrieved before its bar closed, which a
    /// complete-only bar cannot be; [`Refused::InvalidRequest`] for a stated publication earlier
    /// than an availability the minting cut sets; [`Refused::VersionNotAvailableAtMintingCut`]
    /// for a version whose availability or publication is later than `minting_cut`;
    /// [`Refused::CrossSectionBranch`] for a version not published after the one it corrects.
    pub(crate) fn resolve_at_minting_cut(
        &self,
        minting_cut: u64,
        chain: Option<&StoredChainV1>,
    ) -> Result<Vec<(u64, u64)>, Refused> {
        if self.max_retrieval_ns > minting_cut {
            return Err(Refused::RetrievalAfterMintingCut);
        }
        let resolved = self
            .versions
            .iter()
            .map(|version| {
                (
                    version.availability.resolve(minting_cut),
                    version.publication.resolve(minting_cut),
                )
            })
            .collect::<Vec<_>>();

        for version in &self.versions {
            if version
                .rows
                .iter()
                .any(|row| row.retrieval_ns < version.close_ns)
            {
                return Err(Refused::RowRetrievedBeforeBarClose);
            }
        }

        for (availability, publication) in &resolved {
            if publication < availability {
                return Err(Refused::InvalidRequest);
            }

            // Custody holds what was visible when it was minted: no version is available, or
            // published, after the cut that holds it.
            if *availability > minting_cut || *publication > minting_cut {
                return Err(Refused::VersionNotAvailableAtMintingCut);
            }
        }

        for (version, (_, publication)) in self.versions.iter().zip(&resolved) {
            let Some(predecessor) = version.predecessor else {
                continue;
            };
            let prior = self
                .versions
                .iter()
                .position(|prior| prior.identity == predecessor)
                .map(|index| resolved[index].1)
                .or_else(|| {
                    chain.and_then(|chain| {
                        chain
                            .versions
                            .iter()
                            .find(|prior| prior.identity == predecessor)
                            .map(|prior| prior.publication_ns)
                    })
                })
                .ok_or(Refused::InvalidRequest)?;

            if *publication <= prior {
                return Err(Refused::CrossSectionBranch);
            }
        }
        Ok(resolved)
    }

    /// The row fact input of every row of `version`, at its resolved instants.
    pub(crate) fn row_inputs(
        &self,
        version: &DerivedVersionV1,
        (available, publication): (u64, u64),
    ) -> Vec<SampleRowInputV2> {
        let semantics_unit = |semantic: MarketDataFieldSemantic| semantic.unit().canonical();
        version
            .rows
            .iter()
            .map(|row| SampleRowInputV2 {
                cross_section_version: *version.identity.as_bytes(),
                canonical_row_digest: *row.row_digest.as_bytes(),
                instrument: row.instrument.as_bytes().to_vec(),
                channel: MARKET_CHANNEL_CODE,
                data_kind: BAR_DATA_KIND_CODE,
                field_semantic: row.semantic.identity().as_bytes().to_vec(),
                timeframe_identity: row.timeframe_identity,
                value_semantic: STRATEGY_INPUT_FIXED_I128_LE_V1.as_bytes().to_vec(),
                unit: semantics_unit(row.semantic).as_bytes().to_vec(),
                value_mantissa: row.value_mantissa,
                value_scale: row.value_scale,
                event_effective: version.event_ns,
                available,
                publication,
                correction_sequence: version.correction_sequence,
                source_binding_identity: self.binding.binding_id,
                source_binding_lineage_root: self.binding.lineage_root,
                source_binding_lineage_version: self.binding.lineage_version,
                source_frontier_digest: self.binding.source_frontier_digest,
                correction_stream: self.binding.correction_stream.as_bytes().to_vec(),
                correction_frontier_digest: self.binding.correction_frontier_digest,
                instrument_master_digest: self.instrument_master_key,
                market_semantics_identity: self.market_semantics_identity,
            })
            .collect()
    }
}

/// Writes the execution timeframe, the inputs in ascending identity, and the optional fill, each as
/// its identity then its label.
fn put_timeframes(
    out: &mut Vec<u8>,
    execution: (BindingDigest, &str),
    inputs: &BTreeMap<BindingDigest, &str>,
    fill: Option<(BindingDigest, &str)>,
) {
    out.extend_from_slice(execution.0.as_bytes());
    put_var(out, execution.1.as_bytes());
    put_u64(out, inputs.len() as u64);

    for (identity, label) in inputs {
        out.extend_from_slice(identity.as_bytes());
        put_var(out, label.as_bytes());
    }

    match fill {
        None => out.push(0),
        Some((identity, label)) => {
            out.push(1);
            out.extend_from_slice(identity.as_bytes());
            put_var(out, label.as_bytes());
        }
    }
}

/// The Owner clock a custody was minted under: the clock its minting cut is an instant of.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CustodyMintingClockV1 {
    pub(crate) identity: String,
    pub(crate) epoch: String,
    pub(crate) sequence: u64,
    pub(crate) restart_continuity_digest: BindingDigest,
    pub(crate) uncertainty_bound: u64,
    pub(crate) skew_bound: u64,
}

/// One timeframe a stored custody holds: its identity and the label it is held under.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RecordedTimeframeV1 {
    pub(crate) identity: BindingDigest,
    pub(crate) label: String,
}

/// A stored custody record, read back from the canonical bytes its identity is the digest of.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "read back by the derived view's chain verifier (T0-5 C6)"
    )
)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CustodyRecordV1 {
    pub(crate) identity: BindingDigest,
    pub(crate) binding_id: BindingDigest,
    pub(crate) binding_fact_digest: BindingDigest,
    pub(crate) lineage_root: BindingDigest,
    pub(crate) lineage_version: u64,
    pub(crate) rule_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) market_semantics_value: MarketSemanticsValueV1,
    /// The Universe Selection locator: `(request_identity, request_meaning_digest)`.
    pub(crate) universe: (BindingDigest, BindingDigest),
    pub(crate) instrument_master_key: BindingDigest,
    pub(crate) members: Vec<String>,
    /// `[start, end)`.
    pub(crate) window: (u64, u64),
    pub(crate) execution: RecordedTimeframeV1,
    /// In ascending identity, the execution timeframe among them.
    pub(crate) inputs: Vec<RecordedTimeframeV1>,
    pub(crate) fill: Option<RecordedTimeframeV1>,
    pub(crate) predecessor: Option<BindingDigest>,
    /// Zero for a root, whose chain root is its own identity.
    pub(crate) chain_root_field: BindingDigest,
    pub(crate) chain_version: u64,
    pub(crate) version_identities: BTreeSet<BindingDigest>,
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "read back by the derived view's chain verifier (T0-5 C6)"
    )
)]
impl CustodyRecordV1 {
    /// The root of the chain this custody belongs to.
    pub(crate) fn chain_root(&self) -> BindingDigest {
        if self.predecessor.is_none() {
            self.identity
        } else {
            self.chain_root_field
        }
    }

    /// The basis a successor restates, as [`DerivedCustodyV1`] binds it at commit.
    pub(crate) fn basis_digest(&self) -> BindingDigest {
        let mut bytes = Vec::new();
        put_u16(&mut bytes, 1);
        bytes.extend_from_slice(self.lineage_root.as_bytes());
        bytes.extend_from_slice(self.rule_digest.as_bytes());
        bytes.extend_from_slice(self.market_semantics_identity.as_bytes());
        put_market_semantics_value(&mut bytes, &self.market_semantics_value);
        bytes.extend_from_slice(self.instrument_master_key.as_bytes());
        put_u64(&mut bytes, self.members.len() as u64);

        for member in &self.members {
            put_var(&mut bytes, member.as_bytes());
        }
        put_u64(&mut bytes, self.window.0);
        put_u64(&mut bytes, self.window.1);
        put_timeframes(
            &mut bytes,
            (self.execution.identity, &self.execution.label),
            &self
                .inputs
                .iter()
                .map(|timeframe| (timeframe.identity, timeframe.label.as_str()))
                .collect(),
            self.fill
                .as_ref()
                .map(|fill| (fill.identity, fill.label.as_str())),
        );
        sha256(BASIS_DOMAIN, &bytes)
    }
}

/// Reads stored custody bytes back into the record they state, only when they are exactly the
/// canonical bytes of `identity`: the digest under the custody domain, no trailing byte, inputs
/// strictly ascending with the execution timeframe among them and the fill never among them, and
/// a chain position a commit can write.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "read back by the derived view's chain verifier (T0-5 C6)"
    )
)]
pub(crate) fn decode_custody_record_v1(
    bytes: &[u8],
    identity: BindingDigest,
) -> Option<CustodyRecordV1> {
    if sha256(CUSTODY_DOMAIN, bytes) != identity {
        return None;
    }
    let mut reader = RecordReader { bytes };

    if reader.take(2)? != 1_u16.to_be_bytes() {
        return None;
    }
    let binding_id = reader.digest()?;
    let binding_fact_digest = reader.digest()?;
    let lineage_root = reader.digest()?;
    let lineage_version = reader.u64()?;
    let rule_digest = reader.digest()?;
    let market_semantics_identity = reader.digest()?;
    let market_semantics_value = take_market_semantics_value(&mut reader.bytes)?;
    let universe = (reader.digest()?, reader.digest()?);
    let instrument_master_key = reader.digest()?;
    let member_count = usize::try_from(reader.u64()?).ok()?;

    if member_count == 0 || member_count > PIT_WINDOW_CUSTODY_MAX_MEMBERS_V1 {
        return None;
    }
    let members = (0..member_count)
        .map(|_| reader.text())
        .collect::<Option<Vec<_>>>()?;
    let window = (reader.u64()?, reader.u64()?);
    let execution = reader.timeframe()?;
    let input_count = usize::try_from(reader.u64()?).ok()?;
    let inputs = (0..input_count)
        .map(|_| reader.timeframe())
        .collect::<Option<Vec<_>>>()?;
    let fill = match reader.u8()? {
        0 => None,
        1 => Some(reader.timeframe()?),
        _ => return None,
    };
    let predecessor = match reader.u8()? {
        0 => None,
        1 => Some(reader.digest()?),
        _ => return None,
    };
    let chain_root_field = reader.digest()?;
    let chain_version = reader.u64()?;
    let version_count = usize::try_from(reader.u64()?).ok()?;
    let versions = (0..version_count)
        .map(|_| reader.digest())
        .collect::<Option<Vec<_>>>()?;

    let root = predecessor.is_none();
    let well_formed = reader.bytes.is_empty()
        && members.iter().all(|member| !member.is_empty())
        && members.windows(2).all(|pair| pair[0] < pair[1])
        && window.0 < window.1
        && inputs
            .windows(2)
            .all(|pair| pair[0].identity < pair[1].identity)
        && inputs.contains(&execution)
        && fill
            .as_ref()
            .is_none_or(|fill| inputs.iter().all(|input| input.identity != fill.identity))
        && versions.windows(2).all(|pair| pair[0] < pair[1])
        && !versions.is_empty()
        && root == (chain_version == 1)
        && root == (chain_root_field == ZERO);

    well_formed.then(|| CustodyRecordV1 {
        identity,
        binding_id,
        binding_fact_digest,
        lineage_root,
        lineage_version,
        rule_digest,
        market_semantics_identity,
        market_semantics_value,
        universe,
        instrument_master_key,
        members,
        window,
        execution,
        inputs,
        fill,
        predecessor,
        chain_root_field,
        chain_version,
        version_identities: versions.into_iter().collect(),
    })
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "read back by the derived view's chain verifier (T0-5 C6)"
    )
)]
struct RecordReader<'a> {
    bytes: &'a [u8],
}

#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "read back by the derived view's chain verifier (T0-5 C6)"
    )
)]
impl<'a> RecordReader<'a> {
    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        if self.bytes.len() < length {
            return None;
        }
        let (head, tail) = self.bytes.split_at(length);
        self.bytes = tail;
        Some(head)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_be_bytes(self.take(8)?.try_into().ok()?))
    }

    fn digest(&mut self) -> Option<BindingDigest> {
        Some(BindingDigest::from_untrusted_bytes(
            self.take(32)?.try_into().ok()?,
        ))
    }

    fn text(&mut self) -> Option<String> {
        let length = usize::try_from(self.u64()?).ok()?;
        String::from_utf8(self.take(length)?.to_vec()).ok()
    }

    fn timeframe(&mut self) -> Option<RecordedTimeframeV1> {
        let identity = self.digest()?;
        let label = self.text().filter(|label| !label.is_empty())?;
        Some(RecordedTimeframeV1 { identity, label })
    }
}

/// The digest one row is bound by: instrument, field and exact value, never its retrieval.
pub(crate) fn row_digest_v1(
    instrument: &str,
    field: &str,
    value_mantissa: i128,
    value_scale: u8,
) -> BindingDigest {
    let mut bytes = Vec::new();
    put_var(&mut bytes, instrument.as_bytes());
    put_var(&mut bytes, field.as_bytes());
    bytes.extend_from_slice(&value_mantissa.to_be_bytes());
    bytes.push(value_scale);
    sha256(ROW_DOMAIN, &bytes)
}

/// The digest of one stored custody record: its identity, minting cut, retrieval evidence and the
/// Owner clock the cut is an instant of.
pub(crate) fn custody_digest_v1(
    identity: BindingDigest,
    minting_cut: u64,
    evidence_digest: BindingDigest,
    clock: &CustodyMintingClockV1,
) -> BindingDigest {
    let mut bytes = Vec::with_capacity(200);
    bytes.extend_from_slice(identity.as_bytes());
    put_u64(&mut bytes, minting_cut);
    bytes.extend_from_slice(evidence_digest.as_bytes());
    put_var(&mut bytes, clock.identity.as_bytes());
    put_var(&mut bytes, clock.epoch.as_bytes());
    put_u64(&mut bytes, clock.sequence);
    bytes.extend_from_slice(clock.restart_continuity_digest.as_bytes());
    put_u64(&mut bytes, clock.uncertainty_bound);
    put_u64(&mut bytes, clock.skew_bound);
    sha256(RECORD_DOMAIN, &bytes)
}

pub(crate) const fn kind_tag(kind: CrossSectionVersionKindV1) -> u8 {
    match kind {
        CrossSectionVersionKindV1::Original => 1,
        CrossSectionVersionKindV1::Correction => 2,
        CrossSectionVersionKindV1::Withdrawal => 3,
    }
}

pub(crate) const fn kind_from_tag(tag: u8) -> Option<CrossSectionVersionKindV1> {
    match tag {
        1 => Some(CrossSectionVersionKindV1::Original),
        2 => Some(CrossSectionVersionKindV1::Correction),
        3 => Some(CrossSectionVersionKindV1::Withdrawal),
        _ => None,
    }
}

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn put_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn put_var(out: &mut Vec<u8>, value: &[u8]) {
    put_u64(out, value.len() as u64);
    out.extend_from_slice(value);
}

/// The five typed Market Semantics value fields, in the order the Market Semantics codec binds them.
pub(crate) fn put_market_semantics_value(out: &mut Vec<u8>, value: &MarketSemanticsValueV1) {
    out.extend_from_slice(value.normalization_identity.as_bytes());
    put_u16(out, value.price_adjustment as u16);
    put_u16(out, value.timestamp_basis as u16);
    out.extend_from_slice(value.price_unit_identity.as_bytes());
    out.extend_from_slice(value.size_unit_identity.as_bytes());
}

/// Reads back what [`put_market_semantics_value`] wrote, advancing `bytes` past it; `None` for
/// short bytes or a tag this Owner does not define.
pub(crate) fn take_market_semantics_value(bytes: &mut &[u8]) -> Option<MarketSemanticsValueV1> {
    fn take<'a>(bytes: &mut &'a [u8], length: usize) -> Option<&'a [u8]> {
        if bytes.len() < length {
            return None;
        }
        let (head, tail) = bytes.split_at(length);
        *bytes = tail;
        Some(head)
    }
    fn digest(bytes: &mut &[u8]) -> Option<BindingDigest> {
        Some(BindingDigest::from_untrusted_bytes(
            take(bytes, 32)?.try_into().ok()?,
        ))
    }
    fn tag(bytes: &mut &[u8]) -> Option<u16> {
        Some(u16::from_be_bytes(take(bytes, 2)?.try_into().ok()?))
    }

    let normalization_identity = digest(bytes)?;
    let price_adjustment = match tag(bytes)? {
        1 => MarketSemanticsPriceAdjustmentV1::Raw,
        2 => MarketSemanticsPriceAdjustmentV1::SplitAdjusted,
        3 => MarketSemanticsPriceAdjustmentV1::TotalReturnAdjusted,
        4 => MarketSemanticsPriceAdjustmentV1::Unknown,
        _ => return None,
    };
    let timestamp_basis = match tag(bytes)? {
        1 => MarketSemanticsTimestampBasisV1::EventEffective,
        2 => MarketSemanticsTimestampBasisV1::IntervalOpen,
        3 => MarketSemanticsTimestampBasisV1::IntervalClose,
        _ => return None,
    };
    Some(MarketSemanticsValueV1 {
        normalization_identity,
        price_adjustment,
        timestamp_basis,
        price_unit_identity: digest(bytes)?,
        size_unit_identity: digest(bytes)?,
    })
}

fn put_optional(out: &mut Vec<u8>, value: Option<BindingDigest>) {
    match value {
        None => out.push(0),
        Some(value) => {
            out.push(1);
            out.extend_from_slice(value.as_bytes());
        }
    }
}

fn sha256(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
#[path = "authority_tests.rs"]
mod tests;
