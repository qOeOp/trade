//! Wire-format adapters for the on-disk event store envelope.
//!
//! `UnixNanos` deserializes through `deserialize_any`, which the non-self-describing positional
//! codec rejects. The on-disk envelope therefore serializes timestamp fields as raw `u64` and
//! reconstructs the strong type on read.

/// Serializes [`vibe_core::UnixNanos`] as a raw `u64` so the positional codec can round-trip it.
pub(crate) mod nanos_as_u64 {
    use serde::{Deserialize, Deserializer, Serializer};
    use vibe_core::UnixNanos;

    /// Writes the inner `u64` directly.
    ///
    /// # Errors
    ///
    /// Propagates any error from the underlying serializer.
    #[expect(
        clippy::trivially_copy_pass_by_ref,
        reason = "serde with contract requires a borrowed value"
    )]
    pub(crate) fn serialize<S: Serializer>(
        value: &UnixNanos,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_u64(value.as_u64())
    }

    /// Reads a `u64` and constructs a [`UnixNanos`].
    ///
    /// # Errors
    ///
    /// Propagates any error from the underlying deserializer.
    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<UnixNanos, D::Error> {
        let raw = u64::deserialize(deserializer)?;
        Ok(UnixNanos::from(raw))
    }
}

/// Serializes `Option<UnixNanos>` as `Option<u64>`.
pub(crate) mod opt_nanos_as_u64 {
    use serde::{Deserialize, Deserializer, Serializer};
    use vibe_core::UnixNanos;

    /// Writes the value as `Option<u64>`.
    ///
    /// # Errors
    ///
    /// Propagates any error from the underlying serializer.
    #[expect(
        clippy::ref_option,
        reason = "serde with contract requires a borrowed option"
    )]
    pub(crate) fn serialize<S: Serializer>(
        value: &Option<UnixNanos>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match value {
            Some(v) => serializer.serialize_some(&v.as_u64()),
            None => serializer.serialize_none(),
        }
    }

    /// Reads an `Option<u64>` and constructs the optional [`UnixNanos`].
    ///
    /// # Errors
    ///
    /// Propagates any error from the underlying deserializer.
    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<UnixNanos>, D::Error> {
        let raw: Option<u64> = Option::deserialize(deserializer)?;
        Ok(raw.map(UnixNanos::from))
    }
}
