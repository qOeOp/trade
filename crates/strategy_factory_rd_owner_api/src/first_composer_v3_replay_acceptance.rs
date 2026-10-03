//! The first COMPOSER_V3 Replay the ordered chain commits, as one handle both F entries read.
//!
//! The prefix entry commits it through the production routes and asserts that it was created. The
//! body entry calls [`ensure_first_composer_v3_replay_acceptance_v1`] again with the same key and
//! gets the same Replay back, so it reads the Replay the prefix committed rather than making a
//! second one. The same key with other content is refused by name, as in
//! `vibe_product_edge::deployment_acceptance`.
//!
//! The Design behind it is an R&D-authored universe Bounded Feature Program Design: one member,
//! with coordinate rows, registered through the production chain (the initial PIT request, the
//! universe declaration, custody, the Composer run). An oracle-built Design would make this fixture
//! prove itself, so none is used. Its author is `author_single_threshold_program_v1`, the proposer
//! `docs/owners/rd.md` admits, in its universe-member form.
//!
//! Each step is a production route or Owner function, with two departures, both stated where they
//! happen:
//!
//! - The Data Client behind Market Data's PIT intake is a stand-in that answers for exactly the
//!   members Market Data issues, as in the initial PIT entry: a daily BAR for the frame, and a
//!   Quote for the frame's quote cut. The terminal is still Market Data's own derivation.
//! - The Composer runs through the library, not `POST /v2/develop-composer/runs`. That route runs
//!   the frozen program only in the default build, and the sealed build this chain runs - the only
//!   one carrying the COMPOSER_V3 commit route - routes it to the fixed corpus instead. It is a
//!   build mismatch, not a production path: a deployment has to carry both halves before a
//!   Composer artifact it produces can reach a COMPOSER_V3 commit.

use std::sync::Arc;

use async_trait::async_trait;
use axum::{body::Body, extract::Request};
use tower::ServiceExt;
use vibe_data::owner::{
    bar_schedule::{
        BarScheduleClockV1, BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1,
        BarScheduleUnitV1,
    },
    declared_bar_timeframe_v1::{DeclaredBarAnchorV1, anchor_identity_v1},
    instrument_master_admission_v1::{
        InstrumentDecimalSubmissionV1, InstrumentMasterFactSubmissionV1,
        InstrumentVenueSourceMappingSubmissionV1,
    },
    instrument_master_v2::{InstrumentMasterCutLocatorV2, InstrumentMasterResolverV2},
    market_semantics_admission_v1::{
        MarketSemanticsFactSubmissionV1, MarketSemanticsValueSubmissionV1,
    },
    native_replay_scheduling_v1::native_bar_type_for_schedule_v1,
    pit_market_snapshot_intake_v1::{
        MarketDataDecisionCutV1, PitMarketSnapshotIntakeV1,
        pit_market_snapshot_intake_from_environment_v1,
    },
    pit_observation_source_v1::{
        PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1,
        VendorObservationV1,
    },
    pit_snapshot::{PitSnapshotSubmissionV1, UntrustedPitSnapshotTimeEvidence},
    replay_market_facts_v2::ReplayCompositionBindingLocatorV1,
    research_instrument_scope_v1::ResearchInstrumentScopeWireV1,
    source_binding::{
        BindingDigest, UntrustedAdapterBinding, UntrustedCompleteFrontier,
        UntrustedCredentialAudienceClaim, UntrustedCredentialCapabilityClaim,
        UntrustedLicensePolicy, UntrustedMarketDataAsOf, UntrustedMarketSemantics,
        UntrustedOpaqueCredentialHandle, UntrustedSourceAvailabilityRuleV1,
        UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1,
        UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1, UntrustedSourceBarTimeframeV1,
        UntrustedSourceBarUnitV1, UntrustedSourceBindingLocator, UntrustedSourceBindingProposal,
        UntrustedSourceVisibilityV1, UntrustedTrustPolicy, seal_binding_claim_v1,
    },
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1,
        SourceBindingAdmissionDispositionV1, SourceBindingAdmissionRequestV1,
        SourceBindingAdmissionTerminalV1,
    },
    universe_selection::UntrustedUniverseSelectionLocatorV1,
    universe_selection_admission_v1::{
        HistoricalMembershipAdmissionRequestV1, HistoricalMembershipSubmissionV1,
        universe_selection_admission_from_environment_v1,
    },
};
use vibe_postgres_connect::PgPoolOptionsExt as _;
use vibe_product_edge::{
    ProductEdgeAdmissionRequestV1,
    deployment_acceptance::{
        DeploymentAcceptanceOperationV1, DeploymentAcceptanceProposalV1,
        ProductEdgeDeploymentAcceptanceFixtureV1,
        ensure_product_edge_deployment_acceptance_fixture_v1,
    },
};
use vibe_strategy_factory::{
    bounded_feature_program_v1::BoundedFeaturePredicateV1,
    exploratory_replay::{
        EXPLORATORY_REPLAY_MUTATION_EFFECT_V3, EXPLORATORY_REPLAY_OPERATION_V3,
        EXPLORATORY_REPLAY_SCHEMA_V3, ExploratoryReplayRequestLocatorV2,
    },
    product_edge::{
        ProductEdgeResolution, RESEARCH_GOAL_OPERATION_V3, RESEARCH_GOAL_SCHEMA_V3,
        ResearchGoalOwnerResultV2, ResearchSourceV1,
    },
    product_edge_postgres::research_initial_pit::MarketDataInitialPitPortsV1,
    rd_bounded_feature_program_postgres_v1::PostgresResearchBoundedFeatureProgramOwnerV1,
    single_threshold_authoring_v1::{
        SingleThresholdAuthoringRequestV1, SingleThresholdChannelV1, SingleThresholdOutcomeV1,
        author_single_threshold_program_v1,
    },
    source_research_composer_postgres_v2::PostgresSourceResearchComposerProductionV2,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use super::*;

/// The one key both F entries use, so the body joins exactly what the prefix committed.
pub(crate) const FIRST_COMPOSER_V3_REPLAY_FIXTURE_KEY_V1: &str = "f-first-composer-v3";

const TOKEN: &str = "rd-owner-api-first-composer-v3";
const CLOSE_ROLE: &str = "research.input.close.daily.v1";

const OPEN_ROLE: &str = "research.input.open.daily.v1";

/// One crypto perpetual this harness runs a COMPOSER_V3 Replay for: what Operations admits for it,
/// and what the stand-in data clients answer for it.
///
/// Only the Operations setup reads it - the Source Binding, Instrument Master facts, economic terms
/// and membership a deployment admits for an instrument before anyone researches it - and the
/// stand-ins for the data clients behind Market Data's intakes. The product path, from the Research
/// request on, learns the instrument only from the Research request's scope. That is the strategy
/// shape envelope's P0 completion criterion for an instrument change: the Research request's scope
/// is the only product input that differs between two instruments; the Design is the same.
#[derive(Clone, Copy, Debug)]
pub(crate) struct PerpetualFixtureV1 {
    /// The canonical instrument identity the Research request's scope names.
    pub(crate) canonical: &'static str,
    raw_symbol: &'static str,
    base: &'static str,
    /// The perpetual's real USD-M `exchangeInfo` entry, which its Instrument Master facts are read
    /// from, sliced byte for byte from one public response and wrapped in a minimal envelope.
    exchange_info: &'static str,
    exchange_info_retrieved_ns: i128,
    /// Names the registry meanings Operations admits for this perpetual, so two perpetuals in one
    /// deployment never share an eligible frontier or an Instrument Master frontier.
    meaning_namespace: &'static str,
    /// The daily kline the PIT stand-in answers: open, high, low and close as canonical decimal
    /// `(mantissa, scale)` on the perpetual's tick grid, then volume.
    bar: [(i128, u8); 5],
    /// The Quote the quote-cut stand-in answers: bid and ask, one tick apart and the ask one tick
    /// under the close, so the Host's limit at the close crosses it.
    quote: [(i128, u8); 2],
}

/// LINKUSDT: F's instrument, one no other chain entry names, so no other entry's Instrument Master
/// or membership facts can meet it.
///
/// Its `exchangeInfo` entry was fetched once from `https://fapi.binance.com/fapi/v1/exchangeInfo`
/// (public, no credential) at 2026-09-27T09:17:36Z; the whole response was 1,127,625 bytes with
/// sha256 `427d91c56afdfb79867659e455e1e9fd0128445f658c6533a54605a9f6f36db9` and a cached
/// `serverTime` of 1790456106252 ms. The file's digest proves only that these bytes were submitted,
/// not that they are the provider's whole response.
pub(crate) const LINKUSDT_PERPETUAL_V1: PerpetualFixtureV1 = PerpetualFixtureV1 {
    canonical: "LINKUSDT-PERP.BINANCE",
    raw_symbol: "LINKUSDT",
    base: "LINK",
    exchange_info: include_str!(
        "../../adapters/binance/test_data/futures/http_json/exchange_info_usdm_linkusdt.json"
    ),
    exchange_info_retrieved_ns: 1_790_500_656_000_000_000,
    meaning_namespace: "perpetual",
    bar: [
        (12_301, 2),
        (12_399, 2),
        (12_287, 2),
        (12_345, 2),
        (98_765, 0),
    ],
    quote: [(12_343, 2), (12_344, 2)],
};

/// BTCUSDT: the instrument U1 researches first, on a 0.10 tick, with a 556.80 price floor and a
/// 50 USDT minimum notional.
///
/// Its `exchangeInfo` entry was fetched once from `https://fapi.binance.com/fapi/v1/exchangeInfo`
/// (public, no credential) at 2026-10-03T05:31:14Z; the whole response was 1,142,974 bytes with
/// sha256 `4d13b0b196c7f478904e680e358e66ed75a43e9f4d39b7fcf8aea0c90834f6f0` and a `serverTime` of
/// 1790941589242 ms. Its prices are on its own tick grid, so each is canonical at scale 1.
pub(crate) const BTCUSDT_PERPETUAL_V1: PerpetualFixtureV1 = PerpetualFixtureV1 {
    canonical: "BTCUSDT-PERP.BINANCE",
    raw_symbol: "BTCUSDT",
    base: "BTC",
    exchange_info: include_str!(
        "../../adapters/binance/test_data/futures/http_json/exchange_info_usdm_btcusdt.json"
    ),
    exchange_info_retrieved_ns: 1_791_005_474_000_000_000,
    meaning_namespace: "btcusdt-perpetual",
    bar: [
        (654_003, 1),
        (654_997, 1),
        (653_001, 1),
        (654_323, 1),
        (98_765, 0),
    ],
    quote: [(654_321, 1), (654_322, 1)],
};

/// One Owner record by its identity and the digest it was issued under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OwnerRecordLocatorV1 {
    pub(crate) identity: String,
    pub(crate) digest: String,
}

/// The grid units the single-threshold program targets when its condition holds, for every
/// instrument this harness runs: one Design, whatever the scope names.
///
/// A grid unit is the instrument's quantity increment. For LINK it is 0.01 LINK, about 1.23 USDT at
/// the frame's close, under LINK's 20 USDT `MIN_NOTIONAL`, so 100 units (1 LINK, about 123 USDT) is
/// the least round target inside every limit LINK's exchangeInfo states. For BTC 100 units is 0.1
/// BTC, about 6,543 USDT, inside BTC's 50 USDT `MIN_NOTIONAL` and 1,000 BTC `maxQty`.
pub(crate) const FIRST_COMPOSER_V3_TARGET_UNITS_V1: i64 = 100;

/// Everything the first COMPOSER_V3 Replay was built from, by the locators the Owners issued.
#[derive(Debug)]
#[expect(
    dead_code,
    reason = "the prefix records every locator it was issued; the body reads the ones it asserts against"
)]
pub(crate) struct FirstComposerV3ReplayV1 {
    pub(crate) deployment: ProductEdgeDeploymentAcceptanceFixtureV1,
    pub(crate) research_request_identity: String,
    /// The published Design's identity, as the role intent route returns it: a 32-byte digest,
    /// which R&D stores as `rd_bounded_feature_program_freezes_v1.design_identity` BYTEA.
    pub(crate) design_identity: BindingDigest,
    pub(crate) artifact_locator: String,
    /// The Plan's canonical digest, as the Composer issued it.
    pub(crate) plan_canonical_digest: BindingDigest,
    /// The TrialFamily the Research request formed, whose census counts the Replay's Result.
    pub(crate) trial_family_identity: String,
    pub(crate) replay_request: ExploratoryReplayRequestLocatorV2,
    pub(crate) composition_binding: ReplayCompositionBindingLocatorV1,
    pub(crate) execution_input_binding: OwnerRecordLocatorV1,
    pub(crate) instrument_master_cut: InstrumentMasterCutLocatorV2,
    pub(crate) member_instrument: String,
    /// Whether this call committed the Replay. F asserts `true` on a fresh database.
    pub(crate) created: bool,
}

/// The Data Client behind Market Data's PIT intake: one daily kline per member Market Data issues,
/// as a kline source answers it, with its open, high, low, close and volume. The universe vertical
/// reads the open and the close; the native scheduling Market Data issues for the Replay builds
/// each frame's BAR from all five, and refuses a frame without them as a field census mismatch.
/// Values are in canonical form (no trailing zero at a nonzero scale), as a real client normalizes
/// them; Market Data refuses any other row as not canonical.
struct UniverseMemberDailyBarsV1(PerpetualFixtureV1);

#[async_trait]
impl PitObservationSourceV1 for UniverseMemberDailyBarsV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        let mut observations = scope
            .members()
            .iter()
            .flat_map(|member| {
                let [open, high, low, close, volume] = self.0.bar;
                [
                    ("OPEN", open),
                    ("HIGH", high),
                    ("LOW", low),
                    ("CLOSE", close),
                    ("VOLUME", volume),
                ]
                .map(|(field, (value_mantissa, value_scale))| {
                    VendorObservationV1 {
                        symbolic_key: format!("{member}.{field}.1D"),
                        member_key: member.clone(),
                        instrument: member.clone(),
                        channel: "MARKET".into(),
                        data_kind: "BAR".into(),
                        timeframe: "1D".into(),
                        field: field.into(),
                        value_mantissa,
                        value_scale,
                        event_effective: scope.event_effective(),
                        provider_available: scope.provider_available(),
                        retrieval: scope.retrieval(),
                        correction_publication: scope.correction_publication(),
                    }
                })
            })
            .collect::<Vec<_>>();
        // Market Data takes a batch only in its canonical order, strictly increasing by symbolic
        // key and then member (`decode_canonical_observation_batch`), and does not reorder one.
        observations.sort_by(|left, right| {
            (&left.symbolic_key, &left.member_key).cmp(&(&right.symbolic_key, &right.member_key))
        });
        Ok(observations)
    }
}

/// The Data Client behind the quote cut's intake: one Quote per member Market Data issues, at the
/// instant Market Data issues. The host places a GTC limit at the frame's close, so the ask is at or
/// below it for the buy to fill, at the ask, and the bid one tick under the ask marks the position.
/// Values are canonical, as a real client normalizes them.
struct UniverseMemberQuotesV1(PerpetualFixtureV1);

#[async_trait]
impl PitObservationSourceV1 for UniverseMemberQuotesV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        let mut observations = scope
            .members()
            .iter()
            .flat_map(|member| {
                let [bid, ask] = self.0.quote;
                [
                    ("BID_PRICE", bid),
                    ("ASK_PRICE", ask),
                    ("BID_SIZE", (5, 0)),
                    ("ASK_SIZE", (7, 0)),
                ]
                .map(|(field, (value_mantissa, value_scale))| {
                    VendorObservationV1 {
                        symbolic_key: format!("{member}.{field}.TICK"),
                        member_key: member.clone(),
                        instrument: member.clone(),
                        channel: "MARKET".into(),
                        data_kind: "QUOTE".into(),
                        timeframe: "TICK".into(),
                        field: field.into(),
                        value_mantissa,
                        value_scale,
                        event_effective: scope.event_effective(),
                        provider_available: scope.provider_available(),
                        retrieval: scope.retrieval(),
                        correction_publication: scope.correction_publication(),
                    }
                })
            })
            .collect::<Vec<_>>();
        // The same canonical order as the BAR rows: by symbolic key, then member.
        observations.sort_by(|left, right| {
            (&left.symbolic_key, &left.member_key).cmp(&(&right.symbolic_key, &right.member_key))
        });
        Ok(observations)
    }
}

/// Holds the composed acceptance scheduling resolver and revokes its grants however H8 ends.
///
/// While the grants stand, Market Data refuses its own time-zone custody, and the chain store is
/// shared by every later entry: a panic that skipped the revocation would refuse every replay
/// composition after it. So a drop that finds the grants still held revokes them on a thread of its
/// own, since a drop cannot await.
struct SchedulingGrantsGuardV1(
    Option<crate::native_replay_scheduling_acceptance::AcceptanceSchedulingResolverV1>,
);

impl SchedulingGrantsGuardV1 {
    fn resolver(&self) -> Arc<dyn NativeReplaySchedulingResolverV1> {
        self.0
            .as_ref()
            .expect("the grants are held until revoked")
            .resolver()
    }

    async fn revoke(mut self) {
        if let Some(scheduling) = self.0.take() {
            scheduling.revoke().await;
        }
    }
}

impl Drop for SchedulingGrantsGuardV1 {
    fn drop(&mut self) {
        let Some(scheduling) = self.0.take() else {
            return;
        };

        let revoked = std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("a runtime for the revocation builds")
                .block_on(scheduling.revoke());
        })
        .join();

        // A second panic while one unwinds aborts the process, so only a clean exit reports it.
        assert!(
            revoked.is_ok() || std::thread::panicking(),
            "the scheduling acceptance grants were not revoked"
        );
    }
}

/// The datasets the perpetual's Source Bindings name.
#[derive(Clone, Copy)]
enum PerpetualDatasetV1 {
    /// Daily klines: the BAR rows the PIT intake answers with, labelled "1D" by the source.
    DailyKlines,
    /// The venue's `exchangeInfo`, which the Instrument Master V2 intake reads.
    ExchangeInfo,
    /// Four-hour klines, a feed the Binance Data Client serves. Admitting it is what moves Market
    /// Data's clock past the frame (`advance_market_data_clock_past_v1`); no snapshot here is taken
    /// under it.
    FourHourKlines,
}

impl PerpetualDatasetV1 {
    const fn mapping(self) -> &'static str {
        match self {
            Self::DailyKlines => "usdm/klines/1d",
            Self::ExchangeInfo => "usdm/exchangeInfo",
            Self::FourHourKlines => "usdm/klines/4h",
        }
    }

    /// The klines bindings declare what their rows mean as bars, which only schema 2 can; the
    /// `exchangeInfo` binding serves no BAR row and stays schema 1.
    const fn schema_version(self) -> u16 {
        match self {
            Self::DailyKlines | Self::FourHourKlines => 2,
            Self::ExchangeInfo => 1,
        }
    }

    /// A kline row is visible one second after its bar closes, and the venue never corrects a
    /// closed kline. This is the binding author's statement about the source; no-look-ahead in a
    /// custody-backed Replay rests on it.
    const fn availability_rule(self) -> Option<UntrustedSourceAvailabilityRuleV1> {
        match self {
            Self::DailyKlines | Self::FourHourKlines => Some(UntrustedSourceAvailabilityRuleV1 {
                visibility: UntrustedSourceVisibilityV1::AfterBarClose {
                    lag_ns: 1_000_000_000,
                },
                publishes_corrections: false,
            }),
            Self::ExchangeInfo => None,
        }
    }

    /// The "1D" rows are fixed 24-hour UTC bars on the Unix epoch grid, labelled at their close,
    /// complete only: a perpetual never closes, so its day is not an exchange session day. The
    /// "4H" rows are the same on a four-hour step.
    fn bar_timeframes(self) -> Vec<UntrustedSourceBarTimeframeV1> {
        let continuous = |row_timeframe: &str, step| UntrustedSourceBarTimeframeV1 {
            row_timeframe: row_timeframe.to_owned(),
            cadence: UntrustedSourceBarCadenceV1::FixedInterval {
                step,
                unit: UntrustedSourceBarUnitV1::Hour,
            },
            anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
            clock: UntrustedSourceBarClockV1::Continuous,
            label: UntrustedSourceBarLabelV1::IntervalClose,
            completion: UntrustedSourceBarCompletionV1::CompleteOnly,
        };

        match self {
            Self::DailyKlines => vec![continuous("1D", 24)],
            Self::FourHourKlines => vec![continuous("4H", 4)],
            Self::ExchangeInfo => Vec::new(),
        }
    }
}

/// The perpetual's Source Binding, as Operations proposes one: a public USD-M feed that needs no
/// credential. Every clock field is the Owner's and is overwritten on admission; only the effective
/// instant and its four coordinates are the proposer's.
fn perpetual_source_proposal(
    effective_ns: u64,
    dataset: PerpetualDatasetV1,
) -> UntrustedSourceBindingProposal {
    let frontier = |meaning: &str| UntrustedCompleteFrontier {
        stream_identity: "binance/usdm-klines".to_owned(),
        cut_identity: "binance/usdm-klines/cut-1".to_owned(),
        sequence: 1,
        digest: first_composer_v3_digest(meaning),
    };
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: BindingDigest::from_untrusted_bytes([0; 32]),
        schema_version: dataset.schema_version(),
        adapter: UntrustedAdapterBinding {
            implementation_digest: first_composer_v3_digest("perpetual.adapter.implementation"),
            configuration_digest: first_composer_v3_digest("perpetual.adapter.configuration"),
            authenticated_endpoint_identity: "https://fapi.binance.com".to_owned(),
            dataset_mapping: dataset.mapping().to_owned(),
            account_mapping: "binance/public".to_owned(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            first_composer_v3_digest("perpetual.credential"),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "binance/official-public-data".to_owned(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "binance/usdm-kline".to_owned(),
            adjustment: "raw".to_owned(),
            price_meaning: "decimal-string/usdt".to_owned(),
            calendar_rules: "crypto/continuous".to_owned(),
            session_rules: "crypto/continuous".to_owned(),
            timezone_rules: "etc-utc".to_owned(),
            instrument_lifecycle_rules: "binance/usdm-perpetual".to_owned(),
            corporate_action_rules: "crypto/none".to_owned(),
            membership_rules: "binance/static".to_owned(),
            universe_rules: "requester-owned".to_owned(),
            correction_policy: "provider-revision".to_owned(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "internal-research".to_owned(),
            redistribution_scope: "none".to_owned(),
            retention_policy: "retain-while-entitled".to_owned(),
            redaction_policy: "no-payload-export".to_owned(),
        },
        source_frontier: frontier("perpetual.source-frontier"),
        correction_frontier: frontier("perpetual.correction-frontier"),
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: BindingDigest::from_untrusted_bytes([0; 32]),
            clock_identity: String::new(),
            clock_epoch: String::new(),
            monotonic_sequence: 0,
            restart_continuity_digest: BindingDigest::from_untrusted_bytes([0; 32]),
            skew_bound: 0,
            uncertainty_bound: 0,
            event_effective: effective_ns,
            provider_available: effective_ns,
            retrieval: effective_ns,
            correction_publication: effective_ns,
            observed_at: 0,
            effective_at: effective_ns,
            valid_through: 0,
        },
        availability_rule: dataset.availability_rule(),
        bar_timeframes: dataset.bar_timeframes(),
    };
    seal_binding_claim_v1(&mut proposal);
    proposal
}

/// The perpetual's Instrument Master fact, as Operations describes it: a linear USD-M perpetual on
/// a venue that never closes, observed under the admitted binding just before the effective instant.
fn perpetual_instrument_submission(
    instrument: PerpetualFixtureV1,
    source_binding: &UntrustedSourceBindingLocator,
    effective_ns: u64,
) -> InstrumentMasterFactSubmissionV1 {
    let observed = i128::from(effective_ns) - 1;
    let meaning = |frontier: &str| {
        first_composer_v3_digest(&format!("{}.{frontier}", instrument.meaning_namespace))
    };
    InstrumentMasterFactSubmissionV1 {
        canonical_identity: instrument.canonical.to_owned(),
        predecessor_fact_digest: None,
        mappings: vec![InstrumentVenueSourceMappingSubmissionV1 {
            venue_identity: "BINANCE".to_owned(),
            source_identity: "BINANCE_USDM".to_owned(),
            source_instrument: instrument.raw_symbol.as_bytes().to_vec(),
        }],
        instrument_class: "CRYPTO_PERPETUAL".to_owned(),
        base_currency: Some(instrument.base.to_owned()),
        quote_currency: Some("USDT".to_owned()),
        settlement_currency: Some("USDT".to_owned()),
        margin_currency: Some("USDT".to_owned()),
        // The same increments the Instrument Master V2 fact derives from the same entry, so the
        // two generations cannot disagree about the instrument's terms.
        price_increment: exchange_info_filter_decimal(instrument, "PRICE_FILTER", "tickSize"),
        quantity_increment: exchange_info_filter_decimal(instrument, "LOT_SIZE", "stepSize"),
        contract_multiplier: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 0,
        },
        calendar_identity: "CRYPTO-CONTINUOUS-V1".to_owned(),
        session_identity: "CRYPTO-CONTINUOUS-V1".to_owned(),
        time_zone_identity: "Etc/UTC".to_owned(),
        lifecycle_frontier: meaning("lifecycle-frontier"),
        corporate_action_frontier: meaning("corporate-action-frontier"),
        historical_membership_frontier: meaning("eligible-frontier"),
        source_binding: source_binding.clone(),
        effective_from: 1,
        effective_until: None,
        provider_available: observed,
        retrieval: observed,
        correction_publication: observed,
        owner_observation: observed,
    }
}

/// One decimal filter value of the perpetual's `exchangeInfo` entry, in canonical form (no trailing
/// zero at a nonzero scale).
fn exchange_info_filter_decimal(
    instrument: PerpetualFixtureV1,
    filter_type: &str,
    field: &str,
) -> InstrumentDecimalSubmissionV1 {
    let info: serde_json::Value =
        serde_json::from_str(instrument.exchange_info).expect("the exchangeInfo fixture parses");
    let text = info["symbols"][0]["filters"]
        .as_array()
        .expect("the entry states its filters")
        .iter()
        .find(|filter| filter["filterType"] == filter_type)
        .and_then(|filter| filter[field].as_str())
        .unwrap_or_else(|| panic!("the entry states {filter_type}.{field}"));
    let (whole, fraction) = text.split_once('.').unwrap_or((text, ""));
    let fraction = fraction.trim_end_matches('0');
    InstrumentDecimalSubmissionV1 {
        mantissa: format!("{whole}{fraction}")
            .parse()
            .expect("a filter value is a decimal"),
        scale: u8::try_from(fraction.len()).expect("a filter value has a small scale"),
    }
}

/// A registry meaning named for this fixture, so no value is borrowed from another entry's.
fn first_composer_v3_digest(meaning: &str) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(
        Sha256::digest(format!("first-composer-v3-replay.{meaning}").as_bytes()).into(),
    )
}

/// A route's answer as `(status, "[rejection code] body")`: the code is a header, and two refusals
/// with the same status differ only there.
async fn post(app: &Router, path: &str, body: Option<serde_json::Value>) -> (StatusCode, String) {
    let request = Request::builder()
        .method("POST")
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |body| {
            Body::from(serde_json::to_vec(&body).expect("a JSON body serializes"))
        }))
        .expect("a well-formed request");
    let response = app
        .clone()
        .oneshot(request)
        .await
        .expect("the router answers");
    let status = response.status();
    let code = response
        .headers()
        .get("x-rd-rejection-code")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("-")
        .to_owned();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("the body is read");
    (
        status,
        format!("[{code}] {}", String::from_utf8_lossy(&bytes)),
    )
}

fn json_of(answer: &str) -> serde_json::Value {
    serde_json::from_str(answer.split_once("] ").expect("the code prefix").1)
        .expect("the answer is JSON")
}

/// Accepts the Research request through Product Edge admission and the Owner's own submit, with the
/// real Market Data scope check. The scope makes it a V3 request.
async fn accept_research(
    deployment: &ProductEdgeDeploymentAcceptanceFixtureV1,
    product_edge_url: &str,
    owner: &PostgresResearchGoalOwnerV1,
    request_identity: &str,
    instrument: PerpetualFixtureV1,
) -> ResearchGoalOwnerResultV2 {
    let operation = ProductEdgeOperationRequestV2 {
        request_identity: request_identity.to_owned(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        goal: SourcedResearchGoalV2 {
            hypothesis: "A daily close above a fixed level continues for one session.".to_owned(),
            mechanism: "Slow information diffusion creates bounded continuation.".to_owned(),
            falsification_question: "Does the continuation vanish after modeled costs?".to_owned(),
            expected_observation: "Net continuation remains positive.".to_owned(),
            required_data: vec!["PIT daily bars of the requested instrument".to_owned()],
            cost_assumption: "Exact acceptance cost model.".to_owned(),
            capacity_assumption: "Exact acceptance capacity model.".to_owned(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/first-composer-v3-replay".to_owned(),
                content_digest: format!("sha256:{}", "b".repeat(64)),
                observed_at: "2026-09-26T00:00:00Z".to_owned(),
                source_cut: "first-composer-v3-replay-cut-v1".to_owned(),
                license_basis: "public research".to_owned(),
                interpretation: "First COMPOSER_V3 Replay acceptance fixture.".to_owned(),
            }],
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 2,
            stop_rule: "Stop on falsifier or unavailable PIT input.".to_owned(),
            pit_rule_identity: "pit-rule-v1".to_owned(),
            cost_model_identity: "cost-model-v1".to_owned(),
            slippage_model_identity: "slippage-model-v1".to_owned(),
            capacity_model_identity: "capacity-model-v1".to_owned(),
            independence_rationale: "First COMPOSER_V3 Replay family.".to_owned(),
        },
    };
    let instrument_scope = ResearchInstrumentScopeWireV1 {
        schema_version: 1,
        identities: vec![instrument.canonical.to_owned()],
    };
    let mut typed_payload = serde_json::to_value(&operation).expect("the operation serializes");
    typed_payload["instrument_scope"] =
        serde_json::to_value(&instrument_scope).expect("the scope serializes");
    let admission = deployment
        .connect_owner(product_edge_url)
        .await
        .expect("the deployment's Product Edge Owner opens")
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.to_owned(),
            typed_payload,
            operation: RESEARCH_GOAL_OPERATION_V3.to_owned(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V3.to_owned(),
            target_owner: RESEARCH_OWNER_V1.to_owned(),
            requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_owned()],
            request_proof_digest: deployment.request_proof_digest.clone(),
            audit_correlation: format!("rd-workbench:{request_identity}"),
        })
        .await
        .expect("Product Edge admits the V3 Research request");
    owner
        .submit_v2(ProductEdgeResearchGoalRequestV2 {
            request_identity: operation.request_identity,
            channel: operation.channel,
            admission: admission.locator().clone(),
            goal: operation.goal,
            trial_family_proposal: operation.trial_family_proposal,
            instrument_scope: Some(instrument_scope),
        })
        .await
        .expect("the R&D Owner answers the V3 Research request")
}

/// Commits the first COMPOSER_V3 Replay under `fixture_key`, or returns the one already committed
/// under it.
#[allow(
    clippy::too_many_lines,
    reason = "one ordered path, read top to bottom"
)]
pub(crate) async fn ensure_first_composer_v3_replay_acceptance_v1(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    fixture_key: &str,
    instrument: PerpetualFixtureV1,
) -> FirstComposerV3ReplayV1 {
    let rd_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let product_edge_url = test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner);
    // The production Market Data ports open from the deployment environment, under the roles the
    // deployment gives them.
    super::tests::composed_market_data_binding_admission(test_database).await;
    // The sealed Catalog V3 head the Research request forms its TrialFamily against, ensured here
    // rather than inherited from an earlier entry of another shard, then advanced to a schema 2
    // economic configuration at BINANCE. The base head is schema 1 at SIM and pins ETHUSDT-PERP's
    // terms; schema 2 pins no instrument, so the Replay's terms are the perpetual's own, as the
    // Instrument Owner resolves them for its window. The second instrument's entry after F forms its
    // family against the same schema 2 head, which this call then resolves exactly.
    // The schema 2 ensure ensures the base itself while the head is not yet its record, and
    // resolves its record exactly once it is. Ensuring the base here as well would conflict on the
    // body's second call, once the head has moved past it.
    let catalog_admin = sqlx::postgres::PgPoolOptions::new()
        .connect_url(
            test_database.database_url(CanonicalOwnerTestRoleV1::ReplayPolicyCatalogAdminWriter),
            vibe_postgres_connect::PostgresTls::Disabled,
        )
        .await
        .expect("the Catalog administrator connects");
    vibe_strategy_factory::replay_policy_catalog_sealed_acceptance_v2::ensure_replay_policy_catalog_schema_2_fixture_v3(
        &catalog_admin,
        "BINANCE",
    )
    .await
    .expect("the schema 2 Catalog head at BINANCE is created or resolved exactly");
    let token_digest: [u8; 32] = Sha256::digest(TOKEN.as_bytes()).into();

    // The deployment admits the two operations this Replay is made of: the V3 Research request and
    // the COMPOSER_V3 Replay composed from it.
    let deployment = ensure_product_edge_deployment_acceptance_fixture_v1(
        test_database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
        product_edge_url,
        &DeploymentAcceptanceProposalV1 {
            fixture_key: fixture_key.to_owned(),
            audience: RESEARCH_OWNER_V1.to_owned(),
            permissions: vec!["research:submit".to_owned()],
            operations: vec![
                DeploymentAcceptanceOperationV1 {
                    operation: RESEARCH_GOAL_OPERATION_V3.to_owned(),
                    operation_schema: RESEARCH_GOAL_SCHEMA_V3.to_owned(),
                    allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".to_owned()],
                },
                DeploymentAcceptanceOperationV1 {
                    operation: EXPLORATORY_REPLAY_OPERATION_V3.to_owned(),
                    operation_schema: EXPLORATORY_REPLAY_SCHEMA_V3.to_owned(),
                    allowed_effects: vec![EXPLORATORY_REPLAY_MUTATION_EFFECT_V3.to_owned()],
                },
            ],
        },
    )
    .await
    .unwrap_or_else(|e| panic!("the F deployment: {e}"));

    let bounded_feature_program_owner = Arc::new(
        PostgresResearchBoundedFeatureProgramOwnerV1::connect(rd_url)
            .await
            .expect("the Bounded Feature Program Owner opens"),
    );
    let routes =
        bounded_feature_program::router(bounded_feature_program_owner.clone(), token_digest)
            .merge(market_data_routes(None, token_digest).await);

    // H0: the perpetual, admitted as Operations admits an instrument, through Market Data's
    // production routes: its Source Binding, its Instrument Master fact under that binding, and the
    // historical membership of one eligible frontier that names it. Every instant is Market Data's
    // own decision cut, read from the production intake.
    //
    // Deliberate state side effect: that frontier is admitted last, so it becomes Market Data's
    // current eligible frontier in the shared chain database, and it names only the perpetual. A
    // later entry whose Research scope names another instrument is refused at the scope check as
    // NotInEligibleFrontier. Market Data has one current frontier and admits no way back to an
    // earlier one, so the chain guards the order instead: `--check` refuses any entry after this
    // one other than those it lists.
    let intake = pit_market_snapshot_intake_from_environment_v1(Arc::new(
        UniverseMemberDailyBarsV1(instrument),
    ))
    .await
    .expect("Market Data's PIT intake opens");
    let effective_ns = intake
        .current_decision_cut()
        .await
        .expect("H0: Market Data states its decision cut")
        .decision_cut
        .as_epoch_nanos();
    let proposal = perpetual_source_proposal(effective_ns, PerpetualDatasetV1::DailyKlines);
    let (status, answer) = post(
        &routes,
        "/v1/market-data/source-bindings",
        Some(
            serde_json::to_value(SourceBindingAdmissionRequestV1 {
                proposal: proposal.clone(),
                rights: ProviderRightsEvidenceV1::Granted,
                reachability: ProviderReachabilityEvidenceV1::Reachable,
            })
            .expect("the binding admission serializes"),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H0: the perpetual's Source Binding: {answer}"
    );
    let binding: SourceBindingAdmissionTerminalV1 = serde_json::from_value(json_of(&answer))
        .expect("H0: the binding admission answers its terminal");
    assert_eq!(
        binding.disposition(),
        SourceBindingAdmissionDispositionV1::Admitted,
        "H0: granted rights and a reachable endpoint admit the binding"
    );
    let (status, answer) = post(
        &routes,
        "/v1/market-data/instrument-master-facts",
        Some(
            serde_json::to_value(perpetual_instrument_submission(
                instrument,
                binding.locator(),
                effective_ns,
            ))
            .expect("the instrument submission serializes"),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H0: the perpetual's Instrument Master fact: {answer}"
    );
    // Its Instrument Master V2 fact, which Market Data derives from the real `exchangeInfo` entry
    // under a Source Binding that names that dataset. The retrieval instant is when the entry was
    // fetched; the Owner's clock head, which the binding admission above stamped, is past it.
    let exchange_info_binding: SourceBindingAdmissionTerminalV1 = {
        let (status, answer) = post(
            &routes,
            "/v1/market-data/source-bindings",
            Some(
                serde_json::to_value(SourceBindingAdmissionRequestV1 {
                    proposal: perpetual_source_proposal(
                        effective_ns,
                        PerpetualDatasetV1::ExchangeInfo,
                    ),
                    rights: ProviderRightsEvidenceV1::Granted,
                    reachability: ProviderReachabilityEvidenceV1::Reachable,
                })
                .expect("the binding admission serializes"),
            ),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "H0: the exchangeInfo Source Binding: {answer}"
        );
        serde_json::from_value(json_of(&answer))
            .expect("H0: the binding admission answers its terminal")
    };
    let (status, answer) = post(
        &routes,
        "/v1/market-data/instrument-master-v2-facts",
        Some(serde_json::json!({
            "raw_symbol": instrument.raw_symbol,
            "instrument_class": "CRYPTO_PERPETUAL",
            "retrieval_time_ns": instrument.exchange_info_retrieved_ns,
            "raw_payload": instrument.exchange_info,
            "source_binding": exchange_info_binding.locator(),
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H0: the perpetual's Instrument Master V2 fact: {answer}"
    );
    assert_eq!(
        json_of(&answer)["canonical_identity"],
        instrument.canonical,
        "H0: Market Data derives the perpetual's canonical identity: {answer}"
    );
    // Its economic terms, as Operations admits them: issued by the Instrument Owner from that V2
    // fact and the venue's public defaults, under a business account scope of the Owner's naming.
    // They are valid from the perpetual's listing and bounded well past F's window.
    let public_fact = json_of(&answer)["fact_identity"].clone();
    let (status, answer) = post(
        &routes,
        "/v1/market-data/instrument-economic-terms",
        Some(serde_json::json!({
            "canonical_identity": instrument.canonical,
            "instrument_fact_identity": public_fact,
            "account_scope_identity": "RDQ-MARGIN",
            "valid_until_ns_exclusive": 4_102_444_800_000_000_000_u64,
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H0: the perpetual's instrument economic terms: {answer}"
    );
    let terms = json_of(&answer);
    assert_eq!(
        (
            &terms["canonical_identity"],
            &terms["instrument_public_fact_digest"],
            &terms["account_scope_identity"],
        ),
        (
            &serde_json::json!(instrument.canonical),
            &public_fact,
            &serde_json::json!("RDQ-MARGIN"),
        ),
        "H0: the terms name the perpetual, its V2 fact and the scope: {answer}"
    );
    let observed = i128::from(effective_ns);
    let (status, answer) = post(
        &routes,
        "/v1/market-data/historical-memberships",
        Some(
            serde_json::to_value(HistoricalMembershipAdmissionRequestV1 {
                eligible_instrument_frontier: first_composer_v3_digest(&format!(
                    "{}.eligible-frontier",
                    instrument.meaning_namespace
                )),
                members: vec![HistoricalMembershipSubmissionV1 {
                    member_key: instrument.canonical.to_owned(),
                    instrument: instrument.canonical.to_owned(),
                    effective_from_ns: 1,
                    effective_until_ns: None,
                    provider_available_ns: observed,
                    retrieval_ns: observed,
                    correction_publication_ns: observed,
                    owner_observation_ns: observed,
                    decision_cut: effective_ns,
                    source_binding_lineage_root: binding.lineage_root(),
                    correction_frontier_digest: proposal.correction_frontier.digest,
                }],
            })
            .expect("the membership admission serializes"),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H0: the perpetual's membership: {answer}"
    );

    // H1: the V3 Research request, scoped to the perpetual.
    let owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(
            rd_url,
            test_database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        )
        .await
        .expect("the R&D Owner opens"),
    );
    let research_request_identity = format!("{fixture_key}-research");
    let accepted = Box::pin(accept_research(
        &deployment,
        product_edge_url,
        &owner,
        &research_request_identity,
        instrument,
    ))
    .await;
    assert_eq!(
        accepted.resolution(),
        ProductEdgeResolution::Accepted,
        "H1: the V3 Research request must be accepted: {accepted:?}",
    );

    // H2: its initial PIT request, issued over the production route to Market Data's production
    // intake.
    let ports = MarketDataInitialPitPortsV1::new(
        universe_selection_admission_from_environment_v1()
            .await
            .expect("Market Data's Universe Selection admission opens"),
        intake,
    );
    let initial_pit = research_initial_pit::router(owner.clone(), Some(ports), token_digest);
    let (status, answer) = post(
        &initial_pit,
        &format!("/v3/research-goals/{research_request_identity}/initial-pit"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "H2: {answer}");
    assert_eq!(
        json_of(&answer)["initial_pit"],
        serde_json::json!({"state": "TERMINAL", "disposition": "AVAILABLE", "primary_blocker": null}),
        "H2: Market Data must derive an AVAILABLE terminal: {answer}",
    );

    // The snapshot Market Data committed and the Source Binding R&D froze it under, read back rather
    // than restated: the snapshot through Market Data's public correlation read, the binding from
    // the exact submission bytes R&D froze and Market Data checked against its receipt.
    let rd = sqlx::postgres::PgPoolOptions::new()
        .connect_url(rd_url, vibe_postgres_connect::PostgresTls::Disabled)
        .await
        .expect("the R&D Owner pool opens");
    let (correlation, submission_bytes, selection_request, selection_meaning): (
        Vec<u8>,
        Vec<u8>,
        Vec<u8>,
        Vec<u8>,
    ) = sqlx::query_as(
        "SELECT attempt.correlation_identity, attempt.submission_bytes,
                attempt.universe_selection_request_identity,
                attempt.universe_selection_request_meaning_digest
           FROM rd_research_initial_pit_terminals_v1 terminal
           JOIN rd_research_initial_pit_attempts_v1 attempt
             ON attempt.request_identity = terminal.request_identity
            AND attempt.attempt_ordinal = terminal.attempt_ordinal
          WHERE terminal.request_identity = $1",
    )
    .bind(&research_request_identity)
    .fetch_one(&rd)
    .await
    .expect("H2: the terminal names the attempt it seals to");
    let submission = PitSnapshotSubmissionV1::from_json_value_v1(
        serde_json::from_slice(&submission_bytes).expect("the frozen submission is JSON"),
    )
    .expect("the frozen submission decodes with Market Data's own decoder");
    let mut read = rd.begin().await.expect("a read transaction opens");
    let held = vibe_data::owner::resolve_research_pit_terminal_by_correlation_v1(
        &mut read,
        BindingDigest::from_untrusted_bytes(
            correlation
                .as_slice()
                .try_into()
                .expect("a correlation is 32 bytes"),
        ),
    )
    .await
    .expect("Market Data answers the correlation read")
    .expect("Market Data holds the committed intake");
    read.rollback().await.expect("the read transaction closes");
    let pit_snapshot = held
        .terminal()
        .locator()
        .expect("an AVAILABLE terminal locates its snapshot")
        .clone();

    // H2b: the Market Semantics fact for this snapshot, which the universe declaration below
    // requires and nothing in this flow creates. Operations states it through the production route.
    // A scope that already has heads admits only the value they carry, so Operations restates the
    // value Market Data reads back for the binding's scope; only a scope with no head yet takes
    // Operations' own statement about the feed.
    let mut read = rd.begin().await.expect("a read transaction opens");
    let scope_value = vibe_data::owner::resolve_market_semantics_scope_value_v1(
        &mut read,
        &submission.source_binding,
    )
    .await
    .unwrap_or_else(|e| panic!("H2b: Market Data states the binding's scope value: {e:?}"));
    read.rollback().await.expect("the read transaction closes");
    let value = scope_value
        .value()
        .cloned()
        .unwrap_or_else(|| MarketSemanticsValueSubmissionV1 {
            normalization_identity: first_composer_v3_digest("normalization"),
            price_adjustment: "RAW".to_owned(),
            timestamp_basis: "EVENT_EFFECTIVE".to_owned(),
            price_unit_identity: first_composer_v3_digest("price-unit"),
            size_unit_identity: first_composer_v3_digest("size-unit"),
        });
    let (status, answer) = post(
        &routes,
        "/v1/market-data/market-semantics",
        Some(
            serde_json::to_value(MarketSemanticsFactSubmissionV1 {
                source_binding: submission.source_binding.clone(),
                pit_snapshot: pit_snapshot.clone(),
                value,
            })
            .expect("the Market Semantics submission serializes"),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H2b: the snapshot's Market Semantics fact: {answer}"
    );

    // H2c: the frame's quote cut, a PIT snapshot of Quote rows alone that Market Data publishes
    // after the frame's decision cut; the frame's fill takes its liquidity from it
    // (`docs/owners/market-data.md`, the quote cut). It is asked for over the production route on
    // the frame's own coordinates - its scope, Source Binding, universe selection and Market
    // Semantics - because a quote cut serves a frame on no others, and Market Data freezes it at
    // its own decision cut, which makes the cut the quote's instant.
    //
    // Market Data's decision cut moves only when the Owner admits something, so the clock is moved
    // past the frame first (`advance_market_data_clock_past_v1`). A second call under the same key
    // finds the clock already past it and the quote cut already committed.
    let quote_routes = market_data_routes(
        Some(
            pit_market_snapshot_intake_from_environment_v1(Arc::new(UniverseMemberQuotesV1(
                instrument,
            )))
            .await
            .expect("Market Data's PIT intake opens for the quote cut"),
        ),
        token_digest,
    )
    .await;
    let frame_ns = submission.time_evidence.event_effective.value;
    let cut = advance_market_data_clock_past_v1(&quote_routes, frame_ns).await;
    let quote_ns = cut.decision_cut.as_epoch_nanos();
    assert!(
        quote_ns > frame_ns,
        "H2c: the quote cut's instant {quote_ns} follows the frame's {frame_ns}"
    );
    assert!(
        quote_ns - frame_ns < 86_400_000_000_000,
        "H2c: the quote cut's instant {quote_ns} lies inside the frame's one-day window from \
         {frame_ns}"
    );
    assert_ne!(
        quote_ns % 86_400_000_000_000,
        0,
        "H2c: the fill's quote instant {quote_ns} is not on a UTC midnight, so the fill snapshot \
         falls in a day bucket of its own"
    );
    let (status, answer) = post(
        &quote_routes,
        "/v1/market-data/pit-market-snapshot-requests",
        Some(serde_json::json!({
            "submission": PitSnapshotSubmissionV1 {
                correlation_identity: first_composer_v3_digest(&format!("{fixture_key}:quote-cut")),
                time_evidence: UntrustedPitSnapshotTimeEvidence::at_decision_cut_v1(&cut),
                ..submission.clone()
            },
            "universe_selection": UntrustedUniverseSelectionLocatorV1::from_untrusted(
                BindingDigest::from_untrusted_bytes(
                    selection_request
                        .as_slice()
                        .try_into()
                        .expect("a selection request identity is 32 bytes"),
                ),
                BindingDigest::from_untrusted_bytes(
                    selection_meaning
                        .as_slice()
                        .try_into()
                        .expect("a selection meaning digest is 32 bytes"),
                ),
            ),
        })),
    )
    .await;

    if status == StatusCode::OK {
        assert_eq!(
            json_of(&answer)["disposition"],
            "AVAILABLE",
            "H2c: Market Data derives an AVAILABLE quote cut: {answer}"
        );
    } else {
        assert!(
            status == StatusCode::CONFLICT && answer.contains("PIT_CORRELATION_ALREADY_COMMITTED"),
            "H2c: the frame's quote cut: {answer}"
        );
    }

    // H3 and H4: the Design, authored by the admitted proposer in its universe-member form from the
    // Research custody's own facts, then published, bound and frozen over the production routes.
    let facts = bounded_feature_program_owner
        .read_research_authoring_facts_v1(&research_request_identity)
        .await
        .unwrap_or_else(|e| panic!("H4: the Research custody states its authoring facts: {e:?}"));
    let (design, meaning) =
        author_single_threshold_program_v1(&SingleThresholdAuthoringRequestV1 {
            research_request_identity: facts.research_request_identity,
            intent_identity: facts.intent_identity,
            intent_digest: facts.intent_digest,
            channel: SingleThresholdChannelV1::UniverseMember {
                close_role_semantic_id: CLOSE_ROLE.to_owned(),
                open_role_semantic_id: OPEN_ROLE.to_owned(),
            },
            threshold_coefficient: 12_000,
            comparison: BoundedFeaturePredicateV1::Greater,
            // The same Design for every instrument (see FIRST_COMPOSER_V3_TARGET_UNITS_V1).
            when_true: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: FIRST_COMPOSER_V3_TARGET_UNITS_V1,
                target_weight_micros: 0,
            },
            otherwise: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 0,
                target_weight_micros: 0,
            },
            falsifier: facts.falsifier.clone(),
        })
        .expect("H4: the proposer authors the universe-member statement");
    let (status, answer) = post(
        &routes,
        "/v1/strategy-designs/publish-role-intent",
        Some(serde_json::json!({
            "research_request_locator": research_request_identity,
            "design": design,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "H3: the role intent: {answer}");
    let published = json_of(&answer);
    let (status, answer) = post(
        &routes,
        "/v1/market-data/strategy-input-bindings/from-design-intent",
        Some(serde_json::json!({ "design_identity": published["design_identity"] })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H4: the universe declaration: {answer}"
    );

    // H4b: the BAR schedule the Replay's frame reads for the pricing role, which production has no
    // proposer for (`bar_schedule_acceptance_v1`). Market Data derives every schedule field from the
    // snapshot's verified batch, the role's declaration and the snapshot's Instrument Master cut.
    //
    // The schedule is the one the klines binding declares: a fixed 24-hour UTC day on the Unix epoch
    // grid, continuous, labelled at its close, complete only, and the engine's bar type for it is
    // the canonical `1-DAY` spelling of that duration.
    //
    // The fields are compared one by one because the bar name cannot tell this schedule from the
    // one that matters most to refuse. Declared as a valid exchange session day instead, the klines
    // binding is still admitted (whether a declaration is true of the market is its author's
    // statement), the proposer mints a session-day schedule over the Instrument Master's
    // non-empty calendar and session, and the engine names that bar `1-DAY` too. Only the kind,
    // unit, step, anchor and clock below differ, so deleting them would let that schedule pass.
    let close_role = design
        .inputs
        .iter()
        .find(|role| role.semantic_id == CLOSE_ROLE)
        .expect("H4b: the Design declares its pricing role");
    let minted =
        vibe_data::owner::bar_schedule_acceptance_v1::commit_bar_schedule_for_acceptance_v1(
            test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
            &pit_snapshot,
            serde_json::from_value(published["design_identity"].clone())
                .expect("H3: the role intent names its Design"),
            vibe_strategy_factory::strategy_plan_v2::strategy_input_role_identity_v2(close_role),
        )
        .await
        .unwrap_or_else(|e| {
            panic!("H4b: Market Data puts the pricing role's BAR schedule in custody: {e:?}")
        });
    let schedule = minted.schedule().fact();
    assert_eq!(
        (schedule.kind(), schedule.unit(), schedule.step()),
        (
            BarScheduleKindV1::FixedInterval,
            BarScheduleUnitV1::Hour,
            24
        ),
        "H4b: the schedule is a fixed 24-hour interval"
    );
    assert_eq!(
        schedule.anchor_identity(),
        anchor_identity_v1(DeclaredBarAnchorV1::UnixEpoch),
        "H4b: the schedule is anchored at the Unix epoch"
    );
    assert_eq!(schedule.clock(), BarScheduleClockV1::Continuous);
    assert_eq!(
        (schedule.calendar_identity(), schedule.session_identity()),
        (
            BindingDigest::from_untrusted_bytes([0; 32]),
            BindingDigest::from_untrusted_bytes([0; 32])
        ),
        "H4b: a continuous schedule binds no calendar and no session"
    );
    assert_eq!(schedule.label(), BarScheduleLabelV1::IntervalClose);
    assert_eq!(schedule.completion(), BarScheduleCompletionV1::CompleteOnly);
    assert_eq!(
        native_bar_type_for_schedule_v1(schedule, instrument.canonical.into())
            .expect("H4b: the schedule projects to a bar type")
            .to_string(),
        format!("{}-1-DAY-LAST-EXTERNAL", instrument.canonical),
        "H4b: the engine's bar type for the schedule"
    );
    let (status, answer) = post(
        &routes,
        "/v1/bounded-feature-programs/declare",
        Some(serde_json::json!({
            "research_request_locator": research_request_identity,
            "design": design,
            "meaning": meaning,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "H4: the freeze: {answer}");

    // H5: the production Composer, through the library (see the module documentation for why not
    // its route).
    let composer = PostgresSourceResearchComposerProductionV2::connect(
        rd_url,
        test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await
    .expect("the production Composer opens");
    let composed = Box::pin(composer.run_bounded_feature_program(&research_request_identity))
        .await
        .expect("H5: the Composer transaction completes");
    assert_eq!(
        composed.disposition,
        DevelopComposerOperationDispositionV2::Success,
        "H5: the universe-member program must compose: {:?} at {:?}",
        composed.reason,
        composed.coordinate,
    );

    // The R&D Owner API's own state, as `main` composes it, for the two routes below that read it:
    // the universe-member composition issuance and the COMPOSER_V3 commit.
    let state = Box::pin(owner_api_state(
        test_database,
        &deployment,
        owner.clone(),
        token_digest,
    ))
    .await;
    let app = owner_state_routes().with_state(state.clone());

    // H6: the universe-member composition binding, over the production route. The Design's role
    // set is the Composer operation's own positive answer; the four authority locators are Market
    // Data's answer for this snapshot and binding, not restated here. The window is the one
    // instant the snapshot's reference facts cover: Market Data derives its R0 record, and the
    // Market Semantics fact over it, for [event effective, event effective + 1).
    let composer_locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&composed)
        .expect("H6: a successful Composer operation locates its artifact");
    let mut read = rd.begin().await.expect("a read transaction opens");
    let basis = vibe_data::owner::resolve_universe_member_composition_basis_v1(
        &mut read,
        &pit_snapshot,
        &submission.source_binding,
    )
    .await
    .unwrap_or_else(|e| panic!("H6: Market Data states the snapshot's composition basis: {e:?}"));
    read.rollback().await.expect("the read transaction closes");
    let composition: ReplayCompositionUniverseBindingIssuanceRequestV1 =
        serde_json::from_value(serde_json::json!({
            "composer_locator": composer_locator,
            "pit_locator": pit_snapshot,
            "source_binding_locator": submission.source_binding,
            "universe_selection_locator": basis.universe_selection_locator(),
            "reference_fact_r0_locator": basis.reference_fact_r0_locator(),
            "market_semantics_locator": basis.market_semantics_locator(),
            "correction_policy_locator": basis.correction_policy_locator(),
        }))
        .expect("the issuance command states exactly the universe-member composition's fields");
    let issuance = ReplayCompositionLocatorOnlyIssuanceRequestV1::new(
        first_composer_v3_digest(&format!("{fixture_key}:composition")),
        composition,
    )
    .expect("the issuance command encodes canonically");
    let (status, answer) = post(
        &app,
        "/v1/replay-compositions/universe-member-issuances",
        Some(serde_json::to_value(&issuance).expect("the issuance command serializes")),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H6: the composition binding: {answer}"
    );
    let composition_binding: ReplayCompositionBindingLocatorV1 =
        serde_json::from_value(json_of(&answer)["binding"]["locator"].clone())
            .expect("H6: the issuance answers its binding's locator");

    // H7: the COMPOSER_V3 Replay, committed over the production route. Its TrialFamily is the one
    // H1's Research request formed. Its window is the one its Market Data facts were composed over,
    // which R&D requires to lie within that family's sealed Replay policy window
    // (`replay_window_within_policy_v3`).
    let family = accepted
        .trial_family()
        .expect("H1: an accepted Research request forms its TrialFamily");
    let policy_window = family
        .root()
        .policy()
        .replay_policy_catalog_v3()
        .expect("H1: the TrialFamily seals a Replay policy catalog")
        .replay_policy_v2()
        .verify()
        .expect("H1: the sealed Replay policy verifies")
        .window;
    let replay_request_identity = format!("{fixture_key}-replay");
    let created = !sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM rd_sealed_exploratory_replay_requests_v1
                         WHERE request_identity = $1)",
    )
    .bind(&replay_request_identity)
    .fetch_one(&rd)
    .await
    .expect("H7: R&D answers whether the Replay is already committed");
    let (status, answer) = post(
        &app,
        "/v3/exploratory-replay-requests/composer-backed",
        Some(serde_json::json!({
            "request_identity": replay_request_identity,
            "trial_family_identity": family.root().trial_family_identity(),
            "artifact_identity": composer_locator.artifact_locator,
            "composer_locator": composer_locator,
            "market_data_locator": composition_binding,
            "market_data_scope_digest": submission.scope_digest,
        })),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H7: the COMPOSER_V3 Replay (TrialFamily window {}..{}): {answer}",
        policy_window.start_event_ns,
        policy_window.end_event_ns_exclusive,
    );
    let replay_request: ExploratoryReplayRequestLocatorV2 =
        serde_json::from_value(json_of(&answer)["locator"].clone())
            .expect("H7: the commit answers its Replay's locator");

    // H8: the execution input binding, issued over the production route and read back through the
    // result route. Market Data issues the request's Instrument Master cut and initial-frame sample
    // projection under the Replay's composition binding, and answers the scheduling reads through
    // the resolver the ordered chain composes in place of the Store Admission one. Its ports open
    // from the deployment environment, as `main` opens them, into a copy of the API state.
    //
    // The resolver is composed for H8 only. Its grants give the test principal usage of
    // `market_data_private`, and while they stand Market Data refuses its own time-zone custody,
    // which the replay composition Owner verifies on connect and on every issuance. So the copy
    // carries no replay composition Owner, and the grants are revoked once H8 has read back.
    let instrument_master = Arc::new(
        instrument_master_v2_postgres_owner_from_environment()
            .await
            .expect("Market Data's Instrument Master Owner opens"),
    );
    let mut execution_state = state;
    execution_state.instrument_master_v2 = Some(instrument_master.clone());
    execution_state.instrument_economic_terms = Some(Arc::new(
        instrument_economic_terms_postgres_owner_from_environment_v1()
            .await
            .expect("Market Data's instrument economic terms Owner opens"),
    ));
    execution_state.universe_sample_projection = Some(Arc::new(
        universe_sample_projection_owner_from_environment_v1()
            .await
            .expect("Market Data's universe sample projection Owner opens"),
    ));
    execution_state.replay_composition = None;
    let scheduling = SchedulingGrantsGuardV1(Some(
        crate::native_replay_scheduling_acceptance::composed_native_replay_scheduling_resolver(
            test_database,
        )
        .await,
    ));
    execution_state.native_replay_scheduling = Some(scheduling.resolver());
    let execution_app = owner_state_routes().with_state(execution_state);
    let (status, answer) = post(
        &execution_app,
        "/v2/exploratory-replay/execution-input-bindings",
        Some(serde_json::to_value(&replay_request).expect("the Replay locator serializes")),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H8: the execution input binding: {answer}"
    );
    let issued = json_of(&answer);
    let (status, answer) = post(
        &exploratory_replay::result_router(owner.clone(), token_digest),
        "/v2/exploratory-replay/execution-input-bindings/resolve",
        Some(serde_json::to_value(&replay_request).expect("the Replay locator serializes")),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H8: the execution input binding reads back: {answer}"
    );
    assert_eq!(
        json_of(&answer),
        issued,
        "H8: the binding read back is the one issued"
    );
    let instrument_master_cut = instrument_master
        .resolve_instrument_master_v2_for_native_replay_request(&replay_request.request_identity)
        .await
        .unwrap_or_else(|e| panic!("H8: the Replay's Instrument Master cut resolves: {e:?}"))
        .locator();
    scheduling.revoke().await;

    FirstComposerV3ReplayV1 {
        deployment,
        research_request_identity,
        design_identity: serde_json::from_value(published["design_identity"].clone())
            .expect("H3: the role intent names its Design"),
        artifact_locator: composer_locator.artifact_locator.clone(),
        plan_canonical_digest: composer_locator.canonical_plan_digest,
        trial_family_identity: family.root().trial_family_identity().to_owned(),
        member_instrument: instrument.canonical.to_owned(),
        replay_request,
        composition_binding,
        execution_input_binding: OwnerRecordLocatorV1 {
            identity: issued["binding_identity"]
                .as_str()
                .expect("H8: the binding names its identity")
                .to_owned(),
            digest: issued["binding_digest"]
                .as_str()
                .expect("H8: the binding names its digest")
                .to_owned(),
        },
        instrument_master_cut,
        created,
    }
}

/// Moves Market Data's decision cut past `frame_ns` and returns the cut it then stands on.
///
/// A stand-in, named as one, for something production does not have yet. Market Data's clock
/// advances only when the Owner admits something: a Source Binding (`mint_clock_admission_v1`,
/// `crates/data/src/owner/postgres.rs`), or an Instrument Master V2 snapshot retrieved after the
/// head. It never advances because time passes or because a PIT intake runs, so nothing moves it
/// between a frame and the Quote its fill takes. While the cut still stands on the frame,
/// Operations admits the perpetual's four-hour klines, a feed the Binance Data Client serves
/// (`crates/adapters/binance/tests/market_data_end_to_end.rs`), and that admission is the clock
/// passing the frame. No snapshot is taken under it. A cut already past the frame is returned as
/// it is.
async fn advance_market_data_clock_past_v1(
    routes: &Router,
    frame_ns: u64,
) -> MarketDataDecisionCutV1 {
    let decision_cut = async || -> MarketDataDecisionCutV1 {
        let (status, answer) = post(
            routes,
            "/v1/market-data/pit-market-snapshot-requests/decision-cut",
            None,
        )
        .await;
        assert_eq!(
            status,
            StatusCode::OK,
            "H2c: Market Data's decision cut: {answer}"
        );
        serde_json::from_value(json_of(&answer)).expect("H2c: the decision cut decodes")
    };
    let cut = decision_cut().await;

    if cut.decision_cut.as_epoch_nanos() > frame_ns {
        return cut;
    }
    let (status, answer) = post(
        routes,
        "/v1/market-data/source-bindings",
        Some(
            serde_json::to_value(SourceBindingAdmissionRequestV1 {
                proposal: perpetual_source_proposal(frame_ns, PerpetualDatasetV1::FourHourKlines),
                rights: ProviderRightsEvidenceV1::Granted,
                reachability: ProviderReachabilityEvidenceV1::Reachable,
            })
            .expect("the binding admission serializes"),
        ),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "H2c: the four-hour klines Source Binding: {answer}"
    );
    decision_cut().await
}

/// Market Data's production routes, composed from the deployment as `main` composes them, with
/// `intake` behind the PIT snapshot routes.
async fn market_data_routes(
    intake: Option<Arc<dyn PitMarketSnapshotIntakeV1>>,
    token_digest: [u8; 32],
) -> Router {
    market_data_pit::router(
        market_data_pit::MarketDataAdmissions {
            intake,
            admission: bootstrap_market_data_source_binding_admission()
                .await
                .expect("the Source Binding admission composes"),
            universe: bootstrap_market_data_universe_selection()
                .await
                .expect("the Universe Selection admission composes"),
            bindings: bootstrap_market_data_strategy_input_bindings()
                .await
                .expect("the Strategy Input Binding admission composes"),
            instruments: bootstrap_market_data_instrument_master_admission()
                .await
                .expect("the Instrument Master admission composes"),
            instruments_v2: bootstrap_market_data_instrument_master_admission_v2()
                .await
                .expect("the Instrument Master V2 admission composes"),
            semantics: bootstrap_market_data_market_semantics_admission()
                .await
                .expect("the Market Semantics admission composes"),
            // Required, not optional: F's H0 issues the perpetual's terms through this route.
            economic_terms: Some(
                bootstrap_instrument_economic_terms_admission()
                    .await
                    .expect("the instrument economic terms admission composes")
                    .expect("the chain configures both Owners the terms admission needs"),
            ),
        },
        token_digest,
    )
}

/// The R&D Owner API's state for the routes this fixture drives, composed from the deployment the
/// fixture admitted. H8 adds the execution-input ports to a copy of it.
async fn owner_api_state(
    test_database: &CanonicalOwnerPostgresTestDatabaseV1,
    deployment: &ProductEdgeDeploymentAcceptanceFixtureV1,
    owner: Arc<PostgresResearchGoalOwnerV1>,
    token_digest: [u8; 32],
) -> ApiState {
    let rd_url = test_database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let develop_composer = Arc::new(
        SealedPostgresSourceResearchComposerV2::connect(
            rd_url,
            test_database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
        )
        .await
        .expect("the Composer opens"),
    );
    // No route this fixture drives builds an Artifact, so the sandbox socket is never dialled.
    let artifact_owner = Arc::new(
        PostgresArtifactBuildOwnerV1::connect(rd_url, SANDBOX_SOCKET_DEFAULT, 600_000)
            .await
            .expect("the Artifact Owner opens"),
    );
    ApiState {
        product_edge: Arc::new(
            deployment
                .connect_owner(
                    test_database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
                )
                .await
                .expect("the deployment's Product Edge Owner opens"),
        ),
        owner: owner.clone(),
        artifact_owner: artifact_owner.clone(),
        artifact_source_owner: artifact_owner.clone(),
        artifact_directory_owner: artifact_owner,
        research_directory_owner: owner.clone(),
        research_readback_owner: owner,
        historical_custody_owner: Arc::new(
            PostgresHistoricalCustodyOwnerV1::connect_read_only(rd_url)
                .await
                .expect("the historical custody Owner opens"),
        ),
        token_digest,
        request_proof_digest: deployment.request_proof_digest.clone(),
        allow_acceptance_faults: false,
        _market_data_research_pit: None,
        native_replay_scheduling: None,
        instrument_master_v2: None,
        instrument_economic_terms: None,
        universe_sample_projection: None,
        develop_composer_read: Some(develop_composer.clone()),
        develop_composer,
        replay_composition: Some(Arc::new(
            ReplayCompositionOwnerV1::connect(
                test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner),
                test_database.database_url(CanonicalOwnerTestRoleV1::MarketDataReader),
            )
            .await
            .expect("Market Data's replay composition Owner opens"),
        )),
    }
}

/// Each perpetual's increments are read from its real entry, canonically, the terms the Instrument
/// Master V2 fact derives from the same bytes: LINK's `0.001` tick and `0.01` step are `(1, 3)` and
/// `(1, 2)`; BTC's `0.10` tick and `0.001` step are `(1, 1)` and `(1, 3)`.
#[rstest::rstest]
#[case::link(LINKUSDT_PERPETUAL_V1, (1, 3), (1, 2))]
#[case::btc(BTCUSDT_PERPETUAL_V1, (1, 1), (1, 3))]
fn the_perpetual_increments_are_the_exchange_info_entry_s_own(
    #[case] instrument: PerpetualFixtureV1,
    #[case] tick: (i128, u8),
    #[case] step: (i128, u8),
) {
    let decimal = |(mantissa, scale)| InstrumentDecimalSubmissionV1 { mantissa, scale };
    assert_eq!(
        exchange_info_filter_decimal(instrument, "PRICE_FILTER", "tickSize"),
        decimal(tick)
    );
    assert_eq!(
        exchange_info_filter_decimal(instrument, "LOT_SIZE", "stepSize"),
        decimal(step)
    );
}

/// Every price a stand-in answers sits on its perpetual's tick grid, in canonical form, so the run
/// fails, if it does, on what the product does with a real price and not on a malformed fixture.
#[rstest::rstest]
#[case::link(LINKUSDT_PERPETUAL_V1)]
#[case::btc(BTCUSDT_PERPETUAL_V1)]
fn the_stand_in_prices_are_on_the_perpetual_s_tick_grid(#[case] instrument: PerpetualFixtureV1) {
    let tick = exchange_info_filter_decimal(instrument, "PRICE_FILTER", "tickSize");
    let [open, high, low, close, _volume] = instrument.bar;
    let [bid, ask] = instrument.quote;

    // Each price in ticks: `mantissa * 10^(tick scale - scale) / tick mantissa`, exact.
    let in_ticks = |(mantissa, scale): (i128, u8)| {
        assert!(
            mantissa % 10 != 0,
            "canonical: no trailing zero at scale {scale}"
        );
        assert!(scale <= tick.scale, "no finer than the tick");
        let at_tick_scale = mantissa * 10_i128.pow(u32::from(tick.scale - scale));
        assert_eq!(at_tick_scale % tick.mantissa, 0, "on the tick grid");
        at_tick_scale / tick.mantissa
    };
    let [open, high, low, close] = [open, high, low, close].map(in_ticks);
    let [bid, ask] = [bid, ask].map(in_ticks);

    assert!(low <= open && open <= high && low <= close && close <= high);
    assert!(
        ask <= close,
        "the Host's limit at the close crosses the ask, so the entry fills"
    );
    assert!(bid < ask, "the bid is under the ask");
}
