//! The SQL a COMPOSER_V3 claim's self-proof runs, without its lock clause.
//!
//! The reads themselves live in `composer_readback_v3`, which only the Composer-backed Replay build
//! compiles. The statements live here, outside that gate, so that the tests pinning them run in the
//! build that runs this crate's unit tests, which does not enable that feature. The locking readback
//! appends ` FOR SHARE` to each through [`PostgresReadLockMode::query`], and the report's lock-free
//! read appends nothing. Nothing else about the two differs, so a claim the report reads is checked
//! by exactly the statements the locking readback runs.
//!
//! In a build without the feature nothing reads them; the `expect(dead_code)` on each says so, and
//! stops holding the day one is read there.
//!
//! [`PostgresReadLockMode::query`]: crate::trial_family_postgres::PostgresReadLockMode::query

#[cfg_attr(
    all(not(feature = "sealed-source-intake-composer-acceptance"), not(test)),
    expect(
        dead_code,
        reason = "only the Composer-backed Replay build reads COMPOSER_V3 claims"
    )
)]
pub(crate) const STORED_FROZEN_READ_V3: &str = "SELECT source_kind,frozen_json FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1";
#[cfg_attr(
    all(not(feature = "sealed-source-intake-composer-acceptance"), not(test)),
    expect(
        dead_code,
        reason = "only the Composer-backed Replay build reads COMPOSER_V3 claims"
    )
)]
pub(crate) const STORED_CLAIM_READ_V3: &str = "SELECT request_identity,request_digest,source_kind,composer_source_json,build_request_identity,attempt_identity,intent_identity,trial_family_identity,artifact_identity,build_receipt_identity,artifact_family_binding_identity,census_frontier_identity,frozen_json,receipt_json,lifecycle_state,committed_at_epoch_ms,v2_canonical_request_bytes,v2_request_storage_digest,v2_meaning_digest,v2_seal_digest,v2_receipt_json,v2_receipt_storage_bytes,v2_receipt_storage_digest,request_schema_version FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1";
#[cfg_attr(
    all(not(feature = "sealed-source-intake-composer-acceptance"), not(test)),
    expect(
        dead_code,
        reason = "only the Composer-backed Replay build reads COMPOSER_V3 claims"
    )
)]
pub(crate) const OUTBOX_EVENT_READ_V3: &str = "SELECT event_identity,aggregate_identity,event_kind,payload_digest,payload_json,canonical_payload_bytes,canonical_payload_storage_digest,canonical_envelope_bytes,canonical_envelope_storage_digest,committed_at_epoch_ms FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind=$2";
#[cfg_attr(
    all(not(feature = "sealed-source-intake-composer-acceptance"), not(test)),
    expect(
        dead_code,
        reason = "only the Composer-backed Replay build reads COMPOSER_V3 claims"
    )
)]
pub(crate) const RESEARCH_TRANSITION_READ_V3: &str = "SELECT replay_request_identity,research_request_identity,intent_identity,transition_digest,old_view_json,new_view_json,transition_json,committed_at_epoch_ms FROM public.rd_research_view_transitions_v3 WHERE replay_request_identity=$1";
#[cfg(test)]
mod lock_mode_tests {
    use sha2::{Digest, Sha256};

    use super::*;
    use crate::trial_family_postgres::PostgresReadLockMode;

    fn sha256_hex(text: &str) -> String {
        Sha256::digest(text.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The locking readback sends exactly the SQL it sent before its reads took a lock mode. Each
    /// statement is pinned by the SHA-256 of the literal it replaced, `FOR SHARE` included.
    #[rstest::rstest]
    #[case::stored_frozen(
        STORED_FROZEN_READ_V3,
        "ef1adb9979bb8a48154bd668e4e218a255cbf2bc80ed3f6025c39234b2ae5b6f"
    )]
    #[case::stored_claim(
        STORED_CLAIM_READ_V3,
        "105daff7980518c8c62b4aa9d4ef03dbbb14590f13fce07900d20f3fad4ca74e"
    )]
    #[case::outbox_event(
        OUTBOX_EVENT_READ_V3,
        "db623dafee5f81fc625d5e3ec1784b95335e99669a3305d104f7c289754345db"
    )]
    #[case::research_transition(
        RESEARCH_TRANSITION_READ_V3,
        "2be93bd4c6efbf7f3669eda3985eee12f53de1e9028c806d11e3799a0c5a4055"
    )]
    fn the_locking_reads_are_byte_identical_to_the_ones_they_replaced(
        #[case] statement: &'static str,
        #[case] pinned: &str,
    ) {
        let locked = PostgresReadLockMode::ForShare.query(statement, " FOR SHARE");
        assert_eq!(sha256_hex(&locked.0), pinned);

        let unlocked = PostgresReadLockMode::Snapshot.query(statement, " FOR SHARE");
        assert_eq!(unlocked.0, statement, "the lock-free read adds nothing");
        assert_eq!(locked.0, format!("{statement} FOR SHARE"));
        assert!(
            !statement.contains(" FOR "),
            "the bare statement locks nothing"
        );
    }

    /// The two lock modes differ in the lock clause and nowhere else, in the module that runs them. A branch on the mode would let
    /// the report's lock-free read check less (or more) than the locking one, and a claim proven on
    /// one path would say nothing about the other.
    #[rstest::rstest]
    fn nothing_in_the_claim_reads_branches_on_the_lock_mode() {
        let normalized = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
        // The module that runs the reads. It holds no tests, so every line of it is production.
        let production = normalized(include_str!("composer_readback_v3.rs"));
        let branches = [
            "match lock_mode",
            "matches!(lock_mode",
            "lock_mode ==",
            "lock_mode !=",
            "if let PostgresReadLockMode",
            "PostgresReadLockMode::ForShare =>",
            "PostgresReadLockMode::Snapshot =>",
        ];
        // Positive control: each needle finds the branch it names in the form rustfmt writes it.
        for (needle, written) in branches.iter().zip([
            "match lock_mode {",
            "if matches!(lock_mode, PostgresReadLockMode::Snapshot) {",
            "if lock_mode == other {",
            "if lock_mode != other {",
            "if let PostgresReadLockMode::Snapshot = lock_mode {",
            "PostgresReadLockMode::ForShare => check(),",
            "PostgresReadLockMode::Snapshot => {}",
        ]) {
            assert!(
                normalized(written).contains(needle),
                "{needle} misses {written}"
            );
        }

        for needle in branches {
            assert!(
                !production.contains(needle),
                "the module branches on the lock mode: {needle}"
            );
        }
        assert_eq!(
            production.matches("lock_mode.query(").count(),
            5,
            "every read the claim's proof makes takes its lock clause from the mode"
        );
    }
}
