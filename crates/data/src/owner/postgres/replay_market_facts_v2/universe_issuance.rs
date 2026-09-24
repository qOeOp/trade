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
    OpenIssuanceV1, UniverseMemberReplayFactsSourcesV2, canonical_issuance_command_bytes_v1,
    coordinates_from_r0, digest_registry,
    persist_universe_member_replay_market_facts_in_transaction_v2, record_issuance_v1,
    replayed_issuance_v1, universe_member_native_locators_v1,
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
            &mut issuance,
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
async fn issue_universe_members_in_transaction_v1(
    issuance: &mut OpenIssuanceV1,
    request: &ReplayCompositionUniverseBindingIssuanceRequestV1,
    issuance_locator: ReplayCompositionIssuanceLocatorV1,
    request_bytes: &[u8],
) -> Result<ReplayCompositionDurableIssuanceResponseV1, ReplayCompositionBindingErrorV1> {
    let transaction = &mut issuance.transaction;
    let receipt = issuance.role_set.receipt();
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
