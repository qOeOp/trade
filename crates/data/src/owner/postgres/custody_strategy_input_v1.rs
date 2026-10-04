//! Strategy input declarations over a custody frame (T0-10, `docs/owners/market-data.md`).
//!
//! A custody run's Design is declared over its first custody frame, sealed as a batch whose source
//! is that frame's view, so its strategy-input universe selection is the one every later frame of
//! the run derives. The registry re-resolves such a declaration here: the view at the head that
//! holds it - a later correction never refuses an earlier declaration - and, for every other
//! dependency, the chain's own basis, which the basis read verifies against the root custody.

use sqlx::{Postgres, Transaction};

use super::{
    pit_window_custody_v1::{
        chain_basis_from_readback_v1, load_chain_evidence_v1, read_pit_window_chain_basis_v1,
        resolve_pit_window_view_in_transaction_v1, root_universe_request_v1,
    },
    strategy_input_binding_registry::StrategyInputBindingRegistryErrorV1,
    universe_selection::read_universe_selection_by_request_v1,
};
use crate::owner::{
    pit_snapshot::{
        VerifiedPitObservationBatch,
        custody_view::{CustodyViewInputsV1, verify_custody_view_batch_v1},
    },
    pit_window_custody_v1::{
        PitObservationBatchSourceV1, PitWindowChainBasisV1, UntrustedPitWindowCustodyClaimV1,
        UntrustedPitWindowCustodyFrameV1,
    },
    source_binding::BindingDigest,
    strategy_input_binding::UntrustedStrategyInputBindingRequest,
};

use StrategyInputBindingRegistryErrorV1 as Refused;

/// The view of `frame` at the head it pins, sealed as a batch, with the chain basis verified at
/// that head.
pub(super) async fn read_custody_frame_batch_v1(
    transaction: &mut Transaction<'_, Postgres>,
    frame: &UntrustedPitWindowCustodyFrameV1,
) -> Result<(VerifiedPitObservationBatch, PitWindowChainBasisV1), Refused> {
    let view = resolve_pit_window_view_in_transaction_v1(transaction, frame)
        .await
        .map_err(|_| Refused::PitUnavailable)?;

    if view.chain.chain_root != frame.custody.chain_root
        || view.chain.head_identity != frame.head_identity
        || view.selection.event_ns != frame.event_ns
    {
        return Err(Refused::StoreUntrusted);
    }
    let batch = verify_custody_view_batch_v1(CustodyViewInputsV1 {
        chain_root: view.chain.chain_root,
        record: &view.chain.root,
        clock: &view.chain.root_clock,
        selection: &view.selection,
        rows: &view.rows,
    })
    .map_err(|_| Refused::StoreUntrusted)?;
    let readback = read_pit_window_chain_basis_v1(transaction, frame.custody.chain_root)
        .await
        .map_err(|_| Refused::StoreUnavailable)?
        .ok_or(Refused::PitUnavailable)?;
    let evidence = load_chain_evidence_v1(transaction, frame.custody.chain_root)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
    let request_identity = root_universe_request_v1(&evidence, frame.custody.chain_root)
        .ok_or(Refused::StoreUntrusted)?;
    let selection = read_universe_selection_by_request_v1(transaction, request_identity)
        .await
        .map_err(|_| Refused::StoreUnavailable)?
        .ok_or(Refused::UniverseUnavailable)?;
    let basis = chain_basis_from_readback_v1(&view.chain, readback, &selection)
        .ok_or(Refused::StoreUntrusted)?;
    Ok((batch, basis))
}

/// The custody batch a `CustodyView`-sourced request was composed over: the view at the latest
/// head of its chain whose frame view at the request's event is the request's view, so a
/// correction committed after the declaration never refuses it.
///
/// `rd_owner` reads no custody table, so a custody declaration read under that principal is
/// refused until its read functions exist (T0-10 (c)).
///
/// The walk is boxed so every registry read that may take this arm keeps a small future.
pub(super) async fn reread_custody_batch_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    read_as_rd_owner: bool,
) -> Result<(VerifiedPitObservationBatch, PitWindowChainBasisV1), Refused> {
    Box::pin(reread_custody_batch_inner_v1(
        transaction,
        request,
        read_as_rd_owner,
    ))
    .await
}

async fn reread_custody_batch_inner_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedStrategyInputBindingRequest,
    read_as_rd_owner: bool,
) -> Result<(VerifiedPitObservationBatch, PitWindowChainBasisV1), Refused> {
    let crate::owner::strategy_input_binding::StrategyInputBatchSourceV1::CustodyView {
        chain_root,
        view_identity,
        event_ns,
        ..
    } = request.source
    else {
        return Err(Refused::PitUnavailable);
    };

    if read_as_rd_owner {
        return Err(Refused::PitUnavailable);
    }
    let evidence = load_chain_evidence_v1(transaction, chain_root)
        .await
        .map_err(|_| Refused::StoreUnavailable)?;
    let mut heads: Vec<(u64, BindingDigest)> = evidence
        .custodies
        .iter()
        .map(|custody| (custody.chain_version, custody.identity))
        .collect();
    heads.sort_unstable_by_key(|head| std::cmp::Reverse(head.0));

    for (_, head_identity) in heads {
        let frame = UntrustedPitWindowCustodyFrameV1 {
            custody: UntrustedPitWindowCustodyClaimV1 { chain_root },
            head_identity,
            event_ns,
        };
        let Ok((batch, basis)) = read_custody_frame_batch_v1(transaction, &frame).await else {
            continue;
        };

        if matches!(
            batch.source(),
            PitObservationBatchSourceV1::CustodyView { view_identity: held, .. } if held == view_identity
        ) {
            return Ok((batch, basis));
        }
    }
    Err(Refused::PitUnavailable)
}

/// Checks a custody-sourced request's coordinates against the chain basis its batch was read
/// with: the Universe Selection record, Instrument Master key and Market Semantics identity the
/// root custody bound. The batch itself is checked against the request when the role binds.
pub(super) fn check_custody_request_against_basis_v1(
    request: &UntrustedStrategyInputBindingRequest,
    batch: &VerifiedPitObservationBatch,
    basis: &PitWindowChainBasisV1,
) -> Result<(), Refused> {
    if request.universe_selection_digest != basis.universe_selection().request_identity()
        || batch.universe_selection_digest() != basis.universe_selection().request_identity()
    {
        return Err(Refused::UniverseUnavailable);
    }

    if request.instrument_master_digest != basis.instrument_master_key()
        || batch.instrument_master_digest() != basis.instrument_master_key()
    {
        return Err(Refused::InstrumentMasterBatchDigestUnavailable);
    }

    if request.market_semantics_identity != basis.market_semantics_identity()
        || batch.market_semantics_identity() != basis.market_semantics_identity()
    {
        return Err(Refused::MarketSemanticsUnavailable);
    }
    Ok(())
}
