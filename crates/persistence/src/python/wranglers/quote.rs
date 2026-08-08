use std::{collections::HashMap, io::Cursor, str::FromStr};

use datafusion::arrow::ipc::reader::StreamReader;
use pyo3::prelude::*;
use vibe_core::python::to_pyvalue_err;
use vibe_model::{data::QuoteTick, identifiers::InstrumentId};
use vibe_serialization::arrow::DecodeFromRecordBatch;

#[pyclass]
#[pyo3_stub_gen::derive::gen_stub_pyclass(module = "vibe_trader.persistence")]
pub struct QuoteTickDataWrangler {
    instrument_id: InstrumentId,
    price_precision: u8,
    size_precision: u8,
    metadata: HashMap<String, String>,
}

#[pymethods]
#[pyo3_stub_gen::derive::gen_stub_pymethods]
impl QuoteTickDataWrangler {
    #[new]
    fn py_new(instrument_id: &str, price_precision: u8, size_precision: u8) -> PyResult<Self> {
        let instrument_id = InstrumentId::from_str(instrument_id).map_err(to_pyvalue_err)?;
        let metadata = QuoteTick::get_metadata(&instrument_id, price_precision, size_precision);

        Ok(Self {
            instrument_id,
            price_precision,
            size_precision,
            metadata,
        })
    }

    #[getter]
    fn instrument_id(&self) -> String {
        self.instrument_id.to_string()
    }

    #[getter]
    const fn price_precision(&self) -> u8 {
        self.price_precision
    }

    #[getter]
    const fn size_precision(&self) -> u8 {
        self.size_precision
    }

    fn process_record_batch_bytes(
        &self,
        #[gen_stub(override_type(type_repr = "bytes"))] data: &[u8],
    ) -> PyResult<Vec<QuoteTick>> {
        // Create a StreamReader (from Arrow IPC)
        let cursor = Cursor::new(data);
        let reader = match StreamReader::try_new(cursor, None) {
            Ok(reader) => reader,
            Err(e) => return Err(to_pyvalue_err(e)),
        };

        let mut quotes = Vec::new();

        // Read the record batches
        for maybe_batch in reader {
            let record_batch = match maybe_batch {
                Ok(record_batch) => record_batch,
                Err(e) => return Err(to_pyvalue_err(e)),
            };

            let batch_deltas =
                QuoteTick::decode_batch(&self.metadata, record_batch).map_err(to_pyvalue_err)?;
            quotes.extend(batch_deltas);
        }

        Ok(quotes)
    }
}
