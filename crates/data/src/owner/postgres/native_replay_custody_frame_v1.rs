//! A native Replay custody frame resolved on Owner custody (slice T0-5).
//!
//! The frame's view is read at the head its request pins, sealed as a verified batch, followed by
//! the quote cut of the gap after it, and issued with the custody's window schedules as one custody
//! frame readback. The pool path, in a test build, and the admitted port path differ only in how
//! they read the view; everything after the read is [`custody_frame_readback_from_view_v1`], so the
//! two cannot diverge.
//!
//! The quote cut comes from a resolver the caller passes. Production passes
//! [`resolve_custody_quote_cut_v1`], which refuses every gap as `QuoteCutMissing` until slice T0-6
//! derives one: a custody frame then fails closed as `EventOrderUnavailable`, and no Quote is
//! invented. Proofs pass a resolver of their own.

use super::{
    native_replay_scheduling_error_of_quote_cut_refusal,
    pit_window_custody_v1::{
        PitWindowViewRefusalV1, ResolvedPitWindowViewV1, resolve_pit_window_view_through_port_v1,
    },
};
use crate::owner::{
    declared_bar_timeframe_v1::DeclaredBarTimeframeV1,
    native_replay_quote_cut_v2::NativeReplayQuoteCutRefusalV2,
    native_replay_scheduling_v1::{
        NativeReplayCustodyFrameReadbackV1, NativeReplayInitialMarketRequestV1,
        NativeReplaySchedulingErrorV1, issue_native_replay_custody_frame_readback_v1,
    },
    pit_snapshot::{
        VerifiedPitObservationBatch,
        custody_view::{CustodyViewInputsV1, verify_custody_view_batch_v1},
    },
    pit_window_custody_v1::{
        PitObservationBatchSourceV1,
        quote_cut::{CustodyQuoteCutRequestV1, FillBarCandidateV1, custody_quote_cut_bound_v1},
    },
    store_admission::PitWindowCustodyReadPortV1,
    universe_sample_projection_v1::{CustodyFrameRowsV1, CustodyFrameVersionV1},
};

pub(crate) use crate::owner::pit_window_custody_v1::quote_cut::resolve_custody_quote_cut_v1;

/// What a refused view means to the frame that needed it.
pub(crate) const fn native_replay_scheduling_error_of_view_refusal_v1(
    refusal: PitWindowViewRefusalV1,
) -> NativeReplaySchedulingErrorV1 {
    match refusal {
        PitWindowViewRefusalV1::CustodyUnknown | PitWindowViewRefusalV1::HeadNotInChain => {
            NativeReplaySchedulingErrorV1::PitWindowHeadNotInChain
        }
        PitWindowViewRefusalV1::FrameNotCovered => {
            NativeReplaySchedulingErrorV1::PitWindowFrameNotCovered
        }
        PitWindowViewRefusalV1::NotOnSchedule => {
            NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame
        }
        PitWindowViewRefusalV1::StoreUnavailable => {
            NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable
        }
    }
}

/// One custody frame's readback from the view read for it: the view sealed, the quote cut
/// `quote_cut` resolves for the gap after it, and the custody's window schedules, issued against
/// `request`.
///
/// The view must be the one at the head the request pins, of the chain it names: the read pins it,
/// and a view of any other head is the store's fault, never a view this frame may take.
///
/// # Errors
///
/// A view refusal by its mapping; a view that does not seal or is not at the pinned head as
/// `OwnerReadbackUnavailable`; a quote cut refusal by the quote cut mapping (`QuoteCutMissing` is
/// `EventOrderUnavailable`); then whatever the custody frame issuance refuses.
pub(crate) fn custody_frame_readback_from_view_v1<Q>(
    view: Result<ResolvedPitWindowViewV1, PitWindowViewRefusalV1>,
    request: &NativeReplayInitialMarketRequestV1,
    quote_cut: Q,
) -> Result<NativeReplayCustodyFrameReadbackV1, NativeReplaySchedulingErrorV1>
where
    Q: FnOnce(
        &VerifiedPitObservationBatch,
        &CustodyQuoteCutRequestV1,
    ) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2>,
{
    let frame = request.custody_frame()?;
    let view = view.map_err(native_replay_scheduling_error_of_view_refusal_v1)?;

    if view.chain.chain_root != frame.custody.chain_root
        || view.chain.head_identity != frame.head_identity
        || view.selection.event_ns != frame.event_ns
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable);
    }
    let root = &view.chain.root;
    let batch = verify_custody_view_batch_v1(CustodyViewInputsV1 {
        chain_root: view.chain.chain_root,
        record: root,
        clock: &view.chain.root_clock,
        selection: &view.selection,
        rows: &view.rows,
    })
    .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    let PitObservationBatchSourceV1::CustodyView { view_identity, .. } = batch.source() else {
        return Err(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable);
    };
    let schedule = view
        .schedules
        .first()
        .ok_or(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    let bound_ns_exclusive = custody_quote_cut_bound_v1(
        view.selection.event_ns,
        schedule.interval_ns,
        request.window_end_ns_exclusive(),
    )
    .ok_or(NativeReplaySchedulingErrorV1::OwnerBindingMismatch)?;
    let fill_candidates = view
        .fill_candidates
        .iter()
        .map(|candidate| FillBarCandidateV1 {
            version_identity: candidate.version_identity,
            open_ns: candidate.open_ns,
            rows: candidate.rows.clone(),
        })
        .collect();
    let quote_cut = quote_cut(
        &batch,
        &CustodyQuoteCutRequestV1 {
            chain_root: view.chain.chain_root,
            head_identity: view.chain.head_identity,
            view_identity,
            decision_cut_ns: view.selection.decision_cut_ns,
            bound_ns_exclusive,
            members: root.members.clone(),
            fill_timeframe: root.fill.clone(),
            fill_candidates,
        },
    )
    .map_err(native_replay_scheduling_error_of_quote_cut_refusal)?;
    // The custody's own declaration: its binding fact, its execution label and the bar its window
    // schedules state, all bound by the custody identity.
    let declared = DeclaredBarTimeframeV1::from_custody_v1(
        root.binding_fact_digest,
        &root.execution.label,
        schedule.shape,
    );
    let universe = root.universe;
    // The rows the view was sealed from, each located by its member and selected version, from
    // which the frame's sample projection is derived.
    let custody = CustodyFrameRowsV1 {
        members: root.members.clone(),
        versions: view
            .selection
            .selected
            .iter()
            .map(|version| {
                root.inputs
                    .iter()
                    .find(|timeframe| timeframe.identity == version.timeframe_identity)
                    .map(|timeframe| CustodyFrameVersionV1 {
                        identity: version.identity,
                        timeframe_identity: version.timeframe_identity,
                        label: timeframe.label.clone(),
                    })
                    .ok_or(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)
            })
            .collect::<Result<_, _>>()?,
        rows: view.rows,
    };
    issue_native_replay_custody_frame_readback_v1(
        batch,
        quote_cut,
        view.schedules,
        declared,
        universe,
        &custody,
        request,
    )
}

/// One custody frame read on the pool, for the build where the read store holds one and for the
/// sealed acceptance custody frame resolver.
#[cfg(any(test, feature = "sealed-strategy-input-acceptance"))]
pub(in crate::owner) async fn resolve_native_replay_custody_frame_from_pool_v1<Q>(
    pool: &sqlx::PgPool,
    request: &NativeReplayInitialMarketRequestV1,
    quote_cut: Q,
) -> Result<NativeReplayCustodyFrameReadbackV1, NativeReplaySchedulingErrorV1>
where
    Q: FnOnce(
            &VerifiedPitObservationBatch,
            &CustodyQuoteCutRequestV1,
        ) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2>
        + Send,
{
    let frame = request.custody_frame()?;
    let mut transaction = pool
        .begin_with("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    let view = super::pit_window_custody_v1::resolve_pit_window_view_in_transaction_v1(
        &mut transaction,
        &frame,
    )
    .await;
    transaction
        .rollback()
        .await
        .map_err(|_| NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)?;
    custody_frame_readback_from_view_v1(view, request, quote_cut)
}

/// One custody frame read through an admitted custody port.
///
/// **Deliberately not `cfg`-gated, although its only production caller is**, for the reason
/// `resolve_native_replay_initial_market_through_port_v1` states: a proof can drive it.
pub(in crate::owner) async fn resolve_native_replay_custody_frame_through_port_v1<P, Q>(
    port: &P,
    request: &NativeReplayInitialMarketRequestV1,
    quote_cut: Q,
) -> Result<NativeReplayCustodyFrameReadbackV1, NativeReplaySchedulingErrorV1>
where
    P: PitWindowCustodyReadPortV1 + ?Sized,
    Q: FnOnce(
            &VerifiedPitObservationBatch,
            &CustodyQuoteCutRequestV1,
        ) -> Result<VerifiedPitObservationBatch, NativeReplayQuoteCutRefusalV2>
        + Send,
{
    let frame = request.custody_frame()?;
    let view = resolve_pit_window_view_through_port_v1(port, &frame).await;
    custody_frame_readback_from_view_v1(view, request, quote_cut)
}

/// The custody frame resolver sealed acceptance composes before slice T0-6 derives quote cuts.
///
/// **Acceptance only.** It reads a custody frame on the Owner pool through
/// [`resolve_native_replay_custody_frame_from_pool_v1`], the read the pool and admitted paths share
/// through [`custody_frame_readback_from_view_v1`]; only the quote source differs: `quote` states
/// each gap's Quotes where production's [`resolve_custody_quote_cut_v1`] refuses every gap, and the
/// stated rows are sealed by the custody quote cut seal, so the gap, member and source checks all
/// apply. T0-6's real fill-bar derivation replaces it, and any end-to-end result produced with it
/// must be re-run on the real derivation before it counts as U1 evidence. A snapshot frame is never
/// read here.
#[cfg(feature = "sealed-strategy-input-acceptance")]
pub(crate) struct SealedAcceptanceCustodyFrameResolverV1<F> {
    pub(crate) pool: sqlx::PgPool,
    pub(crate) quote: F,
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
impl<F> crate::owner::native_replay_scheduling_v1::resolver_seal::Sealed
    for SealedAcceptanceCustodyFrameResolverV1<F>
{
}

#[cfg(feature = "sealed-strategy-input-acceptance")]
#[async_trait::async_trait]
impl<F> crate::owner::native_replay_scheduling_v1::NativeReplaySchedulingResolverV1
    for SealedAcceptanceCustodyFrameResolverV1<F>
where
    F: Fn(
            &crate::owner::pit_window_custody_v1::sealed_acceptance::SealedAcceptanceCustodyQuoteGapV1,
        ) -> Option<
            crate::owner::pit_window_custody_v1::sealed_acceptance::SealedAcceptanceCustodyQuoteCutV1,
        > + Send
        + Sync,
{
    /// A custody frame resolver reads no snapshot frame.
    async fn resolve_native_replay_initial_market_inputs_v1(
        &self,
        request: &NativeReplayInitialMarketRequestV1,
    ) -> Result<
        crate::owner::native_replay_scheduling_v1::NativeReplayInitialMarketReadbackV1,
        NativeReplaySchedulingErrorV1,
    > {
        request.snapshot_source()?;
        Err(NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable)
    }

    async fn resolve_native_replay_custody_frame_inputs_v1(
        &self,
        request: &NativeReplayInitialMarketRequestV1,
    ) -> Result<NativeReplayCustodyFrameReadbackV1, NativeReplaySchedulingErrorV1> {
        resolve_native_replay_custody_frame_from_pool_v1(&self.pool, request, |view, gap| {
            crate::owner::pit_window_custody_v1::sealed_acceptance::sealed_acceptance_custody_quote_cut_v1(
                view,
                gap,
                &self.quote,
            )
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    /// Each view refusal keeps the name the plan gives it.
    #[rstest]
    #[case(
        PitWindowViewRefusalV1::CustodyUnknown,
        NativeReplaySchedulingErrorV1::PitWindowHeadNotInChain
    )]
    #[case(
        PitWindowViewRefusalV1::HeadNotInChain,
        NativeReplaySchedulingErrorV1::PitWindowHeadNotInChain
    )]
    #[case(
        PitWindowViewRefusalV1::FrameNotCovered,
        NativeReplaySchedulingErrorV1::PitWindowFrameNotCovered
    )]
    #[case(
        PitWindowViewRefusalV1::NotOnSchedule,
        NativeReplaySchedulingErrorV1::NoBarScheduleAtFrame
    )]
    #[case(
        PitWindowViewRefusalV1::StoreUnavailable,
        NativeReplaySchedulingErrorV1::OwnerReadbackUnavailable
    )]
    fn each_view_refusal_keeps_its_name(
        #[case] refusal: PitWindowViewRefusalV1,
        #[case] error: NativeReplaySchedulingErrorV1,
    ) {
        assert_eq!(
            native_replay_scheduling_error_of_view_refusal_v1(refusal),
            error
        );
    }
}
