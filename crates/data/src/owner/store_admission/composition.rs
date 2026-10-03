//! The production composition of the custodian's five ports.
//!
//! The deployment names each port's authority in its environment, and this reads only those names
//! and the files they point to; it accepts no credential value through the environment. Every port
//! is required, and the first one that cannot be built refuses the whole admission under that
//! port's own failure code:
//!
//! - **Anti-rollback witness:** `DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE` must name the single-machine
//!   mode, `SINGLE_TRUST_DOMAIN_NO_ROLLBACK_WITNESS`, exactly. The deployment states the downgrade
//!   it runs under rather than inheriting it; there is no other mode yet.
//! - **Signature verifier:** `DEPLOYMENT_STORE_SIGNER_IDENTITY` and the store signer's Ed25519 public
//!   key in hexadecimal, in the file `DEPLOYMENT_STORE_SIGNER_PUBLIC_KEY_PATH` names.
//! - **Credential resolver:** the secrets directory `DEPLOYMENT_STORE_LEASED_FILES_DIRECTORY`, and the
//!   synthetic lease `DEPLOYMENT_STORE_LEASE_PERIOD_MS` a file without an expiry of its own gets.
//! - **Direct measurer:** the one root the store's TLS is pinned to, in the file
//!   `DEPLOYMENT_STORE_POSTGRES_ROOT_CERTIFICATE_PATH` names.
//! - **Custody store:** the custodian principal's connection string, in the secret file
//!   `DEPLOYMENT_STORE_CUSTODIAN_CONNECTION_FILE` names. It is connected last, once everything
//!   local has been built.

use std::sync::Arc;

use super::{
    AdmissionFailureCode, AntiRollbackWitness, Custodian, credential_files, custody_postgres,
    postgres, signature::PinnedEd25519SignatureVerifier,
    witness::SingleTrustDomainNoRollbackWitness,
};

pub(super) const ANTI_ROLLBACK_MODE_ENV: &str = "DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE";
pub(super) const SIGNER_IDENTITY_ENV: &str = "DEPLOYMENT_STORE_SIGNER_IDENTITY";
pub(super) const SIGNER_PUBLIC_KEY_PATH_ENV: &str = "DEPLOYMENT_STORE_SIGNER_PUBLIC_KEY_PATH";
pub(super) const LEASED_FILES_DIRECTORY_ENV: &str = "DEPLOYMENT_STORE_LEASED_FILES_DIRECTORY";
pub(super) const LEASE_PERIOD_MS_ENV: &str = "DEPLOYMENT_STORE_LEASE_PERIOD_MS";
pub(super) const POSTGRES_ROOT_CERTIFICATE_PATH_ENV: &str =
    "DEPLOYMENT_STORE_POSTGRES_ROOT_CERTIFICATE_PATH";
pub(super) const CUSTODIAN_CONNECTION_FILE_ENV: &str = "DEPLOYMENT_STORE_CUSTODIAN_CONNECTION_FILE";

/// The one anti-rollback mode this deployment can run, by the name the user authorized it under.
pub(super) const SINGLE_TRUST_DOMAIN_MODE: &str = "SINGLE_TRUST_DOMAIN_NO_ROLLBACK_WITNESS";

/// Builds the custodian from the deployment's configuration, or names the port that could not be
/// built.
pub(super) async fn production_custodian(
    mut lookup: impl FnMut(&str) -> Option<String>,
) -> Result<Custodian, AdmissionFailureCode> {
    if lookup(ANTI_ROLLBACK_MODE_ENV).as_deref() != Some(SINGLE_TRUST_DOMAIN_MODE) {
        return Err(AdmissionFailureCode::ProductionAntiRollbackWitnessUnavailable);
    }
    let witness: Arc<dyn AntiRollbackWitness> = Arc::new(SingleTrustDomainNoRollbackWitness);
    let signatures = signature_verifier(&mut lookup)
        .ok_or(AdmissionFailureCode::ProductionSignatureVerifierUnavailable)?;
    let credentials = credential_resolver(&mut lookup)
        .ok_or(AdmissionFailureCode::ProductionCredentialResolverUnavailable)?;
    let measurer =
        direct_measurer(&mut lookup).ok_or(AdmissionFailureCode::DirectMeasurementUnavailable)?;
    let custodian_url = configured_file(&mut lookup, CUSTODIAN_CONNECTION_FILE_ENV)
        .and_then(|bytes| secret_text(&bytes))
        .ok_or(AdmissionFailureCode::ProductionResolverUnavailable)?;
    let custody =
        custody_postgres::PostgresCustodyStore::connect(&custodian_url, Arc::clone(&witness))
            .await
            .map_err(|_| AdmissionFailureCode::ProductionResolverUnavailable)?;

    Ok(Custodian::new(
        Arc::new(custody),
        Arc::new(signatures),
        witness,
        Arc::new(credentials),
        Arc::new(measurer),
    ))
}

fn signature_verifier(
    lookup: &mut impl FnMut(&str) -> Option<String>,
) -> Option<PinnedEd25519SignatureVerifier> {
    let identity = lookup(SIGNER_IDENTITY_ENV)?;
    let key = secret_text(&configured_file(lookup, SIGNER_PUBLIC_KEY_PATH_ENV)?)?;
    PinnedEd25519SignatureVerifier::from_public_key_hex(identity, &key).ok()
}

fn credential_resolver(
    lookup: &mut impl FnMut(&str) -> Option<String>,
) -> Option<credential_files::SecretFileCredentialResolver> {
    let directory = lookup(LEASED_FILES_DIRECTORY_ENV)?;
    let lease_ms = lookup(LEASE_PERIOD_MS_ENV)?.parse::<u64>().ok()?;
    credential_files::SecretFileCredentialResolver::new(directory, lease_ms).ok()
}

fn direct_measurer(
    lookup: &mut impl FnMut(&str) -> Option<String>,
) -> Option<postgres::PinnedTlsPostgresDirectMeasurer> {
    let root = configured_file(lookup, POSTGRES_ROOT_CERTIFICATE_PATH_ENV)?;
    postgres::PinnedTlsPostgresDirectMeasurer::from_root_pem(&root).ok()
}

/// The bytes of the regular file the variable `name` points to.
fn configured_file(
    lookup: &mut impl FnMut(&str) -> Option<String>,
    name: &str,
) -> Option<zeroize::Zeroizing<Vec<u8>>> {
    let path = lookup(name)?;
    credential_files::read_regular_file(std::path::Path::new(&path))
}

/// A file's text, a trailing newline aside.
fn secret_text(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    Some(text.strip_suffix('\n').unwrap_or(text).to_owned())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use rstest::rstest;

    use super::*;

    /// A configuration whose every local port builds, from files in `directory`; the custody store
    /// is the only one left to connect.
    fn local_configuration(directory: &std::path::Path) -> HashMap<&'static str, String> {
        let key = ed25519_dalek::SigningKey::from_bytes(&[7; 32]);
        let root = {
            let key = rcgen::KeyPair::generate().unwrap();
            let mut params = rcgen::CertificateParams::new(Vec::<String>::new()).unwrap();
            params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
            params.self_signed(&key).unwrap().pem()
        };
        let write = |name: &str, contents: &[u8]| {
            let path = directory.join(name);
            std::fs::write(&path, contents).unwrap();
            path.to_string_lossy().into_owned()
        };

        HashMap::from([
            (ANTI_ROLLBACK_MODE_ENV, SINGLE_TRUST_DOMAIN_MODE.to_owned()),
            (SIGNER_IDENTITY_ENV, "deployment-store-signer-v1".to_owned()),
            (
                SIGNER_PUBLIC_KEY_PATH_ENV,
                write(
                    "signer.hex",
                    format!(
                        "{}\n",
                        super::super::signature::lower_hex(key.verifying_key().as_bytes())
                    )
                    .as_bytes(),
                ),
            ),
            (
                LEASED_FILES_DIRECTORY_ENV,
                directory.to_string_lossy().into_owned(),
            ),
            (LEASE_PERIOD_MS_ENV, "300000".to_owned()),
            (
                POSTGRES_ROOT_CERTIFICATE_PATH_ENV,
                write("root.pem", root.as_bytes()),
            ),
            (
                CUSTODIAN_CONNECTION_FILE_ENV,
                // Not a connection string: the custody store is the last port built, so a
                // configuration whose every other port builds fails there and only there.
                write("custodian-url", b"not-a-connection-string\n"),
            ),
        ])
    }

    /// Every port is required, and each one missing or unusable refuses the admission under that
    /// port's own code. The mode is required by its exact name.
    #[rstest]
    #[case::no_mode(
        ANTI_ROLLBACK_MODE_ENV,
        None,
        AdmissionFailureCode::ProductionAntiRollbackWitnessUnavailable
    )]
    #[case::another_mode(
        ANTI_ROLLBACK_MODE_ENV,
        Some("WITNESSED"),
        AdmissionFailureCode::ProductionAntiRollbackWitnessUnavailable
    )]
    #[case::no_signer(
        SIGNER_IDENTITY_ENV,
        None,
        AdmissionFailureCode::ProductionSignatureVerifierUnavailable
    )]
    #[case::no_signer_key(
        SIGNER_PUBLIC_KEY_PATH_ENV,
        Some("/nonexistent/signer.hex"),
        AdmissionFailureCode::ProductionSignatureVerifierUnavailable
    )]
    #[case::a_relative_secrets_directory(
        LEASED_FILES_DIRECTORY_ENV,
        Some("run/secrets"),
        AdmissionFailureCode::ProductionCredentialResolverUnavailable
    )]
    #[case::no_lease(
        LEASE_PERIOD_MS_ENV,
        Some("0"),
        AdmissionFailureCode::ProductionCredentialResolverUnavailable
    )]
    #[case::no_root(
        POSTGRES_ROOT_CERTIFICATE_PATH_ENV,
        None,
        AdmissionFailureCode::DirectMeasurementUnavailable
    )]
    #[case::no_custody_store(
        CUSTODIAN_CONNECTION_FILE_ENV,
        None,
        AdmissionFailureCode::ProductionResolverUnavailable
    )]
    #[case::an_unusable_custody_store(
        "UNSET_SO_NOTHING_CHANGES",
        None,
        AdmissionFailureCode::ProductionResolverUnavailable
    )]
    #[tokio::test]
    async fn each_port_is_required_and_refuses_under_its_own_code(
        #[case] changed: &str,
        #[case] value: Option<&str>,
        #[case] refusal: AdmissionFailureCode,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let mut configuration = local_configuration(directory.path());

        match value {
            Some(value) => {
                configuration.insert(
                    configuration
                        .keys()
                        .find(|name| **name == changed)
                        .copied()
                        .unwrap(),
                    value.to_owned(),
                );
            }
            None => {
                configuration.retain(|name, _| *name != changed);
            }
        }
        let refused = production_custodian(|name| configuration.get(name).cloned()).await;

        assert_eq!(refused.map(|_| ()).unwrap_err(), refusal);
    }
}
