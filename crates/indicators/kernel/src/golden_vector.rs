//! Canonical BFGV representation. Decoding and content identity do not prove execution correctness.

use sha2::{Digest as _, Sha256};

use crate::RoundingMode;

const HEADER: &[u8; 8] = b"BFGV\x01\0\0\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GoldenVectorCodecFailure {
    InvalidLength,
    InvalidHeader,
    InvalidIdentifier,
    InvalidRounding,
    InvalidTerminal,
    LengthOverflow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GoldenVectorTerminalV1 {
    Ready,
    Warming,
    NumericFailureNoStateChange,
    Unsupported,
}

impl GoldenVectorTerminalV1 {
    const fn tag(self) -> u8 {
        match self {
            Self::Ready => 0,
            Self::Warming => 1,
            Self::NumericFailureNoStateChange => 2,
            Self::Unsupported => 3,
        }
    }

    fn decode(tag: u8) -> Result<Self, GoldenVectorCodecFailure> {
        match tag {
            0 => Ok(Self::Ready),
            1 => Ok(Self::Warming),
            2 => Ok(Self::NumericFailureNoStateChange),
            3 => Ok(Self::Unsupported),
            _ => Err(GoldenVectorCodecFailure::InvalidTerminal),
        }
    }
}

/// Untrusted vector fields. Only representation rules are checked by this codec.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GoldenVectorPartsV1<'a> {
    pub vector_id: &'a str,
    pub primitive_id: &'a str,
    pub rounding: Option<RoundingMode>,
    pub terminal: GoldenVectorTerminalV1,
    pub pre_state: &'a [u8],
    pub input: &'a [u8],
    pub expected_output: &'a [u8],
    pub post_state: &'a [u8],
}

impl GoldenVectorPartsV1<'_> {
    pub fn encoded_len(&self) -> Result<usize, GoldenVectorCodecFailure> {
        let mut length = HEADER.len() + 2;

        for id in [self.vector_id, self.primitive_id] {
            validate_id(id)?;
            length = length
                .checked_add(2 + id.len())
                .ok_or(GoldenVectorCodecFailure::LengthOverflow)?;
        }

        for field in [
            self.pre_state,
            self.input,
            self.expected_output,
            self.post_state,
        ] {
            u32::try_from(field.len()).map_err(|_| GoldenVectorCodecFailure::LengthOverflow)?;
            length = length
                .checked_add(4)
                .and_then(|n| n.checked_add(field.len()))
                .ok_or(GoldenVectorCodecFailure::LengthOverflow)?;
        }

        Ok(length)
    }

    /// An invalid identifier, length or buffer size leaves the supplied buffer unchanged.
    pub fn encode_into(&self, bytes: &mut [u8]) -> Result<(), GoldenVectorCodecFailure> {
        if bytes.len() != self.encoded_len()? {
            return Err(GoldenVectorCodecFailure::InvalidLength);
        }

        let mut offset = 0;
        put(bytes, &mut offset, HEADER);

        for id in [self.vector_id, self.primitive_id] {
            put(bytes, &mut offset, &(id.len() as u16).to_le_bytes());
            put(bytes, &mut offset, id.as_bytes());
        }

        put(
            bytes,
            &mut offset,
            &RoundingMode::optional_to_canonical_bytes(self.rounding),
        );
        put(bytes, &mut offset, &[self.terminal.tag()]);

        for field in [
            self.pre_state,
            self.input,
            self.expected_output,
            self.post_state,
        ] {
            put(bytes, &mut offset, &(field.len() as u32).to_le_bytes());
            put(bytes, &mut offset, field);
        }

        Ok(())
    }
}

/// A structurally decoded vector retaining its exact canonical bytes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BoundedFeatureGoldenVectorV1<'a> {
    bytes: &'a [u8],
    parts: GoldenVectorPartsV1<'a>,
}

impl<'a> BoundedFeatureGoldenVectorV1<'a> {
    pub fn decode(bytes: &'a [u8]) -> Result<Self, GoldenVectorCodecFailure> {
        let mut decoder = Decoder { bytes, offset: 0 };

        if decoder.take(HEADER.len())? != HEADER {
            return Err(GoldenVectorCodecFailure::InvalidHeader);
        }

        let vector_id = decoder.id()?;
        let primitive_id = decoder.id()?;
        let rounding = RoundingMode::optional_from_canonical_bytes(decoder.take(1)?)
            .map_err(|_| GoldenVectorCodecFailure::InvalidRounding)?;
        let terminal = GoldenVectorTerminalV1::decode(decoder.take(1)?[0])?;
        let parts = GoldenVectorPartsV1 {
            vector_id,
            primitive_id,
            rounding,
            terminal,
            pre_state: decoder.field()?,
            input: decoder.field()?,
            expected_output: decoder.field()?,
            post_state: decoder.field()?,
        };

        if decoder.offset != bytes.len() {
            return Err(GoldenVectorCodecFailure::InvalidLength);
        }

        Ok(Self { bytes, parts })
    }

    #[must_use]
    pub const fn parts(self) -> GoldenVectorPartsV1<'a> {
        self.parts
    }

    #[must_use]
    pub const fn canonical_bytes(self) -> &'a [u8] {
        self.bytes
    }

    /// Individual content identity only; this is neither catalog admission nor a passing oracle.
    #[must_use]
    pub fn identity(self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"bfp.golden-vector.v1\0");
        hasher.update(self.bytes);
        hasher.finalize().into()
    }
}

fn validate_id(id: &str) -> Result<(), GoldenVectorCodecFailure> {
    if id.is_empty() || !id.is_ascii() || u16::try_from(id.len()).is_err() {
        Err(GoldenVectorCodecFailure::InvalidIdentifier)
    } else {
        Ok(())
    }
}

fn put(bytes: &mut [u8], offset: &mut usize, value: &[u8]) {
    let end = *offset + value.len();
    bytes[*offset..end].copy_from_slice(value);
    *offset = end;
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Decoder<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], GoldenVectorCodecFailure> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or(GoldenVectorCodecFailure::LengthOverflow)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(GoldenVectorCodecFailure::InvalidLength)?;
        self.offset = end;
        Ok(value)
    }

    fn id(&mut self) -> Result<&'a str, GoldenVectorCodecFailure> {
        let length = self.take(2)?;
        let length = usize::from(u16::from_le_bytes([length[0], length[1]]));
        let id = core::str::from_utf8(self.take(length)?)
            .map_err(|_| GoldenVectorCodecFailure::InvalidIdentifier)?;
        validate_id(id)?;
        Ok(id)
    }

    fn field(&mut self) -> Result<&'a [u8], GoldenVectorCodecFailure> {
        let length = self.take(4)?;
        let length = u32::from_le_bytes([length[0], length[1], length[2], length[3]]);
        let length =
            usize::try_from(length).map_err(|_| GoldenVectorCodecFailure::LengthOverflow)?;
        self.take(length)
    }
}

#[cfg(test)]
mod tests {
    extern crate std;
    use super::*;
    use std::vec;

    const WIRE: [u8; 35] = [
        66, 70, 71, 86, 1, 0, 0, 0, 1, 0, 103, 1, 0, 112, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 2, 1, 0,
        0, 0, 3, 0, 0, 0, 0,
    ];

    fn parts() -> GoldenVectorPartsV1<'static> {
        GoldenVectorPartsV1 {
            vector_id: "g",
            primitive_id: "p",
            rounding: None,
            terminal: GoldenVectorTerminalV1::Ready,
            pre_state: &[],
            input: &[1, 2],
            expected_output: &[3],
            post_state: &[],
        }
    }

    #[rstest::rstest]
    fn independent_wire_and_sha256_oracle() {
        let mut bytes = [0; 35];
        parts().encode_into(&mut bytes).unwrap();
        assert_eq!(bytes, WIRE);
        let decoded = BoundedFeatureGoldenVectorV1::decode(&bytes).unwrap();
        assert_eq!(decoded.parts(), parts());
        assert_eq!(decoded.canonical_bytes(), WIRE);
        assert_eq!(
            decoded.identity(),
            [
                196, 168, 224, 134, 177, 94, 90, 187, 126, 227, 103, 3, 65, 205, 40, 161, 104, 34,
                31, 159, 90, 63, 65, 143, 19, 125, 25, 96, 179, 27, 80, 166
            ]
        );
    }

    #[rstest::rstest]
    fn all_rounding_and_terminal_tags_roundtrip() {
        for rounding in [
            None,
            Some(RoundingMode::TowardZero),
            Some(RoundingMode::NearestTiesToEven),
        ] {
            for terminal in [
                GoldenVectorTerminalV1::Ready,
                GoldenVectorTerminalV1::Warming,
                GoldenVectorTerminalV1::NumericFailureNoStateChange,
                GoldenVectorTerminalV1::Unsupported,
            ] {
                let value = GoldenVectorPartsV1 {
                    rounding,
                    terminal,
                    ..parts()
                };
                let mut bytes = [0; 35];
                value.encode_into(&mut bytes).unwrap();
                assert_eq!(
                    BoundedFeatureGoldenVectorV1::decode(&bytes)
                        .unwrap()
                        .parts(),
                    value
                );
            }
        }
    }

    #[rstest::rstest]
    fn malformed_and_truncated_vectors_are_rejected() {
        for end in 0..WIRE.len() {
            assert!(BoundedFeatureGoldenVectorV1::decode(&WIRE[..end]).is_err());
        }

        for (index, value) in [(0, 0), (4, 2), (6, 1), (10, 255), (14, 255), (15, 4)] {
            let mut bytes = WIRE;
            bytes[index] = value;
            assert!(BoundedFeatureGoldenVectorV1::decode(&bytes).is_err());
        }

        for start in [16, 20, 26, 31] {
            let mut bytes = WIRE;
            bytes[start..start + 4].copy_from_slice(&u32::MAX.to_le_bytes());
            assert!(BoundedFeatureGoldenVectorV1::decode(&bytes).is_err());
        }
        let mut trailing = WIRE.to_vec();
        trailing.push(0);
        assert!(BoundedFeatureGoldenVectorV1::decode(&trailing).is_err());
    }

    #[rstest::rstest]
    fn invalid_encoding_leaves_destination_unchanged() {
        let long = "a".repeat(usize::from(u16::MAX) + 1);
        for id in ["", "\u{975e}ASCII", long.as_str()] {
            let value = GoldenVectorPartsV1 {
                vector_id: id,
                ..parts()
            };
            let mut bytes = [0xa5; 35];
            assert!(value.encode_into(&mut bytes).is_err());
            assert_eq!(bytes, [0xa5; 35]);
        }

        for size in [0, 34, 36] {
            let mut bytes = vec![0xa5; size];
            assert!(parts().encode_into(&mut bytes).is_err());
            assert!(bytes.iter().all(|byte| *byte == 0xa5));
        }
    }
}
