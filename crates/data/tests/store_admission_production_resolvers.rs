//! The two Market Data resolvers Native Replay execution needs, opened as `rd-owner-api` opens them.
//!
//! `native_replay_scheduling_resolver_v1_from_store_admission_*` and
//! `shared_time_evidence_resolver_from_store_admission_*_v1` exist only in a build that is not a
//! test build of this crate, which is why this is an integration test: the library is compiled as
//! a deployment compiles it. Each is opened through its lookup variant, which reads the mode, the
//! identities and every production port from the configuration it is given, exactly as the
//! environment variant reads them from the process.

#![cfg(unix)]

use std::{collections::HashMap, sync::Arc};

use async_trait::async_trait;
use ed25519_dalek::SigningKey;
use vibe_data::owner::{
    DeploymentStorePublishOutcomeV1, author_deployment_store_publication_v1,
    bar_schedule::{BarScheduleError, UntrustedBarScheduleLocatorV1},
    bar_schedule_resolver_v1_from_store_admission_lookup,
    native_replay_scheduling_resolver_v1_from_store_admission_lookup,
    pit_market_snapshot_intake_v1::pit_market_snapshot_intake_from_environment_v1,
    pit_observation_source_v1::{
        PitObservationScopeV1, PitObservationSourceErrorV1, PitObservationSourceV1,
        VendorObservationV1,
    },
    publish_sealed_deployment_store_publication_v1, seal_deployment_store_publication_v1,
    shared_time_evidence_resolver_from_store_admission_lookup_v1,
    source_binding::BindingDigest,
};

/// A Data Client that observes nothing. Opening the intake is how a process outside this crate
/// makes the Market Data Owner migrate; nothing here asks it for an observation.
struct NoObservations;

#[async_trait]
impl PitObservationSourceV1 for NoObservations {
    async fn observe(
        &self,
        _scope: &PitObservationScopeV1,
    ) -> Result<Vec<VendorObservationV1>, PitObservationSourceErrorV1> {
        Ok(Vec::new())
    }
}

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is set by the Market Data runner"))
}

/// In `required` mode both resolvers Native Replay execution needs open over the five production
/// ports. A read through the same admission and the same admitted port is then shown to reach the
/// store: the BAR schedule resolver answers an unknown schedule from the store's custody, as
/// `UnknownIdentity`. With the leased secret gone, the same read is refused at re-admission, as
/// `StoreUnavailable`, so the first answer can only have come from the store.
///
/// The read is not the Shared Time resolver's or the scheduling resolver's own: on a store no
/// intake has written, both refuse a read for want of a clock or a snapshot with the same
/// `StoreUnavailable` an admission refusal gives, which could not tell the two apart.
#[tokio::test]
#[ignore = "requires the crates/data disposable PostgreSQL harness"]
async fn the_native_replay_resolvers_open_and_read_in_required_mode() {
    const CREDENTIAL: &str = "market-data-admitted-reader";
    let admin = env("MARKET_DATA_ADMIN_TEST_DATABASE_URL");
    let reader_url = env("MARKET_DATA_ADMITTED_READER_TEST_DATABASE_URL");
    let publisher_url = env("DEPLOYMENT_STORE_PUBLISHER_TEST_DATABASE_URL");
    let custodian_url = env("DEPLOYMENT_STORE_CUSTODIAN_TEST_DATABASE_URL");
    let root_file = env("MARKET_DATA_TLS_ROOT_CERTIFICATE_FILE");
    assert!(
        env("MARKET_DATA_OWNER_DATABASE_URL").contains("vibe_test_"),
        "the Owner this proof migrates is a disposable one"
    );
    drop(
        pit_market_snapshot_intake_from_environment_v1(Arc::new(NoObservations))
            .await
            .expect("the Market Data Owner connects and migrates"),
    );
    let now = store_clock(&admin).await;
    let files = tempfile::tempdir().unwrap();
    let write = |name: &str, contents: &[u8]| {
        let path = files.path().join(name);
        std::fs::write(&path, contents).unwrap();
        path.to_string_lossy().into_owned()
    };
    let credential = format!("{reader_url}\n");
    let leased = write(CREDENTIAL, credential.as_bytes());
    let custodian_file = write(
        "custodian-connection",
        format!("{custodian_url}\n").as_bytes(),
    );

    // The administrator: measure and author, seal, publish.
    let draft = serde_json::json!({
        "signer_identity": "deployment-store-signer-v1",
        "environment_identity": "md-native-replay-resolvers",
        "deployment_identity": "md-native-replay-resolvers-deployment",
        "prior_manifest_identities": [],
        "expected_previous_head_identity": null,
        "valid_from_epoch_ms": now - 60_000,
        "valid_through_epoch_ms": now + 3_600_000,
        "recovery": {
            "identity": "md-native-replay-resolvers-recovery",
            "restart_requires_reverification": true,
            "ambiguity_forbids_business_retry": true,
        },
        "rotation_fence_identity": "md-native-replay-resolvers-rotation",
        "rotation_fence_closed_at_epoch_ms": now - 60_000,
    });
    let authoring = author_deployment_store_publication_v1(
        &serde_json::to_vec(&draft).unwrap(),
        CREDENTIAL,
        credential.as_bytes(),
        &std::fs::read(&root_file).unwrap(),
    )
    .await
    .expect("the administrator measures the store over the pinned connection");
    let (sealed, summary) =
        seal_deployment_store_publication_v1(&authoring, &SigningKey::from_bytes(&[44; 32]))
            .expect("the authored publication seals");
    assert_eq!(
        publish_sealed_deployment_store_publication_v1(&publisher_url, &sealed).await,
        Ok(DeploymentStorePublishOutcomeV1::Published)
    );

    // The deployment's configuration, as rd-owner-api's environment carries it.
    let configuration: HashMap<&str, String> = HashMap::from([
        ("DEPLOYMENT_STORE_ADMISSION_MODE", "required".to_owned()),
        (
            "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY",
            summary.environment_identity.clone(),
        ),
        (
            "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY",
            summary.deployment_identity.clone(),
        ),
        (
            "DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY",
            summary.head_identity.clone(),
        ),
        (
            "DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE",
            "SINGLE_TRUST_DOMAIN_NO_ROLLBACK_WITNESS".to_owned(),
        ),
        (
            "DEPLOYMENT_STORE_SIGNER_IDENTITY",
            "deployment-store-signer-v1".to_owned(),
        ),
        (
            "DEPLOYMENT_STORE_SIGNER_PUBLIC_KEY_PATH",
            write(
                "signer-public-key.hex",
                format!("{}\n", summary.signer_public_key_hex).as_bytes(),
            ),
        ),
        (
            "DEPLOYMENT_STORE_LEASED_FILES_DIRECTORY",
            files.path().to_string_lossy().into_owned(),
        ),
        ("DEPLOYMENT_STORE_LEASE_PERIOD_MS", "86400000".to_owned()),
        ("DEPLOYMENT_STORE_POSTGRES_ROOT_CERTIFICATE_PATH", root_file),
        ("DEPLOYMENT_STORE_CUSTODIAN_CONNECTION_FILE", custodian_file),
    ]);
    let lookup = |name: &str| configuration.get(name).cloned();

    assert!(
        native_replay_scheduling_resolver_v1_from_store_admission_lookup(lookup)
            .await
            .expect("the scheduling resolver's admission succeeds")
            .is_some(),
        "required mode yields the native Replay scheduling resolver"
    );
    assert!(
        shared_time_evidence_resolver_from_store_admission_lookup_v1(lookup)
            .await
            .expect("the Shared Time resolver's admission succeeds")
            .is_some(),
        "required mode yields the Shared Time resolver"
    );
    let schedules = bar_schedule_resolver_v1_from_store_admission_lookup(lookup)
        .await
        .expect("the BAR schedule resolver's admission succeeds")
        .expect("required mode yields the BAR schedule resolver");
    let unknown = UntrustedBarScheduleLocatorV1 {
        digest: BindingDigest::from_untrusted_bytes([0x5a; 32]),
    };
    assert_eq!(
        schedules
            .resolve_bar_schedule_v1(&unknown)
            .await
            .map(|_| ()),
        Err(BarScheduleError::UnknownIdentity),
        "the admitted read reaches the store, whose custody holds no such schedule"
    );

    std::fs::remove_file(&leased).unwrap();
    assert_eq!(
        schedules
            .resolve_bar_schedule_v1(&unknown)
            .await
            .map(|_| ()),
        Err(BarScheduleError::StoreUnavailable),
        "without its leased secret the port is refused at re-admission, before any read"
    );
}

async fn store_clock(admin_url: &str) -> u64 {
    use vibe_postgres_connect::{PgPoolOptionsExt, PostgresTls};

    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_url(admin_url, PostgresTls::Disabled)
        .await
        .expect("the administrator connects");
    let epoch_ms: i64 = sqlx::query_scalar(
        "SELECT pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint",
    )
    .fetch_one(&admin)
    .await
    .unwrap();
    u64::try_from(epoch_ms).unwrap()
}
