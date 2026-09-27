//! The anti-rollback witness of a deployment with one trust domain.

use async_trait::async_trait;

use super::{AdmissionScope, AntiRollbackObservation, AntiRollbackWitness, StoreHead};

/// The anti-rollback mode of a deployment whose only trust domain is the one machine it runs on.
///
/// A witness proves something only when its own state does not roll back with the custody store's.
/// On one machine nothing qualifies: restoring the machine or its volumes from an older snapshot
/// rolls back any witness kept there together with the store it would watch, and the witness then
/// vouches for the rolled-back head. So this mode observes nothing and says so. Admission under it
/// detects no rollback of the whole machine, custody store included, and its receipts name the mode
/// instead of carrying anything shaped like a witness proof.
///
/// The user accepted exactly this on 2026-09-27, answering a question put to them directly: they
/// chose "only this machine, authorize the downgrade", described as accepting no rollback
/// protection on a single-machine deployment, with the documentation stating that the property does
/// not hold there. The acceptance covers a single-machine deployment only: a deployment with a
/// second trust domain keeps its witness there and drops this mode by name.
pub(super) struct SingleTrustDomainNoRollbackWitness;

#[async_trait]
impl AntiRollbackWitness for SingleTrustDomainNoRollbackWitness {
    async fn observe(
        &self,
        _scope: &AdmissionScope,
        _head: &StoreHead,
    ) -> Result<AntiRollbackObservation, ()> {
        Ok(AntiRollbackObservation::SingleTrustDomainNoRollbackWitness)
    }
}
