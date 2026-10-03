//! The custody authority's derivations and every refusal it decides without a store.

use rstest::rstest;

use super::*;
use crate::owner::{
    bar_schedule::{
        BarScheduleCompletionV1, BarScheduleFactV1, BarScheduleUnitV1,
        schedule_time_zone_identity_v1,
    },
    declared_bar_timeframe_v1::{DeclaredBarAnchorV1, anchor_identity_v1},
    pit_window_custody_v1::{
        UntrustedCrossSectionVersionV1, UntrustedCustodyRowV1, UntrustedPitWindowCustodyClaimV1,
    },
    sample_fact::bar_timeframe_spec_from_schedule_v1,
    source_binding::{
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedMarketDataAsOf, UntrustedSourceBarAnchorV1,
        UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1, UntrustedSourceBarCompletionV1,
        UntrustedSourceBarLabelV1, UntrustedSourceBarUnitV1, UntrustedSourceBindingLocator,
        UntrustedSourceBindingLocatorFields,
    },
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

const SECOND: u64 = 1_000_000_000;
const MINUTE: u64 = 60 * SECOND;
const DAY: u64 = 86_400 * SECOND;
/// 2026-09-21: when a backfill ran, never a historical instant.
const RETRIEVED: u64 = 1_790_000_000_000_000_000;
const BTC: &str = "BTCUSDT-PERP.BINANCE";
const ETH: &str = "ETHUSDT-PERP.BINANCE";

fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn locator() -> UntrustedSourceBindingLocator {
    let frontier = |byte: u8| UntrustedCompleteFrontier {
        stream_identity: "test/stream".to_owned(),
        cut_identity: "test/stream/cut-1".to_owned(),
        sequence: 1,
        digest: d(byte),
    };
    UntrustedSourceBindingLocator::from_untrusted(UntrustedSourceBindingLocatorFields {
        owner: "MARKET_DATA_OWNER_V1".to_owned(),
        lineage_root: d(2),
        lineage_version: 1,
        predecessor_binding_id: None,
        predecessor_fact_digest: None,
        binding_id: d(1),
        fact_digest: d(3),
        credential_handle_identity: d(23),
        credential_audience: UntrustedCredentialAudienceClaim::MarketData,
        credential_capabilities: [UntrustedCredentialCapabilityClaim::MarketDataRead]
            .into_iter()
            .collect(),
        source_frontier: frontier(24),
        correction_frontier: frontier(25),
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: d(26),
            clock_identity: "TEST-CLOCK".to_owned(),
            clock_epoch: "TEST-EPOCH".to_owned(),
            monotonic_sequence: 7,
            restart_continuity_digest: d(9),
            skew_bound: 1,
            uncertainty_bound: 1,
            event_effective: 1,
            provider_available: 1,
            retrieval: 1,
            correction_publication: 1,
            observed_at: 1,
            effective_at: 1,
            valid_through: 2,
        },
    })
}

/// A continuous bar of `step` `unit`s from the Unix epoch, labelled by its close.
fn continuous(
    label: &str,
    step: u32,
    unit: UntrustedSourceBarUnitV1,
) -> UntrustedSourceBarTimeframeV1 {
    UntrustedSourceBarTimeframeV1 {
        row_timeframe: label.to_owned(),
        cadence: UntrustedSourceBarCadenceV1::FixedInterval { step, unit },
        anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
        clock: UntrustedSourceBarClockV1::Continuous,
        label: UntrustedSourceBarLabelV1::IntervalClose,
        completion: UntrustedSourceBarCompletionV1::CompleteOnly,
    }
}

fn session_day(label: &str) -> UntrustedSourceBarTimeframeV1 {
    UntrustedSourceBarTimeframeV1 {
        row_timeframe: label.to_owned(),
        cadence: UntrustedSourceBarCadenceV1::ExchangeSessionDay,
        anchor: UntrustedSourceBarAnchorV1::SessionOpen,
        clock: UntrustedSourceBarClockV1::ScheduleBounded,
        label: UntrustedSourceBarLabelV1::IntervalClose,
        completion: UntrustedSourceBarCompletionV1::CompleteOnly,
    }
}

fn rule(
    visibility: UntrustedSourceVisibilityV1,
    publishes_corrections: bool,
) -> UntrustedSourceAvailabilityRuleV1 {
    UntrustedSourceAvailabilityRuleV1 {
        visibility,
        publishes_corrections,
    }
}

const ONE_SECOND_AFTER_CLOSE: UntrustedSourceVisibilityV1 =
    UntrustedSourceVisibilityV1::AfterBarClose { lag_ns: SECOND };

/// What the Owner loaded for a request: binding, Instrument Master facts, membership.
#[derive(Clone)]
struct Basis {
    binding: Option<CustodyBindingV1>,
    instruments: Vec<CustodyInstrumentV1>,
    membership: Vec<CustodyMembershipV1>,
}

impl Basis {
    fn new(publishes_corrections: bool) -> Self {
        Self {
            binding: Some(CustodyBindingV1 {
                admitted_under_locator: true,
                binding_id: d(1),
                fact_digest: d(3),
                lineage_root: d(2),
                lineage_version: 1,
                availability_rule: Some(rule(ONE_SECOND_AFTER_CLOSE, publishes_corrections)),
                bar_timeframes: vec![
                    continuous("1D", 24, UntrustedSourceBarUnitV1::Hour),
                    continuous("1M", 1, UntrustedSourceBarUnitV1::Minute),
                    continuous("24H", 24, UntrustedSourceBarUnitV1::Hour),
                    continuous("2D", 48, UntrustedSourceBarUnitV1::Hour),
                    // A second label for the minute bar: the same timeframe by another name.
                    continuous("5M", 1, UntrustedSourceBarUnitV1::Minute),
                    // A four-hour bar labelled at its open.
                    UntrustedSourceBarTimeframeV1 {
                        label: UntrustedSourceBarLabelV1::IntervalOpen,
                        ..continuous("4H", 4, UntrustedSourceBarUnitV1::Hour)
                    },
                    session_day("SESSION"),
                ],
                market_semantics_identity: d(30),
                source_frontier_digest: d(24),
                correction_stream: "test/stream".to_owned(),
                correction_frontier_digest: d(25),
            }),
            instruments: vec![instrument(40), instrument(41)],
            membership: vec![membership(BTC), membership(ETH)],
        }
    }

    fn binding(&mut self) -> &mut CustodyBindingV1 {
        self.binding.as_mut().unwrap()
    }

    fn derive(
        &self,
        request: &UntrustedPitWindowCustodyRequestV1,
    ) -> Result<DerivedCustodyV1, Refused> {
        derive_custody_v1(CustodyInputsV1 {
            request,
            binding: self.binding.as_ref(),
            instruments: &self.instruments,
            membership: &self.membership,
        })
    }
}

fn instrument(byte: u8) -> CustodyInstrumentV1 {
    CustodyInstrumentV1 {
        at_start: Some(CustodyMemberFactV1 {
            fact_digest: d(byte),
            class: InstrumentClass::CryptoPerpetual,
            time_zone: "Etc/UTC".to_owned(),
            market_semantics_identity: d(30),
            effective_until: None,
            price_scale: 2,
            quantity_scale: 3,
        }),
        at_end: Some(d(byte)),
        others: Vec::new(),
    }
}

fn membership(member: &str) -> CustodyMembershipV1 {
    CustodyMembershipV1 {
        instrument: member.as_bytes().to_vec(),
        included: true,
        effective_from_ns: 0,
        effective_until_ns: None,
    }
}

/// One row per member and BAR field, each value `base` plus its field position.
fn rows(base: i128, retrieval_ns: u64) -> Vec<UntrustedCustodyRowV1> {
    [BTC, ETH]
        .into_iter()
        .flat_map(|member| {
            ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"]
                .into_iter()
                .zip(0..)
                .map(move |(field, offset)| UntrustedCustodyRowV1 {
                    instrument: member.to_owned(),
                    field: field.to_owned(),
                    value_mantissa: base + offset,
                    value_scale: 2,
                    retrieval_ns,
                    retrieval_route: "data.binance.vision/daily-klines".to_owned(),
                })
        })
        .collect()
}

fn original(timeframe: &str, event: u64) -> UntrustedCrossSectionVersionV1 {
    UntrustedCrossSectionVersionV1 {
        timeframe: timeframe.to_owned(),
        event_effective_ns: event,
        kind: CrossSectionVersionKindV1::Original,
        correction_sequence: 1,
        predecessor_version: None,
        publication_ns: None,
        rows: rows(6_500_000, RETRIEVED),
    }
}

fn correction(
    timeframe: &str,
    event: u64,
    predecessor: BindingDigest,
    sequence: u64,
    publication_ns: u64,
) -> UntrustedCrossSectionVersionV1 {
    UntrustedCrossSectionVersionV1 {
        timeframe: timeframe.to_owned(),
        event_effective_ns: event,
        kind: CrossSectionVersionKindV1::Correction,
        correction_sequence: sequence,
        predecessor_version: Some(predecessor),
        publication_ns: Some(publication_ns),
        rows: rows(6_600_000, RETRIEVED),
    }
}

/// Two members, three days, a daily execution timeframe and a one-minute fill timeframe.
fn request() -> UntrustedPitWindowCustodyRequestV1 {
    UntrustedPitWindowCustodyRequestV1 {
        source_binding: locator(),
        market_semantics_identity: d(30),
        universe_selection: UntrustedUniverseSelectionLocatorV1::from_untrusted(d(50), d(51)),
        members: vec![BTC.to_owned(), ETH.to_owned()],
        window_start_ns: 0,
        window_end_ns_exclusive: 3 * DAY,
        execution_timeframe: "1D".to_owned(),
        input_timeframes: vec!["1D".to_owned()],
        fill_timeframe: Some("1M".to_owned()),
        predecessor: None,
        cross_sections: vec![
            original("1D", DAY),
            original("1D", 2 * DAY),
            original("1M", DAY + MINUTE),
        ],
    }
}

fn root_identity(derived: &DerivedCustodyV1) -> BindingDigest {
    derived.identity_at(ChainPositionV1::ROOT).0
}

#[rstest]
fn a_root_derives_its_versions_rows_and_availability_from_the_rule() {
    let derived = Basis::new(false).derive(&request()).unwrap();

    assert_eq!(derived.versions.len(), 3);
    let first = &derived.versions[0];
    assert_eq!(first.availability, CustodyInstantV1::At(DAY + SECOND));
    assert_eq!(
        first.publication, first.availability,
        "a source publishing no corrections publishes at availability"
    );
    assert_eq!(first.rows.len(), 10);
    assert_eq!(
        first
            .rows
            .iter()
            .map(|row| (row.member_ordinal, row.semantic.row_field()))
            .take(6)
            .collect::<Vec<_>>(),
        [
            (0, "OPEN"),
            (0, "HIGH"),
            (0, "LOW"),
            (0, "CLOSE"),
            (0, "VOLUME"),
            (1, "OPEN")
        ],
        "rows are bound in member then field order"
    );
    assert_ne!(
        first.rows[0].timeframe_identity, first.rows[5].timeframe_identity,
        "each member's timeframe is its own schedule's"
    );
    assert_eq!(derived.max_retrieval_ns, RETRIEVED);
    assert_eq!(
        derived.resolve_at_minting_cut(RETRIEVED, None).unwrap()[0],
        (DAY + SECOND, DAY + SECOND)
    );
    let (identity, bytes) = derived.identity_at(ChainPositionV1::ROOT);
    assert_eq!(identity, sha256(CUSTODY_DOMAIN, &bytes));
}

/// Retrieval instants and routes are evidence: a resubmission with other evidence derives the
/// same identity and versions, and only the evidence digest moves. A value is not evidence.
#[rstest]
fn retrieval_evidence_stays_outside_every_identity() {
    let basis = Basis::new(false);
    let derived = basis.derive(&request()).unwrap();
    let mut retried = request();

    for version in &mut retried.cross_sections {
        for row in &mut version.rows {
            row.retrieval_ns += 7 * DAY;
            row.retrieval_route = "fapi.binance.com/fapi/v1/klines".to_owned();
        }
    }
    let rederived = basis.derive(&retried).unwrap();

    assert_eq!(root_identity(&rederived), root_identity(&derived));
    assert_eq!(rederived.basis_digest, derived.basis_digest);
    assert_eq!(
        rederived
            .versions
            .iter()
            .map(|version| version.identity)
            .collect::<Vec<_>>(),
        derived
            .versions
            .iter()
            .map(|version| version.identity)
            .collect::<Vec<_>>()
    );
    assert_ne!(rederived.evidence_digest, derived.evidence_digest);
    assert_ne!(
        custody_digest_v1(
            root_identity(&derived),
            RETRIEVED,
            rederived.evidence_digest
        ),
        custody_digest_v1(root_identity(&derived), RETRIEVED, derived.evidence_digest),
        "the record digest binds the evidence"
    );

    let mut revalued = request();
    revalued.cross_sections[0].rows[3].value_mantissa += 1;
    assert_ne!(
        root_identity(&basis.derive(&revalued).unwrap()),
        root_identity(&derived)
    );
}

/// Under a rule set to the retrieval instant, a row's availability is the minting cut, which
/// enters no identity: the same custody minted at two cuts has one identity.
#[rstest]
fn an_availability_at_retrieval_is_the_minting_cut_and_outside_the_identity() {
    let mut basis = Basis::new(false);
    basis.binding().availability_rule = Some(rule(UntrustedSourceVisibilityV1::AtRetrieval, false));
    let derived = basis.derive(&request()).unwrap();

    assert_eq!(
        derived.versions[0].availability,
        CustodyInstantV1::MintingCut
    );
    assert_eq!(
        derived.resolve_at_minting_cut(RETRIEVED + 5, None).unwrap()[0],
        (RETRIEVED + 5, RETRIEVED + 5)
    );
    assert_eq!(
        derived.resolve_at_minting_cut(RETRIEVED + 9, None).unwrap()[0],
        (RETRIEVED + 9, RETRIEVED + 9)
    );
    assert_ne!(
        derived.rule_digest,
        Basis::new(false).derive(&request()).unwrap().rule_digest
    );
}

/// The timeframe a custody binds for a member is the one the BAR schedule path derives from a
/// schedule the same declaration selects for the same Instrument Master fact.
#[rstest]
fn a_custody_timeframe_is_the_one_the_schedule_path_states() {
    let derived = Basis::new(false).derive(&request()).unwrap();
    let time_zone =
        schedule_time_zone_identity_v1(InstrumentClass::CryptoPerpetual, d(40), "Etc/UTC").unwrap();
    let zero = BindingDigest::from_untrusted_bytes([0; 32]);
    let schedule = BarScheduleFactV1 {
        canonical_instrument: BTC.into(),
        predecessor_fact_digest: None,
        effective_from: 0,
        effective_until: None,
        kind: BarScheduleKindV1::FixedInterval,
        step: 24,
        unit: BarScheduleUnitV1::Hour,
        anchor_identity: anchor_identity_v1(DeclaredBarAnchorV1::UnixEpoch),
        calendar_identity: zero,
        session_identity: zero,
        time_zone_identity: time_zone,
        label: BarScheduleLabelV1::IntervalClose,
        completion: BarScheduleCompletionV1::CompleteOnly,
        instrument_master_digest: d(60),
        instrument_master_fact_digest: d(40),
        instrument_master_cut_digest: d(61),
        market_semantics_identity: d(30),
        schedule_source_frontier: d(24),
        schedule_correction_frontier: d(25),
        cut_effective_instant: i128::from(DAY),
        canonical_bytes: Vec::new(),
        identity: zero,
    };
    let declared = DeclaredBarTimeframeV1::from_declaration(
        d(3),
        &continuous("1D", 24, UntrustedSourceBarUnitV1::Hour),
    );

    assert!(declared.admits_schedule(&schedule));
    assert_eq!(
        derived.execution.member_identities[0],
        bar_timeframe_spec_from_schedule_v1(&schedule)
            .unwrap()
            .identity()
    );
}

type Edit = fn(&mut UntrustedPitWindowCustodyRequestV1, &mut Basis);

/// Types a case's edit, which `rstest` binds without one.
const fn e(edit: Edit) -> Edit {
    edit
}

#[rstest]
#[case::no_member(e(|r, _| r.members.clear()), Refused::InvalidRequest)]
#[case::three_members(e(|r, b| {
    r.members.push("XRPUSDT-PERP.BINANCE".into());
    b.instruments.push(instrument(42));
}), Refused::InvalidRequest)]
#[case::members_out_of_order(e(|r, _| r.members.reverse()), Refused::InvalidRequest)]
#[case::empty_window(e(|r, _| r.window_end_ns_exclusive = r.window_start_ns), Refused::InvalidRequest)]
#[case::execution_not_an_input(e(|r, _| r.execution_timeframe = "24H".into()), Refused::InvalidRequest)]
#[case::undeclared_input(e(|r, _| r.input_timeframes.push("6H".into())), Refused::InvalidRequest)]
#[case::undeclared_fill(e(|r, _| r.fill_timeframe = Some("1S".into())), Refused::InvalidRequest)]
#[case::session_input(e(|r, _| r.input_timeframes.push("SESSION".into())), Refused::InvalidRequest)]
#[case::two_labels_one_timeframe(e(|r, _| r.input_timeframes.push("24H".into())), Refused::InvalidRequest)]
#[case::event_outside_window(e(|r, _| r.cross_sections[1].event_effective_ns = 3 * DAY), Refused::InvalidRequest)]
#[case::versions_out_of_order(e(|r, _| r.cross_sections.swap(0, 1)), Refused::InvalidRequest)]
#[case::version_of_an_unheld_timeframe(e(|r, _| r.cross_sections[2].timeframe = "24H".into()), Refused::InvalidRequest)]
#[case::row_missing(e(|r, _| { r.cross_sections[0].rows.pop(); }), Refused::InvalidRequest)]
#[case::row_of_another_instrument(e(|r, _| r.cross_sections[0].rows[0].instrument = "XRP".into()), Refused::InvalidRequest)]
#[case::field_outside_the_bar(e(|r, _| r.cross_sections[0].rows[0].field = "TAKER_BUY_VOLUME".into()), Refused::InvalidRequest)]
#[case::original_with_predecessor(e(|r, _| r.cross_sections[0].predecessor_version = Some(d(9))), Refused::InvalidRequest)]
#[case::original_sequence_zero(e(|r, _| r.cross_sections[0].correction_sequence = 0), Refused::InvalidRequest)]
#[case::withdrawal_with_rows(e(|r, _| {
    r.cross_sections[0].kind = CrossSectionVersionKindV1::Withdrawal;
    r.cross_sections[0].correction_sequence = 2;
    r.cross_sections[0].predecessor_version = Some(d(9));
}), Refused::InvalidRequest)]
#[case::empty_route(e(|r, _| r.cross_sections[0].rows[0].retrieval_route.clear()), Refused::InvalidRequest)]
#[case::route_too_long(e(|r, _| r.cross_sections[0].rows[0].retrieval_route = "r".repeat(129)), Refused::InvalidRequest)]
#[case::instant_beyond_storage(e(|r, _| r.window_end_ns_exclusive = u64::MAX), Refused::InvalidRequest)]
#[case::no_binding(e(|_, b| b.binding = None), Refused::SourceBindingUnavailable)]
#[case::binding_not_admitted_under_locator(e(|_, b| b.binding().admitted_under_locator = false), Refused::SourceBindingUnavailable)]
#[case::schema_one_binding(e(|_, b| b.binding().availability_rule = None), Refused::SourceBindingDeclaresNoAvailabilityRule)]
#[case::other_market_semantics(e(|r, _| r.market_semantics_identity = d(31)), Refused::MarketSemanticsMismatch)]
#[case::instrument_under_other_market_semantics(e(|_, b| {
    b.instruments[1].at_start.as_mut().unwrap().market_semantics_identity = d(31);
}), Refused::MarketSemanticsMismatch)]
#[case::open_labelled_execution(e(|r, _| {
    r.execution_timeframe = "4H".into();
    r.input_timeframes = vec!["4H".into()];
    r.fill_timeframe = None;
    r.cross_sections = vec![original("4H", DAY)];
}), Refused::InvalidRequest)]
#[case::session_execution(e(|r, _| {
    r.execution_timeframe = "SESSION".into();
    r.input_timeframes = vec!["SESSION".into()];
    r.fill_timeframe = None;
    r.cross_sections = vec![original("SESSION", DAY)];
}), Refused::ExecutionTimeframeNotFixedInterval)]
#[case::lag_of_one_bar(e(|_, b| {
    b.binding().availability_rule = Some(rule(UntrustedSourceVisibilityV1::AfterBarClose { lag_ns: DAY }, false));
}), Refused::AvailabilityLagNotBelowBarInterval)]
#[case::fill_coarser(e(|r, _| {
    r.fill_timeframe = Some("2D".into());
    r.cross_sections.pop();
}), Refused::FillTimeframeNotFinerThanExecution)]
#[case::fill_as_long(e(|r, _| {
    r.fill_timeframe = Some("24H".into());
    r.cross_sections.pop();
}), Refused::FillTimeframeNotFinerThanExecution)]
#[case::fill_is_input(e(|r, _| {
    r.fill_timeframe = Some("1D".into());
    r.cross_sections.pop();
}), Refused::FillTimeframeIsAnInputTimeframe)]
#[case::fill_is_input_by_identity(e(|r, _| {
    r.input_timeframes.push("1M".into());
    r.fill_timeframe = Some("5M".into());
    r.cross_sections.pop();
}), Refused::FillTimeframeIsAnInputTimeframe)]
#[case::no_fact_at_start(e(|_, b| b.instruments[0].at_start = None), Refused::WindowMemberNotValidThroughout)]
#[case::other_fact_at_end(e(|_, b| b.instruments[0].at_end = Some(d(49))), Refused::WindowMemberNotValidThroughout)]
#[case::fact_ends_inside(e(|_, b| {
    b.instruments[1].at_start.as_mut().unwrap().effective_until = Some(i128::from(3 * DAY) - 1);
}), Refused::WindowMemberNotValidThroughout)]
#[case::mid_window_successor(e(|_, b| {
    b.instruments[0].others.push(CustodyFactSpanV1 {
        effective_from: i128::from(DAY) + 1,
        effective_until: None,
    });
}), Refused::WindowMemberNotValidThroughout)]
#[case::rival_ending_inside(e(|_, b| {
    b.instruments[1].others.push(CustodyFactSpanV1 {
        effective_from: -5,
        effective_until: Some(1),
    });
}), Refused::WindowMemberNotValidThroughout)]
#[case::membership_ends_inside(e(|_, b| b.membership[0].effective_until_ns = Some(i128::from(2 * DAY))), Refused::WindowMemberNotValidThroughout)]
#[case::membership_begins_inside(e(|_, b| b.membership[1].effective_from_ns = 1), Refused::WindowMemberNotValidThroughout)]
#[case::membership_excluded(e(|_, b| b.membership[1].included = false), Refused::WindowMemberNotValidThroughout)]
#[case::no_membership(e(|_, b| { b.membership.pop(); }), Refused::WindowMemberNotValidThroughout)]
#[case::correction_from_a_source_publishing_none(e(|r, _| {
    let version = correction("1D", DAY, d(9), 2, DAY + 2 * SECOND);
    r.cross_sections.insert(1, version);
}), Refused::CrossSectionCorrectionNotPublishedBySource)]
#[case::stated_publication_from_a_source_publishing_none(e(|r, _| {
    r.cross_sections[0].publication_ns = Some(DAY + SECOND);
}), Refused::CrossSectionCorrectionNotPublishedBySource)]
#[case::repeated_original(e(|r, _| {
    let again = r.cross_sections[0].clone();
    r.cross_sections.insert(1, again);
}), Refused::CrossSectionBranch)]
fn every_refusal_is_decided_by_name(#[case] edit: Edit, #[case] refused: Refused) {
    let mut request = request();
    let mut basis = Basis::new(false);
    edit(&mut request, &mut basis);

    assert_eq!(basis.derive(&request).map(|_| ()), Err(refused));
}

/// A root of a correcting source: its original's identity, so a correction can name it.
fn correcting_root() -> (Basis, UntrustedPitWindowCustodyRequestV1, BindingDigest) {
    let basis = Basis::new(true);
    let request = request();
    let original = basis.derive(&request).unwrap().versions[0].identity;
    (basis, request, original)
}

#[rstest]
fn a_correcting_source_corrects_and_withdraws_in_one_root() {
    let (basis, mut request, original) = correcting_root();
    request
        .cross_sections
        .insert(1, correction("1D", DAY, original, 2, DAY + 5 * SECOND));
    let derived = basis.derive(&request).unwrap();
    let corrected = derived.versions[1].identity;
    assert_eq!(
        derived.versions[1].publication,
        CustodyInstantV1::At(DAY + 5 * SECOND)
    );
    assert!(derived.resolve_at_minting_cut(RETRIEVED, None).is_ok());

    request.cross_sections.insert(
        2,
        UntrustedCrossSectionVersionV1 {
            timeframe: "1D".into(),
            event_effective_ns: DAY,
            kind: CrossSectionVersionKindV1::Withdrawal,
            correction_sequence: 3,
            predecessor_version: Some(corrected),
            publication_ns: Some(DAY + 9 * SECOND),
            rows: Vec::new(),
        },
    );
    let withdrawn = basis.derive(&request).unwrap();
    assert_eq!(
        withdrawn.versions[2].kind,
        CrossSectionVersionKindV1::Withdrawal
    );
    assert!(withdrawn.versions[2].rows.is_empty());
}

#[rstest]
fn two_versions_naming_one_predecessor_branch() {
    let (basis, mut request, original) = correcting_root();
    request
        .cross_sections
        .insert(1, correction("1D", DAY, original, 2, DAY + 5 * SECOND));
    let mut other = correction("1D", DAY, original, 2, DAY + 6 * SECOND);
    other.correction_sequence = 3;
    request.cross_sections.insert(2, other);

    assert_eq!(
        basis.derive(&request).map(|_| ()),
        Err(Refused::CrossSectionBranch)
    );
}

#[rstest]
fn a_correction_published_no_later_than_its_predecessor_branches() {
    let (basis, mut request, original) = correcting_root();
    request
        .cross_sections
        .insert(1, correction("1D", DAY, original, 2, DAY + SECOND));
    let derived = basis.derive(&request).unwrap();

    assert_eq!(
        derived.resolve_at_minting_cut(RETRIEVED, None),
        Err(Refused::CrossSectionBranch)
    );
}

#[rstest]
#[case::skipped_sequence(3, Refused::InvalidRequest)]
#[case::unknown_predecessor(0, Refused::InvalidRequest)]
fn a_root_correction_continues_a_version_it_holds(#[case] sequence: u64, #[case] refused: Refused) {
    let (basis, mut request, original) = correcting_root();
    let predecessor = if sequence == 0 { d(77) } else { original };
    request.cross_sections.insert(
        1,
        correction("1D", DAY, predecessor, sequence.max(2), DAY + 5 * SECOND),
    );

    assert_eq!(basis.derive(&request).map(|_| ()), Err(refused));
}

#[rstest]
fn a_row_retrieved_after_the_minting_cut_is_refused() {
    let derived = Basis::new(false).derive(&request()).unwrap();

    assert_eq!(
        derived.resolve_at_minting_cut(RETRIEVED - 1, None),
        Err(Refused::RetrievalAfterMintingCut)
    );
}

/// The chain a root of `request` starts, with its versions as stored at `publication`.
fn chain_of(derived: &DerivedCustodyV1) -> StoredChainV1 {
    let identity = root_identity(derived);
    StoredChainV1 {
        chain_root: identity,
        head_identity: identity,
        head_version: 1,
        head_basis_digest: derived.basis_digest,
        versions: derived
            .versions
            .iter()
            .map(|version| StoredVersionV1 {
                identity: version.identity,
                timeframe_identity: version.timeframe_identity,
                event_ns: version.event_ns,
                kind: version.kind,
                correction_sequence: version.correction_sequence,
                predecessor: version.predecessor,
                publication_ns: DAY + SECOND,
            })
            .collect(),
    }
}

fn successor(
    chain: &StoredChainV1,
    versions: Vec<UntrustedCrossSectionVersionV1>,
) -> UntrustedPitWindowCustodyRequestV1 {
    let mut request = request();
    request.predecessor = Some(UntrustedPitWindowCustodyClaimV1 {
        chain_root: chain.chain_root,
    });
    request.cross_sections = versions;
    request
}

#[rstest]
fn a_successor_appends_a_correction_and_binds_its_chain_position() {
    let (basis, request, original) = correcting_root();
    let chain = chain_of(&basis.derive(&request).unwrap());
    let next = successor(
        &chain,
        vec![correction("1D", DAY, original, 2, DAY + 5 * SECOND)],
    );
    let derived = basis.derive(&next).unwrap();

    assert_eq!(derived.check_against_chain(&chain), Ok(()));
    assert_eq!(
        derived
            .resolve_at_minting_cut(RETRIEVED, Some(&chain))
            .map(|_| ()),
        Ok(())
    );
    let position = ChainPositionV1::successor_of(chain.chain_root, chain.head_identity, 1).unwrap();
    assert_eq!(position.chain_version, 2);
    assert_ne!(derived.identity_at(position).0, root_identity(&derived));

    let late = basis
        .derive(&successor(
            &chain,
            vec![correction("1D", DAY, original, 2, DAY + SECOND)],
        ))
        .unwrap();
    assert_eq!(
        late.resolve_at_minting_cut(RETRIEVED, Some(&chain)),
        Err(Refused::CrossSectionBranch),
        "a correction published before the stored version it corrects branches"
    );
}

#[rstest]
fn a_successor_that_changes_its_basis_is_refused() {
    let (basis, request, original) = correcting_root();
    let chain = chain_of(&basis.derive(&request).unwrap());
    let mut next = successor(
        &chain,
        vec![correction("1D", DAY, original, 2, DAY + 5 * SECOND)],
    );
    next.window_end_ns_exclusive = 4 * DAY;

    assert_eq!(
        basis.derive(&next).unwrap().check_against_chain(&chain),
        Err(Refused::SuccessorBasisChanged)
    );
}

#[rstest]
fn a_successor_branching_a_stored_cross_section_is_refused() {
    let (basis, request, original) = correcting_root();
    let mut chain = chain_of(&basis.derive(&request).unwrap());
    // The chain already corrected the original once.
    chain.versions.push(StoredVersionV1 {
        identity: d(88),
        timeframe_identity: chain.versions[0].timeframe_identity,
        event_ns: DAY,
        kind: CrossSectionVersionKindV1::Correction,
        correction_sequence: 2,
        predecessor: Some(original),
        publication_ns: DAY + 3 * SECOND,
    });
    let branching = successor(
        &chain,
        vec![correction("1D", DAY, original, 2, DAY + 5 * SECOND)],
    );
    assert_eq!(
        basis
            .derive(&branching)
            .unwrap()
            .check_against_chain(&chain),
        Err(Refused::CrossSectionBranch)
    );

    let reoriginal = successor(&chain, vec![original_of(DAY)]);
    assert_eq!(
        basis
            .derive(&reoriginal)
            .unwrap()
            .check_against_chain(&chain),
        Err(Refused::CrossSectionBranch),
        "a second original of a held cross-section branches it"
    );

    let extending = successor(&chain, vec![original_of(2 * DAY + MINUTE)]);
    assert_eq!(
        basis
            .derive(&extending)
            .unwrap()
            .check_against_chain(&chain),
        Err(Refused::InvalidRequest),
        "extending history is a new root"
    );
}

fn original_of(event: u64) -> UntrustedCrossSectionVersionV1 {
    original("1D", event)
}

/// A fact of the member that ended before the window is no rival.
#[rstest]
fn a_fact_ended_before_the_window_is_no_rival() {
    let mut basis = Basis::new(false);
    basis.instruments[0].others.push(CustodyFactSpanV1 {
        effective_from: -5,
        effective_until: Some(0),
    });

    assert!(basis.derive(&request()).is_ok());
}

/// One daily bar, its rows retrieved at `retrieval_ns`.
fn one_bar(retrieval_ns: u64) -> UntrustedPitWindowCustodyRequestV1 {
    let mut request = request();
    let mut bar = original("1D", DAY);
    bar.rows = rows(6_500_000, retrieval_ns);
    request.fill_timeframe = None;
    request.cross_sections = vec![bar];
    request
}

/// A bar retrieved before it closed is today's open bar: no complete-only bar can be it.
#[rstest]
fn a_row_retrieved_before_its_bar_closed_is_refused() {
    let basis = Basis::new(false);
    let open = basis.derive(&one_bar(DAY - 1)).unwrap();
    assert_eq!(
        open.resolve_at_minting_cut(RETRIEVED, None),
        Err(Refused::RowRetrievedBeforeBarClose)
    );

    let closed = basis.derive(&one_bar(DAY)).unwrap();
    assert!(closed.resolve_at_minting_cut(DAY + SECOND, None).is_ok());
}

/// A custody holds only what was visible at its minting cut.
#[rstest]
fn a_version_not_available_at_the_minting_cut_is_refused() {
    let basis = Basis::new(false);
    let derived = basis.derive(&one_bar(DAY)).unwrap();
    assert_eq!(
        derived.resolve_at_minting_cut(DAY + SECOND - 1, None),
        Err(Refused::VersionNotAvailableAtMintingCut),
        "available one second after the close, the bar is not visible at the cut before"
    );

    let (basis, mut request, original) = correcting_root();
    request
        .cross_sections
        .insert(1, correction("1D", DAY, original, 2, RETRIEVED + 1));
    assert_eq!(
        basis
            .derive(&request)
            .unwrap()
            .resolve_at_minting_cut(RETRIEVED, None),
        Err(Refused::VersionNotAvailableAtMintingCut),
        "a publication stated after the cut is not visible at it"
    );
}

/// A stated publication is never before its bar or its availability.
#[rstest]
#[case::before_its_event(DAY - 1)]
#[case::before_its_availability(DAY + SECOND - 1)]
fn a_publication_before_its_bar_or_availability_is_refused(#[case] publication_ns: u64) {
    let (basis, mut request, _) = correcting_root();
    request.cross_sections[0].publication_ns = Some(publication_ns);

    assert_eq!(
        basis.derive(&request).map(|_| ()),
        Err(Refused::InvalidRequest)
    );
}

/// Under a rule set to the retrieval instant, availability is the minting cut: a stated
/// publication before it is refused once the cut is fixed.
#[rstest]
fn a_publication_before_an_availability_at_the_minting_cut_is_refused() {
    let mut basis = Basis::new(true);
    basis.binding().availability_rule = Some(rule(UntrustedSourceVisibilityV1::AtRetrieval, true));
    let mut request = request();
    request.cross_sections[0].publication_ns = Some(RETRIEVED);
    let derived = basis.derive(&request).unwrap();

    assert_eq!(
        derived.resolve_at_minting_cut(RETRIEVED + 1, None),
        Err(Refused::InvalidRequest)
    );
    assert!(derived.resolve_at_minting_cut(RETRIEVED, None).is_ok());
}

/// A custody's window schedules: one per member, on the execution timeframe's own per-member
/// identity, over exactly the custody's window, frames at its daily closes.
#[rstest]
fn a_custody_mints_one_window_schedule_per_member() {
    use crate::owner::pit_window_custody_v1::schedule::{
        frame_instants_v1, mint_window_schedules_v1,
    };

    let derived = Basis::new(false).derive(&request()).unwrap();
    let identity = root_identity(&derived);
    let schedules = mint_window_schedules_v1(&derived, identity, identity, RETRIEVED).unwrap();

    assert_eq!(schedules.len(), 2);

    for (ordinal, schedule) in schedules.iter().enumerate() {
        assert_eq!(usize::from(schedule.member_ordinal), ordinal);
        assert_eq!(schedule.instrument, [BTC, ETH][ordinal]);
        assert_eq!(
            *schedule.timeframe_identity.as_bytes(),
            derived.execution.member_identities[ordinal]
        );
        assert_eq!(schedule.instrument_master_fact_digest, d([40, 41][ordinal]));
        assert_eq!(
            schedule.instrument_master_key,
            derived.instrument_master_key
        );
        assert_eq!((schedule.interval_ns, schedule.phase_ns), (DAY, 0));
        assert_eq!(
            (schedule.window_start_ns, schedule.window_end_ns_exclusive),
            (0, 3 * DAY)
        );
        assert_eq!(schedule.cut_ns, RETRIEVED);
        assert_eq!(
            frame_instants_v1(schedule, 0, 3 * DAY).collect::<Vec<_>>(),
            [0, DAY, 2 * DAY]
        );
    }
    assert_ne!(schedules[0].identity(), schedules[1].identity());
}

/// `request()` with its first daily bar's BTC CLOSE stated as `mantissa * 10^-scale`.
fn close_stated_as(mantissa: i128, scale: u8) -> UntrustedPitWindowCustodyRequestV1 {
    let mut request = request();
    let close = &mut request.cross_sections[0].rows[3];
    assert_eq!(
        (close.instrument.as_str(), close.field.as_str()),
        (BTC, "CLOSE")
    );
    close.value_mantissa = mantissa;
    close.value_scale = scale;
    request
}

/// 45000.1 and 45000.12 on two bars of one series are stated at the price increment's scale, so
/// the CLOSE series of the member is one series, whatever scale each value was written at.
#[rstest]
fn values_written_at_different_scales_land_in_one_series() {
    use crate::owner::sample_fact::v2::{
        SampleHeadsV2, prepare_sample_fact_v2, series_identity_v2,
    };

    let mut request = request();
    let close_of = |version: usize| {
        request.cross_sections[version]
            .rows
            .iter()
            .position(|row| row.instrument == BTC && row.field == "CLOSE")
            .unwrap()
    };
    let (first, second) = (close_of(0), close_of(1));
    request.cross_sections[0].rows[first].value_mantissa = 450_001;
    request.cross_sections[0].rows[first].value_scale = 1;
    request.cross_sections[1].rows[second].value_mantissa = 4_500_012;
    request.cross_sections[1].rows[second].value_scale = 2;
    let derived = Basis::new(false).derive(&request).unwrap();
    let resolved = derived.resolve_at_minting_cut(RETRIEVED, None).unwrap();
    let series = (0..2)
        .map(|version| {
            let inputs = derived.row_inputs(&derived.versions[version], resolved[version]);
            let close = &inputs[3];
            assert_eq!(close.field_semantic, b"MARKET_DATA.BAR.CLOSE.PRICE.V1");
            assert_eq!(close.value_scale, 2);
            (close.value_mantissa, series_identity_v2(close).unwrap())
        })
        .collect::<Vec<_>>();

    assert_eq!(series[0].0, 4_500_010);
    assert_eq!(series[1].0, 4_500_012);
    assert_eq!(
        series[0].1, series[1].1,
        "one instrument and field is one series"
    );

    // The second bar's row fact chains onto the first's: 45000.10 (written canonically, at one
    // place) and 45000.12 are adjacent bars of one series.
    let inputs = (0..2)
        .map(|version| derived.row_inputs(&derived.versions[version], resolved[version])[3].clone())
        .collect::<Vec<_>>();
    let first_fact = prepare_sample_fact_v2(&inputs[0], SampleHeadsV2::default()).unwrap();
    let second_fact = prepare_sample_fact_v2(
        &inputs[1],
        SampleHeadsV2 {
            series: Some(&first_fact),
            slot: None,
        },
    )
    .expect("the second bar extends the first bar's series");
    assert_eq!(
        second_fact.series_predecessor(),
        first_fact.sample_identity()
    );
    assert_eq!(second_fact.series_sequence(), 2);
    assert_eq!(
        derived.versions[0].rows[4].value_scale, 3,
        "VOLUME takes the quantity increment's scale"
    );
}

/// One value has one representation: "45000.10" written at scale 2 and "45000.1" at scale 1 are
/// the same custody.
#[rstest]
fn a_value_written_at_another_scale_keeps_the_custody_identity() {
    let basis = Basis::new(false);
    let two_places = basis.derive(&close_stated_as(4_500_010, 2)).unwrap();
    let one_place = basis.derive(&close_stated_as(450_001, 1)).unwrap();

    assert_eq!(root_identity(&two_places), root_identity(&one_place));
}

#[rstest]
#[case::finer_than_the_price_increment(45_000_123, 3, Refused::ValueFinerThanInstrumentPrecision)]
#[case::beyond_the_mantissa(i128::MAX, 0, Refused::InvalidRequest)]
fn a_value_the_increment_cannot_state_exactly_is_refused(
    #[case] mantissa: i128,
    #[case] scale: u8,
    #[case] refused: Refused,
) {
    assert_eq!(
        Basis::new(false)
            .derive(&close_stated_as(mantissa, scale))
            .map(|_| ()),
        Err(refused)
    );
}
