//! Numeric conversions between wire integers and model raw types.
//!
//! These generic boundaries follow the model's resolved raw aliases independently of this
//! crate's `high-precision` forwarding feature. Keeping them generic is deliberate: the target
//! width comes from `PriceRaw`, `QuantityRaw`, and `MoneyRaw`, so codec code never needs to
//! inspect a precision feature of its own to decide how wide a value may be. Inlining these
//! conversions back into the codecs would reintroduce that coupling.

/// Converts a wire integer into the resolved model raw type, returning `None` on overflow.
#[inline]
pub(crate) fn wire_to_raw<R, W>(wire: W) -> Option<R>
where
    R: TryFrom<W>,
{
    R::try_from(wire).ok()
}

/// Converts a model raw integer into its lossless wire representation.
#[inline]
pub(crate) fn raw_to_wire<W, R>(raw: R) -> W
where
    W: From<R>,
{
    W::from(raw)
}
