//! Issuance of a universe-member composition binding and the Replay facts stored under it.
//!
//! It runs inside the same two transactions and challenges as the first corpus (see
//! `open_issuance_v1`), and resolves only what a universe-member aggregate is composed from: the
//! Reference Fact R0 record, Market Semantics, the Universe Selection, every role's universe-member
//! declaration, the Source Binding, the correction policy and the frame over the complete role set.
//! There is no native join, observation census, joined cut or sample projection, and no Instrument
//! Master: each member's facts are the request-keyed cut Market Data issues over the selection when
//! R&D first binds the sealed request for native execution.

use super::{
    UniverseMemberReplayFactsSourcesV2, canonical_issuance_command_bytes_v1, coordinates_from_r0,
    digest_registry, persist_universe_member_replay_market_facts_in_transaction_v2,
    record_issuance_v1, replayed_issuance_v1, universe_member_native_locators_v1,
};
use crate::owner::{
    correction_policy_projection::{CorrectionPolicyAuthenticatedInputsV1, project_first_v1},
    market_semantics::UntrustedMarketSemanticsLocatorV1,
    reference_fact_coordinates::r0::UntrustedReferenceFactR0LocatorV1,
    replay_market_facts_v2::{
        ReplayCompositionBindingErrorV1, ReplayCompositionDurableIssuanceResponseV1,
        ReplayCompositionIssuanceLocatorV1, ReplayCompositionLocatorOnlyIssuanceRequestV1,
        ReplayCompositionOwnerV1, ReplayCompositionUniverseBindingIssuanceRequestV1,
        ReplayMarketFactsShapeV2,
        composition::{
            ReplayCompositionRoleEvidenceV1, ReplayCompositionUniverseBindingEvidenceV1,
            issue_universe_member_composition_binding_v1,
        },
        postgres::persist_replay_composition_binding_in_transaction_v1,
    },
    strategy_design_role_set::StrategyDesignRoleSetReceiptV1,
    strategy_input_binding::{
        bind_strategy_input_universe_frame, request_matches_authenticated_role_v1,
    },
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

impl ReplayCompositionOwnerV1 {
    /// Resolves exact R&D and Market Data custody for a universe-member composition and atomically
    /// stores its schema 2 binding and the Replay facts under it.
    ///
    /// Every role of the authenticated Design must be declared over universe members; an
    /// exact-instrument declaration is refused by name rather than composed into this shape.
    ///
    /// # Errors
    ///
    /// `CompositionShapeMismatch` for an exact-instrument declaration, `UniverseFrameMismatch` when
    /// the role set derives no frame over the PIT batch, and otherwise the first corpus's refusals
    /// for an absent, conflicting or corrupt locator, role coordinate, dependency or custody row.
    pub async fn issue_universe_member_binding_v1(
        &self,
        command: &ReplayCompositionLocatorOnlyIssuanceRequestV1<
            ReplayCompositionUniverseBindingIssuanceRequestV1,
        >,
    ) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
        let request = command.composition();
        let issuance_locator = command.issuance_locator();
        let request_bytes = canonical_issuance_command_bytes_v1(command)?;
        let mut issuance = self
            .open_issuance_v1(
                issuance_locator,
                request.composer_locator(),
                ReplayMarketFactsShapeV2::UniverseMembers,
            )
            .await?;
        let outcome = Box::pin(issue_universe_members_in_transaction_v1(
            &mut issuance.transaction,
            issuance.role_set.receipt(),
            request,
            issuance_locator,
            &request_bytes,
        ))
        .await;
        self.close_issuance_v1(issuance, issuance_locator, outcome)
            .await
    }
}

/// Resolves a universe-member composition's exact custody in the Owner transaction and stores its
/// binding and Replay facts.
///
/// `transaction` is the Owner transaction the shared opening holds, and `receipt` the role set the
/// R&D reader authenticated.
async fn issue_universe_members_in_transaction_v1(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    receipt: &StrategyDesignRoleSetReceiptV1,
    request: &ReplayCompositionUniverseBindingIssuanceRequestV1,
    issuance_locator: ReplayCompositionIssuanceLocatorV1,
    request_bytes: &[u8],
) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
    let replay = request.replay_request();
    let pit = request.pit_locator();

    let r0_locator = request.reference_fact_r0_locator();
    let r0 = super::super::reference_fact_coordinates::recover_reference_fact_r0_in_transaction_v1(
        transaction,
        UntrustedReferenceFactR0LocatorV1 {
            request_identity: r0_locator.request_identity(),
            request_meaning_digest: r0_locator.request_meaning_digest(),
        },
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let semantics_locator = request.market_semantics_locator();
    let semantics = super::super::market_semantics::recover_market_semantics_in_transaction_v1(
        transaction,
        UntrustedMarketSemanticsLocatorV1 {
            request_identity: semantics_locator.request_identity(),
            request_meaning_digest: semantics_locator.request_meaning_digest(),
        },
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;

    if semantics.cut().r0_cut_identity != r0.cut().identity()
        || semantics.cut().r0_cut_digest != r0.cut().digest()
        || semantics.facts().iter().any(|fact| {
            fact.pit_snapshot_identity != pit.snapshot_identity
                || fact.pit_fact_digest != pit.fact_digest
                || fact.source_binding_identity != request.source_binding_locator().binding_id
        })
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let universe_locator = request.universe_selection_locator();
    let universe = super::super::universe_selection::recover_universe_selection_in_transaction_v1(
        transaction,
        &UntrustedUniverseSelectionLocatorV1::from_untrusted(
            universe_locator.request_identity(),
            universe_locator.request_meaning_digest(),
        ),
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;

    let mut roles = Vec::with_capacity(receipt.roles.len());
    let mut role_requests = Vec::with_capacity(receipt.roles.len());

    for role in &receipt.roles {
        let declaration =
            super::super::strategy_input_binding_registry::recover_strategy_input_binding_declaration_v1(
                transaction,
                pit.request_identity,
                receipt.design_identity,
                role.role_identity,
            )
            .await
            .map_err(|_| ReplayCompositionBindingErrorV1::IncompleteComposition)?;

        if declaration.request().research_request_identity != receipt.research_request_identity
            || declaration.request().strategy_design_identity != receipt.design_identity
            || declaration.request().input_role_identity != role.role_identity
            || !request_matches_authenticated_role_v1(declaration.request(), role)
        {
            return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
        }

        // A role bound to one exact instrument has a single row and an Instrument Master fact;
        // this shape binds every role over the selection's members and carries neither.
        if declaration.exact_binding().is_some() {
            return Err(ReplayCompositionBindingErrorV1::CompositionShapeMismatch);
        }
        roles.push(ReplayCompositionRoleEvidenceV1 {
            role_identity: role.role_identity,
            declaration_identity: declaration.request_meaning_digest(),
            declaration_digest: declaration.request_meaning_digest(),
            binding_identity: declaration.binding_digest(),
            binding_digest: declaration.binding_digest(),
        });
        role_requests.push(declaration.request().clone());
    }
    let source =
        super::super::strategy_input_binding_registry::recover_strategy_input_binding_source_v1(
            transaction,
            role_requests
                .first()
                .ok_or(ReplayCompositionBindingErrorV1::IncompleteComposition)?,
        )
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;

    if source.locator() != request.source_binding_locator() {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let coordinates = coordinates_from_r0(&r0)?;
    let correction = project_first_v1(CorrectionPolicyAuthenticatedInputsV1 {
        source_binding: &source,
        coordinates: &coordinates,
        r0_coordinate_identity: r0.record().identity(),
        r0_coordinate_digest: r0.record().digest(),
    })
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;

    if correction.identity() != request.correction_policy_locator().identity()
        || correction.identity() != request.correction_policy_locator().digest()
    {
        return Err(ReplayCompositionBindingErrorV1::DependencyMismatch);
    }
    let batch = super::super::strategy_input_binding_registry::load_owner_verified_pit_batch_v1(
        transaction,
        pit.snapshot_identity,
    )
    .await
    .map_err(|_| ReplayCompositionBindingErrorV1::DependencyMismatch)?;
    let frame = bind_strategy_input_universe_frame(&role_requests, &batch)
        .map_err(|_| ReplayCompositionBindingErrorV1::UniverseFrameMismatch)?;

    if let Some(response) =
        replayed_issuance_v1(transaction, issuance_locator, request_bytes).await?
    {
        return Ok(response);
    }
    let sources = UniverseMemberReplayFactsSourcesV2 {
        r0: &r0,
        source: &source,
        universe: &universe,
        semantics: &semantics,
        correction: &correction,
        frame: &frame,
    };
    let registry_digest = digest_registry(&roles);
    let binding = issue_universe_member_composition_binding_v1(
        &replay,
        ReplayCompositionUniverseBindingEvidenceV1 {
            authenticated_strategy_design_identity: receipt.design_identity,
            authenticated_strategy_design_digest: receipt.design_digest,
            registry_identity: registry_digest,
            registry_digest,
            native_locators: universe_member_native_locators_v1(pit, &sources),
            roles,
            universe_frame_digest: frame.digest(),
            stable_correlation: receipt.intent_identity,
        },
    )?;
    persist_replay_composition_binding_in_transaction_v1(transaction, &binding)
        .await
        .map_err(|_| ReplayCompositionBindingErrorV1::ReplayV2Unavailable)?;
    let replay_readback = persist_universe_member_replay_market_facts_in_transaction_v2(
        transaction,
        &replay,
        &sources,
        &binding,
        receipt.intent_identity,
    )
    .await?;
    record_issuance_v1(
        transaction,
        issuance_locator,
        request_bytes,
        &binding,
        &replay_readback,
    )
    .await
}

#[cfg(test)]
mod postgres_tests {
    use super::issue_universe_members_in_transaction_v1;
    use crate::owner::{
        correction_policy_projection::{CorrectionPolicyAuthenticatedInputsV1, project_first_v1},
        instrument_master_v2::{InstrumentMasterCustodyErrorV2, tests::fact_for_observed_at},
        instrument_master_v2_postgres::InstrumentMasterV2PostgresOwner,
        postgres::{
            MarketDataOwnerPostgres,
            tests::{
                replay_composition_market_base_fixture_v1, universe_member_declarations_oracle,
            },
        },
        replay_market_facts_v2::{
            ReplayCompositionBindingErrorV1, ReplayCompositionBindingLocatorV1,
            ReplayCompositionContentLocatorV1, ReplayCompositionDurableIssuanceResponseV1,
            ReplayCompositionLocatorOnlyIssuanceRequestV1, ReplayCompositionOwnerV1,
            ReplayCompositionRequestLocatorV1, ReplayCompositionUniverseBindingIssuanceRequestV1,
            ReplayMarketFactsShapeV2, composition::ReplayCompositionNativeLocatorKindV1,
            postgres::recover_replay_composition_binding_in_transaction_v1,
        },
        source_binding::BindingDigest,
        strategy_design_role_set::{
            StrategyDesignRoleEntryV1, StrategyDesignRoleSetLocatorV1,
            StrategyDesignRoleSetReceiptV1,
        },
        strategy_input_binding::{
            EXACT_INSTRUMENT_ROLE_SCOPE_V1, UNIVERSE_MEMBERS_ROLE_SCOPE_V1,
            UntrustedStrategyInputCustodyClaimV1, UntrustedStrategyInputScope,
        },
    };

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    /// Rows in every table a universe-member issuance writes, and in the census it must not.
    async fn issuance_state(pool: &sqlx::PgPool) -> Vec<i64> {
        let mut counts = Vec::new();

        for query in [
            "SELECT COUNT(*) FROM market_data_private.replay_composition_bindings_v1",
            "SELECT COUNT(*) FROM market_data_private.replay_composition_binding_receipts_v1",
            "SELECT COUNT(*) FROM market_data_private.replay_composition_binding_outbox_v1",
            "SELECT COUNT(*) FROM market_data_private.replay_market_facts_v2",
            "SELECT COUNT(*) FROM market_data_private.replay_market_facts_receipts_v2",
            "SELECT COUNT(*) FROM market_data_private.replay_market_facts_outbox_v2",
            "SELECT COUNT(*) FROM market_data_private.replay_composition_issuances_v1",
            "SELECT COUNT(*) FROM market_data_private.observation_census_records_v1",
        ] {
            counts.push(sqlx::query_scalar(query).fetch_one(pool).await.unwrap());
        }
        counts
    }

    /// Instrument Master V2 cut custody and its append sequence.
    async fn cut_state(pool: &sqlx::PgPool) -> Vec<i64> {
        let mut counts = Vec::new();

        for query in [
            "SELECT COUNT(*) FROM market_data_instrument_master_v2.cuts",
            "SELECT COUNT(*) FROM market_data_instrument_master_v2.bound_replay_issuances",
            "SELECT append_sequence FROM market_data_instrument_master_v2.state WHERE singleton",
        ] {
            counts.push(sqlx::query_scalar(query).fetch_one(pool).await.unwrap());
        }
        counts
    }

    /// A universe-member composition issues one schema 2 binding and its Replay facts, and that
    /// binding keys a one-member Instrument Master V2 cut.
    ///
    /// The issuance runs its Owner-transaction body over the replay composition base fixture and
    /// the fixture's universe-member Design, under a role set R&D would have authenticated. The
    /// entry's reader/Owner challenges, which need R&D's Composer attestation in the same database,
    /// are proven by the ordered chain's replay composition entry; this database carries only
    /// Market Data, where a Design can be issued without a second Composer operation for its
    /// Research request.
    ///
    /// It writes one binding, one aggregate and one issuance and no census. The binding names no
    /// Instrument Master; the resolved cut carries none; and the Design's universe custody re-reads
    /// to exactly the frame the binding and its facts carry. A retry returns the stored bytes, the
    /// same identity with another composition is refused by name, and an exact-instrument role set
    /// is refused by name, each writing nothing. The binding then keys the request's Instrument
    /// Master V2 cut: refused by name with nothing written while the member has no fact, and one
    /// member once it has.
    #[tokio::test]
    #[ignore = "requires a disposable Market Data PostgreSQL database"]
    #[allow(clippy::too_many_lines)]
    async fn postgres_universe_member_composition_issues_a_binding_that_keys_its_cut() {
        let owner_url = std::env::var("MARKET_DATA_OWNER_TEST_DATABASE_URL").unwrap();
        let base = Box::pin(replay_composition_market_base_fixture_v1(&owner_url)).await;
        // The deployed store is materialized before custody cutover; this database is too, by the
        // same production entry, so the issuance table exists as it does in production.
        ReplayCompositionOwnerV1::materialize_schema(&owner_url)
            .await
            .expect("the replay composition store materializes");
        let market = MarketDataOwnerPostgres::connect(&owner_url).await.unwrap();
        let pool = market.pool().clone();
        let requests = Box::pin(universe_member_declarations_oracle(
            &market,
            &base.binding_requests[0],
            &base.batch,
        ))
        .await;

        let locator = StrategyDesignRoleSetLocatorV1 {
            schema_version: 2,
            request_identity: "universe-member-replay-composition-v1".into(),
            operation_receipt_identity: d(0x71),
            artifact_locator: "artifact:universe-member-replay-composition-v1".into(),
            artifact_identity: d(0x72),
            canonical_plan_digest: d(0x73),
            design_digest: d(0x74),
        };
        let role_set = |requests: &[crate::owner::strategy_input_binding::UntrustedStrategyInputBindingRequest]| {
            StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
                locator.clone(),
                requests[0].research_request_identity,
                d(0x75),
                requests[0].strategy_design_identity,
                d(0x74),
                d(0x76),
                requests
                    .iter()
                    .map(|request| StrategyDesignRoleEntryV1 {
                        role_identity: request.input_role_identity,
                        semantic_id: format!("role-{}", request.timeframe),
                        fact_class: "MARKET_DATA".into(),
                        instrument: match &request.scope {
                            UntrustedStrategyInputScope::ExactInstrument { instrument } => {
                                instrument.clone()
                            }
                            _ => String::new(),
                        },
                        scope: match &request.scope {
                            UntrustedStrategyInputScope::ExactInstrument { .. } => {
                                EXACT_INSTRUMENT_ROLE_SCOPE_V1.into()
                            }
                            _ => UNIVERSE_MEMBERS_ROLE_SCOPE_V1.into(),
                        },
                        field_semantic_id: request.field_semantic.identity().into(),
                        channel: request.channel.canonical().into(),
                        timeframe: request.timeframe.clone(),
                        unit: request.unit.canonical().into(),
                        scale: request.scale,
                        value_type: "I128".into(),
                    })
                    .collect(),
                vec![],
            )
            .expect("a universe Design's role set carries no native join")
        };
        let universe_role_set = role_set(&requests);
        let correction = project_first_v1(CorrectionPolicyAuthenticatedInputsV1 {
            source_binding: &base.source_readback,
            coordinates: &base.coordinates,
            r0_coordinate_identity: base.r0.record().identity(),
            r0_coordinate_digest: base.r0.record().digest(),
        })
        .unwrap();
        let composition = |end: i128| {
            ReplayCompositionUniverseBindingIssuanceRequestV1::from_test_fixture(
                locator.clone(),
                base.pit.receipt().locator().clone(),
                base.source.receipt().locator().clone(),
                50,
                end,
                ReplayCompositionRequestLocatorV1::from_untrusted(
                    base.universe.receipt().request_identity(),
                    base.universe.receipt().request_meaning_digest(),
                ),
                ReplayCompositionRequestLocatorV1::from_untrusted(
                    base.r0.receipt().request_identity,
                    base.r0.receipt().request_meaning_digest,
                ),
                ReplayCompositionRequestLocatorV1::from_untrusted(
                    base.semantics.receipt().request_identity,
                    base.semantics.receipt().request_meaning_digest,
                ),
                ReplayCompositionContentLocatorV1::from_untrusted(
                    correction.identity(),
                    correction.identity(),
                ),
            )
        };
        let issue = async |role_set: &StrategyDesignRoleSetReceiptV1,
                           command: &ReplayCompositionLocatorOnlyIssuanceRequestV1<
            ReplayCompositionUniverseBindingIssuanceRequestV1,
        >|
               -> Result<
            ReplayCompositionDurableIssuanceResponseV1,
            ReplayCompositionBindingErrorV1,
        > {
            let request_bytes = super::super::canonical_issuance_command_bytes_v1(command)?;
            let mut transaction = pool
                .begin_with("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
                .await
                .unwrap();
            let issued = Box::pin(issue_universe_members_in_transaction_v1(
                &mut transaction,
                role_set,
                command.composition(),
                command.issuance_locator(),
                &request_bytes,
            ))
            .await;

            if issued.is_ok() {
                transaction.commit().await.unwrap();
            } else {
                transaction.rollback().await.unwrap();
            }
            issued
        };

        let command =
            ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(0x78), composition(51)).unwrap();
        let before = issuance_state(&pool).await;
        let issued = issue(&universe_role_set, &command)
            .await
            .expect("the universe-member composition issues");
        let after = issuance_state(&pool).await;
        assert_eq!(
            after
                .iter()
                .zip(&before)
                .map(|(after, before)| after - before)
                .collect::<Vec<_>>(),
            [1, 1, 1, 1, 1, 1, 1, 0],
            "one binding, one aggregate, one issuance, and no census"
        );

        let (binding_identity, binding_digest): (Vec<u8>, Vec<u8>) = sqlx::query_as(
            "SELECT binding_identity,binding_digest FROM market_data_private.replay_composition_issuances_v1 WHERE request_identity=$1",
        )
        .bind(d(0x78).as_bytes().as_slice())
        .fetch_one(&pool)
        .await
        .unwrap();
        let binding_locator = ReplayCompositionBindingLocatorV1::from_untrusted(
            BindingDigest::from_untrusted_bytes(binding_identity.try_into().unwrap()),
            BindingDigest::from_untrusted_bytes(binding_digest.try_into().unwrap()),
        );
        let mut transaction = pool.begin().await.unwrap();
        let binding =
            recover_replay_composition_binding_in_transaction_v1(&mut transaction, binding_locator)
                .await
                .expect("the stored binding verifies");
        let cut = super::super::resolve_bound_replay_cut_in_transaction_v1(
            &mut transaction,
            binding_locator,
        )
        .await
        .expect("the Owner resolves the universe-member cut");
        let custody = crate::owner::postgres::strategy_input_binding_registry::
            reread_persisted_strategy_input_universe_custody_for_update_v1(
                &mut transaction,
                &UntrustedStrategyInputCustodyClaimV1 {
                    research_request_identity: requests[0].research_request_identity,
                    strategy_design_identity: requests[0].strategy_design_identity,
                    pit_request_identity: requests[0].pit_request_identity,
                    input_role_identities: requests
                        .iter()
                        .map(|request| request.input_role_identity)
                        .collect(),
                    decision_cut: requests[0].decision_cut,
                },
            )
            .await
            .expect("the Design's universe custody re-reads");
        transaction.rollback().await.unwrap();

        let record = binding.record();
        assert_eq!(record.shape(), ReplayMarketFactsShapeV2::UniverseMembers);
        assert_eq!(&record.canonical_bytes()[..2], &[0, 2]);
        assert_eq!(record.role_count(), requests.len());
        assert!(
            record
                .native_locator(ReplayCompositionNativeLocatorKindV1::InstrumentMaster)
                .is_none()
        );
        assert_eq!(
            record
                .native_locator(ReplayCompositionNativeLocatorKindV1::UniverseSelection)
                .map(|selection| (selection.identity, selection.digest)),
            Some((
                base.universe.record().identity(),
                base.universe.record().digest()
            ))
        );
        assert!(cut.instrument_master().is_none());
        assert_eq!(
            cut.market_facts().facts().shape(),
            ReplayMarketFactsShapeV2::UniverseMembers
        );
        assert_eq!(
            Some(custody.frame().digest()),
            record.universe_frame_digest(),
            "the re-read frame is the one the binding bound"
        );
        assert_eq!(
            Some(custody.frame().digest()),
            cut.market_facts().facts().universe_frame_digest(),
            "the re-read frame is the one the facts carry"
        );

        // A retry returns the stored bytes; another composition under the same identity and an
        // exact-instrument role set are refused by name; none of them writes.
        assert_eq!(
            issue(&universe_role_set, &command)
                .await
                .expect("the retry rejoins")
                .canonical_bytes(),
            issued.canonical_bytes()
        );
        assert_eq!(
            issue(
                &universe_role_set,
                &ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(0x78), composition(52))
                    .unwrap()
            )
            .await,
            Err(ReplayCompositionBindingErrorV1::IssuanceIdentityConflict)
        );
        let exact_role_set = role_set(&base.binding_requests);
        assert_eq!(
            issue(
                &exact_role_set,
                &ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(0x79), composition(51))
                    .unwrap()
            )
            .await,
            Err(ReplayCompositionBindingErrorV1::CompositionShapeMismatch),
            "an exact-instrument Design is refused by name, not composed into this shape"
        );
        assert_eq!(issuance_state(&pool).await, after);

        // The binding keys the request's Instrument Master V2 cut from the selection it bound.
        let instrument_master = InstrumentMasterV2PostgresOwner::install(pool.clone())
            .await
            .expect("the Instrument Master V2 store");
        let settled = cut_state(&pool).await;
        assert_eq!(
            instrument_master
                .issue_cut_for_bound_replay_v1("universe-member-replay", binding_locator)
                .await,
            Err(InstrumentMasterCustodyErrorV2::MissingFact),
            "a member with no Instrument Master V2 fact at the selection's observation"
        );
        assert_eq!(
            cut_state(&pool).await,
            settled,
            "the refusal writes nothing"
        );
        instrument_master
            .append_fact(&fact_for_observed_at(
                crate::owner::chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1,
                crate::owner::chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1,
                40,
                base.universe.record().owner_observation_ns(),
            ))
            .await
            .unwrap();
        let member_cut = instrument_master
            .issue_cut_for_bound_replay_v1("universe-member-replay", binding_locator)
            .await
            .expect("a one-member cut keyed by the universe-member binding");
        assert_eq!(
            member_cut
                .cut()
                .members()
                .iter()
                .map(|member| member.fact().canonical_identity())
                .collect::<Vec<_>>(),
            [crate::owner::chain_fixture_v1::CHAIN_FIXTURE_INSTRUMENT_V1]
        );
        assert_eq!(
            member_cut.cut().universe_selection_identity(),
            base.universe.record().identity()
        );
        assert_eq!(
            member_cut.cut().decision_cut(),
            base.universe.record().decision_cut()
        );
    }
}
