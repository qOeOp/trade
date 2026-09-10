use sqlx::Row;
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
    strategy_input_joined_cut::derive_strategy_input_join_identity_v2,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

const JOINED_CUT_CUSTODY_DOMAIN: &[u8] = b"VIBE_STRATEGY_INPUT_JOINED_CUT_CUSTODY_V1";
const OBSERVATION_CENSUS_REQUEST_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_REQUEST_V1";
const OBSERVATION_CENSUS_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_RECORD_V1";
const OBSERVATION_CENSUS_RECEIPT_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_RECEIPT_V1";
const OBSERVATION_CENSUS_STORAGE_DOMAIN: &[u8] = b"VIBE_OBSERVATION_CENSUS_STORAGE_V1";

struct ForgedObservationCensus {
    storage: Vec<u8>,
    receipt: Vec<u8>,
    census_identity: [u8; 32],
    receipt_identity: [u8; 32],
}

struct ForgedObservationCensusTrigger {
    request: Vec<u8>,
    request_meaning_digest: [u8; 32],
    census: ForgedObservationCensus,
}

fn observation_census_digest(domain: &[u8], bytes: &[u8]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(&[0]);
    hasher.update(bytes);
    *hasher.finalize().as_bytes()
}

fn joined_cut_custody_identity(custody: &[u8]) -> [u8; 32] {
    observation_census_digest(JOINED_CUT_CUSTODY_DOMAIN, custody)
}

fn take_census_storage_field(
    bytes: &[u8],
    cursor: &mut usize,
) -> anyhow::Result<std::ops::Range<usize>> {
    let length_end = cursor
        .checked_add(4)
        .ok_or_else(|| anyhow::anyhow!("census storage length overflow"))?;
    let length_bytes: [u8; 4] = bytes
        .get(*cursor..length_end)
        .ok_or_else(|| anyhow::anyhow!("census storage length missing"))?
        .try_into()?;
    let length = usize::try_from(u32::from_be_bytes(length_bytes))?;
    let start = length_end;
    let end = start
        .checked_add(length)
        .ok_or_else(|| anyhow::anyhow!("census storage field overflow"))?;
    anyhow::ensure!(bytes.get(start..end).is_some());
    *cursor = end;
    Ok(start..end)
}

fn forge_observation_census_pit_coordinates(
    original: &[u8],
) -> anyhow::Result<ForgedObservationCensus> {
    anyhow::ensure!(original.len() >= 38);
    let count = u32::from_be_bytes(original[34..38].try_into()?);
    let mut cursor = 38;

    for _ in 0..count {
        take_census_storage_field(original, &mut cursor)?;
    }
    let record_range = take_census_storage_field(original, &mut cursor)?;
    let receipt_range = take_census_storage_field(original, &mut cursor)?;
    anyhow::ensure!(cursor == original.len());
    anyhow::ensure!(record_range.len() >= 170);
    anyhow::ensure!(receipt_range.len() == 130);

    let mut storage = original.to_vec();
    let forged_pit_snapshot_identity = [0x6b; 32];
    let forged_pit_fact_digest = [0x7c; 32];
    anyhow::ensure!(
        storage[record_range.start + 66..record_range.start + 98] != forged_pit_snapshot_identity
    );
    storage[record_range.start + 66..record_range.start + 98]
        .copy_from_slice(&forged_pit_snapshot_identity);
    storage[record_range.start + 98..record_range.start + 130]
        .copy_from_slice(&forged_pit_fact_digest);
    let census_identity =
        observation_census_digest(OBSERVATION_CENSUS_DOMAIN, &storage[record_range.clone()]);
    storage[receipt_range.start + 66..receipt_range.start + 98].copy_from_slice(&census_identity);
    let receipt_identity = observation_census_digest(
        OBSERVATION_CENSUS_RECEIPT_DOMAIN,
        &storage[receipt_range.clone()],
    );
    let storage_identity =
        observation_census_digest(OBSERVATION_CENSUS_STORAGE_DOMAIN, &storage[32..]);
    storage[..32].copy_from_slice(&storage_identity);
    Ok(ForgedObservationCensus {
        receipt: storage[receipt_range].to_vec(),
        storage,
        census_identity,
        receipt_identity,
    })
}

fn forge_observation_census_trigger_semantics(
    original_request: &[u8],
    original_storage: &[u8],
) -> anyhow::Result<ForgedObservationCensusTrigger> {
    anyhow::ensure!(original_request.len() >= 110);
    let meaning_length = usize::try_from(u32::from_be_bytes(original_request[66..70].try_into()?))?;
    let meaning_start = 70_usize;
    let meaning_end = meaning_start
        .checked_add(meaning_length)
        .ok_or_else(|| anyhow::anyhow!("request meaning length overflow"))?;
    anyhow::ensure!(meaning_end == original_request.len());
    let trigger_start = meaning_end
        .checked_sub(40)
        .ok_or_else(|| anyhow::anyhow!("request trigger field missing"))?;
    let trigger_end = trigger_start + 8;
    let trigger = u64::from_be_bytes(original_request[trigger_start..trigger_end].try_into()?)
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("request trigger overflow"))?;
    let mut request = original_request.to_vec();
    request[trigger_start..trigger_end].copy_from_slice(&trigger.to_be_bytes());
    let request_meaning_digest = observation_census_digest(
        OBSERVATION_CENSUS_REQUEST_DOMAIN,
        &request[meaning_start..meaning_end],
    );
    request[34..66].copy_from_slice(&request_meaning_digest);

    anyhow::ensure!(original_storage.len() >= 38);
    let count = u32::from_be_bytes(original_storage[34..38].try_into()?);
    let mut cursor = 38;
    for _ in 0..count {
        take_census_storage_field(original_storage, &mut cursor)?;
    }
    let record_range = take_census_storage_field(original_storage, &mut cursor)?;
    let receipt_range = take_census_storage_field(original_storage, &mut cursor)?;
    anyhow::ensure!(cursor == original_storage.len());
    anyhow::ensure!(record_range.len() >= 170);
    anyhow::ensure!(receipt_range.len() == 130);

    let mut storage = original_storage.to_vec();
    storage[record_range.start + 34..record_range.start + 66]
        .copy_from_slice(&request_meaning_digest);
    storage[record_range.start + 162..record_range.start + 170]
        .copy_from_slice(&trigger.to_be_bytes());
    let census_identity =
        observation_census_digest(OBSERVATION_CENSUS_DOMAIN, &storage[record_range.clone()]);
    storage[receipt_range.start + 34..receipt_range.start + 66]
        .copy_from_slice(&request_meaning_digest);
    storage[receipt_range.start + 66..receipt_range.start + 98].copy_from_slice(&census_identity);
    let receipt_identity = observation_census_digest(
        OBSERVATION_CENSUS_RECEIPT_DOMAIN,
        &storage[receipt_range.clone()],
    );
    let storage_identity =
        observation_census_digest(OBSERVATION_CENSUS_STORAGE_DOMAIN, &storage[32..]);
    storage[..32].copy_from_slice(&storage_identity);
    Ok(ForgedObservationCensusTrigger {
        request,
        request_meaning_digest,
        census: ForgedObservationCensus {
            receipt: storage[receipt_range].to_vec(),
            storage,
            census_identity,
            receipt_identity,
        },
    })
}

fn forge_observation_census_design_identity(
    original_request: &[u8],
    original_storage: &[u8],
    original_design_identity: [u8; 32],
    forged_design_identity: [u8; 32],
) -> anyhow::Result<ForgedObservationCensusTrigger> {
    anyhow::ensure!(original_design_identity != forged_design_identity);
    anyhow::ensure!(original_request.len() >= 70);
    let meaning_length = usize::try_from(u32::from_be_bytes(original_request[66..70].try_into()?))?;
    let meaning_start = 70_usize;
    let meaning_end = meaning_start
        .checked_add(meaning_length)
        .ok_or_else(|| anyhow::anyhow!("request meaning length overflow"))?;
    anyhow::ensure!(meaning_end == original_request.len());
    let matches = original_request[meaning_start..meaning_end]
        .windows(original_design_identity.len())
        .enumerate()
        .filter_map(|(offset, bytes)| (bytes == original_design_identity).then_some(offset))
        .collect::<Vec<_>>();
    let [design_offset] = matches.as_slice() else {
        anyhow::bail!("request must contain the exact design identity once");
    };
    let design_start = meaning_start + design_offset;
    let design_end = design_start + original_design_identity.len();
    let mut request = original_request.to_vec();
    request[design_start..design_end].copy_from_slice(&forged_design_identity);
    let request_meaning_digest = observation_census_digest(
        OBSERVATION_CENSUS_REQUEST_DOMAIN,
        &request[meaning_start..meaning_end],
    );
    request[34..66].copy_from_slice(&request_meaning_digest);

    anyhow::ensure!(original_storage.len() >= 38);
    let count = u32::from_be_bytes(original_storage[34..38].try_into()?);
    let mut cursor = 38;
    for _ in 0..count {
        take_census_storage_field(original_storage, &mut cursor)?;
    }
    let record_range = take_census_storage_field(original_storage, &mut cursor)?;
    let receipt_range = take_census_storage_field(original_storage, &mut cursor)?;
    anyhow::ensure!(cursor == original_storage.len());
    anyhow::ensure!(record_range.len() >= 170);
    anyhow::ensure!(receipt_range.len() == 130);

    let mut storage = original_storage.to_vec();
    storage[record_range.start + 34..record_range.start + 66]
        .copy_from_slice(&request_meaning_digest);
    let census_identity =
        observation_census_digest(OBSERVATION_CENSUS_DOMAIN, &storage[record_range.clone()]);
    storage[receipt_range.start + 34..receipt_range.start + 66]
        .copy_from_slice(&request_meaning_digest);
    storage[receipt_range.start + 66..receipt_range.start + 98].copy_from_slice(&census_identity);
    let receipt_identity = observation_census_digest(
        OBSERVATION_CENSUS_RECEIPT_DOMAIN,
        &storage[receipt_range.clone()],
    );
    let storage_identity =
        observation_census_digest(OBSERVATION_CENSUS_STORAGE_DOMAIN, &storage[32..]);
    storage[..32].copy_from_slice(&storage_identity);
    Ok(ForgedObservationCensusTrigger {
        request,
        request_meaning_digest,
        census: ForgedObservationCensus {
            receipt: storage[receipt_range].to_vec(),
            storage,
            census_identity,
            receipt_identity,
        },
    })
}

fn forge_observation_census_join_staleness(
    original_request: &[u8],
    original_storage: &[u8],
    original_join_identity: [u8; 32],
    forged_join_identity: [u8; 32],
    original_max_staleness_ns: u64,
    forged_max_staleness_ns: u64,
) -> anyhow::Result<ForgedObservationCensusTrigger> {
    anyhow::ensure!(original_join_identity != forged_join_identity);
    anyhow::ensure!(original_max_staleness_ns != forged_max_staleness_ns);
    anyhow::ensure!(original_request.len() >= 70);
    let meaning_length = usize::try_from(u32::from_be_bytes(original_request[66..70].try_into()?))?;
    let meaning_start = 70_usize;
    let meaning_end = meaning_start
        .checked_add(meaning_length)
        .ok_or_else(|| anyhow::anyhow!("request meaning length overflow"))?;
    anyhow::ensure!(meaning_end == original_request.len());
    let matches = original_request[meaning_start..meaning_end]
        .windows(original_join_identity.len())
        .enumerate()
        .filter_map(|(offset, bytes)| (bytes == original_join_identity).then_some(offset))
        .collect::<Vec<_>>();
    let [join_offset] = matches.as_slice() else {
        anyhow::bail!("request must contain the exact join identity once");
    };
    let join_start = meaning_start + join_offset;
    let join_end = join_start + original_join_identity.len();
    let mut max_staleness_start = join_end;
    take_census_storage_field(original_request, &mut max_staleness_start)?;
    take_census_storage_field(original_request, &mut max_staleness_start)?;
    let max_staleness_end = max_staleness_start
        .checked_add(8)
        .ok_or_else(|| anyhow::anyhow!("request max staleness overflow"))?;
    anyhow::ensure!(max_staleness_end <= meaning_end);
    anyhow::ensure!(
        u64::from_be_bytes(original_request[max_staleness_start..max_staleness_end].try_into()?)
            == original_max_staleness_ns
    );

    let mut request = original_request.to_vec();
    request[join_start..join_end].copy_from_slice(&forged_join_identity);
    request[max_staleness_start..max_staleness_end]
        .copy_from_slice(&forged_max_staleness_ns.to_be_bytes());
    let request_meaning_digest = observation_census_digest(
        OBSERVATION_CENSUS_REQUEST_DOMAIN,
        &request[meaning_start..meaning_end],
    );
    request[34..66].copy_from_slice(&request_meaning_digest);

    anyhow::ensure!(original_storage.len() >= 38);
    let count = u32::from_be_bytes(original_storage[34..38].try_into()?);
    let mut cursor = 38;
    for _ in 0..count {
        take_census_storage_field(original_storage, &mut cursor)?;
    }
    let record_range = take_census_storage_field(original_storage, &mut cursor)?;
    let receipt_range = take_census_storage_field(original_storage, &mut cursor)?;
    anyhow::ensure!(cursor == original_storage.len());
    anyhow::ensure!(record_range.len() >= 170);
    anyhow::ensure!(receipt_range.len() == 130);

    let mut storage = original_storage.to_vec();
    storage[record_range.start + 34..record_range.start + 66]
        .copy_from_slice(&request_meaning_digest);
    storage[record_range.start + 130..record_range.start + 162]
        .copy_from_slice(&forged_join_identity);
    let census_identity =
        observation_census_digest(OBSERVATION_CENSUS_DOMAIN, &storage[record_range.clone()]);
    storage[receipt_range.start + 34..receipt_range.start + 66]
        .copy_from_slice(&request_meaning_digest);
    storage[receipt_range.start + 66..receipt_range.start + 98].copy_from_slice(&census_identity);
    let receipt_identity = observation_census_digest(
        OBSERVATION_CENSUS_RECEIPT_DOMAIN,
        &storage[receipt_range.clone()],
    );
    let storage_identity =
        observation_census_digest(OBSERVATION_CENSUS_STORAGE_DOMAIN, &storage[32..]);
    storage[..32].copy_from_slice(&storage_identity);
    Ok(ForgedObservationCensusTrigger {
        request,
        request_meaning_digest,
        census: ForgedObservationCensus {
            receipt: storage[receipt_range].to_vec(),
            storage,
            census_identity,
            receipt_identity,
        },
    })
}

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
    let mutation = database.mutation();
    let market_mutation_pool = mutation.pool(CanonicalOwnerTestRoleV1::MarketDataOwner);
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
    let [design_join] = role_set.joins.as_slice() else {
        anyhow::bail!("six-role BAR design must contain one join");
    };
    let original_join_identity = *design_join.join_identity.as_bytes();
    let original_max_staleness_ns = design_join.max_staleness_ns;
    let forged_max_staleness_ns = original_max_staleness_ns
        .checked_add(1)
        .ok_or_else(|| anyhow::anyhow!("join max staleness overflow"))?;
    let join_inputs = design_join
        .roles
        .iter()
        .map(|role| role.semantic_id.clone())
        .collect::<Vec<_>>();
    let forged_join_identity = *derive_strategy_input_join_identity_v2(
        &design_join.semantic_id,
        &join_inputs,
        &design_join.alignment_semantic_id,
        &design_join.trigger_input_id,
        forged_max_staleness_ns,
    )
    .as_bytes();
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
    .fetch_one(market_mutation_pool)
    .await?;
    let damaged = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET joined_cut_custody_bytes=joined_cut_custody_bytes || decode('00','hex') WHERE joined_cut_identity=$1",
    )
    .bind(joined_cut_identity.as_bytes().as_slice())
    .execute(market_mutation_pool)
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
    .execute(market_mutation_pool)
    .await?;
    anyhow::ensure!(restored.rows_affected() == 1);
    let restored_projection = recovered_owner
        .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
        .await?;
    anyhow::ensure!(
        restored_projection.canonical_bytes() == recovered_projection.canonical_bytes()
    );

    let mut forged_custody = original_joined_cut_custody.clone();
    anyhow::ensure!(forged_custody.len() >= 130);
    let forged_census_identity = [0x5a; 32];
    anyhow::ensure!(forged_custody[66..98] != forged_census_identity);
    forged_custody[66..98].copy_from_slice(&forged_census_identity);
    forged_custody[98..130].copy_from_slice(&forged_census_identity);
    let forged_joined_cut_identity = joined_cut_custody_identity(&forged_custody);
    let forged = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET joined_cut_custody_bytes=$1,joined_cut_identity=$2 WHERE joined_cut_identity=$3",
    )
    .bind(&forged_custody)
    .bind(forged_joined_cut_identity.as_slice())
    .bind(joined_cut_identity.as_bytes().as_slice())
    .execute(market_mutation_pool)
    .await?;
    anyhow::ensure!(forged.rows_affected() == 1);
    anyhow::ensure!(
        recovered_owner
            .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
            .await
            .is_err(),
        "self-consistent joined-cut custody substituted another census"
    );
    let restored = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET joined_cut_custody_bytes=$1,joined_cut_identity=$2 WHERE joined_cut_identity=$3",
    )
    .bind(&original_joined_cut_custody)
    .bind(joined_cut_identity.as_bytes().as_slice())
    .bind(forged_joined_cut_identity.as_slice())
    .execute(market_mutation_pool)
    .await?;
    anyhow::ensure!(restored.rows_affected() == 1);
    let restored_projection = recovered_owner
        .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
        .await?;
    anyhow::ensure!(
        restored_projection.canonical_bytes() == recovered_projection.canonical_bytes()
    );

    let census_row = sqlx::query(
        "SELECT request_identity,request_meaning_digest,request_bytes,census_identity,census_bytes,census_receipt_identity,census_receipt_bytes,outbox_identity,joined_cut_identity,joined_cut_custody_bytes FROM market_data_private.observation_census_records_v1 WHERE joined_cut_identity=$1",
    )
    .bind(joined_cut_identity.as_bytes().as_slice())
    .fetch_one(market_mutation_pool)
    .await?;
    let request_identity: Vec<u8> = census_row.try_get("request_identity")?;
    let original_request_meaning_digest: Vec<u8> = census_row.try_get("request_meaning_digest")?;
    let original_request: Vec<u8> = census_row.try_get("request_bytes")?;
    let original_census_identity: Vec<u8> = census_row.try_get("census_identity")?;
    let original_census_storage: Vec<u8> = census_row.try_get("census_bytes")?;
    let original_census_receipt_identity: Vec<u8> =
        census_row.try_get("census_receipt_identity")?;
    let original_census_receipt: Vec<u8> = census_row.try_get("census_receipt_bytes")?;
    let original_outbox_identity: Vec<u8> = census_row.try_get("outbox_identity")?;
    let original_joined_cut_identity: Vec<u8> = census_row.try_get("joined_cut_identity")?;
    let original_joined_cut_custody: Vec<u8> = census_row.try_get("joined_cut_custody_bytes")?;
    let outbox_row = sqlx::query(
        "SELECT outbox_identity,payload_digest,payload FROM market_data_private.observation_census_outbox_v1 WHERE request_identity=$1",
    )
    .bind(&request_identity)
    .fetch_one(market_mutation_pool)
    .await?;
    let original_outbox_row_identity: Vec<u8> = outbox_row.try_get("outbox_identity")?;
    let original_outbox_payload_digest: Vec<u8> = outbox_row.try_get("payload_digest")?;
    let original_outbox_payload: Vec<u8> = outbox_row.try_get("payload")?;
    let forged_census = forge_observation_census_pit_coordinates(&original_census_storage)?;
    let mut forged_custody = original_joined_cut_custody.clone();
    anyhow::ensure!(forged_custody.len() >= 130);
    forged_custody[66..98].copy_from_slice(&forged_census.census_identity);
    forged_custody[98..130].copy_from_slice(&forged_census.census_identity);
    let forged_joined_cut_identity = joined_cut_custody_identity(&forged_custody);
    let mut forged_transaction = market_mutation_pool.begin().await?;
    let forged_outbox = sqlx::query(
        "UPDATE market_data_private.observation_census_outbox_v1 SET outbox_identity=$1,payload_digest=$2,payload=$3 WHERE request_identity=$4",
    )
    .bind(forged_census.receipt_identity.as_slice())
    .bind(forged_census.census_identity.as_slice())
    .bind(&forged_census.storage)
    .bind(&request_identity)
    .execute(&mut *forged_transaction)
    .await?;
    anyhow::ensure!(forged_outbox.rows_affected() == 1);
    let forged_record = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET census_identity=$1,census_bytes=$2,census_receipt_identity=$3,census_receipt_bytes=$4,outbox_identity=$3,joined_cut_identity=$5,joined_cut_custody_bytes=$6 WHERE request_identity=$7",
    )
    .bind(forged_census.census_identity.as_slice())
    .bind(&forged_census.storage)
    .bind(forged_census.receipt_identity.as_slice())
    .bind(&forged_census.receipt)
    .bind(forged_joined_cut_identity.as_slice())
    .bind(&forged_custody)
    .bind(&request_identity)
    .execute(&mut *forged_transaction)
    .await?;
    anyhow::ensure!(forged_record.rows_affected() == 1);
    forged_transaction.commit().await?;
    anyhow::ensure!(
        recovered_owner
            .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
            .await
            .is_err(),
        "self-consistent observation census escaped request semantics"
    );
    let mut restore_transaction = market_mutation_pool.begin().await?;
    let restored_outbox = sqlx::query(
        "UPDATE market_data_private.observation_census_outbox_v1 SET outbox_identity=$1,payload_digest=$2,payload=$3 WHERE request_identity=$4",
    )
    .bind(&original_outbox_row_identity)
    .bind(&original_outbox_payload_digest)
    .bind(&original_outbox_payload)
    .bind(&request_identity)
    .execute(&mut *restore_transaction)
    .await?;
    anyhow::ensure!(restored_outbox.rows_affected() == 1);
    let restored_record = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET census_identity=$1,census_bytes=$2,census_receipt_identity=$3,census_receipt_bytes=$4,outbox_identity=$5,joined_cut_identity=$6,joined_cut_custody_bytes=$7 WHERE request_identity=$8",
    )
    .bind(&original_census_identity)
    .bind(&original_census_storage)
    .bind(&original_census_receipt_identity)
    .bind(&original_census_receipt)
    .bind(&original_outbox_identity)
    .bind(&original_joined_cut_identity)
    .bind(&original_joined_cut_custody)
    .bind(&request_identity)
    .execute(&mut *restore_transaction)
    .await?;
    anyhow::ensure!(restored_record.rows_affected() == 1);
    restore_transaction.commit().await?;
    let restored_projection = recovered_owner
        .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
        .await?;
    anyhow::ensure!(
        restored_projection.canonical_bytes() == recovered_projection.canonical_bytes()
    );

    let forged_trigger =
        forge_observation_census_trigger_semantics(&original_request, &original_census_storage)?;
    let mut forged_trigger_custody = original_joined_cut_custody.clone();
    anyhow::ensure!(forged_trigger_custody.len() >= 162);
    forged_trigger_custody[34..66].copy_from_slice(&forged_trigger.request_meaning_digest);
    forged_trigger_custody[66..98].copy_from_slice(&forged_trigger.census.census_identity);
    forged_trigger_custody[98..130].copy_from_slice(&forged_trigger.census.census_identity);
    let forged_trigger_joined_cut_identity = joined_cut_custody_identity(&forged_trigger_custody);
    let mut forged_trigger_transaction = market_mutation_pool.begin().await?;
    let forged_trigger_outbox = sqlx::query(
        "UPDATE market_data_private.observation_census_outbox_v1 SET outbox_identity=$1,payload_digest=$2,payload=$3 WHERE request_identity=$4",
    )
    .bind(forged_trigger.census.receipt_identity.as_slice())
    .bind(forged_trigger.census.census_identity.as_slice())
    .bind(&forged_trigger.census.storage)
    .bind(&request_identity)
    .execute(&mut *forged_trigger_transaction)
    .await?;
    anyhow::ensure!(forged_trigger_outbox.rows_affected() == 1);
    let forged_trigger_record = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET request_meaning_digest=$1,request_bytes=$2,census_identity=$3,census_bytes=$4,census_receipt_identity=$5,census_receipt_bytes=$6,outbox_identity=$5,joined_cut_identity=$7,joined_cut_custody_bytes=$8 WHERE request_identity=$9",
    )
    .bind(forged_trigger.request_meaning_digest.as_slice())
    .bind(&forged_trigger.request)
    .bind(forged_trigger.census.census_identity.as_slice())
    .bind(&forged_trigger.census.storage)
    .bind(forged_trigger.census.receipt_identity.as_slice())
    .bind(&forged_trigger.census.receipt)
    .bind(forged_trigger_joined_cut_identity.as_slice())
    .bind(&forged_trigger_custody)
    .bind(&request_identity)
    .execute(&mut *forged_trigger_transaction)
    .await?;
    anyhow::ensure!(forged_trigger_record.rows_affected() == 1);
    forged_trigger_transaction.commit().await?;
    anyhow::ensure!(
        recovered_owner
            .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
            .await
            .is_err(),
        "coherent request and census trigger substitution escaped the actual joined cut"
    );
    let mut restore_trigger_transaction = market_mutation_pool.begin().await?;
    let restored_trigger_outbox = sqlx::query(
        "UPDATE market_data_private.observation_census_outbox_v1 SET outbox_identity=$1,payload_digest=$2,payload=$3 WHERE request_identity=$4",
    )
    .bind(&original_outbox_row_identity)
    .bind(&original_outbox_payload_digest)
    .bind(&original_outbox_payload)
    .bind(&request_identity)
    .execute(&mut *restore_trigger_transaction)
    .await?;
    anyhow::ensure!(restored_trigger_outbox.rows_affected() == 1);
    let restored_trigger_record = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET request_meaning_digest=$1,request_bytes=$2,census_identity=$3,census_bytes=$4,census_receipt_identity=$5,census_receipt_bytes=$6,outbox_identity=$7,joined_cut_identity=$8,joined_cut_custody_bytes=$9 WHERE request_identity=$10",
    )
    .bind(&original_request_meaning_digest)
    .bind(&original_request)
    .bind(&original_census_identity)
    .bind(&original_census_storage)
    .bind(&original_census_receipt_identity)
    .bind(&original_census_receipt)
    .bind(&original_outbox_identity)
    .bind(&original_joined_cut_identity)
    .bind(&original_joined_cut_custody)
    .bind(&request_identity)
    .execute(&mut *restore_trigger_transaction)
    .await?;
    anyhow::ensure!(restored_trigger_record.rows_affected() == 1);
    restore_trigger_transaction.commit().await?;
    let restored_projection = recovered_owner
        .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
        .await?;
    anyhow::ensure!(
        restored_projection.canonical_bytes() == recovered_projection.canonical_bytes()
    );

    let forged_design_identity = [0x8d; 32];
    let forged_design = forge_observation_census_design_identity(
        &original_request,
        &original_census_storage,
        *design_identity.as_bytes(),
        forged_design_identity,
    )?;
    let mut forged_design_custody = original_joined_cut_custody.clone();
    anyhow::ensure!(forged_design_custody.len() >= 162);
    forged_design_custody[34..66].copy_from_slice(&forged_design.request_meaning_digest);
    forged_design_custody[66..98].copy_from_slice(&forged_design.census.census_identity);
    forged_design_custody[98..130].copy_from_slice(&forged_design.census.census_identity);
    let forged_design_joined_cut_identity = joined_cut_custody_identity(&forged_design_custody);
    let mut forged_design_transaction = market_mutation_pool.begin().await?;
    let forged_design_outbox = sqlx::query(
        "UPDATE market_data_private.observation_census_outbox_v1 SET outbox_identity=$1,payload_digest=$2,payload=$3 WHERE request_identity=$4",
    )
    .bind(forged_design.census.receipt_identity.as_slice())
    .bind(forged_design.census.census_identity.as_slice())
    .bind(&forged_design.census.storage)
    .bind(&request_identity)
    .execute(&mut *forged_design_transaction)
    .await?;
    anyhow::ensure!(forged_design_outbox.rows_affected() == 1);
    let forged_design_record = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET request_meaning_digest=$1,request_bytes=$2,census_identity=$3,census_bytes=$4,census_receipt_identity=$5,census_receipt_bytes=$6,outbox_identity=$5,joined_cut_identity=$7,joined_cut_custody_bytes=$8 WHERE request_identity=$9",
    )
    .bind(forged_design.request_meaning_digest.as_slice())
    .bind(&forged_design.request)
    .bind(forged_design.census.census_identity.as_slice())
    .bind(&forged_design.census.storage)
    .bind(forged_design.census.receipt_identity.as_slice())
    .bind(&forged_design.census.receipt)
    .bind(forged_design_joined_cut_identity.as_slice())
    .bind(&forged_design_custody)
    .bind(&request_identity)
    .execute(&mut *forged_design_transaction)
    .await?;
    anyhow::ensure!(forged_design_record.rows_affected() == 1);
    forged_design_transaction.commit().await?;
    anyhow::ensure!(
        recovered_owner
            .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
            .await
            .is_err(),
        "coherent design substitution escaped the unchanged V1 joined-cut receipt"
    );
    let mut restore_design_transaction = market_mutation_pool.begin().await?;
    let restored_design_outbox = sqlx::query(
        "UPDATE market_data_private.observation_census_outbox_v1 SET outbox_identity=$1,payload_digest=$2,payload=$3 WHERE request_identity=$4",
    )
    .bind(&original_outbox_row_identity)
    .bind(&original_outbox_payload_digest)
    .bind(&original_outbox_payload)
    .bind(&request_identity)
    .execute(&mut *restore_design_transaction)
    .await?;
    anyhow::ensure!(restored_design_outbox.rows_affected() == 1);
    let restored_design_record = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET request_meaning_digest=$1,request_bytes=$2,census_identity=$3,census_bytes=$4,census_receipt_identity=$5,census_receipt_bytes=$6,outbox_identity=$7,joined_cut_identity=$8,joined_cut_custody_bytes=$9 WHERE request_identity=$10",
    )
    .bind(&original_request_meaning_digest)
    .bind(&original_request)
    .bind(&original_census_identity)
    .bind(&original_census_storage)
    .bind(&original_census_receipt_identity)
    .bind(&original_census_receipt)
    .bind(&original_outbox_identity)
    .bind(&original_joined_cut_identity)
    .bind(&original_joined_cut_custody)
    .bind(&request_identity)
    .execute(&mut *restore_design_transaction)
    .await?;
    anyhow::ensure!(restored_design_record.rows_affected() == 1);
    restore_design_transaction.commit().await?;
    let restored_projection = recovered_owner
        .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
        .await?;
    anyhow::ensure!(
        restored_projection.canonical_bytes() == recovered_projection.canonical_bytes()
    );

    let forged_staleness = forge_observation_census_join_staleness(
        &original_request,
        &original_census_storage,
        original_join_identity,
        forged_join_identity,
        original_max_staleness_ns,
        forged_max_staleness_ns,
    )?;
    let mut forged_staleness_custody = original_joined_cut_custody.clone();
    anyhow::ensure!(forged_staleness_custody.len() >= 162);
    forged_staleness_custody[34..66].copy_from_slice(&forged_staleness.request_meaning_digest);
    forged_staleness_custody[66..98].copy_from_slice(&forged_staleness.census.census_identity);
    forged_staleness_custody[98..130].copy_from_slice(&forged_staleness.census.census_identity);
    let forged_staleness_joined_cut_identity =
        joined_cut_custody_identity(&forged_staleness_custody);
    let mut forged_staleness_transaction = market_mutation_pool.begin().await?;
    let forged_staleness_outbox = sqlx::query(
        "UPDATE market_data_private.observation_census_outbox_v1 SET outbox_identity=$1,payload_digest=$2,payload=$3 WHERE request_identity=$4",
    )
    .bind(forged_staleness.census.receipt_identity.as_slice())
    .bind(forged_staleness.census.census_identity.as_slice())
    .bind(&forged_staleness.census.storage)
    .bind(&request_identity)
    .execute(&mut *forged_staleness_transaction)
    .await?;
    anyhow::ensure!(forged_staleness_outbox.rows_affected() == 1);
    let forged_staleness_record = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET request_meaning_digest=$1,request_bytes=$2,census_identity=$3,census_bytes=$4,census_receipt_identity=$5,census_receipt_bytes=$6,outbox_identity=$5,joined_cut_identity=$7,joined_cut_custody_bytes=$8 WHERE request_identity=$9",
    )
    .bind(forged_staleness.request_meaning_digest.as_slice())
    .bind(&forged_staleness.request)
    .bind(forged_staleness.census.census_identity.as_slice())
    .bind(&forged_staleness.census.storage)
    .bind(forged_staleness.census.receipt_identity.as_slice())
    .bind(&forged_staleness.census.receipt)
    .bind(forged_staleness_joined_cut_identity.as_slice())
    .bind(&forged_staleness_custody)
    .bind(&request_identity)
    .execute(&mut *forged_staleness_transaction)
    .await?;
    anyhow::ensure!(forged_staleness_record.rows_affected() == 1);
    forged_staleness_transaction.commit().await?;
    anyhow::ensure!(
        recovered_owner
            .resolve_strategy_input_sample_projection_v4(recovered_native_join.locator())
            .await
            .is_err(),
        "coherent join-staleness substitution escaped the immutable V4 subject meaning"
    );
    let mut restore_staleness_transaction = market_mutation_pool.begin().await?;
    let restored_staleness_outbox = sqlx::query(
        "UPDATE market_data_private.observation_census_outbox_v1 SET outbox_identity=$1,payload_digest=$2,payload=$3 WHERE request_identity=$4",
    )
    .bind(&original_outbox_row_identity)
    .bind(&original_outbox_payload_digest)
    .bind(&original_outbox_payload)
    .bind(&request_identity)
    .execute(&mut *restore_staleness_transaction)
    .await?;
    anyhow::ensure!(restored_staleness_outbox.rows_affected() == 1);
    let restored_staleness_record = sqlx::query(
        "UPDATE market_data_private.observation_census_records_v1 SET request_meaning_digest=$1,request_bytes=$2,census_identity=$3,census_bytes=$4,census_receipt_identity=$5,census_receipt_bytes=$6,outbox_identity=$7,joined_cut_identity=$8,joined_cut_custody_bytes=$9 WHERE request_identity=$10",
    )
    .bind(&original_request_meaning_digest)
    .bind(&original_request)
    .bind(&original_census_identity)
    .bind(&original_census_storage)
    .bind(&original_census_receipt_identity)
    .bind(&original_census_receipt)
    .bind(&original_outbox_identity)
    .bind(&original_joined_cut_identity)
    .bind(&original_joined_cut_custody)
    .bind(&request_identity)
    .execute(&mut *restore_staleness_transaction)
    .await?;
    anyhow::ensure!(restored_staleness_record.rows_affected() == 1);
    restore_staleness_transaction.commit().await?;
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
