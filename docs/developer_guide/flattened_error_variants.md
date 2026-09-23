# Flattened public error variants

Public error-enum variants whose cause never reaches a caller: every production site of the variant is separated from the edge by a step that discards it.

The list finds cases where the cause never reaches the caller. Whether that is a defect has to be judged against the channel scope rule of the Owner that holds it. Some flattenings are deliberate fail-closed contracts.

A snapshot of `769b50286`, not a live answer: code merged after it is not in this list, and variants fixed after it are still in it. Regenerate the whole file before relying on it:

```text
scripts/flattened-error-variants.py --rev 769b50286 > docs/developer_guide/flattened_error_variants.md
```

The tool is calibrated on synthetic source by `scripts/flattened-error-variants_test.py`, not on this repository; what follows is output, and nothing in it is a gate.

At `ba8f9bf5f` this listed `NativeReplayExecutionInputBindingErrorV1::Conflict`, flattened at `crates/strategy_factory/src/native_replay_initial_binding_issuance_v1.rs:122` by `.map_err(|_| ..)` into a unit struct, so a refusal reached its caller as a 503; #894 made it reach its caller as a conflict.

232 public error enum names in production modules; 6 are declared more than once and are skipped; 1451 variants in the rest.

```text
    2  listed
    0  renamed
   68  flat-where-followed
  486  undetermined
  318  reaches-boundary
  311  observed
  266  unconstructed
-----
 1451
```

## Flattened on every path (2)

Every path the walk could follow ended in a discard.

- `InstrumentMasterV2Error::SuccessorMismatch`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:361`
  - flattened at `crates/data/src/owner/instrument_master_v2_postgres.rs:380` by map_err(|_| ..), becomes `InstrumentMasterCustodyErrorV2::ChainMismatch`, 6 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - **ruling:** flattened on purpose: a meaning refusal, which Market Data's channel rule excludes, and `ChainMismatch` is the Owner's own name for it
- `SourceIntakeError::ResponseBoundExceeded`
  - produced at `crates/strategy_factory/src/source_intake/openalex_http.rs:506`
  - produced at `crates/strategy_factory/src/source_intake/openalex_http.rs:532`
  - produced at `crates/strategy_factory/src/source_intake/openalex_http.rs:558`
  - produced at `crates/strategy_factory/src/source_intake/openalex_http.rs:560`
  - flattened at `crates/strategy_factory/src/source_intake/openalex_http.rs:350` by .ok(), becomes `None`, 2 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/source_intake/openalex_http.rs:365` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 2 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/source_intake/openalex_http.rs:394` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 2 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - **ruling:** flattened on purpose: every path refuses explicitly as `Malformed` and none returns a truncated body; distinguishing it needs a schema change to the persisted `AcquisitionTerminalV1`

## Renamed, not lost (0)

Every path ends in a discard, but only this one value of its enum reaches each of them, so no information is dropped there - only its name. What it becomes still matters: a permanent failure renamed as a transient one misleads a caller as much as a flattening.

## Flattened wherever followed (68)

Every path the walk could follow ended in a discard, and at least one path could not be followed.

- `AdapterBindingError::BindingIncompatible`
  - produced at `crates/execution_owner/src/adapter_binding.rs:769`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `AdapterBindingError::BindingRevoked`
  - produced at `crates/execution_owner/src/adapter_binding.rs:767`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `AdapterBindingError::BindingSuperseded`
  - produced at `crates/execution_owner/src/adapter_binding.rs:765`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `AdapterBindingError::CapabilityMismatch`
  - produced at `crates/execution_owner/src/adapter_binding.rs:777`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `AdapterBindingError::FactNotFound`
  - produced at `crates/execution_owner/src/adapter_binding_postgres.rs:744`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `AdapterBindingError::InvalidCapabilities`
  - produced at `crates/execution_owner/src/adapter_binding.rs:1172`
  - produced at `crates/execution_owner/src/adapter_binding.rs:1215`
  - produced at `crates/execution_owner/src/adapter_binding.rs:1219`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `AdapterBindingError::LocatorMismatch`
  - produced at `crates/execution_owner/src/adapter_binding.rs:748`
  - produced at `crates/execution_owner/src/adapter_binding.rs:756`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `AdapterBindingError::NotCurrentHead`
  - produced at `crates/execution_owner/src/adapter_binding.rs:752`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `AdapterBindingError::TimeMismatch`
  - produced at `crates/execution_owner/src/adapter_binding.rs:785`
  - flattened at `crates/execution_owner/src/adapter_binding_postgres.rs:531` by map_err(|_| ..), becomes `PaperAccountOpeningError::BindingNotAdmitted`, 9 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `BetfairHttpError::LoginFailed`
  - produced at `crates/adapters/betfair/src/http/client.rs:220`
  - produced at `crates/adapters/betfair/src/http/client.rs:267`
  - flattened at `crates/adapters/betfair/src/execution.rs:3129` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 3 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `BetfairHttpError::NetworkError`
  - produced at `crates/adapters/betfair/src/http/client.rs:345`
  - produced at `crates/adapters/betfair/src/http/client.rs:445`
  - produced at `crates/adapters/betfair/src/http/client.rs:506`
  - produced at `crates/adapters/betfair/src/http/client.rs:554`
  - produced at `crates/adapters/betfair/src/http/error.rs:58`
  - flattened at `crates/adapters/betfair/src/execution.rs:3129` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 3 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `BetfairHttpError::UnexpectedStatus`
  - produced at `crates/adapters/betfair/src/http/client.rs:349`
  - produced at `crates/adapters/betfair/src/http/client.rs:449`
  - produced at `crates/adapters/betfair/src/http/client.rs:518`
  - flattened at `crates/adapters/betfair/src/execution.rs:3129` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 3 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `BlockchainRpcClientError::AbiDecodingError`
  - produced at `crates/adapters/blockchain/src/contracts/base.rs:178`
  - produced at `crates/adapters/blockchain/src/contracts/base.rs:198`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:264`
  - flattened at `crates/adapters/blockchain/src/execution/client.rs:163` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 2 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `CalendarErrorV1::CapacityExceeded`
  - produced at `crates/data/src/owner/calendar/authority.rs:340`
  - produced at `crates/data/src/owner/calendar/authority.rs:341`
  - produced at `crates/data/src/owner/calendar/authority.rs:426`
  - produced at `crates/data/src/owner/calendar/authority.rs:432`
  - produced at `crates/data/src/owner/calendar/authority.rs:458`
  - produced at `crates/data/src/owner/calendar/authority.rs:474`
  - produced at `crates/data/src/owner/calendar/authority.rs:476`
  - produced at `crates/data/src/owner/calendar/authority.rs:563`
  - produced at `crates/data/src/owner/calendar/authority.rs:565`
  - produced at `crates/data/src/owner/calendar/authority.rs:571`
  - produced at `crates/data/src/owner/calendar/authority.rs:573`
  - produced at `crates/data/src/owner/calendar/authority.rs:664`
  - produced at `crates/data/src/owner/calendar/authority.rs:665`
  - produced at `crates/data/src/owner/calendar/authority.rs:680`
  - produced at `crates/data/src/owner/calendar/authority.rs:682`
  - produced at `crates/data/src/owner/calendar/codec.rs:32`
  - produced at `crates/data/src/owner/calendar/codec.rs:81`
  - produced at `crates/data/src/owner/calendar/codec.rs:83`
  - produced at `crates/data/src/owner/calendar/codec.rs:186`
  - produced at `crates/data/src/owner/calendar/codec.rs:188`
  - flattened at `crates/data/src/owner/calendar/authority.rs:641` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 1 value(s) of it reach here, 13 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/session/authority.rs:410` by map_err(|_| ..), becomes `SessionErrorV1::InvalidDependency`, 3 value(s) of it reach here, 11 sibling(s) the walk could not finish
- `CalendarErrorV1::CoverageGap`
  - produced at `crates/data/src/owner/calendar/authority.rs:81`
  - produced at `crates/data/src/owner/calendar/authority.rs:89`
  - produced at `crates/data/src/owner/calendar/authority.rs:95`
  - produced at `crates/data/src/owner/calendar/authority.rs:308`
  - produced at `crates/data/src/owner/calendar/authority.rs:357`
  - produced at `crates/data/src/owner/calendar/authority.rs:658`
  - produced at `crates/data/src/owner/calendar/authority.rs:672`
  - flattened at `crates/data/src/owner/session/authority.rs:410` by map_err(|_| ..), becomes `SessionErrorV1::InvalidDependency`, 3 value(s) of it reach here, 11 sibling(s) the walk could not finish
- `CalendarErrorV1::DigestMismatch`
  - produced at `crates/data/src/owner/calendar/authority.rs:258`
  - produced at `crates/data/src/owner/calendar/authority.rs:327`
  - produced at `crates/data/src/owner/calendar/authority.rs:352`
  - produced at `crates/data/src/owner/calendar/authority.rs:542`
  - produced at `crates/data/src/owner/calendar/authority.rs:598`
  - produced at `crates/data/src/owner/calendar/authority.rs:626`
  - flattened at `crates/data/src/owner/session/authority.rs:410` by map_err(|_| ..), becomes `SessionErrorV1::InvalidDependency`, 3 value(s) of it reach here, 11 sibling(s) the walk could not finish
- `CalendarErrorV1::ReplayConflict`
  - produced at `crates/data/src/owner/postgres/calendar.rs:85`
  - produced at `crates/data/src/owner/postgres/calendar.rs:177`
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1542` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::DependencyMismatch`, 3 value(s) of it reach here, 11 sibling(s) the walk could not finish
- `CalendarErrorV1::UnknownIdentity`
  - produced at `crates/data/src/owner/postgres/calendar.rs:175`
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1542` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::DependencyMismatch`, 3 value(s) of it reach here, 11 sibling(s) the walk could not finish
- `CanonicalDecodeError::InvalidLength`
  - produced at `crates/indicators/kernel/src/fixed_i128.rs:275`
  - produced at `crates/indicators/kernel/src/fixed_i128.rs:525`
  - flattened at `crates/indicators/kernel/src/fixed_state.rs:279` by map_err(|_| ..), becomes `FixedStateFailure::NonCanonicalState`, 2 value(s) of it reach here, 2 sibling(s) the walk could not finish
  - flattened at `crates/indicators/kernel/src/golden_vector.rs:141` by map_err(|_| ..), becomes `GoldenVectorCodecFailure::InvalidRounding`, 2 value(s) of it reach here, 2 sibling(s) the walk could not finish
- `CanonicalDecodeError::UnknownTag`
  - produced at `crates/indicators/kernel/src/fixed_i128.rs:90`
  - produced at `crates/indicators/kernel/src/fixed_i128.rs:101`
  - produced at `crates/indicators/kernel/src/fixed_i128.rs:141`
  - produced at `crates/indicators/kernel/src/fixed_i128.rs:206`
  - flattened at `crates/indicators/kernel/src/fixed_state.rs:279` by map_err(|_| ..), becomes `FixedStateFailure::NonCanonicalState`, 2 value(s) of it reach here, 2 sibling(s) the walk could not finish
  - flattened at `crates/indicators/kernel/src/golden_vector.rs:141` by map_err(|_| ..), becomes `GoldenVectorCodecFailure::InvalidRounding`, 2 value(s) of it reach here, 2 sibling(s) the walk could not finish
- `EncoderError::ParseError`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:218`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:231`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:239`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:242`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:245`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:248`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:251`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:254`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:259`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:262`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:265`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:289`
  - flattened at `crates/adapters/dydx/src/execution/encoder.rs:467` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 2 value(s) of it reach here, 1 sibling(s) the walk could not finish
- `EncoderError::ValueOverflow`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:269`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:275`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:281`
  - produced at `crates/adapters/dydx/src/execution/encoder.rs:296`
  - flattened at `crates/adapters/dydx/src/execution/encoder.rs:467` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 2 value(s) of it reach here, 1 sibling(s) the walk could not finish
- `InstrumentEconomicTermsErrorV1::InvalidDigest`
  - produced at `crates/data/src/owner/instrument_economic_terms_v1.rs:157`
  - produced at `crates/data/src/owner/instrument_economic_terms_v1.rs:321`
  - flattened at `crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs:219` by map_err(|_| ..), becomes `NativeReplayExecutionInputBindingErrorV1::Unavailable`, 1 value(s) of it reach here, 10 sibling(s) the walk could not finish
- `InstrumentMasterError::InvalidFact`
  - produced at `crates/data/src/owner/instrument_master.rs:91`
  - produced at `crates/data/src/owner/instrument_master/authority.rs:56`
  - produced at `crates/data/src/owner/instrument_master/authority.rs:66`
  - produced at `crates/data/src/owner/instrument_master/authority.rs:79`
  - produced at `crates/data/src/owner/instrument_master/authority.rs:86`
  - produced at `crates/data/src/owner/instrument_master/authority.rs:115`
  - flattened at `crates/data/src/owner/instrument_master/authority.rs:409` by map_err(|_| ..), becomes `InstrumentMasterError::MembershipMismatch`, 1 value(s) of it reach here, 18 sibling(s) the walk could not finish
- `InstrumentMasterV2Error::InvalidDelta`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1430`
  - flattened at `crates/data/src/owner/instrument_master_v2_postgres.rs:380` by map_err(|_| ..), becomes `InstrumentMasterCustodyErrorV2::ChainMismatch`, 6 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `MarketDataRepairReplayReentryErrorV1::Request`
  - produced at `crates/strategy_factory/src/market_data_repair_reentry.rs:255`
  - produced at `crates/strategy_factory/src/market_data_repair_reentry.rs:522`
  - produced at `crates/strategy_factory/src/market_data_repair_reentry.rs:529`
  - produced at `crates/strategy_factory/src/market_data_repair_reentry.rs:536`
  - flattened at `crates/strategy_factory/src/exploratory_replay/postgres.rs:3254` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 1 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/exploratory_replay/postgres.rs:3612` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 1 value(s) of it reach here, 4 sibling(s) the walk could not finish
- `NativeReplaySchedulingErrorV1::EventOrderUnavailable`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:941`
  - produced at `crates/data/src/owner/native_replay_scheduling_v2.rs:234`
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here, 1 sibling(s) the walk could not finish
- `NativeReplaySchedulingErrorV1::NativeRepresentation`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:823`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:825`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:871`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:883`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:928`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:939`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:993`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:997`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:1000`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:1008`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:1013`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:1016`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:1022`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:1024`
  - produced at `crates/data/src/owner/native_replay_scheduling_v1.rs:1083`
  - flattened at `crates/data/src/owner/native_replay_scheduling_v1.rs:709` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 2 value(s) of it reach here, 3 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here, 1 sibling(s) the walk could not finish
- `ObservationCensusErrorV1::CapacityExceeded`
  - produced at `crates/data/src/owner/observation_census/authority.rs:48`
  - produced at `crates/data/src/owner/observation_census/authority.rs:89`
  - produced at `crates/data/src/owner/observation_census/authority.rs:100`
  - produced at `crates/data/src/owner/observation_census/authority.rs:117`
  - produced at `crates/data/src/owner/observation_census/authority.rs:126`
  - produced at `crates/data/src/owner/observation_census/authority.rs:169`
  - produced at `crates/data/src/owner/observation_census/authority.rs:171`
  - produced at `crates/data/src/owner/observation_census/authority.rs:419`
  - produced at `crates/data/src/owner/observation_census/authority.rs:478`
  - produced at `crates/data/src/owner/observation_census/authority.rs:596`
  - produced at `crates/data/src/owner/observation_census/authority.rs:640`
  - produced at `crates/data/src/owner/observation_census/authority.rs:660`
  - produced at `crates/data/src/owner/observation_census/authority.rs:673`
  - produced at `crates/data/src/owner/observation_census/authority.rs:752`
  - produced at `crates/data/src/owner/observation_census/codec.rs:38`
  - produced at `crates/data/src/owner/observation_census/codec.rs:67`
  - produced at `crates/data/src/owner/observation_census/codec.rs:70`
  - produced at `crates/data/src/owner/observation_census/codec.rs:150`
  - produced at `crates/data/src/owner/observation_census/codec.rs:152`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:139`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:395`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:397`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:399`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:401`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:603`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:605`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:607`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:609`
  - flattened at `crates/data/src/owner/postgres.rs:1790` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:1798` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:1803` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:936` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:943` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1452` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::DigestMismatch`, 3 value(s) of it reach here, 9 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1457` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::DigestMismatch`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1486` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:236` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:467` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:475` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:480` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `ObservationCensusErrorV1::CommitInterrupted`
  - produced at `crates/data/src/owner/postgres.rs:3372`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:489`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:598`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:646`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:673`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:684`
  - flattened at `crates/data/src/owner/postgres.rs:1798` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:943` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1486` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:236` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:475` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `ObservationCensusErrorV1::DigestMismatch`
  - produced at `crates/data/src/owner/observation_census/authority.rs:138`
  - produced at `crates/data/src/owner/observation_census/authority.rs:537`
  - produced at `crates/data/src/owner/observation_census/authority.rs:634`
  - produced at `crates/data/src/owner/observation_census/authority.rs:666`
  - produced at `crates/data/src/owner/observation_census/authority.rs:696`
  - produced at `crates/data/src/owner/observation_census/authority.rs:759`
  - produced at `crates/data/src/owner/observation_census/authority.rs:841`
  - produced at `crates/data/src/owner/observation_census/authority.rs:916`
  - produced at `crates/data/src/owner/postgres.rs:3475`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:87`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:152`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:166`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:440`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:451`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:496`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:518`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:553`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:633`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:652`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:703`
  - flattened at `crates/data/src/owner/observation_census/authority.rs:532` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 1 value(s) of it reach here, 11 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/observation_census/authority.rs:907` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 1 value(s) of it reach here, 11 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:1790` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:1798` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:1803` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:1818` by map_err(|_| ..), becomes `Error::CorruptRecord`, 2 value(s) of it reach here, 10 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:936` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:943` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1452` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::DigestMismatch`, 3 value(s) of it reach here, 9 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1457` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::DigestMismatch`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1486` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:236` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:467` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:475` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:480` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:488` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 2 value(s) of it reach here, 10 sibling(s) the walk could not finish
- `ObservationCensusErrorV1::JoinedCutUnavailable`
  - produced at `crates/data/src/owner/observation_census/authority.rs:461`
  - produced at `crates/data/src/owner/observation_census/authority.rs:468`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:338`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:699`
  - flattened at `crates/data/src/owner/postgres.rs:1803` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:943` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1486` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:236` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:480` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `ObservationCensusErrorV1::RequestConflict`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:203`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:216`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:434`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:512`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:701`
  - flattened at `crates/data/src/owner/postgres.rs:1798` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:943` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1486` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:236` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:475` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `ObservationCensusErrorV1::StoreUnavailable`
  - produced at `crates/data/src/owner/postgres.rs:3362`
  - produced at `crates/data/src/owner/postgres.rs:3366`
  - produced at `crates/data/src/owner/postgres.rs:3377`
  - produced at `crates/data/src/owner/postgres.rs:3420`
  - produced at `crates/data/src/owner/postgres.rs:3424`
  - produced at `crates/data/src/owner/postgres.rs:3437`
  - produced at `crates/data/src/owner/postgres.rs:3452`
  - produced at `crates/data/src/owner/postgres.rs:3456`
  - produced at `crates/data/src/owner/postgres.rs:3480`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:180`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:183`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:196`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:200`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:236`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:238`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:240`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:385`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:407`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:428`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:488`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:510`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:547`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:596`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:645`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:672`
  - produced at `crates/data/src/owner/postgres/observation_census.rs:702`
  - flattened at `crates/data/src/owner/postgres.rs:916` by map_err(|_| ..), becomes `SourceBindingError::StoreUnavailable`, 1 value(s) of it reach here, 11 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:1790` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:1798` by map_err(|_| ..), becomes `Error::JoinedCutUnavailable`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:936` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:943` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:1486` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::IncompleteComposition`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:236` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 8 value(s) of it reach here, 4 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:467` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 4 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/sample_projection_v4.rs:475` by map_err(|_| ..), becomes `StrategyInputSampleProjectionErrorV4::SubjectMismatch`, 7 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `ProtectedReplayContractErrorV1::InvalidAttemptFrontier`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1796`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1813`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1890`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1908`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1938`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1950`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1958`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1964`
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:355` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::CorruptReadback`, 1 value(s) of it reach here, 9 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:421` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::ResultNotAdmitted`, 3 value(s) of it reach here, 7 sibling(s) the walk could not finish
- `ProtectedReplayContractErrorV1::InvalidDigest`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:443`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:449`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1385`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1414`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1417`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1525`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1563`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1566`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1737`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:1916`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:2103`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:2106`
  - produced at `crates/backtest_owner_contracts/src/protected_replay.rs:2287`
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:421` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::ResultNotAdmitted`, 3 value(s) of it reach here, 7 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:437` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::ResultNotAdmitted`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:662` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::StorageUnavailable`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:827` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::StorageUnavailable`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:976` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::ResultNotAdmitted`, 3 value(s) of it reach here, 7 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:1496` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::CorruptReadback`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:1576` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::CorruptReadback`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:1649` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::CorruptReadback`, 3 value(s) of it reach here, 7 sibling(s) the walk could not finish
  - flattened at `crates/backtest_owner/src/protected_replay_postgres.rs:1723` by map_err(|_| ..), becomes `PostgresReplayResultOwnerErrorV2::CorruptReadback`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/backtest_result_custody/src/protected_replay.rs:319` by map_err(|_| ..), becomes `BacktestResultCustodyErrorV2::Unavailable`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/backtest_result_custody/src/protected_replay.rs:394` by map_err(|_| ..), becomes `BacktestResultCustodyErrorV2::Unavailable`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
  - flattened at `crates/backtest_result_custody/src/protected_replay.rs:469` by map_err(|_| ..), becomes `BacktestResultCustodyErrorV2::Unavailable`, 3 value(s) of it reach here, 7 sibling(s) the walk could not finish
  - flattened at `crates/backtest_result_custody/src/protected_replay.rs:548` by map_err(|_| ..), becomes `BacktestResultCustodyErrorV2::Unavailable`, 2 value(s) of it reach here, 8 sibling(s) the walk could not finish
- `PublicTermsValidationErrorV2::MissingValue`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1538`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1550`
  - flattened at `crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs:837` by map_err(|_| ..), becomes `NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here
- `PublicTermsValidationErrorV2::NativeRepresentation`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1571`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1580`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1585`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1602`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1604`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1612`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1614`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1616`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1631`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1633`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1635`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1651`
  - flattened at `crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs:837` by map_err(|_| ..), becomes `NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here
- `PublicTermsValidationErrorV2::PrecisionMismatch`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:561`
  - flattened at `crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs:837` by map_err(|_| ..), becomes `NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here
- `PublicTermsValidationErrorV2::UnavailableLimit`
  - produced at `crates/data/src/owner/instrument_master_v2.rs:1562`
  - flattened at `crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs:837` by map_err(|_| ..), becomes `NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 4 value(s) of it reach here
- `ReplayCompositionBindingErrorV1::NonCanonicalOrder`
  - produced at `crates/data/src/owner/replay_market_facts_v2/composition.rs:832`
  - produced at `crates/data/src/owner/replay_market_facts_v2/composition.rs:1059`
  - flattened at `crates/data/src/owner/replay_market_facts_v2/postgres.rs:515` by map_err(|_| ..), becomes `ReplayMarketFactsPostgresErrorV2::BindingConflict`, 3 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `ReplayExecutionPolicyErrorV2::LengthOverflow`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:184`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:192`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:410`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:575`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:614`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:616`
  - flattened at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:592` by map_err(|_| ..), becomes `ReplayExecutionPolicyErrorV2::Truncated`, 2 value(s) of it reach here, 14 sibling(s) the walk could not finish
  - flattened at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:600` by map_err(|_| ..), becomes `ReplayExecutionPolicyErrorV2::Truncated`, 2 value(s) of it reach here, 14 sibling(s) the walk could not finish
  - flattened at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:608` by map_err(|_| ..), becomes `ReplayExecutionPolicyErrorV2::Truncated`, 2 value(s) of it reach here, 14 sibling(s) the walk could not finish
- `ReplayExecutionPolicyErrorV2::Truncated`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:579`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:592`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:600`
  - produced at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:608`
  - flattened at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:592` by map_err(|_| ..), becomes `ReplayExecutionPolicyErrorV2::Truncated`, 2 value(s) of it reach here, 14 sibling(s) the walk could not finish
  - flattened at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:600` by map_err(|_| ..), becomes `ReplayExecutionPolicyErrorV2::Truncated`, 2 value(s) of it reach here, 14 sibling(s) the walk could not finish
  - flattened at `crates/rd_exploratory_replay_custody/src/replay_execution_policy_v2.rs:608` by map_err(|_| ..), becomes `ReplayExecutionPolicyErrorV2::Truncated`, 2 value(s) of it reach here, 14 sibling(s) the walk could not finish
- `ReplayMarketFactsErrorV2::CanonicalEncodingUnavailable`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:593`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1116`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1125`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1174`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1387`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1403`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1412`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1439`
  - produced at `crates/data/src/owner/replay_market_facts_v2/codec.rs:105`
  - flattened at `crates/data/src/owner/replay_market_facts_v2/postgres.rs:796` by map_err(|_| ..), becomes `ReplayMarketFactsPostgresErrorV2::CorruptRecord`, 7 value(s) of it reach here, 3 sibling(s) the walk could not finish
- `ReplayMarketFactsErrorV2::CapacityExceeded`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:212`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:215`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:242`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:247`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:251`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:367`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:380`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:384`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:389`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:546`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:794`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:990`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:993`
  - produced at `crates/data/src/owner/replay_market_facts_v2/codec.rs:93`
  - produced at `crates/data/src/owner/replay_market_facts_v2/codec.rs:113`
  - flattened at `crates/data/src/owner/postgres/replay_market_facts_v2.rs:3100` by map_err(|_| ..), becomes `ReplayCompositionBindingErrorV1::DependencyMismatch`, 1 value(s) of it reach here, 9 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1265` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 1 value(s) of it reach here, 9 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/replay_market_facts_v2/postgres.rs:796` by map_err(|_| ..), becomes `ReplayMarketFactsPostgresErrorV2::CorruptRecord`, 7 value(s) of it reach here, 3 sibling(s) the walk could not finish
- `ReplayMarketFactsErrorV2::DependencyMismatch`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:455`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:468`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:510`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:524`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:528`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:534`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:829`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:841`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:986`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1332`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1346`
  - flattened at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1282` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 1 value(s) of it reach here, 9 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/replay_market_facts_v2/postgres.rs:796` by map_err(|_| ..), becomes `ReplayMarketFactsPostgresErrorV2::CorruptRecord`, 7 value(s) of it reach here, 3 sibling(s) the walk could not finish
- `ReplayMarketFactsErrorV2::IncompleteReferenceCuts`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:206`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1097`
  - flattened at `crates/data/src/owner/replay_market_facts_v2/postgres.rs:796` by map_err(|_| ..), becomes `ReplayMarketFactsPostgresErrorV2::CorruptRecord`, 7 value(s) of it reach here, 3 sibling(s) the walk could not finish
- `ReplayMarketFactsErrorV2::InvalidFact`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:668`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:731`
  - flattened at `crates/data/src/owner/replay_market_facts_v2/postgres.rs:796` by map_err(|_| ..), becomes `ReplayMarketFactsPostgresErrorV2::CorruptRecord`, 7 value(s) of it reach here, 3 sibling(s) the walk could not finish
- `ReplayMarketFactsErrorV2::InvalidFactCut`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:561`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:570`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:577`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:933`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:939`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:943`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:955`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:960`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:970`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1012`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1021`
  - produced at `crates/data/src/owner/replay_market_facts_v2/authority.rs:1081`
  - flattened at `crates/data/src/owner/replay_market_facts_v2/postgres.rs:796` by map_err(|_| ..), becomes `ReplayMarketFactsPostgresErrorV2::CorruptRecord`, 7 value(s) of it reach here, 3 sibling(s) the walk could not finish
- `ReplayNativeExecutionProfileErrorV1::CurrencyMismatch`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:406`
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 12 value(s) of it reach here
- `ReplayNativeExecutionProfileErrorV1::EventInputMismatch`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:213`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:223`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:235`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:244`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:359`
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 12 value(s) of it reach here
- `ReplayNativeExecutionProfileErrorV1::EventTimeOutsideOwnerValidity`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:217`
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 12 value(s) of it reach here
- `ReplayNativeExecutionProfileErrorV1::IntegerOverflow`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:561`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:563`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:800`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:878`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:935`
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 12 value(s) of it reach here
- `ReplayNativeExecutionProfileErrorV1::InvalidIdentifier`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:297`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:299`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:389`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:391`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:396`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:518`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:623`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:789`
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 12 value(s) of it reach here
- `ReplayNativeExecutionProfileErrorV1::NativeVersionMismatch`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:377`
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 12 value(s) of it reach here
- `ReplayNativeExecutionProfileErrorV1::ProfileMismatch`
  - produced at `crates/strategy_factory/src/replay_execution_profile_native_v1.rs:383`
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 12 value(s) of it reach here
- `SharedTimeEvidenceError::LocatorMismatch`
  - produced at `crates/data/src/owner/postgres.rs:7334`
  - produced at `crates/data/src/owner/postgres.rs:7348`
  - produced at `crates/data/src/owner/postgres.rs:7362`
  - produced at `crates/data/src/owner/postgres.rs:7367`
  - flattened at `crates/data/src/owner/postgres.rs:3337` by map_err(|_| ..), becomes `InstrumentMasterError::ClockDiscontinuous`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:5112` by map_err(|_| ..), becomes `InstrumentMasterError::ClockDiscontinuous`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:5134` by map_err(|_| ..), becomes `InstrumentMasterError::ClockUnavailable`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres.rs:5157` by map_err(|_| ..), becomes `InstrumentMasterError::ClockDiscontinuous`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
  - flattened at `crates/data/src/owner/postgres/reference_fact_coordinates.rs:199` by map_err(|_| ..), becomes `ReferenceFactR0ErrorV1::EvidenceUnavailable`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
- `SourceIntakeError::MalformedResponse`
  - produced at `crates/strategy_factory/src/source_intake/mod.rs:1009`
  - produced at `crates/strategy_factory/src/source_intake/openalex_http.rs:521`
  - produced at `crates/strategy_factory/src/source_intake/openalex_http.rs:542`
  - produced at `crates/strategy_factory/src/source_intake/openalex_http.rs:544`
  - produced at `crates/strategy_factory/src/source_intake/openalex_http.rs:566`
  - flattened at `crates/strategy_factory/src/source_intake/openalex_http.rs:350` by .ok(), becomes `None`, 2 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/source_intake/openalex_http.rs:365` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 2 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/source_intake/openalex_http.rs:387` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 1 value(s) of it reach here, 5 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/source_intake/openalex_http.rs:394` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 2 value(s) of it reach here, 5 sibling(s) the walk could not finish
- `StrategyArtifactV2Error::MixedPluginAbiVersions`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:583`
  - flattened at `crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs:800` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
- `StrategyArtifactV2Error::ModuleCoverage`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:316`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:375`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:438`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:573`
  - flattened at `crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs:800` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
- `StrategyArtifactV2Error::ReceiptMismatch`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:267`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:272`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:287`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:303`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:346`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:385`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:409`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:417`
  - produced at `crates/strategy_factory/src/artifact_v2.rs:422`
  - flattened at `crates/strategy_factory/src/native_replay_execution_input_binding_v1.rs:800` by .is_ok() / .is_err(), becomes `.is_ok() / .is_err()`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
  - flattened at `crates/strategy_factory/src/product_edge_postgres.rs:2195` by map_err(|_| ..), becomes `crate::NativeReplayExecutionInputBindingErrorV1::Unavailable`, 3 value(s) of it reach here, 1 sibling(s) the walk could not finish
- `StrategyDesignRoleSetErrorV1::Unavailable`
  - produced at `crates/strategy_factory/src/develop_composer_postgres_v2.rs:1317`
  - produced at `crates/strategy_factory/src/develop_composer_postgres_v2.rs:1318`
  - produced at `crates/strategy_factory/src/develop_composer_postgres_v2.rs:1320`
  - produced at `crates/strategy_factory/src/develop_composer_postgres_v2.rs:1322`
  - produced at `crates/strategy_factory/src/develop_composer_postgres_v2.rs:1329`
  - flattened at `crates/strategy_factory/src/develop_composer_postgres_v2.rs:1573` by map_err(|_| ..), becomes `sqlx::Error::Protocol`, 2 value(s) of it reach here
  - flattened at `crates/strategy_factory/src/develop_composer_postgres_v2.rs:2734` by map_err(|_| ..), becomes `sqlx::Error::Protocol(SEALED_READ_UNAVAILABLE_PROTOCOL_V2.to_owned())`, 2 value(s) of it reach here
  - flattened at `crates/strategy_factory/src/develop_composer_postgres_v2.rs:3983` by map_err(|_| ..), becomes `sqlx::Error::Protocol(SEALED_READ_UNAVAILABLE_PROTOCOL_V2.to_owned())`, 2 value(s) of it reach here
- `SuccessorResearchIntentErrorV1::Encoding`
  - produced at `crates/strategy_factory/src/successor_intent.rs:295`
  - produced at `crates/strategy_factory/src/successor_intent.rs:297`
  - produced at `crates/strategy_factory/src/successor_intent.rs:299`
  - produced at `crates/strategy_factory/src/successor_intent.rs:410`
  - produced at `crates/strategy_factory/src/successor_intent.rs:448`
  - produced at `crates/strategy_factory/src/successor_intent.rs:465`
  - produced at `crates/strategy_factory_rd_owner_api/src/iteration_decision.rs:1608`
  - flattened at `crates/strategy_factory/src/source_research_composer_postgres_v2.rs:2123` by map_err(|_| ..), becomes `research_unavailable()`, 2 value(s) of it reach here
  - flattened at `crates/strategy_factory/src/successor_research_custody_postgres_v1.rs:29` by map_err(|_| ..), becomes `research_unavailable()`, 2 value(s) of it reach here
- `SuccessorResearchIntentErrorV1::Invalid`
  - produced at `crates/strategy_factory/src/successor_intent.rs:225`
  - produced at `crates/strategy_factory/src/successor_intent.rs:311`
  - produced at `crates/strategy_factory/src/successor_intent.rs:340`
  - produced at `crates/strategy_factory/src/successor_intent.rs:367`
  - produced at `crates/strategy_factory/src/successor_intent.rs:383`
  - produced at `crates/strategy_factory/src/successor_intent.rs:391`
  - produced at `crates/strategy_factory/src/successor_intent.rs:423`
  - produced at `crates/strategy_factory_rd_owner_api/src/iteration_decision.rs:1588`
  - flattened at `crates/strategy_factory/src/source_research_composer_postgres_v2.rs:2123` by map_err(|_| ..), becomes `research_unavailable()`, 2 value(s) of it reach here
  - flattened at `crates/strategy_factory/src/successor_research_custody_postgres_v1.rs:29` by map_err(|_| ..), becomes `research_unavailable()`, 2 value(s) of it reach here
- `TerminalReceiptDecodeError::Truncated`
  - produced at `crates/scanner/src/codec.rs:1574`
  - produced at `crates/scanner/src/codec.rs:1609`
  - produced at `crates/scanner/src/codec.rs:1631`
  - flattened at `crates/scanner/src/codec.rs:1609` by map_err(|_| ..), becomes `TerminalReceiptDecodeError::Truncated { field }`, 2 value(s) of it reach here, 10 sibling(s) the walk could not finish
- `TokenInfoError::CallFailed`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:295`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:344`
  - flattened at `crates/adapters/blockchain/src/execution/client.rs:163` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 4 value(s) of it reach here
- `TokenInfoError::DecodingError`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:314`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:323`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:360`
  - flattened at `crates/adapters/blockchain/src/execution/client.rs:163` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 4 value(s) of it reach here
- `TokenInfoError::EmptyTokenField`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:132`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:139`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:304`
  - produced at `crates/adapters/blockchain/src/contracts/erc20.rs:353`
  - flattened at `crates/adapters/blockchain/src/execution/client.rs:163` by if let Ok(..) / let Ok(..) else, becomes `the else branch`, 4 value(s) of it reach here

## Where the walk stopped

First unfollowable step, for variants that are undetermined or flattened wherever followed:

```text
  435  a name with several declarations, none attributable by crate
   92  the result is bound or passed on; not followed
   18  the site is not inside a function
    6  the result is matched; arms not followed
    1  crates/adapters/hyperliquid/src/outcome_settlement.rs:154  call not found at the line
    1  crates/adapters/dydx/src/execution/encoder.rs:322  call not found at the line
    1  crates/rd_market_data_repair_custody/src/lib.rs:15  call not found at the line
```

## Which ruler, and where it is blind

The walk is by name, over source text, transitively. That choice is forced: the compiler
never calls a `pub` item dead and has no notion of an error's cause, and nothing else in
the tree follows a value through `?`. What that costs, stated so the list is not read as
more than it is:

- A function name declared more than once is attributed by crate - if exactly one
  declaration sits in the crate the walk came from, only that crate's call sites count.
  Otherwise the path is not followed. Callers in other crates are missed, which reads as
  reaching a boundary: that keeps a variant off the list, never puts one on it.
- Trait dispatch, closures, function pointers and macro expansion are invisible. A function
  called only through them looks like it has no callers.
- A result that is bound to a name, or matched, is not followed past that point.
- `?` is taken as propagating. A `From` impl that ignores its argument is a discard this
  does not see.
- Discards recognised: `.map_err(|_ ..| ..)`, `.ok()`, `.is_ok()`, `.is_err()`,
  `.unwrap_or*`, `if let Ok(..)` and `let Ok(..) else`. Anything else is not.
- A variant named in a pattern outside its own enum's impls is taken as observed by some
  caller, and never listed. A match that names it and then flattens it anyway is missed.
- A discard closure that names the cause, `.map_err(|e| ..)`, is taken as keeping it - even
  when it only writes the cause to a diagnostic log and returns a fixed variant. The caller
  sees the same flattening, but here it reads as passed on, so it keeps a variant off the
  list. Whether a logged cause is enough is the Owner's channel rule, not this walk's.

So the list is a lower bound: every entry has been followed along every path the walk
could follow and each one ended in a discard. What it could not follow is counted and
reported beside it, not guessed at.
