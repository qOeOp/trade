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
pub const TIMER_RECORD: u32 = 6;
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

    pub fn timer(self) -> Result<u64, ProgramFault> {
        self.require(TIMER_RECORD, 8)?;
        read_u64(self.payload, 0)
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

/// Deterministic, allocation-free StrategyDesignV2 lifecycle semantics.
///
/// This module is additive to the program ABI. A program may produce the bounded typed
/// [`lifecycle_v1::ProposalV1`] values, but only [`lifecycle_v1::LifecycleKernelV1`] validates and applies them. In
/// particular, a proposal is semantic intent and never an order or a position mutation.
pub mod lifecycle_v1 {
    use core::cmp::Ordering;

    pub const LIFECYCLE_SCHEMA_VERSION: u16 = 1;
    pub const CHECKPOINT_SCHEMA_VERSION: u16 = 1;
    pub const TRACE_SCHEMA_VERSION: u16 = 1;
    pub const KERNEL_SEMANTICS_ID: &str = "strategy.lifecycle.kernel.v1";
    pub const ENTER_SEMANTIC_ID: &str = "kernel.position.enter.v1";
    pub const ADD_SEMANTIC_ID: &str = "kernel.position.add.v1";
    pub const REDUCE_SEMANTIC_ID: &str = "kernel.position.reduce.v1";
    pub const EXIT_SEMANTIC_ID: &str = "kernel.position.exit.v1";
    pub const HOLD_SEMANTIC_ID: &str = "kernel.position.hold.v1";
    pub const TARGET_POSITION_SEMANTIC_ID: &str = "kernel.target.position.v1";
    pub const TARGET_WEIGHT_SEMANTIC_ID: &str = "kernel.target.weight.v1";
    pub const TARGET_REBALANCE_SEMANTIC_ID: &str = "kernel.target.rebalance.v1";
    pub const STOP_LOSS_SEMANTIC_ID: &str = "kernel.protection.stop-loss.v1";
    pub const TAKE_PROFIT_SEMANTIC_ID: &str = "kernel.protection.take-profit.v1";
    pub const TRAILING_ADJUST_SEMANTIC_ID: &str = "kernel.protection.trailing-adjust.v1";
    pub const FILL_RECONCILE_SEMANTIC_ID: &str = "kernel.fill.reconcile.v1";

    pub const TIMER_RECORD: u32 = super::TIMER_RECORD;
    pub const ENVELOPE_CODEC_VERSION: u16 = 1;
    pub const ENVELOPE_WIRE_BYTES: usize = 128;
    pub const PROPOSAL_CODEC_VERSION: u16 = 1;
    pub const PROPOSAL_WIRE_BYTES: usize = 224;
    pub const TRACE_BYTES: usize = 320;
    pub const CHECKPOINT_TRACE_OFFSET: usize = 576;
    pub const CHECKPOINT_BYTES: usize = CHECKPOINT_TRACE_OFFSET + TRACE_BYTES;

    pub type Digest = [u8; 32];
    pub type StableIdentity = [u8; 16];

    const PROPOSAL_MAGIC: [u8; 4] = *b"SFP2";
    const ENVELOPE_MAGIC: [u8; 4] = *b"SFE2";
    const ENVELOPE_DIGEST_DOMAIN: &[u8] = b"strategy.lifecycle.envelope.v1\0";
    const PROPOSAL_DIGEST_DOMAIN: &[u8] = b"strategy.lifecycle.proposal.v1\0";
    // V1 originally emitted zeroes in this frozen header slot. Treating that exact
    // sentinel as magic makes decoding strict without changing historical bytes.
    const CHECKPOINT_MAGIC: [u8; 4] = [0; 4];

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    #[repr(u8)]
    pub enum LifecycleKind {
        Start = 1,
        Bar = 2,
        Event = 3,
        Fill = 4,
        Timer = 5,
        Stop = 6,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct EventOrderKeyV1 {
        pub logical_time_ns: u64,
        pub event_time_ns: u64,
        pub kind: LifecycleKind,
        pub owner_sequence: u64,
        pub event_identity: StableIdentity,
    }

    impl EventOrderKeyV1 {
        pub fn new(
            logical_time_ns: u64,
            event_time_ns: u64,
            kind: LifecycleKind,
            owner_sequence: u64,
            event_identity: StableIdentity,
        ) -> Result<Self, KernelFaultV1> {
            if owner_sequence == 0 || is_zero(&event_identity) {
                return Err(KernelFaultV1::MissingOrderCoordinate);
            }
            Ok(Self {
                logical_time_ns,
                event_time_ns,
                kind,
                owner_sequence,
                event_identity,
            })
        }

        fn compare(&self, other: &Self) -> Ordering {
            self.logical_time_ns
                .cmp(&other.logical_time_ns)
                .then_with(|| self.event_time_ns.cmp(&other.event_time_ns))
                .then_with(|| (self.kind as u8).cmp(&(other.kind as u8)))
                .then_with(|| self.owner_sequence.cmp(&other.owner_sequence))
                .then_with(|| self.event_identity.cmp(&other.event_identity))
        }

        fn validate(&self) -> Result<(), KernelFaultV1> {
            if self.owner_sequence == 0 || is_zero(&self.event_identity) {
                Err(KernelFaultV1::MissingOrderCoordinate)
            } else {
                Ok(())
            }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    #[repr(u8)]
    pub enum FillDispositionV1 {
        PartiallyFilled = 1,
        Filled = 2,
        Rejected = 3,
        Canceled = 4,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    #[repr(i8)]
    pub enum FillSideV1 {
        Sell = -1,
        Buy = 1,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct FillEventV1 {
        pub intent_identity: StableIdentity,
        pub side: FillSideV1,
        pub disposition: FillDispositionV1,
        pub cumulative_filled_units: u64,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum EnvelopePayloadV1 {
        Start,
        Bar,
        Event,
        Fill(FillEventV1),
        Timer,
        Stop,
    }

    impl EnvelopePayloadV1 {
        const fn kind(self) -> LifecycleKind {
            match self {
                Self::Start => LifecycleKind::Start,
                Self::Bar => LifecycleKind::Bar,
                Self::Event => LifecycleKind::Event,
                Self::Fill(_) => LifecycleKind::Fill,
                Self::Timer => LifecycleKind::Timer,
                Self::Stop => LifecycleKind::Stop,
            }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct LifecycleEnvelopeV1 {
        pub schema_version: u16,
        pub order_key: EventOrderKeyV1,
        /// Content address of the complete normalized envelope bytes.
        pub envelope_digest: Digest,
        pub payload: EnvelopePayloadV1,
    }

    impl LifecycleEnvelopeV1 {
        pub fn new(
            order_key: EventOrderKeyV1,
            envelope_digest: Digest,
            payload: EnvelopePayloadV1,
        ) -> Result<Self, KernelFaultV1> {
            let envelope = Self {
                schema_version: LIFECYCLE_SCHEMA_VERSION,
                order_key,
                envelope_digest,
                payload,
            };
            envelope.validate()?;
            Ok(envelope)
        }

        pub fn new_bound(
            order_key: EventOrderKeyV1,
            payload: EnvelopePayloadV1,
        ) -> Result<Self, KernelFaultV1> {
            let mut envelope = Self {
                schema_version: LIFECYCLE_SCHEMA_VERSION,
                order_key,
                envelope_digest: [0; 32],
                payload,
            };
            envelope.validate_structure()?;
            envelope.envelope_digest = derive_envelope_digest_v1(envelope)
                .map_err(|_| KernelFaultV1::MalformedEnvelope)?;
            Ok(envelope)
        }

        fn validate(&self) -> Result<(), KernelFaultV1> {
            self.validate_structure()?;
            let expected =
                derive_envelope_digest_v1(*self).map_err(|_| KernelFaultV1::MalformedEnvelope)?;
            if self.envelope_digest != expected {
                return Err(KernelFaultV1::MalformedEnvelope);
            }
            Ok(())
        }

        fn validate_structure(&self) -> Result<(), KernelFaultV1> {
            self.order_key.validate()?;
            if self.schema_version != LIFECYCLE_SCHEMA_VERSION
                || self.order_key.kind != self.payload.kind()
            {
                return Err(KernelFaultV1::MalformedEnvelope);
            }

            if let EnvelopePayloadV1::Fill(fill) = self.payload
                && is_zero(&fill.intent_identity)
            {
                return Err(KernelFaultV1::MalformedEnvelope);
            }
            Ok(())
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum EnvelopeCodecFaultV1 {
        InvalidLength,
        InvalidMagic,
        UnsupportedVersion,
        UnsupportedSchemaVersion,
        UnknownLifecycleKind,
        UnknownPayloadKind,
        KindPayloadMismatch,
        UnknownFillSide,
        UnknownFillDisposition,
        NonZeroReserved,
        MissingOrderCoordinate,
        MalformedEnvelope,
        DigestMismatch,
    }

    pub fn derive_envelope_digest_v1(
        mut envelope: LifecycleEnvelopeV1,
    ) -> Result<Digest, EnvelopeCodecFaultV1> {
        envelope.envelope_digest = [0; 32];
        let canonical = encode_envelope_fields_v1(envelope)?;
        Ok(sha256_parts(ENVELOPE_DIGEST_DOMAIN, &canonical))
    }

    pub fn encode_envelope_v1(
        envelope: LifecycleEnvelopeV1,
    ) -> Result<[u8; ENVELOPE_WIRE_BYTES], EnvelopeCodecFaultV1> {
        validate_wire_envelope(&envelope)?;
        encode_envelope_fields_v1(envelope)
    }

    fn encode_envelope_fields_v1(
        envelope: LifecycleEnvelopeV1,
    ) -> Result<[u8; ENVELOPE_WIRE_BYTES], EnvelopeCodecFaultV1> {
        validate_wire_envelope_structure(&envelope)?;
        let mut output = [0_u8; ENVELOPE_WIRE_BYTES];
        output[..4].copy_from_slice(&ENVELOPE_MAGIC);
        put_u16(&mut output, 4, ENVELOPE_CODEC_VERSION);
        put_u16(&mut output, 6, envelope.schema_version);
        output[8] = envelope.order_key.kind as u8;
        output[9] = envelope.payload.kind() as u8;
        put_u64(&mut output, 16, envelope.order_key.logical_time_ns);
        put_u64(&mut output, 24, envelope.order_key.event_time_ns);
        put_u64(&mut output, 32, envelope.order_key.owner_sequence);
        output[40..56].copy_from_slice(&envelope.order_key.event_identity);
        output[56..88].copy_from_slice(&envelope.envelope_digest);

        if let EnvelopePayloadV1::Fill(fill) = envelope.payload {
            output[88..104].copy_from_slice(&fill.intent_identity);
            output[104] = match fill.side {
                FillSideV1::Buy => 1,
                FillSideV1::Sell => 2,
            };
            output[105] = fill.disposition as u8;
            put_u64(&mut output, 112, fill.cumulative_filled_units);
        }

        Ok(output)
    }

    pub fn decode_envelope_v1(bytes: &[u8]) -> Result<LifecycleEnvelopeV1, EnvelopeCodecFaultV1> {
        if bytes.len() != ENVELOPE_WIRE_BYTES {
            return Err(EnvelopeCodecFaultV1::InvalidLength);
        }

        if bytes[..4] != ENVELOPE_MAGIC {
            return Err(EnvelopeCodecFaultV1::InvalidMagic);
        }

        if envelope_read_u16(bytes, 4)? != ENVELOPE_CODEC_VERSION {
            return Err(EnvelopeCodecFaultV1::UnsupportedVersion);
        }
        let schema_version = envelope_read_u16(bytes, 6)?;
        if schema_version != LIFECYCLE_SCHEMA_VERSION {
            return Err(EnvelopeCodecFaultV1::UnsupportedSchemaVersion);
        }
        require_envelope_zero(&bytes[10..16])?;
        require_envelope_zero(&bytes[120..128])?;

        let kind =
            decode_lifecycle_kind(bytes[8]).ok_or(EnvelopeCodecFaultV1::UnknownLifecycleKind)?;
        let payload_kind =
            decode_lifecycle_kind(bytes[9]).ok_or(EnvelopeCodecFaultV1::UnknownPayloadKind)?;
        if kind != payload_kind {
            return Err(EnvelopeCodecFaultV1::KindPayloadMismatch);
        }

        let payload = match payload_kind {
            LifecycleKind::Start => {
                require_envelope_zero(&bytes[88..120])?;
                EnvelopePayloadV1::Start
            }
            LifecycleKind::Bar => {
                require_envelope_zero(&bytes[88..120])?;
                EnvelopePayloadV1::Bar
            }
            LifecycleKind::Event => {
                require_envelope_zero(&bytes[88..120])?;
                EnvelopePayloadV1::Event
            }
            LifecycleKind::Fill => {
                require_envelope_zero(&bytes[106..112])?;
                EnvelopePayloadV1::Fill(FillEventV1 {
                    intent_identity: envelope_read(bytes, 88)?,
                    side: match bytes[104] {
                        1 => FillSideV1::Buy,
                        2 => FillSideV1::Sell,
                        _ => return Err(EnvelopeCodecFaultV1::UnknownFillSide),
                    },
                    disposition: match bytes[105] {
                        1 => FillDispositionV1::PartiallyFilled,
                        2 => FillDispositionV1::Filled,
                        3 => FillDispositionV1::Rejected,
                        4 => FillDispositionV1::Canceled,
                        _ => return Err(EnvelopeCodecFaultV1::UnknownFillDisposition),
                    },
                    cumulative_filled_units: envelope_read_u64(bytes, 112)?,
                })
            }
            LifecycleKind::Timer => {
                require_envelope_zero(&bytes[88..120])?;
                EnvelopePayloadV1::Timer
            }
            LifecycleKind::Stop => {
                require_envelope_zero(&bytes[88..120])?;
                EnvelopePayloadV1::Stop
            }
        };
        let envelope = LifecycleEnvelopeV1 {
            schema_version,
            order_key: EventOrderKeyV1 {
                logical_time_ns: envelope_read_u64(bytes, 16)?,
                event_time_ns: envelope_read_u64(bytes, 24)?,
                kind,
                owner_sequence: envelope_read_u64(bytes, 32)?,
                event_identity: envelope_read(bytes, 40)?,
            },
            envelope_digest: envelope_read(bytes, 56)?,
            payload,
        };
        validate_wire_envelope(&envelope)?;
        Ok(envelope)
    }

    const fn decode_lifecycle_kind(value: u8) -> Option<LifecycleKind> {
        match value {
            1 => Some(LifecycleKind::Start),
            2 => Some(LifecycleKind::Bar),
            3 => Some(LifecycleKind::Event),
            4 => Some(LifecycleKind::Fill),
            5 => Some(LifecycleKind::Timer),
            6 => Some(LifecycleKind::Stop),
            _ => None,
        }
    }

    fn validate_wire_envelope(envelope: &LifecycleEnvelopeV1) -> Result<(), EnvelopeCodecFaultV1> {
        validate_wire_envelope_structure(envelope)?;
        if derive_envelope_digest_v1(*envelope)? != envelope.envelope_digest {
            return Err(EnvelopeCodecFaultV1::DigestMismatch);
        }
        Ok(())
    }

    fn validate_wire_envelope_structure(
        envelope: &LifecycleEnvelopeV1,
    ) -> Result<(), EnvelopeCodecFaultV1> {
        if envelope.schema_version != LIFECYCLE_SCHEMA_VERSION {
            return Err(EnvelopeCodecFaultV1::UnsupportedSchemaVersion);
        }

        envelope.validate_structure().map_err(|fault| match fault {
            KernelFaultV1::MissingOrderCoordinate => EnvelopeCodecFaultV1::MissingOrderCoordinate,
            _ => EnvelopeCodecFaultV1::MalformedEnvelope,
        })
    }

    fn require_envelope_zero(bytes: &[u8]) -> Result<(), EnvelopeCodecFaultV1> {
        if bytes.iter().any(|byte| *byte != 0) {
            Err(EnvelopeCodecFaultV1::NonZeroReserved)
        } else {
            Ok(())
        }
    }

    fn envelope_read<const N: usize>(
        bytes: &[u8],
        offset: usize,
    ) -> Result<[u8; N], EnvelopeCodecFaultV1> {
        bytes
            .get(offset..offset + N)
            .and_then(|value| value.try_into().ok())
            .ok_or(EnvelopeCodecFaultV1::InvalidLength)
    }

    fn envelope_read_u16(bytes: &[u8], offset: usize) -> Result<u16, EnvelopeCodecFaultV1> {
        Ok(u16::from_le_bytes(envelope_read(bytes, offset)?))
    }

    fn envelope_read_u64(bytes: &[u8], offset: usize) -> Result<u64, EnvelopeCodecFaultV1> {
        Ok(u64::from_le_bytes(envelope_read(bytes, offset)?))
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    #[repr(u8)]
    pub enum PositionIntentV1 {
        Hold = 1,
        Enter = 2,
        Add = 3,
        Reduce = 4,
        Exit = 5,
    }

    impl PositionIntentV1 {
        pub const fn semantic_id(self) -> &'static str {
            match self {
                Self::Hold => HOLD_SEMANTIC_ID,
                Self::Enter => ENTER_SEMANTIC_ID,
                Self::Add => ADD_SEMANTIC_ID,
                Self::Reduce => REDUCE_SEMANTIC_ID,
                Self::Exit => EXIT_SEMANTIC_ID,
            }
        }
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    #[repr(u8)]
    pub enum TargetSemanticV1 {
        #[default]
        None = 0,
        Position = 1,
        Weight = 2,
        Rebalance = 3,
    }

    impl TargetSemanticV1 {
        pub const fn semantic_id(self) -> Option<&'static str> {
            match self {
                Self::None => None,
                Self::Position => Some(TARGET_POSITION_SEMANTIC_ID),
                Self::Weight => Some(TARGET_WEIGHT_SEMANTIC_ID),
                Self::Rebalance => Some(TARGET_REBALANCE_SEMANTIC_ID),
            }
        }
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct ProtectionSemanticSetV1(u8);

    impl ProtectionSemanticSetV1 {
        pub const STOP_LOSS: u8 = 1;
        pub const TAKE_PROFIT: u8 = 2;
        pub const TRAILING_ADJUST: u8 = 4;

        pub const fn contains(self, semantic: u8) -> bool {
            self.0 & semantic != 0
        }

        pub const fn bits(self) -> u8 {
            self.0
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum TargetProposalV1 {
        Keep,
        Position(i64),
        WeightMicros(i32),
        RebalancePosition { sequence: u64, units: i64 },
        RebalanceWeightMicros { sequence: u64, weight_micros: i32 },
    }

    impl TargetProposalV1 {
        pub const fn semantic_id(self) -> Option<&'static str> {
            match self {
                Self::Keep => None,
                Self::Position(_) => Some(TARGET_POSITION_SEMANTIC_ID),
                Self::WeightMicros(_) => Some(TARGET_WEIGHT_SEMANTIC_ID),
                Self::RebalancePosition { .. } | Self::RebalanceWeightMicros { .. } => {
                    Some(TARGET_REBALANCE_SEMANTIC_ID)
                }
            }
        }
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct ProtectionStateV1 {
        pub stop_loss_ticks: Option<i64>,
        pub take_profit_ticks: Option<i64>,
        pub trailing_distance_ticks: Option<u64>,
        pub trailing_stop_ticks: Option<i64>,
    }

    impl ProtectionStateV1 {
        fn validate(&self) -> Result<(), KernelFaultV1> {
            if self.stop_loss_ticks.is_some_and(|value| value <= 0)
                || self.take_profit_ticks.is_some_and(|value| value <= 0)
                || self.trailing_stop_ticks.is_some_and(|value| value <= 0)
                || self.trailing_distance_ticks == Some(0)
                || self.trailing_distance_ticks.is_some() != self.trailing_stop_ticks.is_some()
            {
                Err(KernelFaultV1::InvalidProtection)
            } else {
                Ok(())
            }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum ProtectionProposalV1 {
        Keep,
        Replace(ProtectionStateV1),
        AdjustTrailing { stop_ticks: i64 },
        Clear,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct ProposalV1 {
        /// Stable semantic-intent identity. This is not an order handle.
        pub intent_identity: StableIdentity,
        /// Content address of the typed proposal and producing strategy/plugin state.
        pub proposal_digest: Digest,
        pub position: PositionIntentV1,
        pub target: TargetProposalV1,
        /// Position-unit realization used solely for lifecycle validation and fill reconciliation.
        /// Position targets must match it; weight targets keep their own semantic value alongside it.
        pub reconciliation_target_units: Option<i64>,
        pub protection: ProtectionProposalV1,
        pub strategy_state_digest: Digest,
        pub plugin_state_digest: Digest,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum ProposalCodecFaultV1 {
        InvalidLength,
        InvalidMagic,
        UnsupportedVersion,
        UnknownPositionIntent,
        UnknownTarget,
        UnknownProtection,
        NonZeroReserved,
        NonCanonicalOption,
        TargetOutOfRange,
        IncompleteHostIdentity,
        DigestMismatch,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum GuestProposalFaultV1 {
        Codec(ProposalCodecFaultV1),
        NonZeroIntentIdentity,
        NonZeroProposalDigest,
        NonZeroStrategyStateDigest,
        NonZeroPluginStateDigest,
        NonCanonicalEncoding,
    }

    /// Guest-authored decision fields before ProgramHost binds authoritative identities.
    ///
    /// This type cannot be passed to the lifecycle kernel directly.
    ///
    /// ```compile_fail
    /// use strategy_factory_program_sdk::lifecycle_v1::{ProposalV1, UnsealedGuestProposalV1};
    /// fn kernel_input(_: ProposalV1) {}
    /// fn rejected(value: UnsealedGuestProposalV1) {
    ///     kernel_input(value);
    /// }
    /// ```
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct UnsealedGuestProposalV1 {
        position: PositionIntentV1,
        target: TargetProposalV1,
        reconciliation_target_units: Option<i64>,
        protection: ProtectionProposalV1,
    }

    impl UnsealedGuestProposalV1 {
        pub fn new(
            position: PositionIntentV1,
            target: TargetProposalV1,
            reconciliation_target_units: Option<i64>,
            protection: ProtectionProposalV1,
        ) -> Result<Self, ProposalCodecFaultV1> {
            if !target_in_canonical_domain(target) {
                return Err(ProposalCodecFaultV1::TargetOutOfRange);
            }

            Ok(Self {
                position,
                target,
                reconciliation_target_units,
                protection,
            })
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct HostProposalSealV1 {
        pub intent_identity: StableIdentity,
        pub proposal_digest: Digest,
        pub strategy_state_digest: Digest,
        pub plugin_state_digest: Digest,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum HostProposalSealFaultV1 {
        MissingIntentIdentity,
        MissingProposalDigest,
        MissingStrategyStateDigest,
        MissingPluginStateDigest,
        ProposalDigestMismatch,
    }

    pub fn derive_proposal_digest_v1(
        mut proposal: ProposalV1,
    ) -> Result<Digest, ProposalCodecFaultV1> {
        proposal.proposal_digest = [0; 32];
        let canonical = encode_proposal_fields_v1(proposal)?;
        Ok(sha256_parts(PROPOSAL_DIGEST_DOMAIN, &canonical))
    }

    pub fn encode_proposal_v1(
        proposal: ProposalV1,
    ) -> Result<[u8; PROPOSAL_WIRE_BYTES], ProposalCodecFaultV1> {
        validate_proposal_identity(&proposal)?;
        encode_proposal_fields_v1(proposal)
    }

    fn encode_proposal_fields_v1(
        proposal: ProposalV1,
    ) -> Result<[u8; PROPOSAL_WIRE_BYTES], ProposalCodecFaultV1> {
        if !target_in_canonical_domain(proposal.target) {
            return Err(ProposalCodecFaultV1::TargetOutOfRange);
        }

        let mut output = [0_u8; PROPOSAL_WIRE_BYTES];
        output[..4].copy_from_slice(&PROPOSAL_MAGIC);
        put_u16(&mut output, 4, PROPOSAL_CODEC_VERSION);
        output[6] = proposal.position as u8;
        output[7] = match proposal.target {
            TargetProposalV1::Keep => 0,
            TargetProposalV1::Position(_) => 1,
            TargetProposalV1::WeightMicros(_) => 2,
            TargetProposalV1::RebalancePosition { .. } => 3,
            TargetProposalV1::RebalanceWeightMicros { .. } => 4,
        };
        output[8] = match proposal.protection {
            ProtectionProposalV1::Keep => 0,
            ProtectionProposalV1::Replace(_) => 1,
            ProtectionProposalV1::AdjustTrailing { .. } => 2,
            ProtectionProposalV1::Clear => 3,
        };
        output[16..32].copy_from_slice(&proposal.intent_identity);
        output[32..64].copy_from_slice(&proposal.proposal_digest);
        output[64..96].copy_from_slice(&proposal.strategy_state_digest);
        output[96..128].copy_from_slice(&proposal.plugin_state_digest);

        match proposal.target {
            TargetProposalV1::Keep => {}
            TargetProposalV1::Position(units) => put_i64(&mut output, 128, units),
            TargetProposalV1::WeightMicros(weight) => {
                output[128..132].copy_from_slice(&weight.to_le_bytes());
            }
            TargetProposalV1::RebalancePosition { sequence, units } => {
                put_u64(&mut output, 128, sequence);
                put_i64(&mut output, 136, units);
            }
            TargetProposalV1::RebalanceWeightMicros {
                sequence,
                weight_micros,
            } => {
                put_u64(&mut output, 128, sequence);
                output[136..140].copy_from_slice(&weight_micros.to_le_bytes());
            }
        }

        if let Some(units) = proposal.reconciliation_target_units {
            output[9] = 1;
            put_i64(&mut output, 152, units);
        }

        match proposal.protection {
            ProtectionProposalV1::Keep | ProtectionProposalV1::Clear => {}
            ProtectionProposalV1::Replace(protection) => {
                encode_wire_option_i64(&mut output, 168, 176, protection.stop_loss_ticks);
                encode_wire_option_i64(&mut output, 169, 184, protection.take_profit_ticks);
                encode_wire_option_u64(&mut output, 170, 192, protection.trailing_distance_ticks);
                encode_wire_option_i64(&mut output, 171, 200, protection.trailing_stop_ticks);
            }
            ProtectionProposalV1::AdjustTrailing { stop_ticks } => {
                put_i64(&mut output, 176, stop_ticks);
            }
        }

        Ok(output)
    }

    pub fn decode_proposal_v1(bytes: &[u8]) -> Result<ProposalV1, ProposalCodecFaultV1> {
        if bytes.len() != PROPOSAL_WIRE_BYTES {
            return Err(ProposalCodecFaultV1::InvalidLength);
        }

        if bytes[..4] != PROPOSAL_MAGIC {
            return Err(ProposalCodecFaultV1::InvalidMagic);
        }

        if codec_read_u16(bytes, 4)? != PROPOSAL_CODEC_VERSION {
            return Err(ProposalCodecFaultV1::UnsupportedVersion);
        }
        require_wire_zero(&bytes[10..16])?;
        require_wire_zero(&bytes[216..224])?;

        let position = match bytes[6] {
            1 => PositionIntentV1::Hold,
            2 => PositionIntentV1::Enter,
            3 => PositionIntentV1::Add,
            4 => PositionIntentV1::Reduce,
            5 => PositionIntentV1::Exit,
            _ => return Err(ProposalCodecFaultV1::UnknownPositionIntent),
        };
        let target = decode_wire_target(bytes)?;
        let reconciliation_target_units = decode_wire_option_i64(bytes, 9, 152)?;
        require_wire_zero(&bytes[160..168])?;
        let protection = decode_wire_protection(bytes)?;

        let proposal = ProposalV1 {
            intent_identity: codec_read(bytes, 16)?,
            proposal_digest: codec_read(bytes, 32)?,
            position,
            target,
            reconciliation_target_units,
            protection,
            strategy_state_digest: codec_read(bytes, 64)?,
            plugin_state_digest: codec_read(bytes, 96)?,
        };

        if !target_in_canonical_domain(proposal.target) {
            return Err(ProposalCodecFaultV1::TargetOutOfRange);
        }
        validate_proposal_identity(&proposal)?;

        Ok(proposal)
    }

    pub fn encode_guest_proposal_v1(
        proposal: UnsealedGuestProposalV1,
    ) -> Result<[u8; PROPOSAL_WIRE_BYTES], ProposalCodecFaultV1> {
        encode_proposal_v1(ProposalV1 {
            intent_identity: [0; 16],
            proposal_digest: [0; 32],
            position: proposal.position,
            target: proposal.target,
            reconciliation_target_units: proposal.reconciliation_target_units,
            protection: proposal.protection,
            strategy_state_digest: [0; 32],
            plugin_state_digest: [0; 32],
        })
    }

    pub fn decode_guest_proposal_v1(
        bytes: &[u8],
    ) -> Result<UnsealedGuestProposalV1, GuestProposalFaultV1> {
        if bytes.len() != PROPOSAL_WIRE_BYTES {
            return Err(GuestProposalFaultV1::Codec(
                ProposalCodecFaultV1::InvalidLength,
            ));
        }

        if bytes[16..32].iter().any(|byte| *byte != 0) {
            return Err(GuestProposalFaultV1::NonZeroIntentIdentity);
        }

        if bytes[32..64].iter().any(|byte| *byte != 0) {
            return Err(GuestProposalFaultV1::NonZeroProposalDigest);
        }

        if bytes[64..96].iter().any(|byte| *byte != 0) {
            return Err(GuestProposalFaultV1::NonZeroStrategyStateDigest);
        }

        if bytes[96..128].iter().any(|byte| *byte != 0) {
            return Err(GuestProposalFaultV1::NonZeroPluginStateDigest);
        }

        let proposal = decode_proposal_v1(bytes).map_err(GuestProposalFaultV1::Codec)?;
        let canonical = encode_proposal_v1(proposal).map_err(GuestProposalFaultV1::Codec)?;
        if canonical.as_slice() != bytes {
            return Err(GuestProposalFaultV1::NonCanonicalEncoding);
        }

        UnsealedGuestProposalV1::new(
            proposal.position,
            proposal.target,
            proposal.reconciliation_target_units,
            proposal.protection,
        )
        .map_err(GuestProposalFaultV1::Codec)
    }

    /// Binds ProgramHost-owned identities after guest bytes have passed the untrusted-output gate.
    pub fn seal_guest_proposal_v1(
        proposal: UnsealedGuestProposalV1,
        seal: HostProposalSealV1,
    ) -> Result<ProposalV1, HostProposalSealFaultV1> {
        if is_zero(&seal.intent_identity) {
            return Err(HostProposalSealFaultV1::MissingIntentIdentity);
        }

        if is_zero(&seal.proposal_digest) {
            return Err(HostProposalSealFaultV1::MissingProposalDigest);
        }

        if is_zero(&seal.strategy_state_digest) {
            return Err(HostProposalSealFaultV1::MissingStrategyStateDigest);
        }

        if is_zero(&seal.plugin_state_digest) {
            return Err(HostProposalSealFaultV1::MissingPluginStateDigest);
        }

        let sealed = ProposalV1 {
            intent_identity: seal.intent_identity,
            proposal_digest: seal.proposal_digest,
            position: proposal.position,
            target: proposal.target,
            reconciliation_target_units: proposal.reconciliation_target_units,
            protection: proposal.protection,
            strategy_state_digest: seal.strategy_state_digest,
            plugin_state_digest: seal.plugin_state_digest,
        };

        if derive_proposal_digest_v1(sealed)
            .map_err(|_| HostProposalSealFaultV1::ProposalDigestMismatch)?
            != seal.proposal_digest
        {
            return Err(HostProposalSealFaultV1::ProposalDigestMismatch);
        }
        Ok(sealed)
    }

    pub fn seal_guest_proposal_with_derived_digest_v1(
        proposal: UnsealedGuestProposalV1,
        intent_identity: StableIdentity,
        strategy_state_digest: Digest,
        plugin_state_digest: Digest,
    ) -> Result<ProposalV1, HostProposalSealFaultV1> {
        if is_zero(&intent_identity) {
            return Err(HostProposalSealFaultV1::MissingIntentIdentity);
        }

        if is_zero(&strategy_state_digest) {
            return Err(HostProposalSealFaultV1::MissingStrategyStateDigest);
        }

        if is_zero(&plugin_state_digest) {
            return Err(HostProposalSealFaultV1::MissingPluginStateDigest);
        }
        let mut sealed = ProposalV1 {
            intent_identity,
            proposal_digest: [0; 32],
            position: proposal.position,
            target: proposal.target,
            reconciliation_target_units: proposal.reconciliation_target_units,
            protection: proposal.protection,
            strategy_state_digest,
            plugin_state_digest,
        };
        sealed.proposal_digest = derive_proposal_digest_v1(sealed)
            .map_err(|_| HostProposalSealFaultV1::ProposalDigestMismatch)?;
        Ok(sealed)
    }

    fn validate_proposal_identity(proposal: &ProposalV1) -> Result<(), ProposalCodecFaultV1> {
        let slots_zero = [
            is_zero(&proposal.intent_identity),
            is_zero(&proposal.proposal_digest),
            is_zero(&proposal.strategy_state_digest),
            is_zero(&proposal.plugin_state_digest),
        ];

        if slots_zero.iter().all(|slot| *slot) {
            return Ok(());
        }

        if slots_zero.iter().any(|slot| *slot) {
            return Err(ProposalCodecFaultV1::IncompleteHostIdentity);
        }

        if derive_proposal_digest_v1(*proposal)? != proposal.proposal_digest {
            return Err(ProposalCodecFaultV1::DigestMismatch);
        }
        Ok(())
    }

    fn decode_wire_target(bytes: &[u8]) -> Result<TargetProposalV1, ProposalCodecFaultV1> {
        match bytes[7] {
            0 => {
                require_wire_zero(&bytes[128..152])?;
                Ok(TargetProposalV1::Keep)
            }
            1 => {
                require_wire_zero(&bytes[136..152])?;
                Ok(TargetProposalV1::Position(codec_read_i64(bytes, 128)?))
            }
            2 => {
                require_wire_zero(&bytes[132..152])?;
                Ok(TargetProposalV1::WeightMicros(codec_read_i32(bytes, 128)?))
            }
            3 => {
                require_wire_zero(&bytes[144..152])?;
                Ok(TargetProposalV1::RebalancePosition {
                    sequence: codec_read_u64(bytes, 128)?,
                    units: codec_read_i64(bytes, 136)?,
                })
            }
            4 => {
                require_wire_zero(&bytes[140..152])?;
                Ok(TargetProposalV1::RebalanceWeightMicros {
                    sequence: codec_read_u64(bytes, 128)?,
                    weight_micros: codec_read_i32(bytes, 136)?,
                })
            }
            _ => Err(ProposalCodecFaultV1::UnknownTarget),
        }
    }

    fn decode_wire_protection(bytes: &[u8]) -> Result<ProtectionProposalV1, ProposalCodecFaultV1> {
        match bytes[8] {
            0 => {
                require_wire_zero(&bytes[168..216])?;
                Ok(ProtectionProposalV1::Keep)
            }
            1 => {
                require_wire_zero(&bytes[172..176])?;
                require_wire_zero(&bytes[208..216])?;
                Ok(ProtectionProposalV1::Replace(ProtectionStateV1 {
                    stop_loss_ticks: decode_wire_option_i64(bytes, 168, 176)?,
                    take_profit_ticks: decode_wire_option_i64(bytes, 169, 184)?,
                    trailing_distance_ticks: decode_wire_option_u64(bytes, 170, 192)?,
                    trailing_stop_ticks: decode_wire_option_i64(bytes, 171, 200)?,
                }))
            }
            2 => {
                require_wire_zero(&bytes[168..176])?;
                require_wire_zero(&bytes[184..216])?;
                Ok(ProtectionProposalV1::AdjustTrailing {
                    stop_ticks: codec_read_i64(bytes, 176)?,
                })
            }
            3 => {
                require_wire_zero(&bytes[168..216])?;
                Ok(ProtectionProposalV1::Clear)
            }
            _ => Err(ProposalCodecFaultV1::UnknownProtection),
        }
    }

    fn encode_wire_option_i64(
        output: &mut [u8],
        tag_offset: usize,
        value_offset: usize,
        value: Option<i64>,
    ) {
        if let Some(value) = value {
            output[tag_offset] = 1;
            put_i64(output, value_offset, value);
        }
    }

    fn encode_wire_option_u64(
        output: &mut [u8],
        tag_offset: usize,
        value_offset: usize,
        value: Option<u64>,
    ) {
        if let Some(value) = value {
            output[tag_offset] = 1;
            put_u64(output, value_offset, value);
        }
    }

    fn decode_wire_option_i64(
        bytes: &[u8],
        tag_offset: usize,
        value_offset: usize,
    ) -> Result<Option<i64>, ProposalCodecFaultV1> {
        match bytes[tag_offset] {
            0 => {
                require_wire_zero(&bytes[value_offset..value_offset + 8])?;
                Ok(None)
            }
            1 => Ok(Some(codec_read_i64(bytes, value_offset)?)),
            _ => Err(ProposalCodecFaultV1::NonCanonicalOption),
        }
    }

    fn decode_wire_option_u64(
        bytes: &[u8],
        tag_offset: usize,
        value_offset: usize,
    ) -> Result<Option<u64>, ProposalCodecFaultV1> {
        match bytes[tag_offset] {
            0 => {
                require_wire_zero(&bytes[value_offset..value_offset + 8])?;
                Ok(None)
            }
            1 => Ok(Some(codec_read_u64(bytes, value_offset)?)),
            _ => Err(ProposalCodecFaultV1::NonCanonicalOption),
        }
    }

    fn require_wire_zero(bytes: &[u8]) -> Result<(), ProposalCodecFaultV1> {
        if bytes.iter().any(|byte| *byte != 0) {
            Err(ProposalCodecFaultV1::NonZeroReserved)
        } else {
            Ok(())
        }
    }

    fn codec_read<const N: usize>(
        bytes: &[u8],
        offset: usize,
    ) -> Result<[u8; N], ProposalCodecFaultV1> {
        bytes
            .get(offset..offset + N)
            .and_then(|value| value.try_into().ok())
            .ok_or(ProposalCodecFaultV1::InvalidLength)
    }

    fn codec_read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProposalCodecFaultV1> {
        Ok(u16::from_le_bytes(codec_read(bytes, offset)?))
    }

    fn codec_read_i32(bytes: &[u8], offset: usize) -> Result<i32, ProposalCodecFaultV1> {
        Ok(i32::from_le_bytes(codec_read(bytes, offset)?))
    }

    fn codec_read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProposalCodecFaultV1> {
        Ok(u64::from_le_bytes(codec_read(bytes, offset)?))
    }

    fn codec_read_i64(bytes: &[u8], offset: usize) -> Result<i64, ProposalCodecFaultV1> {
        Ok(i64::from_le_bytes(codec_read(bytes, offset)?))
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct KernelIdentitiesV1 {
        pub design_digest: Digest,
        pub plan_digest: Digest,
        pub artifact_digest: Digest,
        pub program_host_digest: Digest,
        pub kernel_digest: Digest,
        pub plugin_digest: Digest,
        pub market_semantics_digest: Digest,
    }

    impl KernelIdentitiesV1 {
        fn validate(&self) -> Result<(), KernelFaultV1> {
            let identities = [
                self.design_digest,
                self.plan_digest,
                self.artifact_digest,
                self.program_host_digest,
                self.kernel_digest,
                self.plugin_digest,
                self.market_semantics_digest,
            ];

            if identities.iter().any(is_zero) {
                Err(KernelFaultV1::IdentityMismatch)
            } else {
                Ok(())
            }
        }
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub enum TargetStateV1 {
        #[default]
        None,
        Position(i64),
        WeightMicros(i32),
        RebalancePosition {
            sequence: u64,
            units: i64,
        },
        RebalanceWeightMicros {
            sequence: u64,
            weight_micros: i32,
        },
    }

    impl From<TargetProposalV1> for TargetStateV1 {
        fn from(value: TargetProposalV1) -> Self {
            match value {
                TargetProposalV1::Keep => Self::None,
                TargetProposalV1::Position(units) => Self::Position(units),
                TargetProposalV1::WeightMicros(weight) => Self::WeightMicros(weight),
                TargetProposalV1::RebalancePosition { sequence, units } => {
                    Self::RebalancePosition { sequence, units }
                }
                TargetProposalV1::RebalanceWeightMicros {
                    sequence,
                    weight_micros,
                } => Self::RebalanceWeightMicros {
                    sequence,
                    weight_micros,
                },
            }
        }
    }

    #[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
    pub struct FillFrontierV1 {
        pub intent_identity: StableIdentity,
        pub cumulative_filled_units: u64,
        pub terminal_disposition: Option<FillDispositionV1>,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct PendingIntentV1 {
        pub intent_identity: StableIdentity,
        pub side: FillSideV1,
        pub expected_units: u64,
        pub cumulative_filled_units: u64,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct CheckpointV1 {
        pub schema_version: u16,
        pub identities: KernelIdentitiesV1,
        pub last_order_key: Option<EventOrderKeyV1>,
        pub last_envelope_digest: Digest,
        pub last_proposal_digest: Digest,
        pub strategy_state_digest: Digest,
        pub plugin_state_digest: Digest,
        pub target: TargetStateV1,
        pub protection: ProtectionStateV1,
        pub reconciled_position_units: i64,
        pub fill_frontier: FillFrontierV1,
        pub pending_intent: Option<PendingIntentV1>,
        pub stopped: bool,
        pub last_trace: SemanticTraceV1,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum CheckpointCodecFaultV1 {
        InvalidLength,
        InvalidMagic,
        UnsupportedVersion,
        UnsupportedTraceVersion,
        NonZeroReserved,
        NonCanonicalOption,
        UnknownLifecycleKind,
        UnknownPositionIntent,
        UnknownTargetSemantic,
        InvalidProtectionSemantics,
        UnknownTarget,
        UnknownFillDisposition,
        UnknownFillSide,
        InvalidCheckpoint,
        NonCanonicalEncoding,
    }

    impl CheckpointV1 {
        pub fn encode(self) -> [u8; CHECKPOINT_BYTES] {
            let mut output = [0_u8; CHECKPOINT_BYTES];
            put_u16(&mut output, 0, self.schema_version);
            output[2..6].copy_from_slice(&CHECKPOINT_MAGIC);
            let mut cursor = 8;

            for digest in [
                self.identities.design_digest,
                self.identities.plan_digest,
                self.identities.artifact_digest,
                self.identities.program_host_digest,
                self.identities.kernel_digest,
                self.identities.plugin_digest,
                self.identities.market_semantics_digest,
            ] {
                output[cursor..cursor + 32].copy_from_slice(&digest);
                cursor += 32;
            }
            encode_order_key(&mut output[cursor..cursor + 48], self.last_order_key);
            cursor += 48;
            output[cursor..cursor + 32].copy_from_slice(&self.last_envelope_digest);
            cursor += 32;
            output[cursor..cursor + 32].copy_from_slice(&self.last_proposal_digest);
            cursor += 32;
            output[cursor..cursor + 32].copy_from_slice(&self.strategy_state_digest);
            cursor += 32;
            output[cursor..cursor + 32].copy_from_slice(&self.plugin_state_digest);
            cursor += 32;
            encode_target(&mut output[cursor..cursor + 32], self.target);
            cursor += 32;
            encode_protection(&mut output[cursor..cursor + 40], self.protection);
            cursor += 40;
            put_i64(&mut output, cursor, self.reconciled_position_units);
            cursor += 8;
            encode_fill_frontier(&mut output[cursor..cursor + 32], self.fill_frontier);
            cursor += 32;
            encode_pending(&mut output[cursor..cursor + 40], self.pending_intent);
            cursor += 40;
            output[cursor] = u8::from(self.stopped);
            output[CHECKPOINT_TRACE_OFFSET..].copy_from_slice(&self.last_trace.encode());
            output
        }

        pub fn decode(bytes: &[u8]) -> Result<Self, CheckpointCodecFaultV1> {
            if bytes.len() != CHECKPOINT_BYTES {
                return Err(CheckpointCodecFaultV1::InvalidLength);
            }

            if bytes[2..6] != CHECKPOINT_MAGIC {
                return Err(CheckpointCodecFaultV1::InvalidMagic);
            }

            if checkpoint_read_u16(bytes, 0)? != CHECKPOINT_SCHEMA_VERSION {
                return Err(CheckpointCodecFaultV1::UnsupportedVersion);
            }
            require_checkpoint_zero(&bytes[6..8])?;

            let checkpoint = Self {
                schema_version: CHECKPOINT_SCHEMA_VERSION,
                identities: KernelIdentitiesV1 {
                    design_digest: checkpoint_read(bytes, 8)?,
                    plan_digest: checkpoint_read(bytes, 40)?,
                    artifact_digest: checkpoint_read(bytes, 72)?,
                    program_host_digest: checkpoint_read(bytes, 104)?,
                    kernel_digest: checkpoint_read(bytes, 136)?,
                    plugin_digest: checkpoint_read(bytes, 168)?,
                    market_semantics_digest: checkpoint_read(bytes, 200)?,
                },
                last_order_key: decode_checkpoint_order_key(&bytes[232..280])?,
                last_envelope_digest: checkpoint_read(bytes, 280)?,
                last_proposal_digest: checkpoint_read(bytes, 312)?,
                strategy_state_digest: checkpoint_read(bytes, 344)?,
                plugin_state_digest: checkpoint_read(bytes, 376)?,
                target: decode_checkpoint_target(&bytes[408..440])?,
                protection: decode_checkpoint_protection(&bytes[440..480])?,
                reconciled_position_units: checkpoint_read_i64(bytes, 480)?,
                fill_frontier: decode_checkpoint_fill_frontier(&bytes[488..520])?,
                pending_intent: decode_checkpoint_pending(&bytes[520..560])?,
                stopped: match bytes[560] {
                    0 => false,
                    1 => true,
                    _ => return Err(CheckpointCodecFaultV1::NonCanonicalOption),
                },
                last_trace: decode_checkpoint_trace(&bytes[CHECKPOINT_TRACE_OFFSET..])?,
            };
            require_checkpoint_zero(&bytes[561..CHECKPOINT_TRACE_OFFSET])?;
            validate_checkpoint(&checkpoint)
                .map_err(|_| CheckpointCodecFaultV1::InvalidCheckpoint)?;
            if checkpoint.encode().as_slice() != bytes {
                return Err(CheckpointCodecFaultV1::NonCanonicalEncoding);
            }
            Ok(checkpoint)
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct SemanticTraceV1 {
        pub schema_version: u16,
        pub order_key: Option<EventOrderKeyV1>,
        pub envelope_digest: Digest,
        pub proposal_digest: Digest,
        pub position_intent: PositionIntentV1,
        pub target_semantic: TargetSemanticV1,
        pub protection_semantics: ProtectionSemanticSetV1,
        pub target: TargetStateV1,
        pub protection: ProtectionStateV1,
        pub fill_disposition: Option<FillDispositionV1>,
        pub position_before_units: i64,
        pub position_after_units: i64,
        pub fill_frontier: FillFrontierV1,
        pub strategy_state_digest: Digest,
        pub plugin_state_digest: Digest,
    }

    impl Default for SemanticTraceV1 {
        fn default() -> Self {
            Self {
                schema_version: TRACE_SCHEMA_VERSION,
                order_key: None,
                envelope_digest: [0; 32],
                proposal_digest: [0; 32],
                position_intent: PositionIntentV1::Hold,
                target_semantic: TargetSemanticV1::None,
                protection_semantics: ProtectionSemanticSetV1::default(),
                target: TargetStateV1::None,
                protection: ProtectionStateV1::default(),
                fill_disposition: None,
                position_before_units: 0,
                position_after_units: 0,
                fill_frontier: FillFrontierV1::default(),
                strategy_state_digest: [0; 32],
                plugin_state_digest: [0; 32],
            }
        }
    }

    impl SemanticTraceV1 {
        pub fn encode(self) -> [u8; TRACE_BYTES] {
            let mut output = [0_u8; TRACE_BYTES];
            put_u16(&mut output, 0, self.schema_version);
            encode_order_key(&mut output[8..56], self.order_key);
            output[56..88].copy_from_slice(&self.envelope_digest);
            output[88..120].copy_from_slice(&self.proposal_digest);
            output[120] = self.position_intent as u8;
            output[121] = self.fill_disposition.map_or(0, |value| value as u8);
            output[122] = self.target_semantic as u8;
            output[123] = self.protection_semantics.bits();
            put_i64(&mut output, 128, self.position_before_units);
            put_i64(&mut output, 136, self.position_after_units);
            encode_target(&mut output[144..176], self.target);
            encode_protection(&mut output[176..216], self.protection);
            encode_fill_frontier(&mut output[216..248], self.fill_frontier);
            output[248..280].copy_from_slice(&self.strategy_state_digest);
            output[280..312].copy_from_slice(&self.plugin_state_digest);
            output
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct ApplyOutcomeV1 {
        pub trace: SemanticTraceV1,
        /// True only when an exact replay joined the previous transition without mutation.
        pub joined: bool,
    }

    #[derive(Debug)]
    pub enum EnvelopeAdmissionV1 {
        Joined(ApplyOutcomeV1),
        ProposalRequired(AdmittedEnvelopeV1),
        NoProposal(AdmittedEnvelopeV1),
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum AdmissionClassV1 {
        ProposalRequired,
        NoProposal,
    }

    #[derive(Debug)]
    pub struct AdmittedEnvelopeV1 {
        envelope: LifecycleEnvelopeV1,
        checkpoint: CheckpointV1,
        class: AdmissionClassV1,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum KernelFaultV1 {
        MissingOrderCoordinate,
        MalformedEnvelope,
        OrderingRegression,
        ConflictingEventIdentity,
        StartRequired,
        DuplicateStart,
        AlreadyStopped,
        UnexpectedProposal,
        ProposalRequired,
        InvalidProposal,
        InvalidPositionTransition,
        InvalidTarget,
        InvalidProtection,
        PendingFill,
        FillWithoutIntent,
        FillIdentityMismatch,
        InvalidFillProgress,
        PositionOverflow,
        IdentityMismatch,
        InvalidCheckpoint,
        StaleAdmission,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct LifecycleKernelV1 {
        checkpoint: CheckpointV1,
    }

    impl LifecycleKernelV1 {
        pub fn new(identities: KernelIdentitiesV1) -> Result<Self, KernelFaultV1> {
            identities.validate()?;
            Ok(Self {
                checkpoint: CheckpointV1 {
                    schema_version: CHECKPOINT_SCHEMA_VERSION,
                    identities,
                    last_order_key: None,
                    last_envelope_digest: [0; 32],
                    last_proposal_digest: [0; 32],
                    strategy_state_digest: [0; 32],
                    plugin_state_digest: [0; 32],
                    target: TargetStateV1::None,
                    protection: ProtectionStateV1::default(),
                    reconciled_position_units: 0,
                    fill_frontier: FillFrontierV1::default(),
                    pending_intent: None,
                    stopped: false,
                    last_trace: SemanticTraceV1::default(),
                },
            })
        }

        pub fn new_with_state_digests(
            identities: KernelIdentitiesV1,
            strategy_state_digest: Digest,
            plugin_state_digest: Digest,
        ) -> Result<Self, KernelFaultV1> {
            identities.validate()?;

            if is_zero(&strategy_state_digest) || is_zero(&plugin_state_digest) {
                return Err(KernelFaultV1::InvalidCheckpoint);
            }
            let mut kernel = Self::new(identities)?;
            kernel.checkpoint.strategy_state_digest = strategy_state_digest;
            kernel.checkpoint.plugin_state_digest = plugin_state_digest;
            Ok(kernel)
        }

        pub fn restore(
            identities: KernelIdentitiesV1,
            checkpoint: CheckpointV1,
        ) -> Result<Self, KernelFaultV1> {
            identities.validate()?;
            if checkpoint.schema_version != CHECKPOINT_SCHEMA_VERSION
                || checkpoint.identities != identities
                || checkpoint.last_trace.schema_version != TRACE_SCHEMA_VERSION
            {
                return Err(KernelFaultV1::IdentityMismatch);
            }
            validate_checkpoint(&checkpoint)?;
            Ok(Self { checkpoint })
        }

        pub const fn checkpoint(&self) -> CheckpointV1 {
            self.checkpoint
        }

        pub fn admit_envelope(
            &self,
            envelope: LifecycleEnvelopeV1,
        ) -> Result<EnvelopeAdmissionV1, KernelFaultV1> {
            envelope.validate()?;

            if let Some(last_key) = self.checkpoint.last_order_key {
                match envelope.order_key.compare(&last_key) {
                    Ordering::Less => return Err(KernelFaultV1::OrderingRegression),
                    Ordering::Equal => {
                        if envelope.envelope_digest != self.checkpoint.last_envelope_digest {
                            return Err(KernelFaultV1::ConflictingEventIdentity);
                        }

                        return Ok(EnvelopeAdmissionV1::Joined(ApplyOutcomeV1 {
                            trace: self.checkpoint.last_trace,
                            joined: true,
                        }));
                    }
                    Ordering::Greater => {}
                }
            } else if envelope.order_key.kind != LifecycleKind::Start {
                return Err(KernelFaultV1::StartRequired);
            }

            if self.checkpoint.stopped {
                return Err(KernelFaultV1::AlreadyStopped);
            }

            let class = match envelope.payload {
                EnvelopePayloadV1::Start => {
                    if self.checkpoint.last_order_key.is_some() {
                        return Err(KernelFaultV1::DuplicateStart);
                    }
                    AdmissionClassV1::NoProposal
                }
                EnvelopePayloadV1::Bar | EnvelopePayloadV1::Event | EnvelopePayloadV1::Timer => {
                    AdmissionClassV1::ProposalRequired
                }
                EnvelopePayloadV1::Fill(_) => AdmissionClassV1::NoProposal,
                EnvelopePayloadV1::Stop => {
                    if self.checkpoint.pending_intent.is_some() {
                        return Err(KernelFaultV1::PendingFill);
                    }
                    AdmissionClassV1::NoProposal
                }
            };
            let admitted = AdmittedEnvelopeV1 {
                envelope,
                checkpoint: self.checkpoint,
                class,
            };

            Ok(match class {
                AdmissionClassV1::ProposalRequired => {
                    EnvelopeAdmissionV1::ProposalRequired(admitted)
                }
                AdmissionClassV1::NoProposal => EnvelopeAdmissionV1::NoProposal(admitted),
            })
        }

        pub fn apply_admitted(
            &mut self,
            admitted: AdmittedEnvelopeV1,
            proposal: Option<ProposalV1>,
        ) -> Result<ApplyOutcomeV1, KernelFaultV1> {
            if self.checkpoint != admitted.checkpoint {
                return Err(KernelFaultV1::StaleAdmission);
            }

            let current_class = match self.admit_envelope(admitted.envelope)? {
                EnvelopeAdmissionV1::Joined(_) => return Err(KernelFaultV1::StaleAdmission),
                EnvelopeAdmissionV1::ProposalRequired(_) => AdmissionClassV1::ProposalRequired,
                EnvelopeAdmissionV1::NoProposal(_) => AdmissionClassV1::NoProposal,
            };

            if current_class != admitted.class {
                return Err(KernelFaultV1::StaleAdmission);
            }

            match admitted.class {
                AdmissionClassV1::ProposalRequired if proposal.is_none() => {
                    return Err(KernelFaultV1::ProposalRequired);
                }
                AdmissionClassV1::NoProposal if proposal.is_some() => {
                    return Err(KernelFaultV1::UnexpectedProposal);
                }
                _ => {}
            }

            self.apply_new_envelope(admitted.envelope, proposal)
        }

        pub fn apply(
            &mut self,
            envelope: LifecycleEnvelopeV1,
            proposal: Option<ProposalV1>,
        ) -> Result<ApplyOutcomeV1, KernelFaultV1> {
            match self.admit_envelope(envelope)? {
                EnvelopeAdmissionV1::Joined(outcome) => {
                    let proposal_digest = if let Some(value) = proposal {
                        if derive_proposal_digest_v1(value).ok() != Some(value.proposal_digest) {
                            return Err(KernelFaultV1::ConflictingEventIdentity);
                        }
                        value.proposal_digest
                    } else {
                        [0; 32]
                    };

                    if proposal_digest != self.checkpoint.last_proposal_digest {
                        return Err(KernelFaultV1::ConflictingEventIdentity);
                    }
                    Ok(outcome)
                }
                EnvelopeAdmissionV1::ProposalRequired(admitted)
                | EnvelopeAdmissionV1::NoProposal(admitted) => {
                    self.apply_admitted(admitted, proposal)
                }
            }
        }

        fn apply_new_envelope(
            &mut self,
            envelope: LifecycleEnvelopeV1,
            proposal: Option<ProposalV1>,
        ) -> Result<ApplyOutcomeV1, KernelFaultV1> {
            let mut next = self.checkpoint;
            let position_before = next.reconciled_position_units;
            let mut position_intent = PositionIntentV1::Hold;
            let mut target_semantic = TargetSemanticV1::None;
            let mut protection_semantics = ProtectionSemanticSetV1::default();
            let mut fill_disposition = None;
            let proposal_digest;

            match envelope.payload {
                EnvelopePayloadV1::Start => {
                    if self.checkpoint.last_order_key.is_some() {
                        return Err(KernelFaultV1::DuplicateStart);
                    }
                    require_no_proposal(proposal)?;
                    proposal_digest = [0; 32];
                }
                EnvelopePayloadV1::Bar | EnvelopePayloadV1::Event | EnvelopePayloadV1::Timer => {
                    let value = proposal.ok_or(KernelFaultV1::ProposalRequired)?;
                    validate_and_apply_proposal(&mut next, value)?;
                    position_intent = value.position;
                    target_semantic = derive_target_semantic(value.target);
                    protection_semantics = derive_protection_semantics(value.protection);
                    proposal_digest = value.proposal_digest;
                }
                EnvelopePayloadV1::Fill(fill) => {
                    require_no_proposal(proposal)?;
                    reconcile_fill(&mut next, fill)?;
                    fill_disposition = Some(fill.disposition);
                    proposal_digest = [0; 32];
                }
                EnvelopePayloadV1::Stop => {
                    require_no_proposal(proposal)?;

                    if next.pending_intent.is_some() {
                        return Err(KernelFaultV1::PendingFill);
                    }
                    next.stopped = true;
                    proposal_digest = [0; 32];
                }
            }

            let trace = SemanticTraceV1 {
                schema_version: TRACE_SCHEMA_VERSION,
                order_key: Some(envelope.order_key),
                envelope_digest: envelope.envelope_digest,
                proposal_digest,
                position_intent,
                target_semantic,
                protection_semantics,
                target: next.target,
                protection: next.protection,
                fill_disposition,
                position_before_units: position_before,
                position_after_units: next.reconciled_position_units,
                fill_frontier: next.fill_frontier,
                strategy_state_digest: next.strategy_state_digest,
                plugin_state_digest: next.plugin_state_digest,
            };
            next.last_order_key = Some(envelope.order_key);
            next.last_envelope_digest = envelope.envelope_digest;
            next.last_proposal_digest = proposal_digest;
            next.last_trace = trace;
            self.checkpoint = next;

            Ok(ApplyOutcomeV1 {
                trace,
                joined: false,
            })
        }
    }

    fn require_no_proposal(proposal: Option<ProposalV1>) -> Result<(), KernelFaultV1> {
        if proposal.is_some() {
            Err(KernelFaultV1::UnexpectedProposal)
        } else {
            Ok(())
        }
    }

    fn validate_and_apply_proposal(
        checkpoint: &mut CheckpointV1,
        proposal: ProposalV1,
    ) -> Result<(), KernelFaultV1> {
        if is_zero(&proposal.intent_identity)
            || is_zero(&proposal.proposal_digest)
            || is_zero(&proposal.strategy_state_digest)
            || is_zero(&proposal.plugin_state_digest)
            || derive_proposal_digest_v1(proposal).ok() != Some(proposal.proposal_digest)
        {
            return Err(KernelFaultV1::InvalidProposal);
        }
        validate_target(checkpoint.target, proposal.target)?;
        let signed_target = proposal.reconciliation_target_units;
        match proposal.target {
            TargetProposalV1::Position(units)
            | TargetProposalV1::RebalancePosition { units, .. }
                if signed_target != Some(units) =>
            {
                return Err(KernelFaultV1::InvalidTarget);
            }
            TargetProposalV1::Keep if signed_target.is_some() => {
                return Err(KernelFaultV1::InvalidTarget);
            }
            _ => {}
        }
        validate_position_transition(
            checkpoint.reconciled_position_units,
            proposal.position,
            signed_target,
        )?;

        if proposal.position == PositionIntentV1::Hold {
            if proposal.target != TargetProposalV1::Keep || signed_target.is_some() {
                return Err(KernelFaultV1::InvalidPositionTransition);
            }
        } else {
            if checkpoint.pending_intent.is_some() {
                return Err(KernelFaultV1::PendingFill);
            }
            let target = signed_target.ok_or(KernelFaultV1::InvalidTarget)?;
            let delta = target
                .checked_sub(checkpoint.reconciled_position_units)
                .ok_or(KernelFaultV1::PositionOverflow)?;
            let expected_units = delta.unsigned_abs();
            if expected_units == 0
                || proposal.intent_identity == checkpoint.fill_frontier.intent_identity
            {
                return Err(KernelFaultV1::InvalidProposal);
            }
            checkpoint.pending_intent = Some(PendingIntentV1 {
                intent_identity: proposal.intent_identity,
                side: if delta > 0 {
                    FillSideV1::Buy
                } else {
                    FillSideV1::Sell
                },
                expected_units,
                cumulative_filled_units: 0,
            });
        }

        apply_protection(
            checkpoint,
            proposal.position,
            proposal.protection,
            signed_target,
        )?;

        if proposal.target != TargetProposalV1::Keep {
            checkpoint.target = proposal.target.into();
        }
        checkpoint.strategy_state_digest = proposal.strategy_state_digest;
        checkpoint.plugin_state_digest = proposal.plugin_state_digest;
        Ok(())
    }

    fn validate_position_transition(
        current: i64,
        intent: PositionIntentV1,
        target: Option<i64>,
    ) -> Result<(), KernelFaultV1> {
        if current == i64::MIN || target == Some(i64::MIN) {
            return Err(KernelFaultV1::InvalidPositionTransition);
        }
        let valid = match (intent, target) {
            (PositionIntentV1::Hold, None) => true,
            (PositionIntentV1::Enter, Some(value)) => current == 0 && value != 0,
            (PositionIntentV1::Add, Some(value)) => {
                current != 0
                    && value.signum() == current.signum()
                    && value.unsigned_abs() > current.unsigned_abs()
            }
            (PositionIntentV1::Reduce, Some(value)) => {
                current != 0
                    && value != 0
                    && value.signum() == current.signum()
                    && value.unsigned_abs() < current.unsigned_abs()
            }
            (PositionIntentV1::Exit, Some(0)) => current != 0,
            _ => false,
        };

        if valid {
            Ok(())
        } else {
            Err(KernelFaultV1::InvalidPositionTransition)
        }
    }

    fn validate_target(
        current: TargetStateV1,
        proposal: TargetProposalV1,
    ) -> Result<(), KernelFaultV1> {
        if !target_in_canonical_domain(proposal) {
            return Err(KernelFaultV1::InvalidTarget);
        }

        match proposal {
            TargetProposalV1::RebalancePosition { sequence, .. }
            | TargetProposalV1::RebalanceWeightMicros { sequence, .. }
                if sequence <= rebalance_sequence(current) =>
            {
                Err(KernelFaultV1::InvalidTarget)
            }
            _ => Ok(()),
        }
    }

    fn target_in_canonical_domain(proposal: TargetProposalV1) -> bool {
        match proposal {
            TargetProposalV1::Keep => true,
            TargetProposalV1::Position(value) => value != i64::MIN,
            TargetProposalV1::WeightMicros(value) => (-1_000_000..=1_000_000).contains(&value),
            TargetProposalV1::RebalancePosition { sequence, units } => {
                sequence != 0 && units != i64::MIN
            }
            TargetProposalV1::RebalanceWeightMicros {
                sequence,
                weight_micros,
            } => sequence != 0 && (-1_000_000..=1_000_000).contains(&weight_micros),
        }
    }

    const fn rebalance_sequence(target: TargetStateV1) -> u64 {
        match target {
            TargetStateV1::RebalancePosition { sequence, .. }
            | TargetStateV1::RebalanceWeightMicros { sequence, .. } => sequence,
            _ => 0,
        }
    }

    fn apply_protection(
        checkpoint: &mut CheckpointV1,
        intent: PositionIntentV1,
        proposal: ProtectionProposalV1,
        signed_target: Option<i64>,
    ) -> Result<(), KernelFaultV1> {
        match proposal {
            ProtectionProposalV1::Keep => {
                if intent == PositionIntentV1::Exit {
                    return Err(KernelFaultV1::InvalidProtection);
                }
            }
            ProtectionProposalV1::Replace(value) => {
                value.validate()?;

                if signed_target == Some(0) {
                    return Err(KernelFaultV1::InvalidProtection);
                }
                checkpoint.protection = value;
            }
            ProtectionProposalV1::AdjustTrailing { stop_ticks } => {
                if stop_ticks <= 0 || checkpoint.protection.trailing_distance_ticks.is_none() {
                    return Err(KernelFaultV1::InvalidProtection);
                }
                let previous = checkpoint
                    .protection
                    .trailing_stop_ticks
                    .ok_or(KernelFaultV1::InvalidProtection)?;
                let direction = checkpoint.reconciled_position_units.signum();
                if (direction > 0 && stop_ticks <= previous)
                    || (direction < 0 && stop_ticks >= previous)
                    || direction == 0
                {
                    return Err(KernelFaultV1::InvalidProtection);
                }
                checkpoint.protection.trailing_stop_ticks = Some(stop_ticks);
            }
            ProtectionProposalV1::Clear => {
                if intent != PositionIntentV1::Exit {
                    return Err(KernelFaultV1::InvalidProtection);
                }
                checkpoint.protection = ProtectionStateV1::default();
            }
        }
        Ok(())
    }

    fn reconcile_fill(
        checkpoint: &mut CheckpointV1,
        fill: FillEventV1,
    ) -> Result<(), KernelFaultV1> {
        let pending = checkpoint
            .pending_intent
            .ok_or(KernelFaultV1::FillWithoutIntent)?;
        if fill.intent_identity != pending.intent_identity || fill.side != pending.side {
            return Err(KernelFaultV1::FillIdentityMismatch);
        }
        let previous = pending.cumulative_filled_units;
        let terminal = match fill.disposition {
            FillDispositionV1::PartiallyFilled => {
                if fill.cumulative_filled_units <= previous
                    || fill.cumulative_filled_units >= pending.expected_units
                {
                    return Err(KernelFaultV1::InvalidFillProgress);
                }
                false
            }
            FillDispositionV1::Filled => {
                if fill.cumulative_filled_units <= previous
                    || fill.cumulative_filled_units != pending.expected_units
                {
                    return Err(KernelFaultV1::InvalidFillProgress);
                }
                true
            }
            FillDispositionV1::Rejected | FillDispositionV1::Canceled => {
                if fill.cumulative_filled_units != previous {
                    return Err(KernelFaultV1::InvalidFillProgress);
                }
                true
            }
        };
        let delta = fill.cumulative_filled_units - previous;
        let signed_delta = i64::try_from(delta).map_err(|_| KernelFaultV1::PositionOverflow)?
            * i64::from(fill.side as i8);
        checkpoint.reconciled_position_units = checkpoint
            .reconciled_position_units
            .checked_add(signed_delta)
            .ok_or(KernelFaultV1::PositionOverflow)?;
        checkpoint.fill_frontier = FillFrontierV1 {
            intent_identity: fill.intent_identity,
            cumulative_filled_units: fill.cumulative_filled_units,
            terminal_disposition: terminal.then_some(fill.disposition),
        };
        checkpoint.pending_intent = if terminal {
            None
        } else {
            Some(PendingIntentV1 {
                cumulative_filled_units: fill.cumulative_filled_units,
                ..pending
            })
        };
        Ok(())
    }

    fn validate_checkpoint(checkpoint: &CheckpointV1) -> Result<(), KernelFaultV1> {
        checkpoint.identities.validate()?;
        checkpoint.protection.validate()?;
        if !target_state_in_canonical_domain(checkpoint.target)
            || is_zero(&checkpoint.fill_frontier.intent_identity)
                && (checkpoint.fill_frontier.cumulative_filled_units != 0
                    || checkpoint.fill_frontier.terminal_disposition.is_some())
        {
            return Err(KernelFaultV1::InvalidCheckpoint);
        }

        if checkpoint.last_order_key.is_none() {
            if checkpoint.stopped
                || checkpoint.pending_intent.is_some()
                || checkpoint.reconciled_position_units != 0
                || checkpoint.target != TargetStateV1::None
                || checkpoint.protection != ProtectionStateV1::default()
                || !is_zero(&checkpoint.last_envelope_digest)
                || !is_zero(&checkpoint.last_proposal_digest)
                || checkpoint.fill_frontier != FillFrontierV1::default()
                || checkpoint.last_trace != SemanticTraceV1::default()
            {
                return Err(KernelFaultV1::InvalidCheckpoint);
            }
        } else {
            checkpoint
                .last_order_key
                .ok_or(KernelFaultV1::InvalidCheckpoint)?
                .validate()?;

            if is_zero(&checkpoint.last_envelope_digest)
                || checkpoint.last_trace.order_key != checkpoint.last_order_key
                || checkpoint.last_trace.envelope_digest != checkpoint.last_envelope_digest
                || checkpoint.last_trace.proposal_digest != checkpoint.last_proposal_digest
                || checkpoint.last_trace.target != checkpoint.target
                || checkpoint.last_trace.protection != checkpoint.protection
                || checkpoint.last_trace.position_after_units
                    != checkpoint.reconciled_position_units
                || checkpoint.last_trace.fill_frontier != checkpoint.fill_frontier
                || checkpoint.last_trace.strategy_state_digest != checkpoint.strategy_state_digest
                || checkpoint.last_trace.plugin_state_digest != checkpoint.plugin_state_digest
            {
                return Err(KernelFaultV1::InvalidCheckpoint);
            }
            let last_kind = checkpoint
                .last_order_key
                .ok_or(KernelFaultV1::InvalidCheckpoint)?
                .kind;

            if checkpoint.stopped != (last_kind == LifecycleKind::Stop)
                || matches!(
                    last_kind,
                    LifecycleKind::Bar | LifecycleKind::Event | LifecycleKind::Timer
                ) == is_zero(&checkpoint.last_proposal_digest)
            {
                return Err(KernelFaultV1::InvalidCheckpoint);
            }
        }

        if let Some(pending) = checkpoint.pending_intent
            && (is_zero(&pending.intent_identity)
                || pending.expected_units == 0
                || pending.cumulative_filled_units >= pending.expected_units
                || pending.cumulative_filled_units > 0
                    && (pending.intent_identity != checkpoint.fill_frontier.intent_identity
                        || pending.cumulative_filled_units
                            != checkpoint.fill_frontier.cumulative_filled_units))
        {
            return Err(KernelFaultV1::InvalidCheckpoint);
        }

        if checkpoint.pending_intent.is_none()
            && !is_zero(&checkpoint.fill_frontier.intent_identity)
            && checkpoint.fill_frontier.terminal_disposition.is_none()
        {
            return Err(KernelFaultV1::InvalidCheckpoint);
        }
        Ok(())
    }

    fn target_state_in_canonical_domain(target: TargetStateV1) -> bool {
        match target {
            TargetStateV1::None => true,
            TargetStateV1::Position(value) => value != i64::MIN,
            TargetStateV1::WeightMicros(value) => (-1_000_000..=1_000_000).contains(&value),
            TargetStateV1::RebalancePosition { sequence, units } => {
                sequence != 0 && units != i64::MIN
            }
            TargetStateV1::RebalanceWeightMicros {
                sequence,
                weight_micros,
            } => sequence != 0 && (-1_000_000..=1_000_000).contains(&weight_micros),
        }
    }

    fn checkpoint_read<const N: usize>(
        bytes: &[u8],
        offset: usize,
    ) -> Result<[u8; N], CheckpointCodecFaultV1> {
        bytes
            .get(offset..offset + N)
            .and_then(|value| value.try_into().ok())
            .ok_or(CheckpointCodecFaultV1::InvalidLength)
    }

    fn checkpoint_read_u16(bytes: &[u8], offset: usize) -> Result<u16, CheckpointCodecFaultV1> {
        Ok(u16::from_le_bytes(checkpoint_read(bytes, offset)?))
    }

    fn checkpoint_read_u64(bytes: &[u8], offset: usize) -> Result<u64, CheckpointCodecFaultV1> {
        Ok(u64::from_le_bytes(checkpoint_read(bytes, offset)?))
    }

    fn checkpoint_read_i64(bytes: &[u8], offset: usize) -> Result<i64, CheckpointCodecFaultV1> {
        Ok(i64::from_le_bytes(checkpoint_read(bytes, offset)?))
    }

    fn checkpoint_read_i32(bytes: &[u8], offset: usize) -> Result<i32, CheckpointCodecFaultV1> {
        Ok(i32::from_le_bytes(checkpoint_read(bytes, offset)?))
    }

    fn require_checkpoint_zero(bytes: &[u8]) -> Result<(), CheckpointCodecFaultV1> {
        if bytes.iter().any(|byte| *byte != 0) {
            Err(CheckpointCodecFaultV1::NonZeroReserved)
        } else {
            Ok(())
        }
    }

    fn decode_checkpoint_order_key(
        bytes: &[u8],
    ) -> Result<Option<EventOrderKeyV1>, CheckpointCodecFaultV1> {
        match bytes[0] {
            0 => {
                require_checkpoint_zero(&bytes[1..])?;
                Ok(None)
            }
            1 => {
                require_checkpoint_zero(&bytes[2..8])?;
                let kind = decode_lifecycle_kind(bytes[1])
                    .ok_or(CheckpointCodecFaultV1::UnknownLifecycleKind)?;
                Ok(Some(EventOrderKeyV1 {
                    logical_time_ns: checkpoint_read_u64(bytes, 8)?,
                    event_time_ns: checkpoint_read_u64(bytes, 16)?,
                    kind,
                    owner_sequence: checkpoint_read_u64(bytes, 24)?,
                    event_identity: checkpoint_read(bytes, 32)?,
                }))
            }
            _ => Err(CheckpointCodecFaultV1::NonCanonicalOption),
        }
    }

    fn decode_checkpoint_target(bytes: &[u8]) -> Result<TargetStateV1, CheckpointCodecFaultV1> {
        let target = match bytes[0] {
            0 => {
                require_checkpoint_zero(&bytes[1..])?;
                TargetStateV1::None
            }
            1 => {
                require_checkpoint_zero(&bytes[1..8])?;
                require_checkpoint_zero(&bytes[16..])?;
                TargetStateV1::Position(checkpoint_read_i64(bytes, 8)?)
            }
            2 => {
                require_checkpoint_zero(&bytes[1..8])?;
                require_checkpoint_zero(&bytes[12..])?;
                TargetStateV1::WeightMicros(checkpoint_read_i32(bytes, 8)?)
            }
            3 => {
                require_checkpoint_zero(&bytes[1..8])?;
                require_checkpoint_zero(&bytes[24..])?;
                TargetStateV1::RebalancePosition {
                    sequence: checkpoint_read_u64(bytes, 8)?,
                    units: checkpoint_read_i64(bytes, 16)?,
                }
            }
            4 => {
                require_checkpoint_zero(&bytes[1..8])?;
                require_checkpoint_zero(&bytes[12..16])?;
                require_checkpoint_zero(&bytes[20..])?;
                TargetStateV1::RebalanceWeightMicros {
                    sequence: checkpoint_read_u64(bytes, 8)?,
                    weight_micros: checkpoint_read_i32(bytes, 16)?,
                }
            }
            _ => return Err(CheckpointCodecFaultV1::UnknownTarget),
        };

        if target_state_in_canonical_domain(target) {
            Ok(target)
        } else {
            Err(CheckpointCodecFaultV1::InvalidCheckpoint)
        }
    }

    fn decode_checkpoint_option_i64(
        bytes: &[u8],
        offset: usize,
    ) -> Result<Option<i64>, CheckpointCodecFaultV1> {
        match bytes[offset] {
            0 => {
                require_checkpoint_zero(&bytes[offset + 1..offset + 9])?;
                Ok(None)
            }
            1 => Ok(Some(checkpoint_read_i64(bytes, offset + 1)?)),
            _ => Err(CheckpointCodecFaultV1::NonCanonicalOption),
        }
    }

    fn decode_checkpoint_protection(
        bytes: &[u8],
    ) -> Result<ProtectionStateV1, CheckpointCodecFaultV1> {
        let trailing_distance_ticks = match bytes[18] {
            0 => {
                require_checkpoint_zero(&bytes[19..27])?;
                None
            }
            1 => Some(checkpoint_read_u64(bytes, 19)?),
            _ => return Err(CheckpointCodecFaultV1::NonCanonicalOption),
        };
        require_checkpoint_zero(&bytes[36..])?;
        Ok(ProtectionStateV1 {
            stop_loss_ticks: decode_checkpoint_option_i64(bytes, 0)?,
            take_profit_ticks: decode_checkpoint_option_i64(bytes, 9)?,
            trailing_distance_ticks,
            trailing_stop_ticks: decode_checkpoint_option_i64(bytes, 27)?,
        })
    }

    fn decode_checkpoint_fill_disposition(
        value: u8,
    ) -> Result<Option<FillDispositionV1>, CheckpointCodecFaultV1> {
        match value {
            0 => Ok(None),
            1 => Ok(Some(FillDispositionV1::PartiallyFilled)),
            2 => Ok(Some(FillDispositionV1::Filled)),
            3 => Ok(Some(FillDispositionV1::Rejected)),
            4 => Ok(Some(FillDispositionV1::Canceled)),
            _ => Err(CheckpointCodecFaultV1::UnknownFillDisposition),
        }
    }

    fn decode_checkpoint_fill_frontier(
        bytes: &[u8],
    ) -> Result<FillFrontierV1, CheckpointCodecFaultV1> {
        require_checkpoint_zero(&bytes[25..])?;
        Ok(FillFrontierV1 {
            intent_identity: checkpoint_read(bytes, 0)?,
            cumulative_filled_units: checkpoint_read_u64(bytes, 16)?,
            terminal_disposition: decode_checkpoint_fill_disposition(bytes[24])?,
        })
    }

    fn decode_checkpoint_pending(
        bytes: &[u8],
    ) -> Result<Option<PendingIntentV1>, CheckpointCodecFaultV1> {
        match bytes[0] {
            0 => {
                require_checkpoint_zero(&bytes[1..])?;
                Ok(None)
            }
            1 => {
                require_checkpoint_zero(&bytes[2..8])?;
                let side = match bytes[1] {
                    1 => FillSideV1::Buy,
                    255 => FillSideV1::Sell,
                    _ => return Err(CheckpointCodecFaultV1::UnknownFillSide),
                };
                Ok(Some(PendingIntentV1 {
                    intent_identity: checkpoint_read(bytes, 8)?,
                    side,
                    expected_units: checkpoint_read_u64(bytes, 24)?,
                    cumulative_filled_units: checkpoint_read_u64(bytes, 32)?,
                }))
            }
            _ => Err(CheckpointCodecFaultV1::NonCanonicalOption),
        }
    }

    fn decode_checkpoint_trace(bytes: &[u8]) -> Result<SemanticTraceV1, CheckpointCodecFaultV1> {
        if checkpoint_read_u16(bytes, 0)? != TRACE_SCHEMA_VERSION {
            return Err(CheckpointCodecFaultV1::UnsupportedTraceVersion);
        }
        require_checkpoint_zero(&bytes[2..8])?;
        require_checkpoint_zero(&bytes[124..128])?;
        require_checkpoint_zero(&bytes[312..320])?;
        let position_intent = match bytes[120] {
            1 => PositionIntentV1::Hold,
            2 => PositionIntentV1::Enter,
            3 => PositionIntentV1::Add,
            4 => PositionIntentV1::Reduce,
            5 => PositionIntentV1::Exit,
            _ => return Err(CheckpointCodecFaultV1::UnknownPositionIntent),
        };
        let target_semantic = match bytes[122] {
            0 => TargetSemanticV1::None,
            1 => TargetSemanticV1::Position,
            2 => TargetSemanticV1::Weight,
            3 => TargetSemanticV1::Rebalance,
            _ => return Err(CheckpointCodecFaultV1::UnknownTargetSemantic),
        };

        if bytes[123]
            & !(ProtectionSemanticSetV1::STOP_LOSS
                | ProtectionSemanticSetV1::TAKE_PROFIT
                | ProtectionSemanticSetV1::TRAILING_ADJUST)
            != 0
        {
            return Err(CheckpointCodecFaultV1::InvalidProtectionSemantics);
        }
        Ok(SemanticTraceV1 {
            schema_version: TRACE_SCHEMA_VERSION,
            order_key: decode_checkpoint_order_key(&bytes[8..56])?,
            envelope_digest: checkpoint_read(bytes, 56)?,
            proposal_digest: checkpoint_read(bytes, 88)?,
            position_intent,
            target_semantic,
            protection_semantics: ProtectionSemanticSetV1(bytes[123]),
            target: decode_checkpoint_target(&bytes[144..176])?,
            protection: decode_checkpoint_protection(&bytes[176..216])?,
            fill_disposition: decode_checkpoint_fill_disposition(bytes[121])?,
            position_before_units: checkpoint_read_i64(bytes, 128)?,
            position_after_units: checkpoint_read_i64(bytes, 136)?,
            fill_frontier: decode_checkpoint_fill_frontier(&bytes[216..248])?,
            strategy_state_digest: checkpoint_read(bytes, 248)?,
            plugin_state_digest: checkpoint_read(bytes, 280)?,
        })
    }

    const fn derive_target_semantic(target: TargetProposalV1) -> TargetSemanticV1 {
        match target {
            TargetProposalV1::Keep => TargetSemanticV1::None,
            TargetProposalV1::Position(_) => TargetSemanticV1::Position,
            TargetProposalV1::WeightMicros(_) => TargetSemanticV1::Weight,
            TargetProposalV1::RebalancePosition { .. }
            | TargetProposalV1::RebalanceWeightMicros { .. } => TargetSemanticV1::Rebalance,
        }
    }

    const fn derive_protection_semantics(
        protection: ProtectionProposalV1,
    ) -> ProtectionSemanticSetV1 {
        let bits = match protection {
            ProtectionProposalV1::Keep => 0,
            ProtectionProposalV1::AdjustTrailing { .. } => ProtectionSemanticSetV1::TRAILING_ADJUST,
            ProtectionProposalV1::Replace(_) | ProtectionProposalV1::Clear => {
                ProtectionSemanticSetV1::STOP_LOSS
                    | ProtectionSemanticSetV1::TAKE_PROFIT
                    | ProtectionSemanticSetV1::TRAILING_ADJUST
            }
        };
        ProtectionSemanticSetV1(bits)
    }

    fn is_zero<const N: usize>(value: &[u8; N]) -> bool {
        value.iter().all(|byte| *byte == 0)
    }

    fn sha256_parts(first: &[u8], second: &[u8]) -> Digest {
        let mut sha = Sha256V1::new();
        sha.update(first);
        sha.update(second);
        sha.finish()
    }

    struct Sha256V1 {
        state: [u32; 8],
        block: [u8; 64],
        block_len: usize,
        message_len: u64,
    }

    impl Sha256V1 {
        const fn new() -> Self {
            Self {
                state: [
                    0x6a09_e667,
                    0xbb67_ae85,
                    0x3c6e_f372,
                    0xa54f_f53a,
                    0x510e_527f,
                    0x9b05_688c,
                    0x1f83_d9ab,
                    0x5be0_cd19,
                ],
                block: [0; 64],
                block_len: 0,
                message_len: 0,
            }
        }

        fn update(&mut self, mut input: &[u8]) {
            self.message_len += input.len() as u64;
            while !input.is_empty() {
                let take = core::cmp::min(64 - self.block_len, input.len());
                self.block[self.block_len..self.block_len + take].copy_from_slice(&input[..take]);
                self.block_len += take;
                input = &input[take..];

                if self.block_len == 64 {
                    sha256_compress(&mut self.state, &self.block);
                    self.block_len = 0;
                }
            }
        }

        fn finish(mut self) -> Digest {
            let bit_len = self.message_len * 8;
            self.block[self.block_len] = 0x80;
            self.block_len += 1;
            if self.block_len > 56 {
                self.block[self.block_len..].fill(0);
                sha256_compress(&mut self.state, &self.block);
                self.block = [0; 64];
            } else {
                self.block[self.block_len..56].fill(0);
            }
            self.block[56..64].copy_from_slice(&bit_len.to_be_bytes());
            sha256_compress(&mut self.state, &self.block);

            let mut digest = [0; 32];
            for (chunk, value) in digest.chunks_exact_mut(4).zip(self.state) {
                chunk.copy_from_slice(&value.to_be_bytes());
            }
            digest
        }
    }

    fn sha256_compress(state: &mut [u32; 8], block: &[u8; 64]) {
        const K: [u32; 64] = [
            0x428a_2f98,
            0x7137_4491,
            0xb5c0_fbcf,
            0xe9b5_dba5,
            0x3956_c25b,
            0x59f1_11f1,
            0x923f_82a4,
            0xab1c_5ed5,
            0xd807_aa98,
            0x1283_5b01,
            0x2431_85be,
            0x550c_7dc3,
            0x72be_5d74,
            0x80de_b1fe,
            0x9bdc_06a7,
            0xc19b_f174,
            0xe49b_69c1,
            0xefbe_4786,
            0x0fc1_9dc6,
            0x240c_a1cc,
            0x2de9_2c6f,
            0x4a74_84aa,
            0x5cb0_a9dc,
            0x76f9_88da,
            0x983e_5152,
            0xa831_c66d,
            0xb003_27c8,
            0xbf59_7fc7,
            0xc6e0_0bf3,
            0xd5a7_9147,
            0x06ca_6351,
            0x1429_2967,
            0x27b7_0a85,
            0x2e1b_2138,
            0x4d2c_6dfc,
            0x5338_0d13,
            0x650a_7354,
            0x766a_0abb,
            0x81c2_c92e,
            0x9272_2c85,
            0xa2bf_e8a1,
            0xa81a_664b,
            0xc24b_8b70,
            0xc76c_51a3,
            0xd192_e819,
            0xd699_0624,
            0xf40e_3585,
            0x106a_a070,
            0x19a4_c116,
            0x1e37_6c08,
            0x2748_774c,
            0x34b0_bcb5,
            0x391c_0cb3,
            0x4ed8_aa4a,
            0x5b9c_ca4f,
            0x682e_6ff3,
            0x748f_82ee,
            0x78a5_636f,
            0x84c8_7814,
            0x8cc7_0208,
            0x90be_fffa,
            0xa450_6ceb,
            0xbef9_a3f7,
            0xc671_78f2,
        ];
        let mut words = [0_u32; 64];
        for (index, chunk) in block.chunks_exact(4).enumerate() {
            words[index] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }

        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = *state;
        for index in 0..64 {
            let sum1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ (!e & g);
            let temp1 = h
                .wrapping_add(sum1)
                .wrapping_add(choice)
                .wrapping_add(K[index])
                .wrapping_add(words[index]);
            let sum0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = sum0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }

    fn put_u16(output: &mut [u8], offset: usize, value: u16) {
        output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put_u64(output: &mut [u8], offset: usize, value: u64) {
        output[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    fn put_i64(output: &mut [u8], offset: usize, value: i64) {
        output[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    fn encode_order_key(output: &mut [u8], value: Option<EventOrderKeyV1>) {
        if let Some(value) = value {
            output[0] = 1;
            output[1] = value.kind as u8;
            put_u64(output, 8, value.logical_time_ns);
            put_u64(output, 16, value.event_time_ns);
            put_u64(output, 24, value.owner_sequence);
            output[32..48].copy_from_slice(&value.event_identity);
        }
    }

    fn encode_target(output: &mut [u8], value: TargetStateV1) {
        match value {
            TargetStateV1::None => {}
            TargetStateV1::Position(units) => {
                output[0] = 1;
                put_i64(output, 8, units);
            }
            TargetStateV1::WeightMicros(weight) => {
                output[0] = 2;
                output[8..12].copy_from_slice(&weight.to_le_bytes());
            }
            TargetStateV1::RebalancePosition { sequence, units } => {
                output[0] = 3;
                put_u64(output, 8, sequence);
                put_i64(output, 16, units);
            }
            TargetStateV1::RebalanceWeightMicros {
                sequence,
                weight_micros,
            } => {
                output[0] = 4;
                put_u64(output, 8, sequence);
                output[16..20].copy_from_slice(&weight_micros.to_le_bytes());
            }
        }
    }

    fn encode_option_i64(output: &mut [u8], offset: usize, value: Option<i64>) {
        if let Some(value) = value {
            output[offset] = 1;
            put_i64(output, offset + 1, value);
        }
    }

    fn encode_protection(output: &mut [u8], value: ProtectionStateV1) {
        encode_option_i64(output, 0, value.stop_loss_ticks);
        encode_option_i64(output, 9, value.take_profit_ticks);
        if let Some(distance) = value.trailing_distance_ticks {
            output[18] = 1;
            put_u64(output, 19, distance);
        }
        encode_option_i64(output, 27, value.trailing_stop_ticks);
    }

    fn encode_fill_frontier(output: &mut [u8], value: FillFrontierV1) {
        output[..16].copy_from_slice(&value.intent_identity);
        put_u64(output, 16, value.cumulative_filled_units);
        output[24] = value.terminal_disposition.map_or(0, |item| item as u8);
    }

    fn encode_pending(output: &mut [u8], value: Option<PendingIntentV1>) {
        if let Some(value) = value {
            output[0] = 1;
            output[1] = value.side as i8 as u8;
            output[8..24].copy_from_slice(&value.intent_identity);
            put_u64(output, 24, value.expected_units);
            put_u64(output, 32, value.cumulative_filled_units);
        }
    }
}

/// Canonical, allocation-free two-member target-set wire contract for the V2 shared kernel.
///
/// The guest supplies only bounded lifecycle decisions. `ProgramHostV2` derives and seals the
/// selection, frame, capability, program, and state identities before the set can advance runtime
/// state. Instrument keys are exact canonical Owner-bound instrument bytes, never aliases or
/// caller-selected ordinals.
pub mod lifecycle_v2 {
    use super::lifecycle_v1::{
        PositionIntentV1, ProtectionProposalV1, ProtectionStateV1, TargetProposalV1,
    };

    pub const TARGET_SET_SCHEMA_VERSION: u16 = 2;
    pub const TARGET_SET_CODEC_VERSION: u16 = 2;
    pub const TARGET_SET_MEMBER_COUNT: usize = 2;
    pub const MAX_INSTRUMENT_KEY_BYTES: usize = 64;
    pub const TARGET_SET_HEADER_BYTES: usize = 24;
    pub const TARGET_SET_MEMBER_BYTES: usize = 144;
    pub const TARGET_SET_BYTES: usize =
        TARGET_SET_HEADER_BYTES + TARGET_SET_MEMBER_COUNT * TARGET_SET_MEMBER_BYTES;
    pub const TARGET_SET_SEMANTIC_ID: &str = "kernel.target-set.instrument.v2";
    pub const KERNEL_SEMANTICS_ID: &str = "strategy.lifecycle.shared-kernel.v2";

    const TARGET_SET_MAGIC: [u8; 4] = *b"SFTS";

    #[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
    pub struct InstrumentKeyV2 {
        bytes: [u8; MAX_INSTRUMENT_KEY_BYTES],
        len: u8,
    }

    impl InstrumentKeyV2 {
        pub fn new(value: &[u8]) -> Result<Self, TargetSetFaultV2> {
            if value.is_empty()
                || value.len() > MAX_INSTRUMENT_KEY_BYTES
                || value
                    .iter()
                    .any(|byte| *byte == 0 || !byte.is_ascii_graphic())
            {
                return Err(TargetSetFaultV2::InvalidInstrument);
            }
            let mut bytes = [0; MAX_INSTRUMENT_KEY_BYTES];
            bytes[..value.len()].copy_from_slice(value);
            Ok(Self {
                bytes,
                len: value.len() as u8,
            })
        }

        pub fn as_bytes(&self) -> &[u8] {
            &self.bytes[..usize::from(self.len)]
        }
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub struct MemberTargetV2 {
        pub instrument: InstrumentKeyV2,
        pub position: PositionIntentV1,
        pub target: TargetProposalV1,
        pub reconciliation_target_units: Option<i64>,
        pub protection: ProtectionProposalV1,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub struct InstrumentTargetSetV2 {
        pub sequence: u64,
        pub members: [MemberTargetV2; TARGET_SET_MEMBER_COUNT],
    }

    impl InstrumentTargetSetV2 {
        pub fn new(
            sequence: u64,
            mut members: [MemberTargetV2; TARGET_SET_MEMBER_COUNT],
        ) -> Result<Self, TargetSetFaultV2> {
            if sequence == 0 {
                return Err(TargetSetFaultV2::InvalidSequence);
            }

            if members[0].instrument > members[1].instrument {
                members.swap(0, 1);
            }
            let value = Self { sequence, members };
            value.validate()?;
            Ok(value)
        }

        pub fn encode(self) -> Result<[u8; TARGET_SET_BYTES], TargetSetFaultV2> {
            self.validate()?;
            let mut output = [0; TARGET_SET_BYTES];
            output[..4].copy_from_slice(&TARGET_SET_MAGIC);
            output[4..6].copy_from_slice(&TARGET_SET_CODEC_VERSION.to_le_bytes());
            output[6..8].copy_from_slice(&TARGET_SET_SCHEMA_VERSION.to_le_bytes());
            output[8..10].copy_from_slice(&(TARGET_SET_MEMBER_COUNT as u16).to_le_bytes());
            output[12..20].copy_from_slice(&self.sequence.to_le_bytes());

            for (index, member) in self.members.iter().enumerate() {
                encode_member(
                    &mut output[TARGET_SET_HEADER_BYTES + index * TARGET_SET_MEMBER_BYTES
                        ..TARGET_SET_HEADER_BYTES + (index + 1) * TARGET_SET_MEMBER_BYTES],
                    *member,
                );
            }
            Ok(output)
        }

        pub fn decode(bytes: &[u8]) -> Result<Self, TargetSetFaultV2> {
            if bytes.len() != TARGET_SET_BYTES
                || bytes[..4] != TARGET_SET_MAGIC
                || read_u16(bytes, 4)? != TARGET_SET_CODEC_VERSION
                || read_u16(bytes, 6)? != TARGET_SET_SCHEMA_VERSION
                || usize::from(read_u16(bytes, 8)?) != TARGET_SET_MEMBER_COUNT
                || bytes[10..12] != [0; 2]
                || bytes[20..24] != [0; 4]
            {
                return Err(TargetSetFaultV2::NonCanonicalEncoding);
            }
            let sequence = read_u64(bytes, 12)?;
            let members = [
                decode_member(&bytes[24..168])?,
                decode_member(&bytes[168..312])?,
            ];
            let value = Self { sequence, members };
            value.validate()?;
            if value
                .encode()
                .map_err(|_| TargetSetFaultV2::NonCanonicalEncoding)?
                != bytes
            {
                return Err(TargetSetFaultV2::NonCanonicalEncoding);
            }
            Ok(value)
        }

        fn validate(&self) -> Result<(), TargetSetFaultV2> {
            if self.sequence == 0 {
                return Err(TargetSetFaultV2::InvalidSequence);
            }

            if self.members[0].instrument >= self.members[1].instrument {
                return Err(TargetSetFaultV2::InvalidCoverage);
            }

            for member in &self.members {
                validate_target(self.sequence, *member)?;
            }
            Ok(())
        }
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum TargetSetFaultV2 {
        InvalidLength,
        InvalidInstrument,
        InvalidCoverage,
        InvalidSequence,
        InvalidTarget,
        InvalidProtection,
        NonCanonicalEncoding,
    }

    fn validate_target(sequence: u64, member: MemberTargetV2) -> Result<(), TargetSetFaultV2> {
        match member.target {
            TargetProposalV1::Keep => {
                if member.reconciliation_target_units.is_some() {
                    return Err(TargetSetFaultV2::InvalidTarget);
                }
            }
            TargetProposalV1::Position(value) => {
                if value == i64::MIN || member.reconciliation_target_units != Some(value) {
                    return Err(TargetSetFaultV2::InvalidTarget);
                }
            }
            TargetProposalV1::WeightMicros(value) => {
                if !(-1_000_000..=1_000_000).contains(&value) {
                    return Err(TargetSetFaultV2::InvalidTarget);
                }
            }
            TargetProposalV1::RebalancePosition {
                sequence: member_sequence,
                units,
            } => {
                if member_sequence != sequence
                    || units == i64::MIN
                    || member.reconciliation_target_units != Some(units)
                {
                    return Err(TargetSetFaultV2::InvalidTarget);
                }
            }
            TargetProposalV1::RebalanceWeightMicros {
                sequence: member_sequence,
                weight_micros,
            } => {
                if member_sequence != sequence || !(-1_000_000..=1_000_000).contains(&weight_micros)
                {
                    return Err(TargetSetFaultV2::InvalidTarget);
                }
            }
        }

        match member.protection {
            ProtectionProposalV1::Replace(value)
                if value.stop_loss_ticks.is_some_and(|value| value <= 0)
                    || value.take_profit_ticks.is_some_and(|value| value <= 0)
                    || value.trailing_distance_ticks == Some(0)
                    || value.trailing_stop_ticks.is_some_and(|value| value <= 0)
                    || value.trailing_distance_ticks.is_some()
                        != value.trailing_stop_ticks.is_some() =>
            {
                Err(TargetSetFaultV2::InvalidProtection)
            }
            ProtectionProposalV1::AdjustTrailing { stop_ticks } if stop_ticks <= 0 => {
                Err(TargetSetFaultV2::InvalidProtection)
            }
            _ => Ok(()),
        }
    }

    fn encode_member(output: &mut [u8], member: MemberTargetV2) {
        let instrument = member.instrument.as_bytes();
        output[..instrument.len()].copy_from_slice(instrument);
        output[64] = instrument.len() as u8;
        output[65] = member.position as u8;
        output[66] = match member.target {
            TargetProposalV1::Keep => 0,
            TargetProposalV1::Position(_) => 1,
            TargetProposalV1::WeightMicros(_) => 2,
            TargetProposalV1::RebalancePosition { .. } => 3,
            TargetProposalV1::RebalanceWeightMicros { .. } => 4,
        };
        output[67] = match member.protection {
            ProtectionProposalV1::Keep => 0,
            ProtectionProposalV1::Replace(_) => 1,
            ProtectionProposalV1::AdjustTrailing { .. } => 2,
            ProtectionProposalV1::Clear => 3,
        };

        if let Some(value) = member.reconciliation_target_units {
            output[68] = 1;
            output[88..96].copy_from_slice(&value.to_le_bytes());
        }

        match member.target {
            TargetProposalV1::Keep => {}
            TargetProposalV1::Position(value) => {
                output[80..88].copy_from_slice(&value.to_le_bytes())
            }
            TargetProposalV1::WeightMicros(value) => {
                output[80..84].copy_from_slice(&value.to_le_bytes())
            }
            TargetProposalV1::RebalancePosition { sequence, units } => {
                output[72..80].copy_from_slice(&sequence.to_le_bytes());
                output[80..88].copy_from_slice(&units.to_le_bytes());
            }
            TargetProposalV1::RebalanceWeightMicros {
                sequence,
                weight_micros,
            } => {
                output[72..80].copy_from_slice(&sequence.to_le_bytes());
                output[80..84].copy_from_slice(&weight_micros.to_le_bytes());
            }
        }

        match member.protection {
            ProtectionProposalV1::Keep | ProtectionProposalV1::Clear => {}
            ProtectionProposalV1::AdjustTrailing { stop_ticks } => {
                output[128..136].copy_from_slice(&stop_ticks.to_le_bytes())
            }
            ProtectionProposalV1::Replace(value) => {
                encode_option_i64(output, 96, 104, value.stop_loss_ticks);
                encode_option_i64(output, 97, 112, value.take_profit_ticks);
                encode_option_u64(output, 98, 120, value.trailing_distance_ticks);
                encode_option_i64(output, 99, 128, value.trailing_stop_ticks);
            }
        }
    }

    fn decode_member(bytes: &[u8]) -> Result<MemberTargetV2, TargetSetFaultV2> {
        if bytes.len() != TARGET_SET_MEMBER_BYTES
            || bytes[69..72] != [0; 3]
            || bytes[100..104] != [0; 4]
            || bytes[136..144] != [0; 8]
        {
            return Err(TargetSetFaultV2::NonCanonicalEncoding);
        }
        let len = usize::from(bytes[64]);
        if len == 0
            || len > MAX_INSTRUMENT_KEY_BYTES
            || bytes[len..64].iter().any(|byte| *byte != 0)
        {
            return Err(TargetSetFaultV2::InvalidInstrument);
        }
        let instrument = InstrumentKeyV2::new(&bytes[..len])?;
        let position = match bytes[65] {
            1 => PositionIntentV1::Hold,
            2 => PositionIntentV1::Enter,
            3 => PositionIntentV1::Add,
            4 => PositionIntentV1::Reduce,
            5 => PositionIntentV1::Exit,
            _ => return Err(TargetSetFaultV2::InvalidTarget),
        };
        let target_sequence = read_u64(bytes, 72)?;
        let numeric = read_i64(bytes, 80)?;
        let target = match bytes[66] {
            0 if target_sequence == 0 && numeric == 0 => TargetProposalV1::Keep,
            1 if target_sequence == 0 => TargetProposalV1::Position(numeric),
            2 if target_sequence == 0 && bytes[84..88] == [0; 4] => {
                TargetProposalV1::WeightMicros(read_i32(bytes, 80)?)
            }
            3 => TargetProposalV1::RebalancePosition {
                sequence: target_sequence,
                units: numeric,
            },
            4 if bytes[84..88] == [0; 4] => TargetProposalV1::RebalanceWeightMicros {
                sequence: target_sequence,
                weight_micros: read_i32(bytes, 80)?,
            },
            _ => return Err(TargetSetFaultV2::InvalidTarget),
        };
        let reconciliation_target_units = match bytes[68] {
            0 if bytes[88..96] == [0; 8] => None,
            1 => Some(read_i64(bytes, 88)?),
            _ => return Err(TargetSetFaultV2::NonCanonicalEncoding),
        };
        let protection = match bytes[67] {
            0 if bytes[96..136] == [0; 40] => ProtectionProposalV1::Keep,
            1 => ProtectionProposalV1::Replace(ProtectionStateV1 {
                stop_loss_ticks: decode_option_i64(bytes, 96, 104)?,
                take_profit_ticks: decode_option_i64(bytes, 97, 112)?,
                trailing_distance_ticks: decode_option_u64(bytes, 98, 120)?,
                trailing_stop_ticks: decode_option_i64(bytes, 99, 128)?,
            }),
            2 if bytes[96..128] == [0; 32] => ProtectionProposalV1::AdjustTrailing {
                stop_ticks: read_i64(bytes, 128)?,
            },
            3 if bytes[96..136] == [0; 40] => ProtectionProposalV1::Clear,
            _ => return Err(TargetSetFaultV2::InvalidProtection),
        };
        Ok(MemberTargetV2 {
            instrument,
            position,
            target,
            reconciliation_target_units,
            protection,
        })
    }

    fn encode_option_i64(output: &mut [u8], flag: usize, offset: usize, value: Option<i64>) {
        if let Some(value) = value {
            output[flag] = 1;
            output[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }
    }

    fn encode_option_u64(output: &mut [u8], flag: usize, offset: usize, value: Option<u64>) {
        if let Some(value) = value {
            output[flag] = 1;
            output[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
        }
    }

    fn decode_option_i64(
        bytes: &[u8],
        flag: usize,
        offset: usize,
    ) -> Result<Option<i64>, TargetSetFaultV2> {
        match bytes[flag] {
            0 if bytes[offset..offset + 8] == [0; 8] => Ok(None),
            1 => Ok(Some(read_i64(bytes, offset)?)),
            _ => Err(TargetSetFaultV2::NonCanonicalEncoding),
        }
    }

    fn decode_option_u64(
        bytes: &[u8],
        flag: usize,
        offset: usize,
    ) -> Result<Option<u64>, TargetSetFaultV2> {
        match bytes[flag] {
            0 if bytes[offset..offset + 8] == [0; 8] => Ok(None),
            1 => Ok(Some(read_u64(bytes, offset)?)),
            _ => Err(TargetSetFaultV2::NonCanonicalEncoding),
        }
    }

    fn read<const N: usize>(bytes: &[u8], offset: usize) -> Result<[u8; N], TargetSetFaultV2> {
        bytes
            .get(offset..offset + N)
            .and_then(|value| value.try_into().ok())
            .ok_or(TargetSetFaultV2::InvalidLength)
    }
    fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, TargetSetFaultV2> {
        Ok(u16::from_le_bytes(read(bytes, offset)?))
    }
    fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, TargetSetFaultV2> {
        Ok(u64::from_le_bytes(read(bytes, offset)?))
    }
    fn read_i64(bytes: &[u8], offset: usize) -> Result<i64, TargetSetFaultV2> {
        Ok(i64::from_le_bytes(read(bytes, offset)?))
    }
    fn read_i32(bytes: &[u8], offset: usize) -> Result<i32, TargetSetFaultV2> {
        Ok(i32::from_le_bytes(read(bytes, offset)?))
    }
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
        encoder
            .push(meta(TIMER_RECORD, 97), &123_u64.to_le_bytes())
            .unwrap();
        let len = encoder.finish();
        let frame = Frame::decode(&bytes[..len]).unwrap();
        let mut records = frame.records();
        assert_eq!(records.next().unwrap().unwrap().scalar().unwrap(), 4.0);
        let unknown = records.next().unwrap().unwrap();
        assert_eq!(unknown.meta.type_id, 77);
        assert_eq!(unknown.payload, b"future");
        assert_eq!(records.next().unwrap().unwrap().timer().unwrap(), 123);
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

    mod lifecycle_kernel {
        use super::super::lifecycle_v1::*;
        use crate::{ACTION_CAPACITY, Action, ActionEncoder};
        use rstest::rstest;

        fn digest(value: u8) -> Digest {
            [value; 32]
        }

        fn identity(value: u8) -> StableIdentity {
            [value; 16]
        }

        fn identities() -> KernelIdentitiesV1 {
            KernelIdentitiesV1 {
                design_digest: digest(1),
                plan_digest: digest(2),
                artifact_digest: digest(3),
                program_host_digest: digest(4),
                kernel_digest: digest(5),
                plugin_digest: digest(6),
                market_semantics_digest: digest(7),
            }
        }

        fn envelope(
            sequence: u64,
            kind: LifecycleKind,
            payload: EnvelopePayloadV1,
        ) -> LifecycleEnvelopeV1 {
            LifecycleEnvelopeV1::new_bound(
                EventOrderKeyV1::new(
                    1_000 + sequence,
                    900 + sequence,
                    kind,
                    sequence,
                    identity(sequence as u8),
                )
                .unwrap(),
                payload,
            )
            .unwrap()
        }

        fn proposal(
            value: u8,
            position: PositionIntentV1,
            target: TargetProposalV1,
            reconciliation_target_units: Option<i64>,
            protection: ProtectionProposalV1,
        ) -> ProposalV1 {
            let mut proposal = ProposalV1 {
                intent_identity: identity(100 + value),
                proposal_digest: [0; 32],
                position,
                target,
                reconciliation_target_units,
                protection,
                strategy_state_digest: digest(150 + value),
                plugin_state_digest: digest(180 + value),
            };
            proposal.proposal_digest = derive_proposal_digest_v1(proposal).unwrap();
            proposal
        }

        fn fill(
            intent: u8,
            side: FillSideV1,
            disposition: FillDispositionV1,
            cumulative_filled_units: u64,
        ) -> EnvelopePayloadV1 {
            EnvelopePayloadV1::Fill(FillEventV1 {
                intent_identity: identity(100 + intent),
                side,
                disposition,
                cumulative_filled_units,
            })
        }

        fn host_step(
            kernel: &mut LifecycleKernelV1,
            guest_calls: &mut usize,
            envelope: LifecycleEnvelopeV1,
            proposal: Option<ProposalV1>,
        ) -> Result<ApplyOutcomeV1, KernelFaultV1> {
            match kernel.admit_envelope(envelope)? {
                EnvelopeAdmissionV1::Joined(outcome) => Ok(outcome),
                EnvelopeAdmissionV1::ProposalRequired(admitted) => {
                    *guest_calls += 1;
                    kernel.apply_admitted(admitted, proposal)
                }
                EnvelopeAdmissionV1::NoProposal(admitted) => {
                    kernel.apply_admitted(admitted, proposal)
                }
            }
        }

        #[rstest]
        fn envelope_wire_round_trips_every_payload_canonically() {
            let cases = [
                (LifecycleKind::Start, EnvelopePayloadV1::Start),
                (LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                (LifecycleKind::Event, EnvelopePayloadV1::Event),
                (
                    LifecycleKind::Fill,
                    fill(1, FillSideV1::Buy, FillDispositionV1::PartiallyFilled, 3),
                ),
                (
                    LifecycleKind::Fill,
                    fill(1, FillSideV1::Sell, FillDispositionV1::Filled, 8),
                ),
                (
                    LifecycleKind::Fill,
                    fill(1, FillSideV1::Buy, FillDispositionV1::Rejected, 0),
                ),
                (
                    LifecycleKind::Fill,
                    fill(1, FillSideV1::Sell, FillDispositionV1::Canceled, 2),
                ),
                (LifecycleKind::Timer, EnvelopePayloadV1::Timer),
                (LifecycleKind::Stop, EnvelopePayloadV1::Stop),
            ];

            for (offset, (kind, payload)) in cases.into_iter().enumerate() {
                let envelope = envelope(offset as u64 + 1, kind, payload);
                let first = encode_envelope_v1(envelope).unwrap();
                let second = encode_envelope_v1(envelope).unwrap();
                assert_eq!(first, second);
                let decoded = decode_envelope_v1(&first).unwrap();
                assert_eq!(decoded, envelope);
                assert_eq!(encode_envelope_v1(decoded).unwrap(), first);
            }
        }

        #[rstest]
        fn envelope_wire_rejects_tampered_unknown_and_inactive_fields() {
            let canonical =
                encode_envelope_v1(envelope(1, LifecycleKind::Bar, EnvelopePayloadV1::Bar))
                    .unwrap();
            assert_eq!(
                decode_envelope_v1(&canonical[..ENVELOPE_WIRE_BYTES - 1]),
                Err(EnvelopeCodecFaultV1::InvalidLength)
            );
            let mut extended = [0_u8; ENVELOPE_WIRE_BYTES + 1];
            extended[..ENVELOPE_WIRE_BYTES].copy_from_slice(&canonical);
            assert_eq!(
                decode_envelope_v1(&extended),
                Err(EnvelopeCodecFaultV1::InvalidLength)
            );
            let mut invalid_magic = canonical;
            invalid_magic[0] = 0;
            assert_eq!(
                decode_envelope_v1(&invalid_magic),
                Err(EnvelopeCodecFaultV1::InvalidMagic)
            );

            for (offset, value, expected) in [
                (4, 2, EnvelopeCodecFaultV1::UnsupportedVersion),
                (6, 2, EnvelopeCodecFaultV1::UnsupportedSchemaVersion),
                (8, 0, EnvelopeCodecFaultV1::UnknownLifecycleKind),
                (9, 0, EnvelopeCodecFaultV1::UnknownPayloadKind),
                (9, 5, EnvelopeCodecFaultV1::KindPayloadMismatch),
            ] {
                let mut malformed = canonical;
                malformed[offset] = value;
                assert_eq!(decode_envelope_v1(&malformed), Err(expected));
            }

            for offset in [10, 88, 120] {
                let mut malformed = canonical;
                malformed[offset] = 1;
                assert_eq!(
                    decode_envelope_v1(&malformed),
                    Err(EnvelopeCodecFaultV1::NonZeroReserved)
                );
            }

            let mut missing_sequence = canonical;
            missing_sequence[32..40].fill(0);
            assert_eq!(
                decode_envelope_v1(&missing_sequence),
                Err(EnvelopeCodecFaultV1::MissingOrderCoordinate)
            );
            let mut missing_identity = canonical;
            missing_identity[40..56].fill(0);
            assert_eq!(
                decode_envelope_v1(&missing_identity),
                Err(EnvelopeCodecFaultV1::MissingOrderCoordinate)
            );
            let mut missing_digest = canonical;
            missing_digest[56..88].fill(0);
            assert_eq!(
                decode_envelope_v1(&missing_digest),
                Err(EnvelopeCodecFaultV1::DigestMismatch)
            );

            let fill_bytes = encode_envelope_v1(envelope(
                2,
                LifecycleKind::Fill,
                fill(1, FillSideV1::Buy, FillDispositionV1::PartiallyFilled, 1),
            ))
            .unwrap();

            for (offset, value, expected) in [
                (104, 0, EnvelopeCodecFaultV1::UnknownFillSide),
                (105, 0, EnvelopeCodecFaultV1::UnknownFillDisposition),
                (106, 1, EnvelopeCodecFaultV1::NonZeroReserved),
            ] {
                let mut malformed = fill_bytes;
                malformed[offset] = value;
                assert_eq!(decode_envelope_v1(&malformed), Err(expected));
            }
            let mut missing_fill_identity = fill_bytes;
            missing_fill_identity[88..104].fill(0);
            assert_eq!(
                decode_envelope_v1(&missing_fill_identity),
                Err(EnvelopeCodecFaultV1::MalformedEnvelope)
            );

            let mut mismatched = envelope(3, LifecycleKind::Event, EnvelopePayloadV1::Event);
            mismatched.payload = EnvelopePayloadV1::Timer;
            assert_eq!(
                encode_envelope_v1(mismatched),
                Err(EnvelopeCodecFaultV1::MalformedEnvelope)
            );
        }

        #[rstest]
        fn lifecycle_content_addresses_are_domain_separated_and_fail_closed() {
            let start = envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start);
            assert_eq!(
                start.envelope_digest,
                [
                    0xcb, 0x1f, 0xbf, 0xe3, 0x84, 0xe6, 0x0c, 0x25, 0x42, 0xaf, 0xcc, 0x29, 0xee,
                    0xf9, 0x9b, 0x39, 0xbd, 0x91, 0x54, 0xd1, 0x82, 0x3c, 0xa9, 0x06, 0x54, 0x4b,
                    0xd0, 0x5b, 0x3d, 0xfd, 0x4c, 0x23,
                ]
            );
            assert_eq!(
                derive_envelope_digest_v1(start).unwrap(),
                start.envelope_digest
            );
            assert_eq!(
                LifecycleEnvelopeV1::new(start.order_key, start.envelope_digest, start.payload)
                    .unwrap(),
                start
            );
            assert_eq!(
                LifecycleEnvelopeV1::new(start.order_key, digest(99), start.payload),
                Err(KernelFaultV1::MalformedEnvelope)
            );

            let canonical_envelope = encode_envelope_v1(start).unwrap();
            for offset in [16, 56] {
                let mut tampered = canonical_envelope;
                tampered[offset] ^= 1;
                assert_eq!(
                    decode_envelope_v1(&tampered),
                    Err(EnvelopeCodecFaultV1::DigestMismatch)
                );
            }

            let sealed = proposal(
                1,
                PositionIntentV1::Enter,
                TargetProposalV1::Position(10),
                Some(10),
                ProtectionProposalV1::Keep,
            );
            assert_eq!(
                derive_proposal_digest_v1(sealed).unwrap(),
                sealed.proposal_digest
            );
            assert_ne!(sealed.proposal_digest, start.envelope_digest);
            let canonical_proposal = encode_proposal_v1(sealed).unwrap();
            for offset in [32, 128] {
                let mut tampered = canonical_proposal;
                tampered[offset] ^= 1;
                assert_eq!(
                    decode_proposal_v1(&tampered),
                    Err(ProposalCodecFaultV1::DigestMismatch)
                );
            }

            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            kernel.apply(start, None).unwrap();
            let checkpoint = kernel.checkpoint().encode();
            let mut bad_envelope = envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar);
            bad_envelope.order_key.logical_time_ns += 1;
            assert_eq!(
                kernel.apply(bad_envelope, Some(sealed)),
                Err(KernelFaultV1::MalformedEnvelope)
            );
            assert_eq!(kernel.checkpoint().encode(), checkpoint);

            let bar = envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar);
            let mut bad_proposal = sealed;
            bad_proposal.proposal_digest[0] ^= 1;
            assert_eq!(
                kernel.apply(bar, Some(bad_proposal)),
                Err(KernelFaultV1::InvalidProposal)
            );
            assert_eq!(kernel.checkpoint().encode(), checkpoint);

            let applied = kernel.apply(bar, Some(sealed)).unwrap();
            let applied_checkpoint = kernel.checkpoint().encode();
            let mut replay_content_tamper = sealed;
            replay_content_tamper.target = TargetProposalV1::Position(11);
            assert_eq!(
                kernel.apply(bar, Some(replay_content_tamper)),
                Err(KernelFaultV1::ConflictingEventIdentity)
            );
            assert_eq!(kernel.checkpoint().encode(), applied_checkpoint);
            let replay = kernel.apply(bar, Some(sealed)).unwrap();
            assert!(!applied.joined);
            assert!(replay.joined);
            assert_eq!(applied.trace.encode(), replay.trace.encode());
        }

        #[rstest]
        fn guest_proposal_gate_requires_zero_host_slots_and_canonical_bytes() {
            let guest_proposal = UnsealedGuestProposalV1::new(
                PositionIntentV1::Hold,
                TargetProposalV1::Keep,
                None,
                ProtectionProposalV1::Keep,
            )
            .unwrap();
            let bytes = encode_guest_proposal_v1(guest_proposal).unwrap();
            let decoded = decode_guest_proposal_v1(&bytes).unwrap();
            assert_eq!(decoded, guest_proposal);
            assert_eq!(encode_guest_proposal_v1(decoded).unwrap(), bytes);

            for (offset, expected) in [
                (16, GuestProposalFaultV1::NonZeroIntentIdentity),
                (32, GuestProposalFaultV1::NonZeroProposalDigest),
                (64, GuestProposalFaultV1::NonZeroStrategyStateDigest),
                (96, GuestProposalFaultV1::NonZeroPluginStateDigest),
            ] {
                let mut authored = bytes;
                authored[offset] = 1;
                assert_eq!(decode_guest_proposal_v1(&authored), Err(expected));
            }

            let mut noncanonical = bytes;
            noncanonical[216] = 1;
            assert_eq!(
                decode_guest_proposal_v1(&noncanonical),
                Err(GuestProposalFaultV1::Codec(
                    ProposalCodecFaultV1::NonZeroReserved
                ))
            );

            let mut old_action = [0_u8; ACTION_CAPACITY];
            let mut encoder = ActionEncoder::new(&mut old_action);
            encoder.push(Action::Cancel(9)).unwrap();
            let old_len = encoder.finish();
            assert_eq!(
                decode_guest_proposal_v1(&old_action[..old_len]),
                Err(GuestProposalFaultV1::Codec(
                    ProposalCodecFaultV1::InvalidLength
                ))
            );
        }

        #[rstest]
        fn host_seal_is_required_deterministic_and_fail_closed() {
            let guest_proposal = UnsealedGuestProposalV1::new(
                PositionIntentV1::Hold,
                TargetProposalV1::Keep,
                None,
                ProtectionProposalV1::Keep,
            )
            .unwrap();
            let derived = seal_guest_proposal_with_derived_digest_v1(
                guest_proposal,
                identity(101),
                digest(103),
                digest(104),
            )
            .unwrap();
            let seal = HostProposalSealV1 {
                intent_identity: derived.intent_identity,
                proposal_digest: derived.proposal_digest,
                strategy_state_digest: derived.strategy_state_digest,
                plugin_state_digest: derived.plugin_state_digest,
            };
            let first = seal_guest_proposal_v1(guest_proposal, seal).unwrap();
            let second = seal_guest_proposal_v1(guest_proposal, seal).unwrap();
            assert_eq!(first, second);

            let distinct = seal_guest_proposal_with_derived_digest_v1(
                guest_proposal,
                identity(105),
                seal.strategy_state_digest,
                seal.plugin_state_digest,
            )
            .unwrap();
            assert_ne!(first, distinct);

            let mut caller_selected = seal;
            caller_selected.proposal_digest = digest(102);
            assert_eq!(
                seal_guest_proposal_v1(guest_proposal, caller_selected),
                Err(HostProposalSealFaultV1::ProposalDigestMismatch)
            );

            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            kernel
                .apply(
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                )
                .unwrap();
            let admitted = match kernel
                .admit_envelope(envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar))
                .unwrap()
            {
                EnvelopeAdmissionV1::ProposalRequired(admitted) => admitted,
                _ => panic!("BAR must require a proposal"),
            };
            let checkpoint = kernel.checkpoint().encode();
            let malformed = [
                (
                    HostProposalSealV1 {
                        intent_identity: [0; 16],
                        ..seal
                    },
                    HostProposalSealFaultV1::MissingIntentIdentity,
                ),
                (
                    HostProposalSealV1 {
                        proposal_digest: [0; 32],
                        ..seal
                    },
                    HostProposalSealFaultV1::MissingProposalDigest,
                ),
                (
                    HostProposalSealV1 {
                        strategy_state_digest: [0; 32],
                        ..seal
                    },
                    HostProposalSealFaultV1::MissingStrategyStateDigest,
                ),
                (
                    HostProposalSealV1 {
                        plugin_state_digest: [0; 32],
                        ..seal
                    },
                    HostProposalSealFaultV1::MissingPluginStateDigest,
                ),
            ];

            for (malformed, expected) in malformed {
                assert_eq!(
                    seal_guest_proposal_v1(guest_proposal, malformed),
                    Err(expected)
                );
                assert_eq!(kernel.checkpoint().encode(), checkpoint);
            }
            kernel.apply_admitted(admitted, Some(first)).unwrap();
        }

        #[rstest]
        fn proposal_wire_round_trips_every_target_and_protection_variant_canonically() {
            let proposals = [
                proposal(
                    1,
                    PositionIntentV1::Hold,
                    TargetProposalV1::Keep,
                    None,
                    ProtectionProposalV1::Keep,
                ),
                proposal(
                    2,
                    PositionIntentV1::Enter,
                    TargetProposalV1::Position(10),
                    Some(10),
                    ProtectionProposalV1::Replace(ProtectionStateV1 {
                        stop_loss_ticks: Some(90),
                        take_profit_ticks: Some(130),
                        trailing_distance_ticks: Some(10),
                        trailing_stop_ticks: Some(95),
                    }),
                ),
                proposal(
                    3,
                    PositionIntentV1::Add,
                    TargetProposalV1::WeightMicros(500_000),
                    Some(12),
                    ProtectionProposalV1::AdjustTrailing { stop_ticks: 100 },
                ),
                proposal(
                    4,
                    PositionIntentV1::Reduce,
                    TargetProposalV1::RebalancePosition {
                        sequence: 7,
                        units: -4,
                    },
                    Some(-4),
                    ProtectionProposalV1::Clear,
                ),
                proposal(
                    5,
                    PositionIntentV1::Exit,
                    TargetProposalV1::RebalanceWeightMicros {
                        sequence: 8,
                        weight_micros: -250_000,
                    },
                    Some(0),
                    ProtectionProposalV1::Replace(ProtectionStateV1::default()),
                ),
            ];

            for proposal in proposals {
                let first = encode_proposal_v1(proposal).unwrap();
                let second = encode_proposal_v1(proposal).unwrap();
                assert_eq!(first, second);
                let decoded = decode_proposal_v1(&first).unwrap();
                assert_eq!(decoded, proposal);
                assert_eq!(encode_proposal_v1(decoded).unwrap(), first);
            }
        }

        #[rstest]
        fn proposal_wire_rejects_unknown_noncanonical_and_legacy_bytes() {
            let canonical = encode_proposal_v1(proposal(
                1,
                PositionIntentV1::Hold,
                TargetProposalV1::Keep,
                None,
                ProtectionProposalV1::Keep,
            ))
            .unwrap();
            assert_eq!(
                decode_proposal_v1(&canonical[..PROPOSAL_WIRE_BYTES - 1]),
                Err(ProposalCodecFaultV1::InvalidLength)
            );
            let mut extended = [0_u8; PROPOSAL_WIRE_BYTES + 1];
            extended[..PROPOSAL_WIRE_BYTES].copy_from_slice(&canonical);
            assert_eq!(
                decode_proposal_v1(&extended),
                Err(ProposalCodecFaultV1::InvalidLength)
            );

            for (offset, value, expected) in [
                (4, 2, ProposalCodecFaultV1::UnsupportedVersion),
                (6, 0, ProposalCodecFaultV1::UnknownPositionIntent),
                (7, 9, ProposalCodecFaultV1::UnknownTarget),
                (8, 9, ProposalCodecFaultV1::UnknownProtection),
            ] {
                let mut malformed = canonical;
                malformed[offset] = value;
                assert_eq!(decode_proposal_v1(&malformed), Err(expected));
            }

            for offset in [10, 128, 216] {
                let mut malformed = canonical;
                malformed[offset] = 1;
                assert_eq!(
                    decode_proposal_v1(&malformed),
                    Err(ProposalCodecFaultV1::NonZeroReserved)
                );
            }

            let mut malformed_option = canonical;
            malformed_option[9] = 2;
            assert_eq!(
                decode_proposal_v1(&malformed_option),
                Err(ProposalCodecFaultV1::NonCanonicalOption)
            );
            let mut absent_with_value = canonical;
            absent_with_value[152] = 1;
            assert_eq!(
                decode_proposal_v1(&absent_with_value),
                Err(ProposalCodecFaultV1::NonZeroReserved)
            );
            let mut malformed_protection_option = canonical;
            malformed_protection_option[8] = 1;
            malformed_protection_option[168] = 2;
            assert_eq!(
                decode_proposal_v1(&malformed_protection_option),
                Err(ProposalCodecFaultV1::NonCanonicalOption)
            );

            let mut old_action = [0_u8; ACTION_CAPACITY];
            let mut encoder = ActionEncoder::new(&mut old_action);
            encoder.push(Action::Cancel(7)).unwrap();
            let old_len = encoder.finish();
            assert_eq!(
                decode_proposal_v1(&old_action[..old_len]),
                Err(ProposalCodecFaultV1::InvalidLength)
            );
            let mut padded_action = [0_u8; PROPOSAL_WIRE_BYTES];
            padded_action[..old_len].copy_from_slice(&old_action[..old_len]);
            assert_eq!(
                decode_proposal_v1(&padded_action),
                Err(ProposalCodecFaultV1::InvalidMagic)
            );
        }

        #[rstest]
        fn proposal_wire_enforces_static_target_bounds_only() {
            let mut invalid = proposal(
                1,
                PositionIntentV1::Enter,
                TargetProposalV1::WeightMicros(1_000_000),
                Some(1),
                ProtectionProposalV1::Keep,
            );
            invalid.target = TargetProposalV1::WeightMicros(1_000_001);
            assert_eq!(
                encode_proposal_v1(invalid),
                Err(ProposalCodecFaultV1::TargetOutOfRange)
            );

            let mut malformed = encode_proposal_v1(proposal(
                2,
                PositionIntentV1::Enter,
                TargetProposalV1::WeightMicros(1_000_000),
                Some(1),
                ProtectionProposalV1::Keep,
            ))
            .unwrap();
            malformed[128..132].copy_from_slice(&1_000_001_i32.to_le_bytes());
            assert_eq!(
                decode_proposal_v1(&malformed),
                Err(ProposalCodecFaultV1::TargetOutOfRange)
            );
        }

        #[rstest]
        fn pre_guest_admission_joins_and_rejects_without_guest_calls() {
            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            let mut guest_calls = 0;
            host_step(
                &mut kernel,
                &mut guest_calls,
                envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                None,
            )
            .unwrap();
            assert_eq!(guest_calls, 0);

            let bar = envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar);
            let enter = proposal(
                1,
                PositionIntentV1::Enter,
                TargetProposalV1::Position(1),
                Some(1),
                ProtectionProposalV1::Keep,
            );
            host_step(&mut kernel, &mut guest_calls, bar, Some(enter)).unwrap();
            assert_eq!(guest_calls, 1);
            let replay = host_step(&mut kernel, &mut guest_calls, bar, None).unwrap();
            assert!(replay.joined);
            assert_eq!(guest_calls, 1);

            let mut conflict = bar;
            conflict.envelope_digest = digest(99);
            assert_eq!(
                host_step(&mut kernel, &mut guest_calls, conflict, None),
                Err(KernelFaultV1::MalformedEnvelope)
            );
            assert_eq!(
                host_step(
                    &mut kernel,
                    &mut guest_calls,
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                ),
                Err(KernelFaultV1::OrderingRegression)
            );

            let missing_coordinate = LifecycleEnvelopeV1 {
                schema_version: LIFECYCLE_SCHEMA_VERSION,
                order_key: EventOrderKeyV1 {
                    logical_time_ns: 2_000,
                    event_time_ns: 2_000,
                    kind: LifecycleKind::Bar,
                    owner_sequence: 0,
                    event_identity: identity(9),
                },
                envelope_digest: digest(9),
                payload: EnvelopePayloadV1::Bar,
            };
            assert_eq!(
                host_step(&mut kernel, &mut guest_calls, missing_coordinate, None),
                Err(KernelFaultV1::MissingOrderCoordinate)
            );
            assert_eq!(guest_calls, 1);

            host_step(
                &mut kernel,
                &mut guest_calls,
                envelope(
                    3,
                    LifecycleKind::Fill,
                    fill(1, FillSideV1::Buy, FillDispositionV1::Filled, 1),
                ),
                None,
            )
            .unwrap();
            host_step(
                &mut kernel,
                &mut guest_calls,
                envelope(4, LifecycleKind::Stop, EnvelopePayloadV1::Stop),
                None,
            )
            .unwrap();
            assert_eq!(guest_calls, 1);
            assert_eq!(
                host_step(
                    &mut kernel,
                    &mut guest_calls,
                    envelope(5, LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                    Some(proposal(
                        2,
                        PositionIntentV1::Hold,
                        TargetProposalV1::Keep,
                        None,
                        ProtectionProposalV1::Keep,
                    )),
                ),
                Err(KernelFaultV1::AlreadyStopped)
            );
            assert_eq!(guest_calls, 1);
        }

        #[rstest]
        fn admitted_token_fails_closed_after_kernel_state_changes() {
            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            kernel
                .apply(
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                )
                .unwrap();
            let bar = envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar);
            let first = match kernel.admit_envelope(bar).unwrap() {
                EnvelopeAdmissionV1::ProposalRequired(admitted) => admitted,
                _ => panic!("BAR must require a proposal"),
            };
            let stale = match kernel.admit_envelope(bar).unwrap() {
                EnvelopeAdmissionV1::ProposalRequired(admitted) => admitted,
                _ => panic!("BAR must require a proposal"),
            };
            let hold = proposal(
                1,
                PositionIntentV1::Hold,
                TargetProposalV1::Keep,
                None,
                ProtectionProposalV1::Keep,
            );
            kernel.apply_admitted(first, Some(hold)).unwrap();
            let checkpoint = kernel.checkpoint().encode();
            assert_eq!(
                kernel.apply_admitted(stale, Some(hold)),
                Err(KernelFaultV1::StaleAdmission)
            );
            assert_eq!(kernel.checkpoint().encode(), checkpoint);
        }

        #[rstest]
        fn stateful_trend_corpus_and_checkpoint_restart_are_byte_identical() {
            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            kernel
                .apply(
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                )
                .unwrap();
            let warmup = kernel
                .apply(
                    envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                    Some(proposal(
                        1,
                        PositionIntentV1::Hold,
                        TargetProposalV1::Keep,
                        None,
                        ProtectionProposalV1::Keep,
                    )),
                )
                .unwrap();
            assert_eq!(warmup.trace.position_intent.semantic_id(), HOLD_SEMANTIC_ID);

            let protection = ProtectionStateV1 {
                stop_loss_ticks: Some(90),
                take_profit_ticks: Some(130),
                trailing_distance_ticks: Some(10),
                trailing_stop_ticks: Some(90),
            };
            let enter_envelope = envelope(3, LifecycleKind::Bar, EnvelopePayloadV1::Bar);
            let enter_proposal = proposal(
                2,
                PositionIntentV1::Enter,
                TargetProposalV1::Position(10),
                Some(10),
                ProtectionProposalV1::Replace(protection),
            );
            let enter = kernel.apply(enter_envelope, Some(enter_proposal)).unwrap();
            assert_eq!(enter.trace.position_after_units, 0);
            assert_eq!(
                enter.trace.target_semantic.semantic_id(),
                Some(TARGET_POSITION_SEMANTIC_ID)
            );
            assert!(
                enter
                    .trace
                    .protection_semantics
                    .contains(ProtectionSemanticSetV1::STOP_LOSS)
            );
            let joined = kernel.apply(enter_envelope, Some(enter_proposal)).unwrap();
            assert!(joined.joined);
            assert_eq!(joined.trace.encode(), enter.trace.encode());
            let mut conflicting_proposal = enter_proposal;
            conflicting_proposal.proposal_digest = digest(99);
            assert_eq!(
                kernel.apply(enter_envelope, Some(conflicting_proposal)),
                Err(KernelFaultV1::ConflictingEventIdentity)
            );

            kernel
                .apply(
                    envelope(
                        4,
                        LifecycleKind::Fill,
                        fill(2, FillSideV1::Buy, FillDispositionV1::PartiallyFilled, 4),
                    ),
                    None,
                )
                .unwrap();
            kernel
                .apply(
                    envelope(
                        5,
                        LifecycleKind::Fill,
                        fill(2, FillSideV1::Buy, FillDispositionV1::Filled, 10),
                    ),
                    None,
                )
                .unwrap();
            kernel
                .apply(
                    envelope(6, LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                    Some(proposal(
                        3,
                        PositionIntentV1::Add,
                        TargetProposalV1::Position(15),
                        Some(15),
                        ProtectionProposalV1::Keep,
                    )),
                )
                .unwrap();
            kernel
                .apply(
                    envelope(
                        7,
                        LifecycleKind::Fill,
                        fill(3, FillSideV1::Buy, FillDispositionV1::Filled, 5),
                    ),
                    None,
                )
                .unwrap();
            kernel
                .apply(
                    envelope(8, LifecycleKind::Event, EnvelopePayloadV1::Event),
                    Some(proposal(
                        4,
                        PositionIntentV1::Reduce,
                        TargetProposalV1::Position(8),
                        Some(8),
                        ProtectionProposalV1::Keep,
                    )),
                )
                .unwrap();
            kernel
                .apply(
                    envelope(
                        9,
                        LifecycleKind::Fill,
                        fill(4, FillSideV1::Sell, FillDispositionV1::Filled, 7),
                    ),
                    None,
                )
                .unwrap();

            let restart_checkpoint = kernel.checkpoint();
            let mut restarted =
                LifecycleKernelV1::restore(identities(), restart_checkpoint).unwrap();
            let hold_envelope = envelope(10, LifecycleKind::Bar, EnvelopePayloadV1::Bar);
            let hold_proposal = proposal(
                5,
                PositionIntentV1::Hold,
                TargetProposalV1::Keep,
                None,
                ProtectionProposalV1::AdjustTrailing { stop_ticks: 95 },
            );
            let uninterrupted_hold = kernel.apply(hold_envelope, Some(hold_proposal)).unwrap();
            let restarted_hold = restarted.apply(hold_envelope, Some(hold_proposal)).unwrap();
            assert_eq!(
                uninterrupted_hold.trace.encode(),
                restarted_hold.trace.encode()
            );
            assert_eq!(
                uninterrupted_hold.trace.protection.trailing_stop_ticks,
                Some(95)
            );
            assert!(
                uninterrupted_hold
                    .trace
                    .protection_semantics
                    .contains(ProtectionSemanticSetV1::TRAILING_ADJUST)
            );

            let exit_envelope = envelope(11, LifecycleKind::Timer, EnvelopePayloadV1::Timer);
            let exit_proposal = proposal(
                6,
                PositionIntentV1::Exit,
                TargetProposalV1::Position(0),
                Some(0),
                ProtectionProposalV1::Clear,
            );
            let a = kernel.apply(exit_envelope, Some(exit_proposal)).unwrap();
            let b = restarted.apply(exit_envelope, Some(exit_proposal)).unwrap();
            assert_eq!(a.trace.encode(), b.trace.encode());
            assert_eq!(a.trace.position_after_units, 8);

            let exit_fill = envelope(
                12,
                LifecycleKind::Fill,
                fill(6, FillSideV1::Sell, FillDispositionV1::Filled, 8),
            );
            let a = kernel.apply(exit_fill, None).unwrap();
            let b = restarted.apply(exit_fill, None).unwrap();
            assert_eq!(a.trace.encode(), b.trace.encode());
            assert_eq!(a.trace.position_after_units, 0);
            kernel
                .apply(
                    envelope(13, LifecycleKind::Stop, EnvelopePayloadV1::Stop),
                    None,
                )
                .unwrap();
            restarted
                .apply(
                    envelope(13, LifecycleKind::Stop, EnvelopePayloadV1::Stop),
                    None,
                )
                .unwrap();
            assert_eq!(
                kernel.checkpoint().encode(),
                restarted.checkpoint().encode()
            );
        }

        #[rstest]
        fn ordering_conflicts_and_invalid_transitions_leave_state_unchanged() {
            assert_eq!(
                EventOrderKeyV1::new(1, 1, LifecycleKind::Start, 0, identity(1)),
                Err(KernelFaultV1::MissingOrderCoordinate)
            );
            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            let start = envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start);
            kernel.apply(start, None).unwrap();
            let checkpoint = kernel.checkpoint().encode();

            let mut conflict = start;
            conflict.envelope_digest = digest(99);
            assert_eq!(
                kernel.apply(conflict, None),
                Err(KernelFaultV1::MalformedEnvelope)
            );
            assert_eq!(kernel.checkpoint().encode(), checkpoint);

            let earlier = LifecycleEnvelopeV1::new_bound(
                EventOrderKeyV1::new(1, 1, LifecycleKind::Start, 1, identity(9)).unwrap(),
                EnvelopePayloadV1::Start,
            )
            .unwrap();
            assert_eq!(
                kernel.apply(earlier, None),
                Err(KernelFaultV1::OrderingRegression)
            );

            let invalid_add = proposal(
                1,
                PositionIntentV1::Add,
                TargetProposalV1::Position(2),
                Some(2),
                ProtectionProposalV1::Keep,
            );
            assert_eq!(
                kernel.apply(
                    envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                    Some(invalid_add)
                ),
                Err(KernelFaultV1::InvalidPositionTransition)
            );
            assert_eq!(kernel.checkpoint().encode(), checkpoint);

            let invalid_protection = proposal(
                2,
                PositionIntentV1::Hold,
                TargetProposalV1::Keep,
                None,
                ProtectionProposalV1::AdjustTrailing { stop_ticks: 10 },
            );
            assert_eq!(
                kernel.apply(
                    envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                    Some(invalid_protection)
                ),
                Err(KernelFaultV1::InvalidProtection)
            );
            assert_eq!(kernel.checkpoint().encode(), checkpoint);

            kernel
                .apply(
                    envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                    Some(proposal(
                        3,
                        PositionIntentV1::Enter,
                        TargetProposalV1::Position(2),
                        Some(2),
                        ProtectionProposalV1::Keep,
                    )),
                )
                .unwrap();
            let pending = kernel.checkpoint().encode();
            assert_eq!(
                kernel.apply(
                    envelope(
                        3,
                        LifecycleKind::Fill,
                        fill(3, FillSideV1::Buy, FillDispositionV1::Filled, 3),
                    ),
                    None
                ),
                Err(KernelFaultV1::InvalidFillProgress)
            );
            assert_eq!(kernel.checkpoint().encode(), pending);
        }

        #[rstest]
        fn rejected_and_canceled_fills_never_mint_unfilled_position() {
            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            kernel
                .apply(
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                )
                .unwrap();
            kernel
                .apply(
                    envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                    Some(proposal(
                        1,
                        PositionIntentV1::Enter,
                        TargetProposalV1::WeightMicros(500_000),
                        Some(10),
                        ProtectionProposalV1::Keep,
                    )),
                )
                .unwrap();
            assert_eq!(kernel.checkpoint().reconciled_position_units, 0);
            kernel
                .apply(
                    envelope(
                        3,
                        LifecycleKind::Fill,
                        fill(1, FillSideV1::Buy, FillDispositionV1::Rejected, 0),
                    ),
                    None,
                )
                .unwrap();
            assert_eq!(kernel.checkpoint().reconciled_position_units, 0);

            kernel
                .apply(
                    envelope(4, LifecycleKind::Event, EnvelopePayloadV1::Event),
                    Some(proposal(
                        2,
                        PositionIntentV1::Enter,
                        TargetProposalV1::RebalanceWeightMicros {
                            sequence: 1,
                            weight_micros: 500_000,
                        },
                        Some(10),
                        ProtectionProposalV1::Keep,
                    )),
                )
                .unwrap();
            kernel
                .apply(
                    envelope(
                        5,
                        LifecycleKind::Fill,
                        fill(2, FillSideV1::Buy, FillDispositionV1::PartiallyFilled, 3),
                    ),
                    None,
                )
                .unwrap();
            kernel
                .apply(
                    envelope(
                        6,
                        LifecycleKind::Fill,
                        fill(2, FillSideV1::Buy, FillDispositionV1::Canceled, 3),
                    ),
                    None,
                )
                .unwrap();
            assert_eq!(kernel.checkpoint().reconciled_position_units, 3);
            assert_eq!(
                kernel.checkpoint().fill_frontier.terminal_disposition,
                Some(FillDispositionV1::Canceled)
            );
        }

        #[rstest]
        fn restore_rejects_identity_and_checkpoint_mismatch() {
            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            kernel
                .apply(
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                )
                .unwrap();
            let checkpoint = kernel.checkpoint();
            let mut different_trace = checkpoint;
            different_trace.last_trace.position_before_units = 1;
            assert_ne!(checkpoint.encode(), different_trace.encode());
            assert_eq!(
                &checkpoint.encode()[CHECKPOINT_TRACE_OFFSET..],
                checkpoint.last_trace.encode().as_slice()
            );

            let mut wrong = identities();
            wrong.plan_digest = digest(99);
            assert_eq!(
                LifecycleKernelV1::restore(wrong, checkpoint),
                Err(KernelFaultV1::IdentityMismatch)
            );

            let mut malformed = checkpoint;
            malformed.reconciled_position_units = 2;
            assert_eq!(
                LifecycleKernelV1::restore(identities(), malformed),
                Err(KernelFaultV1::InvalidCheckpoint)
            );
        }

        #[rstest]
        fn checkpoint_codec_round_trips_initial_and_active_state_canonically() {
            let initial = LifecycleKernelV1::new(identities()).unwrap().checkpoint();
            let initial_bytes = initial.encode();
            let decoded_initial = CheckpointV1::decode(&initial_bytes).unwrap();
            assert_eq!(decoded_initial, initial);
            assert_eq!(decoded_initial.encode(), initial_bytes);

            let mut kernel =
                LifecycleKernelV1::new_with_state_digests(identities(), digest(80), digest(81))
                    .unwrap();
            kernel
                .apply(
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                )
                .unwrap();
            kernel
                .apply(
                    envelope(2, LifecycleKind::Bar, EnvelopePayloadV1::Bar),
                    Some(proposal(
                        1,
                        PositionIntentV1::Enter,
                        TargetProposalV1::Position(10),
                        Some(10),
                        ProtectionProposalV1::Replace(ProtectionStateV1 {
                            stop_loss_ticks: Some(90),
                            take_profit_ticks: Some(120),
                            trailing_distance_ticks: Some(5),
                            trailing_stop_ticks: Some(95),
                        }),
                    )),
                )
                .unwrap();
            let bytes = kernel.checkpoint().encode();
            let decoded = CheckpointV1::decode(&bytes).unwrap();
            assert_eq!(decoded, kernel.checkpoint());
            assert_eq!(decoded.encode(), bytes);
            assert_eq!(
                LifecycleKernelV1::restore(identities(), decoded)
                    .unwrap()
                    .checkpoint()
                    .encode(),
                bytes
            );
        }

        #[rstest]
        fn checkpoint_codec_rejects_header_reserved_and_semantic_tampering() {
            let mut kernel = LifecycleKernelV1::new(identities()).unwrap();
            kernel
                .apply(
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                )
                .unwrap();
            let bytes = kernel.checkpoint().encode();
            assert_eq!(
                CheckpointV1::decode(&bytes[..CHECKPOINT_BYTES - 1]),
                Err(CheckpointCodecFaultV1::InvalidLength)
            );
            let extended = [0_u8; CHECKPOINT_BYTES + 1];
            assert_eq!(
                CheckpointV1::decode(&extended),
                Err(CheckpointCodecFaultV1::InvalidLength)
            );

            let mut bad = bytes;
            bad[0..2].copy_from_slice(&2_u16.to_le_bytes());
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::UnsupportedVersion)
            );
            bad = bytes;
            bad[2] = 1;
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::InvalidMagic)
            );
            bad = bytes;
            bad[6] = 1;
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::NonZeroReserved)
            );
            bad = bytes;
            bad[232] = 2;
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::NonCanonicalOption)
            );
            bad = bytes;
            bad[408] = 9;
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::UnknownTarget)
            );
            bad = bytes;
            bad[440] = 2;
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::NonCanonicalOption)
            );
            bad = bytes;
            bad[512] = 9;
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::UnknownFillDisposition)
            );
            bad = bytes;
            bad[560] = 2;
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::NonCanonicalOption)
            );
            bad = bytes;
            bad[CHECKPOINT_TRACE_OFFSET..CHECKPOINT_TRACE_OFFSET + 2]
                .copy_from_slice(&2_u16.to_le_bytes());
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::UnsupportedTraceVersion)
            );
            bad = bytes;
            bad[CHECKPOINT_TRACE_OFFSET + 56] ^= 1;
            assert_eq!(
                CheckpointV1::decode(&bad),
                Err(CheckpointCodecFaultV1::InvalidCheckpoint)
            );
        }

        #[rstest]
        fn initial_state_digests_are_bound_and_invalid_inputs_leave_state_unchanged() {
            let legacy = LifecycleKernelV1::new(identities()).unwrap();
            assert_eq!(legacy.checkpoint().strategy_state_digest, [0; 32]);
            assert_eq!(legacy.checkpoint().plugin_state_digest, [0; 32]);
            let legacy_bytes = legacy.checkpoint().encode();

            assert_eq!(
                LifecycleKernelV1::new_with_state_digests(identities(), [0; 32], digest(81)),
                Err(KernelFaultV1::InvalidCheckpoint)
            );
            assert_eq!(
                LifecycleKernelV1::new_with_state_digests(identities(), digest(80), [0; 32]),
                Err(KernelFaultV1::InvalidCheckpoint)
            );
            assert_eq!(legacy.checkpoint().encode(), legacy_bytes);

            let mut initialized =
                LifecycleKernelV1::new_with_state_digests(identities(), digest(80), digest(81))
                    .unwrap();
            assert_eq!(initialized.checkpoint().strategy_state_digest, digest(80));
            assert_eq!(initialized.checkpoint().plugin_state_digest, digest(81));
            assert_eq!(
                LifecycleKernelV1::restore(identities(), initialized.checkpoint())
                    .unwrap()
                    .checkpoint()
                    .encode(),
                initialized.checkpoint().encode()
            );
            initialized
                .apply(
                    envelope(1, LifecycleKind::Start, EnvelopePayloadV1::Start),
                    None,
                )
                .unwrap();
            assert_eq!(
                initialized.checkpoint().last_trace.strategy_state_digest,
                digest(80)
            );
            assert_eq!(
                initialized.checkpoint().last_trace.plugin_state_digest,
                digest(81)
            );

            let unchanged = initialized.checkpoint().encode();
            let mut malformed = initialized.checkpoint();
            malformed.last_trace.plugin_state_digest = digest(99);
            assert_eq!(
                LifecycleKernelV1::restore(identities(), malformed),
                Err(KernelFaultV1::InvalidCheckpoint)
            );
            assert_eq!(initialized.checkpoint().encode(), unchanged);
        }
    }
}
