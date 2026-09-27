//! Reading an administrator's private files: an Ed25519 signing seed and a bounded input.
//!
//! The sealers that sign on the administrator's machine (the Replay Policy Catalog command sealer and
//! the deployment-store publication sealer) read their key and their authoring through here, so one
//! set of refusals covers both and runs as a test: the sealers are binaries built with `test = false`.

use std::{fs, path::Path};

use anyhow::Context;
use ed25519_dalek::SigningKey;

/// The largest signing-key file accepted: a 64-character seed and a line ending, with room to spare.
const MAX_SIGNING_KEY_FILE_BYTES: usize = 128;

/// Reads a regular file of at most `limit` bytes, naming it `label` in every refusal.
///
/// # Errors
///
/// Returns an error when the path is not a readable regular file or exceeds `limit` bytes.
pub fn read_bounded_file(path: &Path, limit: usize, label: &str) -> anyhow::Result<Vec<u8>> {
    let metadata = fs::metadata(path).with_context(|| format!("{label} file is unavailable"))?;

    if !metadata.is_file() {
        anyhow::bail!("{label} path must identify a regular file");
    }

    if metadata.len() > limit as u64 {
        anyhow::bail!("{label} file exceeds its byte bound");
    }
    let bytes = fs::read(path).with_context(|| format!("{label} file is unreadable"))?;

    if bytes.len() > limit {
        anyhow::bail!("{label} file exceeds its byte bound");
    }
    Ok(bytes)
}

/// Reads an Ed25519 signing key from a file holding its 32-byte seed as exactly 64 lowercase
/// hexadecimal characters, with at most one trailing line ending. Anything else is refused rather
/// than guessed at. The seed is never echoed.
///
/// # Errors
///
/// Returns an error when the file is unreadable, oversized, or not exactly such a seed.
pub fn read_ed25519_signing_key(path: &Path, label: &str) -> anyhow::Result<SigningKey> {
    let bytes = read_bounded_file(path, MAX_SIGNING_KEY_FILE_BYTES, label)?;
    Ok(SigningKey::from_bytes(&parse_seed_hex(&bytes, label)?))
}

fn parse_seed_hex(bytes: &[u8], label: &str) -> anyhow::Result<[u8; 32]> {
    let text = std::str::from_utf8(bytes).with_context(|| format!("{label} is not UTF-8"))?;
    let value = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text);

    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        anyhow::bail!("{label} must be exactly 64 lowercase hex characters");
    }
    let mut seed = [0_u8; 32];

    for (index, chunk) in value.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(chunk).with_context(|| format!("{label} is not UTF-8"))?;
        seed[index] =
            u8::from_str_radix(pair, 16).with_context(|| format!("{label} is not hex"))?;
    }
    Ok(seed)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn a_signing_key_file_is_exactly_a_lowercase_hex_seed() {
        let seed_hex = "1d".repeat(32);
        assert_eq!(
            parse_seed_hex(seed_hex.as_bytes(), "key").unwrap(),
            [0x1d; 32]
        );
        assert_eq!(
            parse_seed_hex(format!("{seed_hex}\n").as_bytes(), "key").unwrap(),
            [0x1d; 32]
        );
        assert_eq!(
            parse_seed_hex(format!("{seed_hex}\r\n").as_bytes(), "key").unwrap(),
            [0x1d; 32]
        );

        for refused in [
            seed_hex.to_uppercase(),
            format!(" {seed_hex}"),
            seed_hex[..62].to_string(),
            format!("{seed_hex}\n\n"),
        ] {
            assert!(
                parse_seed_hex(refused.as_bytes(), "key").is_err(),
                "{refused:?}"
            );
        }
    }

    /// Both sealers write their output only to a path that does not exist yet, and neither turns the
    /// key back into bytes it could print or write.
    #[rstest]
    fn the_sealers_refuse_to_overwrite_and_never_serialize_the_seed() {
        for source in [
            include_str!("bin/replay_policy_catalog_command_seal.rs"),
            include_str!("bin/deployment_store_publication_seal.rs"),
        ] {
            assert!(source.contains(".create_new(true)"));
            assert!(!source.contains(&["to_", "bytes()"].concat()));
        }
    }
}
