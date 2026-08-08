//! Cap'n Proto serialization integration tests for value types.

#![cfg(feature = "capnp")]

use rstest::rstest;
use vibe_model::types::{Price, Quantity, fixed::check_fixed_precision};
use vibe_serialization::capnp::{FromCapnp, ToCapnp, types_capnp};

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
    capnp::serialize::write_message(&mut bytes, &message).unwrap();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .unwrap();
    let root = reader.get_root::<types_capnp::price::Reader>().unwrap();
    let decoded = Price::from_capnp(root).unwrap();

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
    capnp::serialize::write_message(&mut bytes, &message).unwrap();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .unwrap();
    let root = reader.get_root::<types_capnp::quantity::Reader>().unwrap();
    let decoded = Quantity::from_capnp(root).unwrap();

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
        .unwrap();
    let error = Price::from_capnp(reader).unwrap_err();
    let expected_error = check_fixed_precision(u8::MAX).unwrap_err();

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
        .unwrap();
    let error = Quantity::from_capnp(reader).unwrap_err();
    let expected_error = check_fixed_precision(u8::MAX).unwrap_err();

    assert_eq!(error.to_string(), expected_error.to_string());
}

#[rstest]
fn test_price_with_helper_functions() {
    let price = Price::from("123.45");
    let bytes = vibe_serialization::capnp::conversions::serialize_price(&price).unwrap();
    let decoded = vibe_serialization::capnp::conversions::deserialize_price(&bytes).unwrap();
    assert_eq!(price, decoded);
}

#[rstest]
fn test_quantity_with_helper_functions() {
    let qty = Quantity::from("100.5");
    let bytes = vibe_serialization::capnp::conversions::serialize_quantity(&qty).unwrap();
    let decoded = vibe_serialization::capnp::conversions::deserialize_quantity(&bytes).unwrap();
    assert_eq!(qty, decoded);
}

#[rstest]
fn test_price_zero() {
    let price = Price::from("0.0");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::price::Builder>();
    price.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).unwrap();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .unwrap();
    let root = reader.get_root::<types_capnp::price::Reader>().unwrap();
    let decoded = Price::from_capnp(root).unwrap();

    assert_eq!(price, decoded);
}

#[rstest]
fn test_quantity_zero() {
    let qty = Quantity::from("0.0");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::quantity::Builder>();
    qty.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).unwrap();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .unwrap();
    let root = reader.get_root::<types_capnp::quantity::Reader>().unwrap();
    let decoded = Quantity::from_capnp(root).unwrap();

    assert_eq!(qty, decoded);
}

#[rstest]
fn test_price_negative() {
    let price = Price::from("-50.25");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::price::Builder>();
    price.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).unwrap();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .unwrap();
    let root = reader.get_root::<types_capnp::price::Reader>().unwrap();
    let decoded = Price::from_capnp(root).unwrap();

    assert_eq!(price, decoded);
}

#[rstest]
fn test_price_max_precision() {
    let price = Price::from("123.123456789");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::price::Builder>();
    price.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).unwrap();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .unwrap();
    let root = reader.get_root::<types_capnp::price::Reader>().unwrap();
    let decoded = Price::from_capnp(root).unwrap();

    assert_eq!(price, decoded);
}

#[rstest]
fn test_quantity_max_precision() {
    let qty = Quantity::from("100.123456789");
    let mut message = capnp::message::Builder::new_default();
    let builder = message.init_root::<types_capnp::quantity::Builder>();
    qty.to_capnp(builder);

    let mut bytes = Vec::new();
    capnp::serialize::write_message(&mut bytes, &message).unwrap();

    let reader =
        capnp::serialize::read_message(&mut &bytes[..], capnp::message::ReaderOptions::new())
            .unwrap();
    let root = reader.get_root::<types_capnp::quantity::Reader>().unwrap();
    let decoded = Quantity::from_capnp(root).unwrap();

    assert_eq!(qty, decoded);
}
