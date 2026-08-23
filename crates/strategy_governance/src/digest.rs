use std::fmt::{Debug, Display};

use sha2::{Digest as _, Sha256};

/// Stable SHA-256 identity used for semantic payloads and fact references.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Digest([u8; 32]);

impl Digest {
    /// Hashes length-delimited UTF-8 fields inside one object-specific domain.
    #[must_use]
    pub fn of_domain_fields(object_domain: &str, fields: &[&str]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(b"vibe-strategy-governance-v1\0");

        update_field(&mut hasher, object_domain);

        for field in fields {
            update_field(&mut hasher, field);
        }
        Self(hasher.finalize().into())
    }

    /// Hashes generic test or fixture fields in an explicit non-production domain.
    #[must_use]
    pub fn of_fields(fields: &[&str]) -> Self {
        Self::of_domain_fields("governance-generic-fields-v1", fields)
    }

    /// Parses a lowercase or uppercase 64-character hexadecimal digest.
    ///
    /// # Errors
    ///
    /// Returns an error when the input is not exactly 64 hexadecimal characters.
    pub fn from_hex(value: &str) -> Result<Self, &'static str> {
        if value.len() != 64 {
            return Err("digest must contain 64 hexadecimal characters");
        }
        let mut bytes = [0_u8; 32];

        for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
            let high = decode_hex(chunk[0])?;
            let low = decode_hex(chunk[1])?;
            bytes[index] = (high << 4) | low;
        }
        Ok(Self(bytes))
    }

    #[must_use]
    pub fn to_hex(self) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut result = String::with_capacity(64);

        for byte in self.0 {
            result.push(char::from(HEX[usize::from(byte >> 4)]));
            result.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
        result
    }
}

fn update_field(hasher: &mut Sha256, field: &str) {
    hasher.update(field.len().to_string().as_bytes());
    hasher.update(b":");
    hasher.update(field.as_bytes());
}

fn decode_hex(value: u8) -> Result<u8, &'static str> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err("digest contains a non-hexadecimal character"),
    }
}

impl Debug for Digest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.to_hex())
    }
}

impl Display for Digest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.to_hex())
    }
}
