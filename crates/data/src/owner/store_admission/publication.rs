//! Sealing and publishing one deployment-store publication: a signed store manifest and the signed
//! head that makes it current.
//!
//! This is the administrator's side, a principal separate from the custodian. It runs on the
//! administrator's machine with the store signing key, which never reaches the deployment; the
//! deployment holds only that key's public half, pinned in its signature verifier. The custodian
//! verifies everything a publication claims again at every admission, so sealing refuses only
//! what would make a publication internally inconsistent.
//!
//! A sealed publication carries the exact bytes that were signed. Publishing re-reads them through
//! the same byte-exact decoding the custodian's store uses and re-verifies both signatures before it
//! writes anything, so a file damaged between sealing and publishing never reaches the store.

use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::{
    CredentialHandleBinding, MARKET_DATA_OWNER, POSTGRES_BACKEND, RD_OWNER_API_CONSUMER,
    RecoveryBinding, RotationFence, SignedHead, SignedManifest, StoreHead, StoreManifest,
    custody_postgres, digest_serializable, head_identity, manifest_identity,
    postgres::{PostgresMeasurement, PostgresMeasurementSpec, PostgresTlsIdentity},
    signature::{PinnedEd25519SignatureVerifier, lower_hex},
    valid_opaque_identity,
};

/// The only sealed-publication format this version reads or writes.
const SEALED_PUBLICATION_SCHEMA_V1: u16 = 1;

/// Why a publication was not sealed or not published. Secret-free.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum DeploymentStorePublicationError {
    #[error("publication authoring is invalid: {0}")]
    InvalidAuthoring(String),
    #[error("sealed publication is invalid: {0}")]
    InvalidSealedPublication(&'static str),
    #[error("a signature in the sealed publication does not verify under its signer's key")]
    SignatureInvalid,
    #[error("the custody store could not be reached as the publisher")]
    StoreUnavailable,
}

/// What publishing did to the custody store.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeploymentStorePublishOutcomeV1 {
    /// The manifest was appended and the head now names it.
    Published,
    /// This exact manifest and head were already current; nothing was written.
    Replayed,
    /// The current head is not the one the publication expected; nothing was written.
    HeadMismatch,
    /// Another manifest or head already holds this identity or generation; nothing was written.
    Conflict,
}

/// What an administrator reads back after sealing: enough to name the publication and chain the
/// next one, and nothing that could reconstruct the signing key.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DeploymentStorePublicationSummaryV1 {
    pub environment_identity: String,
    pub deployment_identity: String,
    pub generation: u64,
    pub manifest_identity: String,
    /// The next publication's `expected_previous_head_identity`, and the deployment's
    /// `DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY` once this head is current.
    pub head_identity: String,
    pub signer_identity: String,
    pub signer_public_key_hex: String,
}

/// A publication as an administrator writes it. Identities, the history digest and signatures are
/// derived, never authored; the consumer, its Owner and the backend are the one admitted consumer's.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicationAuthoringV1 {
    signer_identity: String,
    environment_identity: String,
    deployment_identity: String,
    endpoint_identity: String,
    tls_identity: PostgresTlsIdentity,
    server_identity: String,
    database_identity: String,
    measurement_spec: PostgresMeasurementSpec,
    expected_measurement: PostgresMeasurement,
    credential_handle: CredentialHandleBinding,
    /// Every earlier manifest of this scope, oldest first; empty for the genesis publication.
    prior_manifest_identities: Vec<String>,
    /// The head this publication replaces; absent exactly for the genesis publication.
    expected_previous_head_identity: Option<String>,
    valid_from_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    recovery: RecoveryBinding,
    rotation_fence_identity: String,
    rotation_fence_closed_at_epoch_ms: u64,
}

/// The sealed form, as written to the administrator's file and read back to publish.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SealedPublicationV1 {
    schema_version: u16,
    signer_identity: String,
    signer_public_key_hex: String,
    /// The exact manifest bytes the signature covers.
    manifest_json: String,
    manifest_signature_hex: String,
    /// The exact head bytes the signature covers.
    head_json: String,
    head_signature_hex: String,
    expected_previous_head_identity: Option<String>,
}

/// Seals one authored publication with `signing_key`, returning the sealed bytes and their summary.
///
/// # Errors
///
/// Returns an error when the authoring does not parse, its generation and prior history disagree,
/// its expected previous head is present for a genesis publication or absent for a later one, or
/// the sealed bytes do not verify under the key's public half.
pub fn seal_deployment_store_publication_v1(
    authoring_json: &[u8],
    signing_key: &SigningKey,
) -> Result<(Vec<u8>, DeploymentStorePublicationSummaryV1), DeploymentStorePublicationError> {
    let authoring: PublicationAuthoringV1 = serde_json::from_slice(authoring_json)
        .map_err(|e| DeploymentStorePublicationError::InvalidAuthoring(e.to_string()))?;
    let generation = u64::try_from(authoring.prior_manifest_identities.len())
        .map_err(|_| invalid("prior history is unbounded"))?
        + 1;
    let predecessor = authoring.prior_manifest_identities.last().cloned();

    if !valid_opaque_identity(&authoring.signer_identity) {
        return Err(invalid("signer identity is not a bounded opaque identity"));
    }

    if (generation == 1) != authoring.expected_previous_head_identity.is_none() {
        return Err(invalid(
            "a genesis publication expects no previous head, and every later one expects exactly one",
        ));
    }
    let mut manifest = StoreManifest {
        manifest_identity: String::new(),
        environment_identity: authoring.environment_identity,
        deployment_identity: authoring.deployment_identity,
        consumer_owner: MARKET_DATA_OWNER.to_string(),
        consumer_identity: RD_OWNER_API_CONSUMER.to_string(),
        backend: POSTGRES_BACKEND.to_string(),
        endpoint_identity: authoring.endpoint_identity,
        tls_identity: authoring.tls_identity,
        server_identity: authoring.server_identity,
        database_identity: authoring.database_identity,
        measurement_spec: authoring.measurement_spec,
        expected_measurement: authoring.expected_measurement,
        credential_handle: authoring.credential_handle,
        predecessor_manifest_identity: predecessor.clone(),
        generation,
        valid_from_epoch_ms: authoring.valid_from_epoch_ms,
        valid_through_epoch_ms: authoring.valid_through_epoch_ms,
        recovery: authoring.recovery,
        rotation_fence: RotationFence {
            identity: authoring.rotation_fence_identity,
            predecessor_manifest_identity: predecessor,
            closed_at_epoch_ms: Some(authoring.rotation_fence_closed_at_epoch_ms),
        },
    };
    manifest.manifest_identity = manifest_identity(&manifest);
    let mut history = authoring.prior_manifest_identities;
    history.push(manifest.manifest_identity.clone());
    let mut head = StoreHead {
        head_identity: String::new(),
        environment_identity: manifest.environment_identity.clone(),
        deployment_identity: manifest.deployment_identity.clone(),
        consumer_owner: manifest.consumer_owner.clone(),
        consumer_identity: manifest.consumer_identity.clone(),
        backend: manifest.backend.clone(),
        current_manifest_identity: manifest.manifest_identity.clone(),
        generation,
        history_digest: digest_serializable(&history),
    };
    head.head_identity = head_identity(&head);

    let manifest_json = serde_json::to_string(&manifest).map_err(|e| invalid(&e.to_string()))?;
    let head_json = serde_json::to_string(&head).map_err(|e| invalid(&e.to_string()))?;
    let sealed = SealedPublicationV1 {
        schema_version: SEALED_PUBLICATION_SCHEMA_V1,
        signer_identity: authoring.signer_identity.clone(),
        signer_public_key_hex: lower_hex(signing_key.verifying_key().as_bytes()),
        manifest_signature_hex: lower_hex(&signing_key.sign(manifest_json.as_bytes()).to_bytes()),
        manifest_json,
        head_signature_hex: lower_hex(&signing_key.sign(head_json.as_bytes()).to_bytes()),
        head_json,
        expected_previous_head_identity: authoring.expected_previous_head_identity,
    };
    let bytes = serde_json::to_vec(&sealed).map_err(|e| invalid(&e.to_string()))?;
    // Prove what is about to be handed out verifies, through the reader publishing uses.
    let (verified_manifest, verified_head, _) = open_sealed(&bytes)?;
    Ok((
        bytes,
        DeploymentStorePublicationSummaryV1 {
            environment_identity: verified_manifest.manifest.environment_identity,
            deployment_identity: verified_manifest.manifest.deployment_identity,
            generation,
            manifest_identity: verified_manifest.manifest.manifest_identity,
            head_identity: verified_head.head.head_identity,
            signer_identity: sealed.signer_identity,
            signer_public_key_hex: sealed.signer_public_key_hex,
        },
    ))
}

/// Publishes a sealed publication as the publisher principal at `publisher_database_url`.
///
/// # Errors
///
/// Returns an error when the sealed bytes are not a well-formed, byte-exact, correctly signed
/// publication, or when the store cannot be reached. Nothing is written in either case.
pub async fn publish_sealed_deployment_store_publication_v1(
    publisher_database_url: &str,
    sealed_bytes: &[u8],
) -> Result<DeploymentStorePublishOutcomeV1, DeploymentStorePublicationError> {
    let (manifest, head, expected_previous_head) = open_sealed(sealed_bytes)?;
    let outcome = custody_postgres::publish_signed_v1(
        publisher_database_url,
        &manifest,
        &head,
        expected_previous_head.as_deref(),
    )
    .await
    .map_err(|e| match e {
        custody_postgres::CustodyStoreError::InconsistentPublication => {
            DeploymentStorePublicationError::InvalidSealedPublication(
                "the manifest and head do not describe one publication",
            )
        }
        _ => DeploymentStorePublicationError::StoreUnavailable,
    })?;
    Ok(match outcome {
        custody_postgres::PublishOutcomeV1::Published => DeploymentStorePublishOutcomeV1::Published,
        custody_postgres::PublishOutcomeV1::Replayed => DeploymentStorePublishOutcomeV1::Replayed,
        custody_postgres::PublishOutcomeV1::HeadMismatch => {
            DeploymentStorePublishOutcomeV1::HeadMismatch
        }
        custody_postgres::PublishOutcomeV1::Conflict => DeploymentStorePublishOutcomeV1::Conflict,
    })
}

/// Reads a sealed publication back: byte-exact manifest and head, both signatures verified under
/// the key the file names. That key proves only that the file was not damaged; whether it is the
/// deployment's trusted signer is the custodian's pinned verifier to decide.
pub(super) fn open_sealed(
    bytes: &[u8],
) -> Result<(SignedManifest, SignedHead, Option<String>), DeploymentStorePublicationError> {
    let sealed: SealedPublicationV1 = serde_json::from_slice(bytes)
        .map_err(|_| DeploymentStorePublicationError::InvalidSealedPublication("does not parse"))?;

    if sealed.schema_version != SEALED_PUBLICATION_SCHEMA_V1 {
        return Err(DeploymentStorePublicationError::InvalidSealedPublication(
            "unknown schema version",
        ));
    }
    let manifest: StoreManifest = custody_postgres::decode_exact(sealed.manifest_json.as_bytes())
        .map_err(|_| {
        DeploymentStorePublicationError::InvalidSealedPublication(
            "manifest is not byte-exact signed JSON",
        )
    })?;
    let head: StoreHead =
        custody_postgres::decode_exact(sealed.head_json.as_bytes()).map_err(|_| {
            DeploymentStorePublicationError::InvalidSealedPublication(
                "head is not byte-exact signed JSON",
            )
        })?;
    let verifier = PinnedEd25519SignatureVerifier::from_public_key_hex(
        &sealed.signer_identity,
        &sealed.signer_public_key_hex,
    )
    .map_err(|_| {
        DeploymentStorePublicationError::InvalidSealedPublication("signer key is invalid")
    })?;
    let manifest_signature = decode_lower_hex(&sealed.manifest_signature_hex)?;
    let head_signature = decode_lower_hex(&sealed.head_signature_hex)?;

    if !verifier.verifies(
        &sealed.signer_identity,
        sealed.manifest_json.as_bytes(),
        &manifest_signature,
    ) || !verifier.verifies(
        &sealed.signer_identity,
        sealed.head_json.as_bytes(),
        &head_signature,
    ) {
        return Err(DeploymentStorePublicationError::SignatureInvalid);
    }

    if manifest.manifest_identity != manifest_identity(&manifest)
        || head.head_identity != head_identity(&head)
    {
        return Err(DeploymentStorePublicationError::InvalidSealedPublication(
            "an identity is not its content's digest",
        ));
    }
    Ok((
        SignedManifest {
            manifest,
            signer_identity: sealed.signer_identity.clone(),
            signature: manifest_signature,
        },
        SignedHead {
            head,
            signer_identity: sealed.signer_identity,
            signature: head_signature,
        },
        sealed.expected_previous_head_identity,
    ))
}

fn invalid(reason: &str) -> DeploymentStorePublicationError {
    DeploymentStorePublicationError::InvalidAuthoring(reason.to_string())
}

fn decode_lower_hex(value: &str) -> Result<Vec<u8>, DeploymentStorePublicationError> {
    let malformed = || {
        DeploymentStorePublicationError::InvalidSealedPublication("signature is not lowercase hex")
    };

    if !value.len().is_multiple_of(2)
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(malformed());
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&value[index..index + 2], 16).map_err(|_| malformed()))
        .collect()
}
