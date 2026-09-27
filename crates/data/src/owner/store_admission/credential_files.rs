//! The production credential resolver: one secret file per opaque credential handle, as docker
//! secrets mounts them.
//!
//! A static file carries no expiry and no version of its own, so both are derived rather than
//! assumed. The version is the SHA-256 of the file's exact bytes: the signed manifest names the
//! version it admits, so a changed secret is a new version, and only a newly signed manifest admits
//! it. The lease lapses a fixed time after the admission's store-clock cut, never on this process's
//! clock, because the custody store judges the receipt's window on the store's clock.

use std::{
    io::Read,
    path::{Path, PathBuf},
};

use async_trait::async_trait;
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroizing;

use super::{CredentialHandleBinding, CredentialResolver, postgres::PostgresCredentialLease};

/// Bound on one secret file: a PostgreSQL URL, never a document.
const MAX_SECRET_BYTES: u64 = 4_096;

/// Why a secret-file resolver could not be constructed. Secret-free.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub(super) enum SecretFileResolverError {
    #[error("the secrets directory is not an absolute path")]
    RelativeDirectory,
    #[error("the lease duration must be positive")]
    EmptyLease,
}

/// Resolves a credential handle to the secret file named by its identity under one directory.
pub(super) struct SecretFileCredentialResolver {
    directory: PathBuf,
    lease_ms: u64,
}

impl SecretFileCredentialResolver {
    /// Resolves handles under `directory` (for docker secrets, `/run/secrets`); each lease lapses
    /// `lease_ms` after the cut it was resolved at.
    ///
    /// # Errors
    ///
    /// Returns an error for a relative directory or an empty lease.
    pub(super) fn new(
        directory: impl Into<PathBuf>,
        lease_ms: u64,
    ) -> Result<Self, SecretFileResolverError> {
        let directory = directory.into();

        if !directory.is_absolute() {
            return Err(SecretFileResolverError::RelativeDirectory);
        }

        if lease_ms == 0 {
            return Err(SecretFileResolverError::EmptyLease);
        }
        Ok(Self {
            directory,
            lease_ms,
        })
    }

    /// The file a handle names, or none. An identity is already a bounded opaque identity, which
    /// allows dots; one that starts with a dot could name `.` or `..`, or a hidden file, and never
    /// names a secret.
    fn secret_path(&self, handle: &CredentialHandleBinding) -> Option<PathBuf> {
        if handle.identity.is_empty() || handle.identity.starts_with('.') {
            return None;
        }
        Some(self.directory.join(&handle.identity))
    }
}

#[async_trait]
impl CredentialResolver for SecretFileCredentialResolver {
    async fn resolve(
        &self,
        handle: &CredentialHandleBinding,
        cut_epoch_ms: u64,
    ) -> Result<PostgresCredentialLease, ()> {
        let path = self.secret_path(handle).ok_or(())?;
        let bytes = read_regular_file(&path).ok_or(())?;
        // The lease carries the version the file is, not the one the handle asks for: whether they
        // are the same is the custodian's to judge, as a rejected lease rather than a missing one.
        let version = secret_version(&bytes);
        let url = std::str::from_utf8(&bytes).map_err(|_| ())?;
        let url = url.strip_suffix('\n').unwrap_or(url);
        PostgresCredentialLease::from_resolved_secret(
            &handle.identity,
            &handle.audience,
            version,
            cut_epoch_ms.checked_add(self.lease_ms).ok_or(())?,
            url.to_string(),
        )
        .map_err(|_| ())
    }
}

/// The version a manifest signs for a secret: `sha256-` and the lowercase hexadecimal SHA-256 of
/// the file's exact bytes, a trailing newline included.
pub(super) fn secret_version(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    Sha256::digest(bytes)
        .iter()
        .fold(String::from("sha256-"), |mut output, byte| {
            let _ = write!(output, "{byte:02x}");
            output
        })
}

/// The bytes of a regular, bounded, non-empty file, or none. A symbolic link is refused rather than
/// followed: a secret is the file mounted at its name, not whatever that name points to.
fn read_regular_file(path: &Path) -> Option<Zeroizing<Vec<u8>>> {
    let metadata = std::fs::symlink_metadata(path).ok()?;

    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_SECRET_BYTES {
        return None;
    }
    let mut bytes = Zeroizing::new(Vec::new());
    std::fs::File::open(path)
        .ok()?
        .take(MAX_SECRET_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;

    if bytes.is_empty() || bytes.len() as u64 > MAX_SECRET_BYTES {
        return None;
    }
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use rstest::rstest;

    use super::*;

    const URL: &str = "postgres://market_data_admitted_reader:secret@127.0.0.1:5432/rd_owner";

    /// A fresh directory of its own under the system temporary directory, removed on drop.
    struct SecretsDirectory(PathBuf);

    impl SecretsDirectory {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "vibe-secret-files-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, bytes: &[u8]) {
            std::fs::write(self.0.join(name), bytes).unwrap();
        }
    }

    impl Drop for SecretsDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn handle(identity: &str, version: String) -> CredentialHandleBinding {
        CredentialHandleBinding {
            identity: identity.to_string(),
            audience: "STRATEGY_FACTORY_RD_OWNER_API_V1".to_string(),
            version,
        }
    }

    #[rstest]
    #[tokio::test]
    async fn a_mounted_secret_leases_its_url_until_a_fixed_time_after_the_cut() {
        let directory = SecretsDirectory::new();
        let bytes = format!("{URL}\n");
        directory.write("market-data-admitted-reader", bytes.as_bytes());
        let resolver = SecretFileCredentialResolver::new(&directory.0, 300_000).unwrap();

        let lease = resolver
            .resolve(
                &handle(
                    "market-data-admitted-reader",
                    secret_version(bytes.as_bytes()),
                ),
                1_000,
            )
            .await
            .unwrap();

        assert_eq!(lease.database_url(), URL);
        assert_eq!(lease.handle_identity(), "market-data-admitted-reader");
        assert_eq!(lease.version(), secret_version(bytes.as_bytes()));
        assert_eq!(lease.valid_through_epoch_ms(), 301_000);
        assert!(!format!("{lease:?}").contains("secret@"));
    }

    #[rstest]
    #[tokio::test]
    async fn a_lease_names_the_version_the_file_is_not_the_one_asked_for() {
        let directory = SecretsDirectory::new();
        let bytes = format!("{URL}\n");
        directory.write("reader", bytes.as_bytes());
        let resolver = SecretFileCredentialResolver::new(&directory.0, 300_000).unwrap();

        // The same URL without its newline is other bytes, so another version.
        let asked = secret_version(URL.as_bytes());
        let lease = resolver
            .resolve(&handle("reader", asked.clone()), 1_000)
            .await
            .unwrap();

        assert_ne!(lease.version(), asked);
        assert_eq!(lease.version(), secret_version(bytes.as_bytes()));
    }

    #[rstest]
    #[case::missing("absent")]
    #[case::dot(".")]
    #[case::parent("..")]
    #[case::hidden(".reader")]
    #[case::empty_identity("")]
    #[tokio::test]
    async fn a_handle_that_names_no_secret_file_leases_nothing(#[case] identity: &str) {
        let directory = SecretsDirectory::new();
        directory.write(".reader", URL.as_bytes());
        let resolver = SecretFileCredentialResolver::new(&directory.0, 300_000).unwrap();

        assert_eq!(
            resolver
                .resolve(&handle(identity, secret_version(URL.as_bytes())), 1_000)
                .await
                .err(),
            Some(())
        );
    }

    #[rstest]
    #[tokio::test]
    async fn an_empty_oversized_linked_or_directory_secret_leases_nothing() {
        let directory = SecretsDirectory::new();
        directory.write("empty", b"");
        let oversized = vec![b'a'; 4_097];
        directory.write("oversized", &oversized);
        directory.write("target", URL.as_bytes());
        std::os::unix::fs::symlink(directory.0.join("target"), directory.0.join("linked")).unwrap();
        std::fs::create_dir(directory.0.join("folder")).unwrap();
        let resolver = SecretFileCredentialResolver::new(&directory.0, 300_000).unwrap();

        for (identity, bytes) in [
            ("empty", &b""[..]),
            ("oversized", &oversized[..]),
            ("linked", URL.as_bytes()),
            ("folder", &b""[..]),
        ] {
            assert_eq!(
                resolver
                    .resolve(&handle(identity, secret_version(bytes)), 1_000)
                    .await
                    .err(),
                Some(()),
                "{identity}"
            );
        }
        // The file the link points at resolves under its own name, so the refusal above is the
        // link's.
        assert!(
            resolver
                .resolve(&handle("target", secret_version(URL.as_bytes())), 1_000)
                .await
                .is_ok()
        );
    }

    #[rstest]
    #[tokio::test]
    async fn a_lease_that_would_lapse_past_the_end_of_time_is_refused() {
        let directory = SecretsDirectory::new();
        directory.write("reader", URL.as_bytes());
        let resolver = SecretFileCredentialResolver::new(&directory.0, 300_000).unwrap();

        assert_eq!(
            resolver
                .resolve(&handle("reader", secret_version(URL.as_bytes())), u64::MAX)
                .await
                .err(),
            Some(())
        );
    }

    #[rstest]
    fn a_relative_directory_or_an_empty_lease_constructs_no_resolver() {
        assert_eq!(
            SecretFileCredentialResolver::new("run/secrets", 300_000).err(),
            Some(SecretFileResolverError::RelativeDirectory)
        );
        assert_eq!(
            SecretFileCredentialResolver::new("/run/secrets", 0).err(),
            Some(SecretFileResolverError::EmptyLease)
        );
    }
}
