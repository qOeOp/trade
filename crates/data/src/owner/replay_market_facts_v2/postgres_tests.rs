use super::postgres::{
    REPLAY_MARKET_FACTS_SCHEMA_V2, ReplayMarketFactsPostgresErrorV2,
    classify_candidate_rows_for_test, negative_resolution_for_test, reseal_storage_row_for_test,
    sealed_storage_manifest_for_test, store_generation_identity_for_test,
    validate_storage_manifest_for_test, validate_stored_row_for_test,
};
use rstest::rstest;

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
    let v4_source = include_str!("../postgres/sample_projection_v4.rs");
    let role_set = include_str!("../strategy_design_role_set.rs");
    let migration = include_str!(
        "../../../../../product/rd-workbench/postgres-init/10-migrate-authority-custody.sh"
    );
    assert!(source.contains("replay_composition_issuances_v1"));
    assert!(source.contains("request_identity BYTEA PRIMARY KEY"));
    assert!(source.contains("request_meaning_digest BYTEA NOT NULL UNIQUE"));
    assert!(source.contains("response_bytes BYTEA NOT NULL"));
    assert!(source.contains("lock_issuance_identity"));
    assert!(source.contains("let authenticated_role_set = Self::resolve_role_set_attestation("));
    assert!(source.contains("let native_join = Self::resolve_native_join_attestation("));
    assert!(source.contains("validate_native_join_v4(&mut transaction, &native_join)"));
    assert!(source.contains("let mut reader_transaction = self\n            .rd_role_set_pool"));
    assert!(source.contains("verify_owner_domain_and_reader_challenge_v1("));
    assert!(source.contains("verify_market_challenge_v1("));
    assert!(source.contains("pg_try_advisory_xact_lock"));
    assert!(source.contains("if owner_backend != caller_backend"));
    assert!(source.contains("pg_control_system"));
    assert!(source.contains("pg_postmaster_start_time"));
    assert!(source.contains("pg_is_in_recovery"));
    assert!(source.contains("lock_composer_cut_v1("));
    assert!(source.contains(
        "FROM composer_owner_api.resolve_strategy_design_native_join_v1($1,$2,$3,$4,$5,$6,$7)"
    ));
    assert!(source.contains("async fn validate_replay_first_corpus_v1("));
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
            .find("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .expect("exact reader BEGIN")
            < issue_body
                .find("current_setting('transaction_read_only')")
                .expect("reader mode verification")
    );
    assert!(
        issue_body
            .find("current_setting('transaction_read_only')")
            .expect("reader mode verification")
            < issue_body
                .find("begin_owner_challenge_v1(")
                .expect("first reader challenge")
    );
    let market_challenge_key = issue_body
        .find("let market_challenge_key =")
        .expect("client-retained Market challenge key");
    let market_challenge = issue_body
        .find("begin_owner_challenge_with_key_v1(")
        .expect("atomic Market challenge acquisition");
    assert!(
        issue_body
            .find("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .expect("exact Market BEGIN")
            < market_challenge_key
    );
    assert!(market_challenge_key < market_challenge);
    assert!(
        market_challenge
            < issue_body
                .find("verify_owner_domain_and_reader_challenge_v1(")
                .expect("same-domain and reader challenge proof")
    );
    assert!(
        market_challenge
            < issue_body
                .find("verify_market_challenge_v1(")
                .expect("handoff consumes supplied challenge")
    );
    let market_outcome = issue_body
        .split("let outcome = Box::pin(async {")
        .nth(1)
        .expect("Market transaction outcome")
        .split("let market_terminal = transaction.commit().await;")
        .next()
        .expect("bounded Market transaction outcome");
    let market_cut = market_outcome
        .find("lock_composer_cut_v1(")
        .expect("Market Composer shared cut");
    let final_reader_liveness = market_outcome
        .find("verify_market_challenge_v1(")
        .expect("final reader liveness proof");
    let first_market_read = market_outcome
        .find("lock_issuance_identity(")
        .expect("first Market fact access");
    let first_market_write = market_outcome
        .find("persist_replay_composition_binding_in_transaction_v1")
        .expect("first Market write");
    assert!(market_cut < final_reader_liveness);
    assert!(final_reader_liveness < first_market_read);
    assert!(final_reader_liveness < first_market_write);
    assert!(
        issue_body
            .find("lock_composer_cut_v1(")
            .expect("Composer owner lock")
            < issue_body
                .find("recover_reference_fact_r0_in_transaction_v1")
                .expect("first Market fact read")
    );
    assert!(source.contains("rd_role_set_pool"));
    assert!(
        source.contains(
            ".begin_with(\"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY\")"
        )
    );
    assert!(source.contains(".begin_with(\"BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE\")"));
    assert!(source.contains("current_setting('transaction_isolation')"));
    assert!(source.contains("current_setting('transaction_read_only')"));
    assert!(source.contains("reader_isolation != \"repeatable read\""));
    assert!(source.contains("reader_read_only != \"on\""));
    let cut_source = migration
        .split("CREATE OR REPLACE FUNCTION composer_owner_api.lock_replay_composition_cut_v1")
        .nth(1)
        .expect("Composer replay cut facade")
        .split("ALTER FUNCTION composer_owner_api.lock_replay_composition_cut_v1")
        .next()
        .expect("bounded Composer replay cut facade");
    assert!(cut_source.contains("pg_advisory_xact_lock_shared"));
    assert!(cut_source.contains("session_user='market_data_owner'"));
    assert!(cut_source.contains("pg_try_advisory_xact_lock_shared"));
    assert!(cut_source.contains("RETURN 0"));
    assert!(!cut_source.contains("LOCK TABLE"));
    let commit_source = migration
        .split("CREATE OR REPLACE FUNCTION composer_owner_api.commit_develop_composer_v2")
        .nth(1)
        .expect("Composer commit facade")
        .split("ALTER FUNCTION composer_owner_api.commit_develop_composer_v2")
        .next()
        .expect("bounded Composer commit facade");
    assert!(
        commit_source
            .find("pg_advisory_xact_lock(")
            .expect("exclusive Composer writer key")
            < commit_source
                .find("INSERT INTO")
                .expect("first Composer write")
    );
    assert!(migration.contains("ALTER ROLE composer_owner NOLOGIN"));
    assert!(migration.contains("NOT bool_or(pg_catalog.has_table_privilege('rd_fact_writer',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))"));
    let native_issue_body = source
        .split("pub async fn issue_composer_native_join_v1")
        .nth(1)
        .expect("production native join issuance entry")
        .split("pub async fn recover_binding_v1")
        .next()
        .expect("bounded production native join issuance");
    assert!(
        native_issue_body
            .find("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            .expect("serializable Market transaction")
            < native_issue_body
                .find("verify_time_zone_custody_in_transaction_v1")
                .expect("transaction-bound Time Zone custody verification")
    );
    assert!(
        native_issue_body
            .find("verify_time_zone_custody_in_transaction_v1")
            .expect("transaction-bound Time Zone custody verification")
            < native_issue_body
                .find("load_strategy_input_joined_cut_custody_v1")
                .expect("joined-cut custody read")
    );
    assert!(
        native_issue_body
            .find("load_strategy_input_joined_cut_custody_v1")
            .expect("joined-cut custody read")
            < native_issue_body
                .find("validate_replay_first_corpus_claim_v1")
                .expect("exact six-role corpus validation")
    );
    assert!(
        native_issue_body
            .find("validate_replay_first_corpus_claim_v1")
            .expect("exact six-role corpus validation")
            < native_issue_body
                .find("persist_strategy_input_sample_projection_in_transaction_v4")
                .expect("same-transaction V4 write")
    );
    assert!(
        native_issue_body
            .find("persist_strategy_input_sample_projection_in_transaction_v4")
            .expect("same-transaction V4 write")
            < native_issue_body
                .find("transaction\n            .commit()")
                .expect("Market transaction commit")
    );
    assert!(!native_issue_body.contains("commit_strategy_input_sample_projection_v4"));
    let v4_persist = v4_source
        .split("pub(super) async fn persist_strategy_input_sample_projection_in_transaction_v4")
        .nth(1)
        .expect("caller-transaction V4 persistence")
        .split("async fn validate_joined_subject")
        .next()
        .expect("bounded V4 persistence body");
    assert!(
        v4_persist
            .find("strategy_input_sample_projection_outbox_v4")
            .expect("final V4 insert")
            < v4_persist
                .rfind("let stored = load(transaction, prepared.receipt_digest())")
                .expect("same-transaction exact custody reload")
    );
    assert!(v4_persist.contains("Ok(stored)"));
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
            .find("verify_market_challenge_v1(")
            .expect("live database handoff")
            < issue_body
                .find("persist_replay_composition_binding_in_transaction_v1")
                .expect("first Market write")
    );
    assert!(
        issue_body
            .find("validate_replay_first_corpus_v1(")
            .expect("Replay-specific first-corpus gate")
            < issue_body
                .find("persist_replay_composition_binding_in_transaction_v1")
                .expect("first Market write")
    );

    for coordinate in [
        "native_join.strategy_design_identity()",
        "native_join.join_identity()",
        "native_join.join_claim_digest()",
    ] {
        assert!(
            issue_body
                .find(coordinate)
                .expect("native Design/join binding")
                < issue_body
                    .find("persist_replay_composition_binding_in_transaction_v1")
                    .expect("first Market write")
        );
    }
}

#[rstest]
#[case(
    crate::owner::strategy_input_binding::MarketDataFieldSemantic::BarOpenPrice,
    crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
    1,
    crate::owner::bar_schedule::BarScheduleUnitV1::Minute,
    Some(0)
)]
#[case(
    crate::owner::strategy_input_binding::MarketDataFieldSemantic::BarHighPrice,
    crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
    1,
    crate::owner::bar_schedule::BarScheduleUnitV1::Minute,
    Some(1)
)]
#[case(
    crate::owner::strategy_input_binding::MarketDataFieldSemantic::BarLowPrice,
    crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
    1,
    crate::owner::bar_schedule::BarScheduleUnitV1::Minute,
    Some(2)
)]
#[case(
    crate::owner::strategy_input_binding::MarketDataFieldSemantic::BarClosePrice,
    crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
    1,
    crate::owner::bar_schedule::BarScheduleUnitV1::Minute,
    Some(3)
)]
#[case(
    crate::owner::strategy_input_binding::MarketDataFieldSemantic::BarClosePrice,
    crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
    1,
    crate::owner::bar_schedule::BarScheduleUnitV1::Hour,
    Some(4)
)]
#[case(
    crate::owner::strategy_input_binding::MarketDataFieldSemantic::BarClosePrice,
    crate::owner::bar_schedule::BarScheduleKindV1::ExchangeSession,
    1,
    crate::owner::bar_schedule::BarScheduleUnitV1::ExchangeSessionDay,
    Some(5)
)]
#[case(
    crate::owner::strategy_input_binding::MarketDataFieldSemantic::BarVolumeQuantity,
    crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
    1,
    crate::owner::bar_schedule::BarScheduleUnitV1::Minute,
    None
)]
#[case(
    crate::owner::strategy_input_binding::MarketDataFieldSemantic::BarClosePrice,
    crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
    5,
    crate::owner::bar_schedule::BarScheduleUnitV1::Minute,
    None
)]
fn replay_first_corpus_role_coordinate_is_closed(
    #[case] field: crate::owner::strategy_input_binding::MarketDataFieldSemantic,
    #[case] kind: crate::owner::bar_schedule::BarScheduleKindV1,
    #[case] step: u32,
    #[case] unit: crate::owner::bar_schedule::BarScheduleUnitV1,
    #[case] expected: Option<u8>,
) {
    assert_eq!(
        super::ReplayCompositionOwnerV1::replay_first_corpus_coordinate_for_test_v1(
            field, kind, step, unit,
        ),
        expected
    );
}

#[rstest]
fn replay_first_corpus_trigger_is_uniquely_minute_close() {
    use crate::owner::strategy_input_binding::MarketDataFieldSemantic;

    let minute_close = super::ReplayCompositionOwnerV1::replay_first_corpus_coordinate_for_test_v1(
        MarketDataFieldSemantic::BarClosePrice,
        crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
        1,
        crate::owner::bar_schedule::BarScheduleUnitV1::Minute,
    );
    let minute_open = super::ReplayCompositionOwnerV1::replay_first_corpus_coordinate_for_test_v1(
        MarketDataFieldSemantic::BarOpenPrice,
        crate::owner::bar_schedule::BarScheduleKindV1::FixedInterval,
        1,
        crate::owner::bar_schedule::BarScheduleUnitV1::Minute,
    );
    assert_eq!(minute_close, Some(3));
    assert_ne!(minute_open, minute_close);
}

#[rstest]
fn replay_first_corpus_rejects_duplicate_hour_without_session_day() {
    assert_eq!(
        super::ReplayCompositionOwnerV1::replay_first_corpus_set_for_test_v1(
            &[0, 1, 2, 3, 4, 4],
            true,
        ),
        Err(super::ReplayCompositionBindingErrorV1::IncompleteComposition)
    );
    assert_eq!(
        super::ReplayCompositionOwnerV1::replay_first_corpus_set_for_test_v1(
            &[0, 1, 2, 3, 4, 5],
            true,
        ),
        Ok(())
    );
}

#[rstest]
fn owner_transactions_are_explicitly_terminal_before_reader_release() {
    let source = include_str!("../postgres/replay_market_facts_v2.rs");
    let issue_body = source
        .split("pub async fn issue_binding_v1")
        .nth(1)
        .expect("positive issuance body")
        .split("async fn resolve_role_set_attestation")
        .next()
        .expect("bounded issuance body");
    let finalizer = issue_body
        .split("match outcome")
        .nth(1)
        .expect("single outer transaction finalizer");
    let success = finalizer
        .split("Err(operation_error) =>")
        .next()
        .expect("success terminal branch");
    assert!(
        success
            .find("let market_terminal = transaction.commit().await;")
            .expect("Market commit terminal")
            < success
                .find("reader_transaction\n                        .rollback()")
                .expect("reader release after Market commit")
    );
    assert!(success.contains("prove_market_transaction_terminal_v1("));
    assert!(
        success
            .find("reader_transaction\n                        .rollback()")
            .expect("reader release")
            < success
                .find("self.recover_issuance_v1(issuance_locator)")
                .expect("exact recovery after terminal proof and reader release")
    );
    assert!(success.contains("recovered.canonical_bytes() == response.canonical_bytes()"));
    let failure = finalizer
        .split("Err(operation_error) =>")
        .nth(1)
        .expect("failure terminal branch");
    assert!(
        failure
            .find("let market_terminal = transaction.rollback().await;")
            .expect("Market rollback terminal")
            < failure
                .find("reader_transaction\n                    .rollback()")
                .expect("reader release after Market rollback")
    );
    assert!(failure.contains("prove_market_transaction_terminal_v1("));
    assert!(failure.contains("Err(operation_error)"));
    let pre_domain = issue_body
        .split("if let Err(operation_error) = verify_owner_domain_and_reader_challenge_v1(")
        .nth(1)
        .expect("pre-domain failure branch")
        .split("let outcome =")
        .next()
        .expect("bounded pre-domain branch");
    assert!(pre_domain.contains("terminalize_market_before_domain_v1("));
    assert!(
        pre_domain
            .find("terminalize_market_before_domain_v1(")
            .expect("pre-domain Market terminalizer")
            < pre_domain
                .find("reader_transaction\n                .rollback()")
                .expect("reader release after pre-domain terminalizer")
    );
    let challenge_acquire_failure = issue_body
        .split("begin_owner_challenge_with_key_v1(")
        .nth(1)
        .expect("recoverable challenge acquisition")
        .split("if let Err(operation_error) = verify_owner_domain_and_reader_challenge_v1(")
        .next()
        .expect("bounded challenge acquisition failure branch");
    assert!(challenge_acquire_failure.contains("terminalize_market_before_domain_v1("));
    assert!(
        challenge_acquire_failure
            .find("terminalize_market_before_domain_v1(")
            .expect("lost challenge response terminalizer")
            < challenge_acquire_failure
                .find("reader_transaction")
                .expect("reader release after lost challenge response proof")
    );
    let handoff = source
        .split("async fn verify_market_challenge_v1")
        .nth(1)
        .expect("handoff verifier")
        .split("async fn lock_issuance_identity")
        .next()
        .expect("bounded handoff verifier");
    assert!(handoff.contains("market_challenge: &OwnerChallengeV1"));
    assert!(!handoff.contains("begin_owner_challenge_v1(market"));
    assert!(source.contains("async fn prove_market_transaction_terminal_v1"));
    assert!(source.contains("async fn prove_market_transaction_terminal_from_pool_v1"));
    assert!(source.contains("fn owner_challenge_key_v1("));
    assert!(source.contains("async fn begin_owner_challenge_with_key_v1("));
    assert!(
        source.contains("FROM (SELECT pg_catalog.pg_advisory_xact_lock($1)) AS challenge_lock")
    );
    let pre_domain_terminalizer = source
        .split("async fn terminalize_market_before_domain_v1")
        .nth(1)
        .expect("pre-domain Market terminalizer")
        .split("async fn try_acquire_market_challenge_v1")
        .next()
        .expect("bounded pre-domain terminalizer");
    assert!(pre_domain_terminalizer.contains("transaction.rollback().await.is_err()"));
    assert!(pre_domain_terminalizer.contains("prove_market_transaction_terminal_from_pool_v1("));
    assert!(source.contains("async fn try_acquire_market_challenge_v1"));
    assert!(source.contains("pg_catalog.pg_sleep(0.01)"));
    assert!(source.contains("pg_catalog.pg_try_advisory_xact_lock($1)"));
    let terminal_proof = source
        .split("async fn prove_market_transaction_terminal_v1")
        .nth(1)
        .expect("Market terminal proof")
        .split("async fn lock_issuance_identity")
        .next()
        .expect("bounded terminal proof source");
    assert!(terminal_proof.contains("loop {"));
    assert!(!terminal_proof.contains("for _ in"));
    assert!(!terminal_proof.contains("0.."));
}

#[rstest]
fn additive_v4_dependency_tag_does_not_rename_legacy_v2_tag_seven() {
    use crate::owner::replay_market_facts_v2::ReplayMarketDependencyKindV2;

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
            StrategyDesignJoinEntryV1, StrategyDesignJoinRoleV1, StrategyDesignNativeJoinReceiptV1,
            StrategyDesignRoleEntryV1, StrategyDesignRoleSetLocatorV1,
            StrategyDesignRoleSetReceiptV1,
        },
        strategy_input_joined_cut::{
            StrategyInputJoinRoleClaimV1, UntrustedStrategyInputJoinClaimV1,
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
    let role_identity = BindingDigest::from_untrusted_bytes([9; 32]);
    let second_role_identity = BindingDigest::from_untrusted_bytes([16; 32]);
    let design_identity = BindingDigest::from_untrusted_bytes([10; 32]);
    let join_identity = BindingDigest::from_untrusted_bytes([11; 32]);
    let claim = UntrustedStrategyInputJoinClaimV1 {
        strategy_design_identity: design_identity,
        join_semantic_id: "bar".into(),
        join_identity,
        alignment_semantic_id: "LATEST_NOT_AFTER".into(),
        trigger_input_id: "close".into(),
        max_staleness_ns: 60,
        roles: vec![
            StrategyInputJoinRoleClaimV1 {
                semantic_id: "open".into(),
                input_role_identity: second_role_identity,
            },
            StrategyInputJoinRoleClaimV1 {
                semantic_id: "close".into(),
                input_role_identity: role_identity,
            },
        ],
    };
    let role_set = StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
        locator.clone(),
        BindingDigest::from_untrusted_bytes([12; 32]),
        BindingDigest::from_untrusted_bytes([13; 32]),
        design_identity,
        locator.design_digest,
        BindingDigest::from_untrusted_bytes([14; 32]),
        vec![
            StrategyDesignRoleEntryV1 {
                role_identity,
                semantic_id: "close".into(),
                fact_class: "MARKET_DATA".into(),
                instrument: "XNAS:AAPL".into(),
                scope: "EXACT_INSTRUMENT".into(),
                field_semantic_id: "BAR_CLOSE_PRICE".into(),
                channel: "MARKET".into(),
                timeframe: "PT1M".into(),
                unit: "PRICE".into(),
                scale: 4,
                value_type: "I128".into(),
            },
            StrategyDesignRoleEntryV1 {
                role_identity: second_role_identity,
                semantic_id: "open".into(),
                fact_class: "MARKET_DATA".into(),
                instrument: "XNAS:AAPL".into(),
                scope: "EXACT_INSTRUMENT".into(),
                field_semantic_id: "BAR_OPEN_PRICE".into(),
                channel: "MARKET".into(),
                timeframe: "PT1M".into(),
                unit: "PRICE".into(),
                scale: 4,
                value_type: "I128".into(),
            },
        ],
        vec![StrategyDesignJoinEntryV1 {
            join_identity,
            semantic_id: "bar".into(),
            roles: vec![
                StrategyDesignJoinRoleV1 {
                    semantic_id: "open".into(),
                    role_identity: second_role_identity,
                },
                StrategyDesignJoinRoleV1 {
                    semantic_id: "close".into(),
                    role_identity,
                },
            ],
            alignment_semantic_id: "LATEST_NOT_AFTER".into(),
            trigger_input_id: "close".into(),
            max_staleness_ns: 60,
        }],
    )
    .unwrap();
    let capability = AuthenticatedComposerNativeJoinV1::from_owner_readback(
        UntrustedStrategyInputSampleProjectionLocatorV4::from_untrusted([5; 32]),
        BindingDigest::from_untrusted_bytes([6; 32]),
        BindingDigest::from_untrusted_bytes([7; 32]),
        BindingDigest::from_untrusted_bytes([8; 32]),
        &claim,
    );
    let receipt = StrategyDesignNativeJoinReceiptV1::from_market_owner(&role_set, &capability)
        .expect("native join attestation");
    let decoded = StrategyDesignNativeJoinReceiptV1::from_durable_attestation(
        &locator,
        receipt.canonical_bytes(),
        receipt.receipt_digest(),
    )
    .expect("exact durable attestation");
    assert_eq!(decoded, receipt);
    assert_eq!(
        decoded.joined_cut_digest(),
        BindingDigest::from_untrusted_bytes([6; 32])
    );
    assert_eq!(
        decoded.joined_cut_receipt_digest(),
        BindingDigest::from_untrusted_bytes([7; 32])
    );
    assert_ne!(
        decoded.joined_cut_digest(),
        decoded.joined_cut_receipt_digest()
    );
    let cross_design_role_set = StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
        locator.clone(),
        role_set.research_request_identity,
        role_set.intent_identity,
        BindingDigest::from_untrusted_bytes([15; 32]),
        role_set.design_digest,
        role_set.canonical_design_digest,
        role_set.roles.clone(),
        role_set.joins,
    )
    .unwrap();
    assert!(
        StrategyDesignNativeJoinReceiptV1::from_market_owner(&cross_design_role_set, &capability,)
            .is_err()
    );
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

#[tokio::test]
#[ignore = "requires the admitted disposable R&D Owner PostgreSQL topology"]
async fn postgres_replay_composition_owner_is_atomic_exact_and_observes_reader_market_transaction_overlap()
 {
    use std::{sync::Arc, time::Duration};

    use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

    use crate::owner::{
        correction_policy_projection::{CorrectionPolicyAuthenticatedInputsV1, project_first_v1},
        postgres::{
            MarketDataOwnerPostgres,
            tests::{
                persist_replay_alternate_r0_time_zone_fixture_v1,
                persist_replay_joined_projection_fixture_v1,
                persist_replay_reference_leaf_fixture_v1,
                persist_replay_unbound_r0_time_zone_fixture_v1,
                replay_composition_market_base_fixture_v1,
            },
        },
        replay_market_facts_v2::{
            AuthenticatedComposerNativeJoinV1, ReplayCompositionContentLocatorV1,
            ReplayCompositionLocatorOnlyIssuanceRequestV1, ReplayCompositionOwnerV1,
            ReplayCompositionRequestLocatorV1, UntrustedComposerNativeJoinRequestV1,
            composition::{
                ReplayCompositionBindingErrorV1, ReplayCompositionBindingIssuanceRequestV1,
            },
        },
        sample_projection_v4::UntrustedStrategyInputSampleProjectionLocatorV4,
        source_binding::BindingDigest,
        strategy_design_role_set::{
            StrategyDesignJoinEntryV1, StrategyDesignJoinRoleV1, StrategyDesignNativeJoinReceiptV1,
            StrategyDesignRoleEntryV1, StrategyDesignRoleSetLocatorV1,
            StrategyDesignRoleSetReceiptV1,
        },
    };

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let mutation = database.mutation();
    let market_mutation_pool = mutation.pool(CanonicalOwnerTestRoleV1::MarketDataOwner);
    let owner_url = database.database_url(CanonicalOwnerTestRoleV1::MarketDataOwner);
    let reader_url = database.database_url(CanonicalOwnerTestRoleV1::MarketDataReader);
    let admin = database.owner_topology_admin_pool();
    let can_create_schema: bool = sqlx::query_scalar(
        "SELECT pg_catalog.has_database_privilege(current_user,current_database(),'CREATE')",
    )
    .fetch_one(market_mutation_pool)
    .await
    .expect("Market runtime database privilege");
    assert!(!can_create_schema);
    let wrong_owner = MarketDataOwnerPostgres::connect(reader_url).await;
    assert!(matches!(
        wrong_owner,
        Err(crate::owner::source_binding::SourceBindingError::StoreUnavailable)
    ));
    let base = Box::pin(replay_composition_market_base_fixture_v1(owner_url)).await;
    let market = MarketDataOwnerPostgres::connect(owner_url).await.unwrap();
    let joined = Box::pin(persist_replay_joined_projection_fixture_v1(&market, &base)).await;
    ReplayCompositionOwnerV1::materialize_schema(owner_url)
        .await
        .unwrap();
    let leaves = Box::pin(persist_replay_reference_leaf_fixture_v1(&market, &base)).await;
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_ok()
    );
    sqlx::query("GRANT SELECT ON market_data_private.time_zone_facts_v1 TO PUBLIC")
        .execute(market_mutation_pool)
        .await
        .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_err()
    );
    sqlx::query("REVOKE SELECT ON market_data_private.time_zone_facts_v1 FROM PUBLIC")
        .execute(market_mutation_pool)
        .await
        .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_ok()
    );
    sqlx::query(
        "ALTER TABLE market_data_private.time_zone_receipts_v1
         RENAME TO time_zone_receipts_v1_missing",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_err()
    );
    sqlx::query(
        "ALTER TABLE market_data_private.time_zone_receipts_v1_missing
         RENAME TO time_zone_receipts_v1",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_ok()
    );
    sqlx::query(
        "ALTER TABLE market_data_private.time_zone_facts_v1
         RENAME COLUMN effective_until_ns TO effective_until_ns_missing",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_err()
    );
    sqlx::query(
        "ALTER TABLE market_data_private.time_zone_facts_v1
         RENAME COLUMN effective_until_ns_missing TO effective_until_ns",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_ok()
    );
    sqlx::query(
        "ALTER TABLE market_data_private.time_zone_state_v1
         DROP CONSTRAINT time_zone_state_v1_append_sequence_check",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_err()
    );
    sqlx::query(
        "ALTER TABLE market_data_private.time_zone_state_v1
         ADD CONSTRAINT time_zone_state_v1_substitution_probe_check CHECK(singleton)",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_err()
    );
    sqlx::query(
        "ALTER TABLE market_data_private.time_zone_state_v1
         DROP CONSTRAINT time_zone_state_v1_substitution_probe_check,
         ADD CONSTRAINT time_zone_state_v1_append_sequence_check CHECK(append_sequence>=0)",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_ok()
    );
    sqlx::query(
        "CREATE TABLE market_data_private.time_zone_inheritance_probe_v1 ()
         INHERITS (market_data_private.time_zone_state_v1)",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .is_err()
    );
    sqlx::query("DROP TABLE market_data_private.time_zone_inheritance_probe_v1")
        .execute(market_mutation_pool)
        .await
        .unwrap();
    let owner = Arc::new(
        ReplayCompositionOwnerV1::connect(owner_url, reader_url)
            .await
            .unwrap(),
    );
    let correction = project_first_v1(CorrectionPolicyAuthenticatedInputsV1 {
        source_binding: &base.source_readback,
        coordinates: &base.coordinates,
        r0_coordinate_identity: base.r0.record().identity(),
        r0_coordinate_digest: base.r0.record().digest(),
    })
    .unwrap();

    let composer_locator = StrategyDesignRoleSetLocatorV1 {
        schema_version: 2,
        request_identity: "w3-replay-composition-owner-v1".into(),
        operation_receipt_identity: d(216),
        artifact_locator: "artifact:w3-replay-composition-owner-v1".into(),
        artifact_identity: d(214),
        canonical_plan_digest: d(215),
        design_digest: d(213),
    };
    let roles = base
        .binding_requests
        .iter()
        .zip(&joined.join_claim.roles)
        .zip([
            ("MARKET_DATA.BAR.OPEN.PRICE.V1", "1M"),
            ("MARKET_DATA.BAR.HIGH.PRICE.V1", "1M"),
            ("MARKET_DATA.BAR.LOW.PRICE.V1", "1M"),
            ("MARKET_DATA.BAR.CLOSE.PRICE.V1", "1M"),
            ("MARKET_DATA.BAR.CLOSE.PRICE.V1", "1H"),
            ("MARKET_DATA.BAR.CLOSE.PRICE.V1", "1D"),
        ])
        .map(
            |((request, join_role), (field_semantic_id, timeframe))| StrategyDesignRoleEntryV1 {
                role_identity: request.input_role_identity,
                semantic_id: join_role.semantic_id.clone(),
                fact_class: "MARKET_DATA".into(),
                instrument: "AAPL".into(),
                scope: r#"{"kind":"EXACT_INSTRUMENT"}"#.into(),
                field_semantic_id: field_semantic_id.into(),
                channel: "MARKET".into(),
                timeframe: timeframe.into(),
                unit: "PRICE".into(),
                scale: 2,
                value_type: "I128".into(),
            },
        )
        .collect::<Vec<_>>();
    let join_entry = StrategyDesignJoinEntryV1 {
        join_identity: joined.join_claim.join_identity,
        semantic_id: joined.join_claim.join_semantic_id.clone(),
        roles: joined
            .join_claim
            .roles
            .iter()
            .map(|role| StrategyDesignJoinRoleV1 {
                semantic_id: role.semantic_id.clone(),
                role_identity: role.input_role_identity,
            })
            .collect(),
        alignment_semantic_id: joined.join_claim.alignment_semantic_id.clone(),
        trigger_input_id: joined.join_claim.trigger_input_id.clone(),
        max_staleness_ns: joined.join_claim.max_staleness_ns,
    };
    let role_set = StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
        composer_locator.clone(),
        base.binding_requests[0].research_request_identity,
        d(217),
        base.binding_requests[0].strategy_design_identity,
        d(213),
        d(218),
        roles,
        vec![join_entry],
    )
    .unwrap();
    let trigger_component = joined
        .joined
        .record()
        .joined_cut_receipt()
        .components()
        .iter()
        .find(|component| component.role_semantic_id() == joined.join_claim.trigger_input_id)
        .unwrap();
    assert_eq!(
        joined.joined.record().joined_cut_receipt().trigger_digest(),
        trigger_component.frame().trigger().digest()
    );
    assert_ne!(
        joined.joined.record().joined_cut_receipt().trigger_digest(),
        trigger_component.frame_digest()
    );
    let joined_digest = joined.joined.record().digest();
    let joined_receipt_digest = joined.joined.record().joined_cut_receipt().digest();
    assert_ne!(joined_digest, joined_receipt_digest);
    assert_eq!(
        joined.projection.subject_identity(),
        *joined_receipt_digest.as_bytes()
    );
    let native_request = UntrustedComposerNativeJoinRequestV1 {
        joined_cut_identity: joined.joined.record().identity(),
        joined_cut_digest: joined_digest,
        frame_projection_digests: joined.frame_projection_digests,
    };
    let native_capability = owner
        .issue_composer_native_join_v1(&native_request)
        .await
        .unwrap();
    assert_eq!(
        native_capability.locator().receipt_digest(),
        joined.projection.receipt_digest()
    );
    assert_eq!(native_capability.joined_cut_digest(), joined_digest);
    assert_eq!(
        native_capability.joined_cut_receipt_digest(),
        joined_receipt_digest
    );
    assert_eq!(
        native_capability
            .schedule_dependency_set_digest()
            .as_bytes(),
        &joined.projection.schedule_dependency_set_digest()
    );
    sqlx::query("GRANT SELECT ON market_data_private.time_zone_facts_v1 TO PUBLIC")
        .execute(market_mutation_pool)
        .await
        .unwrap();
    assert!(matches!(
        owner.issue_composer_native_join_v1(&native_request).await,
        Err(ReplayCompositionBindingErrorV1::ReplayV2Unavailable)
    ));
    sqlx::query("REVOKE SELECT ON market_data_private.time_zone_facts_v1 FROM PUBLIC")
        .execute(market_mutation_pool)
        .await
        .unwrap();
    let recovered_native_capability = owner
        .issue_composer_native_join_v1(&native_request)
        .await
        .unwrap();
    assert_eq!(
        recovered_native_capability.locator(),
        native_capability.locator()
    );
    let native_join =
        StrategyDesignNativeJoinReceiptV1::from_market_owner(&role_set, &native_capability)
            .unwrap();
    let cross_splice_capability = AuthenticatedComposerNativeJoinV1::from_owner_readback(
        UntrustedStrategyInputSampleProjectionLocatorV4::from_untrusted(
            joined.cross_splice_projection.receipt_digest(),
        ),
        joined_digest,
        joined.cross_splice_receipt_digest,
        BindingDigest::from_untrusted_bytes(
            joined
                .cross_splice_projection
                .schedule_dependency_set_digest(),
        ),
        &joined.join_claim,
    );
    let cross_splice_native_join =
        StrategyDesignNativeJoinReceiptV1::from_market_owner(&role_set, &cross_splice_capability)
            .unwrap();
    let mut cross_design_claim = joined.join_claim.clone();
    cross_design_claim.strategy_design_identity = d(240);
    cross_design_claim.join_identity = d(241);
    let mut cross_design_joins = role_set.joins.clone();
    cross_design_joins[0].join_identity = cross_design_claim.join_identity;
    let cross_design_role_set = StrategyDesignRoleSetReceiptV1::from_rd_owner_projection(
        composer_locator.clone(),
        role_set.research_request_identity,
        role_set.intent_identity,
        cross_design_claim.strategy_design_identity,
        role_set.design_digest,
        role_set.canonical_design_digest,
        role_set.roles.clone(),
        cross_design_joins,
    )
    .unwrap();
    let cross_design_capability = AuthenticatedComposerNativeJoinV1::from_owner_readback(
        UntrustedStrategyInputSampleProjectionLocatorV4::from_untrusted(
            joined.projection.receipt_digest(),
        ),
        joined_digest,
        joined_receipt_digest,
        BindingDigest::from_untrusted_bytes(joined.projection.schedule_dependency_set_digest()),
        &cross_design_claim,
    );
    let cross_design_native_join = StrategyDesignNativeJoinReceiptV1::from_market_owner(
        &cross_design_role_set,
        &cross_design_capability,
    )
    .unwrap();
    let mut composer_tx = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE composer_owner")
        .execute(&mut *composer_tx)
        .await
        .unwrap();
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))")
        .bind(&composer_locator.request_identity)
        .execute(&mut *composer_tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO composer_private.rd_develop_designs_v2(design_identity,canonical_bytes) VALUES($1,$2)")
        .bind(base.binding_requests[0].strategy_design_identity.as_bytes().as_slice()).bind(b"w3-design".as_slice()).execute(&mut *composer_tx).await.unwrap();
    sqlx::query("INSERT INTO composer_private.rd_develop_plans_v2(plan_digest,design_identity,canonical_bytes) VALUES($1,$2,$3)")
        .bind(composer_locator.canonical_plan_digest.as_bytes().as_slice()).bind(base.binding_requests[0].strategy_design_identity.as_bytes().as_slice()).bind(b"w3-plan".as_slice()).execute(&mut *composer_tx).await.unwrap();
    sqlx::query("INSERT INTO composer_private.rd_develop_artifacts_v2(artifact_identity,plan_digest,package_bytes) VALUES($1,$2,$3)")
        .bind(composer_locator.artifact_identity.as_bytes().as_slice()).bind(composer_locator.canonical_plan_digest.as_bytes().as_slice()).bind(b"w3-artifact".as_slice()).execute(&mut *composer_tx).await.unwrap();
    sqlx::query("INSERT INTO composer_private.rd_develop_operations_v2(request_identity,request_digest,research_request_identity,intent_identity,artifact_identity,canonical_receipt_bytes,response_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(&composer_locator.request_identity).bind(d(219).as_bytes().as_slice()).bind(role_set.research_request_identity.as_bytes().as_slice()).bind(role_set.intent_identity.as_bytes().as_slice()).bind(composer_locator.artifact_identity.as_bytes().as_slice()).bind(b"w3-operation".as_slice()).bind(b"w3-response".as_slice()).execute(&mut *composer_tx).await.unwrap();
    sqlx::query("INSERT INTO composer_private.rd_develop_strategy_design_role_set_attestations_v1(request_identity,composer_schema_version,operation_receipt_identity,artifact_locator,artifact_identity,canonical_plan_digest,design_digest,attestation_identity,attestation_digest,canonical_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
        .bind(&composer_locator.request_identity).bind(i32::from(composer_locator.schema_version)).bind(composer_locator.operation_receipt_identity.as_bytes().as_slice()).bind(&composer_locator.artifact_locator).bind(composer_locator.artifact_identity.as_bytes().as_slice()).bind(composer_locator.canonical_plan_digest.as_bytes().as_slice()).bind(composer_locator.design_digest.as_bytes().as_slice()).bind(role_set.receipt_identity().as_bytes().as_slice()).bind(role_set.receipt_digest().as_bytes().as_slice()).bind(role_set.canonical_bytes()).execute(&mut *composer_tx).await.unwrap();
    sqlx::query("INSERT INTO composer_private.rd_develop_strategy_design_native_joins_v1(request_identity,native_join_digest,projection_receipt_digest,joined_cut_digest,schedule_dependency_set_digest,canonical_bytes) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(&composer_locator.request_identity).bind(native_join.receipt_digest().as_bytes().as_slice()).bind(native_join.projection_receipt_digest().as_bytes().as_slice()).bind(native_join.joined_cut_digest().as_bytes().as_slice()).bind(native_join.schedule_dependency_set_digest().as_bytes().as_slice()).bind(native_join.canonical_bytes()).execute(&mut *composer_tx).await.unwrap();
    composer_tx.commit().await.unwrap();

    let reader_pool = mutation.pool(CanonicalOwnerTestRoleV1::MarketDataReader);
    let mut reader_cut = reader_pool.begin().await.unwrap();
    let reader_backend: i64 =
        sqlx::query_scalar("SELECT composer_owner_api.lock_replay_composition_cut_v1($1)")
            .bind(&composer_locator.request_identity)
            .fetch_one(&mut *reader_cut)
            .await
            .unwrap();
    assert!(reader_backend > 0);
    let (writer_backend_sender, writer_backend_receiver) = tokio::sync::oneshot::channel();
    let writer_admin = admin.clone();
    let writer_request_identity = composer_locator.request_identity.clone();

    let queued_writer = tokio::spawn(async move {
        let mut writer = writer_admin.begin().await.unwrap();
        sqlx::query("SET LOCAL ROLE composer_owner")
            .execute(&mut *writer)
            .await
            .unwrap();
        let writer_backend: i32 = sqlx::query_scalar("SELECT pg_catalog.pg_backend_pid()")
            .fetch_one(&mut *writer)
            .await
            .unwrap();
        writer_backend_sender.send(writer_backend).unwrap();
        sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))")
            .bind(writer_request_identity)
            .execute(&mut *writer)
            .await
            .unwrap();
        writer.commit().await.unwrap();
    });
    let writer_backend = writer_backend_receiver.await.unwrap();

    for _ in 0..100 {
        let writer_is_queued: bool = sqlx::query_scalar(
            "SELECT EXISTS(
               SELECT 1 FROM pg_catalog.pg_locks
                WHERE pid=$1 AND locktype='advisory' AND mode='ExclusiveLock' AND NOT granted
             )",
        )
        .bind(writer_backend)
        .fetch_one(admin)
        .await
        .unwrap();

        if writer_is_queued {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let writer_is_queued: bool = sqlx::query_scalar(
        "SELECT EXISTS(
           SELECT 1 FROM pg_catalog.pg_locks
            WHERE pid=$1 AND locktype='advisory' AND mode='ExclusiveLock' AND NOT granted
         )",
    )
    .bind(writer_backend)
    .fetch_one(admin)
    .await
    .unwrap();
    assert!(writer_is_queued, "exclusive Composer writer must be queued");
    let mut market_cut = market_mutation_pool.begin().await.unwrap();
    let market_backend: i64 = tokio::time::timeout(
        Duration::from_secs(1),
        sqlx::query_scalar("SELECT composer_owner_api.lock_replay_composition_cut_v1($1)")
            .bind(&composer_locator.request_identity)
            .fetch_one(&mut *market_cut),
    )
    .await
    .expect("Market shared-cut attempt must return without waiting for the queued writer")
    .unwrap();
    assert_eq!(market_backend, 0);
    market_cut.rollback().await.unwrap();
    assert!(!queued_writer.is_finished());
    reader_cut.rollback().await.unwrap();
    tokio::time::timeout(Duration::from_secs(1), queued_writer)
        .await
        .expect("exclusive Composer writer completes after reader cut release")
        .unwrap();

    let semantics_receipt = base.semantics.receipt();
    let composition = ReplayCompositionBindingIssuanceRequestV1::from_test_fixture(
        composer_locator.clone(),
        base.pit.receipt().locator().clone(),
        base.source.receipt().locator().clone(),
        50,
        51,
        ReplayCompositionRequestLocatorV1::from_untrusted(
            base.instrument.cut().request_identity,
            base.instrument.cut().request_meaning_digest,
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            base.universe.receipt().request_identity(),
            base.universe.receipt().request_meaning_digest(),
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            joined.census_request.request_identity(),
            joined.census_request.request_meaning_digest(),
        ),
        ReplayCompositionContentLocatorV1::from_untrusted(joined_digest, joined_digest),
        ReplayCompositionContentLocatorV1::from_untrusted(
            BindingDigest::from_untrusted_bytes(joined.projection.receipt_digest()),
            BindingDigest::from_untrusted_bytes(joined.projection.receipt_digest()),
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            base.r0.receipt().request_identity,
            base.r0.receipt().request_meaning_digest,
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            leaves.calendar_request.request_identity(),
            leaves.calendar_request.request_meaning_digest(),
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            leaves.session_request.request_identity,
            leaves.session_request_meaning_digest,
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            leaves.time_zone_request.request_identity,
            crate::owner::time_zone::authority::request_meaning_digest_v1(
                &leaves.time_zone_request,
            )
            .unwrap(),
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            semantics_receipt.request_identity,
            semantics_receipt.request_meaning_digest,
        ),
        ReplayCompositionContentLocatorV1::from_untrusted(
            correction.identity(),
            correction.identity(),
        ),
        ReplayCompositionRequestLocatorV1::from_untrusted(
            leaves.corporate_action_request.request_identity,
            leaves.corporate_action_request.request_meaning_digest,
        ),
    );
    let command = ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(220), composition).unwrap();
    let composition_with_sample_projection =
        |sample_projection_locator: ReplayCompositionContentLocatorV1| {
            ReplayCompositionBindingIssuanceRequestV1::from_test_fixture(
                command.composition().composer_locator().clone(),
                command.composition().pit_locator().clone(),
                command.composition().source_binding_locator().clone(),
                command.composition().replay_start_event_ns(),
                command.composition().replay_end_event_ns_exclusive(),
                command.composition().instrument_master_locator(),
                command.composition().universe_selection_locator(),
                command.composition().observation_census_locator(),
                command.composition().joined_cut_locator(),
                sample_projection_locator,
                command.composition().reference_fact_r0_locator(),
                command.composition().calendar_locator(),
                command.composition().session_locator(),
                command.composition().time_zone_locator(),
                command.composition().market_semantics_locator(),
                command.composition().correction_policy_locator(),
                command.composition().corporate_action_locator(),
            )
        };
    let before = replay_positive_state(market_mutation_pool).await;
    let composition_with_time_zone = |time_zone_locator: ReplayCompositionRequestLocatorV1| {
        ReplayCompositionBindingIssuanceRequestV1::from_test_fixture(
            command.composition().composer_locator().clone(),
            command.composition().pit_locator().clone(),
            command.composition().source_binding_locator().clone(),
            command.composition().replay_start_event_ns(),
            command.composition().replay_end_event_ns_exclusive(),
            command.composition().instrument_master_locator(),
            command.composition().universe_selection_locator(),
            command.composition().observation_census_locator(),
            command.composition().joined_cut_locator(),
            command.composition().sample_projection_locator(),
            command.composition().reference_fact_r0_locator(),
            command.composition().calendar_locator(),
            command.composition().session_locator(),
            time_zone_locator,
            command.composition().market_semantics_locator(),
            command.composition().correction_policy_locator(),
            command.composition().corporate_action_locator(),
        )
    };
    let alternate_time_zone =
        persist_replay_alternate_r0_time_zone_fixture_v1(&market, &base, d(243), d(250), d(251))
            .await;
    let alternate_time_zone_composition =
        composition_with_time_zone(ReplayCompositionRequestLocatorV1::from_untrusted(
            alternate_time_zone.request_identity,
            alternate_time_zone.request_meaning_digest,
        ));
    let alternate_time_zone_command =
        ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(252), alternate_time_zone_composition)
            .unwrap();
    assert_eq!(
        owner.issue_binding_v1(&alternate_time_zone_command).await,
        Err(ReplayCompositionBindingErrorV1::DependencyMismatch)
    );
    assert_eq!(replay_positive_state(market_mutation_pool).await, before);
    let wrong_digest_time_zone = persist_replay_unbound_r0_time_zone_fixture_v1(
        &market,
        &base,
        d(234),
        d(233),
        base.native_r0.receipt().request_identity,
        base.native_r0.receipt().request_meaning_digest,
        base.native_r0.record().identity(),
        d(235),
    )
    .await;
    let missing_r0_time_zone = persist_replay_unbound_r0_time_zone_fixture_v1(
        &market,
        &base,
        d(236),
        d(240),
        d(237),
        d(238),
        d(239),
        d(239),
    )
    .await;

    for (issuance_identity, locator) in [
        (d(230), wrong_digest_time_zone),
        (d(231), missing_r0_time_zone),
    ] {
        let composition =
            composition_with_time_zone(ReplayCompositionRequestLocatorV1::from_untrusted(
                locator.request_identity,
                locator.request_meaning_digest,
            ));
        let request =
            ReplayCompositionLocatorOnlyIssuanceRequestV1::new(issuance_identity, composition)
                .unwrap();
        assert_eq!(
            owner.issue_binding_v1(&request).await,
            Err(ReplayCompositionBindingErrorV1::DependencyMismatch)
        );
        assert_eq!(replay_positive_state(market_mutation_pool).await, before);
    }
    let mut cross_design_tx = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE composer_owner")
        .execute(&mut *cross_design_tx)
        .await
        .unwrap();
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))")
        .bind(&composer_locator.request_identity)
        .execute(&mut *cross_design_tx)
        .await
        .unwrap();
    sqlx::query("UPDATE composer_private.rd_develop_strategy_design_native_joins_v1 SET native_join_digest=$1,projection_receipt_digest=$2,joined_cut_digest=$3,schedule_dependency_set_digest=$4,canonical_bytes=$5 WHERE request_identity=$6")
        .bind(cross_design_native_join.receipt_digest().as_bytes().as_slice())
        .bind(cross_design_native_join.projection_receipt_digest().as_bytes().as_slice())
        .bind(cross_design_native_join.joined_cut_digest().as_bytes().as_slice())
        .bind(cross_design_native_join.schedule_dependency_set_digest().as_bytes().as_slice())
        .bind(cross_design_native_join.canonical_bytes())
        .bind(&composer_locator.request_identity)
        .execute(&mut *cross_design_tx)
        .await
        .unwrap();
    cross_design_tx.commit().await.unwrap();
    let cross_design =
        ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(242), command.composition().clone())
            .unwrap();
    assert!(owner.issue_binding_v1(&cross_design).await.is_err());
    assert_eq!(replay_positive_state(market_mutation_pool).await, before);

    let mut cross_splice_tx = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE composer_owner")
        .execute(&mut *cross_splice_tx)
        .await
        .unwrap();
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))")
        .bind(&composer_locator.request_identity)
        .execute(&mut *cross_splice_tx)
        .await
        .unwrap();
    sqlx::query("UPDATE composer_private.rd_develop_strategy_design_native_joins_v1 SET native_join_digest=$1,projection_receipt_digest=$2,joined_cut_digest=$3,schedule_dependency_set_digest=$4,canonical_bytes=$5 WHERE request_identity=$6")
        .bind(cross_splice_native_join.receipt_digest().as_bytes().as_slice())
        .bind(cross_splice_native_join.projection_receipt_digest().as_bytes().as_slice())
        .bind(cross_splice_native_join.joined_cut_digest().as_bytes().as_slice())
        .bind(cross_splice_native_join.schedule_dependency_set_digest().as_bytes().as_slice())
        .bind(cross_splice_native_join.canonical_bytes())
        .bind(&composer_locator.request_identity)
        .execute(&mut *cross_splice_tx)
        .await
        .unwrap();
    cross_splice_tx.commit().await.unwrap();
    let cross_splice_projection_digest =
        BindingDigest::from_untrusted_bytes(joined.cross_splice_projection.receipt_digest());
    let cross_splice = ReplayCompositionLocatorOnlyIssuanceRequestV1::new(
        d(254),
        composition_with_sample_projection(ReplayCompositionContentLocatorV1::from_untrusted(
            cross_splice_projection_digest,
            cross_splice_projection_digest,
        )),
    )
    .unwrap();
    assert!(owner.issue_binding_v1(&cross_splice).await.is_err());
    assert_eq!(replay_positive_state(market_mutation_pool).await, before);

    let mut correct_day_tx = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE composer_owner")
        .execute(&mut *correct_day_tx)
        .await
        .unwrap();
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))")
        .bind(&composer_locator.request_identity)
        .execute(&mut *correct_day_tx)
        .await
        .unwrap();
    sqlx::query("UPDATE composer_private.rd_develop_strategy_design_native_joins_v1 SET native_join_digest=$1,projection_receipt_digest=$2,joined_cut_digest=$3,schedule_dependency_set_digest=$4,canonical_bytes=$5 WHERE request_identity=$6")
        .bind(native_join.receipt_digest().as_bytes().as_slice())
        .bind(native_join.projection_receipt_digest().as_bytes().as_slice())
        .bind(native_join.joined_cut_digest().as_bytes().as_slice())
        .bind(native_join.schedule_dependency_set_digest().as_bytes().as_slice())
        .bind(native_join.canonical_bytes())
        .bind(&composer_locator.request_identity)
        .execute(&mut *correct_day_tx)
        .await
        .unwrap();
    correct_day_tx.commit().await.unwrap();

    let missing_composition = ReplayCompositionBindingIssuanceRequestV1::from_test_fixture(
        StrategyDesignRoleSetLocatorV1 {
            request_identity: "missing-w3-composer".into(),
            ..composer_locator.clone()
        },
        command.composition().pit_locator().clone(),
        command.composition().source_binding_locator().clone(),
        50,
        51,
        command.composition().instrument_master_locator(),
        command.composition().universe_selection_locator(),
        command.composition().observation_census_locator(),
        command.composition().joined_cut_locator(),
        command.composition().sample_projection_locator(),
        command.composition().reference_fact_r0_locator(),
        command.composition().calendar_locator(),
        command.composition().session_locator(),
        command.composition().time_zone_locator(),
        command.composition().market_semantics_locator(),
        command.composition().correction_policy_locator(),
        command.composition().corporate_action_locator(),
    );
    let missing =
        ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(221), missing_composition).unwrap();
    assert!(owner.issue_binding_v1(&missing).await.is_err());
    assert_eq!(replay_positive_state(market_mutation_pool).await, before);

    let mut splice_tx = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE composer_owner")
        .execute(&mut *splice_tx)
        .await
        .unwrap();
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))")
        .bind(&composer_locator.request_identity)
        .execute(&mut *splice_tx)
        .await
        .unwrap();
    let spliced = sqlx::query(
        "UPDATE composer_private.rd_develop_strategy_design_native_joins_v1
         SET native_join_digest=$1 WHERE request_identity=$2",
    )
    .bind(d(249).as_bytes().as_slice())
    .bind(&composer_locator.request_identity)
    .execute(&mut *splice_tx)
    .await
    .unwrap();
    assert_eq!(spliced.rows_affected(), 1);
    splice_tx.commit().await.unwrap();
    let cross_spliced =
        ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(223), command.composition().clone())
            .unwrap();
    assert!(owner.issue_binding_v1(&cross_spliced).await.is_err());
    assert_eq!(replay_positive_state(market_mutation_pool).await, before);
    let mut restore_tx = admin.begin().await.unwrap();
    sqlx::query("SET LOCAL ROLE composer_owner")
        .execute(&mut *restore_tx)
        .await
        .unwrap();
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))")
        .bind(&composer_locator.request_identity)
        .execute(&mut *restore_tx)
        .await
        .unwrap();
    let restored = sqlx::query(
        "UPDATE composer_private.rd_develop_strategy_design_native_joins_v1
         SET native_join_digest=$1 WHERE request_identity=$2",
    )
    .bind(native_join.receipt_digest().as_bytes().as_slice())
    .bind(&composer_locator.request_identity)
    .execute(&mut *restore_tx)
    .await
    .unwrap();
    assert_eq!(restored.rows_affected(), 1);
    restore_tx.commit().await.unwrap();

    sqlx::query(
        "CREATE FUNCTION market_data_private.terminate_replay_composition_issuance_commit_v1()
         RETURNS trigger LANGUAGE plpgsql AS $function$
         BEGIN
           PERFORM pg_catalog.pg_terminate_backend(pg_catalog.pg_backend_pid());
           RETURN NEW;
         END
         $function$",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE CONSTRAINT TRIGGER terminate_replay_composition_issuance_commit_v1
         AFTER INSERT ON market_data_private.replay_composition_issuances_v1
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION market_data_private.terminate_replay_composition_issuance_commit_v1()",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(owner.issue_binding_v1(&command).await.is_err());
    assert_eq!(replay_positive_state(market_mutation_pool).await, before);
    sqlx::query(
        "DROP TRIGGER terminate_replay_composition_issuance_commit_v1
         ON market_data_private.replay_composition_issuances_v1",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    sqlx::query(
        "DROP FUNCTION market_data_private.terminate_replay_composition_issuance_commit_v1()",
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();

    let mut blocker = market_mutation_pool.begin().await.unwrap();
    sqlx::query("SELECT 1 FROM market_data_private.reference_fact_r0_records_v1 WHERE request_identity=$1 FOR UPDATE")
        .bind(base.r0.receipt().request_identity.as_bytes().as_slice()).fetch_one(&mut *blocker).await.unwrap();
    let issue_owner = Arc::clone(&owner);
    let issue_command = command.clone();
    let issue = tokio::spawn(async move { issue_owner.issue_binding_v1(&issue_command).await });
    let mut observed_two_owner_transactions = false;

    for _ in 0..100 {
        let holders: i64 = sqlx::query_scalar("SELECT count(DISTINCT activity.usename) FROM pg_catalog.pg_locks lock_fact JOIN pg_catalog.pg_stat_activity activity ON activity.pid=lock_fact.pid WHERE lock_fact.locktype='advisory' AND lock_fact.granted AND activity.usename IN ('market_data_reader','market_data_owner')")
            .fetch_one(admin).await.unwrap();

        if holders == 2 {
            observed_two_owner_transactions = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(
        observed_two_owner_transactions,
        "reader and Market transactions overlap after handoff"
    );
    blocker.rollback().await.unwrap();
    let first = issue.await.unwrap().unwrap();
    let fresh_owner = ReplayCompositionOwnerV1::connect(owner_url, reader_url)
        .await
        .unwrap();
    let retry = fresh_owner.issue_binding_v1(&command).await.unwrap();
    let recovered = fresh_owner
        .recover_issuance_v1(command.issuance_locator())
        .await
        .unwrap();
    assert_eq!(first.canonical_bytes(), retry.canonical_bytes());
    assert_eq!(first.canonical_bytes(), recovered.canonical_bytes());
    let committed = replay_positive_state(market_mutation_pool).await;

    crate::owner::postgres::tests::advance_time_zone_head_and_verify_historical_recovery_v1(
        &market,
        &base,
        &leaves,
        d(223),
    )
    .await;
    let recovered_historical = fresh_owner.issue_binding_v1(&command).await.unwrap();
    assert_eq!(
        first.canonical_bytes(),
        recovered_historical.canonical_bytes()
    );

    let time_zone_lineage_root: Vec<u8> = sqlx::query_scalar(
        "SELECT lineage_root FROM market_data_private.time_zone_facts_v1 WHERE fact_identity=$1",
    )
    .bind(leaves.time_zone_fact_identity.as_bytes().as_slice())
    .fetch_one(market_mutation_pool)
    .await
    .unwrap();
    let current_time_zone_head: Vec<u8> = sqlx::query_scalar(
        "SELECT fact_identity FROM market_data_private.time_zone_heads_v1 WHERE lineage_root=$1",
    )
    .bind(&time_zone_lineage_root)
    .fetch_one(market_mutation_pool)
    .await
    .unwrap();
    let current_time_zone_catalog: Vec<u8> = sqlx::query_scalar(
        "SELECT catalog_entry_identity FROM market_data_private.time_zone_facts_v1 WHERE fact_identity=$1",
    )
    .bind(&current_time_zone_head)
    .fetch_one(market_mutation_pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.time_zone_heads_v1 SET fact_identity=$1 WHERE lineage_root=$2",
    )
    .bind(leaves.time_zone_fact_identity.as_bytes().as_slice())
    .bind(&time_zone_lineage_root)
    .execute(market_mutation_pool)
    .await
    .unwrap();
    let native_head_rollback_state = replay_positive_state(market_mutation_pool).await;
    assert!(fresh_owner.issue_binding_v1(&command).await.is_err());
    assert_eq!(
        replay_positive_state(market_mutation_pool).await,
        native_head_rollback_state
    );
    sqlx::query(
        "UPDATE market_data_private.time_zone_heads_v1 SET fact_identity=$1 WHERE lineage_root=$2",
    )
    .bind(&current_time_zone_head)
    .bind(&time_zone_lineage_root)
    .execute(market_mutation_pool)
    .await
    .unwrap();

    let time_zone_cut_identity: Vec<u8> = sqlx::query_scalar(
        "SELECT cut_identity FROM market_data_private.time_zone_cuts_v1 WHERE request_identity=$1",
    )
    .bind(
        leaves
            .time_zone_request
            .request_identity
            .as_bytes()
            .as_slice(),
    )
    .fetch_one(market_mutation_pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.time_zone_cut_facts_v1 SET fact_identity=$1 WHERE cut_identity=$2 AND ordinal=1",
    )
    .bind(&current_time_zone_head)
    .bind(&time_zone_cut_identity)
    .execute(market_mutation_pool)
    .await
    .unwrap();
    let cut_splice_state = replay_positive_state(market_mutation_pool).await;
    assert!(fresh_owner.issue_binding_v1(&command).await.is_err());
    assert_eq!(
        replay_positive_state(market_mutation_pool).await,
        cut_splice_state
    );
    sqlx::query(
        "UPDATE market_data_private.time_zone_cut_facts_v1 SET fact_identity=$1 WHERE cut_identity=$2 AND ordinal=1",
    )
    .bind(leaves.time_zone_fact_identity.as_bytes().as_slice())
    .bind(&time_zone_cut_identity)
    .execute(market_mutation_pool)
    .await
    .unwrap();

    sqlx::query(
        "UPDATE market_data_private.reference_fact_catalog_heads_v1
         SET correction_sequence=correction_sequence+1
         WHERE entry_identity=$1",
    )
    .bind(&current_time_zone_catalog)
    .execute(market_mutation_pool)
    .await
    .unwrap();
    let catalog_head_tamper =
        ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(224), command.composition().clone())
            .unwrap();
    assert!(
        fresh_owner
            .issue_binding_v1(&catalog_head_tamper)
            .await
            .is_err()
    );
    assert_eq!(replay_positive_state(market_mutation_pool).await, committed);
    sqlx::query(
        "UPDATE market_data_private.reference_fact_catalog_heads_v1
         SET correction_sequence=$1
         WHERE entry_identity=$2",
    )
    .bind(i64::try_from(leaves.time_zone_correction_sequence + 1).unwrap())
    .bind(&current_time_zone_catalog)
    .execute(market_mutation_pool)
    .await
    .unwrap();

    let catalog_effective_from: String = sqlx::query_scalar(
        "SELECT effective_from_ns
         FROM market_data_private.reference_fact_catalog_entries_v1
         WHERE entry_identity=$1",
    )
    .bind(
        leaves
            .time_zone_catalog_entry_identity
            .as_bytes()
            .as_slice(),
    )
    .fetch_one(market_mutation_pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.reference_fact_catalog_entries_v1
         SET effective_from_ns=(effective_from_ns::numeric+1)::text
         WHERE entry_identity=$1",
    )
    .bind(
        leaves
            .time_zone_catalog_entry_identity
            .as_bytes()
            .as_slice(),
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();
    let catalog_row_tamper =
        ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(225), command.composition().clone())
            .unwrap();
    assert!(
        fresh_owner
            .issue_binding_v1(&catalog_row_tamper)
            .await
            .is_err()
    );
    assert_eq!(replay_positive_state(market_mutation_pool).await, committed);
    sqlx::query(
        "UPDATE market_data_private.reference_fact_catalog_entries_v1
         SET effective_from_ns=$1
         WHERE entry_identity=$2",
    )
    .bind(catalog_effective_from)
    .bind(
        leaves
            .time_zone_catalog_entry_identity
            .as_bytes()
            .as_slice(),
    )
    .execute(market_mutation_pool)
    .await
    .unwrap();

    let native_predecessor: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT predecessor_identity
         FROM market_data_private.time_zone_facts_v1
         WHERE fact_identity=$1",
    )
    .bind(leaves.time_zone_fact_identity.as_bytes().as_slice())
    .fetch_one(market_mutation_pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE market_data_private.time_zone_facts_v1
         SET predecessor_identity=fact_identity
         WHERE fact_identity=$1",
    )
    .bind(leaves.time_zone_fact_identity.as_bytes().as_slice())
    .execute(market_mutation_pool)
    .await
    .unwrap();
    assert!(fresh_owner.issue_binding_v1(&command).await.is_err());
    assert_eq!(replay_positive_state(market_mutation_pool).await, committed);
    sqlx::query(
        "UPDATE market_data_private.time_zone_facts_v1
         SET predecessor_identity=$1
         WHERE fact_identity=$2",
    )
    .bind(native_predecessor)
    .bind(leaves.time_zone_fact_identity.as_bytes().as_slice())
    .execute(market_mutation_pool)
    .await
    .unwrap();

    let bad_r0 = ReplayCompositionBindingIssuanceRequestV1::from_test_fixture(
        composer_locator,
        command.composition().pit_locator().clone(),
        command.composition().source_binding_locator().clone(),
        50,
        51,
        command.composition().instrument_master_locator(),
        command.composition().universe_selection_locator(),
        command.composition().observation_census_locator(),
        command.composition().joined_cut_locator(),
        command.composition().sample_projection_locator(),
        ReplayCompositionRequestLocatorV1::from_untrusted(d(250), d(251)),
        command.composition().calendar_locator(),
        command.composition().session_locator(),
        command.composition().time_zone_locator(),
        command.composition().market_semantics_locator(),
        command.composition().correction_policy_locator(),
        command.composition().corporate_action_locator(),
    );
    let bad = ReplayCompositionLocatorOnlyIssuanceRequestV1::new(d(222), bad_r0).unwrap();
    assert!(fresh_owner.issue_binding_v1(&bad).await.is_err());
    assert_eq!(replay_positive_state(market_mutation_pool).await, committed);
}

async fn replay_positive_state(pool: &sqlx::PgPool) -> Vec<i64> {
    sqlx::query_scalar(
        "SELECT value FROM (VALUES
            (1, (SELECT count(*) FROM market_data_private.replay_composition_bindings_v1)),
            (2, (SELECT count(*) FROM market_data_private.replay_composition_binding_receipts_v1)),
            (3, (SELECT count(*) FROM market_data_private.replay_composition_binding_outbox_v1)),
            (4, (SELECT count(*) FROM market_data_private.replay_market_facts_v2)),
            (5, (SELECT count(*) FROM market_data_private.replay_market_facts_receipts_v2)),
            (6, (SELECT count(*) FROM market_data_private.replay_market_facts_outbox_v2)),
            (7, (SELECT count(*) FROM market_data_private.replay_composition_issuances_v1)),
            (8, (SELECT count(*) FROM market_data_private.observation_census_records_v1)),
            (9, (SELECT count(*) FROM market_data_private.observation_census_dependencies_v1)),
            (10, (SELECT count(*) FROM market_data_private.observation_census_outbox_v1)),
            (11, COALESCE((SELECT append_sequence FROM market_data_private.replay_market_facts_state_v2 WHERE singleton), 0)),
            (12, COALESCE((SELECT aggregate_count FROM market_data_private.observation_census_state_v1 WHERE singleton), 0))
        ) AS positive_state(ordinal, value)
        ORDER BY ordinal",
    )
    .fetch_all(pool)
    .await
    .unwrap()
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
