use rstest::rstest;
use vibe_observability::{
    envelope::{
        CANONICAL_ENVELOPE_SCHEMA_V1, CanonicalEnvelope, EnvelopePolicy, EnvelopeViolation,
        FactNamespaces, FourTimes, OpaqueReference, OwnerEventEnvelope, PayloadPointer,
        RedactionClass, SignalKind, TelemetryEnvelope, TraceContext,
    },
    projection::{
        ApplyOutcome, Completeness, ProjectionError, ProjectionPolicy, ProjectionVisibility,
        QuarantineReason, SourceKey, SourceRebuildState, StatusProjection, TelemetryVisibility,
    },
};

const DIGEST_A: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST_B: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn canonical(
    kind: SignalKind,
    identity: &str,
    owner: &str,
    node: &str,
    observed_at: u64,
) -> CanonicalEnvelope {
    CanonicalEnvelope {
        schema_version: CANONICAL_ENVELOPE_SCHEMA_V1,
        signal_kind: kind,
        source_owner: owner.to_string(),
        source_node: node.to_string(),
        record_identity: identity.to_string(),
        correlation_identity: "correlation-a".to_string(),
        causation_identity: "causation-a".to_string(),
        idempotency_key: identity.to_string(),
        trace: TraceContext {
            trace_id: "trace-a".to_string(),
            span_id: "span-a".to_string(),
            parent_span_id: "root".to_string(),
        },
        namespaces: FactNamespaces {
            strategy: Some("strategy-a".to_string()),
            generation: Some("generation-1".to_string()),
            ..FactNamespaces::default()
        },
        times: FourTimes {
            event_at_epoch_ms: observed_at.saturating_sub(3),
            initialized_at_epoch_ms: observed_at.saturating_sub(2),
            observed_at_epoch_ms: observed_at,
            available_at_epoch_ms: observed_at.saturating_add(1),
        },
        clock_epoch: "clock-1".to_string(),
        outcome_category: Some("COMMITTED".to_string()),
        error_category: None,
        payload: PayloadPointer {
            digest: DIGEST_A.to_string(),
            opaque_reference: OpaqueReference::new("opaque:owner-payload").unwrap(),
        },
        redaction_class: RedactionClass::Internal,
        collection_policy_version: "collection-policy-v1".to_string(),
    }
}

fn owner_event_on_node(
    identity: &str,
    owner: &str,
    node: &str,
    sequence: u64,
    observed_at: u64,
) -> OwnerEventEnvelope {
    OwnerEventEnvelope {
        canonical: canonical(
            SignalKind::CommittedOwnerEvent,
            identity,
            owner,
            node,
            observed_at,
        ),
        owner_sequence: sequence,
        source_cut: OpaqueReference::new(format!("opaque:{owner}:{node}:cut:{sequence}")).unwrap(),
        projection_valid_through_epoch_ms: observed_at.saturating_add(10),
        event_content_digest: DIGEST_A.to_string(),
        immutable_owner_fact_reference: OpaqueReference::new(format!(
            "opaque:{owner}:{node}:fact:{sequence}"
        ))
        .unwrap(),
        immutable_owner_fact_digest: DIGEST_A.to_string(),
    }
}

fn owner_event(identity: &str, owner: &str, sequence: u64, observed_at: u64) -> OwnerEventEnvelope {
    owner_event_on_node(identity, owner, "node-a", sequence, observed_at)
}

fn source_key(owner: &str, node: &str) -> SourceKey {
    SourceKey::new(owner, node).unwrap()
}

fn policy() -> ProjectionPolicy {
    ProjectionPolicy {
        max_event_identities: 32,
        max_owner_nodes: 8,
        max_quarantine_records: 8,
        ..ProjectionPolicy::default()
    }
}

#[rstest]
fn same_identity_with_changed_content_is_quarantined() {
    let mut projection = StatusProjection::new(policy());
    let original = owner_event("event-1", "Qualification", 1, 100);
    assert_eq!(
        projection.apply_owner_event(&original).unwrap(),
        ApplyOutcome::Applied
    );

    let mut conflict = owner_event("event-1", "Qualification", 1, 100);
    conflict.event_content_digest = DIGEST_B.to_string();
    assert_eq!(
        projection.apply_owner_event(&conflict).unwrap(),
        ApplyOutcome::Quarantined(QuarantineReason::IdentityContentConflict)
    );
    assert_eq!(projection.owner_state().owner_event_count(), 1);
    assert_eq!(projection.quarantine().len(), 1);
}

#[rstest]
fn caller_digest_cannot_mask_any_canonical_content_change() {
    let original = owner_event("event-1", "Qualification", 1, 100);
    let mut changed_observed = original.clone();
    changed_observed.canonical.times = FourTimes {
        event_at_epoch_ms: 397,
        initialized_at_epoch_ms: 398,
        observed_at_epoch_ms: 400,
        available_at_epoch_ms: 401,
    };
    changed_observed.projection_valid_through_epoch_ms = 410;

    let mut changed_valid_through = original.clone();
    changed_valid_through.projection_valid_through_epoch_ms = 1_000;

    let mut changed_fact = original.clone();
    changed_fact.immutable_owner_fact_reference =
        OpaqueReference::new("opaque:Qualification:node-a:fact:replacement").unwrap();

    let mut changed_source = original.clone();
    changed_source.canonical.source_node = "node-b".to_string();

    let mut changed_payload = original.clone();
    changed_payload.canonical.payload.digest = DIGEST_B.to_string();
    changed_payload.canonical.payload.opaque_reference =
        OpaqueReference::new("opaque:owner-payload-replacement").unwrap();

    let mut changed_namespace = original.clone();
    changed_namespace.canonical.namespaces.generation = Some("generation-2".to_string());

    let mut changed_cut = original.clone();
    changed_cut.source_cut = OpaqueReference::new("opaque:replacement-cut").unwrap();

    let conflicts = [
        changed_observed,
        changed_valid_through,
        changed_fact,
        changed_source,
        changed_payload,
        changed_namespace,
        changed_cut,
    ];
    assert!(
        conflicts
            .iter()
            .all(|event| event.event_content_digest == original.event_content_digest)
    );

    let mut projection = StatusProjection::new(policy());
    projection.apply_owner_event(&original).unwrap();

    for conflict in conflicts {
        assert_eq!(
            projection.apply_owner_event(&conflict).unwrap(),
            ApplyOutcome::Quarantined(QuarantineReason::IdentityContentConflict)
        );
    }
    assert_eq!(projection.owner_state().owner_event_count(), 1);
    assert_eq!(projection.quarantine().len(), 7);
}

#[rstest]
fn at_least_once_delivery_is_idempotent() {
    let mut projection = StatusProjection::new(policy());
    let event = owner_event("event-1", "Research", 1, 100);
    assert_eq!(
        projection.apply_owner_event(&event).unwrap(),
        ApplyOutcome::Applied
    );
    assert_eq!(
        projection.apply_owner_event(&event).unwrap(),
        ApplyOutcome::Duplicate
    );
    assert_eq!(projection.owner_state().owner_event_count(), 1);
    assert!(projection.quarantine().is_empty());
}

#[rstest]
fn stale_partial_rebuilding_and_unavailable_are_explicit_per_source() {
    let research = source_key("Research", "node-a");
    let mut projection = StatusProjection::new(policy());
    projection
        .apply_owner_event(&owner_event("event-1", "Research", 1, 100))
        .unwrap();
    assert_eq!(
        projection.global_status(105).sources()[&research].visibility(),
        ProjectionVisibility::Available
    );
    assert_eq!(
        projection.global_status(111).sources()[&research].visibility(),
        ProjectionVisibility::Stale
    );

    let mut partial = StatusProjection::new(policy());
    partial
        .apply_owner_event(&owner_event("event-1", "Research", 1, 100))
        .unwrap();
    partial
        .apply_owner_event(&owner_event("event-3", "Research", 3, 101))
        .unwrap();
    let partial_view = partial.global_status(102);
    assert_eq!(
        partial_view.sources()[&research].completeness(),
        Completeness::Partial
    );
    assert_eq!(partial_view.visibility(), ProjectionVisibility::Partial);

    projection.begin_rebuild().unwrap();
    let rebuilding = projection.global_status(105);
    assert_eq!(
        rebuilding.sources()[&research].rebuild_state(),
        SourceRebuildState::Rebuilding
    );
    assert_eq!(rebuilding.visibility(), ProjectionVisibility::Rebuilding);
    projection
        .apply_rebuild_event(&owner_event("event-1", "Research", 1, 100))
        .unwrap();
    projection.finish_rebuild().unwrap();
    projection
        .set_source_unavailable(research.clone(), true)
        .unwrap();
    assert_eq!(
        projection.global_status(105).sources()[&research].visibility(),
        ProjectionVisibility::Unavailable
    );
    assert_eq!(
        projection.global_status(105).visibility(),
        ProjectionVisibility::Unavailable
    );
}

#[rstest]
fn newer_source_cannot_mask_an_older_stale_source() {
    let research = source_key("Research", "node-a");
    let qualification = source_key("Qualification", "node-a");
    let mut projection = StatusProjection::new(policy());
    projection
        .apply_owner_event(&owner_event("research-1", "Research", 1, 100))
        .unwrap();
    projection
        .apply_owner_event(&owner_event("qualification-1", "Qualification", 1, 200))
        .unwrap();

    let view = projection.global_status(205);

    assert_eq!(
        view.sources()[&research].visibility(),
        ProjectionVisibility::Stale
    );
    assert_eq!(
        view.sources()[&qualification].visibility(),
        ProjectionVisibility::Available
    );
    assert_eq!(
        view.sources()[&research].valid_through_epoch_ms(),
        Some(110)
    );
    assert_eq!(
        view.sources()[&qualification].valid_through_epoch_ms(),
        Some(210)
    );
    assert_eq!(view.visibility(), ProjectionVisibility::Stale);
    assert_eq!(view.max_lag_ms(), Some(105));
}

#[rstest]
fn sequence_identity_and_completeness_are_scoped_by_owner_and_node() {
    let node_a = source_key("Research", "node-a");
    let node_b = source_key("Research", "node-b");
    let mut complete = StatusProjection::new(policy());
    assert_eq!(
        complete
            .apply_owner_event(&owner_event_on_node(
                "node-a-1", "Research", "node-a", 1, 100,
            ))
            .unwrap(),
        ApplyOutcome::Applied
    );
    assert_eq!(
        complete
            .apply_owner_event(&owner_event_on_node(
                "node-b-1", "Research", "node-b", 1, 101,
            ))
            .unwrap(),
        ApplyOutcome::Applied
    );
    let complete_view = complete.global_status(102);
    assert_eq!(
        complete_view.sources()[&node_a].completeness(),
        Completeness::Complete
    );
    assert_eq!(
        complete_view.sources()[&node_b].completeness(),
        Completeness::Complete
    );
    assert_eq!(complete_view.completeness(), Completeness::Complete);
    assert_eq!(
        complete_view.source_frontier()[&node_a].sequence(),
        complete_view.source_frontier()[&node_b].sequence()
    );
    assert_ne!(
        complete_view.source_frontier()[&node_a]
            .source_cut()
            .as_str(),
        complete_view.source_frontier()[&node_b]
            .source_cut()
            .as_str()
    );

    assert_eq!(
        complete
            .apply_owner_event(&owner_event_on_node(
                "node-a-alias",
                "Research",
                "node-a",
                1,
                102,
            ))
            .unwrap(),
        ApplyOutcome::Quarantined(QuarantineReason::SequenceIdentityConflict)
    );

    let mut gap = StatusProjection::new(policy());
    gap.apply_owner_event(&owner_event_on_node(
        "node-a-1", "Research", "node-a", 1, 100,
    ))
    .unwrap();
    gap.apply_owner_event(&owner_event_on_node(
        "node-b-2", "Research", "node-b", 2, 101,
    ))
    .unwrap();
    let gap_view = gap.global_status(102);
    assert_eq!(
        gap_view.sources()[&node_a].completeness(),
        Completeness::Complete
    );
    assert_eq!(
        gap_view.sources()[&node_b].completeness(),
        Completeness::Partial
    );
    assert_eq!(gap_view.visibility(), ProjectionVisibility::Partial);
}

#[rstest]
fn rebuild_preserves_each_source_frontier_until_exact_replacement() {
    let mut projection = StatusProjection::new(policy());
    let first = owner_event("event-1", "Research", 1, 100);
    let second = owner_event("event-2", "Research", 2, 101);
    projection.apply_owner_event(&first).unwrap();
    projection.apply_owner_event(&second).unwrap();
    let before = projection.owner_state();

    let target = projection.begin_rebuild().unwrap();
    assert_eq!(projection.global_status(102).source_frontier(), &target);
    assert_eq!(projection.owner_state(), before);
    projection.apply_rebuild_event(&first).unwrap();
    projection.apply_rebuild_event(&second).unwrap();
    projection.finish_rebuild().unwrap();

    assert_eq!(projection.owner_state(), before);
    assert_eq!(
        projection.global_status(102).visibility(),
        ProjectionVisibility::Available
    );
}

#[rstest]
fn rebuild_requires_the_full_frozen_event_checkpoint() {
    let research = source_key("Research", "node-a");
    let mut projection = StatusProjection::new(policy());
    let original = owner_event("event-1", "Research", 1, 100);
    projection.apply_owner_event(&original).unwrap();
    let before = projection.owner_state();
    assert_eq!(
        projection.global_status(200).sources()[&research].visibility(),
        ProjectionVisibility::Stale
    );

    projection.begin_rebuild().unwrap();
    let mut changed = original;
    changed.canonical.times = FourTimes {
        event_at_epoch_ms: 397,
        initialized_at_epoch_ms: 398,
        observed_at_epoch_ms: 400,
        available_at_epoch_ms: 401,
    };
    changed.projection_valid_through_epoch_ms = 1_000;
    changed.immutable_owner_fact_reference =
        OpaqueReference::new("opaque:Research:node-a:fact:replacement").unwrap();
    assert_eq!(
        projection.apply_rebuild_event(&changed).unwrap(),
        ApplyOutcome::Applied
    );

    assert_eq!(
        projection.finish_rebuild(),
        Err(ProjectionError::RebuildCheckpointMismatch)
    );
    assert_eq!(projection.owner_state(), before);
    assert_eq!(
        projection.global_status(200).sources()[&research].visibility(),
        ProjectionVisibility::Stale
    );
    assert_eq!(
        projection.global_status(200).sources()[&research].observed_at_epoch_ms(),
        Some(100)
    );
    assert_eq!(
        projection.global_status(200).sources()[&research].valid_through_epoch_ms(),
        Some(110)
    );
}

#[rstest]
fn identical_events_can_rebuild_out_of_order() {
    let mut projection = StatusProjection::new(policy());
    let first = owner_event("event-1", "Research", 1, 100);
    let second = owner_event("event-2", "Research", 2, 101);
    projection.apply_owner_event(&first).unwrap();
    projection.apply_owner_event(&second).unwrap();
    let before = projection.owner_state();

    projection.begin_rebuild().unwrap();
    projection.apply_rebuild_event(&second).unwrap();
    projection.apply_rebuild_event(&first).unwrap();
    projection.finish_rebuild().unwrap();

    assert_eq!(projection.owner_state(), before);
    assert_eq!(
        projection.global_status(102).visibility(),
        ProjectionVisibility::Available
    );
}

#[rstest]
fn in_progress_rebuild_survives_an_opaque_checkpoint_restart() {
    let mut projection = StatusProjection::new(policy());
    let first = owner_event("event-1", "Research", 1, 100);
    let second = owner_event("event-2", "Research", 2, 101);
    projection.apply_owner_event(&first).unwrap();
    projection.apply_owner_event(&second).unwrap();
    let published_before = projection.owner_state();

    projection.begin_rebuild().unwrap();
    projection.apply_rebuild_event(&second).unwrap();
    let checkpoint = projection.checkpoint();
    let mut restarted = StatusProjection::restore(policy(), checkpoint);

    assert_eq!(restarted.owner_state(), published_before);
    assert_eq!(
        restarted.global_status(102).visibility(),
        ProjectionVisibility::Rebuilding
    );
    restarted.apply_rebuild_event(&first).unwrap();
    restarted.finish_rebuild().unwrap();

    assert_eq!(restarted.owner_state(), published_before);
    assert_eq!(
        restarted.global_status(102).visibility(),
        ProjectionVisibility::Available
    );
}

#[rstest]
fn empty_unavailable_source_bookkeeping_is_part_of_the_checkpoint() {
    let unavailable = source_key("Execution", "node-cold");
    let mut projection = StatusProjection::new(policy());
    let event = owner_event("event-1", "Research", 1, 100);
    projection.apply_owner_event(&event).unwrap();
    projection
        .set_source_unavailable(unavailable.clone(), true)
        .unwrap();
    let before = projection.owner_state();

    projection.begin_rebuild().unwrap();
    projection.apply_rebuild_event(&event).unwrap();
    projection.finish_rebuild().unwrap();

    assert_eq!(projection.owner_state(), before);
    assert_eq!(
        projection.global_status(105).sources()[&unavailable].visibility(),
        ProjectionVisibility::Unavailable
    );
}

#[rstest]
fn an_empty_unavailable_checkpoint_rebuilds_without_inventing_owner_events() {
    let unavailable = source_key("Execution", "node-cold");
    let mut projection = StatusProjection::new(policy());
    projection
        .set_source_unavailable(unavailable.clone(), true)
        .unwrap();
    let before = projection.owner_state();

    assert!(projection.begin_rebuild().unwrap().is_empty());
    assert_eq!(
        projection.set_source_unavailable(unavailable.clone(), false),
        Err(ProjectionError::RebuildInProgress)
    );
    projection.finish_rebuild().unwrap();

    assert_eq!(projection.owner_state(), before);
    assert_eq!(projection.owner_state().owner_event_count(), 0);
    assert_eq!(
        projection.global_status(0).sources()[&unavailable].visibility(),
        ProjectionVisibility::Unavailable
    );
}

#[rstest]
fn rebuild_cannot_skip_an_earlier_owner_node_sequence() {
    let mut projection = StatusProjection::new(policy());
    projection
        .apply_owner_event(&owner_event("event-1", "Research", 1, 100))
        .unwrap();
    let second = owner_event("event-2", "Research", 2, 101);
    projection.apply_owner_event(&second).unwrap();
    projection.begin_rebuild().unwrap();

    projection.apply_rebuild_event(&second).unwrap();

    assert!(projection.finish_rebuild().is_err());
    assert_eq!(
        projection.global_status(102).visibility(),
        ProjectionVisibility::Rebuilding
    );
}

#[rstest]
fn rebuild_cannot_omit_a_second_node_frontier() {
    let node_a = owner_event_on_node("node-a-1", "Research", "node-a", 1, 100);
    let node_b = owner_event_on_node("node-b-1", "Research", "node-b", 1, 101);
    let mut projection = StatusProjection::new(policy());
    projection.apply_owner_event(&node_a).unwrap();
    projection.apply_owner_event(&node_b).unwrap();
    let before = projection.owner_state();
    let target = projection.begin_rebuild().unwrap();
    assert_eq!(target.len(), 2);

    projection.apply_rebuild_event(&node_a).unwrap();
    assert!(projection.finish_rebuild().is_err());
    assert_eq!(projection.owner_state(), before);

    projection.apply_rebuild_event(&node_b).unwrap();
    projection.finish_rebuild().unwrap();
    assert_eq!(projection.owner_state(), before);
}

#[rstest]
fn empty_telemetry_is_unavailable_and_loss_never_changes_owner_state() {
    let mut projection = StatusProjection::new(policy());
    assert_eq!(
        projection.global_status(0).telemetry_visibility(),
        TelemetryVisibility::Unavailable
    );
    projection
        .apply_owner_event(&owner_event("event-1", "Execution", 1, 100))
        .unwrap();
    let owner_before = projection.owner_state();
    let telemetry = TelemetryEnvelope {
        canonical: canonical(
            SignalKind::Telemetry,
            "observation-1",
            "Runtime",
            "node-a",
            100,
        ),
    };

    projection.observe_telemetry(&telemetry).unwrap();
    assert_eq!(
        projection.global_status(105).telemetry_visibility(),
        TelemetryVisibility::Available
    );
    projection.observe_telemetry_loss();

    assert_eq!(projection.owner_state(), owner_before);
    assert_eq!(
        projection.global_status(105).telemetry_visibility(),
        TelemetryVisibility::Unavailable
    );
}

#[rstest]
fn secret_protected_and_high_cardinality_inputs_are_quarantined() {
    let mut projection = StatusProjection::new(policy());
    let mut secret = owner_event("event-secret", "Research", 1, 100);
    secret.canonical.redaction_class = RedactionClass::Secret;
    assert_eq!(
        projection.apply_owner_event(&secret).unwrap(),
        ApplyOutcome::Quarantined(QuarantineReason::InvalidEnvelope(
            EnvelopeViolation::SecretData
        ))
    );
    let mut protected = owner_event("event-protected", "Qualification", 1, 100);
    protected.canonical.redaction_class = RedactionClass::ProtectedQualification;
    assert_eq!(
        projection.apply_owner_event(&protected).unwrap(),
        ApplyOutcome::Quarantined(QuarantineReason::InvalidEnvelope(
            EnvelopeViolation::ProtectedQualificationDetail
        ))
    );

    let mut bounded = policy();
    bounded.envelope = EnvelopePolicy {
        max_populated_namespaces: 1,
        ..EnvelopePolicy::default()
    };
    let mut projection = StatusProjection::new(bounded);
    assert_eq!(
        projection
            .apply_owner_event(&owner_event("event-wide", "Research", 1, 100))
            .unwrap(),
        ApplyOutcome::Quarantined(QuarantineReason::InvalidEnvelope(
            EnvelopeViolation::HighCardinalityNamespaces
        ))
    );
}

#[rstest]
fn canonical_telemetry_is_valid_but_remains_outside_owner_projection() {
    let mut projection = StatusProjection::new(policy());
    let telemetry = TelemetryEnvelope {
        canonical: canonical(
            SignalKind::Telemetry,
            "observation-1",
            "Runtime",
            "node-a",
            100,
        ),
    };
    let before = projection.owner_state();
    projection.observe_telemetry(&telemetry).unwrap();
    assert_eq!(projection.owner_state(), before);
}
