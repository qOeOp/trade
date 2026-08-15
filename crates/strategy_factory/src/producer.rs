use std::path::PathBuf;

use serde::Serialize;

const AUTHORITY: &str = "github-artifact-attestation";
const REPOSITORY: &str = "qOeOp/trade";
const SIGNER_WORKFLOW: &str = "github.com/qOeOp/trade/.github/workflows/cli-binaries.yml";
const SOURCE_REF: &str = "refs/heads/main";
const PREDICATE_TYPE: &str = "https://slsa.dev/provenance/v1";
const OIDC_ISSUER: &str = "https://token.actions.githubusercontent.com";
const SUBJECT_NAME: &str = "strategy-factory-formation";

#[derive(Debug, Clone)]
pub struct NativeProducerVerificationRequest {
    bundle_path: PathBuf,
}

impl NativeProducerVerificationRequest {
    pub fn from_bundle(bundle_path: impl Into<PathBuf>) -> Self {
        Self {
            bundle_path: bundle_path.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub(crate) struct NativeProducerEvidence {
    record: NativeProducerRecord,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
enum NativeProducerRecord {
    #[cfg(any(target_os = "linux", test))]
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
        error_code: NativeProducerErrorCode,
    },
}

impl NativeProducerEvidence {
    pub(crate) const fn is_verified(&self) -> bool {
        #[cfg(any(target_os = "linux", test))]
        {
            matches!(&self.record, NativeProducerRecord::Verified { .. })
        }
        #[cfg(all(not(target_os = "linux"), not(test)))]
        {
            false
        }
    }

    pub(crate) fn rejection_error(&self) -> String {
        match &self.record {
            #[cfg(any(target_os = "linux", test))]
            NativeProducerRecord::Verified { .. } => {
                "native producer verification invariant violated: VERIFIED_EVIDENCE_REJECTED"
                    .to_string()
            }
            NativeProducerRecord::Rejected { error_code, .. } => format!(
                "native producer verification rejected: {}",
                error_code.as_str()
            ),
        }
    }

    fn rejected(error_code: NativeProducerErrorCode) -> Self {
        Self {
            record: NativeProducerRecord::Rejected {
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

    #[cfg(test)]
    pub(crate) fn verified_for_test() -> Self {
        Self {
            record: NativeProducerRecord::Verified {
                authority: AUTHORITY.to_string(),
                repository: REPOSITORY.to_string(),
                signer_workflow: SIGNER_WORKFLOW.to_string(),
                source_ref: SOURCE_REF.to_string(),
                signer_digest: "sha256:test-source".to_string(),
                predicate_type: PREDICATE_TYPE.to_string(),
                oidc_issuer: OIDC_ISSUER.to_string(),
                deny_self_hosted_runners: true,
                expected_source_digest: "sha256:test-source".to_string(),
                subject_name: SUBJECT_NAME.to_string(),
                subject_sha256: "sha256:test-subject".to_string(),
                subject_byte_length: 1,
                subject_blake3: "blake3:test-subject".to_string(),
                bundle_sha256: "sha256:test-bundle".to_string(),
                trusted_root_sha256: "sha256:test-root".to_string(),
                verifier_sha256: "sha256:test-verifier".to_string(),
                verifier_version_sha256: "sha256:test-version".to_string(),
                verification_output_sha256: "sha256:test-output".to_string(),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum NativeProducerErrorCode {
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

impl NativeProducerErrorCode {
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

#[cfg(not(target_os = "linux"))]
pub(crate) fn verify_native_producer(
    request: NativeProducerVerificationRequest,
) -> NativeProducerEvidence {
    drop(request.bundle_path);
    NativeProducerEvidence::rejected(NativeProducerErrorCode::UnsupportedPlatform)
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
        path::Path,
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
    const MIN_GH_VERSION: (u64, u64, u64) = (2, 97, 0);

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct FileIdentity {
        sha256: String,
        blake3: String,
        byte_length: u64,
    }

    pub(super) fn verify(request: NativeProducerVerificationRequest) -> NativeProducerEvidence {
        let Some(source_digest) = option_env!("STRATEGY_FACTORY_SOURCE_DIGEST") else {
            return NativeProducerEvidence::rejected(
                NativeProducerErrorCode::BuildSourceDigestUnavailable,
            );
        };

        if !valid_git_digest(source_digest) {
            return NativeProducerEvidence::rejected(
                NativeProducerErrorCode::BuildSourceDigestInvalid,
            );
        }

        let subject = match File::open(SUBJECT_PATH) {
            Ok(file) if regular_bounded(&file, MAX_SUBJECT_BYTES) => file,
            _ => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::SubjectUnavailable,
                );
            }
        };
        let bundle_source = match open_regular(&request.bundle_path, MAX_BUNDLE_BYTES) {
            Ok(file) => file,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::BundleUnavailable,
                );
            }
        };
        let bundle = match sealed_snapshot(&bundle_source, MAX_BUNDLE_BYTES) {
            Ok(file) => file,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::BundleSnapshotFailed,
                );
            }
        };
        let trusted_root = match open_regular(Path::new(TRUSTED_ROOT_PATH), MAX_TRUSTED_ROOT_BYTES)
        {
            Ok(file) => file,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::TrustAnchorUnavailable,
                );
            }
        };

        if !root_owned_read_only(&trusted_root) {
            return NativeProducerEvidence::rejected(NativeProducerErrorCode::UntrustedTrustAnchor);
        }

        if !trusted_directory_chain(&[
            Path::new("/"),
            Path::new("/etc"),
            Path::new("/etc/qoeop"),
            Path::new("/etc/qoeop/strategy-factory"),
        ]) {
            return NativeProducerEvidence::rejected(NativeProducerErrorCode::UntrustedTrustAnchor);
        }
        let verifier = match open_regular(Path::new(VERIFIER_PATH), MAX_VERIFIER_BYTES) {
            Ok(file) => file,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::VerifierUnavailable,
                );
            }
        };

        if !root_owned_read_only(&verifier) {
            return NativeProducerEvidence::rejected(NativeProducerErrorCode::UntrustedVerifier);
        }

        if !trusted_directory_chain(&[Path::new("/"), Path::new("/usr"), Path::new("/usr/bin")]) {
            return NativeProducerEvidence::rejected(NativeProducerErrorCode::UntrustedVerifier);
        }

        for file in [&subject, &bundle, &trusted_root, &verifier] {
            if clear_close_on_exec(file.as_raw_fd()).is_err() {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::VerifierExecutionFailed,
                );
            }
        }

        let subject_before = match hash_file(&subject) {
            Ok(identity) => identity,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::SubjectUnavailable,
                );
            }
        };
        let bundle_identity = match hash_file(&bundle) {
            Ok(identity) => identity,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::BundleUnavailable,
                );
            }
        };
        let trusted_root_identity = match hash_file(&trusted_root) {
            Ok(identity) => identity,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::TrustAnchorUnavailable,
                );
            }
        };
        let verifier_identity = match hash_file(&verifier) {
            Ok(identity) => identity,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::VerifierUnavailable,
                );
            }
        };

        let verifier_path = fd_path(verifier.as_raw_fd());
        let version_output = match clean_command(&verifier_path).arg("--version").output() {
            Ok(output) if output.status.success() && output.stderr.is_empty() => output.stdout,
            _ => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::VerifierVersionRejected,
                );
            }
        };

        if !supported_gh_version(&version_output) {
            return NativeProducerEvidence::rejected(
                NativeProducerErrorCode::VerifierVersionRejected,
            );
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
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::VerifierExecutionFailed,
                );
            }
        };

        if !output.status.success() {
            let code = if output.status.code().is_none() && output.status.signal().is_some() {
                NativeProducerErrorCode::VerifierExecutionFailed
            } else {
                NativeProducerErrorCode::VerificationRejected
            };
            return NativeProducerEvidence::rejected(code);
        }

        if !output.stderr.is_empty() {
            return NativeProducerEvidence::rejected(
                NativeProducerErrorCode::VerificationOutputInvalid,
            );
        }

        let subject_after = match hash_file(&subject) {
            Ok(identity) => identity,
            Err(()) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::SubjectChangedDuringVerification,
                );
            }
        };

        if subject_before != subject_after {
            return NativeProducerEvidence::rejected(
                NativeProducerErrorCode::SubjectChangedDuringVerification,
            );
        }

        if hash_file(&bundle).as_ref() != Ok(&bundle_identity) {
            return NativeProducerEvidence::rejected(
                NativeProducerErrorCode::BundleChangedDuringVerification,
            );
        }

        if hash_file(&trusted_root).as_ref() != Ok(&trusted_root_identity) {
            return NativeProducerEvidence::rejected(
                NativeProducerErrorCode::TrustAnchorChangedDuringVerification,
            );
        }

        if hash_file(&verifier).as_ref() != Ok(&verifier_identity) {
            return NativeProducerEvidence::rejected(
                NativeProducerErrorCode::VerifierChangedDuringVerification,
            );
        }
        let verification = match parse_verification_output(&output.stdout, &subject_before.sha256) {
            Ok(value) => value,
            Err(code) => return NativeProducerEvidence::rejected(code),
        };
        let canonical_output = match serde_json::to_vec(&verification) {
            Ok(bytes) => bytes,
            Err(_) => {
                return NativeProducerEvidence::rejected(
                    NativeProducerErrorCode::VerificationOutputInvalid,
                );
            }
        };

        NativeProducerEvidence {
            record: NativeProducerRecord::Verified {
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

    fn fd_path(fd: RawFd) -> String {
        format!("/proc/self/fd/{fd}")
    }

    fn verification_args(
        subject_fd: RawFd,
        bundle_fd: RawFd,
        trusted_root_fd: RawFd,
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

    fn sealed_snapshot(source: &File, max_bytes: u64) -> Result<File, ()> {
        let name = c"strategy-factory-attestation-bundle";
        // SAFETY: the name is a static NUL-terminated C string and the returned descriptor is
        // immediately owned by `File` on success.
        let raw_fd = unsafe {
            libc::memfd_create(name.as_ptr(), libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING)
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

        if regular_bounded(&file, max_bytes) {
            Ok(file)
        } else {
            Err(())
        }
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
        let mut buffer = [0u8; 64 * 1024];
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

    fn parse_verification_output(
        bytes: &[u8],
        expected_subject_sha256: &str,
    ) -> Result<serde_json::Value, NativeProducerErrorCode> {
        let value: serde_json::Value = serde_json::from_slice(bytes)
            .map_err(|_| NativeProducerErrorCode::VerificationOutputInvalid)?;
        let entries = value
            .as_array()
            .filter(|entries| entries.len() == 1)
            .ok_or(NativeProducerErrorCode::VerificationOutputInvalid)?;
        let result = entries[0]
            .get("verificationResult")
            .and_then(serde_json::Value::as_object)
            .ok_or(NativeProducerErrorCode::VerificationOutputInvalid)?;
        let statement = result
            .get("statement")
            .and_then(serde_json::Value::as_object)
            .ok_or(NativeProducerErrorCode::VerificationOutputInvalid)?;
        let subjects = statement
            .get("subject")
            .and_then(serde_json::Value::as_array)
            .filter(|subjects| subjects.len() == 1)
            .ok_or(NativeProducerErrorCode::VerificationOutputInvalid)?;
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
            return Err(NativeProducerErrorCode::VerificationPolicyMismatch);
        }
        Ok(value)
    }

    #[cfg(test)]
    mod tests {
        use rstest::rstest;

        use super::*;

        fn valid_output(subject_sha256: &str) -> Vec<u8> {
            serde_json::to_vec(&serde_json::json!([{
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
            }]))
            .unwrap()
        }

        #[rstest]
        fn parser_requires_one_exact_subject_and_policy() {
            let digest = "a".repeat(64);
            assert!(parse_verification_output(&valid_output(&digest), &digest).is_ok());

            let mut wrong_name: serde_json::Value =
                serde_json::from_slice(&valid_output(&digest)).unwrap();
            wrong_name[0]["verificationResult"]["statement"]["subject"][0]["name"] = "vibe".into();
            assert_eq!(
                parse_verification_output(&serde_json::to_vec(&wrong_name).unwrap(), &digest),
                Err(NativeProducerErrorCode::VerificationPolicyMismatch)
            );

            let duplicate = serde_json::json!([wrong_name[0].clone(), wrong_name[0].clone()]);
            assert_eq!(
                parse_verification_output(&serde_json::to_vec(&duplicate).unwrap(), &digest),
                Err(NativeProducerErrorCode::VerificationOutputInvalid)
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
            let identity = hash_file(&snapshot).unwrap();
            assert_eq!(identity.sha256, sha256(b"bundle-a"));
            assert!(snapshot.write_all(b"x").is_err());
        }

        #[rstest]
        fn verifier_arguments_bind_only_inherited_fds_and_exact_policy() {
            let source_digest = "0123456789abcdef0123456789abcdef01234567";
            assert_eq!(
                verification_args(7, 8, 9, source_digest),
                vec![
                    "attestation",
                    "verify",
                    "/proc/self/fd/7",
                    "--repo",
                    REPOSITORY,
                    "--signer-workflow",
                    SIGNER_WORKFLOW,
                    "--source-digest",
                    source_digest,
                    "--source-ref",
                    SOURCE_REF,
                    "--signer-digest",
                    source_digest,
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
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn verify_native_producer(
    request: NativeProducerVerificationRequest,
) -> NativeProducerEvidence {
    linux::verify(request)
}
