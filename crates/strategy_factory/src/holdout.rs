//! Integrity-only access to the frozen representative holdout source bundle.
//!
//! This module streams bytes to verify exact custody. It never decodes observations, constructs
//! Data, invokes a strategy, or grants Qualification authority.

use std::{collections::BTreeMap, io::Write, path::Path};

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use vibe_core::paths::custody::{
    open_custodied_directory, read_bounded_regular_at, read_optional_bounded_regular_at,
};

const REQUEST_BYTES: &[u8] = include_bytes!("../assets/representative_holdout_2024_request_v1.jcs");
const SOURCE_BYTES: &[u8] = include_bytes!("../assets/representative_holdout_2024_sources_v1.jcs");
const PRICE_MANIFEST_BYTES: &[u8] =
    include_bytes!("../assets/representative_binance_usdm_2024_v1.jcs");
const CONTEXT_MANIFEST_BYTES: &[u8] =
    include_bytes!("../assets/representative_binance_paxg_spot_2024_v1.jcs");
const SESSION_IMPLEMENTATION_BYTES: &[u8] = include_bytes!("../../trading/src/sessions.rs");

const REQUEST_SHA256: &str = "7e2f81bbc8ae85cabcef6648fe85eed10a3b48dd141a54bf2206c81b2a6ec14b";
const SOURCE_SHA256: &str = "24f8aa5214751b262fb22e8c561936e7d76bcb8ca8fb7edadaa9e93a8a483ee5";
const PRICE_MANIFEST_SHA256: &str =
    "ef5510193e2b3f3f142b0b7ff3163c6055d528f3cd3fec9e99d8cda243f34779";
const CONTEXT_MANIFEST_SHA256: &str =
    "8f70884ce0d1a5701dd9ed7b188b4f5e0f8dc5d74244d532d8d57d47513f53ab";
const SESSION_IMPLEMENTATION_SHA256: &str =
    "e7ce18359fd435680777f89131599552e275a1d839e0a2e1bea23739fba3515d";
const MAX_MARKET_ARCHIVE: u64 = 64 * 1024 * 1024;
const MAX_SIDECAR: u64 = 1_024;
const MAX_MACRO_ARCHIVE: u64 = 20 * 1024 * 1024;
const MAX_SCHEDULE_HTML: u64 = 4 * 1024 * 1024;
const RAW_OBJECT_COUNT: usize = 224;
const PREDECESSOR_CANDIDATE_SHA256: &str =
    "sha256:12c5ac04a2d904b995961502cd51c89691bcd6f5e526030c6600536119155519";
const PREDECESSOR_INTENT_SHA256: &str =
    "sha256:7f51afa6736fab11266e6e95386c477a526c47233caf6f9638c8840295261961";
const HOLDOUT_PARTITION: &str = "2024-01-01T00:00:00Z/2025-01-01T00:00:00Z";
const STATUS_KIND: &str = "strategy-factory-representative-holdout-custody-status";
const RESERVATION_FILE: &str = "reservation.jcs";
const CLAIM_FILE: &str = "claim.jcs";
const TERMINAL_FILE: &str = "qualification-receipt.jcs";
const RESERVATION_KIND: &str = "strategy-factory-qualification-reservation";
const CONTROL_LIMIT: u64 = 16 * 1024;
const INTEGRITY_ACCESS: &str =
    "BYTES_STREAMED_FOR_DIGEST_AND_ARCHIVE_TOPOLOGY_ONLY_NO_OUTCOME_PROJECTION";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RepresentativeHoldoutPhase {
    ReservedNotAttempted,
}

/// Read-only projection recovered from the exact durable custody records.
///
/// It is not a Qualification capability and contains no outcome, order, return, or metric.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RepresentativeHoldoutStatus {
    kind: &'static str,
    schema_version: u32,
    phase: RepresentativeHoldoutPhase,
    integrity_access: &'static str,
    outcome_access: &'static str,
    qualification_attempt: &'static str,
    request_sha256: String,
    source_manifest_sha256: String,
    raw_tree_sha256: String,
    reservation_sha256: String,
}

impl RepresentativeHoldoutStatus {
    pub fn phase(&self) -> RepresentativeHoldoutPhase {
        self.phase
    }

    pub fn reservation_sha256(&self) -> &str {
        &self.reservation_sha256
    }

    pub fn raw_tree_sha256(&self) -> &str {
        &self.raw_tree_sha256
    }

    pub fn write_to(&self, mut writer: impl Write) -> anyhow::Result<()> {
        serde_json::to_writer(&mut writer, self)?;
        writer.write_all(b"\n")?;
        Ok(())
    }
}

/// Content identity produced without projecting any holdout outcome.
///
/// Callers cannot construct or deserialize this capability.
///
/// ```compile_fail
/// use vibe_strategy_factory::RepresentativeHoldoutIntegrity;
/// let _: RepresentativeHoldoutIntegrity = serde_json::from_slice(b"{}").unwrap();
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepresentativeHoldoutIntegrity {
    raw_tree_sha256: String,
}

#[derive(Debug, Clone, Copy)]
struct HoldoutReservationBinding<'a> {
    request_sha256: &'a str,
    source_manifest_sha256: &'a str,
    raw_tree_sha256: &'a str,
    partition: &'a str,
    predecessor_candidate_sha256: &'a str,
    predecessor_intent_sha256: &'a str,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct ReservationDocument<'a> {
    integrity_access: &'static str,
    kind: &'static str,
    outcome_access: &'static str,
    partition: &'a str,
    predecessor_candidate_sha256: &'a str,
    predecessor_intent_sha256: &'a str,
    qualification_attempt: &'static str,
    raw_tree_sha256: &'a str,
    request_sha256: &'a str,
    schema_version: u32,
    source_manifest_sha256: &'a str,
}

impl RepresentativeHoldoutIntegrity {
    pub fn request_sha256(&self) -> &'static str {
        REQUEST_SHA256
    }

    pub fn source_manifest_sha256(&self) -> &'static str {
        SOURCE_SHA256
    }

    pub fn raw_tree_sha256(&self) -> &str {
        &self.raw_tree_sha256
    }
}

/// Verifies the exact frozen 2024 source bundle without decoding any outcome.
///
/// `root` owns the fixed `raw/binance-usdm`, `raw/binance-paxg`, `raw/alfred`, and
/// `raw/schedule` layout. Only objects declared by the frozen manifests are opened.
///
/// # Errors
/// Rejects source-policy drift, unsafe custody, missing/tampered objects, sidecar mismatch, or an
/// implementation change to the bound session projection.
pub fn verify_representative_holdout_sources(
    root: &Path,
) -> anyhow::Result<RepresentativeHoldoutIntegrity> {
    let request = canonical_asset(REQUEST_BYTES, REQUEST_SHA256, "holdout request")?;
    let sources = canonical_asset(SOURCE_BYTES, SOURCE_SHA256, "holdout source manifest")?;
    let expected_request_digest = format!("sha256:{REQUEST_SHA256}");
    let expected_price_manifest_digest = format!("sha256:{PRICE_MANIFEST_SHA256}");
    let expected_context_manifest_digest = format!("sha256:{CONTEXT_MANIFEST_SHA256}");
    let expected_session_digest = format!("sha256:{SESSION_IMPLEMENTATION_SHA256}");
    anyhow::ensure!(
        request
            .pointer("/payload/admission/outcome_access")
            .and_then(Value::as_str)
            == Some("SEALED_NOT_READ")
            && request
                .pointer("/payload/admission/qualification_attempt")
                .and_then(Value::as_str)
                == Some("NOT_ATTEMPTED")
            && sources
                .pointer("/payload/capture/request_sha256")
                .and_then(Value::as_str)
                == Some(expected_request_digest.as_str()),
        "holdout request/source admission binding drift"
    );
    anyhow::ensure!(
        sources
            .pointer("/payload/market/price_manifest/sha256")
            .and_then(Value::as_str)
            == Some(expected_price_manifest_digest.as_str())
            && sources
                .pointer("/payload/market/context_manifest/sha256")
                .and_then(Value::as_str)
                == Some(expected_context_manifest_digest.as_str()),
        "holdout market manifest binding drift"
    );
    anyhow::ensure!(
        sha256(SESSION_IMPLEMENTATION_BYTES) == SESSION_IMPLEMENTATION_SHA256
            && sources
                .pointer("/payload/session/implementation_sha256")
                .and_then(Value::as_str)
                == Some(expected_session_digest.as_str()),
        "session projection implementation drift"
    );

    let mut objects = BTreeMap::new();
    scan_market(
        &root.join("raw/binance-usdm"),
        PRICE_MANIFEST_BYTES,
        PRICE_MANIFEST_SHA256,
        "market/price",
        96,
        &mut objects,
    )?;
    scan_market(
        &root.join("raw/binance-paxg"),
        CONTEXT_MANIFEST_BYTES,
        CONTEXT_MANIFEST_SHA256,
        "market/context",
        12,
        &mut objects,
    )?;
    scan_declared(
        &root.join("raw/alfred"),
        array(&sources, "/payload/macro/objects")?,
        "macro",
        MAX_MACRO_ARCHIVE,
        &mut objects,
    )?;
    scan_declared(
        &root.join("raw/schedule"),
        array(&sources, "/payload/schedule/sources")?,
        "schedule",
        MAX_SCHEDULE_HTML,
        &mut objects,
    )?;
    anyhow::ensure!(
        objects.len() == RAW_OBJECT_COUNT,
        "holdout raw object topology drift"
    );
    let mut tree = serde_json::to_vec(&objects)?;
    tree.push(b'\n');
    Ok(RepresentativeHoldoutIntegrity {
        raw_tree_sha256: sha256(&tree),
    })
}

fn recover_reservation(
    root: &Path,
    binding: &HoldoutReservationBinding<'_>,
) -> anyhow::Result<String> {
    for digest in [
        binding.request_sha256,
        binding.source_manifest_sha256,
        binding.raw_tree_sha256,
        binding.predecessor_candidate_sha256,
        binding.predecessor_intent_sha256,
    ] {
        anyhow::ensure!(
            digest
                .strip_prefix("sha256:")
                .is_some_and(|hex| hex.len() == 64
                    && hex
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))),
            "holdout reservation digest is not exact SHA-256"
        );
    }
    anyhow::ensure!(
        !binding.partition.is_empty()
            && binding.partition.len() <= 256
            && binding.partition.trim() == binding.partition
            && !binding.partition.chars().any(char::is_control),
        "holdout reservation partition is not bounded text"
    );

    let root = open_custodied_directory(root)?;
    anyhow::ensure!(
        read_optional_bounded_regular_at(&root, Path::new(CLAIM_FILE), CONTROL_LIMIT)?.is_none()
            && read_optional_bounded_regular_at(&root, Path::new(TERMINAL_FILE), CONTROL_LIMIT)?
                .is_none(),
        "holdout custody has advanced beyond reservation-only state"
    );
    let bytes = read_bounded_regular_at(&root, Path::new(RESERVATION_FILE), CONTROL_LIMIT)
        .context("required holdout reservation is missing")?;
    let mut expected = serde_json::to_vec(&ReservationDocument {
        integrity_access: INTEGRITY_ACCESS,
        kind: RESERVATION_KIND,
        outcome_access: "SEALED_NOT_READ",
        partition: binding.partition,
        predecessor_candidate_sha256: binding.predecessor_candidate_sha256,
        predecessor_intent_sha256: binding.predecessor_intent_sha256,
        qualification_attempt: "NOT_ATTEMPTED",
        raw_tree_sha256: binding.raw_tree_sha256,
        request_sha256: binding.request_sha256,
        schema_version: 1,
        source_manifest_sha256: binding.source_manifest_sha256,
    })?;
    expected.push(b'\n');
    anyhow::ensure!(bytes == expected, "holdout reservation binding conflicts");
    Ok(format!("sha256:{}", sha256(&bytes)))
}

/// Re-verifies source integrity and exactly recovers the same durable reservation state.
pub fn recover_representative_2024_holdout_status(
    source_root: &Path,
    custody_root: &Path,
) -> anyhow::Result<RepresentativeHoldoutStatus> {
    let integrity = verify_representative_holdout_sources(source_root)?;
    let request_sha256 = format!("sha256:{}", integrity.request_sha256());
    let source_manifest_sha256 = format!("sha256:{}", integrity.source_manifest_sha256());
    let raw_tree_sha256 = format!("sha256:{}", integrity.raw_tree_sha256());
    let reservation_sha256 = recover_reservation(
        custody_root,
        &HoldoutReservationBinding {
            request_sha256: &request_sha256,
            source_manifest_sha256: &source_manifest_sha256,
            raw_tree_sha256: &raw_tree_sha256,
            partition: HOLDOUT_PARTITION,
            predecessor_candidate_sha256: PREDECESSOR_CANDIDATE_SHA256,
            predecessor_intent_sha256: PREDECESSOR_INTENT_SHA256,
        },
    )?;
    status(&integrity, reservation_sha256)
}

fn status(
    integrity: &RepresentativeHoldoutIntegrity,
    reservation_sha256: String,
) -> anyhow::Result<RepresentativeHoldoutStatus> {
    let raw_tree_sha256 = format!("sha256:{}", integrity.raw_tree_sha256());
    anyhow::ensure!(
        reservation_sha256.starts_with("sha256:"),
        "qualification custody status digest algorithm mismatch"
    );
    Ok(RepresentativeHoldoutStatus {
        kind: STATUS_KIND,
        schema_version: 1,
        phase: RepresentativeHoldoutPhase::ReservedNotAttempted,
        integrity_access: "BYTES_STREAMED_FOR_DIGEST_AND_ARCHIVE_TOPOLOGY_ONLY_NO_OUTCOME_PROJECTION",
        outcome_access: "SEALED_NOT_READ",
        qualification_attempt: "NOT_ATTEMPTED",
        request_sha256: format!("sha256:{REQUEST_SHA256}"),
        source_manifest_sha256: format!("sha256:{SOURCE_SHA256}"),
        raw_tree_sha256,
        reservation_sha256,
    })
}

fn scan_market(
    root: &Path,
    bytes: &[u8],
    expected_digest: &str,
    namespace: &str,
    expected_count: usize,
    objects: &mut BTreeMap<String, String>,
) -> anyhow::Result<()> {
    let manifest = canonical_asset(bytes, expected_digest, "market manifest")?;
    let declarations = array(&manifest, "/objects")?;
    anyhow::ensure!(
        declarations.len() == expected_count,
        "market manifest object count drift"
    );
    let custody = open_custodied_directory(root)?;

    for object in declarations {
        let name = string(object, "name")?;
        let expected_archive = string(object, "sha256")?;
        let expected_sidecar = string(object, "sidecar_sha256")?;
        let archive = read_bounded_regular_at(&custody, Path::new(name), MAX_MARKET_ARCHIVE)?;
        let sidecar_name = format!("{name}.CHECKSUM");
        let sidecar = read_bounded_regular_at(&custody, Path::new(&sidecar_name), MAX_SIDECAR)?;
        anyhow::ensure!(
            sha256(&archive) == expected_archive,
            "market archive digest mismatch"
        );
        anyhow::ensure!(
            sha256(&sidecar) == expected_sidecar,
            "market sidecar digest mismatch"
        );
        verify_sidecar(name, expected_archive, &sidecar)?;
        insert(objects, format!("{namespace}/{name}"), expected_archive)?;
        insert(
            objects,
            format!("{namespace}/{sidecar_name}"),
            expected_sidecar,
        )?;
    }
    Ok(())
}

fn scan_declared(
    root: &Path,
    declarations: &[Value],
    namespace: &str,
    limit: u64,
    objects: &mut BTreeMap<String, String>,
) -> anyhow::Result<()> {
    let custody = open_custodied_directory(root)?;

    for declaration in declarations {
        let name = string(declaration, "name")?;
        let expected =
            string(declaration, "sha256").or_else(|_| string(declaration, "raw_sha256"))?;
        let bytes = read_bounded_regular_at(&custody, Path::new(name), limit)?;
        anyhow::ensure!(
            sha256(&bytes) == expected,
            "declared source digest mismatch"
        );
        insert(objects, format!("{namespace}/{name}"), expected)?;
    }
    Ok(())
}

fn verify_sidecar(name: &str, expected: &str, bytes: &[u8]) -> anyhow::Result<()> {
    let text = std::str::from_utf8(bytes)?.trim();
    let mut fields = text.split_whitespace();
    let digest = fields.next().context("sidecar digest missing")?;
    let leaf = fields
        .next()
        .context("sidecar archive name missing")?
        .trim_start_matches('*');
    anyhow::ensure!(fields.next().is_none(), "sidecar has trailing fields");
    anyhow::ensure!(
        digest == expected
            && Path::new(name).file_name().and_then(|value| value.to_str()) == Some(leaf),
        "sidecar payload mismatch"
    );
    Ok(())
}

fn canonical_asset(bytes: &[u8], expected: &str, label: &str) -> anyhow::Result<Value> {
    anyhow::ensure!(sha256(bytes) == expected, "{label} digest drift");
    let value: Value = serde_json::from_slice(bytes)?;
    let mut canonical = serde_json::to_vec(&value)?;
    canonical.push(b'\n');
    anyhow::ensure!(canonical == bytes, "{label} is not canonical JSON+LF");
    Ok(value)
}

fn array<'a>(value: &'a Value, pointer: &str) -> anyhow::Result<&'a [Value]> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .with_context(|| format!("missing array {pointer}"))
}

fn string<'a>(value: &'a Value, field: &str) -> anyhow::Result<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .with_context(|| format!("missing string {field}"))
}

fn insert(
    objects: &mut BTreeMap<String, String>,
    name: String,
    digest: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        objects.insert(name, digest.to_string()).is_none(),
        "holdout source identity collision"
    );
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn reservation_binding() -> HoldoutReservationBinding<'static> {
        HoldoutReservationBinding {
            request_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            source_manifest_sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            raw_tree_sha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            partition: HOLDOUT_PARTITION,
            predecessor_candidate_sha256: PREDECESSOR_CANDIDATE_SHA256,
            predecessor_intent_sha256: PREDECESSOR_INTENT_SHA256,
        }
    }

    #[rstest]
    fn frozen_assets_are_canonical_and_bound() {
        canonical_asset(REQUEST_BYTES, REQUEST_SHA256, "holdout request").unwrap();
        canonical_asset(SOURCE_BYTES, SOURCE_SHA256, "holdout source manifest").unwrap();
        canonical_asset(
            PRICE_MANIFEST_BYTES,
            PRICE_MANIFEST_SHA256,
            "price manifest",
        )
        .unwrap();
        canonical_asset(
            CONTEXT_MANIFEST_BYTES,
            CONTEXT_MANIFEST_SHA256,
            "context manifest",
        )
        .unwrap();
        assert_eq!(
            sha256(SESSION_IMPLEMENTATION_BYTES),
            SESSION_IMPLEMENTATION_SHA256
        );
    }

    #[rstest]
    fn sidecar_parser_fails_closed() {
        verify_sidecar("BTCUSDT.zip", "abc", b"abc *BTCUSDT.zip\n").unwrap();
        assert!(verify_sidecar("BTCUSDT.zip", "abc", b"abc *OTHER.zip\n").is_err());
        assert!(verify_sidecar("BTCUSDT.zip", "abc", b"abc *BTCUSDT.zip trailing\n").is_err());
        assert!(verify_sidecar("BTCUSDT.zip", "abc", b"not utf8 \xff").is_err());
    }

    #[rstest]
    fn reservation_recovery_is_exact_and_remains_read_only() {
        let directory = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(directory.path()).unwrap();
        let binding = reservation_binding();
        let mut bytes = serde_json::to_vec(&ReservationDocument {
            integrity_access: INTEGRITY_ACCESS,
            kind: RESERVATION_KIND,
            outcome_access: "SEALED_NOT_READ",
            partition: binding.partition,
            predecessor_candidate_sha256: binding.predecessor_candidate_sha256,
            predecessor_intent_sha256: binding.predecessor_intent_sha256,
            qualification_attempt: "NOT_ATTEMPTED",
            raw_tree_sha256: binding.raw_tree_sha256,
            request_sha256: binding.request_sha256,
            schema_version: 1,
            source_manifest_sha256: binding.source_manifest_sha256,
        })
        .unwrap();
        bytes.push(b'\n');
        std::fs::write(directory.path().join(RESERVATION_FILE), &bytes).unwrap();

        assert_eq!(
            recover_reservation(&root, &binding).unwrap(),
            format!("sha256:{}", sha256(&bytes))
        );
        let mut changed = binding;
        changed.partition = "2025";
        assert!(recover_reservation(&root, &changed).is_err());
        std::fs::write(directory.path().join(CLAIM_FILE), b"{}\n").unwrap();
        assert!(recover_reservation(&root, &binding).is_err());
    }

    #[rstest]
    #[ignore = "requires the separately custodied official 2024 source bundle"]
    fn official_holdout_integrity_probe_is_deterministic() {
        let root = std::env::var_os("VIBE_REPRESENTATIVE_HOLDOUT_2024_ROOT")
            .expect("VIBE_REPRESENTATIVE_HOLDOUT_2024_ROOT must name the custody root");
        let first = verify_representative_holdout_sources(Path::new(&root)).unwrap();
        let second = verify_representative_holdout_sources(Path::new(&root)).unwrap();
        assert_eq!(first, second);
        let custody = std::env::var_os("VIBE_REPRESENTATIVE_HOLDOUT_2024_CUSTODY_ROOT")
            .expect("VIBE_REPRESENTATIVE_HOLDOUT_2024_CUSTODY_ROOT must name reservation custody");
        let recovered =
            recover_representative_2024_holdout_status(Path::new(&root), Path::new(&custody))
                .unwrap();
        assert_eq!(
            recovered.phase(),
            RepresentativeHoldoutPhase::ReservedNotAttempted
        );
        assert_eq!(std::fs::read_dir(&custody).unwrap().count(), 1);
    }
}
