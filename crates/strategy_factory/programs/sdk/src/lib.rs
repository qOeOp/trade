#![no_std]

use core::cell::UnsafeCell;

pub const ABI_VERSION: u16 = 3;
pub const FRAME_CAPACITY: usize = 16 * 1024;
pub const ACTION_CAPACITY: usize = 192;
pub const MAX_ACTIONS: usize = 3;
pub const BAR_RECORD: u32 = 1;
pub const POSITION_RECORD: u32 = 2;
pub const ORDER_RECORD: u32 = 3;
pub const BALANCE_RECORD: u32 = 4;
pub const ORDER_EVENT_RECORD: u32 = 5;
pub const CODEC_V1: u16 = 1;

pub mod order_event {
    pub const ACCEPTED: u8 = 1;
    pub const PENDING_UPDATE: u8 = 2;
    pub const UPDATED: u8 = 3;
    pub const PENDING_CANCEL: u8 = 4;
    pub const CANCELED: u8 = 5;
    pub const PARTIALLY_FILLED: u8 = 6;
    pub const FILLED: u8 = 7;
    pub const REJECTED: u8 = 8;
    pub const MODIFY_REJECTED: u8 = 9;
    pub const CANCEL_REJECTED: u8 = 10;
}

const FRAME_MAGIC: [u8; 4] = *b"SFF1";
const FRAME_HEADER_LEN: usize = 48;
const RECORD_HEADER_LEN: usize = 32;
const ACTION_LEN: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    Start = 1,
    Observation = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum OrderSide {
    Buy = 1,
    Sell = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProgramRunScope {
    pub source_start_ns: u64,
    pub decision_start_ns: u64,
    pub end_ns: u64,
}

impl ProgramRunScope {
    pub fn new(
        source_start_ns: u64,
        decision_start_ns: u64,
        end_ns: u64,
    ) -> Result<Self, ProgramFault> {
        (source_start_ns <= decision_start_ns && decision_start_ns < end_ns)
            .then_some(Self {
                source_start_ns,
                decision_start_ns,
                end_ns,
            })
            .ok_or(ProgramFault::MalformedFrame)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum ProgramFault {
    MalformedFrame = -1,
    ActionOverflow = -3,
    InvalidAction = -4,
    ProgramRejected = -5,
}

#[derive(Clone, Copy)]
pub struct RecordMeta {
    pub type_id: u32,
    pub codec_version: u16,
    pub channel: u32,
    pub ts_event: u64,
    pub available_at: u64,
}

pub struct FrameEncoder<'a> {
    output: &'a mut [u8],
    cursor: usize,
}

impl<'a> FrameEncoder<'a> {
    pub fn start(
        output: &'a mut [u8],
        decision_time_ns: u64,
        run_scope: ProgramRunScope,
        parameters: &[u8],
    ) -> Result<Self, ProgramFault> {
        let encoder = Self::header(output, FrameKind::Start, decision_time_ns, parameters)?;
        encoder.output[24..32].copy_from_slice(&run_scope.source_start_ns.to_le_bytes());
        encoder.output[32..40].copy_from_slice(&run_scope.decision_start_ns.to_le_bytes());
        encoder.output[40..48].copy_from_slice(&run_scope.end_ns.to_le_bytes());
        Ok(encoder)
    }

    pub fn observation(output: &'a mut [u8], decision_time_ns: u64) -> Result<Self, ProgramFault> {
        Self::header(output, FrameKind::Observation, decision_time_ns, &[])
    }

    fn header(
        output: &'a mut [u8],
        kind: FrameKind,
        decision_time_ns: u64,
        parameters: &[u8],
    ) -> Result<Self, ProgramFault> {
        let parameter_len =
            u16::try_from(parameters.len()).map_err(|_| ProgramFault::MalformedFrame)?;
        let cursor = FRAME_HEADER_LEN
            .checked_add(parameters.len())
            .ok_or(ProgramFault::MalformedFrame)?;
        let bytes = output
            .get_mut(..cursor)
            .ok_or(ProgramFault::MalformedFrame)?;
        bytes.fill(0);
        bytes[..4].copy_from_slice(&FRAME_MAGIC);
        bytes[4..6].copy_from_slice(&ABI_VERSION.to_le_bytes());
        bytes[6] = kind as u8;
        bytes[8..16].copy_from_slice(&decision_time_ns.to_le_bytes());
        bytes[16..18].copy_from_slice(&parameter_len.to_le_bytes());
        bytes[FRAME_HEADER_LEN..].copy_from_slice(parameters);
        Ok(Self { output, cursor })
    }

    pub fn push(&mut self, meta: RecordMeta, payload: &[u8]) -> Result<(), ProgramFault> {
        if meta.type_id == 0 || meta.codec_version == 0 {
            return Err(ProgramFault::MalformedFrame);
        }
        let payload_len = u32::try_from(payload.len()).map_err(|_| ProgramFault::MalformedFrame)?;
        let end = self
            .cursor
            .checked_add(RECORD_HEADER_LEN)
            .and_then(|value| value.checked_add(payload.len()))
            .ok_or(ProgramFault::MalformedFrame)?;
        let bytes = self
            .output
            .get_mut(self.cursor..end)
            .ok_or(ProgramFault::MalformedFrame)?;
        bytes.fill(0);
        bytes[..4].copy_from_slice(&meta.type_id.to_le_bytes());
        bytes[4..6].copy_from_slice(&meta.codec_version.to_le_bytes());
        bytes[8..12].copy_from_slice(&meta.channel.to_le_bytes());
        bytes[12..16].copy_from_slice(&payload_len.to_le_bytes());
        bytes[16..24].copy_from_slice(&meta.ts_event.to_le_bytes());
        bytes[24..32].copy_from_slice(&meta.available_at.to_le_bytes());
        bytes[RECORD_HEADER_LEN..].copy_from_slice(payload);
        self.cursor = end;
        Ok(())
    }

    pub const fn finish(self) -> usize {
        self.cursor
    }
}

#[derive(Clone, Copy)]
pub struct RecordRef<'a> {
    pub meta: RecordMeta,
    pub payload: &'a [u8],
}

impl RecordRef<'_> {
    pub fn f64s<const N: usize>(self, type_id: u32) -> Result<[f64; N], ProgramFault> {
        self.require(type_id, N * 8)?;
        let mut values = [0.0; N];
        for (index, value) in values.iter_mut().enumerate() {
            *value = read_f64(self.payload, index * 8)?;
        }
        Ok(values)
    }

    pub fn scalar(self) -> Result<f64, ProgramFault> {
        Ok(self.f64s::<1>(self.meta.type_id)?[0])
    }

    pub fn order_event(self) -> Result<(u64, u8, u8, f64, f64), ProgramFault> {
        self.require(ORDER_EVENT_RECORD, 32)?;
        if self.payload[10..16] != [0; 6] {
            return Err(ProgramFault::MalformedFrame);
        }
        Ok((
            read_u64(self.payload, 0)?,
            self.payload[8],
            self.payload[9],
            read_f64(self.payload, 16)?,
            read_f64(self.payload, 24)?,
        ))
    }

    fn require(self, type_id: u32, len: usize) -> Result<(), ProgramFault> {
        (self.meta.type_id == type_id
            && self.meta.codec_version == CODEC_V1
            && self.payload.len() == len)
            .then_some(())
            .ok_or(ProgramFault::MalformedFrame)
    }
}

pub struct Frame<'a> {
    kind: FrameKind,
    pub decision_time_ns: u64,
    pub run_scope: Option<ProgramRunScope>,
    parameters: &'a [u8],
    records: &'a [u8],
}

impl<'a> Frame<'a> {
    pub fn decode(bytes: &'a [u8]) -> Result<Self, ProgramFault> {
        if bytes.len() < FRAME_HEADER_LEN
            || bytes[..4] != FRAME_MAGIC
            || read_u16(bytes, 4)? != ABI_VERSION
            || bytes[7] != 0
            || bytes[18..24] != [0; 6]
        {
            return Err(ProgramFault::MalformedFrame);
        }
        let parameter_end = FRAME_HEADER_LEN
            .checked_add(usize::from(read_u16(bytes, 16)?))
            .ok_or(ProgramFault::MalformedFrame)?;
        if parameter_end > bytes.len() {
            return Err(ProgramFault::MalformedFrame);
        }
        let kind = match bytes[6] {
            1 => FrameKind::Start,
            2 => FrameKind::Observation,
            _ => return Err(ProgramFault::MalformedFrame),
        };
        let run_scope = match kind {
            FrameKind::Start => Some(ProgramRunScope::new(
                read_u64(bytes, 24)?,
                read_u64(bytes, 32)?,
                read_u64(bytes, 40)?,
            )?),
            FrameKind::Observation
                if parameter_end == FRAME_HEADER_LEN && bytes[24..48] == [0; 24] =>
            {
                None
            }
            FrameKind::Observation => return Err(ProgramFault::MalformedFrame),
        };
        let frame = Self {
            kind,
            decision_time_ns: read_u64(bytes, 8)?,
            run_scope,
            parameters: &bytes[FRAME_HEADER_LEN..parameter_end],
            records: &bytes[parameter_end..],
        };
        if kind == FrameKind::Start && !frame.records.is_empty() {
            return Err(ProgramFault::MalformedFrame);
        }
        frame.records().try_for_each(|record| {
            (record?.meta.available_at <= frame.decision_time_ns)
                .then_some(())
                .ok_or(ProgramFault::MalformedFrame)
        })?;
        Ok(frame)
    }

    pub const fn parameters(&self) -> &'a [u8] {
        self.parameters
    }
    pub fn records(&self) -> Records<'a> {
        Records {
            remaining: self.records,
        }
    }
}

pub struct Records<'a> {
    remaining: &'a [u8],
}

impl<'a> Iterator for Records<'a> {
    type Item = Result<RecordRef<'a>, ProgramFault>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining.is_empty() {
            return None;
        }
        let result = (|| {
            let header = self
                .remaining
                .get(..RECORD_HEADER_LEN)
                .ok_or(ProgramFault::MalformedFrame)?;
            if header[6..8] != [0; 2] {
                return Err(ProgramFault::MalformedFrame);
            }
            let payload_len =
                usize::try_from(read_u32(header, 12)?).map_err(|_| ProgramFault::MalformedFrame)?;
            let len = RECORD_HEADER_LEN
                .checked_add(payload_len)
                .ok_or(ProgramFault::MalformedFrame)?;
            let record = self
                .remaining
                .get(..len)
                .ok_or(ProgramFault::MalformedFrame)?;
            self.remaining = &self.remaining[len..];
            let meta = RecordMeta {
                type_id: read_u32(header, 0)?,
                codec_version: read_u16(header, 4)?,
                channel: read_u32(header, 8)?,
                ts_event: read_u64(header, 16)?,
                available_at: read_u64(header, 24)?,
            };
            if meta.type_id == 0 || meta.codec_version == 0 {
                return Err(ProgramFault::MalformedFrame);
            }
            Ok(RecordRef {
                meta,
                payload: &record[RECORD_HEADER_LEN..],
            })
        })();
        if result.is_err() {
            self.remaining = &[];
        }
        Some(result)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum OrderKind {
    Market = 1,
    Limit = 2,
    StopMarket = 3,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    Submit {
        kind: OrderKind,
        instrument: u32,
        handle: u64,
        side: OrderSide,
        quantity: f64,
        price: f64,
        trigger_price: f64,
        reduce_only: bool,
        decision_tag: u32,
    },
    Modify {
        handle: u64,
        quantity: Option<f64>,
        price: Option<f64>,
        trigger_price: Option<f64>,
    },
    Cancel(u64),
}

impl Action {
    fn encode(self, output: &mut [u8]) -> Result<(), ProgramFault> {
        output.fill(0);
        match self {
            Self::Submit {
                kind,
                instrument,
                handle,
                side,
                quantity,
                price,
                trigger_price,
                reduce_only,
                decision_tag,
            } => {
                output[0] = 1;
                output[1] = kind as u8;
                output[2] = side as u8;
                output[4] = u8::from(reduce_only);
                write_u32(output, 8, instrument);
                write_u32(output, 12, decision_tag);
                write_u64(output, 16, handle);
                write_f64(output, 24, quantity);
                write_f64(output, 32, price);
                write_f64(output, 40, trigger_price);
            }
            Self::Modify {
                handle,
                quantity,
                price,
                trigger_price,
            } => {
                output[0] = 2;
                write_u64(output, 16, handle);
                for (flag, offset, value) in
                    [(1, 24, quantity), (2, 32, price), (4, 40, trigger_price)]
                {
                    if let Some(value) = value {
                        output[5] |= flag;
                        write_f64(output, offset, value);
                    }
                }
            }
            Self::Cancel(handle) => {
                output[0] = 3;
                write_u64(output, 16, handle);
            }
        }
        Ok(())
    }

    fn decode(bytes: &[u8]) -> Result<Self, ProgramFault> {
        if bytes[6..8] != [0; 2] || bytes[48..] != [0; 16] || bytes[4] > 1 || bytes[5] & !7 != 0 {
            return Err(ProgramFault::InvalidAction);
        }
        let option = |flag, offset| (bytes[5] & flag != 0).then(|| read_f64(bytes, offset));
        match bytes[0] {
            1 if bytes[3] == 0 && bytes[5] == 0 => Ok(Self::Submit {
                kind: match bytes[1] {
                    1 => OrderKind::Market,
                    2 => OrderKind::Limit,
                    3 => OrderKind::StopMarket,
                    _ => return Err(ProgramFault::InvalidAction),
                },
                instrument: read_u32(bytes, 8)?,
                handle: read_u64(bytes, 16)?,
                side: match bytes[2] {
                    1 => OrderSide::Buy,
                    2 => OrderSide::Sell,
                    _ => return Err(ProgramFault::InvalidAction),
                },
                quantity: read_f64(bytes, 24)?,
                price: read_f64(bytes, 32)?,
                trigger_price: read_f64(bytes, 40)?,
                reduce_only: bytes[4] == 1,
                decision_tag: read_u32(bytes, 12)?,
            }),
            2 if bytes[1..5] == [0; 4]
                && bytes[8..16] == [0; 8]
                && bytes[5] != 0
                && (bytes[5] & 1 != 0 || bytes[24..32] == [0; 8])
                && (bytes[5] & 2 != 0 || bytes[32..40] == [0; 8])
                && (bytes[5] & 4 != 0 || bytes[40..48] == [0; 8]) =>
            {
                Ok(Self::Modify {
                    handle: read_u64(bytes, 16)?,
                    quantity: option(1, 24).transpose()?,
                    price: option(2, 32).transpose()?,
                    trigger_price: option(4, 40).transpose()?,
                })
            }
            3 if bytes[1..16] == [0; 15] && bytes[24..48] == [0; 24] => {
                Ok(Self::Cancel(read_u64(bytes, 16)?))
            }
            _ => Err(ProgramFault::InvalidAction),
        }
    }
}

fn write_u32(output: &mut [u8], offset: usize, value: u32) {
    output[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
fn write_u64(output: &mut [u8], offset: usize, value: u64) {
    output[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}
fn write_f64(output: &mut [u8], offset: usize, value: f64) {
    write_u64(output, offset, value.to_bits());
}

pub struct ActionEncoder<'a> {
    output: &'a mut [u8],
    count: usize,
}

impl<'a> ActionEncoder<'a> {
    pub fn new(output: &'a mut [u8]) -> Self {
        output.fill(0);
        Self { output, count: 0 }
    }

    pub fn push(&mut self, action: Action) -> Result<(), ProgramFault> {
        let start = self.count * ACTION_LEN;
        action.encode(
            self.output
                .get_mut(start..start + ACTION_LEN)
                .ok_or(ProgramFault::ActionOverflow)?,
        )?;
        self.count += 1;
        Ok(())
    }

    pub const fn finish(self) -> usize {
        self.count * ACTION_LEN
    }
}

pub fn decode_actions(
    bytes: &[u8],
) -> Result<impl Iterator<Item = Result<Action, ProgramFault>> + '_, ProgramFault> {
    if !bytes.len().is_multiple_of(ACTION_LEN) || bytes.len() / ACTION_LEN > MAX_ACTIONS {
        return Err(ProgramFault::InvalidAction);
    }
    Ok(bytes.chunks_exact(ACTION_LEN).map(Action::decode))
}
pub trait StrategyProgram {
    fn on_start(
        &mut self,
        _frame: &Frame<'_>,
        _actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault> {
        Ok(())
    }
    fn on_frame(
        &mut self,
        frame: &Frame<'_>,
        actions: &mut ActionEncoder<'_>,
    ) -> Result<(), ProgramFault>;
}

#[doc(hidden)]
pub struct ProgramCell<T>(UnsafeCell<T>);
impl<T> ProgramCell<T> {
    pub const fn new(value: T) -> Self {
        Self(UnsafeCell::new(value))
    }
    pub const fn get(&self) -> *mut T {
        self.0.get()
    }
}
// Wasm execution is single-threaded and the host never re-enters a program instance.
unsafe impl<T> Sync for ProgramCell<T> {}

#[doc(hidden)]
pub fn dispatch<P: StrategyProgram>(
    program: &mut P,
    frame_bytes: &[u8],
    action_bytes: &mut [u8],
) -> i32 {
    let result = (|| {
        let frame = Frame::decode(frame_bytes)?;
        let mut actions = ActionEncoder::new(action_bytes);
        match frame.kind {
            FrameKind::Start => program.on_start(&frame, &mut actions)?,
            FrameKind::Observation => program.on_frame(&frame, &mut actions)?,
        }
        Ok::<usize, ProgramFault>(actions.finish())
    })();
    match result {
        Ok(length) => i32::try_from(length).unwrap_or(ProgramFault::ActionOverflow as i32),
        Err(fault) => fault as i32,
    }
}

#[macro_export]
macro_rules! export_strategy_program {
    ($program_type:ty, $program:expr) => {
        static PROGRAM: $crate::ProgramCell<$program_type> = $crate::ProgramCell::new($program);
        static FRAME_BUFFER: $crate::ProgramCell<[u8; $crate::FRAME_CAPACITY]> =
            $crate::ProgramCell::new([0; $crate::FRAME_CAPACITY]);
        static ACTION_BUFFER: $crate::ProgramCell<[u8; $crate::ACTION_CAPACITY]> =
            $crate::ProgramCell::new([0; $crate::ACTION_CAPACITY]);
        #[unsafe(no_mangle)]
        pub extern "C" fn strategy_factory_frame_ptr_v1() -> u32 {
            FRAME_BUFFER.get().cast::<u8>() as u32
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn strategy_factory_frame_capacity_v1() -> u32 {
            $crate::FRAME_CAPACITY as u32
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn strategy_factory_proposal_ptr_v1() -> u32 {
            ACTION_BUFFER.get().cast::<u8>() as u32
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn strategy_factory_proposal_capacity_v1() -> u32 {
            $crate::ACTION_CAPACITY as u32
        }
        #[unsafe(no_mangle)]
        pub extern "C" fn strategy_factory_on_event_v1(frame_len: u32) -> i32 {
            if frame_len as usize > $crate::FRAME_CAPACITY {
                return $crate::ProgramFault::MalformedFrame as i32;
            }
            unsafe {
                let program = &mut *PROGRAM.get();
                let frame = &*FRAME_BUFFER.get();
                let actions = &mut *ACTION_BUFFER.get();
                $crate::dispatch(program, &frame[..frame_len as usize], actions)
            }
        }
    };
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProgramFault> {
    Ok(u16::from_le_bytes(read(bytes, offset)?))
}
fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProgramFault> {
    Ok(u32::from_le_bytes(read(bytes, offset)?))
}
fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProgramFault> {
    Ok(u64::from_le_bytes(read(bytes, offset)?))
}
fn read_f64(bytes: &[u8], offset: usize) -> Result<f64, ProgramFault> {
    Ok(f64::from_bits(read_u64(bytes, offset)?))
}
fn read<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], ProgramFault> {
    bytes
        .get(offset..offset + N)
        .and_then(|value| value.try_into().ok())
        .ok_or(ProgramFault::MalformedFrame)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    fn meta(type_id: u32, available_at: u64) -> RecordMeta {
        RecordMeta {
            type_id,
            codec_version: CODEC_V1,
            channel: 7,
            ts_event: 90,
            available_at,
        }
    }

    #[rstest]
    fn raw_records_are_length_delimited_and_unknown_types_are_opaque() {
        let mut bytes = [0_u8; 256];
        let mut encoder = FrameEncoder::observation(&mut bytes, 100).unwrap();
        encoder
            .push(meta(POSITION_RECORD, 99), &4.0_f64.to_bits().to_le_bytes())
            .unwrap();
        encoder.push(meta(77, 98), b"future").unwrap();
        let len = encoder.finish();
        let frame = Frame::decode(&bytes[..len]).unwrap();
        let mut records = frame.records();
        assert_eq!(records.next().unwrap().unwrap().scalar().unwrap(), 4.0);
        let unknown = records.next().unwrap().unwrap();
        assert_eq!(unknown.meta.type_id, 77);
        assert_eq!(unknown.payload, b"future");
        assert!(records.next().is_none());
    }

    #[rstest]
    fn frame_rejects_future_availability_and_truncated_tail() {
        let mut bytes = [0_u8; 256];
        let mut encoder = FrameEncoder::observation(&mut bytes, 100).unwrap();
        encoder
            .push(meta(POSITION_RECORD, 101), &0.0_f64.to_bits().to_le_bytes())
            .unwrap();
        let len = encoder.finish();
        assert!(Frame::decode(&bytes[..len]).is_err());
        bytes[24..32].fill(0);
        assert!(Frame::decode(&bytes[..len - 1]).is_err());
    }

    #[rstest]
    fn start_frame_binds_scope_and_parameters() {
        let mut bytes = [0_u8; 128];
        let scope = ProgramRunScope::new(10, 20, 30).unwrap();
        let len = FrameEncoder::start(&mut bytes, 20, scope, b"params")
            .unwrap()
            .finish();
        let frame = Frame::decode(&bytes[..len]).unwrap();
        assert_eq!(frame.run_scope, Some(scope));
        assert_eq!(frame.parameters(), b"params");
        assert!(ProgramRunScope::new(20, 10, 30).is_err());
    }

    #[rstest]
    fn actions_round_trip_and_reject_malformed_batch() {
        let mut bytes = [0_u8; ACTION_CAPACITY];
        let mut encoder = ActionEncoder::new(&mut bytes);
        let limit = Action::Submit {
            kind: OrderKind::Limit,
            instrument: 9,
            handle: 10,
            side: OrderSide::Buy,
            quantity: 2.0,
            price: 1.5,
            trigger_price: 0.0,
            reduce_only: false,
            decision_tag: 11,
        };
        let modify = Action::Modify {
            handle: 10,
            quantity: None,
            price: Some(1.25),
            trigger_price: None,
        };
        encoder.push(limit).unwrap();
        encoder.push(modify).unwrap();
        encoder.push(Action::Cancel(10)).unwrap();
        let len = encoder.finish();
        let mut actions = decode_actions(&bytes[..len]).unwrap();
        assert_eq!(actions.next().unwrap().unwrap(), limit);
        assert_eq!(actions.next().unwrap().unwrap(), modify);
        assert_eq!(actions.next().unwrap().unwrap(), Action::Cancel(10));
        assert!(decode_actions(&bytes[..len - 1]).is_err());
    }

    #[rstest]
    fn fourth_action_and_invalid_shapes_fail_closed() {
        let mut bytes = [0_u8; ACTION_CAPACITY];
        let mut encoder = ActionEncoder::new(&mut bytes);
        for handle in 1..=3 {
            encoder.push(Action::Cancel(handle)).unwrap();
        }
        assert_eq!(
            encoder.push(Action::Cancel(4)),
            Err(ProgramFault::ActionOverflow)
        );
        let mut output = [0_u8; ACTION_CAPACITY];
        let mut encoder = ActionEncoder::new(&mut output);
        encoder
            .push(Action::Submit {
                kind: OrderKind::Limit,
                instrument: 1,
                handle: 1,
                side: OrderSide::Buy,
                quantity: 1.0,
                price: 1.0,
                trigger_price: 0.0,
                reduce_only: false,
                decision_tag: 0,
            })
            .unwrap();
        let len = encoder.finish();
        output[3] = 1;
        assert_eq!(
            decode_actions(&output[..len]).unwrap().next().unwrap(),
            Err(ProgramFault::InvalidAction)
        );
    }
}
