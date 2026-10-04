//! The custody view and quote cut seals, over a custody derived and selected as the Owner does.

use std::collections::BTreeMap;

use rstest::rstest;

use super::*;
use crate::owner::{
    decimal_rescale_v1::MARKET_DATA_VALUE_SCALE_V1,
    instrument_master::InstrumentClass,
    market_semantics_admission_v1::MarketSemanticsValueSubmissionV1,
    pit_window_custody_v1::{
        CrossSectionVersionKindV1, UntrustedCrossSectionVersionV1, UntrustedCustodyRowV1,
        UntrustedPitWindowCustodyRequestV1,
        authority::{
            ChainPositionV1, CustodyBindingV1, CustodyInputsV1, CustodyInstrumentV1,
            CustodyMemberFactV1, CustodyMembershipV1, CustodyUniverseLineageV1, DerivedCustodyV1,
            decode_custody_record_v1, derive_custody_v1,
        },
        view::{ChainVersionV1, ViewTimeframesV1, cross_sections_v1, select_view_v1},
    },
    sample_fact::v2::{SampleHeadsV2, prepare_sample_fact_v2, series_identity_v2},
    source_binding::{
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedMarketDataAsOf,
        UntrustedSourceAvailabilityRuleV1, UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1,
        UntrustedSourceBarClockV1, UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1,
        UntrustedSourceBarTimeframeV1, UntrustedSourceBarUnitV1, UntrustedSourceBindingLocator,
        UntrustedSourceBindingLocatorFields, UntrustedSourceVisibilityV1,
    },
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400 * SECOND;
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

fn daily(label: &str) -> UntrustedSourceBarTimeframeV1 {
    UntrustedSourceBarTimeframeV1 {
        row_timeframe: label.to_owned(),
        cadence: UntrustedSourceBarCadenceV1::FixedInterval {
            step: 24,
            unit: UntrustedSourceBarUnitV1::Hour,
        },
        anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
        clock: UntrustedSourceBarClockV1::Continuous,
        label: UntrustedSourceBarLabelV1::IntervalClose,
        completion: UntrustedSourceBarCompletionV1::CompleteOnly,
    }
}

fn binding(label: &str) -> CustodyBindingV1 {
    CustodyBindingV1 {
        admitted_under_locator: true,
        binding_id: d(1),
        fact_digest: d(3),
        lineage_root: d(2),
        lineage_version: 1,
        availability_rule: Some(UntrustedSourceAvailabilityRuleV1 {
            visibility: UntrustedSourceVisibilityV1::AfterBarClose { lag_ns: SECOND },
            publishes_corrections: false,
        }),
        bar_timeframes: vec![daily(label)],
        market_semantics_identity: d(30),
        source_frontier_digest: d(24),
        correction_stream: "test/stream".to_owned(),
        correction_frontier_digest: d(25),
        source_frontier: frontier(24),
        correction_frontier: frontier(25),
    }
}

fn frontier(byte: u8) -> UntrustedCompleteFrontier {
    UntrustedCompleteFrontier {
        stream_identity: "test/stream".to_owned(),
        cut_identity: "test/stream/cut-1".to_owned(),
        sequence: 1,
        digest: d(byte),
    }
}

fn market_semantics_value() -> MarketSemanticsValueSubmissionV1 {
    MarketSemanticsValueSubmissionV1 {
        normalization_identity: d(31),
        price_adjustment: "RAW".to_owned(),
        timestamp_basis: "INTERVAL_CLOSE".to_owned(),
        price_unit_identity: d(32),
        size_unit_identity: d(33),
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

/// One original bar per member from `base`, each member's volume `volume` when one is stated.
fn bar(
    label: &str,
    members: &[&str],
    event: u64,
    base: i128,
    volume: Option<i128>,
) -> UntrustedCrossSectionVersionV1 {
    UntrustedCrossSectionVersionV1 {
        timeframe: label.to_owned(),
        event_effective_ns: event,
        kind: CrossSectionVersionKindV1::Original,
        correction_sequence: 1,
        predecessor_version: None,
        publication_ns: None,
        rows: members
            .iter()
            .zip(0..)
            .flat_map(|(member, offset)| {
                // The low lowest and the high highest: a bar the custody intake admits.
                [
                    ("OPEN", 0),
                    ("HIGH", 5),
                    ("LOW", -1),
                    ("CLOSE", 3),
                    ("VOLUME", 4),
                ]
                .into_iter()
                .map(move |(field, position)| UntrustedCustodyRowV1 {
                    instrument: (*member).to_owned(),
                    field: field.to_owned(),
                    value_mantissa: match volume {
                        Some(volume) if field == "VOLUME" => volume,
                        _ => base + 1_000 * offset + position,
                    },
                    value_scale: 2,
                    retrieval_ns: RETRIEVED,
                    retrieval_route: "data.binance.vision/daily-klines".to_owned(),
                })
            })
            .collect(),
    }
}

/// A custody of `members` over four days of daily bars held under `label`, derived, recorded and
/// stored as the Owner commits one, with the view of its second frame selected.
struct Fixture {
    record: CustodyRecordV1,
    selection: ViewSelectionV1,
    rows: Vec<StoredViewRowV1>,
    /// Every row of every version, by version.
    all_rows: BTreeMap<BindingDigest, Vec<StoredViewRowV1>>,
    derived: DerivedCustodyV1,
}

fn clock() -> CustodyMintingClockV1 {
    CustodyMintingClockV1 {
        identity: "market-data.owner-clock.v1-00001".to_owned(),
        epoch: "market-data.owner-epoch.v1-00001".to_owned(),
        sequence: 4,
        restart_continuity_digest: d(70),
        uncertainty_bound: 1_000_000,
        skew_bound: 1_000_000,
    }
}

fn fixture_of(members: &[&str], label: &str) -> Fixture {
    fixture_based(members, label, 6_500_000, None)
}

/// [`fixture_of`] with day `n`'s first value `base + n`, and every volume `volume` when one is
/// stated.
fn fixture_based(members: &[&str], label: &str, base: i128, volume: Option<i128>) -> Fixture {
    let request = UntrustedPitWindowCustodyRequestV1 {
        source_binding: locator(),
        market_semantics_identity: d(30),
        market_semantics_value: market_semantics_value(),
        universe_selection: UntrustedUniverseSelectionLocatorV1::from_untrusted(d(50), d(51)),
        members: members.iter().map(|member| (*member).to_owned()).collect(),
        window_start_ns: 0,
        window_end_ns_exclusive: 4 * DAY,
        execution_timeframe: label.to_owned(),
        input_timeframes: vec![label.to_owned()],
        fill_timeframe: None,
        predecessor: None,
        cross_sections: (1..=3)
            .map(|day| bar(label, members, day * DAY, base + i128::from(day), volume))
            .collect(),
    };
    let binding = binding(label);
    let instruments = [instrument(40), instrument(41)][..members.len()].to_vec();
    let membership = members
        .iter()
        .map(|member| membership(member))
        .collect::<Vec<_>>();
    let derived = derive_custody_v1(CustodyInputsV1 {
        request: &request,
        binding: Some(&binding),
        instruments: &instruments,
        membership: &membership,
        universe_lineage: CustodyUniverseLineageV1 {
            source_binding_lineage_root: binding.lineage_root,
            correction_frontier_digest: binding.correction_frontier_digest,
        },
    })
    .expect("the custody derives");
    let (identity, bytes) = derived.identity_at(ChainPositionV1::ROOT);
    let record = decode_custody_record_v1(&bytes, identity).expect("the record decodes");
    let resolved = derived
        .resolve_at_minting_cut(RETRIEVED, None)
        .expect("visible at the cut");
    let mut series = BTreeMap::new();
    let mut versions = Vec::new();
    let mut all_rows = BTreeMap::new();

    for (version, instants) in derived.versions.iter().zip(&resolved) {
        let mut stored = Vec::new();

        for (row, input) in version
            .rows
            .iter()
            .zip(derived.row_inputs(version, *instants))
        {
            let key = series_identity_v2(&input).unwrap();
            let fact = prepare_sample_fact_v2(
                &input,
                SampleHeadsV2 {
                    series: series.get(&key),
                    slot: None,
                },
            )
            .unwrap();
            series.insert(key, fact.clone());
            stored.push(StoredViewRowV1 {
                version_identity: version.identity,
                member_ordinal: row.member_ordinal,
                field: row.semantic.row_field().to_owned(),
                fact,
            });
        }
        all_rows.insert(version.identity, stored);
        versions.push(ChainVersionV1 {
            identity: version.identity,
            custody_identity: identity,
            chain_version: 1,
            timeframe_identity: version.timeframe_identity,
            event_ns: version.event_ns,
            kind: version.kind,
            correction_sequence: version.correction_sequence,
            predecessor: version.predecessor,
            availability_ns: instants.0,
            publication_ns: instants.1,
        });
    }
    let selection = select_view_v1(
        &cross_sections_v1(&versions).unwrap(),
        &ViewTimeframesV1 {
            execution: record.execution.identity,
            inputs: record.inputs.iter().map(|input| input.identity).collect(),
            interval_ns: DAY,
        },
        2 * DAY,
    )
    .expect("the second frame is covered");
    let rows = all_rows[&selection.selected[0].identity].clone();
    Fixture {
        record,
        selection,
        rows,
        all_rows,
        derived,
    }
}

fn fixture() -> Fixture {
    fixture_of(&[BTC, ETH], "1D")
}

impl Fixture {
    fn seal(&self) -> Result<VerifiedPitObservationBatch, SealError> {
        verify_custody_view_batch_v1(CustodyViewInputsV1 {
            chain_root: self.record.identity,
            record: &self.record,
            clock: &clock(),
            selection: &self.selection,
            rows: &self.rows,
        })
    }

    /// The row fact `self.rows[index]` would be with its row input edited.
    fn reprepared(&self, index: usize, edit: impl FnOnce(&mut SampleRowInputV2)) -> SampleFactV2 {
        let mut input = self.rows[index].fact.row().clone();
        edit(&mut input);
        prepare_sample_fact_v2(&input, SampleHeadsV2::default()).unwrap()
    }
}

use crate::owner::sample_fact::v2::SampleRowInputV2;

#[rstest]
fn a_custody_view_seals_its_rows_as_a_verified_batch() {
    let fixture = fixture();
    let batch = fixture.seal().expect("the view seals");
    let chain_root = fixture.record.identity;
    let view_identity = view_identity_v1(fixture.record.rule_digest, &fixture.selection);

    let PitObservationBatchSourceV1::CustodyView {
        chain_root: named_root,
        view_identity: named_view,
        event_ns,
        decision_cut_ns,
        ..
    } = batch.source()
    else {
        panic!("a custody view batch names a custody view");
    };
    assert_eq!(
        (named_root, named_view, event_ns, decision_cut_ns),
        (chain_root, view_identity, 2 * DAY, 2 * DAY + SECOND)
    );
    assert_eq!(batch.committed_snapshot(), None);
    assert_eq!(batch.request_identity(), view_identity);
    assert_eq!(
        (batch.correlation_identity(), batch.scope_digest()),
        (chain_root, chain_root)
    );
    assert_eq!(
        batch.instrument_master_digest(),
        fixture.derived.instrument_master_key
    );
    assert_eq!(batch.universe_selection_digest(), d(50));
    assert_eq!(batch.observations().len(), 10);
    assert!(
        batch
            .observations()
            .windows(2)
            .all(|pair| (&pair[0].symbolic_key, &pair[0].member_key)
                < (&pair[1].symbolic_key, &pair[1].member_key)),
        "observations in canonical order"
    );
    let close = batch
        .select(&format!("{ETH}.CLOSE.1D"), ETH)
        .expect("the selected bar's close");
    assert_eq!(
        (close.value_mantissa(), close.value_scale()),
        (6_500_002 + 1_000 + 3, 2)
    );
    assert_eq!(
        (close.channel(), close.data_kind(), close.timeframe()),
        ("MARKET", "BAR", "1D")
    );
    assert_eq!(
        (
            close.event_effective(),
            close.provider_available(),
            close.correction_publication(),
            close.retrieval()
        ),
        (
            2 * DAY,
            2 * DAY + SECOND,
            2 * DAY + SECOND,
            2 * DAY + SECOND
        ),
        "the row's retrieval is d_k: true retrieval stays custody evidence"
    );
    let time = batch.time_evidence();
    assert_eq!(time.event_effective.value, 2 * DAY);
    assert_eq!(time.decision_cut.value, 2 * DAY + SECOND);
    assert_eq!(time.valid_through, 3 * DAY);
    assert_eq!(time.decision_cut.clock_identity, clock().identity);
    assert_eq!(time.monotonic_sequence, clock().sequence);
}

/// Rows read from the wrong place, or edited, are refused by the check that names them.
#[rstest]
#[case::a_row_missing(|f: &mut Fixture| { f.rows.pop(); }, SealError::RowCensus)]
#[case::a_row_twice(|f: &mut Fixture| { let again = f.rows[0].clone(); f.rows[9] = again; }, SealError::RowCensus)]
#[case::a_row_of_another_version(|f: &mut Fixture| {
    let other = f.all_rows.values().find(|rows| rows[0].version_identity != f.rows[0].version_identity).unwrap()[0].fact.clone();
    f.rows[0].fact = other;
}, SealError::RowMismatch)]
#[case::another_availability(|f: &mut Fixture| f.rows[3].fact = f.reprepared(3, |row| row.available += 1), SealError::RowMismatch)]
#[case::another_publication(|f: &mut Fixture| f.rows[3].fact = f.reprepared(3, |row| row.publication += 1), SealError::RowMismatch)]
#[case::another_member(|f: &mut Fixture| f.rows[3].fact = f.reprepared(3, |row| row.instrument = ETH.as_bytes().to_vec()), SealError::RowMismatch)]
#[case::another_field(|f: &mut Fixture| f.rows[3].field = "OPEN".to_owned(), SealError::RowCensus)]
#[case::a_value_its_row_digest_does_not_bind(|f: &mut Fixture| f.rows[3].fact = f.reprepared(3, |row| row.value_mantissa += 1), SealError::RowMismatch)]
#[case::another_member_timeframe(|f: &mut Fixture| f.rows[3].fact = f.reprepared(3, |row| row.timeframe_identity = [9; 32]), SealError::RowMismatch)]
#[case::another_instrument_master(|f: &mut Fixture| f.record.instrument_master_key = d(99), SealError::RowMismatch)]
#[case::another_market_semantics(|f: &mut Fixture| f.record.market_semantics_identity = d(99), SealError::RowMismatch)]
#[case::another_binding(|f: &mut Fixture| f.record.binding_id = d(99), SealError::NonUniform)]
#[case::a_row_under_another_frontier(|f: &mut Fixture| f.rows[3].fact = f.reprepared(3, |row| row.source_frontier_digest = d(99)), SealError::NonUniform)]
#[case::a_label_the_encoding_refuses(|f: &mut Fixture| {
    for input in &mut f.record.inputs { input.label = "1d".to_owned(); }
}, SealError::Encoding)]
fn a_tampered_view_is_refused_by_name(#[case] edit: fn(&mut Fixture), #[case] refused: SealError) {
    let mut fixture = fixture();
    edit(&mut fixture);
    assert_eq!(fixture.seal().map(|_| ()), Err(refused));
}

/// The member timeframes a view's rows state must hash to the custody's timeframe: a selected
/// version under another timeframe identity is refused even when its label resolves.
#[rstest]
fn the_member_timeframes_must_hash_to_the_custody_timeframe() {
    let mut fixture = fixture();
    let other = d(98);
    fixture.selection.selected[0].timeframe_identity = other;

    for input in &mut fixture.record.inputs {
        input.identity = other;
    }
    assert_eq!(fixture.seal().map(|_| ()), Err(SealError::RowMismatch));
}

fn quote_rows(members: &[&str]) -> Vec<CustodyQuoteRowV1> {
    members
        .iter()
        .flat_map(|member| {
            QUOTE_FIELDS
                .into_iter()
                .zip(0..)
                .map(|(field, offset)| CustodyQuoteRowV1 {
                    instrument: (*member).to_owned(),
                    field,
                    value_mantissa: 6_500_101 + 2 * offset,
                    value_scale: 2,
                })
        })
        .collect()
}

fn quote_cut(instant_ns: u64, rows: &[CustodyQuoteRowV1]) -> CustodyQuoteCutInputsV1<'_> {
    CustodyQuoteCutInputsV1 {
        quote_cut_identity: d(80),
        instant_ns,
        available_ns: instant_ns,
        publication_ns: instant_ns,
        bound_ns_exclusive: 3 * DAY,
        derivation: QuoteDerivationV1::FillBarOpen {
            fill_timeframe_identity: d(81),
        },
        rows,
    }
}

#[rstest]
fn a_custody_quote_cut_seals_one_quote_per_member_inside_its_gap() {
    let view = fixture().seal().unwrap();
    let rows = quote_rows(&[BTC, ETH]);
    let sealed = verify_custody_quote_cut_batch_v1(&view, quote_cut(2 * DAY + 2 * SECOND, &rows))
        .expect("the quote cut seals");

    assert!(matches!(
        sealed.source(),
        PitObservationBatchSourceV1::CustodyQuoteCut {
            instant_ns,
            quote_cut_identity,
            ..
        } if instant_ns == 2 * DAY + 2 * SECOND && quote_cut_identity == d(80)
    ));
    assert_eq!(sealed.binding_request_source_v1(), None);
    assert_eq!(sealed.observations().len(), 8);
    assert!(
        sealed
            .observations()
            .iter()
            .all(|row| row.data_kind() == "QUOTE" && row.timeframe() == "TICK")
    );
    assert!(
        sealed
            .select(&format!("{BTC}.ASK_PRICE.TICK"), BTC)
            .is_some()
    );
}

#[rstest]
#[case::at_d_k(2 * DAY + SECOND, SealError::QuoteCutOutsideGap)]
#[case::at_the_bound(3 * DAY, SealError::QuoteCutOutsideGap)]
fn a_quote_cut_outside_its_gap_is_refused(#[case] instant_ns: u64, #[case] refused: SealError) {
    let view = fixture().seal().unwrap();
    let rows = quote_rows(&[BTC, ETH]);
    assert_eq!(
        verify_custody_quote_cut_batch_v1(&view, quote_cut(instant_ns, &rows)).map(|_| ()),
        Err(refused)
    );
}

#[rstest]
fn a_quote_cut_follows_only_a_custody_view_with_every_member_quoted_in_order() {
    let view = fixture().seal().unwrap();
    let instant = 2 * DAY + 2 * SECOND;
    let rows = quote_rows(&[BTC, ETH]);
    let quote = verify_custody_quote_cut_batch_v1(&view, quote_cut(instant, &rows)).unwrap();
    assert_eq!(
        verify_custody_quote_cut_batch_v1(&quote, quote_cut(instant, &rows)).map(|_| ()),
        Err(SealError::NotAView),
        "a quote cut in the view's position"
    );

    let one_member = quote_rows(&[BTC]);
    assert_eq!(
        verify_custody_quote_cut_batch_v1(&view, quote_cut(instant, &one_member)).map(|_| ()),
        Err(SealError::RowCensus)
    );
    let swapped = quote_rows(&[ETH, BTC]);
    assert_eq!(
        verify_custody_quote_cut_batch_v1(&view, quote_cut(instant, &swapped)).map(|_| ()),
        Err(SealError::RowCensus)
    );
}

/// One member seals too: the N=1 frame.
#[rstest]
fn a_one_member_view_seals() {
    let fixture = fixture_of(&[BTC], "1D");
    assert_eq!(fixture.seal().unwrap().observations().len(), 5);
}

/// A custody stores each value at the fixed value scale; the view states it canonically, with no
/// trailing fractional zero, exactly as the canonical batch encoding admits.
#[rstest]
#[case::a_price(37_244_360_000_000, 9, (3_724_436, 2))]
#[case::zero(0, 9, (0, 0))]
#[case::an_integer(150_000_000_000, 9, (150, 0))]
#[case::negative(-1_500_000_000, 9, (-15, 1))]
#[case::already_canonical(6_501_005, 2, (6_501_005, 2))]
#[case::scale_zero_keeps_its_zeros(100, 0, (100, 0))]
fn a_custody_value_projects_to_its_canonical_decimal(
    #[case] mantissa: i128,
    #[case] scale: u8,
    #[case] canonical: (i128, u8),
) {
    assert_eq!(canonical_decimal_v1(mantissa, scale), canonical);
}

/// The stored row keeps scale 9; the view reads it back canonical and seals it, zero included.
#[rstest]
fn a_scale_9_custody_row_reads_back_canonical_in_the_view() {
    let fixture = fixture();
    let stored = fixture
        .rows
        .iter()
        .map(|row| row.fact.row())
        .find(|row| {
            row.instrument == ETH.as_bytes()
                && row.field_semantic
                    == MarketDataFieldSemantic::BarClosePrice.identity().as_bytes()
        })
        .expect("the ETH close row");
    assert_eq!(
        (stored.value_mantissa, stored.value_scale),
        (6_501_005 * 10_i128.pow(7), MARKET_DATA_VALUE_SCALE_V1)
    );
    let batch = fixture.seal().expect("the view seals scale-9 rows");
    let close = batch.select(&format!("{ETH}.CLOSE.1D"), ETH).unwrap();
    assert_eq!(
        (close.value_mantissa(), close.value_scale()),
        (6_501_005, 2)
    );

    // Every volume is zero: stored as 0 at scale 9, read back as 0 at scale 0. A volume is the
    // value that can be zero; a crypto perpetual's prices are positive (T0-8).
    let zero = fixture_based(&[BTC, ETH], "1D", 6_500_000, Some(0));
    let batch = zero.seal().expect("a zero value seals");
    let volume = batch.select(&format!("{BTC}.VOLUME.1D"), BTC).unwrap();
    assert_eq!((volume.value_mantissa(), volume.value_scale()), (0, 0));
    assert!(
        batch
            .observations()
            .iter()
            .all(|row| row.value_scale() == 0 || row.value_mantissa() % 10 != 0),
        "every view value is canonical"
    );
}
