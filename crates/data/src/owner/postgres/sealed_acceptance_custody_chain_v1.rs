//! The sealed acceptance custody chain (slice T0-5d), committed on the Owner store through the
//! production intakes; `pit_window_custody_v1::sealed_acceptance_chain` states what it commits.
//!
//! Every write goes through an intake's own entry over this store's pool - the Source Binding,
//! Instrument Master V1 and Universe Selection admissions and the custody intake - exactly as each
//! environment entry opens it over the configured store. This module builds their submissions and
//! reads back what they committed; it inserts no row and calls no constructor an intake would not.

use sha2::{Digest as _, Sha256};

use super::{
    InstrumentMasterAdmissionPostgresV1, MarketDataOwnerPostgres, SourceBindingAdmissionPostgresV1,
    UniverseSelectionAdmissionPostgresV1,
    pit_window_custody_v1::{
        load_chain_evidence_v1, resolve_pit_window_frames_in_transaction_v1,
        verify_chain_evidence_v1,
    },
    universe_selection::recover_universe_selection_in_transaction_v1,
};
use crate::owner::{
    instrument_master_admission_v1::{
        InstrumentDecimalSubmissionV1, InstrumentMasterAdmissionV1,
        InstrumentMasterFactSubmissionV1, InstrumentVenueSourceMappingSubmissionV1,
    },
    market_semantics_admission_v1::MarketSemanticsValueSubmissionV1,
    pit_window_custody_v1::{
        CrossSectionVersionKindV1, PitWindowFrameCoordinateV1, UntrustedCrossSectionVersionV1,
        UntrustedCustodyRowV1, UntrustedPitWindowCustodyClaimV1,
        UntrustedPitWindowCustodyRequestV1, UntrustedPitWindowRunV1,
        sealed_acceptance_chain::{
            SealedAcceptanceCustodyChainErrorV1 as Error, SealedAcceptanceCustodyChainSpecV1,
            SealedAcceptanceCustodyChainV1, SealedAcceptanceDecimalV1,
            SealedAcceptanceInstrumentIncrementsV1, SealedAcceptanceTimeframeV1,
        },
    },
    research_instrument_scope_v1::ResearchInstrumentScopeV1,
    source_binding::{
        BindingDigest, MarketDataClockAdmission, UntrustedAdapterBinding,
        UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
        UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
        UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle,
        UntrustedSourceAvailabilityRuleV1, UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1,
        UntrustedSourceBarClockV1, UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1,
        UntrustedSourceBarTimeframeV1, UntrustedSourceBarUnitV1, UntrustedSourceBindingLocator,
        UntrustedSourceBindingProposal, UntrustedSourceVisibilityV1, UntrustedTrustPolicy,
    },
    source_binding_admission_v1::{
        ProviderReachabilityEvidenceV1, ProviderRightsEvidenceV1,
        SourceBindingAdmissionDispositionV1, SourceBindingAdmissionRequestV1,
        SourceBindingAdmissionV1,
    },
    universe_selection::{
        UntrustedUniverseSelectionLocatorV1, UntrustedUniverseSelectionRequestV1,
    },
    universe_selection_admission_v1::{
        HistoricalMembershipAdmissionRequestV1, HistoricalMembershipSubmissionV1,
        UniverseSelectionAdmissionV1,
    },
};

/// Every identity the fixture names itself is a digest under this domain, so none can collide
/// with another writer's.
const FIXTURE_DOMAIN: &[u8] = b"market-data.sealed-acceptance.custody-chain.v1\0";
const NANOS_PER_SECOND: u64 = 1_000_000_000;
/// The venue and source a fixture member's Instrument Master fact maps it under.
const FIXTURE_VENUE: &str = "SEALED-ACCEPTANCE";
const FIXTURE_SOURCE: &str = "SYNTHETIC";
const FIXTURE_CALENDAR: &str = "CRYPTO-CONTINUOUS-V1";
const FIXTURE_QUOTE_CURRENCY: &str = "USDT";
const FIXTURE_ROUTE: &str = "sealed-acceptance/synthetic";
/// The requester role the fixture's Universe Selection request states: Market Data's own, never
/// a Research role.
const FIXTURE_REQUESTER_ROLE: &str = "MARKET_DATA_SEALED_ACCEPTANCE_V1";
const BAR_FIELDS: [&str; 5] = ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"];

fn fixture_digest(parts: &[&[u8]]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(FIXTURE_DOMAIN);

    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

/// One timeframe of the spec, stated as the binding declares it and as the custody holds it.
struct PlannedTimeframeV1<'a> {
    spec: &'a SealedAcceptanceTimeframeV1,
    interval_ns: u64,
    declaration: UntrustedSourceBarTimeframeV1,
}

impl<'a> PlannedTimeframeV1<'a> {
    fn of(spec: &'a SealedAcceptanceTimeframeV1) -> Result<Self, Error> {
        let seconds = spec.interval_seconds;
        let (step, unit) = if seconds.is_multiple_of(3_600) {
            (seconds / 3_600, UntrustedSourceBarUnitV1::Hour)
        } else if seconds.is_multiple_of(60) {
            (seconds / 60, UntrustedSourceBarUnitV1::Minute)
        } else {
            (seconds, UntrustedSourceBarUnitV1::Second)
        };
        Ok(Self {
            spec,
            interval_ns: seconds
                .checked_mul(NANOS_PER_SECOND)
                .filter(|interval| *interval > 0)
                .ok_or(Error::InvalidSpec)?,
            declaration: UntrustedSourceBarTimeframeV1 {
                row_timeframe: spec.label.clone(),
                cadence: UntrustedSourceBarCadenceV1::FixedInterval {
                    step: u32::try_from(step).map_err(|_| Error::InvalidSpec)?,
                    unit,
                },
                anchor: UntrustedSourceBarAnchorV1::UnixEpoch,
                clock: UntrustedSourceBarClockV1::Continuous,
                label: UntrustedSourceBarLabelV1::IntervalClose,
                completion: UntrustedSourceBarCompletionV1::CompleteOnly,
            },
        })
    }

    /// The bar's close: the instant its declaration labels it by.
    fn close_of(&self, open_ns: u64) -> Result<u64, Error> {
        open_ns
            .checked_add(self.interval_ns)
            .ok_or(Error::InvalidSpec)
    }

    /// One original cross-section per bar, each row retrieved at its bar's availability.
    fn originals(
        &self,
        members: &[String],
        lag_ns: u64,
    ) -> Result<Vec<UntrustedCrossSectionVersionV1>, Error> {
        self.spec
            .bars
            .iter()
            .map(|bar| {
                if bar.members.len() != members.len() {
                    return Err(Error::InvalidSpec);
                }
                let close = self.close_of(bar.open_ns)?;
                let retrieval_ns = close.checked_add(lag_ns).ok_or(Error::InvalidSpec)?;
                let rows = members
                    .iter()
                    .zip(&bar.members)
                    .flat_map(|(member, values)| {
                        [
                            values.open,
                            values.high,
                            values.low,
                            values.close,
                            values.volume,
                        ]
                        .into_iter()
                        .zip(BAR_FIELDS)
                        .map(move |(value, field)| UntrustedCustodyRowV1 {
                            instrument: member.clone(),
                            field: field.to_owned(),
                            value_mantissa: value.mantissa,
                            value_scale: value.scale,
                            retrieval_ns,
                            retrieval_route: FIXTURE_ROUTE.to_owned(),
                        })
                    })
                    .collect();
                Ok(UntrustedCrossSectionVersionV1 {
                    timeframe: self.spec.label.clone(),
                    event_effective_ns: close,
                    kind: CrossSectionVersionKindV1::Original,
                    correction_sequence: 1,
                    predecessor_version: None,
                    publication_ns: None,
                    rows,
                })
            })
            .collect()
    }
}

/// Everything the spec states that no intake has answered yet.
struct ChainPlanV1<'a> {
    spec: &'a SealedAcceptanceCustodyChainSpecV1,
    execution: PlannedTimeframeV1<'a>,
    fill: PlannedTimeframeV1<'a>,
    /// `[first execution open, last execution close + one execution interval)`.
    window: (u64, u64),
    /// The eligible-instrument frontier of exactly the spec's members.
    frontier: BindingDigest,
}

impl<'a> ChainPlanV1<'a> {
    fn of(spec: &'a SealedAcceptanceCustodyChainSpecV1) -> Result<Self, Error> {
        let execution = PlannedTimeframeV1::of(&spec.execution_timeframe)?;
        let fill = PlannedTimeframeV1::of(&spec.fill_timeframe)?;
        let opens = spec.execution_timeframe.bars.iter().map(|bar| bar.open_ns);
        let start = opens.clone().min().ok_or(Error::InvalidSpec)?;
        let last_close = execution.close_of(opens.max().ok_or(Error::InvalidSpec)?)?;
        let end = last_close
            .checked_add(execution.interval_ns)
            .ok_or(Error::InvalidSpec)?;
        let mut parts = vec![b"eligible-instrument-frontier".as_slice()];
        parts.extend(spec.members.iter().map(String::as_bytes));
        let frontier = fixture_digest(&parts);
        Ok(Self {
            spec,
            execution,
            fill,
            window: (start, end),
            frontier,
        })
    }

    fn digest(&self, label: &str) -> BindingDigest {
        fixture_digest(&[label.as_bytes()])
    }

    /// A synthetic schema 2 binding: its adapter, semantics and license named for the fixture, its
    /// rule the spec's lag after bar close with no corrections, and its two timeframes declared.
    fn source_proposal(&self) -> UntrustedSourceBindingProposal {
        let named = |field: &str| format!("sealed-acceptance-custody-chain-v1/{field}");
        let mut bar_timeframes = vec![
            self.execution.declaration.clone(),
            self.fill.declaration.clone(),
        ];
        bar_timeframes.sort_by(|left, right| left.row_timeframe.cmp(&right.row_timeframe));
        UntrustedSourceBindingProposal {
            schema_version: 2,
            availability_rule: Some(UntrustedSourceAvailabilityRuleV1 {
                visibility: UntrustedSourceVisibilityV1::AfterBarClose {
                    lag_ns: self.spec.lag_ns,
                },
                publishes_corrections: false,
            }),
            bar_timeframes,
            claimed_binding_id: BindingDigest::from_untrusted_bytes([0; 32]),
            adapter: UntrustedAdapterBinding {
                implementation_digest: self.digest("adapter.implementation"),
                configuration_digest: self.digest("adapter.configuration"),
                authenticated_endpoint_identity:
                    "https://sealed-acceptance.invalid/custody-chain-v1".into(),
                dataset_mapping: named("klines"),
                account_mapping: named("no-account"),
            },
            credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
                self.digest("credential-handle"),
                UntrustedCredentialAudienceClaim::MarketData,
                [
                    UntrustedCredentialCapabilityClaim::MarketDataRead,
                    UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                    UntrustedCredentialCapabilityClaim::MetadataRead,
                ],
            ),
            trust_policy: UntrustedTrustPolicy {
                identity: named("trust-policy"),
                version: 1,
            },
            semantics: UntrustedMarketSemantics {
                normalization: named("normalization"),
                adjustment: named("raw"),
                price_meaning: named("quote-currency-per-base"),
                calendar_rules: named("continuous-calendar"),
                session_rules: named("continuous-session"),
                timezone_rules: named("etc-utc"),
                instrument_lifecycle_rules: named("instrument-lifecycle"),
                corporate_action_rules: named("no-corporate-actions"),
                membership_rules: named("fixed-membership"),
                universe_rules: named("fixed-member-selection"),
                correction_policy: named("no-corrections"),
            },
            license: UntrustedLicensePolicy {
                use_scope: named("acceptance-only"),
                redistribution_scope: named("none"),
                retention_policy: named("disposable-database"),
                redaction_policy: named("synthetic-payload"),
            },
            source_frontier: UntrustedCompleteFrontier {
                stream_identity: named("source-stream"),
                cut_identity: named("source-cut-1"),
                sequence: 1,
                digest: self.digest("source-frontier"),
            },
            correction_frontier: UntrustedCompleteFrontier {
                stream_identity: named("correction-stream"),
                cut_identity: named("correction-cut-1"),
                sequence: 1,
                digest: self.digest("correction-frontier"),
            },
            // The admission stamps the clock coordinates and observation; these four instants
            // are the submitter's.
            time_evidence: UntrustedMarketDataAsOf {
                claimed_evidence_identity: BindingDigest::from_untrusted_bytes([0; 32]),
                clock_identity: String::new(),
                clock_epoch: String::new(),
                monotonic_sequence: 0,
                restart_continuity_digest: BindingDigest::from_untrusted_bytes([0; 32]),
                skew_bound: 0,
                uncertainty_bound: 0,
                event_effective: 10,
                provider_available: 20,
                retrieval: 30,
                correction_publication: 25,
                observed_at: 0,
                effective_at: 0,
                valid_through: 0,
            },
        }
    }

    /// The member's Instrument Master V1 fact: a continuous crypto perpetual in force from instant
    /// 1, naming the members' full-set frontier.
    fn instrument_submission(
        &self,
        member: &str,
        binding: &UntrustedSourceBindingLocator,
    ) -> InstrumentMasterFactSubmissionV1 {
        let increments = self
            .spec
            .instrument_increments
            .unwrap_or(SealedAcceptanceInstrumentIncrementsV1::DEFAULT);
        let decimal = |value: SealedAcceptanceDecimalV1| InstrumentDecimalSubmissionV1 {
            mantissa: value.mantissa,
            scale: value.scale,
        };
        InstrumentMasterFactSubmissionV1 {
            canonical_identity: member.to_owned(),
            predecessor_fact_digest: None,
            mappings: vec![InstrumentVenueSourceMappingSubmissionV1 {
                venue_identity: FIXTURE_VENUE.to_owned(),
                source_identity: FIXTURE_SOURCE.to_owned(),
                source_instrument: member.as_bytes().to_vec(),
            }],
            instrument_class: "CRYPTO_PERPETUAL".to_owned(),
            base_currency: None,
            quote_currency: Some(FIXTURE_QUOTE_CURRENCY.to_owned()),
            settlement_currency: Some(FIXTURE_QUOTE_CURRENCY.to_owned()),
            margin_currency: Some(FIXTURE_QUOTE_CURRENCY.to_owned()),
            price_increment: decimal(increments.price),
            quantity_increment: decimal(increments.quantity),
            contract_multiplier: InstrumentDecimalSubmissionV1 {
                mantissa: 1,
                scale: 0,
            },
            calendar_identity: FIXTURE_CALENDAR.to_owned(),
            session_identity: FIXTURE_CALENDAR.to_owned(),
            time_zone_identity: "Etc/UTC".to_owned(),
            lifecycle_frontier: self.digest("lifecycle-frontier"),
            corporate_action_frontier: self.digest("corporate-action-frontier"),
            historical_membership_frontier: self.frontier,
            source_binding: binding.clone(),
            effective_from: 1,
            effective_until: None,
            provider_available: 5,
            retrieval: 6,
            correction_publication: 7,
            owner_observation: 8,
        }
    }

    /// Every member included from instant 1 with no end, observed at the Owner's head.
    fn membership(
        &self,
        head: &MarketDataClockAdmission,
        binding: &UntrustedSourceBindingLocator,
    ) -> HistoricalMembershipAdmissionRequestV1 {
        let at = i128::from(head.decision_cut);
        HistoricalMembershipAdmissionRequestV1 {
            eligible_instrument_frontier: self.frontier,
            members: self
                .spec
                .members
                .iter()
                .map(|member| HistoricalMembershipSubmissionV1 {
                    member_key: member.clone(),
                    instrument: member.clone(),
                    effective_from_ns: 1,
                    effective_until_ns: None,
                    provider_available_ns: at - 20,
                    retrieval_ns: at - 10,
                    correction_publication_ns: at - 15,
                    owner_observation_ns: at,
                    decision_cut: head.decision_cut,
                    source_binding_lineage_root: binding.lineage_root,
                    correction_frontier_digest: binding.correction_frontier.digest,
                })
                .collect(),
        }
    }

    /// The fixed-member selection of exactly the spec's members, evaluated at the Owner's head.
    fn universe_request(
        &self,
        head: &MarketDataClockAdmission,
        binding: &UntrustedSourceBindingLocator,
    ) -> Result<UntrustedUniverseSelectionRequestV1, Error> {
        let scope = ResearchInstrumentScopeV1::from_identities(self.spec.members.clone())
            .map_err(|_| Error::InvalidSpec)?;
        let at = i128::from(head.decision_cut);
        Ok(UntrustedUniverseSelectionRequestV1::new(
            fixture_digest(&[b"universe-request", self.frontier.as_bytes()]),
            FIXTURE_REQUESTER_ROLE,
            scope.identity(),
            scope.fixed_member_selection_rule_bytes(),
            self.frontier,
            at,
            at,
            head.decision_cut,
            binding.lineage_root,
            binding.correction_frontier.digest,
            fixture_digest(&[b"universe-correlation", self.frontier.as_bytes()]),
        ))
    }

    /// One root custody: every bar of both timeframes as an original, in canonical order.
    fn custody_request(
        &self,
        binding: &UntrustedSourceBindingLocator,
        market_semantics_identity: BindingDigest,
        universe: UntrustedUniverseSelectionLocatorV1,
    ) -> Result<UntrustedPitWindowCustodyRequestV1, Error> {
        let members = &self.spec.members;
        let mut cross_sections = self.execution.originals(members, self.spec.lag_ns)?;
        cross_sections.extend(self.fill.originals(members, self.spec.lag_ns)?);
        cross_sections.sort_by(|left, right| {
            (left.timeframe.as_str(), left.event_effective_ns)
                .cmp(&(right.timeframe.as_str(), right.event_effective_ns))
        });
        Ok(UntrustedPitWindowCustodyRequestV1 {
            source_binding: binding.clone(),
            market_semantics_identity,
            market_semantics_value: self.spec.market_semantics_value.clone().unwrap_or_else(|| {
                MarketSemanticsValueSubmissionV1 {
                    normalization_identity: self.digest("market-semantics.normalization"),
                    price_adjustment: "RAW".to_owned(),
                    timestamp_basis: "INTERVAL_CLOSE".to_owned(),
                    price_unit_identity: self.digest("market-semantics.price-unit"),
                    size_unit_identity: self.digest("market-semantics.size-unit"),
                }
            }),
            universe_selection: universe,
            members: members.clone(),
            window_start_ns: self.window.0,
            window_end_ns_exclusive: self.window.1,
            execution_timeframe: self.spec.execution_timeframe.label.clone(),
            input_timeframes: vec![self.spec.execution_timeframe.label.clone()],
            fill_timeframe: Some(self.spec.fill_timeframe.label.clone()),
            predecessor: None,
            cross_sections,
        })
    }
}

/// Commits `spec` on the store at `owner_url` and reads the chain back. The caller has checked
/// that `owner_url` is a disposable loopback `vibe_test_` database.
pub(in crate::owner) async fn commit_sealed_acceptance_custody_chain_in_store_v1(
    owner_url: &str,
    spec: &SealedAcceptanceCustodyChainSpecV1,
) -> Result<SealedAcceptanceCustodyChainV1, Error> {
    let plan = ChainPlanV1::of(spec)?;
    let owner = MarketDataOwnerPostgres::connect(owner_url)
        .await
        .map_err(|_| Error::StoreUnavailable)?;
    let owner_over_pool = || MarketDataOwnerPostgres {
        pool: owner.pool.clone(),
    };

    // 1. The Source Binding, which mints the Owner clock everything after is committed on.
    let binding = SourceBindingAdmissionPostgresV1 {
        owner: owner_over_pool(),
    }
    .admit(SourceBindingAdmissionRequestV1 {
        proposal: plan.source_proposal(),
        rights: ProviderRightsEvidenceV1::Granted,
        reachability: ProviderReachabilityEvidenceV1::Reachable,
    })
    .await
    .map_err(Error::SourceBindingAdmission)?;

    if binding.disposition() != SourceBindingAdmissionDispositionV1::Admitted {
        return Err(Error::SourceBindingNotAdmitted(binding.disposition()));
    }
    let locator = binding.locator();

    // 2. Each member's Instrument Master fact.
    let instruments = InstrumentMasterAdmissionPostgresV1 {
        owner: owner_over_pool(),
    };
    let mut instrument_fact_digests = Vec::with_capacity(spec.members.len());

    for member in &spec.members {
        let admitted =
            Box::pin(instruments.admit_fact(plan.instrument_submission(member, locator)))
                .await
                .map_err(Error::InstrumentMasterAdmission)?;
        instrument_fact_digests.push(admitted.fact_digest());
    }

    // 3. The members' historical membership, then their fixed-member selection, at the head.
    let head = owner
        .current_clock_admission_v1()
        .await
        .map_err(|_| Error::StoreUnavailable)?;
    let universe = UniverseSelectionAdmissionPostgresV1 {
        owner: owner_over_pool(),
    };
    universe
        .admit_membership(plan.membership(&head, locator))
        .await
        .map_err(Error::HistoricalMembershipAdmission)?;
    let selection = universe
        .evaluate(plan.universe_request(&head, locator)?)
        .await
        .map_err(Error::UniverseSelectionEvaluation)?;
    let universe_selection = UntrustedUniverseSelectionLocatorV1::from_untrusted(
        selection.request_identity(),
        selection.request_meaning_digest(),
    );
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|_| Error::StoreUnavailable)?;
    let record =
        recover_universe_selection_in_transaction_v1(&mut transaction, &universe_selection)
            .await
            .map_err(|e| Error::UniverseSelectionEvaluation(e.into()))?;
    transaction
        .rollback()
        .await
        .map_err(|_| Error::StoreUnavailable)?;

    if record.record().identity() != selection.selection_identity() {
        return Err(Error::StoreUnavailable);
    }

    // 4. The root custody.
    let receipt = Box::pin(
        owner
            .pit_window_custody_commit_v1()
            .commit_pit_window_custody_v1(plan.custody_request(
                locator,
                binding.market_semantics_identity(),
                universe_selection,
            )?),
    )
    .await
    .map_err(Error::CustodyCommit)?;

    // The chain as a run reads it: every frame of the window, the basis, and the root's record.
    let first_close = plan.execution.close_of(plan.window.0)?;
    let mut transaction = owner
        .pool
        .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await
        .map_err(|_| Error::StoreUnavailable)?;
    let frames = resolve_pit_window_frames_in_transaction_v1(
        &mut transaction,
        UntrustedPitWindowRunV1 {
            custody: UntrustedPitWindowCustodyClaimV1 {
                chain_root: receipt.chain_root(),
            },
            run_start_ns: first_close,
            run_end_ns_exclusive: plan.window.1,
        },
    )
    .await
    .map_err(Error::CustodyFramesRead)?;
    let evidence = load_chain_evidence_v1(&mut transaction, receipt.chain_root())
        .await
        .map_err(|_| Error::StoreUnavailable)?;
    transaction
        .rollback()
        .await
        .map_err(|_| Error::StoreUnavailable)?;
    let verified =
        verify_chain_evidence_v1(receipt.chain_root(), evidence, Some(frames.head_identity()))
            .map_err(|_| Error::StoreUnavailable)?;

    Ok(SealedAcceptanceCustodyChainV1 {
        chain_root: receipt.chain_root(),
        head_identity: frames.head_identity(),
        window: plan.window,
        source_binding: locator.clone(),
        source_binding_lineage_root: binding.lineage_root(),
        market_semantics_identity: binding.market_semantics_identity(),
        universe_selection,
        universe_selection_record_identity: record.record().identity(),
        universe_selection_record_digest: record.record().digest(),
        instrument_fact_digests,
        instrument_master_cut_digest: frames.basis().instrument_master_cut().digest(),
        instrument_master_key: verified.chain.root.instrument_master_key,
        frame_instants_ns: frames
            .frames()
            .iter()
            .map(PitWindowFrameCoordinateV1::event_ns)
            .collect(),
    })
}
