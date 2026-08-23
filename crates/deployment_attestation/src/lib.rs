//! Sealed verification of deployment artifacts at their executable use boundary.
//!
//! The crate owns mechanism, not business facts or deployment authority. Its production entrypoint
//! fixes every verification-policy field; callers can provide only the attestation bundle path.

use std::path::Path;

use serde::Serialize;

const AUTHORITY: &str = "github-artifact-attestation";
const REPOSITORY: &str = "qOeOp/trade";
const SIGNER_WORKFLOW: &str = "github.com/qOeOp/trade/.github/workflows/cli-binaries.yml";
const SOURCE_REF: &str = "refs/heads/main";
const PREDICATE_TYPE: &str = "https://slsa.dev/provenance/v1";
const OIDC_ISSUER: &str = "https://token.actions.githubusercontent.com";
const SUBJECT_NAME: &str = "strategy-factory-formation";
#[cfg(any(target_os = "linux", test))]
const MIN_GH_VERSION: (u64, u64, u64) = (2, 97, 0);

/// Opaque result of the sealed Strategy Factory formation release policy.
///
/// The type is serializable for the existing consumer receipt, but deliberately has no public
/// constructor or deserialization path. A positive value can only come from the fixed verifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct StrategyFactoryFormationEvidence {
    record: EvidenceRecord,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
enum EvidenceRecord {
    #[cfg(target_os = "linux")]
    Verified {
        authority: String,
        repository: String,
        signer_workflow: String,
        source_ref: String,
        signer_digest: String,
        predicate_type: String,
        oidc_issuer: String,
        deny_self_hosted_runners: bool,
        expected_source_digest: String,
        subject_name: String,
        subject_sha256: String,
        subject_byte_length: u64,
        subject_blake3: String,
        bundle_sha256: String,
        trusted_root_sha256: String,
        verifier_sha256: String,
        verifier_version_sha256: String,
        verification_output_sha256: String,
    },
    Rejected {
        authority: String,
        repository: String,
        signer_workflow: String,
        source_ref: String,
        signer_digest: String,
        predicate_type: String,
        oidc_issuer: String,
        deny_self_hosted_runners: bool,
        expected_source_digest: String,
        subject_name: String,
        error_code: ErrorCode,
    },
}

impl StrategyFactoryFormationEvidence {
    #[must_use]
    pub const fn is_verified(&self) -> bool {
        #[cfg(target_os = "linux")]
        {
            matches!(&self.record, EvidenceRecord::Verified { .. })
        }
        #[cfg(not(target_os = "linux"))]
        {
            false
        }
    }

    #[must_use]
    pub fn rejection_error(&self) -> String {
        match &self.record {
            #[cfg(target_os = "linux")]
            EvidenceRecord::Verified { .. } => {
                "native producer verification invariant violated: VERIFIED_EVIDENCE_REJECTED"
                    .to_string()
            }
            EvidenceRecord::Rejected { error_code, .. } => format!(
                "native producer verification rejected: {}",
                error_code.as_str()
            ),
        }
    }

    fn rejected(error_code: ErrorCode) -> Self {
        Self {
            record: EvidenceRecord::Rejected {
                authority: AUTHORITY.to_string(),
                repository: REPOSITORY.to_string(),
                signer_workflow: SIGNER_WORKFLOW.to_string(),
                source_ref: SOURCE_REF.to_string(),
                signer_digest: compiled_source_digest(),
                predicate_type: PREDICATE_TYPE.to_string(),
                oidc_issuer: OIDC_ISSUER.to_string(),
                deny_self_hosted_runners: true,
                expected_source_digest: compiled_source_digest(),
                subject_name: SUBJECT_NAME.to_string(),
                error_code,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ErrorCode {
    #[cfg(not(target_os = "linux"))]
    UnsupportedPlatform,
    #[cfg(target_os = "linux")]
    BuildSourceDigestUnavailable,
    #[cfg(target_os = "linux")]
    BuildSourceDigestInvalid,
    #[cfg(target_os = "linux")]
    SubjectUnavailable,
    #[cfg(target_os = "linux")]
    BundleUnavailable,
    #[cfg(target_os = "linux")]
    BundleSnapshotFailed,
    #[cfg(target_os = "linux")]
    TrustAnchorUnavailable,
    #[cfg(target_os = "linux")]
    VerifierUnavailable,
    #[cfg(target_os = "linux")]
    UntrustedTrustAnchor,
    #[cfg(target_os = "linux")]
    UntrustedVerifier,
    #[cfg(target_os = "linux")]
    VerifierVersionRejected,
    #[cfg(target_os = "linux")]
    VerifierExecutionFailed,
    #[cfg(target_os = "linux")]
    VerificationRejected,
    #[cfg(target_os = "linux")]
    VerificationOutputInvalid,
    #[cfg(target_os = "linux")]
    VerificationPolicyMismatch,
    #[cfg(target_os = "linux")]
    SubjectChangedDuringVerification,
    #[cfg(target_os = "linux")]
    BundleChangedDuringVerification,
    #[cfg(target_os = "linux")]
    TrustAnchorChangedDuringVerification,
    #[cfg(target_os = "linux")]
    VerifierChangedDuringVerification,
}

impl ErrorCode {
    const fn as_str(self) -> &'static str {
        match self {
            #[cfg(not(target_os = "linux"))]
            Self::UnsupportedPlatform => "UNSUPPORTED_PLATFORM",
            #[cfg(target_os = "linux")]
            Self::BuildSourceDigestUnavailable => "BUILD_SOURCE_DIGEST_UNAVAILABLE",
            #[cfg(target_os = "linux")]
            Self::BuildSourceDigestInvalid => "BUILD_SOURCE_DIGEST_INVALID",
            #[cfg(target_os = "linux")]
            Self::SubjectUnavailable => "SUBJECT_UNAVAILABLE",
            #[cfg(target_os = "linux")]
            Self::BundleUnavailable => "BUNDLE_UNAVAILABLE",
            #[cfg(target_os = "linux")]
            Self::BundleSnapshotFailed => "BUNDLE_SNAPSHOT_FAILED",
            #[cfg(target_os = "linux")]
            Self::TrustAnchorUnavailable => "TRUST_ANCHOR_UNAVAILABLE",
            #[cfg(target_os = "linux")]
            Self::VerifierUnavailable => "VERIFIER_UNAVAILABLE",
            #[cfg(target_os = "linux")]
            Self::UntrustedTrustAnchor => "UNTRUSTED_TRUST_ANCHOR",
            #[cfg(target_os = "linux")]
            Self::UntrustedVerifier => "UNTRUSTED_VERIFIER",
            #[cfg(target_os = "linux")]
            Self::VerifierVersionRejected => "VERIFIER_VERSION_REJECTED",
            #[cfg(target_os = "linux")]
            Self::VerifierExecutionFailed => "VERIFIER_EXECUTION_FAILED",
            #[cfg(target_os = "linux")]
            Self::VerificationRejected => "VERIFICATION_REJECTED",
            #[cfg(target_os = "linux")]
            Self::VerificationOutputInvalid => "VERIFICATION_OUTPUT_INVALID",
            #[cfg(target_os = "linux")]
            Self::VerificationPolicyMismatch => "VERIFICATION_POLICY_MISMATCH",
            #[cfg(target_os = "linux")]
            Self::SubjectChangedDuringVerification => "SUBJECT_CHANGED_DURING_VERIFICATION",
            #[cfg(target_os = "linux")]
            Self::BundleChangedDuringVerification => "BUNDLE_CHANGED_DURING_VERIFICATION",
            #[cfg(target_os = "linux")]
            Self::TrustAnchorChangedDuringVerification => {
                "TRUST_ANCHOR_CHANGED_DURING_VERIFICATION"
            }
            #[cfg(target_os = "linux")]
            Self::VerifierChangedDuringVerification => "VERIFIER_CHANGED_DURING_VERIFICATION",
        }
    }
}

/// Verifies the running Strategy Factory formation executable against its one fixed release policy.
///
/// The executable, verifier, trust root, repository, workflow, ref, issuer, and version policy are
/// selected inside this crate. The bundle path is the caller's only input.
#[must_use]
pub fn verify_strategy_factory_formation(bundle_path: &Path) -> StrategyFactoryFormationEvidence {
    verify_platform(bundle_path)
}

fn compiled_source_digest() -> String {
    option_env!("STRATEGY_FACTORY_SOURCE_DIGEST")
        .filter(|value| valid_git_digest(value))
        .unwrap_or("UNAVAILABLE")
        .to_string()
}

fn valid_git_digest(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(any(target_os = "linux", test))]
fn fd_path(fd: i32) -> String {
    format!("/proc/self/fd/{fd}")
}

#[cfg(any(target_os = "linux", test))]
fn verification_args(
    subject_fd: i32,
    bundle_fd: i32,
    trusted_root_fd: i32,
    source_digest: &str,
) -> Vec<String> {
    [
        "attestation".to_string(),
        "verify".to_string(),
        fd_path(subject_fd),
        "--repo".to_string(),
        REPOSITORY.to_string(),
        "--signer-workflow".to_string(),
        SIGNER_WORKFLOW.to_string(),
        "--source-digest".to_string(),
        source_digest.to_string(),
        "--source-ref".to_string(),
        SOURCE_REF.to_string(),
        "--signer-digest".to_string(),
        source_digest.to_string(),
        "--predicate-type".to_string(),
        PREDICATE_TYPE.to_string(),
        "--cert-oidc-issuer".to_string(),
        OIDC_ISSUER.to_string(),
        "--deny-self-hosted-runners".to_string(),
        "--bundle".to_string(),
        fd_path(bundle_fd),
        "--custom-trusted-root".to_string(),
        fd_path(trusted_root_fd),
        "--format".to_string(),
        "json".to_string(),
    ]
    .into()
}

#[cfg(any(target_os = "linux", test))]
fn supported_gh_version(output: &[u8]) -> bool {
    let Ok(output) = std::str::from_utf8(output) else {
        return false;
    };
    let Some(version) = output
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("gh version "))
        .and_then(|tail| tail.split_whitespace().next())
    else {
        return false;
    };
    let mut components = version.split('.').map(str::parse::<u64>);
    let parsed = match (
        components.next(),
        components.next(),
        components.next(),
        components.next(),
    ) {
        (Some(Ok(major)), Some(Ok(minor)), Some(Ok(patch)), None) => (major, minor, patch),
        _ => return false,
    };
    parsed >= MIN_GH_VERSION
}

#[cfg(any(target_os = "linux", test))]
fn parse_verification_output(
    bytes: &[u8],
    expected_subject_sha256: &str,
) -> Result<serde_json::Value, ErrorCode> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| output_invalid())?;
    let entries = value
        .as_array()
        .filter(|entries| entries.len() == 1)
        .ok_or_else(output_invalid)?;
    let result = entries[0]
        .get("verificationResult")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(output_invalid)?;
    let statement = result
        .get("statement")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(output_invalid)?;
    let subjects = statement
        .get("subject")
        .and_then(serde_json::Value::as_array)
        .filter(|subjects| subjects.len() == 1)
        .ok_or_else(output_invalid)?;
    let name_matches =
        subjects[0].get("name").and_then(serde_json::Value::as_str) == Some(SUBJECT_NAME);
    let digest_matches = subjects[0]
        .pointer("/digest/sha256")
        .and_then(serde_json::Value::as_str)
        == Some(expected_subject_sha256);
    let predicate_matches = statement
        .get("predicateType")
        .and_then(serde_json::Value::as_str)
        == Some(PREDICATE_TYPE);
    let has_certificate = result
        .get("signature")
        .and_then(|signature| signature.get("certificate"))
        .is_some_and(|certificate| !certificate.is_null());
    let has_verified_timestamp = result
        .get("verifiedTimestamps")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|timestamps| !timestamps.is_empty());

    if !(name_matches
        && digest_matches
        && predicate_matches
        && has_certificate
        && has_verified_timestamp)
    {
        return Err(policy_mismatch());
    }
    Ok(value)
}

#[cfg(target_os = "linux")]
const fn output_invalid() -> ErrorCode {
    ErrorCode::VerificationOutputInvalid
}

#[cfg(all(not(target_os = "linux"), test))]
const fn output_invalid() -> ErrorCode {
    ErrorCode::UnsupportedPlatform
}

#[cfg(target_os = "linux")]
const fn policy_mismatch() -> ErrorCode {
    ErrorCode::VerificationPolicyMismatch
}

#[cfg(all(not(target_os = "linux"), test))]
const fn policy_mismatch() -> ErrorCode {
    ErrorCode::UnsupportedPlatform
}

#[cfg(not(target_os = "linux"))]
fn verify_platform(bundle_path: &Path) -> StrategyFactoryFormationEvidence {
    let _ = bundle_path;
    StrategyFactoryFormationEvidence::rejected(ErrorCode::UnsupportedPlatform)
}

#[cfg(target_os = "linux")]
mod linux {
    use std::{
        fs::{File, OpenOptions},
        io::{Read, Seek, SeekFrom, Write},
        os::{
            fd::{AsRawFd, FromRawFd, RawFd},
            unix::{fs::MetadataExt, process::ExitStatusExt},
        },
        process::Command,
    };

    use sha2::{Digest, Sha256};

    use super::*;

    const SUBJECT_PATH: &str = "/proc/self/exe";
    const TRUSTED_ROOT_PATH: &str = "/etc/qoeop/strategy-factory/trusted_root.jsonl";
    const VERIFIER_PATH: &str = "/usr/bin/gh";
    const MAX_SUBJECT_BYTES: u64 = 256 * 1024 * 1024;
    const MAX_BUNDLE_BYTES: u64 = 16 * 1024 * 1024;
    const MAX_TRUSTED_ROOT_BYTES: u64 = 16 * 1024 * 1024;
    const MAX_VERIFIER_BYTES: u64 = 256 * 1024 * 1024;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct FileIdentity {
        sha256: String,
        blake3: String,
        byte_length: u64,
    }

    pub(super) fn verify(bundle_path: &Path) -> StrategyFactoryFormationEvidence {
        let Some(source_digest) = option_env!("STRATEGY_FACTORY_SOURCE_DIGEST") else {
            return StrategyFactoryFormationEvidence::rejected(
                ErrorCode::BuildSourceDigestUnavailable,
            );
        };

        if !valid_git_digest(source_digest) {
            return StrategyFactoryFormationEvidence::rejected(ErrorCode::BuildSourceDigestInvalid);
        }

        let subject = match File::open(SUBJECT_PATH) {
            Ok(file) if regular_bounded(&file, MAX_SUBJECT_BYTES) => file,
            _ => return StrategyFactoryFormationEvidence::rejected(ErrorCode::SubjectUnavailable),
        };
        let bundle_source = match open_regular(bundle_path, MAX_BUNDLE_BYTES) {
            Ok(file) => file,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(ErrorCode::BundleUnavailable);
            }
        };
        let bundle = match sealed_snapshot(&bundle_source, MAX_BUNDLE_BYTES) {
            Ok(file) => file,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(ErrorCode::BundleSnapshotFailed);
            }
        };
        let trusted_root = match open_regular(Path::new(TRUSTED_ROOT_PATH), MAX_TRUSTED_ROOT_BYTES)
        {
            Ok(file) => file,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(
                    ErrorCode::TrustAnchorUnavailable,
                );
            }
        };

        if !root_owned_read_only(&trusted_root)
            || !trusted_directory_chain(&[
                Path::new("/"),
                Path::new("/etc"),
                Path::new("/etc/qoeop"),
                Path::new("/etc/qoeop/strategy-factory"),
            ])
        {
            return StrategyFactoryFormationEvidence::rejected(ErrorCode::UntrustedTrustAnchor);
        }

        let verifier = match open_regular(Path::new(VERIFIER_PATH), MAX_VERIFIER_BYTES) {
            Ok(file) => file,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(ErrorCode::VerifierUnavailable);
            }
        };

        if !root_owned_read_only(&verifier)
            || !trusted_directory_chain(&[Path::new("/"), Path::new("/usr"), Path::new("/usr/bin")])
        {
            return StrategyFactoryFormationEvidence::rejected(ErrorCode::UntrustedVerifier);
        }

        for file in [&subject, &bundle, &trusted_root, &verifier] {
            if clear_close_on_exec(file.as_raw_fd()).is_err() {
                return StrategyFactoryFormationEvidence::rejected(
                    ErrorCode::VerifierExecutionFailed,
                );
            }
        }

        let subject_before = match hash_file(&subject) {
            Ok(identity) => identity,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(ErrorCode::SubjectUnavailable);
            }
        };
        let bundle_identity = match hash_file(&bundle) {
            Ok(identity) => identity,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(ErrorCode::BundleUnavailable);
            }
        };
        let trusted_root_identity = match hash_file(&trusted_root) {
            Ok(identity) => identity,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(
                    ErrorCode::TrustAnchorUnavailable,
                );
            }
        };
        let verifier_identity = match hash_file(&verifier) {
            Ok(identity) => identity,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(ErrorCode::VerifierUnavailable);
            }
        };

        let verifier_path = fd_path(verifier.as_raw_fd());
        let version_output = match clean_command(&verifier_path).arg("--version").output() {
            Ok(output) if output.status.success() && output.stderr.is_empty() => output.stdout,
            _ => {
                return StrategyFactoryFormationEvidence::rejected(
                    ErrorCode::VerifierVersionRejected,
                );
            }
        };

        if !supported_gh_version(&version_output) {
            return StrategyFactoryFormationEvidence::rejected(ErrorCode::VerifierVersionRejected);
        }

        let output = match clean_command(&verifier_path)
            .args(verification_args(
                subject.as_raw_fd(),
                bundle.as_raw_fd(),
                trusted_root.as_raw_fd(),
                source_digest,
            ))
            .output()
        {
            Ok(output) => output,
            Err(_) => {
                return StrategyFactoryFormationEvidence::rejected(
                    ErrorCode::VerifierExecutionFailed,
                );
            }
        };

        if !output.status.success() {
            let code = if output.status.code().is_none() && output.status.signal().is_some() {
                ErrorCode::VerifierExecutionFailed
            } else {
                ErrorCode::VerificationRejected
            };
            return StrategyFactoryFormationEvidence::rejected(code);
        }

        if !output.stderr.is_empty() {
            return StrategyFactoryFormationEvidence::rejected(
                ErrorCode::VerificationOutputInvalid,
            );
        }

        let subject_after = match hash_file(&subject) {
            Ok(identity) => identity,
            Err(()) => {
                return StrategyFactoryFormationEvidence::rejected(
                    ErrorCode::SubjectChangedDuringVerification,
                );
            }
        };

        if subject_before != subject_after {
            return StrategyFactoryFormationEvidence::rejected(
                ErrorCode::SubjectChangedDuringVerification,
            );
        }

        if hash_file(&bundle).as_ref() != Ok(&bundle_identity) {
            return StrategyFactoryFormationEvidence::rejected(
                ErrorCode::BundleChangedDuringVerification,
            );
        }

        if hash_file(&trusted_root).as_ref() != Ok(&trusted_root_identity) {
            return StrategyFactoryFormationEvidence::rejected(
                ErrorCode::TrustAnchorChangedDuringVerification,
            );
        }

        if hash_file(&verifier).as_ref() != Ok(&verifier_identity) {
            return StrategyFactoryFormationEvidence::rejected(
                ErrorCode::VerifierChangedDuringVerification,
            );
        }

        let verification = match parse_verification_output(&output.stdout, &subject_before.sha256) {
            Ok(value) => value,
            Err(code) => return StrategyFactoryFormationEvidence::rejected(code),
        };
        let canonical_output = match serde_json::to_vec(&verification) {
            Ok(bytes) => bytes,
            Err(_) => {
                return StrategyFactoryFormationEvidence::rejected(
                    ErrorCode::VerificationOutputInvalid,
                );
            }
        };

        StrategyFactoryFormationEvidence {
            record: EvidenceRecord::Verified {
                authority: AUTHORITY.to_string(),
                repository: REPOSITORY.to_string(),
                signer_workflow: SIGNER_WORKFLOW.to_string(),
                source_ref: SOURCE_REF.to_string(),
                signer_digest: source_digest.to_string(),
                predicate_type: PREDICATE_TYPE.to_string(),
                oidc_issuer: OIDC_ISSUER.to_string(),
                deny_self_hosted_runners: true,
                expected_source_digest: source_digest.to_string(),
                subject_name: SUBJECT_NAME.to_string(),
                subject_sha256: subject_before.sha256,
                subject_byte_length: subject_before.byte_length,
                subject_blake3: subject_before.blake3,
                bundle_sha256: bundle_identity.sha256,
                trusted_root_sha256: trusted_root_identity.sha256,
                verifier_sha256: verifier_identity.sha256,
                verifier_version_sha256: sha256(&version_output),
                verification_output_sha256: sha256(&canonical_output),
            },
        }
    }

    fn clean_command(program: &str) -> Command {
        let mut command = Command::new(program);
        command
            .env_clear()
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_NO_UPDATE_NOTIFIER", "1")
            .env("NO_COLOR", "1");
        command
    }

    fn sealed_snapshot(source: &File, max_bytes: u64) -> Result<File, ()> {
        // SAFETY: the name is a static NUL-terminated C string and the returned descriptor is
        // immediately owned by `File` on success.
        let raw_fd = unsafe {
            libc::memfd_create(
                c"strategy-factory-attestation-bundle".as_ptr(),
                libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
            )
        };

        if raw_fd < 0 {
            return Err(());
        }
        // SAFETY: `memfd_create` returned a new descriptor exclusively owned by this function.
        let mut snapshot = unsafe { File::from_raw_fd(raw_fd) };
        let reader = File::open(fd_path(source.as_raw_fd())).map_err(|_| ())?;
        let copied =
            std::io::copy(&mut reader.take(max_bytes + 1), &mut snapshot).map_err(|_| ())?;
        if copied == 0 || copied > max_bytes {
            return Err(());
        }
        snapshot.flush().map_err(|_| ())?;

        let required_seals =
            libc::F_SEAL_WRITE | libc::F_SEAL_GROW | libc::F_SEAL_SHRINK | libc::F_SEAL_SEAL;
        // SAFETY: `snapshot` owns a live memfd created with MFD_ALLOW_SEALING; F_ADD_SEALS and
        // F_GET_SEALS do not take pointers.
        if unsafe { libc::fcntl(snapshot.as_raw_fd(), libc::F_ADD_SEALS, required_seals) } != 0 {
            return Err(());
        }
        // SAFETY: `snapshot` remains live and F_GET_SEALS does not take a pointer.
        let actual_seals = unsafe { libc::fcntl(snapshot.as_raw_fd(), libc::F_GET_SEALS) };
        if actual_seals < 0 || actual_seals & required_seals != required_seals {
            return Err(());
        }
        snapshot.seek(SeekFrom::Start(0)).map_err(|_| ())?;
        Ok(snapshot)
    }

    fn open_regular(path: &Path, max_bytes: u64) -> Result<File, ()> {
        use std::os::unix::fs::OpenOptionsExt;

        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(|_| ())?;
        regular_bounded(&file, max_bytes).then_some(file).ok_or(())
    }

    fn regular_bounded(file: &File, max_bytes: u64) -> bool {
        file.metadata().is_ok_and(|metadata| {
            metadata.is_file() && metadata.len() > 0 && metadata.len() <= max_bytes
        })
    }

    fn root_owned_read_only(file: &File) -> bool {
        file.metadata().is_ok_and(|metadata| {
            metadata.uid() == 0 && metadata.mode() & 0o022 == 0 && metadata.is_file()
        })
    }

    fn trusted_directory_chain(paths: &[&Path]) -> bool {
        paths.iter().all(|path| {
            path.symlink_metadata().is_ok_and(|metadata| {
                metadata.file_type().is_dir() && metadata.uid() == 0 && metadata.mode() & 0o022 == 0
            })
        })
    }

    fn clear_close_on_exec(fd: RawFd) -> Result<(), ()> {
        // SAFETY: `fd` comes from a live `File`; F_GETFD and F_SETFD do not take pointers.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        if flags < 0 {
            return Err(());
        }
        // SAFETY: `fd` remains live and the flags are the kernel-returned descriptor flags with
        // only FD_CLOEXEC removed so `gh` can reopen the exact inherited file descriptions.
        let result = unsafe { libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC) };
        (result == 0).then_some(()).ok_or(())
    }

    fn hash_file(file: &File) -> Result<FileIdentity, ()> {
        let mut reader = File::open(fd_path(file.as_raw_fd())).map_err(|_| ())?;
        reader.seek(SeekFrom::Start(0)).map_err(|_| ())?;
        let mut sha = Sha256::new();
        let mut blake = blake3::Hasher::new();
        let mut byte_length = 0u64;
        let mut buffer = vec![0u8; 64 * 1024].into_boxed_slice();
        loop {
            let read = reader.read(&mut buffer).map_err(|_| ())?;
            if read == 0 {
                break;
            }
            byte_length = byte_length.checked_add(read as u64).ok_or(())?;
            sha.update(&buffer[..read]);
            blake.update(&buffer[..read]);
        }
        Ok(FileIdentity {
            sha256: lower_hex(&sha.finalize()),
            blake3: format!("blake3:{}", blake.finalize().to_hex()),
            byte_length,
        })
    }

    fn sha256(bytes: &[u8]) -> String {
        lower_hex(&Sha256::digest(bytes))
    }

    fn lower_hex(bytes: &[u8]) -> String {
        use std::fmt::Write;

        let mut output = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
        }
        output
    }

    #[cfg(test)]
    mod tests {
        use std::{fs, os::unix::fs::symlink};

        use rstest::rstest;

        use super::*;

        #[rstest]
        fn symlink_and_non_regular_paths_fail_closed() {
            let root = tempfile::tempdir().unwrap();
            let file_path = root.path().join("bundle");
            fs::write(&file_path, b"bundle").unwrap();
            let link_path = root.path().join("bundle-link");
            symlink(&file_path, &link_path).unwrap();

            assert!(open_regular(&link_path, 64).is_err());
            assert!(open_regular(root.path(), 64).is_err());
        }

        #[rstest]
        fn opened_identity_survives_path_and_file_replacement() {
            let root = tempfile::tempdir().unwrap();
            let path = root.path().join("verifier");
            fs::write(&path, b"trusted-verifier").unwrap();
            let opened = open_regular(&path, 64).unwrap();
            let before = hash_file(&opened).unwrap();

            let replacement = root.path().join("replacement");
            fs::write(&replacement, b"substituted-verifier").unwrap();
            fs::rename(&replacement, &path).unwrap();

            assert_eq!(hash_file(&opened).unwrap(), before);
            assert_ne!(hash_file(&File::open(&path).unwrap()).unwrap(), before);
        }

        #[rstest]
        fn file_mutation_is_detected_by_identity_recheck() {
            let root = tempfile::tempdir().unwrap();
            let path = root.path().join("subject");
            fs::write(&path, b"subject-a").unwrap();
            let opened = open_regular(&path, 64).unwrap();
            let before = hash_file(&opened).unwrap();
            let mut writer = OpenOptions::new().write(true).open(&path).unwrap();
            writer.seek(SeekFrom::Start(0)).unwrap();
            writer.write_all(b"subject-b").unwrap();
            assert_ne!(hash_file(&opened).unwrap(), before);
        }

        #[rstest]
        fn bundle_snapshot_is_exact_and_immutable_after_source_changes() {
            // SAFETY: the static C string is NUL-terminated and the returned descriptor is handed
            // immediately to `File` on success.
            let raw_fd =
                unsafe { libc::memfd_create(c"mutable-source".as_ptr(), libc::MFD_CLOEXEC) };
            assert!(raw_fd >= 0);
            // SAFETY: `memfd_create` returned a fresh descriptor exclusively owned by this test.
            let mut source = unsafe { File::from_raw_fd(raw_fd) };
            source.write_all(b"bundle-a").unwrap();
            let mut snapshot = sealed_snapshot(&source, 64).unwrap();

            source.seek(SeekFrom::Start(0)).unwrap();
            source.write_all(b"bundle-b").unwrap();
            assert_eq!(hash_file(&snapshot).unwrap().sha256, sha256(b"bundle-a"));
            assert!(snapshot.write_all(b"x").is_err());
        }

        #[rstest]
        fn non_root_or_writable_trust_inputs_fail_closed() {
            use std::os::unix::fs::PermissionsExt;

            let root = tempfile::tempdir().unwrap();
            let path = root.path().join("root.jsonl");
            fs::write(&path, b"root").unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
            fs::set_permissions(root.path(), fs::Permissions::from_mode(0o777)).unwrap();
            assert!(!root_owned_read_only(&File::open(path).unwrap()));
            assert!(!trusted_directory_chain(&[root.path()]));
        }
    }
}

#[cfg(target_os = "linux")]
fn verify_platform(bundle_path: &Path) -> StrategyFactoryFormationEvidence {
    linux::verify(bundle_path)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn valid_output(subject_sha256: &str) -> serde_json::Value {
        serde_json::json!([{
            "attestation": {},
            "verificationResult": {
                "signature": {"certificate": {"issuer": "github"}},
                "verifiedTimestamps": [{"type": "transparency-log"}],
                "statement": {
                    "subject": [{
                        "name": SUBJECT_NAME,
                        "digest": {"sha256": subject_sha256}
                    }],
                    "predicateType": PREDICATE_TYPE,
                    "predicate": {}
                }
            }
        }])
    }

    #[rstest]
    fn sealed_policy_binds_repository_workflow_ref_source_issuer_and_paths() {
        let digest = "0123456789abcdef0123456789abcdef01234567";
        assert_eq!(
            verification_args(7, 8, 9, digest),
            vec![
                "attestation",
                "verify",
                "/proc/self/fd/7",
                "--repo",
                REPOSITORY,
                "--signer-workflow",
                SIGNER_WORKFLOW,
                "--source-digest",
                digest,
                "--source-ref",
                SOURCE_REF,
                "--signer-digest",
                digest,
                "--predicate-type",
                PREDICATE_TYPE,
                "--cert-oidc-issuer",
                OIDC_ISSUER,
                "--deny-self-hosted-runners",
                "--bundle",
                "/proc/self/fd/8",
                "--custom-trusted-root",
                "/proc/self/fd/9",
                "--format",
                "json",
            ]
        );
    }

    #[rstest]
    #[case::subject_name("/0/verificationResult/statement/subject/0/name")]
    #[case::subject_digest("/0/verificationResult/statement/subject/0/digest/sha256")]
    #[case::predicate("/0/verificationResult/statement/predicateType")]
    fn output_policy_mismatch_fails_closed(#[case] pointer: &str) {
        let digest = "a".repeat(64);
        let mut output = valid_output(&digest);
        *output.pointer_mut(pointer).unwrap() = "wrong".into();
        assert_eq!(
            parse_verification_output(&serde_json::to_vec(&output).unwrap(), &digest),
            Err(policy_mismatch())
        );
    }

    #[rstest]
    #[case::signature("/0/verificationResult/signature/certificate")]
    #[case::timestamp("/0/verificationResult/verifiedTimestamps")]
    fn missing_signature_or_transparency_evidence_fails_closed(#[case] pointer: &str) {
        let digest = "a".repeat(64);
        let mut output = valid_output(&digest);
        *output.pointer_mut(pointer).unwrap() = serde_json::Value::Null;
        assert_eq!(
            parse_verification_output(&serde_json::to_vec(&output).unwrap(), &digest),
            Err(policy_mismatch())
        );
    }

    #[rstest]
    fn malformed_or_ambiguous_output_fails_closed() {
        let digest = "a".repeat(64);
        assert_eq!(
            parse_verification_output(b"not-json", &digest),
            Err(output_invalid())
        );
        let duplicate = serde_json::json!([valid_output(&digest)[0], valid_output(&digest)[0]]);
        assert_eq!(
            parse_verification_output(&serde_json::to_vec(&duplicate).unwrap(), &digest),
            Err(output_invalid())
        );
    }

    #[rstest]
    fn source_and_verifier_version_policies_are_closed() {
        assert!(valid_git_digest("0123456789abcdef0123456789abcdef01234567"));
        assert!(!valid_git_digest(
            "0123456789ABCDEF0123456789ABCDEF01234567"
        ));
        assert!(supported_gh_version(b"gh version 2.97.0 (2026-07-29)\n"));
        assert!(!supported_gh_version(b"gh version 2.96.9 (2026-07-01)\n"));
        assert!(!supported_gh_version(b"gh version 2.97\n"));
        assert!(!supported_gh_version(b"malformed\n"));
    }

    #[rstest]
    fn unavailable_bundle_never_creates_positive_evidence() {
        let evidence = verify_strategy_factory_formation(Path::new(
            "/definitely/not/a/deployment-attestation-bundle",
        ));
        assert!(!evidence.is_verified());
        assert!(
            evidence
                .rejection_error()
                .starts_with("native producer verification rejected: ")
        );
    }
}
