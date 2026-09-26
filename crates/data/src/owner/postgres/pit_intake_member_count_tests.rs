//! PIT intake admission by Universe Selection member count, proved on real PostgreSQL.

use std::sync::Arc;

use rstest::rstest;

use super::*;
use crate::owner::{
    instrument_master::InstrumentMasterResolver,
    instrument_master_admission_v1::{
        InstrumentDecimalSubmissionV1, InstrumentMasterFactSubmissionV1,
        InstrumentVenueSourceMappingSubmissionV1,
    },
    pit_observation_source_v1::{
        PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1,
        VendorObservationV1,
    },
    pit_snapshot::{
        PitSnapshotSubmissionV1, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    },
    source_binding::{
        UntrustedAdapterBinding, UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
        UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingProposal,
        UntrustedTrustPolicy,
        authority::{
            OwnerSourceBindingDecision, SourceBindingCommit, derive_binding_id,
            derive_market_semantics_compatibility_identity_v1, derive_time_evidence_identity,
        },
    },
    universe_selection::{
        UniverseSelectionReadbackV1, UntrustedUniverseSelectionLocatorV1,
        UntrustedUniverseSelectionRequestV1,
        authority::{
            CanonicalUniverseSelectionRuleEvaluatorV1, HistoricalMembershipFactProposalV1,
        },
    },
};

const CLOCK_IDENTITY: &str = "market-clock.identity.v1-0000001";
const CLOCK_EPOCH: &str = "market-clock.epoch.v1-0000000001";
const DECISION_CUT: u64 = 40;

pub(super) fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn clock() -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        CLOCK_IDENTITY,
        CLOCK_EPOCH,
        1,
        DECISION_CUT,
        DECISION_CUT,
        DECISION_CUT + 60,
        d(7),
        1,
        2,
    )
}

fn source_proposal() -> UntrustedSourceBindingProposal {
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: d(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: d(1),
            configuration_digest: d(2),
            authenticated_endpoint_identity: "https://market.example/v1".into(),
            dataset_mapping: "dataset/trades".into(),
            account_mapping: "tenant/entitlement".into(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            d(6),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "trust-policy".into(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "normalization-v1".into(),
            adjustment: "raw-v1".into(),
            price_meaning: "quote-currency-per-base-v1".into(),
            calendar_rules: "calendar-v1".into(),
            session_rules: "session-v1".into(),
            timezone_rules: "iana-2026a".into(),
            instrument_lifecycle_rules: "instrument-lifecycle-v1".into(),
            corporate_action_rules: "corporate-actions-v1".into(),
            membership_rules: "historical-membership-v1".into(),
            universe_rules: "requester-rule-evaluation-v1".into(),
            correction_policy: "successor-only-v1".into(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "acquire-cache-archive-backtest-model-display".into(),
            redistribution_scope: "derived-only".into(),
            retention_policy: "retain-30d-delete-v1".into(),
            redaction_policy: "no-licensed-payload-v1".into(),
        },
        source_frontier: UntrustedCompleteFrontier {
            stream_identity: "source-stream".into(),
            cut_identity: "source-cut-10".into(),
            sequence: 10,
            digest: d(3),
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: "correction-stream".into(),
            cut_identity: "correction-cut-11".into(),
            sequence: 11,
            digest: d(4),
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: d(0),
            clock_identity: CLOCK_IDENTITY.into(),
            clock_epoch: CLOCK_EPOCH.into(),
            monotonic_sequence: 1,
            restart_continuity_digest: d(7),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 10,
            provider_available: 20,
            retrieval: 30,
            correction_publication: 25,
            observed_at: DECISION_CUT,
            effective_at: DECISION_CUT,
            valid_through: DECISION_CUT + 60,
        },
    };
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    proposal
}

fn pit_time() -> UntrustedPitSnapshotTimeEvidence {
    UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(
            10,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            20,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(30, CLOCK_IDENTITY, CLOCK_EPOCH),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            25,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
            DECISION_CUT,
            CLOCK_IDENTITY,
            CLOCK_EPOCH,
        ),
        monotonic_sequence: 1,
        restart_continuity_digest: d(7),
        skew_bound: 2,
        uncertainty_bound: 1,
        observed_at: DECISION_CUT,
        valid_through: DECISION_CUT + 60,
    }
}

/// The Instrument Master fact Operations would admit for one member, open from instant 1.
///
/// `lifecycle_frontier` is the one coordinate a case varies: two members whose facts disagree on
/// it cannot share one Instrument Master request.
fn instrument_submission(
    identity: &str,
    source: &SourceBindingCommit,
    lifecycle_frontier: BindingDigest,
) -> InstrumentMasterFactSubmissionV1 {
    InstrumentMasterFactSubmissionV1 {
        canonical_identity: identity.into(),
        predecessor_fact_digest: None,
        mappings: vec![InstrumentVenueSourceMappingSubmissionV1 {
            venue_identity: "XNAS".into(),
            source_identity: "SIP".into(),
            source_instrument: identity.as_bytes().to_vec(),
        }],
        instrument_class: "EQUITY".into(),
        base_currency: Some("USD".into()),
        quote_currency: None,
        settlement_currency: Some("USD".into()),
        margin_currency: None,
        price_increment: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 2,
        },
        quantity_increment: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 0,
        },
        contract_multiplier: InstrumentDecimalSubmissionV1 {
            mantissa: 1,
            scale: 0,
        },
        calendar_identity: "XNYS-CALENDAR-V1".into(),
        session_identity: "XNYS-REGULAR-V1".into(),
        time_zone_identity: "Etc/UTC".into(),
        lifecycle_frontier,
        corporate_action_frontier: d(82),
        historical_membership_frontier: d(83),
        market_semantics_identity: derive_market_semantics_compatibility_identity_v1(
            &source.fact().proposal().semantics,
        ),
        source_frontier: source.fact().source_frontier().digest,
        correction_frontier: source.receipt().locator().correction_frontier.digest,
        effective_from: 1,
        effective_until: None,
        provider_available: 5,
        retrieval: 6,
        correction_publication: 7,
        owner_observation: 8,
    }
}

/// A Data Client that answers one CLOSE bar for every member Market Data scoped.
struct EveryMemberObservationSourceV1;

#[async_trait::async_trait]
impl PitObservationSourceV1 for EveryMemberObservationSourceV1 {
    async fn observe(
        &self,
        scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        Ok(scope
            .members()
            .iter()
            .map(|member| VendorObservationV1 {
                symbolic_key: format!("{member}.CLOSE.1M"),
                member_key: member.clone(),
                instrument: member.clone(),
                channel: "MARKET".into(),
                data_kind: "BAR".into(),
                timeframe: "1M".into(),
                field: "CLOSE".into(),
                value_mantissa: 12_345,
                value_scale: 2,
                event_effective: scope.event_effective(),
                provider_available: scope.provider_available(),
                retrieval: scope.retrieval(),
                correction_publication: scope.correction_publication(),
            })
            .collect())
    }
}

/// The fixture every case shares: one admitted Source Binding under the Owner's clock head.
pub(super) struct Fixture {
    pub(super) intake: MarketDataPitIntakePostgresV1,
    pub(super) source: SourceBindingCommit,
}

impl Fixture {
    pub(super) async fn install() -> Self {
        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL")
            .expect("explicit disposable Owner URL");
        let database =
            std::env::var("VIBE_POSTGRES_TEST_DATABASE_NAME").expect("disposable database name");
        assert!(
            database.starts_with("vibe_test_"),
            "this proof writes; it runs only against a disposable database"
        );
        let owner = MarketDataOwnerPostgres::connect(&owner_url)
            .await
            .expect("Owner connects and migrates");
        let source = owner
            .commit_source_initial(
                source_proposal(),
                OwnerSourceBindingDecision {
                    blockers: std::collections::BTreeSet::new(),
                },
                &clock(),
            )
            .await
            .unwrap();
        Self {
            intake: MarketDataPitIntakePostgresV1 {
                owner,
                observations: Arc::new(EveryMemberObservationSourceV1),
            },
            source,
        }
    }

    pub(super) fn owner(&self) -> &MarketDataOwnerPostgres {
        &self.intake.owner
    }

    pub(super) async fn admit_instrument(&self, identity: &str, lifecycle_frontier: BindingDigest) {
        self.owner()
            .admit_instrument_master_fact_v1(instrument_submission(
                identity,
                &self.source,
                lifecycle_frontier,
            ))
            .await
            .unwrap();
    }

    /// Evaluates one Universe Selection Record over `members` (member key, instrument).
    ///
    /// `frontier` names the membership frontier and seeds the request, so every case gets a record
    /// of its own. A membership fact's identity does not bind its frontier, so the same member in
    /// two frontiers needs two facts: `frontier` also sets when each member's membership began,
    /// always before the request's event instant. `rule` is the canonical evaluator's rule:
    /// `[0, 1, 1]` includes everyone.
    pub(super) async fn universe(
        &self,
        frontier: u8,
        rule: &[u8],
        members: &[(&str, &str)],
    ) -> (
        UniverseSelectionReadbackV1,
        UntrustedUniverseSelectionLocatorV1,
    ) {
        let lineage_root = self.source.fact().lineage_root();
        let correction_digest = self.source.receipt().locator().correction_frontier.digest;
        let request = UntrustedUniverseSelectionRequestV1::new(
            d(frontier.wrapping_add(1)),
            "RESEARCH_OWNER_V1",
            d(202),
            rule.to_vec(),
            d(frontier),
            10,
            39,
            DECISION_CUT,
            lineage_root,
            correction_digest,
            d(203),
        );
        let mut transaction = self.owner().pool().begin().await.unwrap();
        super::universe_selection::persist_historical_membership_frontier_v1(
            &mut transaction,
            d(frontier),
            members
                .iter()
                .map(
                    |(member_key, instrument)| HistoricalMembershipFactProposalV1 {
                        member_key: member_key.as_bytes().to_vec(),
                        instrument: instrument.as_bytes().to_vec(),
                        predecessor_identity: None,
                        effective_from_ns: i128::from(frontier / 10 - 9),
                        effective_until_ns: None,
                        provider_available_ns: 20,
                        retrieval_ns: 30,
                        correction_publication_ns: 25,
                        owner_observation_ns: 39,
                        decision_cut: DECISION_CUT,
                        source_binding_lineage_root: lineage_root,
                        correction_frontier_digest: correction_digest,
                    },
                )
                .collect(),
        )
        .await
        .unwrap();
        let readback = super::universe_selection::resolve_universe_selection_in_transaction_v1(
            &mut transaction,
            &request,
            Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();
        let locator = UntrustedUniverseSelectionLocatorV1::from_untrusted(
            request.request_identity(),
            request.request_meaning_digest(),
        );
        (readback, locator)
    }

    /// A frozen request that names `universe` and nothing else the Owner would have to trust.
    pub(super) fn request(
        &self,
        correlation: u8,
        universe: &UniverseSelectionReadbackV1,
    ) -> PitSnapshotSubmissionV1 {
        PitSnapshotSubmissionV1 {
            correlation_identity: d(correlation),
            requester_identity: d(204),
            scope_digest: d(205),
            source_binding: self.source.receipt().locator().clone(),
            universe_selection_digest: universe.record().identity(),
            market_semantics_identity: derive_market_semantics_compatibility_identity_v1(
                &self.source.fact().proposal().semantics,
            ),
            time_evidence: pit_time(),
        }
    }

    /// The Instrument Master request identity and meaning of the most recent resolution.
    async fn latest_instrument_master_request(&self) -> (BindingDigest, BindingDigest) {
        let row = sqlx::query(
            "SELECT request_identity, request_meaning_digest FROM market_data_private.instrument_master_receipts_v1 ORDER BY append_sequence DESC LIMIT 1",
        )
        .fetch_one(self.owner().pool())
        .await
        .unwrap();
        let digest = |column: &str| {
            let bytes: Vec<u8> = row.try_get(column).unwrap();
            BindingDigest::from_untrusted_bytes(bytes.try_into().unwrap())
        };
        (digest("request_identity"), digest("request_meaning_digest"))
    }

    /// The fact the Owner holds for `identity`; the submission is a replay, so it writes nothing.
    async fn instrument_fact(
        &self,
        identity: &str,
        lifecycle_frontier: BindingDigest,
    ) -> InstrumentMasterFactV1 {
        let locator = self.owner().current_clock_head_locator_v1().await.unwrap();
        self.owner()
            .append_instrument_master_fact(
                instrument_submission(identity, &self.source, lifecycle_frontier)
                    .into_proposal()
                    .unwrap(),
                &locator,
            )
            .await
            .unwrap()
    }

    /// Every row of every Owner table, as a count and a content digest per table.
    ///
    /// A refusal must leave this unchanged. The digest covers content, not only the count, so an
    /// update in place - the Instrument Master append sequence, say - would show here too.
    pub(super) async fn store(&self) -> Vec<(String, i64, String)> {
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT tablename::text FROM pg_catalog.pg_tables WHERE schemaname='market_data_private' ORDER BY 1",
        )
        .fetch_all(self.owner().pool())
        .await
        .unwrap();
        let mut store = Vec::with_capacity(tables.len());
        for table in tables {
            // The name comes from the catalog, never from a caller, and is quoted as an identifier.
            let quoted = table.replace('"', "\"\"");
            let row = sqlx::query(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*)::bigint AS rows, COALESCE(md5(string_agg(t::text, ',' ORDER BY t::text)), '') AS content FROM market_data_private.\"{quoted}\" t"
            )))
            .fetch_one(self.owner().pool())
            .await
            .unwrap();
            store.push((table, row.get("rows"), row.get("content")));
        }
        store
    }
}

/// SHA-256 of the Instrument Master request-identity preimage, as the Owner computes it.
fn request_identity(correlation: u8, selection: BindingDigest, members: &[&str]) -> BindingDigest {
    let members = members
        .iter()
        .map(|member| (*member).to_owned())
        .collect::<Vec<_>>();
    BindingDigest::from_untrusted_bytes(
        Sha256::digest(
            pit_instrument_master_identity_preimage_v1(
                d(correlation),
                selection,
                &members,
                10,
                DECISION_CUT,
            )
            .unwrap(),
        )
        .into(),
    )
}

fn digest_hex(hex: &str) -> BindingDigest {
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&hex[at..at + 2], 16).unwrap())
        .collect::<Vec<_>>();
    BindingDigest::from_untrusted_bytes(bytes.try_into().unwrap())
}

/// The one-member Instrument Master request as it was before two members were admitted.
///
/// Both values were read from a real PostgreSQL resolution on the tree that admitted exactly one
/// member (066de2d3f), twice, in two fresh databases; they must not move.
const ONE_MEMBER_REQUEST_IDENTITY: &str =
    "0e4025c78f79d118b79278d0f0c8816777ee3fc43ad09a84d2861012b52ab4c2";
const ONE_MEMBER_REQUEST_MEANING: &str =
    "8ec7fb868f94bf9a034669b9d2a52d9b485718a4c78e1fe72bfcee4a540d36c8";

/// The one-member preimage keeps its original bytes and domain.
#[rstest]
fn one_member_request_identity_is_the_one_it_always_was() {
    let preimage = pit_instrument_master_identity_preimage_v1(
        d(213),
        d(0x5e),
        &["AAPL".to_owned()],
        10,
        DECISION_CUT,
    )
    .unwrap();
    assert_eq!(
        preimage,
        [
            b"vibe.market-data.instrument-master-pit-request.v1\0".as_slice(),
            &[213; 32],
            b"AAPL",
            &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10],
            &[0, 0, 0, 0, 0, 0, 0, 40],
        ]
        .concat(),
        "one member binds no selection record and no count"
    );
    assert_eq!(
        request_identity(213, d(0x5e), &["AAPL"]),
        digest_hex(ONE_MEMBER_REQUEST_IDENTITY)
    );
}

/// The two-member preimage, byte for byte, under its own domain.
#[rstest]
fn two_member_request_identity_binds_the_record_the_count_and_every_member() {
    let preimage = pit_instrument_master_identity_preimage_v1(
        d(214),
        d(0x5e),
        &["AAPL".to_owned(), "MSFT".to_owned()],
        10,
        DECISION_CUT,
    )
    .unwrap();
    assert_eq!(
        preimage,
        [
            b"vibe.market-data.instrument-master-pit-request.members.v1\0".as_slice(),
            &[214; 32],
            &[0x5e; 32],
            &[0, 0, 0, 0, 0, 0, 0, 2],
            &[0, 4],
            b"AAPL",
            &[0, 4],
            b"MSFT",
            &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10],
            &[0, 0, 0, 0, 0, 0, 0, 40],
        ]
        .concat()
    );
    assert_eq!(
        request_identity(214, d(0x5e), &["AAPL", "MSFT"]),
        digest_hex(TWO_MEMBER_REQUEST_IDENTITY)
    );
}

/// SHA-256 of the preimage above, computed independently of this crate.
const TWO_MEMBER_REQUEST_IDENTITY: &str =
    "389e0cce893bfcf303c0cec77b02665b2a08b3e3410ca9fc8accbdae519d9142";

async fn scenario() {
    let fixture = Fixture::install().await;
    for identity in ["AAPL", "GOOG", "MSFT"] {
        fixture.admit_instrument(identity, d(81)).await;
    }
    // TSLA's fact states a lifecycle frontier no other member's fact does.
    fixture.admit_instrument("TSLA", d(91)).await;
    let every_member = [0, 1, 1];

    // One member: the same Instrument Master request, to the byte, as before.
    let (universe, locator) = fixture
        .universe(100, &every_member, &[("AAPL", "AAPL")])
        .await;
    let before = fixture.store().await;
    let one = fixture
        .intake
        .submit(fixture.request(213, &universe), locator)
        .await
        .unwrap();
    assert_eq!(one.disposition(), PitMarketSnapshotDispositionV1::Available);
    assert_eq!(
        fixture.latest_instrument_master_request().await,
        (
            digest_hex(ONE_MEMBER_REQUEST_IDENTITY),
            digest_hex(ONE_MEMBER_REQUEST_MEANING)
        ),
        "one member resolves exactly the Instrument Master request it always did"
    );
    assert_ne!(
        fixture.store().await,
        before,
        "an admitted request writes, so the zero-write measure below can see a write"
    );

    // Two members: the record itself is resolved, and its cut holds both, in canonical order.
    let (universe, locator) = fixture
        .universe(110, &every_member, &[("MSFT", "MSFT"), ("AAPL", "AAPL")])
        .await;
    let two = fixture
        .intake
        .submit(fixture.request(214, &universe), locator)
        .await
        .unwrap();
    assert_eq!(two.disposition(), PitMarketSnapshotDispositionV1::Available);
    let (identity, meaning) = fixture.latest_instrument_master_request().await;
    assert_eq!(
        identity,
        request_identity(214, universe.record().identity(), &["AAPL", "MSFT"])
    );
    let readback = fixture
        .owner()
        .recover_instrument_master(identity, meaning)
        .await
        .unwrap();
    assert_eq!(readback.digest(), two.instrument_master_digest());
    assert_eq!(readback.cut().expected_members(), ["AAPL", "MSFT"]);

    // Every refusal below is decided before Market Data writes anything at all.
    let refuses = async |frontier: u8,
                         rule: &[u8],
                         members: &[(&str, &str)],
                         correlation: u8,
                         expected: PitMarketSnapshotIntakeErrorV1,
                         why: &str| {
        let (universe, locator) = fixture.universe(frontier, rule, members).await;
        let before = fixture.store().await;
        assert_eq!(
            fixture
                .intake
                .submit(fixture.request(correlation, &universe), locator)
                .await
                .unwrap_err(),
            expected,
            "{why}"
        );
        assert_eq!(fixture.store().await, before, "{why}: nothing is written");
        universe
    };
    refuses(
        120,
        &every_member,
        &[("AAPL", "AAPL"), ("GOOG", "GOOG"), ("MSFT", "MSFT")],
        215,
        PitMarketSnapshotIntakeErrorV1::UniverseMemberCountUnadmitted,
        "three members are refused by name",
    )
    .await;
    refuses(
        130,
        &[0, 1, 2, b'Z'],
        &[("AAPL", "AAPL")],
        216,
        PitMarketSnapshotIntakeErrorV1::UniverseMemberCountUnadmitted,
        "a record that includes no member is refused by name",
    )
    .await;
    refuses(
        140,
        &every_member,
        &[("AAPL-KEY", "AAPL")],
        217,
        PitMarketSnapshotIntakeErrorV1::UniverseMemberKeyIsNotInstrument,
        "a member keyed by anything but its instrument is refused by name",
    )
    .await;
    let pair = refuses(
        150,
        &every_member,
        &[("AAPL", "AAPL"), ("TSLA", "TSLA")],
        218,
        PitMarketSnapshotIntakeErrorV1::InstrumentMasterUnavailable,
        "two members whose facts state different frontiers have no one Instrument Master cut",
    )
    .await;

    // That last refusal is the cut's frontier check, not a missing fact: TSLA resolves alone,
    // and the request the intake would state for the pair is refused as a frontier mismatch.
    let (alone, locator) = fixture
        .universe(160, &every_member, &[("TSLA", "TSLA")])
        .await;
    let tsla = fixture
        .intake
        .submit(fixture.request(219, &alone), locator)
        .await
        .unwrap();
    assert_eq!(
        tsla.disposition(),
        PitMarketSnapshotDispositionV1::Available
    );
    let facts = [
        fixture.instrument_fact("AAPL", d(81)).await,
        fixture.instrument_fact("TSLA", d(91)).await,
    ];
    let before = fixture.store().await;
    let pair_submission = fixture.request(218, &pair);
    let resolution = pit_instrument_master_request_v1(
        pair_submission.correlation_identity,
        &pair_submission.time_evidence,
        pair.record().identity(),
        &["AAPL".to_owned(), "TSLA".to_owned()],
        &facts,
        &clock(),
        fixture
            .owner()
            .current_clock_head_locator_v1()
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        fixture
            .owner()
            .resolve_instrument_master(&resolution, Some(&pair))
            .await
            .unwrap_err(),
        InstrumentMasterError::FrontierMismatch
    );
    assert_eq!(
        fixture.store().await,
        before,
        "a frontier mismatch writes nothing"
    );

    // A record the Owner cannot recover still scopes nothing, exactly as before.
    let unknown = UntrustedUniverseSelectionLocatorV1::from_untrusted(d(170), d(171));
    assert_eq!(
        fixture
            .intake
            .submit(fixture.request(220, &universe), unknown)
            .await
            .unwrap_err(),
        PitMarketSnapshotIntakeErrorV1::InstrumentMasterUnavailable
    );
}

/// The PIT intake admits a Universe Selection Record of one or two members and no other.
///
/// One member resolves the Instrument Master request it always did, pinned by the values read
/// before two were admitted. Two members resolve the record as one cut holding both. Zero or three
/// members, a member keyed by anything but its instrument, and two members whose facts state
/// different frontiers are each refused - the first three by name - with every Owner table
/// unchanged, content included. The first admitted request is the measure's positive control:
/// it shows the same measure does see a write.
#[rstest]
#[ignore = "requires the crates/data disposable PostgreSQL harness"]
fn pit_intake_admits_one_or_two_universe_members_and_refuses_the_rest_unwritten() {
    std::thread::Builder::new()
        .name("market-data-pit-intake-member-count".into())
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(scenario());
        })
        .unwrap()
        .join()
        .unwrap();
}
