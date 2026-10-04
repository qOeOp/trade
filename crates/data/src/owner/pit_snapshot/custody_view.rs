//! The custody view and custody quote cut branches of the verified batch seal (slice T0-5).
//!
//! A custody view's batch is sealed from the stored row facts of the versions its view selects,
//! each checked against the version it belongs to and the custody record that holds it, so a
//! consumer reads exactly what custody states for that frame. The two constructors here are the
//! only ones besides the snapshot seal, and the module is private to the crate:
//!
//! ```compile_fail
//! use vibe_data::owner::pit_snapshot::custody_view::verify_custody_view_batch_v1;
//! ```

#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "sealed by the custody frame resolver (T0-5 C7 and C9)"
    )
)]

use sha2::{Digest as _, Sha256};

use super::{
    UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime, UntrustedPitObservation,
    UntrustedPitObservationBatchProposal, UntrustedPitSnapshotTimeEvidence,
    UntrustedProviderAvailableTime, UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
    VerifiedPitObservationBatch, authority::prepare_canonical_observation_rows,
};
use crate::owner::{
    pit_window_custody_v1::{
        PitObservationBatchSourceV1, QuoteDerivationV1,
        authority::{
            CustodyMintingClockV1, CustodyRecordV1, custody_timeframe_identity_v1, row_digest_v1,
        },
        view::{
            ChainVersionV1, ViewFrontierV1, ViewSelectionV1, derived_frontier_digest_v1,
            view_identity_v1,
        },
    },
    sample_fact::v2::SampleFactV2,
    source_binding::BindingDigest,
    strategy_input_binding::{MarketDataFieldSemantic, STRATEGY_INPUT_FIXED_I128_LE_V1},
};

const VIEW_REQUEST_DOMAIN: &[u8] = b"market-data.pit-window-view-request.v1\0";
const QUOTE_CUT_REQUEST_DOMAIN: &[u8] = b"market-data.pit-window-quote-cut-request.v1\0";

/// The fields one member's BAR cross-section holds.
const BAR_FIELDS: [MarketDataFieldSemantic; 5] = [
    MarketDataFieldSemantic::BarOpenPrice,
    MarketDataFieldSemantic::BarHighPrice,
    MarketDataFieldSemantic::BarLowPrice,
    MarketDataFieldSemantic::BarClosePrice,
    MarketDataFieldSemantic::BarVolumeQuantity,
];

/// The fields one member's quote holds, in the order a quote cut states them.
const QUOTE_FIELDS: [&str; 4] = ["BID_PRICE", "ASK_PRICE", "BID_SIZE", "ASK_SIZE"];

/// Channel and data-kind codes a custody row carries.
const MARKET_CHANNEL_CODE: u8 = 0x01;
const BAR_DATA_KIND_CODE: u8 = 0x01;

/// One stored row fact of a selected version, as custody holds it.
#[derive(Clone, Debug)]
pub(crate) struct StoredViewRowV1 {
    pub(crate) version_identity: BindingDigest,
    pub(crate) member_ordinal: u8,
    pub(crate) field: String,
    pub(crate) fact: SampleFactV2,
}

/// Everything a custody view's batch is sealed from.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CustodyViewInputsV1<'a> {
    pub(crate) chain_root: BindingDigest,
    /// The chain's root record: its basis, labels and universe.
    pub(crate) record: &'a CustodyRecordV1,
    /// The Owner clock the root was minted under; `d_k` is an instant of it.
    pub(crate) clock: &'a CustodyMintingClockV1,
    pub(crate) selection: &'a ViewSelectionV1,
    pub(crate) rows: &'a [StoredViewRowV1],
}

/// Why a custody view or quote cut was not sealed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CustodyViewSealErrorV1 {
    /// Not exactly one row per member and field of each selected version.
    RowCensus,
    /// A row that does not state its version, its member, its field or its custody.
    RowMismatch,
    /// Rows that do not agree on the fields one view states once.
    NonUniform,
    /// A quote cut's view is not a custody view.
    NotAView,
    /// A quote cut's instant outside the gap after its frame's decision cut.
    QuoteCutOutsideGap,
    /// Rows the canonical batch encoding refuses.
    Encoding,
}

use CustodyViewSealErrorV1 as SealError;

/// Seals one frame's custody view as a verified batch.
///
/// Each selected version has exactly one row per member and BAR field, and each row states that
/// version's identity, event, availability, publication and sequence, the member at its ordinal,
/// its field, a value its row digest binds, the custody's timeframe for its members, Instrument
/// Master key and Market Semantics. Every row states the same Source Binding and frontiers: a
/// successor under another binding is refused at commit, since the binding's lineage is in the
/// basis, so this is defense in depth.
///
/// # Errors
///
/// The [`CustodyViewSealErrorV1`] naming the first check that fails.
pub(crate) fn verify_custody_view_batch_v1(
    inputs: CustodyViewInputsV1<'_>,
) -> Result<VerifiedPitObservationBatch, SealError> {
    let CustodyViewInputsV1 {
        chain_root,
        record,
        clock,
        selection,
        rows,
    } = inputs;
    let decision_cut = selection.decision_cut_ns;
    let member_count = record.members.len();
    let expected = selection
        .selected
        .len()
        .checked_mul(member_count * BAR_FIELDS.len())
        .ok_or(SealError::RowCensus)?;

    if rows.len() != expected || record.chain_root() != chain_root {
        return Err(SealError::RowCensus);
    }
    let first = rows.first().ok_or(SealError::RowCensus)?.fact.row();
    let mut observations = Vec::with_capacity(rows.len());
    let mut publication = 0;

    for version in &selection.selected {
        let label = record
            .inputs
            .iter()
            .find(|timeframe| timeframe.identity == version.timeframe_identity)
            .map(|timeframe| timeframe.label.as_str())
            .ok_or(SealError::RowMismatch)?;
        let mut member_identities = vec![[0; 32]; member_count];
        publication = publication.max(version.publication_ns);

        for (ordinal, member) in record.members.iter().enumerate() {
            for semantic in BAR_FIELDS {
                let mut matching = rows.iter().filter(|row| {
                    row.version_identity == version.identity
                        && usize::from(row.member_ordinal) == ordinal
                        && row.field == semantic.row_field()
                });
                let stored = matching.next().ok_or(SealError::RowCensus)?;

                if matching.next().is_some() {
                    return Err(SealError::RowCensus);
                }
                let row = stored.fact.row();
                let states_its_version = row.cross_section_version == *version.identity.as_bytes()
                    && row.event_effective == version.event_ns
                    && row.available == version.availability_ns
                    && row.publication == version.publication_ns
                    && row.correction_sequence == version.correction_sequence;
                let states_its_custody = row.instrument == member.as_bytes()
                    && row.channel == MARKET_CHANNEL_CODE
                    && row.data_kind == BAR_DATA_KIND_CODE
                    && row.field_semantic == semantic.identity().as_bytes()
                    && row.value_semantic == STRATEGY_INPUT_FIXED_I128_LE_V1.as_bytes()
                    && row.unit == semantic.unit().canonical().as_bytes()
                    && row.canonical_row_digest
                        == *row_digest_v1(
                            member,
                            semantic.row_field(),
                            row.value_mantissa,
                            row.value_scale,
                        )
                        .as_bytes()
                    && row.instrument_master_digest == record.instrument_master_key
                    && row.market_semantics_identity == record.market_semantics_identity;

                if !states_its_version || !states_its_custody {
                    return Err(SealError::RowMismatch);
                }

                // One member's timeframe identity is one schedule's: every field of a member
                // states the same one, which the custody's timeframe identity hashes.
                if semantic == BAR_FIELDS[0] {
                    member_identities[ordinal] = row.timeframe_identity;
                } else if member_identities[ordinal] != row.timeframe_identity {
                    return Err(SealError::RowMismatch);
                }
                let uniform = row.source_binding_identity == first.source_binding_identity
                    && row.source_binding_lineage_root == first.source_binding_lineage_root
                    && row.source_binding_lineage_version == first.source_binding_lineage_version
                    && row.source_frontier_digest == first.source_frontier_digest
                    && row.correction_stream == first.correction_stream
                    && row.correction_frontier_digest == first.correction_frontier_digest;

                if !uniform {
                    return Err(SealError::NonUniform);
                }
                let stream = String::from_utf8(row.correction_stream.clone())
                    .map_err(|_| SealError::Encoding)?;
                let (value_mantissa, value_scale) =
                    canonical_decimal_v1(row.value_mantissa, row.value_scale);
                observations.push(UntrustedPitObservation {
                    symbolic_key: format!("{member}.{}.{label}", semantic.row_field()),
                    member_key: member.clone(),
                    instrument: member.clone(),
                    channel: "MARKET".to_owned(),
                    data_kind: "BAR".to_owned(),
                    timeframe: label.to_owned(),
                    field: semantic.row_field().to_owned(),
                    value_mantissa,
                    value_scale,
                    event_effective: row.event_effective,
                    provider_available: row.available,
                    retrieval: decision_cut,
                    correction_publication: row.publication,
                    source_binding_identity: row.source_binding_identity,
                    source_frontier_digest: row.source_frontier_digest,
                    instrument_master_digest: row.instrument_master_digest,
                    universe_selection_digest: record.universe.0,
                    market_semantics_identity: row.market_semantics_identity,
                    correction_stream_identity: stream,
                    correction_sequence: row.correction_sequence,
                    correction_frontier_digest: row.correction_frontier_digest,
                });
            }
        }

        if custody_timeframe_identity_v1(&member_identities) != version.timeframe_identity {
            return Err(SealError::RowMismatch);
        }
    }

    // The view's binding is the root's: a row under another binding is not this view's.
    if first.source_binding_identity != record.binding_id
        || first.source_binding_lineage_root != record.lineage_root
        || first.source_binding_lineage_version != record.lineage_version
    {
        return Err(SealError::NonUniform);
    }
    observations.sort_by(|left, right| {
        (&left.symbolic_key, &left.member_key).cmp(&(&right.symbolic_key, &right.member_key))
    });
    let prepared = prepare_canonical_observation_rows(&UntrustedPitObservationBatchProposal {
        rows: observations,
    })
    .map_err(|_| SealError::Encoding)?;
    let view_identity = view_identity_v1(record.rule_digest, selection);
    let derived_frontier_digest = derived_frontier_digest_v1(&ViewFrontierV1 {
        chain_root,
        binding_id: record.binding_id,
        binding_fact_digest: record.binding_fact_digest,
        lineage_root: record.lineage_root,
        lineage_version: record.lineage_version,
        source_frontier_digest: first.source_frontier_digest,
        correction_stream: first.correction_stream.clone(),
        correction_frontier_digest: first.correction_frontier_digest,
        instrument_master_key: record.instrument_master_key,
        market_semantics_identity: record.market_semantics_identity,
        universe: record.universe,
        clock_identity: clock.identity.clone(),
        clock_epoch: clock.epoch.clone(),
    });
    let mut request = Vec::with_capacity(48);
    request.extend_from_slice(chain_root.as_bytes());
    request.extend_from_slice(&selection.event_ns.to_be_bytes());
    request.extend_from_slice(&decision_cut.to_be_bytes());
    let coordinate = |value: u64| (value, clock.identity.clone(), clock.epoch.clone());
    let (event, event_clock, event_epoch) = coordinate(selection.event_ns);
    Ok(VerifiedPitObservationBatch {
        request_identity: view_identity,
        request_digest: sha256(VIEW_REQUEST_DOMAIN, &request),
        correlation_identity: chain_root,
        scope_digest: chain_root,
        source: PitObservationBatchSourceV1::CustodyView {
            chain_root,
            view_identity,
            event_ns: selection.event_ns,
            decision_cut_ns: decision_cut,
            derived_frontier_digest,
        },
        source_binding_identity: record.binding_id,
        source_binding_fact_digest: record.binding_fact_digest,
        source_binding_lineage_root: record.lineage_root,
        source_binding_lineage_version: record.lineage_version,
        source_frontier_digest: first.source_frontier_digest,
        correction_frontier_digest: first.correction_frontier_digest,
        instrument_master_digest: record.instrument_master_key,
        universe_selection_digest: record.universe.0,
        market_semantics_identity: record.market_semantics_identity,
        time_evidence: UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(
                event,
                event_clock,
                event_epoch,
            ),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                decision_cut,
                clock.identity.clone(),
                clock.epoch.clone(),
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(
                decision_cut,
                clock.identity.clone(),
                clock.epoch.clone(),
            ),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                publication,
                clock.identity.clone(),
                clock.epoch.clone(),
            )),
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
                decision_cut,
                clock.identity.clone(),
                clock.epoch.clone(),
            ),
            monotonic_sequence: clock.sequence,
            restart_continuity_digest: clock.restart_continuity_digest,
            skew_bound: clock.skew_bound,
            uncertainty_bound: clock.uncertainty_bound,
            observed_at: decision_cut,
            valid_through: selection.next_event_ns,
        },
        digest: prepared.digest(),
        observations: prepared.rows().to_vec().into_boxed_slice(),
    })
}

/// One member's fill-timeframe bar, verified against the custody record and the version it
/// belongs to.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FillBarRowV1 {
    pub(crate) instrument: String,
    pub(crate) open_mantissa: i128,
    pub(crate) open_scale: u8,
    pub(crate) volume_mantissa: i128,
    pub(crate) volume_scale: u8,
}

/// Verifies `rows` as exactly one complete BAR cross-section of the custody's fill timeframe, at
/// `version`: one row per member and BAR field, each stating that version's identity, event,
/// availability, publication and sequence, the member at its ordinal, its field, a value its row
/// digest binds, and the custody's fill timeframe, Instrument Master key and Market Semantics.
///
/// The open and the volume are the only fields a quote cut derivation (T0-6) takes from a fill
/// bar; every field is still checked, so a tampered bar is refused rather than partly trusted.
///
/// # Errors
///
/// The [`CustodyViewSealErrorV1`] naming the first check that fails.
pub(crate) fn verify_fill_bar_rows_v1(
    record: &CustodyRecordV1,
    version: &ChainVersionV1,
    rows: &[StoredViewRowV1],
) -> Result<Vec<FillBarRowV1>, SealError> {
    if record
        .fill
        .as_ref()
        .is_none_or(|timeframe| timeframe.identity != version.timeframe_identity)
    {
        return Err(SealError::RowMismatch);
    }
    let member_count = record.members.len();

    if rows.len() != member_count * BAR_FIELDS.len() {
        return Err(SealError::RowCensus);
    }
    let mut member_identities = vec![[0; 32]; member_count];
    let mut out = Vec::with_capacity(member_count);

    for (ordinal, member) in record.members.iter().enumerate() {
        let mut open = None;
        let mut volume = None;

        for semantic in BAR_FIELDS {
            let mut matching = rows.iter().filter(|row| {
                row.version_identity == version.identity
                    && usize::from(row.member_ordinal) == ordinal
                    && row.field == semantic.row_field()
            });
            let stored = matching.next().ok_or(SealError::RowCensus)?;

            if matching.next().is_some() {
                return Err(SealError::RowCensus);
            }
            let row = stored.fact.row();
            let states_its_version = row.cross_section_version == *version.identity.as_bytes()
                && row.event_effective == version.event_ns
                && row.available == version.availability_ns
                && row.publication == version.publication_ns
                && row.correction_sequence == version.correction_sequence;
            let states_its_custody = row.instrument == member.as_bytes()
                && row.channel == MARKET_CHANNEL_CODE
                && row.data_kind == BAR_DATA_KIND_CODE
                && row.field_semantic == semantic.identity().as_bytes()
                && row.value_semantic == STRATEGY_INPUT_FIXED_I128_LE_V1.as_bytes()
                && row.unit == semantic.unit().canonical().as_bytes()
                && row.canonical_row_digest
                    == *row_digest_v1(
                        member,
                        semantic.row_field(),
                        row.value_mantissa,
                        row.value_scale,
                    )
                    .as_bytes()
                && row.instrument_master_digest == record.instrument_master_key
                && row.market_semantics_identity == record.market_semantics_identity;

            if !states_its_version || !states_its_custody {
                return Err(SealError::RowMismatch);
            }

            if semantic == BAR_FIELDS[0] {
                member_identities[ordinal] = row.timeframe_identity;
            } else if member_identities[ordinal] != row.timeframe_identity {
                return Err(SealError::RowMismatch);
            }
            let (value_mantissa, value_scale) =
                canonical_decimal_v1(row.value_mantissa, row.value_scale);

            if semantic == MarketDataFieldSemantic::BarOpenPrice {
                open = Some((value_mantissa, value_scale));
            } else if semantic == MarketDataFieldSemantic::BarVolumeQuantity {
                volume = Some((value_mantissa, value_scale));
            }
        }
        let (open_mantissa, open_scale) = open.ok_or(SealError::RowCensus)?;
        let (volume_mantissa, volume_scale) = volume.ok_or(SealError::RowCensus)?;
        out.push(FillBarRowV1 {
            instrument: member.clone(),
            open_mantissa,
            open_scale,
            volume_mantissa,
            volume_scale,
        });
    }

    if custody_timeframe_identity_v1(&member_identities) != version.timeframe_identity {
        return Err(SealError::RowMismatch);
    }
    Ok(out)
}

/// One member's quote value, as a quote cut derivation states it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CustodyQuoteRowV1 {
    pub(crate) instrument: String,
    pub(crate) field: &'static str,
    pub(crate) value_mantissa: i128,
    pub(crate) value_scale: u8,
}

/// Everything a custody quote cut's batch is sealed from, besides the view it follows.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CustodyQuoteCutInputsV1<'a> {
    pub(crate) quote_cut_identity: BindingDigest,
    pub(crate) instant_ns: u64,
    pub(crate) available_ns: u64,
    pub(crate) publication_ns: u64,
    /// The exclusive end of the gap: the next frame's event, or the run's end for the last.
    pub(crate) bound_ns_exclusive: u64,
    pub(crate) derivation: QuoteDerivationV1,
    pub(crate) rows: &'a [CustodyQuoteRowV1],
}

/// Seals the quote cut of the gap after `view`'s frame: Quote rows only, never fill bars, one
/// complete quote per member in member order, at one instant inside `(d_k, bound)`.
///
/// # Errors
///
/// [`CustodyViewSealErrorV1::NotAView`] for a view that is not a custody view;
/// [`CustodyViewSealErrorV1::QuoteCutOutsideGap`] for an instant outside the gap;
/// [`CustodyViewSealErrorV1::RowCensus`] for rows that are not one complete quote per member in
/// member order; [`CustodyViewSealErrorV1::Encoding`] for rows the canonical encoding refuses.
pub(crate) fn verify_custody_quote_cut_batch_v1(
    view: &VerifiedPitObservationBatch,
    quote_cut: CustodyQuoteCutInputsV1<'_>,
) -> Result<VerifiedPitObservationBatch, SealError> {
    let PitObservationBatchSourceV1::CustodyView {
        chain_root,
        decision_cut_ns,
        ..
    } = view.source()
    else {
        return Err(SealError::NotAView);
    };

    if quote_cut.instant_ns <= decision_cut_ns
        || quote_cut.instant_ns >= quote_cut.bound_ns_exclusive
        || quote_cut.available_ns < quote_cut.instant_ns
        || quote_cut.publication_ns < quote_cut.available_ns
        || quote_cut.publication_ns >= quote_cut.bound_ns_exclusive
    {
        return Err(SealError::QuoteCutOutsideGap);
    }
    let mut members = view
        .observations()
        .iter()
        .map(|row| row.instrument().to_owned())
        .collect::<Vec<_>>();
    members.sort();
    members.dedup();
    let template = view.observations().first().ok_or(SealError::RowCensus)?;
    let expected = members
        .iter()
        .flat_map(|member| {
            QUOTE_FIELDS
                .iter()
                .map(move |field| (member.as_str(), *field))
        })
        .collect::<Vec<_>>();

    if quote_cut.rows.len() != expected.len()
        || quote_cut
            .rows
            .iter()
            .zip(&expected)
            .any(|(row, (member, field))| row.instrument != *member || row.field != *field)
    {
        return Err(SealError::RowCensus);
    }
    let mut observations = quote_cut
        .rows
        .iter()
        .map(|row| UntrustedPitObservation {
            symbolic_key: format!("{}.{}.TICK", row.instrument, row.field),
            member_key: row.instrument.clone(),
            instrument: row.instrument.clone(),
            channel: "MARKET".to_owned(),
            data_kind: "QUOTE".to_owned(),
            timeframe: "TICK".to_owned(),
            field: row.field.to_owned(),
            value_mantissa: row.value_mantissa,
            value_scale: row.value_scale,
            event_effective: quote_cut.instant_ns,
            provider_available: quote_cut.available_ns,
            retrieval: quote_cut.publication_ns,
            correction_publication: quote_cut.publication_ns,
            source_binding_identity: view.source_binding_identity(),
            source_frontier_digest: view.source_frontier_digest(),
            instrument_master_digest: view.instrument_master_digest(),
            universe_selection_digest: view.universe_selection_digest(),
            market_semantics_identity: view.market_semantics_identity(),
            correction_stream_identity: template.correction_stream_identity().to_owned(),
            correction_sequence: 1,
            correction_frontier_digest: view.correction_frontier_digest(),
        })
        .collect::<Vec<_>>();
    observations.sort_by(|left, right| {
        (&left.symbolic_key, &left.member_key).cmp(&(&right.symbolic_key, &right.member_key))
    });
    let prepared = prepare_canonical_observation_rows(&UntrustedPitObservationBatchProposal {
        rows: observations,
    })
    .map_err(|_| SealError::Encoding)?;
    let mut request = Vec::with_capacity(72);
    request.extend_from_slice(chain_root.as_bytes());
    request.extend_from_slice(quote_cut.quote_cut_identity.as_bytes());
    request.extend_from_slice(&quote_cut.instant_ns.to_be_bytes());
    let time = view.time_evidence();
    let clock = (
        time.decision_cut.clock_identity.clone(),
        time.decision_cut.clock_epoch.clone(),
    );
    Ok(VerifiedPitObservationBatch {
        request_identity: quote_cut.quote_cut_identity,
        request_digest: sha256(QUOTE_CUT_REQUEST_DOMAIN, &request),
        correlation_identity: chain_root,
        scope_digest: chain_root,
        source: PitObservationBatchSourceV1::CustodyQuoteCut {
            chain_root,
            quote_cut_identity: quote_cut.quote_cut_identity,
            instant_ns: quote_cut.instant_ns,
            derivation: quote_cut.derivation,
        },
        source_binding_identity: view.source_binding_identity(),
        source_binding_fact_digest: view.source_binding_fact_digest(),
        source_binding_lineage_root: view.source_binding_lineage_root(),
        source_binding_lineage_version: view.source_binding_lineage_version(),
        source_frontier_digest: view.source_frontier_digest(),
        correction_frontier_digest: view.correction_frontier_digest(),
        instrument_master_digest: view.instrument_master_digest(),
        universe_selection_digest: view.universe_selection_digest(),
        market_semantics_identity: view.market_semantics_identity(),
        time_evidence: UntrustedPitSnapshotTimeEvidence {
            event_effective: UntrustedEventEffectiveTime::from_untrusted(
                quote_cut.instant_ns,
                clock.0.clone(),
                clock.1.clone(),
            ),
            provider_available: UntrustedProviderAvailableTime::from_untrusted(
                quote_cut.available_ns,
                clock.0.clone(),
                clock.1.clone(),
            ),
            retrieval: UntrustedRetrievalTime::from_untrusted(
                quote_cut.publication_ns,
                clock.0.clone(),
                clock.1.clone(),
            ),
            correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                quote_cut.publication_ns,
                clock.0.clone(),
                clock.1.clone(),
            )),
            decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
                quote_cut.publication_ns,
                clock.0.clone(),
                clock.1,
            ),
            monotonic_sequence: time.monotonic_sequence,
            restart_continuity_digest: time.restart_continuity_digest,
            skew_bound: time.skew_bound,
            uncertainty_bound: time.uncertainty_bound,
            observed_at: quote_cut.publication_ns,
            valid_through: quote_cut.bound_ns_exclusive,
        },
        digest: prepared.digest(),
        observations: prepared.rows().to_vec().into_boxed_slice(),
    })
}

/// The canonical form of `mantissa * 10^-scale`: the same value with every trailing fractional zero
/// dropped, so `37244360000000` at scale 9 is `3724436` at scale 2 and zero is `0` at scale 0.
///
/// Custody stores every value at the fixed value scale, while a verified observation batch admits
/// only canonical decimals; the view states each custody value canonically. The projection is
/// exact - it only divides out factors of ten - and the custody row, its digest and its identity
/// keep the stored scale. A binding reads the value back at its role's scale.
pub(crate) const fn canonical_decimal_v1(mut mantissa: i128, mut scale: u8) -> (i128, u8) {
    while scale > 0 && mantissa % 10 == 0 {
        mantissa /= 10;
        scale -= 1;
    }
    (mantissa, scale)
}

fn sha256(domain: &[u8], bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
#[path = "custody_view_tests.rs"]
mod tests;
