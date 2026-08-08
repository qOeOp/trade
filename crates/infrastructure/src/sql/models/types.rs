use sqlx::{FromRow, Row, postgres::PgRow};
use ustr::Ustr;
use vibe_common::signal::Signal;
use vibe_core::UnixNanos;
use vibe_model::types::Currency;

use crate::sql::models::{enums::CurrencyTypeModel, read_u8, read_u16};

#[derive(Debug)]
pub struct CurrencyModel(pub Currency);

#[derive(Debug)]
pub struct SignalModel(pub Signal);

impl<'r> FromRow<'r, PgRow> for CurrencyModel {
    fn from_row(row: &'r PgRow) -> Result<Self, sqlx::Error> {
        let id = row.try_get::<String, _>("id")?;
        let precision = read_u8(row, "precision")?;
        let iso4217 = read_u16(row, "iso4217")?;
        let name = row.try_get::<String, _>("name")?;
        let currency_type_model = row.try_get::<CurrencyTypeModel, _>("currency_type")?;
        let currency = Currency::new(
            id.as_str(),
            precision,
            iso4217,
            name.as_str(),
            currency_type_model.0,
        );
        Ok(Self(currency))
    }
}

impl<'r> FromRow<'r, PgRow> for SignalModel {
    fn from_row(row: &'r PgRow) -> Result<Self, sqlx::Error> {
        let name = row.try_get::<&str, _>("name").map(Ustr::from)?;
        let value = row.try_get::<String, _>("value")?;
        let ts_event = row.try_get::<&str, _>("ts_event").map(UnixNanos::from)?;
        let ts_init = row.try_get::<&str, _>("ts_init").map(UnixNanos::from)?;
        let signal = Signal::new(name, value, ts_event, ts_init);
        Ok(Self(signal))
    }
}
