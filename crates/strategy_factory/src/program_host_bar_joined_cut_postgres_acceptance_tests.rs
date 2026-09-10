use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
    ReplayModelProfilesV2, ReplayRequestDtoV2, ReplayRequestV2, ReplayWindowV2,
    VersionedIdentityV2,
};
use vibe_data::owner::{
    bar_joined_cut_acceptance_v1::{
        UntrustedBarJoinedCutAcceptanceDesignClaimsV1,
        complete_owner_bar_joined_cut_acceptance_fixture_v1,
        prepare_owner_bar_joined_cut_acceptance_basis_v1,
    },
    instrument_master::InstrumentMasterReadbackV1,
    replay_market_facts_v2::ReplayCompositionOwnerV1,
    sample_projection_v4::StrategyInputSampleProjectionResolverV4,
    sealed_replay_input::{SealedReplayInput, sealed_replay_input_contains_joined_cut_v1},
    source_binding::BindingDigest,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

use crate::{
    OwnerBarJoinedCutPreparationV1,
    artifact_v2::StrategyArtifactV2,
    develop_composer_postgres_v2::{
        issue_sealed_develop_composer_readback_for_acceptance_v2,
        issue_strategy_design_role_set_for_acceptance_v1,
    },
    exploratory_replay::{
        SealedExploratoryReplayReadbackV2,
        issue_sealed_exploratory_replay_readback_for_acceptance_v2,
    },
    prepare_program_host_from_owner_bar_joined_cut_v1,
    program_host_v2::{
        BAR_HOUR_CLOSE, BAR_MINUTE_CLOSE, BAR_MINUTE_HIGH, BAR_MINUTE_LOW, BAR_MINUTE_OPEN,
        BAR_SESSION_DAY_CLOSE, joined_plan_and_artifact, six_role_bar_design,
    },
    run_prepared_owner_bar_joined_cut_backtest_v1,
    strategy_plan_v2::{
        StrategyDesignPreparationV2, StrategyPlanV2, prepare_strategy_design_v2,
        strategy_input_role_identity_v2,
    },
};

#[tokio::test]
#[ignore = "requires an admitted disposable Owner PostgreSQL topology"]
async fn owner_postgres_v4_moves_through_program_host_and_real_backtest() -> anyhow::Result<()> {
    let design = six_role_bar_design();
    let design_identity = match prepare_strategy_design_v2(&design) {
        StrategyDesignPreparationV2::Prepared {
            design_identity, ..
        } => design_identity,
        rejected => anyhow::bail!("six-role BAR design did not prepare: {rejected:?}"),
    };
    let role_semantics = [
        BAR_MINUTE_OPEN,
        BAR_MINUTE_HIGH,
        BAR_MINUTE_LOW,
        BAR_MINUTE_CLOSE,
        BAR_HOUR_CLOSE,
        BAR_SESSION_DAY_CLOSE,
    ];
    let input_role_identities = role_semantics.map(|semantic_id| {
        design
            .inputs
            .iter()
            .find(|input| input.semantic_id == semantic_id)
            .map(strategy_input_role_identity_v2)
            .expect("six-role BAR design contains every fixed role")
    });
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await?;
    let basis = Box::pin(prepare_owner_bar_joined_cut_acceptance_basis_v1(
        &database,
        UntrustedBarJoinedCutAcceptanceDesignClaimsV1 {
            research_request_identity: design.research_request_identity,
            strategy_design_identity: design_identity,
            input_role_identities,
        },
    ))
    .await
    .map_err(|error| anyhow::anyhow!("Owner BAR acceptance basis unavailable: {error}"))?;
    let (plan, artifact) = joined_plan_and_artifact(design, basis.input_bindings());
    anyhow::ensure!(plan.bfp_role_bindings().len() == 12);
    let composer = issue_sealed_develop_composer_readback_for_acceptance_v2(&plan, &artifact)?;
    let role_set = issue_strategy_design_role_set_for_acceptance_v1(&composer)?;
    let fixture = Box::pin(complete_owner_bar_joined_cut_acceptance_fixture_v1(
        basis, role_set,
    ))
    .await
    .map_err(|error| anyhow::anyhow!("Owner BAR acceptance completion unavailable: {error}"))?;
    let (replay_input, instrument_master, bindings, joined_cut, native_request) =
        fixture.into_parts();
    anyhow::ensure!(sealed_replay_input_contains_joined_cut_v1(
        &replay_input,
        &joined_cut
    ));
    let replay = acceptance_replay_readback(&plan, &artifact, &replay_input, &instrument_master)?;

    let market_owner_url = database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner);
    let market_reader_url = database.database_url(CanonicalOwnerTestRoleV1::MarketDataReader);
    let owner = ReplayCompositionOwnerV1::connect(market_owner_url, market_reader_url).await?;
    let native_join = owner.issue_composer_native_join_v1(&native_request).await?;
    let first_projection = owner
        .resolve_strategy_input_sample_projection_v4(native_join.locator())
        .await?;
    let recovered_owner =
        ReplayCompositionOwnerV1::connect(market_owner_url, market_reader_url).await?;
    let recovered_native_join = recovered_owner
        .issue_composer_native_join_v1(&native_request)
        .await?;
    let recovered_projection = recovered_owner
        .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
        .await?;
    anyhow::ensure!(native_join.locator() == recovered_native_join.locator());
    anyhow::ensure!(first_projection.canonical_bytes() == recovered_projection.canonical_bytes());
    anyhow::ensure!(
        first_projection.schedule_dependency_set_digest()
            == recovered_projection.schedule_dependency_set_digest()
    );

    let joined_cut_identity = native_request.joined_cut_identity;
    let original_joined_cut_custody: Vec<u8> = sqlx::query_scalar(
        "SELECT joined_cut_custody_bytes FROM market_data_private.observation_census_records_v1 WHERE joined_cut_identity=$1",
    )
    .bind(joined_cut_identity.as_bytes().as_slice())
    .fetch_one(database.owner_topology_admin_pool())
    .await?;
    let damaged = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET joined_cut_custody_bytes=joined_cut_custody_bytes || decode('00','hex') WHERE joined_cut_identity=$1",
    )
    .bind(joined_cut_identity.as_bytes().as_slice())
    .execute(database.owner_topology_admin_pool())
    .await?;
    anyhow::ensure!(damaged.rows_affected() == 1);
    anyhow::ensure!(
        recovered_owner
            .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
            .await
            .is_err(),
        "damaged joined-cut custody escaped V4 read-only resolution"
    );
    let restored = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET joined_cut_custody_bytes=$1 WHERE joined_cut_identity=$2",
    )
    .bind(&original_joined_cut_custody)
    .bind(joined_cut_identity.as_bytes().as_slice())
    .execute(database.owner_topology_admin_pool())
    .await?;
    anyhow::ensure!(restored.rows_affected() == 1);
    let restored_projection = recovered_owner
        .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
        .await?;
    anyhow::ensure!(
        restored_projection.canonical_bytes() == recovered_projection.canonical_bytes()
    );

    let projection_digest = first_projection.receipt_digest();
    let schedule_digest = first_projection.schedule_dependency_set_digest();
    let prepared = prepare_program_host_from_owner_bar_joined_cut_v1(
        &replay,
        &composer,
        OwnerBarJoinedCutPreparationV1::new(
            replay_input,
            instrument_master,
            bindings,
            joined_cut,
            native_join,
        ),
        &owner,
    )
    .await?;
    let handoff = prepared.into_program_host_bar_handoff_v1()?;
    anyhow::ensure!(handoff.sample_projection_digest() == projection_digest);
    anyhow::ensure!(handoff.schedule_dependency_set_digest() == schedule_digest);
    let readback = run_prepared_owner_bar_joined_cut_backtest_v1(handoff)?;
    anyhow::ensure!(readback.consumed());
    anyhow::ensure!(readback.projection_digest() == projection_digest);
    anyhow::ensure!(readback.schedule_dependency_set_digest() == schedule_digest);
    anyhow::ensure!(readback.plugin_calls() == 1);
    anyhow::ensure!(readback.checkpoint_after() != [0; 32]);
    anyhow::ensure!(readback.terminal_checkpoint() != [0; 32]);
    anyhow::ensure!(readback.checkpoint_after() != readback.terminal_checkpoint());
    Ok(())
}

fn acceptance_replay_readback(
    plan: &StrategyPlanV2,
    artifact: &StrategyArtifactV2,
    market: &SealedReplayInput,
    instrument_master: &InstrumentMasterReadbackV1,
) -> anyhow::Result<SealedExploratoryReplayReadbackV2> {
    fn opaque(value: &str) -> anyhow::Result<OpaqueIdentityV2> {
        OpaqueIdentityV2::try_from(value.to_owned()).map_err(Into::into)
    }
    fn digest_text(algorithm: &str, value: BindingDigest) -> String {
        format!("{algorithm}:{}", hex(value.as_bytes()))
    }
    fn content(
        algorithm: &str,
        identity: BindingDigest,
        digest: BindingDigest,
    ) -> anyhow::Result<ContentIdentityV2> {
        Ok(ContentIdentityV2 {
            identity: opaque(&digest_text(algorithm, identity))?,
            digest: CanonicalDigestV2::try_from(digest_text(algorithm, digest))?,
        })
    }
    fn named_content(identity: &str, digest: BindingDigest) -> anyhow::Result<ContentIdentityV2> {
        Ok(ContentIdentityV2 {
            identity: opaque(identity)?,
            digest: CanonicalDigestV2::try_from(digest_text("sha256", digest))?,
        })
    }
    fn version(algorithm: &str, identity: BindingDigest) -> anyhow::Result<VersionedIdentityV2> {
        Ok(VersionedIdentityV2 {
            identity: opaque(&digest_text(algorithm, identity))?,
            version: opaque("v2")?,
        })
    }
    fn fixture_digest(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    let artifact_locator = format!(
        "rd-strategy-artifact-v2-{}",
        hex(artifact.identity().as_bytes())
    );
    let end_event_ns_exclusive = market
        .observation_end_event_time()
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("Owner BAR acceptance window overflow"))?;
    let request = ReplayRequestV2::try_from(ReplayRequestDtoV2 {
        schema_version: 2,
        request_identity: opaque("owner-v4-bar-joined-cut-replay-request-v1")?,
        frozen_research_intent: named_content(
            &format!(
                "rd-research-intent-v2-{}",
                hex(plan.intent_identity().as_bytes())
            ),
            plan.intent_digest(),
        )?,
        trial_family: content("sha256", fixture_digest(1), fixture_digest(2))?,
        trial_family_census_frontier: content("sha256", fixture_digest(3), fixture_digest(4))?,
        replay_authority: ReplayAuthorityClaimV2::Exploratory,
        strategy_design: content("sha256", plan.design_identity(), plan.design_digest())?,
        strategy_plan: content(
            "sha256",
            plan.canonical_plan_digest(),
            plan.canonical_plan_digest(),
        )?,
        artifact: named_content(&artifact_locator, artifact.identity())?,
        resolved_owner_inputs: content("blake3", fixture_digest(5), market.frame_census_digest())?,
        pit_scope: content("blake3", fixture_digest(6), market.scope_digest())?,
        pit_snapshot: content(
            "blake3",
            market.snapshot_identity(),
            market.snapshot_fact_digest(),
        )?,
        universe_selection: content(
            "blake3",
            fixture_digest(7),
            market.universe_selection_digest(),
        )?,
        correction_rule: version("blake3", market.snapshot_correction_rule_digest())?,
        market_semantics: version("blake3", market.market_semantics_identity())?,
        replay_configuration: content("sha256", fixture_digest(8), fixture_digest(9))?,
        models: ReplayModelProfilesV2 {
            runtime_kernel: version("sha256", fixture_digest(10))?,
            simulator: version("sha256", fixture_digest(11))?,
            cost: version("sha256", fixture_digest(12))?,
            slippage: version("sha256", fixture_digest(13))?,
            capacity: version("sha256", fixture_digest(14))?,
        },
        runner_operational_profile: version("sha256", fixture_digest(15))?,
        diagnostic_policy: version("sha256", fixture_digest(16))?,
        deterministic_seed: 17,
        window: ReplayWindowV2 {
            start_event_ns: market.observation_start_event_time(),
            end_event_ns_exclusive,
        },
        calendar: version("sha256", fixture_digest(17))?,
        session: version("sha256", fixture_digest(18))?,
        time_zone: version("sha256", fixture_digest(19))?,
        corporate_action_cut: content("sha256", fixture_digest(20), fixture_digest(21))?,
        historical_membership_cut: content(
            "blake3",
            fixture_digest(22),
            instrument_master.cut().digest(),
        )?,
    })?;
    issue_sealed_exploratory_replay_readback_for_acceptance_v2(request)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
