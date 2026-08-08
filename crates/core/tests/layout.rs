use std::mem::{align_of, size_of};

use rstest::rstest;
use vibe_core::UUID4;

#[rstest]
fn uuid4_layout_stays_c_string_compatible() {
    assert_eq!(size_of::<UUID4>(), 37);
    assert_eq!(align_of::<UUID4>(), 1);

    let uuid = UUID4::from("2d89666b-1a1e-4a75-b193-4eb3b454c757");
    let text = uuid.as_str();

    assert_eq!(text.len(), 36);
    assert_eq!(&text[8..9], "-");
    assert_eq!(&text[13..14], "-");
    assert_eq!(&text[18..19], "-");
    assert_eq!(&text[23..24], "-");
    assert_eq!(&text[14..15], "4");
    assert!(matches!(text.as_bytes()[19], b'8' | b'9' | b'a' | b'b'));
}
