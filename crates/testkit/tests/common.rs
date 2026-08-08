use std::{fs::File, mem::size_of};

use arrow::datatypes::DataType;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use rstest::rstest;
use vibe_model::types::{price::PriceRaw, quantity::QuantityRaw};
use vibe_testkit::common::get_vibe_test_data_file_path;

#[rstest]
fn selected_fixture_fixed_widths_match_model_raw_types() {
    let filepath = get_vibe_test_data_file_path("quotes.parquet");
    let file = File::open(filepath).unwrap();
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).unwrap();
    let schema = builder.schema();

    assert_eq!(
        schema.field_with_name("bid_price").unwrap().data_type(),
        &DataType::FixedSizeBinary(i32::try_from(size_of::<PriceRaw>()).unwrap()),
        "selected fixture price width must match PriceRaw",
    );
    assert_eq!(
        schema.field_with_name("bid_size").unwrap().data_type(),
        &DataType::FixedSizeBinary(i32::try_from(size_of::<QuantityRaw>()).unwrap()),
        "selected fixture quantity width must match QuantityRaw",
    );
}
