use rstest::rstest;
use vibe_portfolio::owner::portfolio_view::{
    PORTFOLIO_VIEW_SCHEMA_VERSION, PortfolioViewAvailability, PortfolioViewDependencyFailure,
    PortfolioViewDependencyKind, PortfolioViewDisposition, PortfolioViewMode,
    PortfolioViewReplayDisposition, PortfolioViewRequest, PortfolioViewResolution,
    PortfolioViewScopeField, PortfolioViewSourceOwner, UnavailablePortfolioView,
    UntrustedPrincipalClaim, UntrustedSourceDependencyLocator, classify_portfolio_view_replay,
    resolve_portfolio_view,
};

const PROJECTION_AT: u64 = 10_000;
const VALID_THROUGH: u64 = 20_000;
type RequestMutation = Box<dyn Fn(&mut PortfolioViewRequest)>;

fn owner(kind: PortfolioViewDependencyKind) -> PortfolioViewSourceOwner {
    match kind {
        PortfolioViewDependencyKind::ExecutionAccount
        | PortfolioViewDependencyKind::ExecutionOpenOrders
        | PortfolioViewDependencyKind::ExecutionFills
        | PortfolioViewDependencyKind::ExecutionFees
        | PortfolioViewDependencyKind::ExecutionSettlement => PortfolioViewSourceOwner::Execution,
        PortfolioViewDependencyKind::MarketPrice
        | PortfolioViewDependencyKind::MarketFx
        | PortfolioViewDependencyKind::MarketContract
        | PortfolioViewDependencyKind::MarketValuation
        | PortfolioViewDependencyKind::MarketLiquidity => PortfolioViewSourceOwner::MarketData,
        PortfolioViewDependencyKind::PortfolioSnapshot => PortfolioViewSourceOwner::Portfolio,
    }
}

fn kinds() -> [PortfolioViewDependencyKind; 11] {
    [
        PortfolioViewDependencyKind::ExecutionAccount,
        PortfolioViewDependencyKind::ExecutionOpenOrders,
        PortfolioViewDependencyKind::ExecutionFills,
        PortfolioViewDependencyKind::ExecutionFees,
        PortfolioViewDependencyKind::ExecutionSettlement,
        PortfolioViewDependencyKind::MarketPrice,
        PortfolioViewDependencyKind::MarketFx,
        PortfolioViewDependencyKind::MarketContract,
        PortfolioViewDependencyKind::MarketValuation,
        PortfolioViewDependencyKind::MarketLiquidity,
        PortfolioViewDependencyKind::PortfolioSnapshot,
    ]
}

fn request(mode: PortfolioViewMode) -> PortfolioViewRequest {
    let principal_identity = "principal-alpha".to_string();
    let account_identity = "account-alpha".to_string();
    let execution_scope_identity = "execution-scope-alpha".to_string();
    let authorization_policy_cut = "policy-cut-alpha".to_string();
    let common_cut_identity = "portfolio-common-cut-alpha".to_string();
    let source_dependencies = kinds()
        .into_iter()
        .enumerate()
        .map(|(index, kind)| UntrustedSourceDependencyLocator {
            kind,
            owner: owner(kind),
            locator_identity: format!("locator-{index}"),
            frontier_identity: format!("frontier-{index}"),
            frontier_sequence: index as u64 + 1,
            common_cut_identity: common_cut_identity.clone(),
            principal_identity: principal_identity.clone(),
            account_identity: account_identity.clone(),
            execution_scope_identity: execution_scope_identity.clone(),
            mode,
            authorization_policy_cut: authorization_policy_cut.clone(),
            observed_at_epoch_ms: 9_000,
            valid_through_epoch_ms: VALID_THROUGH,
        })
        .collect();
    PortfolioViewRequest {
        schema_version: PORTFOLIO_VIEW_SCHEMA_VERSION,
        request_identity: "portfolio-view-request-alpha".to_string(),
        principal_claim: UntrustedPrincipalClaim {
            claim_identity: "principal-claim-alpha".to_string(),
            issuer_identity: "operator-authorization-issuer".to_string(),
            principal_identity: principal_identity.clone(),
            account_identity: account_identity.clone(),
            execution_scope_identity: execution_scope_identity.clone(),
            mode,
            authorization_policy_cut: authorization_policy_cut.clone(),
            not_before_epoch_ms: 1_000,
            valid_through_epoch_ms: VALID_THROUGH,
        },
        principal_identity,
        account_identity,
        execution_scope_identity,
        mode,
        authorization_policy_cut,
        common_cut_identity,
        projection_at_epoch_ms: PROJECTION_AT,
        valid_through_epoch_ms: VALID_THROUGH,
        source_dependencies,
    }
}

fn unavailable(request: &PortfolioViewRequest) -> UnavailablePortfolioView {
    match resolve_portfolio_view(request) {
        PortfolioViewResolution::Available(_) => panic!("public resolver must not return positive"),
        PortfolioViewResolution::Unavailable(unavailable) => unavailable,
    }
}

#[rstest]
#[case(PortfolioViewMode::Paper)]
#[case(PortfolioViewMode::Live)]
fn direct_external_consumer_can_only_resolve_explicit_unavailable(#[case] mode: PortfolioViewMode) {
    let request = request(mode);
    let result = unavailable(&request);
    assert_eq!(result.schema_version(), 1);
    assert_eq!(
        result.availability(),
        PortfolioViewAvailability::Unavailable
    );
    assert_eq!(
        result.disposition(),
        PortfolioViewDisposition::SourceOwnerResolveUnavailable
    );
    assert_eq!(result.fingerprint(), &request.fingerprint());

    for owner in [
        PortfolioViewSourceOwner::Execution,
        PortfolioViewSourceOwner::MarketData,
        PortfolioViewSourceOwner::Portfolio,
    ] {
        assert!(
            result
                .failures()
                .contains(&PortfolioViewDependencyFailure::SourceOwnerResolveUnavailable { owner })
        );
    }

    for kind in kinds() {
        assert!(
            result
                .failures()
                .contains(&PortfolioViewDependencyFailure::CallerSuppliedSourceLocator { kind })
        );
    }
}

#[rstest]
fn exact_replay_is_order_independent_and_changed_meaning_conflicts() {
    let original = request(PortfolioViewMode::Paper);
    let mut reordered = original.clone();
    reordered.source_dependencies.reverse();
    assert_eq!(original.fingerprint(), reordered.fingerprint());
    assert_eq!(
        classify_portfolio_view_replay(&original, &reordered),
        PortfolioViewReplayDisposition::ExactReplay
    );

    let mut changed = original.clone();
    changed.source_dependencies[0].frontier_sequence += 1;
    assert_eq!(
        classify_portfolio_view_replay(&original, &changed),
        PortfolioViewReplayDisposition::Conflict
    );
    changed.request_identity = "portfolio-view-request-successor".to_string();
    assert_eq!(
        classify_portfolio_view_replay(&original, &changed),
        PortfolioViewReplayDisposition::DistinctRequest
    );
}

#[rstest]
fn every_authority_and_source_identity_coordinate_changes_digest() {
    let original = request(PortfolioViewMode::Paper);
    let original_digest = original.fingerprint().semantic_digest().to_string();
    let mutations: Vec<RequestMutation> = vec![
        Box::new(|value| value.schema_version += 1),
        Box::new(|value| value.request_identity.push_str("-changed")),
        Box::new(|value| value.principal_claim.claim_identity.push_str("-changed")),
        Box::new(|value| value.principal_claim.issuer_identity.push_str("-changed")),
        Box::new(|value| {
            value
                .principal_claim
                .principal_identity
                .push_str("-changed");
        }),
        Box::new(|value| value.principal_claim.account_identity.push_str("-changed")),
        Box::new(|value| {
            value
                .principal_claim
                .execution_scope_identity
                .push_str("-changed");
        }),
        Box::new(|value| value.principal_claim.mode = PortfolioViewMode::Live),
        Box::new(|value| {
            value
                .principal_claim
                .authorization_policy_cut
                .push_str("-changed");
        }),
        Box::new(|value| value.principal_claim.not_before_epoch_ms += 1),
        Box::new(|value| value.principal_claim.valid_through_epoch_ms += 1),
        Box::new(|value| value.principal_identity.push_str("-changed")),
        Box::new(|value| value.account_identity.push_str("-changed")),
        Box::new(|value| value.execution_scope_identity.push_str("-changed")),
        Box::new(|value| value.mode = PortfolioViewMode::Live),
        Box::new(|value| value.authorization_policy_cut.push_str("-changed")),
        Box::new(|value| value.common_cut_identity.push_str("-changed")),
        Box::new(|value| value.projection_at_epoch_ms += 1),
        Box::new(|value| value.valid_through_epoch_ms += 1),
        Box::new(|value| value.source_dependencies[0].kind = PortfolioViewDependencyKind::MarketFx),
        Box::new(|value| value.source_dependencies[0].owner = PortfolioViewSourceOwner::MarketData),
        Box::new(|value| {
            value.source_dependencies[0]
                .locator_identity
                .push_str("-changed");
        }),
        Box::new(|value| {
            value.source_dependencies[0]
                .frontier_identity
                .push_str("-changed");
        }),
        Box::new(|value| value.source_dependencies[0].frontier_sequence += 1),
        Box::new(|value| {
            value.source_dependencies[0]
                .common_cut_identity
                .push_str("-changed");
        }),
        Box::new(|value| {
            value.source_dependencies[0]
                .principal_identity
                .push_str("-changed");
        }),
        Box::new(|value| {
            value.source_dependencies[0]
                .account_identity
                .push_str("-changed");
        }),
        Box::new(|value| {
            value.source_dependencies[0]
                .execution_scope_identity
                .push_str("-changed");
        }),
        Box::new(|value| value.source_dependencies[0].mode = PortfolioViewMode::Live),
        Box::new(|value| {
            value.source_dependencies[0]
                .authorization_policy_cut
                .push_str("-changed");
        }),
        Box::new(|value| value.source_dependencies[0].observed_at_epoch_ms += 1),
        Box::new(|value| value.source_dependencies[0].valid_through_epoch_ms += 1),
    ];

    for mutate in mutations {
        let mut changed = original.clone();
        mutate(&mut changed);
        assert_ne!(changed.fingerprint().semantic_digest(), original_digest);
    }
}

#[rstest]
fn paper_live_alias_and_cross_scope_dependencies_fail_closed() {
    let mut changed = request(PortfolioViewMode::Paper);
    changed.source_dependencies[0].mode = PortfolioViewMode::Live;
    changed.source_dependencies[1].principal_identity = "principal-other".to_string();
    changed.source_dependencies[2].account_identity = "account-other".to_string();
    changed.source_dependencies[3].execution_scope_identity = "scope-other".to_string();
    changed.source_dependencies[4].authorization_policy_cut = "policy-other".to_string();
    let result = unavailable(&changed);

    for (kind, field) in [
        (
            PortfolioViewDependencyKind::ExecutionAccount,
            PortfolioViewScopeField::Mode,
        ),
        (
            PortfolioViewDependencyKind::ExecutionOpenOrders,
            PortfolioViewScopeField::Principal,
        ),
        (
            PortfolioViewDependencyKind::ExecutionFills,
            PortfolioViewScopeField::Account,
        ),
        (
            PortfolioViewDependencyKind::ExecutionFees,
            PortfolioViewScopeField::ExecutionScope,
        ),
        (
            PortfolioViewDependencyKind::ExecutionSettlement,
            PortfolioViewScopeField::AuthorizationPolicyCut,
        ),
    ] {
        assert!(
            result
                .failures()
                .contains(&PortfolioViewDependencyFailure::CrossScopeDependency { kind, field })
        );
    }
    assert_eq!(
        result.availability(),
        PortfolioViewAvailability::IncompleteFailClosed
    );
}

#[rstest]
fn missing_duplicate_mixed_cut_and_wrong_owner_are_structured() {
    let mut changed = request(PortfolioViewMode::Paper);
    changed.source_dependencies.pop();
    changed
        .source_dependencies
        .push(changed.source_dependencies[0].clone());
    changed.source_dependencies[1].common_cut_identity = "other-common-cut".to_string();
    changed.source_dependencies[2].owner = PortfolioViewSourceOwner::MarketData;
    let result = unavailable(&changed);
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::MissingDependency {
                kind: PortfolioViewDependencyKind::PortfolioSnapshot,
            })
    );
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::DuplicateDependency {
                kind: PortfolioViewDependencyKind::ExecutionAccount,
            })
    );
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::MixedCutDependency {
                kind: PortfolioViewDependencyKind::ExecutionOpenOrders,
            })
    );
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::CrossOwnerDependency {
                kind: PortfolioViewDependencyKind::ExecutionFills,
            })
    );
}

#[rstest]
fn stale_future_and_expired_cuts_never_produce_a_view() {
    let mut changed = request(PortfolioViewMode::Paper);
    changed.source_dependencies[0].valid_through_epoch_ms = PROJECTION_AT;
    changed.source_dependencies[1].observed_at_epoch_ms = PROJECTION_AT + 1;
    changed.principal_claim.valid_through_epoch_ms = PROJECTION_AT;
    changed.valid_through_epoch_ms = PROJECTION_AT;
    let result = unavailable(&changed);
    assert_eq!(result.availability(), PortfolioViewAvailability::Stale);
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::StaleDependency {
                kind: PortfolioViewDependencyKind::ExecutionAccount,
            })
    );
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::FutureDatedDependency {
                kind: PortfolioViewDependencyKind::ExecutionOpenOrders,
            })
    );
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::ExpiredPrincipalClaim)
    );
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::ExpiredRequest)
    );
}

#[rstest]
fn zero_frontier_and_validity_beyond_authority_fail_closed() {
    let mut changed = request(PortfolioViewMode::Paper);
    changed.source_dependencies[0].frontier_sequence = 0;
    changed.source_dependencies[1].valid_through_epoch_ms = VALID_THROUGH - 1;
    changed.principal_claim.valid_through_epoch_ms = VALID_THROUGH - 1;
    let result = unavailable(&changed);
    assert_eq!(
        result.availability(),
        PortfolioViewAvailability::IncompleteFailClosed
    );
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::InvalidFrontierSequence {
                kind: PortfolioViewDependencyKind::ExecutionAccount,
            })
    );
    assert!(result.failures().contains(
        &PortfolioViewDependencyFailure::ValidityOutlivesDependency {
            kind: PortfolioViewDependencyKind::ExecutionOpenOrders,
        }
    ));
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::ValidityOutlivesPrincipalClaim)
    );
}

#[rstest]
fn caller_claim_mismatch_never_becomes_trusted() {
    let mut changed = request(PortfolioViewMode::Paper);
    changed.principal_claim.account_identity = "forged-account".to_string();
    let result = unavailable(&changed);
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::PrincipalClaimMismatch {
                field: PortfolioViewScopeField::Account,
            })
    );
    assert!(
        result
            .failures()
            .contains(&PortfolioViewDependencyFailure::CallerSuppliedPrincipalClaim)
    );
}
