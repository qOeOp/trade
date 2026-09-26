//! The production signature verifier: one pinned Ed25519 public key under one signer identity.
//!
//! The signer's private key never enters this process. An administrator seals manifests and heads
//! elsewhere, and the deployment supplies only the public half and the identity it answers to, the
//! same custody the Replay Policy Catalog's trusted verifier uses.

use async_trait::async_trait;
use ed25519_dalek::{Signature, VerifyingKey};
use thiserror::Error;

use super::{SignatureVerifier, valid_opaque_identity};

/// Why a pinned signer could not be constructed. A deployment that cannot construct it has no
/// signature verifier and admits nothing.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(super) enum PinnedSignerError {
    #[error("signer identity is not a bounded opaque identity")]
    InvalidSignerIdentity,
    #[error("signer public key must be 32 bytes as 64 lowercase hexadecimal characters")]
    InvalidPublicKeyEncoding,
    #[error("signer public key is not a valid Ed25519 point")]
    InvalidPublicKey,
    #[error("signer public key is a small-order point, under which forged signatures verify")]
    WeakPublicKey,
}

/// Verifies store-admission signatures against one pinned Ed25519 public key.
///
/// A signature from any other identity, of the wrong width, or failing strict verification is
/// invalid: the answer is `Ok(false)`, which the custodian refuses as `INVALID_SIGNATURE`. Nothing
/// here can be unavailable once constructed, so this verifier never answers `Err`.
pub(super) struct PinnedEd25519SignatureVerifier {
    signer_identity: String,
    key: VerifyingKey,
}

impl PinnedEd25519SignatureVerifier {
    /// Pins `signer_identity` to the public key in `public_key_hex`.
    ///
    /// # Errors
    ///
    /// Returns an error when the identity is not a bounded opaque identity, the key is not exactly
    /// 64 lowercase hexadecimal characters, or the bytes are not a valid Ed25519 public key or are
    /// a small-order one.
    pub(super) fn from_public_key_hex(
        signer_identity: impl Into<String>,
        public_key_hex: &str,
    ) -> Result<Self, PinnedSignerError> {
        let signer_identity = signer_identity.into();

        if !valid_opaque_identity(&signer_identity) {
            return Err(PinnedSignerError::InvalidSignerIdentity);
        }
        let bytes = decode_lower_hex_32(public_key_hex)?;
        let key =
            VerifyingKey::from_bytes(&bytes).map_err(|_| PinnedSignerError::InvalidPublicKey)?;

        if key.is_weak() {
            return Err(PinnedSignerError::WeakPublicKey);
        }
        Ok(Self {
            signer_identity,
            key,
        })
    }
}

#[async_trait]
impl SignatureVerifier for PinnedEd25519SignatureVerifier {
    async fn verify(
        &self,
        signer_identity: &str,
        message: &[u8],
        signature: &[u8],
    ) -> Result<bool, ()> {
        if signer_identity != self.signer_identity {
            return Ok(false);
        }
        let Ok(signature) = Signature::try_from(signature) else {
            return Ok(false);
        };
        Ok(self.key.verify_strict(message, &signature).is_ok())
    }
}

fn decode_lower_hex_32(value: &str) -> Result<[u8; 32], PinnedSignerError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(PinnedSignerError::InvalidPublicKeyEncoding);
    }
    let mut output = [0_u8; 32];

    for (index, byte) in output.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| PinnedSignerError::InvalidPublicKeyEncoding)?;
    }
    Ok(output)
}

/// Encodes a public key the way a deployment supplies it: 64 lowercase hexadecimal characters.
#[cfg(test)]
pub(super) fn lower_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    bytes.iter().fold(String::new(), |mut output, byte| {
        let _ = write!(output, "{byte:02x}");
        output
    })
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer, SigningKey};
    use rstest::rstest;

    use super::*;

    const SIGNER: &str = "deployment-store-signer-v1";

    fn pinned(key: &SigningKey) -> PinnedEd25519SignatureVerifier {
        PinnedEd25519SignatureVerifier::from_public_key_hex(
            SIGNER,
            &lower_hex(key.verifying_key().as_bytes()),
        )
        .unwrap()
    }

    #[rstest]
    #[tokio::test]
    async fn a_signature_by_the_pinned_key_under_its_identity_verifies() {
        let key = SigningKey::from_bytes(&[7_u8; 32]);
        let signature = key.sign(b"manifest").to_bytes();

        assert_eq!(
            pinned(&key).verify(SIGNER, b"manifest", &signature).await,
            Ok(true)
        );
    }

    #[rstest]
    #[tokio::test]
    async fn every_other_signature_is_invalid_and_none_is_unavailable() {
        let key = SigningKey::from_bytes(&[7_u8; 32]);
        let other = SigningKey::from_bytes(&[8_u8; 32]);
        let verifier = pinned(&key);
        let signature = key.sign(b"manifest").to_bytes();
        let mut flipped = signature;
        flipped[0] ^= 1;

        for (signer, message, signature) in [
            (
                "deployment-store-other-signer-v1",
                &b"manifest"[..],
                &signature[..],
            ),
            (SIGNER, &b"manifesT"[..], &signature[..]),
            (SIGNER, &b"manifest"[..], &flipped[..]),
            (
                SIGNER,
                &b"manifest"[..],
                &other.sign(b"manifest").to_bytes()[..],
            ),
            (SIGNER, &b"manifest"[..], &signature[..63]),
            (SIGNER, &b"manifest"[..], &[][..]),
        ] {
            assert_eq!(verifier.verify(signer, message, signature).await, Ok(false));
        }
    }

    #[rstest]
    #[case::short(&"a".repeat(62), PinnedSignerError::InvalidPublicKeyEncoding)]
    #[case::long(&"a".repeat(66), PinnedSignerError::InvalidPublicKeyEncoding)]
    #[case::upper(&"A".repeat(64), PinnedSignerError::InvalidPublicKeyEncoding)]
    #[case::not_hex(&"g".repeat(64), PinnedSignerError::InvalidPublicKeyEncoding)]
    #[case::trailing_newline(&format!("{}\n", "a".repeat(64)), PinnedSignerError::InvalidPublicKeyEncoding)]
    fn a_malformed_public_key_constructs_no_verifier(
        #[case] public_key_hex: &str,
        #[case] expected: PinnedSignerError,
    ) {
        assert_eq!(
            PinnedEd25519SignatureVerifier::from_public_key_hex(SIGNER, public_key_hex).err(),
            Some(expected)
        );
    }

    #[rstest]
    fn a_point_off_the_curve_constructs_no_verifier() {
        // y = 2 has no x on edwards25519, so these bytes decompress to no point.
        let mut bytes = [0_u8; 32];
        bytes[0] = 2;

        assert_eq!(
            PinnedEd25519SignatureVerifier::from_public_key_hex(SIGNER, &lower_hex(&bytes)).err(),
            Some(PinnedSignerError::InvalidPublicKey)
        );
    }

    #[rstest]
    #[tokio::test]
    async fn a_small_order_public_key_constructs_no_verifier() {
        // The identity point: under it the all-identity signature (R = identity, s = 0) satisfies
        // the unstrict equation for every message, so no one needs the private key to sign.
        let mut identity = [0_u8; 32];
        identity[0] = 1;
        let forged = {
            let mut bytes = [0_u8; 64];
            bytes[0] = 1;
            Signature::from_bytes(&bytes)
        };
        let weak = VerifyingKey::from_bytes(&identity).unwrap();
        assert!(weak.verify_strict(b"any message", &forged).is_err());
        assert!(
            ed25519_dalek::Verifier::verify(&weak, b"any message", &forged).is_ok(),
            "the forgery this guard exists for must verify under the unstrict equation"
        );

        assert_eq!(
            PinnedEd25519SignatureVerifier::from_public_key_hex(SIGNER, &lower_hex(&identity))
                .err(),
            Some(PinnedSignerError::WeakPublicKey)
        );
    }

    #[rstest]
    #[case::empty("")]
    #[case::spaced("deployment store signer")]
    fn an_unbounded_signer_identity_constructs_no_verifier(#[case] identity: &str) {
        let key = SigningKey::from_bytes(&[7_u8; 32]);

        assert_eq!(
            PinnedEd25519SignatureVerifier::from_public_key_hex(
                identity,
                &lower_hex(key.verifying_key().as_bytes())
            )
            .err(),
            Some(PinnedSignerError::InvalidSignerIdentity)
        );
    }
}
