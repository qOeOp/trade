use super::postgres::{
    REPLAY_MARKET_FACTS_SCHEMA_V2, ReplayMarketFactsPostgresErrorV2,
    classify_candidate_rows_for_test, negative_resolution_for_test, reseal_storage_row_for_test,
    sealed_storage_manifest_for_test, store_generation_identity_for_test,
    validate_storage_manifest_for_test, validate_stored_row_for_test,
};

#[rstest]
fn schema_is_private_opaque_and_has_no_native_authority_foreign_keys() {
    let schema = REPLAY_MARKET_FACTS_SCHEMA_V2.join("\n");
    assert!(schema.contains("market_data_private.replay_market_facts_v2"));
    assert!(schema.contains("market_data_private.replay_market_facts_receipts_v2"));
    assert!(schema.contains("market_data_private.replay_market_facts_outbox_v2"));
    assert!(schema.contains("market_data_private.replay_market_facts_state_v2"));
    assert!(schema.contains("manifest_digest"));
    assert!(schema.contains("composition_binding_identity"));
    assert!(schema.contains("replay_composition_bindings_v1"));
    assert!(schema.contains("replay_composition_binding_receipts_v1"));
    assert!(schema.contains("replay_composition_binding_outbox_v1"));
    assert!(schema.contains("resolve_replay_composition_binding_v1"));
    assert!(schema.contains("replay_market_facts_binding_v1"));
    assert!(schema.contains("WHERE composition_binding_identity IS NOT NULL"));
    assert!(schema.contains("ADD COLUMN IF NOT EXISTS"));
    assert!(schema.contains("fact_count BIGINT"));
    assert!(schema.contains("receipt_count BIGINT"));
    assert!(schema.contains("outbox_count BIGINT"));
    assert!(schema.contains("outbox_max_sequence BIGINT"));
    assert!(schema.contains("UNIQUE NOT NULL"));
    assert_eq!(schema.matches("REVOKE ALL").count(), 9);
    assert!(!schema.contains("BEGIN"));
    assert!(!schema.contains("COMMIT"));
    assert!(!schema.contains("universe_selection_facts"));
    assert!(!schema.contains("strategy_input_joined_cut_receipts"));
    assert!(!schema.contains("REFERENCES market_data_private.strategy_input_sample_projection"));
}

#[rstest]
fn locator_only_issuance_is_durable_and_cannot_accept_caller_role_authority() {
    let source = include_str!("../postgres/replay_market_facts_v2.rs");
    let role_set = include_str!("../strategy_design_role_set.rs");
    assert!(source.contains("replay_composition_issuances_v1"));
    assert!(source.contains("request_identity BYTEA PRIMARY KEY"));
    assert!(source.contains("request_meaning_digest BYTEA NOT NULL UNIQUE"));
    assert!(source.contains("response_bytes BYTEA NOT NULL"));
    assert!(source.contains("lock_issuance_identity"));
    assert!(source.contains("Self::resolve_role_set_attestation(&mut reader_transaction"));
    assert!(
        source.contains(
            "Self::resolve_native_join_attestation(\n            &mut reader_transaction"
        )
    );
    assert!(source.contains("validate_native_join_v4(&mut transaction, &native_join)"));
    assert!(source.contains("let mut reader_transaction = self\n            .rd_role_set_pool"));
    assert!(source.contains("verify_owner_handoff_v1("));
    assert!(source.contains("pg_try_advisory_xact_lock"));
    assert!(source.contains("pg_control_system"));
    assert!(source.contains("pg_postmaster_start_time"));
    assert!(source.contains("pg_is_in_recovery"));
    assert!(source.contains("lock_composer_cut_v1("));
    assert!(source.contains(
        "FROM composer_owner_api.resolve_strategy_design_native_join_v1($1,$2,$3,$4,$5,$6,$7)"
    ));
    assert!(source.contains("decoded.component_count() != 6"));
    assert!(source.contains("stored\n            .decoded\n            .canonical_bytes()"));
    assert!(source.contains("authenticate_durable_strategy_design_role_set_v1"));
    assert!(source.contains(
        "FROM composer_owner_api.resolve_strategy_design_role_set_attestation_v1($1,$2,$3,$4,$5,$6,$7)"
    ));
    assert!(!source.contains("fetch_optional(&self.rd_role_set_pool)"));
    assert!(!source.contains("FROM rd_develop_strategy_design_role_set_attestations_v1"));
    assert!(!source.contains("FROM public.rd_develop_strategy_design_role_set_attestations_v1"));
    assert!(source.contains("rd_reader_role != \"market_data_reader\""));
    assert!(source.contains("has_table_privilege(current_user"));
    assert!(source.contains("native_function_execute"));
    assert!(source.contains("native_raw_select"));
    assert!(source.contains("native_raw_write"));
    assert!(source.contains("pg_has_role(current_user,'composer_owner','MEMBER')"));
    assert!(source.contains("'SELECT') AS raw_select"));
    assert!(source.contains("'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS raw_write"));
    assert!(
        role_set
            .contains("pub(in crate::owner) fn authenticate_durable_strategy_design_role_set_v1")
    );
    let issue_signature = source
        .split("pub async fn issue_binding_v1")
        .nth(1)
        .expect("positive issuance entry")
        .split('{')
        .next()
        .expect("bounded signature");
    assert!(issue_signature.contains("ReplayCompositionLocatorOnlyIssuanceRequestV1"));
    assert!(!issue_signature.contains("StrategyDesignRoleSetReadbackV1"));
    let issue_body = source
        .split("pub async fn issue_binding_v1")
        .nth(1)
        .expect("positive issuance body");
    assert!(
        issue_body
            .find("lock_composer_cut_v1(")
            .expect("Composer owner lock")
            < issue_body
                .find("recover_reference_fact_r0_in_transaction_v1")
                .expect("first Market fact read")
    );
    assert!(source.contains("rd_role_set_pool"));
    assert!(!source.contains("issue_composer_native_join_v1"));
    assert!(
        issue_body
            .find("lock_composer_cut_v1(")
            .expect("Composer owner lock")
            < issue_body
                .find("persist_replay_composition_binding_in_transaction_v1")
                .expect("first Market write")
    );
    assert!(
        issue_body
            .find("verify_owner_handoff_v1(")
            .expect("live database handoff")
            < issue_body
                .find("persist_replay_composition_binding_in_transaction_v1")
                .expect("first Market write")
    );
}

#[rstest]
fn additive_v4_dependency_tag_does_not_rename_legacy_v2_tag_seven() {
    use crate::owner::replay_market_facts_v2::ReplayMarketDependencyKindV2;
    use rstest::rstest;

    assert_eq!(
        ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV2 as u16,
        7
    );
    assert_eq!(
        ReplayMarketDependencyKindV2::StrategyInputSampleProjectionV4 as u16,
        8
    );
    let legacy = fixture_row();
    assert_eq!(validate_stored_row_for_test(&legacy), Ok(()));
    assert!(
        legacy
            .frontier_bytes
            .windows(2)
            .any(|bytes| bytes == 7_u16.to_be_bytes())
    );
}

#[rstest]
fn composer_native_join_attestation_is_exact_and_tamper_evident() {
    use crate::owner::{
        replay_market_facts_v2::AuthenticatedComposerNativeJoinV1,
        sample_projection_v4::UntrustedStrategyInputSampleProjectionLocatorV4,
        source_binding::BindingDigest,
        strategy_design_role_set::{
            StrategyDesignNativeJoinReceiptV1, StrategyDesignRoleSetLocatorV1,
        },
    };

    let locator = StrategyDesignRoleSetLocatorV1 {
        schema_version: 2,
        request_identity: "composer-request".to_owned(),
        operation_receipt_identity: BindingDigest::from_untrusted_bytes([1; 32]),
        artifact_locator: "artifact".to_owned(),
        artifact_identity: BindingDigest::from_untrusted_bytes([2; 32]),
        canonical_plan_digest: BindingDigest::from_untrusted_bytes([3; 32]),
        design_digest: BindingDigest::from_untrusted_bytes([4; 32]),
    };
    let capability = AuthenticatedComposerNativeJoinV1::from_owner_readback(
        UntrustedStrategyInputSampleProjectionLocatorV4::from_untrusted([5; 32]),
        BindingDigest::from_untrusted_bytes([6; 32]),
        BindingDigest::from_untrusted_bytes([7; 32]),
    );
    let receipt =
        StrategyDesignNativeJoinReceiptV1::from_market_owner(locator.clone(), &capability)
            .expect("native join attestation");
    let decoded = StrategyDesignNativeJoinReceiptV1::from_durable_attestation(
        &locator,
        receipt.canonical_bytes(),
        receipt.receipt_digest(),
    )
    .expect("exact durable attestation");
    assert_eq!(decoded, receipt);
    let mut corrupt = receipt.canonical_bytes().to_vec();
    corrupt[0] ^= 1;
    assert!(
        StrategyDesignNativeJoinReceiptV1::from_durable_attestation(
            &locator,
            &corrupt,
            receipt.receipt_digest(),
        )
        .is_err()
    );
}

#[rstest]
fn complete_manifest_recovers_exact_receipt_and_outbox_bytes() {
    let row = fixture_row();
    let manifest = sealed_storage_manifest_for_test(&row, "replay-test", 3, 3);
    assert_eq!(validate_storage_manifest_for_test(&row, &manifest), Ok(()));
    assert_eq!(manifest.outbox_identity, row.receipt_identity);
    assert_eq!(manifest.outbox_payload_bytes, row.receipt_bytes);
    assert_eq!(manifest.append_sequence, manifest.receipt_append_sequence);
    assert_eq!(manifest.append_sequence, manifest.outbox_append_sequence);
    assert_eq!(
        manifest.receipt_manifest_digest,
        manifest.outbox_manifest_digest
    );
}

#[rstest]
fn manifest_rejects_missing_extra_corrupt_and_cross_spliced_rows() {
    let row = fixture_row();
    let valid = sealed_storage_manifest_for_test(&row, "replay-test", 1, 1);

    let mut missing = valid.clone();
    missing.receipt_count = 0;
    assert_eq!(
        validate_storage_manifest_for_test(&row, &missing),
        Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
    );

    let mut extra = valid.clone();
    extra.outbox_count = 2;
    assert_eq!(
        validate_storage_manifest_for_test(&row, &extra),
        Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
    );

    let mut corrupt = valid.clone();
    corrupt.outbox_payload_bytes[0] ^= 1;
    assert_eq!(
        validate_storage_manifest_for_test(&row, &corrupt),
        Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
    );

    let mut cross_spliced = valid;
    cross_spliced.receipt_facts_identity = [91; 32];
    assert_eq!(
        validate_storage_manifest_for_test(&row, &cross_spliced),
        Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
    );

    let mut sequence_gap = sealed_storage_manifest_for_test(&row, "replay-test", 1, 1);
    sequence_gap.outbox_max_sequence = 2;
    assert_eq!(
        validate_storage_manifest_for_test(&row, &sequence_gap),
        Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
    );
}

#[rstest]
fn store_generation_is_deterministic_and_database_scoped() {
    assert_eq!(
        store_generation_identity_for_test("replay-test"),
        store_generation_identity_for_test("replay-test")
    );
    assert_ne!(
        store_generation_identity_for_test("replay-test"),
        store_generation_identity_for_test("other-database")
    );
}

#[rstest]
fn negative_resolver_has_no_positive_type() {
    let _: fn(
        &super::postgres::StoredReplayMarketFactsRowV2,
    ) -> Result<std::convert::Infallible, ReplayMarketFactsPostgresErrorV2> =
        negative_resolution_for_test;
}

#[rstest]
fn bound_storage_meaning_is_exact_binding_scoped_and_legacy_is_unbound() {
    use super::postgres::{bound_meaning_identity, meaning_identity};

    let legacy = meaning_identity([1; 32], [2; 32], [3; 32], 10, 100);
    let first = bound_meaning_identity([1; 32], [2; 32], [3; 32], 10, 100, [4; 32]);
    let second = bound_meaning_identity([1; 32], [2; 32], [3; 32], 10, 100, [5; 32]);
    assert_ne!(legacy, first);
    assert_ne!(first, second);
    assert!(fixture_row().composition_binding_identity.is_none());
}

#[rstest]
fn resolver_rejects_corrupt_and_cross_spliced_dependency_rows() {
    let valid = fixture_row();
    assert_eq!(
        negative_resolution_for_test(&valid),
        Err(ReplayMarketFactsPostgresErrorV2::UniverseSelectionUnavailable)
    );

    let mut corrupt = valid.clone();
    corrupt.facts_bytes[0] ^= 1;
    assert_eq!(
        validate_stored_row_for_test(&corrupt),
        Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
    );

    let mut cross_spliced = valid;
    cross_spliced.joined_cut.identity = [99; 32];
    reseal_storage_row_for_test(&mut cross_spliced);
    assert_eq!(
        validate_stored_row_for_test(&cross_spliced),
        Err(ReplayMarketFactsPostgresErrorV2::CorruptRecord)
    );
}

#[rstest]
fn identity_and_meaning_collisions_fail_closed() {
    let existing = fixture_row();
    assert_eq!(
        classify_candidate_rows_for_test(&existing, &existing),
        Ok(())
    );

    let mut identity_collision = existing.clone();
    identity_collision.meaning_identity = [88; 32];
    assert_eq!(
        classify_candidate_rows_for_test(&existing, &identity_collision),
        Err(ReplayMarketFactsPostgresErrorV2::IdentityConflict)
    );

    let mut meaning_collision = existing.clone();
    meaning_collision.facts_identity = [77; 32];
    meaning_collision.receipt_identity = [76; 32];
    assert_eq!(
        classify_candidate_rows_for_test(&existing, &meaning_collision),
        Err(ReplayMarketFactsPostgresErrorV2::MeaningConflict)
    );
}

fn fixture_row() -> super::postgres::StoredReplayMarketFactsRowV2 {
    use super::postgres::{
        StoredReplayMarketFactsRowV2, digest_bytes, meaning_identity, storage_digest,
    };
    use crate::owner::replay_market_facts_v2::codec::{
        FACTS_DOMAIN, FRONTIER_DOMAIN, RECEIPT_DOMAIN,
    };

    let request_identity = [1; 32];
    let request_digest = [2; 32];
    let pit_snapshot_identity = [3; 32];
    let replay_start_event_ns = 10_i128;
    let replay_end_event_ns_exclusive = 100_i128;
    let universe_selection = dependency(4);
    let observation = dependency(5);
    let joined_cut = dependency(6);
    let sample_projection = dependency(7);

    let mut frontier_bytes = Vec::new();
    frontier_bytes.extend_from_slice(&2_u16.to_be_bytes());
    frontier_bytes.extend_from_slice(&7_u32.to_be_bytes());
    for kind in 1_u16..=7 {
        frontier_bytes.extend_from_slice(&kind.to_be_bytes());
        let value = dependency(u8::try_from(kind).expect("small kind"));
        frontier_bytes.extend_from_slice(&value.identity);
        frontier_bytes.extend_from_slice(&value.digest);
    }
    encode_dependency(&mut frontier_bytes, 5, observation);
    encode_dependency(&mut frontier_bytes, 6, joined_cut);
    frontier_bytes.extend_from_slice(&observation.identity);
    frontier_bytes.extend_from_slice(&observation.digest);
    encode_dependency(&mut frontier_bytes, 7, sample_projection);
    frontier_bytes.extend_from_slice(&joined_cut.identity);
    frontier_bytes.extend_from_slice(&joined_cut.digest);
    frontier_bytes.extend_from_slice(&0_u32.to_be_bytes());
    let frontier_identity = digest_bytes(FRONTIER_DOMAIN, &frontier_bytes);

    let mut facts_bytes = Vec::new();
    facts_bytes.extend_from_slice(&2_u16.to_be_bytes());
    facts_bytes.extend_from_slice(&request_identity);
    facts_bytes.extend_from_slice(&request_digest);
    facts_bytes.extend_from_slice(&pit_snapshot_identity);
    facts_bytes.extend_from_slice(&[9; 32]);
    facts_bytes.extend_from_slice(&50_u64.to_be_bytes());
    facts_bytes.extend_from_slice(&50_u64.to_be_bytes());
    facts_bytes.extend_from_slice(&60_u64.to_be_bytes());
    encode_bytes(&mut facts_bytes, b"clock");
    encode_bytes(&mut facts_bytes, b"epoch");
    facts_bytes.extend_from_slice(&replay_start_event_ns.to_be_bytes());
    facts_bytes.extend_from_slice(&replay_end_event_ns_exclusive.to_be_bytes());
    facts_bytes.extend_from_slice(&frontier_identity);
    facts_bytes.extend_from_slice(&0_u32.to_be_bytes());
    let facts_identity = digest_bytes(FACTS_DOMAIN, &facts_bytes);

    let mut receipt_bytes = Vec::new();
    receipt_bytes.extend_from_slice(&2_u16.to_be_bytes());
    receipt_bytes.extend_from_slice(&request_identity);
    receipt_bytes.extend_from_slice(&facts_identity);
    receipt_bytes.extend_from_slice(&frontier_identity);
    receipt_bytes.extend_from_slice(&[10; 32]);
    let receipt_identity = digest_bytes(RECEIPT_DOMAIN, &receipt_bytes);
    let mut row = StoredReplayMarketFactsRowV2 {
        facts_identity,
        meaning_identity: meaning_identity(
            request_identity,
            request_digest,
            pit_snapshot_identity,
            replay_start_event_ns,
            replay_end_event_ns_exclusive,
        ),
        composition_binding_identity: None,
        request_identity,
        request_digest,
        pit_snapshot_identity,
        replay_start_event_ns,
        replay_end_event_ns_exclusive,
        frontier_identity,
        receipt_identity,
        universe_selection,
        joined_cut,
        sample_projection,
        facts_bytes,
        frontier_bytes,
        receipt_bytes,
        custody_digest: [0; 32],
    };
    row.custody_digest = storage_digest(&row);
    assert_eq!(validate_stored_row_for_test(&row), Ok(()));
    row
}

fn dependency(seed: u8) -> super::postgres::OpaqueDependencyLocatorV2 {
    super::postgres::OpaqueDependencyLocatorV2 {
        identity: [seed; 32],
        digest: [seed + 20; 32],
    }
}

fn encode_dependency(
    bytes: &mut Vec<u8>,
    kind: u16,
    dependency: super::postgres::OpaqueDependencyLocatorV2,
) {
    bytes.extend_from_slice(&kind.to_be_bytes());
    bytes.extend_from_slice(&dependency.identity);
    bytes.extend_from_slice(&dependency.digest);
}

fn encode_bytes(bytes: &mut Vec<u8>, value: &[u8]) {
    bytes.extend_from_slice(
        &u32::try_from(value.len())
            .expect("bounded fixture")
            .to_be_bytes(),
    );
    bytes.extend_from_slice(value);
}
