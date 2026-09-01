use sha2::{Digest, Sha256};
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
};
use vibe_strategy_factory::replay_execution_policy_v2::{
    REPLAY_EXECUTION_POLICY_FIELDS_V2, REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_DESCRIPTOR_V2,
    REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_ID_V2, REPLAY_EXECUTION_POLICY_SCHEMA_VERSION_V2,
    ReplayExecutionPolicyErrorV2, ReplayExecutionPolicyV2,
    replay_execution_policy_grammar_parser_digest_v2,
};

fn identity(value: &str) -> OpaqueIdentityV2 {
    OpaqueIdentityV2::try_from(value.to_owned()).expect("fixture identity")
}

fn versioned(value: &str) -> VersionedIdentityV2 {
    VersionedIdentityV2 {
        identity: identity(value),
        version: identity(&format!("{value}.v1")),
    }
}

fn content(value: &str, byte: char) -> ContentIdentityV2 {
    ContentIdentityV2 {
        identity: identity(value),
        digest: CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64)))
            .expect("fixture digest"),
    }
}

fn policy() -> ReplayExecutionPolicyV2 {
    ReplayExecutionPolicyV2 {
        runtime_kernel: versioned("runtime-kernel"),
        simulator: versioned("simulator"),
        cost: versioned("cost"),
        slippage: versioned("slippage"),
        capacity: versioned("capacity"),
        runner_operational_profile: versioned("runner-operational-profile"),
        diagnostic_policy: versioned("diagnostic-policy"),
        deterministic_seed: 0x0102_0304_0506_0708,
        window: ReplayWindowV2 {
            start_event_ns: 1_700_000_000_000_000_000,
            end_event_ns_exclusive: 1_700_000_060_000_000_000,
        },
        calendar: versioned("calendar"),
        session: versioned("session"),
        time_zone: versioned("time-zone"),
        correction_rule: versioned("correction-rule"),
        market_semantics: versioned("market-semantics"),
        replay_configuration: content("replay-configuration", 'a'),
        corporate_action_cut: content("corporate-action-cut", 'b'),
        historical_membership_cut: content("historical-membership-cut", 'c'),
    }
}

#[test]
fn descriptor_and_field_table_freeze_the_complete_policy_contract() {
    assert_eq!(REPLAY_EXECUTION_POLICY_SCHEMA_VERSION_V2, 2);
    assert_eq!(
        REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_ID_V2,
        "rd.replay-execution-policy.fixed-record-le.v2"
    );
    let expected_descriptor_digest: [u8; 32] =
        Sha256::digest(REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_DESCRIPTOR_V2.as_bytes()).into();
    assert_eq!(
        replay_execution_policy_grammar_parser_digest_v2(),
        expected_descriptor_digest
    );

    let rows: Vec<_> = REPLAY_EXECUTION_POLICY_FIELDS_V2
        .iter()
        .map(|row| (row.tag, row.name, row.width))
        .collect();
    assert_eq!(
        rows,
        vec![
            (1, "runtime_kernel", "u32 bytes + u32 bytes"),
            (2, "simulator", "u32 bytes + u32 bytes"),
            (3, "cost", "u32 bytes + u32 bytes"),
            (4, "slippage", "u32 bytes + u32 bytes"),
            (5, "capacity", "u32 bytes + u32 bytes"),
            (6, "runner_operational_profile", "u32 bytes + u32 bytes"),
            (7, "diagnostic_policy", "u32 bytes + u32 bytes"),
            (8, "deterministic_seed", "u64 little-endian"),
            (9, "window", "u64 little-endian + u64 little-endian"),
            (10, "calendar", "u32 bytes + u32 bytes"),
            (11, "session", "u32 bytes + u32 bytes"),
            (12, "time_zone", "u32 bytes + u32 bytes"),
            (13, "correction_rule", "u32 bytes + u32 bytes"),
            (14, "market_semantics", "u32 bytes + u32 bytes"),
            (15, "replay_configuration", "u32 bytes + u32 bytes"),
            (16, "corporate_action_cut", "u32 bytes + u32 bytes"),
            (17, "historical_membership_cut", "u32 bytes + u32 bytes"),
        ]
    );
}

#[test]
fn canonical_round_trip_is_byte_identical_and_digest_is_domain_separated() {
    let policy = policy();
    let bytes = policy.canonical_bytes().expect("canonical policy");
    let decoded = ReplayExecutionPolicyV2::parse_canonical(&bytes).expect("canonical parse");
    assert_eq!(decoded, policy);
    assert_eq!(decoded.canonical_bytes().expect("re-encode"), bytes);

    let mut hasher = Sha256::new();
    hasher.update(b"rd.replay-execution-policy.v2\0");
    hasher.update(&bytes);
    let expected_policy_digest: [u8; 32] = hasher.finalize().into();
    assert_eq!(
        policy.policy_digest().expect("policy digest"),
        expected_policy_digest
    );
}

#[test]
fn parser_rejects_unknown_duplicate_reordered_and_invalid_wire_fields() {
    let bytes = policy().canonical_bytes().expect("canonical policy");

    let mut unknown = bytes.clone();
    unknown[8] = 255;
    assert_eq!(
        ReplayExecutionPolicyV2::parse_canonical(&unknown),
        Err(ReplayExecutionPolicyErrorV2::UnknownField { tag: 255 })
    );

    let second_field_offset = next_field_offset(&bytes, 8);
    let mut duplicate = bytes.clone();
    duplicate[second_field_offset] = 1;
    assert_eq!(
        ReplayExecutionPolicyV2::parse_canonical(&duplicate),
        Err(ReplayExecutionPolicyErrorV2::DuplicateField { tag: 1 })
    );

    let mut reordered = bytes.clone();
    reordered[8] = 2;
    assert_eq!(
        ReplayExecutionPolicyV2::parse_canonical(&reordered),
        Err(ReplayExecutionPolicyErrorV2::NonCanonicalFieldOrder {
            expected: 1,
            actual: 2,
        })
    );

    let mut invalid_wire = bytes;
    invalid_wire[9] = 255;
    assert_eq!(
        ReplayExecutionPolicyV2::parse_canonical(&invalid_wire),
        Err(ReplayExecutionPolicyErrorV2::InvalidWireKind { actual: 255 })
    );
}

#[test]
fn parser_rejects_versions_lengths_trailing_bytes_and_invalid_window() {
    let bytes = policy().canonical_bytes().expect("canonical policy");

    let mut version = bytes.clone();
    version[4..6].copy_from_slice(&3_u16.to_le_bytes());
    assert_eq!(
        ReplayExecutionPolicyV2::parse_canonical(&version),
        Err(ReplayExecutionPolicyErrorV2::UnsupportedSchemaVersion { actual: 3 })
    );

    let mut overflow = bytes.clone();
    overflow[10..14].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_eq!(
        ReplayExecutionPolicyV2::parse_canonical(&overflow),
        Err(ReplayExecutionPolicyErrorV2::LengthOverflow)
    );

    let mut trailing = bytes;
    trailing.push(0);
    assert_eq!(
        ReplayExecutionPolicyV2::parse_canonical(&trailing),
        Err(ReplayExecutionPolicyErrorV2::TrailingBytes)
    );

    let mut invalid_window = policy();
    invalid_window.window.end_event_ns_exclusive = invalid_window.window.start_event_ns;
    assert_eq!(
        invalid_window.canonical_bytes(),
        Err(ReplayExecutionPolicyErrorV2::InvalidReplayWindow)
    );
}

fn next_field_offset(bytes: &[u8], offset: usize) -> usize {
    assert_eq!(bytes[offset + 1], 1, "fixture field must be versioned");
    let identity_length = u32::from_le_bytes(
        bytes[offset + 2..offset + 6]
            .try_into()
            .expect("identity length"),
    ) as usize;
    let version_length_offset = offset + 6 + identity_length;
    let version_length = u32::from_le_bytes(
        bytes[version_length_offset..version_length_offset + 4]
            .try_into()
            .expect("version length"),
    ) as usize;
    version_length_offset + 4 + version_length
}
