//! Cap'n Proto serialization integration tests for value types.

#![cfg(feature = "capnp")]

use rstest::rstest;
use vibe_model::types::{Price, Quantity, fixed::check_fixed_precision};
use vibe_serialization::capnp::{FromCapnp, ToCapnp, types_capnp};

trait FailLoud<T> {
    #[track_caller]
    fn fail_loud(self) -> T;
}

impl<T> FailLoud<T> for Option<T> {
    #[track_caller]
    fn fail_loud(self) -> T {
        self.unwrap_or_else(|| panic!("called `Option::unwrap()` on a `None` value"))
    }
}

impl<T, E: std::fmt::Debug> FailLoud<T> for Result<T, E> {
    #[track_caller]
    fn fail_loud(self) -> T {
        self.unwrap_or_else(|error| {
            panic!("called `Result::unwrap()` on an `Err` value: {error:?}")
        })
    }
}

trait FailLoudError<E> {
    #[track_caller]
    fn fail_loud_error(self) -> E;
}

impl<T: std::fmt::Debug, E> FailLoudError<E> for Result<T, E> {
    #[track_caller]
    fn fail_loud_error(self) -> E {
        match self {
            Err(error) => error,
            Ok(value) => panic!("called `Result::unwrap_err()` on an `Ok` value: {value:?}"),
        }
    }
}

#[rstest]
#[case(Price::from("100.50"))]
#[case(Price::from("0.00001"))]
#[case(Price::from("99999.999"))]
#[case(Price::from("1.0"))]
fn test_price_roundtrip(#[case] price: Price) {
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::price::Builder>();
    price.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .fail_loud();
    let root = reader.get_root::<types_capnp::price::Reader>().fail_loud();
    let decoded = Price::from_capnp(root).fail_loud();

    assert_eq!(price, decoded);
}

#[rstest]
#[case(Quantity::from("1000.5"))]
#[case(Quantity::from("0.0001"))]
#[case(Quantity::from("999999.999"))]
#[case(Quantity::from("1.0"))]
fn test_quantity_roundtrip(#[case] qty: Quantity) {
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::quantity::Builder>();
    qty.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .fail_loud();
    let root = reader
        .get_root::<types_capnp::quantity::Reader>()
        .fail_loud();
    let decoded = Quantity::from_capnp(root).fail_loud();

    assert_eq!(qty, decoded);
}

#[rstest]
fn test_price_invalid_precision_returns_error() {
    let mut message = capnp::message::Builder::new_default();
    let mut builder = message.init_root::<types_capnp::price::Builder>();
    let mut raw = builder.reborrow().init_raw();
    raw.set_lo(0);
    raw.set_hi(0);
    builder.set_precision(u8::MAX);

    let reader = message
        .get_root_as_reader::<types_capnp::price::Reader>()
        .fail_loud();
    let error = Price::from_capnp(reader).fail_loud_error();
    let expected_error = check_fixed_precision(u8::MAX).fail_loud_error();

    assert_eq!(error.to_string(), expected_error.to_string());
}

#[rstest]
fn test_quantity_invalid_precision_returns_error() {
    let mut message = capnp::message::Builder::new_default();
    let mut builder = message.init_root::<types_capnp::quantity::Builder>();
    let mut raw = builder.reborrow().init_raw();
    raw.set_lo(0);
    raw.set_hi(0);
    builder.set_precision(u8::MAX);

    let reader = message
        .get_root_as_reader::<types_capnp::quantity::Reader>()
        .fail_loud();
    let error = Quantity::from_capnp(reader).fail_loud_error();
    let expected_error = check_fixed_precision(u8::MAX).fail_loud_error();

    assert_eq!(error.to_string(), expected_error.to_string());
}

#[rstest]
fn test_price_with_helper_functions() {
    let price = Price::from("123.45");
    let bytes = vibe_serialization::capnp::conversions::serialize_price(&price).fail_loud();
    let decoded = vibe_serialization::capnp::conversions::deserialize_price(&bytes).fail_loud();
    assert_eq!(price, decoded);
}

#[rstest]
fn test_quantity_with_helper_functions() {
    let qty = Quantity::from("100.5");
    let bytes = vibe_serialization::capnp::conversions::serialize_quantity(&qty).fail_loud();
    let decoded = vibe_serialization::capnp::conversions::deserialize_quantity(&bytes).fail_loud();
    assert_eq!(qty, decoded);
}

#[rstest]
fn test_price_zero() {
    let price = Price::from("0.0");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::price::Builder>();
    price.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .fail_loud();
    let root = reader.get_root::<types_capnp::price::Reader>().fail_loud();
    let decoded = Price::from_capnp(root).fail_loud();

    assert_eq!(price, decoded);
}

#[rstest]
fn test_quantity_zero() {
    let qty = Quantity::from("0.0");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::quantity::Builder>();
    qty.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .fail_loud();
    let root = reader
        .get_root::<types_capnp::quantity::Reader>()
        .fail_loud();
    let decoded = Quantity::from_capnp(root).fail_loud();

    assert_eq!(qty, decoded);
}

#[rstest]
fn test_price_negative() {
    let price = Price::from("-50.25");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::price::Builder>();
    price.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .fail_loud();
    let root = reader.get_root::<types_capnp::price::Reader>().fail_loud();
    let decoded = Price::from_capnp(root).fail_loud();

    assert_eq!(price, decoded);
}

#[rstest]
fn test_price_max_precision() {
    let price = Price::from("123.123456789");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::price::Builder>();
    price.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .fail_loud();
    let root = reader.get_root::<types_capnp::price::Reader>().fail_loud();
    let decoded = Price::from_capnp(root).fail_loud();

    assert_eq!(price, decoded);
}

#[rstest]
fn test_quantity_max_precision() {
    let qty = Quantity::from("100.123456789");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::quantity::Builder>();
    qty.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).fail_loud();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .fail_loud();
    let root = reader
        .get_root::<types_capnp::quantity::Reader>()
        .fail_loud();
    let decoded = Quantity::from_capnp(root).fail_loud();

    assert_eq!(qty, decoded);
}
