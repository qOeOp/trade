//! Canonical, move-only custody carriers for one complete native Replay evidence batch.

use std::collections::BTreeSet;

use serde::Serialize;
use thiserror::Error;
use vibe_strategy_factory::exploratory_replay::ExploratoryReplayRequestLocatorV2;

use crate::{
    CanonicalDigestV2, ComponentObservationLocatorV2, ObservationComponentV2, OpaqueIdentityV2,
};

const SOURCE_BYTES_DOMAIN: &[u8] = b"vibe.backtest.native-replay-producer-source.v2\0";
const ENVELOPE_DOMAIN: &[u8] = b"vibe.backtest.native-replay-evidence-envelope.v2\0";

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub(crate) enum NativeReplayEvidenceCustodyErrorV2 {
    #[error("native Replay evidence batch is incomplete, duplicated, cross-spliced, or corrupt")]
    InvalidBatch,
}

/// Crate-owned input for one producer observation. No caller DTO can construct the sealed envelope.
pub(crate) struct NativeReplayEvidenceDraftV2 {
    pub request_locator: ExploratoryReplayRequestLocatorV2,
    pub attempt_identity: OpaqueIdentityV2,
    pub component: ObservationComponentV2,
    pub producer_namespace: OpaqueIdentityV2,
    pub producer_reference: OpaqueIdentityV2,
    pub producer_bytes: Vec<u8>,
    pub observed_meaning_identity: OpaqueIdentityV2,
    pub observed_meaning_digest: CanonicalDigestV2,
}

/// One canonical, byte-bound producer observation retained by Backtest.
///
/// Construction is crate-private; the type is move-only and has no deserializer.
pub struct SealedNativeReplayEvidenceEnvelopeV2 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    attempt_identity: OpaqueIdentityV2,
    component: ObservationComponentV2,
    producer_namespace: OpaqueIdentityV2,
    producer_reference: OpaqueIdentityV2,
    producer_bytes: Vec<u8>,
    producer_bytes_digest: CanonicalDigestV2,
    observed_meaning_identity: OpaqueIdentityV2,
    observed_meaning_digest: CanonicalDigestV2,
    envelope_locator: ComponentObservationLocatorV2,
    canonical_bytes: Vec<u8>,
}

impl SealedNativeReplayEvidenceEnvelopeV2 {
    #[must_use]
    pub fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }
    #[must_use]
    pub fn attempt_identity(&self) -> &OpaqueIdentityV2 {
        &self.attempt_identity
    }
    #[must_use]
    pub const fn component(&self) -> ObservationComponentV2 {
        self.component
    }
    #[must_use]
    pub fn producer_namespace(&self) -> &OpaqueIdentityV2 {
        &self.producer_namespace
    }
    #[must_use]
    pub fn producer_reference(&self) -> &OpaqueIdentityV2 {
        &self.producer_reference
    }
    #[must_use]
    pub fn producer_bytes(&self) -> &[u8] {
        &self.producer_bytes
    }
    #[must_use]
    pub fn producer_bytes_digest(&self) -> &CanonicalDigestV2 {
        &self.producer_bytes_digest
    }
    #[must_use]
    pub fn observed_meaning_identity(&self) -> &OpaqueIdentityV2 {
        &self.observed_meaning_identity
    }
    #[must_use]
    pub fn observed_meaning_digest(&self) -> &CanonicalDigestV2 {
        &self.observed_meaning_digest
    }
    #[must_use]
    pub fn envelope_locator(&self) -> &ComponentObservationLocatorV2 {
        &self.envelope_locator
    }
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Exactly the 28 requested-meaning observations for one request and attempt.
///
/// It is crate-private to construct, move-only, and cannot be deserialized.
pub struct SealedNativeReplayEvidenceBatchV2 {
    request_locator: ExploratoryReplayRequestLocatorV2,
    attempt_identity: OpaqueIdentityV2,
    envelopes: Vec<SealedNativeReplayEvidenceEnvelopeV2>,
}

/// Exact bytes returned from Backtest custody after the aggregate commit.
pub struct NativeReplayEvidenceBatchReadbackV2 {
    envelopes: Vec<NativeReplayEvidenceEnvelopeReadbackV2>,
}

pub struct NativeReplayEvidenceEnvelopeReadbackV2 {
    component: ObservationComponentV2,
    envelope_locator: ComponentObservationLocatorV2,
    canonical_bytes: Vec<u8>,
    producer_bytes: Vec<u8>,
    producer_bytes_digest: CanonicalDigestV2,
}

impl NativeReplayEvidenceBatchReadbackV2 {
    pub(crate) fn from_owner_readback(
        envelopes: Vec<NativeReplayEvidenceEnvelopeReadbackV2>,
    ) -> Self {
        Self { envelopes }
    }
    #[must_use]
    pub fn envelopes(&self) -> &[NativeReplayEvidenceEnvelopeReadbackV2] {
        &self.envelopes
    }
}

impl NativeReplayEvidenceEnvelopeReadbackV2 {
    pub(crate) fn from_owner_readback(
        component: ObservationComponentV2,
        envelope_locator: ComponentObservationLocatorV2,
        canonical_bytes: Vec<u8>,
        producer_bytes: Vec<u8>,
        producer_bytes_digest: CanonicalDigestV2,
    ) -> Self {
        Self {
            component,
            envelope_locator,
            canonical_bytes,
            producer_bytes,
            producer_bytes_digest,
        }
    }
    #[must_use]
    pub const fn component(&self) -> ObservationComponentV2 {
        self.component
    }
    #[must_use]
    pub fn envelope_locator(&self) -> &ComponentObservationLocatorV2 {
        &self.envelope_locator
    }
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    #[must_use]
    pub fn producer_bytes(&self) -> &[u8] {
        &self.producer_bytes
    }
    #[must_use]
    pub fn producer_bytes_digest(&self) -> &CanonicalDigestV2 {
        &self.producer_bytes_digest
    }
}

impl SealedNativeReplayEvidenceBatchV2 {
    pub(crate) fn seal(
        request_locator: ExploratoryReplayRequestLocatorV2,
        attempt_identity: OpaqueIdentityV2,
        drafts: Vec<NativeReplayEvidenceDraftV2>,
    ) -> Result<Self, NativeReplayEvidenceCustodyErrorV2> {
        if drafts.len() != ObservationComponentV2::REQUESTED_MEANING.len() {
            return Err(NativeReplayEvidenceCustodyErrorV2::InvalidBatch);
        }
        let mut seen = BTreeSet::new();
        let mut envelopes = Vec::with_capacity(drafts.len());
        for draft in drafts {
            if draft.request_locator != request_locator
                || draft.attempt_identity != attempt_identity
                || draft.component == ObservationComponentV2::SemanticTrace
                || draft.producer_bytes.is_empty()
                || !seen.insert(draft.component)
            {
                return Err(NativeReplayEvidenceCustodyErrorV2::InvalidBatch);
            }
            envelopes.push(seal_envelope(draft)?);
        }
        envelopes.sort_by_key(SealedNativeReplayEvidenceEnvelopeV2::component);
        if seen
            != ObservationComponentV2::REQUESTED_MEANING
                .into_iter()
                .collect()
        {
            return Err(NativeReplayEvidenceCustodyErrorV2::InvalidBatch);
        }
        let batch = Self {
            request_locator,
            attempt_identity,
            envelopes,
        };
        batch.validate()?;
        Ok(batch)
    }

    pub(crate) fn validate(&self) -> Result<(), NativeReplayEvidenceCustodyErrorV2> {
        if self.envelopes.len() != ObservationComponentV2::REQUESTED_MEANING.len() {
            return Err(NativeReplayEvidenceCustodyErrorV2::InvalidBatch);
        }
        let mut seen = BTreeSet::new();
        for envelope in &self.envelopes {
            if envelope.request_locator != self.request_locator
                || envelope.attempt_identity != self.attempt_identity
                || !seen.insert(envelope.component)
                || digest(SOURCE_BYTES_DOMAIN, &envelope.producer_bytes)?
                    != envelope.producer_bytes_digest
            {
                return Err(NativeReplayEvidenceCustodyErrorV2::InvalidBatch);
            }
            let expected_bytes = serde_json::to_vec(&EnvelopePreimageV2 {
                schema_version: 2,
                request_locator: &envelope.request_locator,
                attempt_identity: &envelope.attempt_identity,
                component: envelope.component,
                producer_namespace: &envelope.producer_namespace,
                producer_reference: &envelope.producer_reference,
                producer_bytes_digest: &envelope.producer_bytes_digest,
                observed_meaning_identity: &envelope.observed_meaning_identity,
                observed_meaning_digest: &envelope.observed_meaning_digest,
            })
            .map_err(|_| NativeReplayEvidenceCustodyErrorV2::InvalidBatch)?;
            if expected_bytes != envelope.canonical_bytes
                || envelope.envelope_locator.component != envelope.component
                || envelope.envelope_locator.digest != digest(ENVELOPE_DOMAIN, &expected_bytes)?
            {
                return Err(NativeReplayEvidenceCustodyErrorV2::InvalidBatch);
            }
        }
        if seen
            != ObservationComponentV2::REQUESTED_MEANING
                .into_iter()
                .collect()
        {
            return Err(NativeReplayEvidenceCustodyErrorV2::InvalidBatch);
        }
        Ok(())
    }

    #[must_use]
    pub fn request_locator(&self) -> &ExploratoryReplayRequestLocatorV2 {
        &self.request_locator
    }
    #[must_use]
    pub fn attempt_identity(&self) -> &OpaqueIdentityV2 {
        &self.attempt_identity
    }
    #[must_use]
    pub fn envelopes(&self) -> &[SealedNativeReplayEvidenceEnvelopeV2] {
        &self.envelopes
    }
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct EnvelopePreimageV2<'a> {
    schema_version: u16,
    request_locator: &'a ExploratoryReplayRequestLocatorV2,
    attempt_identity: &'a OpaqueIdentityV2,
    component: ObservationComponentV2,
    producer_namespace: &'a OpaqueIdentityV2,
    producer_reference: &'a OpaqueIdentityV2,
    producer_bytes_digest: &'a CanonicalDigestV2,
    observed_meaning_identity: &'a OpaqueIdentityV2,
    observed_meaning_digest: &'a CanonicalDigestV2,
}

fn seal_envelope(
    draft: NativeReplayEvidenceDraftV2,
) -> Result<SealedNativeReplayEvidenceEnvelopeV2, NativeReplayEvidenceCustodyErrorV2> {
    let producer_bytes_digest = digest(SOURCE_BYTES_DOMAIN, &draft.producer_bytes)?;
    let preimage = EnvelopePreimageV2 {
        schema_version: 2,
        request_locator: &draft.request_locator,
        attempt_identity: &draft.attempt_identity,
        component: draft.component,
        producer_namespace: &draft.producer_namespace,
        producer_reference: &draft.producer_reference,
        producer_bytes_digest: &producer_bytes_digest,
        observed_meaning_identity: &draft.observed_meaning_identity,
        observed_meaning_digest: &draft.observed_meaning_digest,
    };
    let canonical_bytes = serde_json::to_vec(&preimage)
        .map_err(|_| NativeReplayEvidenceCustodyErrorV2::InvalidBatch)?;
    let envelope_digest = digest(ENVELOPE_DOMAIN, &canonical_bytes)?;
    let suffix = envelope_digest
        .as_str()
        .strip_prefix("blake3:")
        .ok_or(NativeReplayEvidenceCustodyErrorV2::InvalidBatch)?;
    let envelope_locator = ComponentObservationLocatorV2 {
        component: draft.component,
        reference: OpaqueIdentityV2::try_from(format!("backtest-evidence-envelope-v2-{suffix}"))
            .map_err(|_| NativeReplayEvidenceCustodyErrorV2::InvalidBatch)?,
        digest: envelope_digest,
    };
    Ok(SealedNativeReplayEvidenceEnvelopeV2 {
        request_locator: draft.request_locator,
        attempt_identity: draft.attempt_identity,
        component: draft.component,
        producer_namespace: draft.producer_namespace,
        producer_reference: draft.producer_reference,
        producer_bytes: draft.producer_bytes,
        producer_bytes_digest,
        observed_meaning_identity: draft.observed_meaning_identity,
        observed_meaning_digest: draft.observed_meaning_digest,
        envelope_locator,
        canonical_bytes,
    })
}

fn digest(
    domain: &[u8],
    bytes: &[u8],
) -> Result<CanonicalDigestV2, NativeReplayEvidenceCustodyErrorV2> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain);
    hasher.update(bytes);
    CanonicalDigestV2::try_from(format!("blake3:{}", hasher.finalize().to_hex()))
        .map_err(|_| NativeReplayEvidenceCustodyErrorV2::InvalidBatch)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(value: impl Into<String>) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.into()).unwrap()
    }
    fn digest_fixture(byte: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64))).unwrap()
    }
    fn locator(label: &str) -> ExploratoryReplayRequestLocatorV2 {
        ExploratoryReplayRequestLocatorV2 {
            request_identity: format!("request-{label}"),
            meaning_digest: format!("sha256:{}", "a".repeat(64)),
            receipt_identity: format!("receipt-{label}"),
            seal_digest: format!("sha256:{}", "b".repeat(64)),
        }
    }
    fn drafts(
        request: &ExploratoryReplayRequestLocatorV2,
        attempt: &OpaqueIdentityV2,
    ) -> Vec<NativeReplayEvidenceDraftV2> {
        ObservationComponentV2::REQUESTED_MEANING
            .into_iter()
            .map(|component| NativeReplayEvidenceDraftV2 {
                request_locator: request.clone(),
                attempt_identity: attempt.clone(),
                component,
                producer_namespace: identity(format!("producer-{component:?}")),
                producer_reference: identity(format!("reference-{component:?}")),
                producer_bytes: format!("bytes-{component:?}").into_bytes(),
                observed_meaning_identity: identity(format!("meaning-{component:?}")),
                observed_meaning_digest: digest_fixture('c'),
            })
            .collect()
    }

    #[test]
    fn seals_exact_canonical_28_of_28() {
        let request = locator("a");
        let attempt = identity("attempt-a");
        let batch = SealedNativeReplayEvidenceBatchV2::seal(
            request,
            attempt,
            drafts(&locator("a"), &identity("attempt-a")),
        )
        .unwrap();
        assert_eq!(batch.envelopes().len(), 28);
        assert!(
            batch
                .envelopes()
                .windows(2)
                .all(|pair| pair[0].component() < pair[1].component())
        );
    }

    #[test]
    fn rejects_missing_duplicate_tamper_and_cross_request() {
        let request = locator("a");
        let attempt = identity("attempt-a");
        let mut missing = drafts(&request, &attempt);
        missing.pop();
        assert!(
            SealedNativeReplayEvidenceBatchV2::seal(request.clone(), attempt.clone(), missing)
                .is_err()
        );
        let mut duplicate = drafts(&request, &attempt);
        duplicate[1].component = duplicate[0].component;
        assert!(
            SealedNativeReplayEvidenceBatchV2::seal(request.clone(), attempt.clone(), duplicate)
                .is_err()
        );
        let mut tamper = drafts(&request, &attempt);
        tamper[0].producer_bytes.clear();
        assert!(
            SealedNativeReplayEvidenceBatchV2::seal(request.clone(), attempt.clone(), tamper)
                .is_err()
        );
        let mut cross = drafts(&request, &attempt);
        cross[0].request_locator = locator("b");
        assert!(SealedNativeReplayEvidenceBatchV2::seal(request, attempt, cross).is_err());
    }

    #[test]
    fn validator_rejects_post_seal_byte_and_cross_attempt_tamper() {
        let request = locator("a");
        let attempt = identity("attempt-a");
        let mut bytes = SealedNativeReplayEvidenceBatchV2::seal(
            request.clone(),
            attempt.clone(),
            drafts(&request, &attempt),
        )
        .unwrap();
        bytes.envelopes[0].producer_bytes.push(0);
        assert!(bytes.validate().is_err());
        let mut attempt_tamper = SealedNativeReplayEvidenceBatchV2::seal(
            request.clone(),
            attempt.clone(),
            drafts(&request, &attempt),
        )
        .unwrap();
        attempt_tamper.envelopes[0].attempt_identity = identity("attempt-b");
        assert!(attempt_tamper.validate().is_err());
    }
}
