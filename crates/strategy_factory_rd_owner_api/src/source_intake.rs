use std::sync::Arc;

#[cfg(feature = "sealed-source-intake-acceptance")]
use anyhow::Context;
use async_trait::async_trait;
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vibe_product_edge::ProductEdgePostgresOwnerV1;
#[cfg(feature = "sealed-source-intake-acceptance")]
use vibe_strategy_factory::source_intake::{
    SOURCE_INTAKE_MIGRATION_SQL_V1, SealedSourceIntakeAuditV1, SealedSourceIntakeEnvironmentV1,
};
use vibe_strategy_factory::source_intake::{
    SourceIntakeOperationRequestV1, SourceIntakeOwnerErrorV1, SourceIntakeOwnerV1,
    SourceIntakeTerminalAtomV1,
};

const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_IDENTITY_BYTES: usize = 192;

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_RELATIONS: &[&str] = &[
    "rd_research_source_provenance_v1",
    "rd_source_candidates_v1",
    "rd_source_intake_bindings_v1",
    "rd_source_intake_receipts_v1",
    "rd_source_raw_payloads_v1",
    "rd_source_raw_receipt_links_v1",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_RELATION_CUSTODY: &[&str] = &[
    "rd_research_source_provenance_v1:r:p:rd_owner",
    "rd_source_candidates_v1:r:p:rd_owner",
    "rd_source_intake_bindings_v1:r:p:rd_owner",
    "rd_source_intake_receipts_v1:r:p:rd_owner",
    "rd_source_raw_payloads_v1:r:p:rd_owner",
    "rd_source_raw_receipt_links_v1:r:p:rd_owner",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_COLUMN_SHAPE: &[&str] = &[
    "rd_research_source_provenance_v1:1:provenance_identity:text:true:false::",
    "rd_research_source_provenance_v1:2:receipt_identity:text:true:false::",
    "rd_research_source_provenance_v1:3:content_digest:text:true:false::",
    "rd_research_source_provenance_v1:4:provenance_json:jsonb:true:false::",
    "rd_research_source_provenance_v1:5:predecessor_provenance_identity:text:false:true::s",
    "rd_research_source_provenance_v1:6:canonical_source_origin:text:false:true::s",
    "rd_research_source_provenance_v1:7:source_class:text:false:true::s",
    "rd_research_source_provenance_v1:8:author_or_originating_system:text:false:true::s",
    "rd_research_source_provenance_v1:9:publication_time_epoch_ms:bigint:false:true::s",
    "rd_research_source_provenance_v1:10:revision_identity:text:false:true::s",
    "rd_research_source_provenance_v1:11:raw_content_digest:text:false:true::s",
    "rd_research_source_provenance_v1:12:retrieval_time_head_digest:text:false:true::s",
    "rd_research_source_provenance_v1:13:rights_policy_version:text:false:true::s",
    "rd_research_source_provenance_v1:14:retention_policy_version:text:false:true::s",
    "rd_research_source_provenance_v1:15:interpretation_status:text:false:true::s",
    "rd_source_candidates_v1:1:candidate_identity:text:true:false::",
    "rd_source_candidates_v1:2:provenance_identity:text:true:false::",
    "rd_source_candidates_v1:3:candidate_json:jsonb:true:false::",
    "rd_source_intake_bindings_v1:1:request_identity:text:true:false::",
    "rd_source_intake_bindings_v1:2:binding_identity:text:true:false::",
    "rd_source_intake_bindings_v1:3:binding_commit_identity:text:true:false::",
    "rd_source_intake_bindings_v1:4:binding_json:jsonb:true:false::",
    "rd_source_intake_bindings_v1:5:state:text:true:false::",
    "rd_source_intake_bindings_v1:6:binding_committed_at_epoch_ms:bigint:true:false::",
    "rd_source_intake_bindings_v1:7:product_edge_started_receipt_identity:text:false:false::",
    "rd_source_intake_bindings_v1:8:product_edge_started_json:jsonb:false:false::",
    "rd_source_intake_bindings_v1:9:invocation_identity:text:false:false::",
    "rd_source_intake_bindings_v1:10:terminal_receipt_identity:text:false:false::",
    "rd_source_intake_receipts_v1:1:receipt_identity:text:true:false::",
    "rd_source_intake_receipts_v1:2:request_identity:text:true:false::",
    "rd_source_intake_receipts_v1:3:terminal:text:true:false::",
    "rd_source_intake_receipts_v1:4:response_status:smallint:false:false::",
    "rd_source_intake_receipts_v1:5:response_header_digest:text:false:false::",
    "rd_source_intake_receipts_v1:6:content_digest:text:false:false::",
    "rd_source_intake_receipts_v1:7:receipt_json:jsonb:true:false::",
    "rd_source_intake_receipts_v1:8:attempt_identity:text:false:true::s",
    "rd_source_intake_receipts_v1:9:terminal_evidence_identity:text:false:true::s",
    "rd_source_intake_receipts_v1:10:terminal_evidence_digest:text:false:true::s",
    "rd_source_intake_receipts_v1:11:connected_address:inet:false:true::s",
    "rd_source_intake_receipts_v1:12:response_media_type:text:false:true::s",
    "rd_source_intake_receipts_v1:13:response_size_bytes:bigint:false:true::s",
    "rd_source_intake_receipts_v1:14:shared_time_head_digest:text:false:true::s",
    "rd_source_intake_receipts_v1:15:committed_at_epoch_ms:bigint:true:false::",
    "rd_source_raw_payloads_v1:1:content_digest:text:true:false::",
    "rd_source_raw_payloads_v1:2:raw_payload:bytea:true:false::",
    "rd_source_raw_receipt_links_v1:1:receipt_identity:text:true:false::",
    "rd_source_raw_receipt_links_v1:2:terminal:text:true:true::",
    "rd_source_raw_receipt_links_v1:3:content_digest:text:true:false::",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_RELATION_SECURITY: &[&str] = &[
    "rd_research_source_provenance_v1:false:false:d:false::{rd_owner=arwdDxt/rd_owner}",
    "rd_source_candidates_v1:false:false:d:false::{rd_owner=arwdDxt/rd_owner}",
    "rd_source_intake_bindings_v1:false:false:d:false::{rd_owner=arwdDxt/rd_owner}",
    "rd_source_intake_receipts_v1:false:false:d:false::{rd_owner=arwdDxt/rd_owner}",
    "rd_source_raw_payloads_v1:false:false:d:false::{rd_owner=arwdDxt/rd_owner}",
    "rd_source_raw_receipt_links_v1:false:false:d:false::{rd_owner=arwdDxt/rd_owner}",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_COLUMN_DEFAULTS: &[&str] = &[
    "rd_research_source_provenance_v1:predecessor_provenance_identity:(provenance_json ->> 'predecessor_provenance_identity'::text)",
    "rd_research_source_provenance_v1:canonical_source_origin:(provenance_json ->> 'canonical_source_origin'::text)",
    "rd_research_source_provenance_v1:source_class:(provenance_json ->> 'source_class'::text)",
    "rd_research_source_provenance_v1:author_or_originating_system:(provenance_json ->> 'author_or_originating_system'::text)",
    "rd_research_source_provenance_v1:publication_time_epoch_ms:((provenance_json ->> 'publication_time_epoch_ms'::text))::bigint",
    "rd_research_source_provenance_v1:revision_identity:(provenance_json ->> 'revision_identity'::text)",
    "rd_research_source_provenance_v1:raw_content_digest:(provenance_json ->> 'raw_content_digest'::text)",
    "rd_research_source_provenance_v1:retrieval_time_head_digest:(provenance_json #>> '{retrieval_time,head_digest}'::text[])",
    "rd_research_source_provenance_v1:rights_policy_version:(provenance_json ->> 'rights_policy_version'::text)",
    "rd_research_source_provenance_v1:retention_policy_version:(provenance_json ->> 'retention_policy_version'::text)",
    "rd_research_source_provenance_v1:interpretation_status:(provenance_json ->> 'interpretation_status'::text)",
    "rd_source_intake_receipts_v1:attempt_identity:(receipt_json ->> 'attempt_identity'::text)",
    "rd_source_intake_receipts_v1:terminal_evidence_identity:(receipt_json ->> 'terminal_evidence_identity'::text)",
    "rd_source_intake_receipts_v1:terminal_evidence_digest:(receipt_json ->> 'terminal_evidence_digest'::text)",
    "rd_source_intake_receipts_v1:connected_address:((receipt_json ->> 'connected_address'::text))::inet",
    "rd_source_intake_receipts_v1:response_media_type:(receipt_json ->> 'response_media_type'::text)",
    "rd_source_intake_receipts_v1:response_size_bytes:((receipt_json ->> 'response_size_bytes'::text))::bigint",
    "rd_source_intake_receipts_v1:shared_time_head_digest:(receipt_json #>> '{retrieval_time,head_digest}'::text[])",
    "rd_source_raw_receipt_links_v1:terminal:'RETRIEVED'::text",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_CONSTRAINTS: &[&str] = &[
    "rd_research_source_provenance_v1:rd_research_source_provenance_receipt_identity_content_dig_fkey:sha256:5b9fd4e4ae23a376c9b167957c6c88646d42c0918b29cd517750a89431b254ca",
    "rd_research_source_provenance_v1:rd_research_source_provenance_v1_pkey:sha256:453982f874023bad4ac22f64517a1375cf5cdffaa8d6e258c0c64447bdbb2dc4",
    "rd_research_source_provenance_v1:rd_research_source_provenance_v1_receipt_identity_key:sha256:6a45f900e8e4eba0287c37ef32e50183d82208ab76acc34465bebe7a0959394d",
    "rd_source_candidates_v1:rd_source_candidates_v1_pkey:sha256:af8bce6343ed126bf49d13e2412d2bbb3b17d45dad1837e174bf6d15f79f0eb6",
    "rd_source_candidates_v1:rd_source_candidates_v1_provenance_identity_fkey:sha256:add2e8c8bdcb52beccad1497b02bdeff8802e495223b92acd9f7582ce672622b",
    "rd_source_candidates_v1:rd_source_candidates_v1_provenance_identity_key:sha256:b47779d75eb28facda43d669ad7bddc2e4882a7a3d98e458a0aea14b8ab60740",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_binding_commit_identity_key:sha256:9ebd1e70012e6ccd4cc01439738f440f7f622aa7d84fecfb3f47b6a62dbf0346",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_binding_committed_at_epoch_m_check:sha256:da9ed48a8fb8cc3ef155fe4074431c6185e4d7b61cc7eb6453e471b54f46aaf5",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_binding_identity_key:sha256:544200a8e7efa77ee94425dfa3c90c5e6cbbcd73bb26cb9cf577e34e60742e2a",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_check:sha256:4f7ef81af25da151919ef6c69ce39492169c14fc498f1351bd3082474a2fa612",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_invocation_identity_key:sha256:794e590614f06bbb0540f990d74b7416a473b443bd869c5447f7dfed5852877b",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_pkey:sha256:bcb24f7a6d4707ce519c75e057f73ab5d484d57ae2aa2f1baafd6dd1032231b5",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_state_check:sha256:bebb98c27fdd0b2d0a3243574460d3f9711aef0578dd7c0f4df86c7919361a45",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_terminal_receipt_identity_key:sha256:83100f55801527383039d2a0a63dd0a910e90812b7bb5a7ab4b624eda017612b",
    "rd_source_intake_bindings_v1:rd_source_intake_terminal_receipt_v1:sha256:e31e9c27c9fbda265df4aa10539921f319e9e0ed725d288ff14241411b4e73d9",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_check:sha256:edfa4071609e240e3d7909503b4d707b71216a126cfef295cb272f21a5496bfa",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_committed_at_epoch_ms_check:sha256:8e4a23994afae3b15bda252442c0a70076826a2b0b2bca55f577abfcc933cdfe",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_pkey:sha256:4c27deb335a0459095a65abb7f2fc29d41afa3c05e8432e18ac728a61f465a65",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_receipt_identity_terminal_key:sha256:e98147e0454acb9f7b281ea81645152ae6f02aafebcd042f803b990297ae5dda",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_request_identity_fkey:sha256:6c60915819aa654189968f7d03d3943dd3c964765b608a4e7ef7a1915c4a71c6",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_request_identity_key:sha256:0e16d9c7b5ed144f87ded50b50075d8e5b1facff3a9e23ccbe8620e74b7f02ba",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_terminal_check:sha256:8ea1e7f825cb832d94e5a7cc53bcee90ae8a6536efc6e1a1f1f014612479a5ea",
    "rd_source_raw_payloads_v1:rd_source_raw_payloads_v1_pkey:sha256:031ee2324c0ed33025dc750b602bbf578d5218b8fd59fd2d66ba23ae5d256fe8",
    "rd_source_raw_payloads_v1:rd_source_raw_payloads_v1_raw_payload_check:sha256:4a31f79b6ac71d7a8f8183a93913fad42bfe45857975ff381ef67dee5256c4d5",
    "rd_source_raw_receipt_links_v1:rd_source_raw_receipt_links_v1_content_digest_fkey:sha256:672bdd1cee55d9067add496306849b7406698074a335273bfc2dc5f58f1b310c",
    "rd_source_raw_receipt_links_v1:rd_source_raw_receipt_links_v1_pkey:sha256:4c27deb335a0459095a65abb7f2fc29d41afa3c05e8432e18ac728a61f465a65",
    "rd_source_raw_receipt_links_v1:rd_source_raw_receipt_links_v1_receipt_identity_terminal_fkey:sha256:8050c26cb707678a21f97190faa00138d09f5fca660c0b73a8e27c409838773c",
    "rd_source_raw_receipt_links_v1:rd_source_raw_receipt_links_v1_terminal_check:sha256:b4246004770225875e786ffbfd73c6b90dc684db169dc17f55d200d4898514b2",
    "rd_source_raw_receipt_links_v1:rd_source_raw_receipt_links_v_receipt_identity_content_dige_key:sha256:f495bed085d5c10d644af93ccdf91de878939b00f20edf17ce8dbff67788547a",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_INDEXES: &[&str] = &[
    "rd_research_source_provenance_v1:rd_research_source_provenance_v1_pkey:sha256:06a5d1e831fcebaed46e91f6c6e70fafcb91b4283c96639d6d98f66c15c0e05e",
    "rd_research_source_provenance_v1:rd_research_source_provenance_v1_receipt_identity_key:sha256:fe62bca2955cd96ba4ef8466e2d76a0feda69ebbcbeac2b0149f7150220aa80a",
    "rd_source_candidates_v1:rd_source_candidates_v1_pkey:sha256:c859f8894afa75b9d3c44c078ec2ceaac6e9ed3918eb806e8428814f0cc932c0",
    "rd_source_candidates_v1:rd_source_candidates_v1_provenance_identity_key:sha256:6be242649578f099dcb9e290ce2f882ad0702c0e9079d3d4dfe04e8e0a78334d",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_binding_commit_identity_key:sha256:74a08680b0de607997105df213e78c68d1fec23610cd84a5023576576e175402",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_binding_identity_key:sha256:1fffda1c0337756bd20b74f8c78788017d298ea4b931480b1aa71221614bf748",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_invocation_identity_key:sha256:ab0c9a83f4917d94565091182bf0a220731e0d6da4e1b68a0a6b31d43747f836",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_pkey:sha256:25491a0f5b68aab61426150d6b61ea2dab08fe10a5e3db1fae7f91d96b2416e8",
    "rd_source_intake_bindings_v1:rd_source_intake_bindings_v1_terminal_receipt_identity_key:sha256:2d5fbe0ebd69ea9a0ee80afebb8c29c671b53f26e3bcc1784d37e266024311fd",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_pkey:sha256:e0324618047857812c553e1bb6916af37ae38d19cfdf66a1697340fb06d2fd1e",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_receipt_identity_terminal_key:sha256:f3fc4866ee39e6d57441726669ec3f5e295ab00abfd31ac8e2b586bb5cb4119f",
    "rd_source_intake_receipts_v1:rd_source_intake_receipts_v1_request_identity_key:sha256:ab05fb4d20a76a41356c66a05ec4c9bfd87fefe7b42f9e685efa67c5a8635da3",
    "rd_source_raw_payloads_v1:rd_source_raw_payloads_v1_pkey:sha256:edf0b67e06b0fbf1e8d60a61676a8d9b9d47fca98f537df02667519698def8bb",
    "rd_source_raw_receipt_links_v1:rd_source_raw_receipt_links_v1_pkey:sha256:937e5a475ad3bc96354f6a605e7dc8f71aaaaa45818a5c00a6f928a86ff7692d",
    "rd_source_raw_receipt_links_v1:rd_source_raw_receipt_links_v_receipt_identity_content_dige_key:sha256:707601054e4812820c15d99f76da50dc58c2e72c506eed3ff8a3383419fca3ad",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_TRIGGERS: &[&str] = &[
    "rd_research_source_provenance_v1:rd_research_source_provenance_immutable_v1:sha256:c740ee23c5d25db3f563e500de7c2def9f3066480f45598d616877434ae54cfa",
    "rd_source_candidates_v1:rd_source_candidate_immutable_v1:sha256:bb998ef899f575abb2ddab438502a5109f716c72edfd9d01b66c46a9faabada0",
    "rd_source_intake_bindings_v1:rd_source_intake_binding_guard_v1:sha256:b53b760d0e3694b2e75049057c29df7f6291dc2f5ba8c64485523b3c3e00c580",
    "rd_source_intake_receipts_v1:rd_source_intake_receipt_immutable_v1:sha256:53a804cd87c324ad11eea24748bb11a349e8bad461bc3e947aefda40fe21768a",
    "rd_source_raw_payloads_v1:rd_source_raw_payload_immutable_v1:sha256:20b34a2eed7a64b1a86986dce9232818049614f68ed0fecbda8bedd893b18482",
    "rd_source_raw_receipt_links_v1:rd_source_raw_receipt_link_immutable_v1:sha256:edc6ab7d3381fa9b3e6029d2523874db307cc3bbf0504b4a996357e162cbd6dd",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_FUNCTIONS: &[&str] = &[
    "canonical_source_intake_custody_v1(p_request_identity text):sha256:d618a88a05af0093d80c98e88e7afd7d837b775aed1b0b217de5e3448dfc974d",
    "canonical_source_intake_json_v1(value jsonb):sha256:b3185f61e85a078561715e19731bfa3df39e3094b79de27d965557e64a66f752",
    "derive_openalex_location_rights_v1(body jsonb, normalized_doi text):sha256:efbbac64af335f77495f8451dc2c4e5576f5c57e9503adc0e1b50608a37b56bc",
    "derive_source_acquisition_binding_digest_v1(binding jsonb):sha256:7d7ecf12fbf44ab2400eb85b9c0e7514b94d9b0bc183e1fdfff931bb15b57b2f",
    "derive_source_acquisition_binding_identity_v1(binding jsonb):sha256:50ac581ff3df6f5fdec314f26b97be96ca1c4e3e149aebd55f085c2ea1a4c39c",
    "derive_source_intake_identity_v1(domain text, parts text[]):sha256:5671c21fc16e9a13d8dc7660dd9907ee158dcfa8255f781a41816285acf584a6",
    "guard_source_intake_binding_v1():sha256:a683fe44f274359212ebe59f0330c34e363320fb50a3531812792c26fcf748e1",
    "lock_source_acquisition_binding_v1(requested_request_identity text, requested_binding_identity text):sha256:5d6306fca914efdd571484a11c4829d39f0a9f753fe7e5f6b5d8372f37f35432",
    "lock_source_intake_research_handoff_v1(p_request_identity text, p_attempt_identity text, p_terminal_receipt_identity text):sha256:463401c90894fc90aa9cf3896c97769e55e70806413694b236c8f5ec823d777a",
    "lock_source_invocation_reservation_v1(requested_request_identity text, requested_attempt_identity text, requested_claim_identity text, requested_reservation_identity text, requested_reservation_digest text):sha256:1b7a70730728bd17f8bd30a2da643b45a99b49c54d2efa6b37b189e31567e71b",
    "peek_source_intake_research_handoff_v1(p_request_identity text, p_attempt_identity text, p_terminal_receipt_identity text):sha256:2bf65882d3e21c55ce2fd4b87453dd92083a4385f48f9255b4f16c9a6332d51d",
    "read_source_intake_v1(p_request_identity text):sha256:5a78137904b52b5ddcef44972258f2891543b518ddc3db0237ef806a9e5d06e7",
    "reject_source_intake_terminal_mutation_v1():sha256:65ad5e17503b71a3c9cc21ff03ecaad79e3ccb630a3b223c667dfbcb9d622ab2",
    "valid_source_intake_binding_contract_v1(binding jsonb):sha256:89046fb02f9bad6dc3bf297c52d31d7fefb0e7ef0a55d26e69f040a44917f547",
    "valid_source_intake_receipt_v1(receipt jsonb, row_receipt_identity text, row_request_identity text, row_binding_identity text, row_invocation_identity text, row_terminal text, row_response_status smallint, row_response_header_digest text, row_content_digest text, row_committed_at_epoch_ms bigint):sha256:1ee64c4524e01553e054676da1e796a149656086fdca65a299dd24a6d6cfddf1",
    "valid_source_intake_started_custody_v1(p_request_identity text, p_admission_identity text, p_started_receipt_identity text, p_started jsonb):sha256:7510f23148171bbba8111d43162d10e3168d3bfe95c70c0d9bb662f11f3f5a1f",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_PREREQUISITE_FUNCTION: &str = SOURCE_INTAKE_FUNCTIONS[5];

#[cfg(feature = "sealed-source-intake-acceptance")]
const SOURCE_INTAKE_FUNCTION_NAMES: &[&str] = &[
    "canonical_source_intake_custody_v1",
    "canonical_source_intake_json_v1",
    "derive_openalex_location_rights_v1",
    "derive_source_acquisition_binding_digest_v1",
    "derive_source_acquisition_binding_identity_v1",
    "derive_source_intake_identity_v1",
    "guard_source_intake_binding_v1",
    "lock_source_acquisition_binding_v1",
    "lock_source_intake_research_handoff_v1",
    "lock_source_invocation_reservation_v1",
    "peek_source_intake_research_handoff_v1",
    "read_source_intake_v1",
    "reject_source_intake_terminal_mutation_v1",
    "valid_source_intake_binding_contract_v1",
    "valid_source_intake_receipt_v1",
    "valid_source_intake_started_custody_v1",
];

#[cfg(feature = "sealed-source-intake-acceptance")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceIntakeRelationFamilyState {
    FullyAbsent,
    Complete,
    Incompatible,
}

#[cfg(feature = "sealed-source-intake-acceptance")]
#[derive(Debug, Clone, Default, sqlx::FromRow)]
struct SourceIntakeRelationFamilyShape {
    relation_custody: Vec<String>,
    columns: Vec<String>,
    relation_security: Vec<String>,
    column_defaults: Vec<String>,
    constraints: Vec<String>,
    indexes: Vec<String>,
    triggers: Vec<String>,
    functions: Vec<String>,
    column_acl: Vec<String>,
    column_collation_deviations: Vec<String>,
    policies: Vec<String>,
    rules: Vec<String>,
}

#[cfg(feature = "sealed-source-intake-acceptance")]
fn classify_source_intake_relation_family(
    observed: &SourceIntakeRelationFamilyShape,
) -> SourceIntakeRelationFamilyState {
    let only_exact_prerequisite = observed.functions.is_empty()
        || observed.functions.as_slice() == [SOURCE_INTAKE_PREREQUISITE_FUNCTION];
    if observed.relation_custody.is_empty()
        && observed.columns.is_empty()
        && observed.relation_security.is_empty()
        && observed.column_defaults.is_empty()
        && observed.constraints.is_empty()
        && observed.indexes.is_empty()
        && observed.triggers.is_empty()
        && only_exact_prerequisite
        && observed.column_acl.is_empty()
        && observed.column_collation_deviations.is_empty()
        && observed.policies.is_empty()
        && observed.rules.is_empty()
    {
        SourceIntakeRelationFamilyState::FullyAbsent
    } else if matches_source_intake_manifest(
        &observed.relation_custody,
        SOURCE_INTAKE_RELATION_CUSTODY,
    ) && matches_source_intake_manifest(&observed.columns, SOURCE_INTAKE_COLUMN_SHAPE)
        && matches_source_intake_manifest(
            &observed.relation_security,
            SOURCE_INTAKE_RELATION_SECURITY,
        )
        && matches_source_intake_manifest(&observed.column_defaults, SOURCE_INTAKE_COLUMN_DEFAULTS)
        && matches_source_intake_manifest(&observed.constraints, SOURCE_INTAKE_CONSTRAINTS)
        && matches_source_intake_manifest(&observed.indexes, SOURCE_INTAKE_INDEXES)
        && matches_source_intake_manifest(&observed.triggers, SOURCE_INTAKE_TRIGGERS)
        && matches_source_intake_manifest(&observed.functions, SOURCE_INTAKE_FUNCTIONS)
        && observed.column_acl.is_empty()
        && observed.column_collation_deviations.is_empty()
        && observed.policies.is_empty()
        && observed.rules.is_empty()
    {
        SourceIntakeRelationFamilyState::Complete
    } else {
        SourceIntakeRelationFamilyState::Incompatible
    }
}

#[cfg(feature = "sealed-source-intake-acceptance")]
fn matches_source_intake_manifest(observed: &[String], expected: &[&str]) -> bool {
    observed.len() == expected.len()
        && observed
            .iter()
            .map(String::as_str)
            .eq(expected.iter().copied())
}

#[async_trait]
trait SourceIntakeOwnerPort: Send + Sync {
    async fn run(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1>;
    async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1>;
}

#[async_trait]
impl SourceIntakeOwnerPort for SourceIntakeOwnerV1 {
    async fn run(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        self.run(request).await
    }

    async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        self.resolve(request_identity).await
    }
}

#[derive(Clone)]
struct SourceIntakeApiState {
    owner: Arc<dyn SourceIntakeOwnerPort>,
    token_digest: [u8; 32],
    #[cfg(feature = "sealed-source-intake-acceptance")]
    sealed_audit: SealedSourceIntakeAuditV1,
}

#[cfg(not(feature = "sealed-source-intake-acceptance"))]
pub(super) async fn production_router(
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    database_url: &str,
    token_digest: [u8; 32],
    request_proof_digest: String,
) -> anyhow::Result<Router> {
    let owner_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(database_url)
        .await?;
    Ok(router(SourceIntakeApiState {
        owner: Arc::new(SourceIntakeOwnerV1::production(
            product_edge,
            owner_pool,
            request_proof_digest,
        )),
        token_digest,
    }))
}

#[cfg(feature = "sealed-source-intake-acceptance")]
pub(super) async fn sealed_acceptance_router(
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    database_url: &str,
    token_digest: [u8; 32],
    request_proof_digest: String,
) -> anyhow::Result<Router> {
    let owner_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(database_url)
        .await?;
    require_sealed_source_intake_schema(&owner_pool).await?;
    let environment =
        SealedSourceIntakeEnvironmentV1::new(product_edge, owner_pool, request_proof_digest)
            .map_err(|_| anyhow::anyhow!("invalid sealed Source Intake environment"))?;
    let sealed_audit = environment.audit();
    Ok(router(SourceIntakeApiState {
        owner: Arc::new(SourceIntakeOwnerV1::sealed_acceptance(environment)),
        token_digest,
        sealed_audit,
    }))
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn inspect_source_intake_relation_family(
    connection: &mut sqlx::PgConnection,
) -> anyhow::Result<SourceIntakeRelationFamilyShape> {
    sqlx::query_as(
        r#"SELECT
          ARRAY(
            SELECT relation.relname||':'||relation.relkind::pg_catalog.text||':'||
                   relation.relpersistence::pg_catalog.text||':'||
                   pg_catalog.pg_get_userbyid(relation.relowner)
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
             WHERE namespace.nspname='public' AND relation.relname=ANY($1)
             ORDER BY relation.relname
          ) AS relation_custody,
          ARRAY(
            SELECT relation.relname||':'||attribute.attnum||':'||attribute.attname||':'||
                   pg_catalog.format_type(attribute.atttypid,attribute.atttypmod)||':'||
                   attribute.attnotnull||':'||attribute.atthasdef||':'||
                   attribute.attidentity::pg_catalog.text||':'||
                   attribute.attgenerated::pg_catalog.text
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
              JOIN pg_catalog.pg_attribute attribute
                ON attribute.attrelid=relation.oid
               AND attribute.attnum>0
               AND NOT attribute.attisdropped
             WHERE namespace.nspname='public' AND relation.relname=ANY($1)
             ORDER BY relation.relname,attribute.attnum
          ) AS columns,
          ARRAY(
            SELECT relation.relname||':'||relation.relrowsecurity||':'||
                   relation.relforcerowsecurity||':'||relation.relreplident::pg_catalog.text||':'||
                   relation.relispartition||':'||
                   COALESCE(pg_catalog.array_to_string(relation.reloptions,','),'')||':'||
                   COALESCE(relation.relacl::pg_catalog.text,'NULL')
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
             WHERE namespace.nspname='public' AND relation.relname=ANY($1)
             ORDER BY relation.relname
          ) AS relation_security,
          ARRAY(
            SELECT relation.relname||':'||attribute.attname||':'||
                   pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid)
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
              JOIN pg_catalog.pg_attribute attribute
                ON attribute.attrelid=relation.oid
               AND attribute.attnum>0
               AND NOT attribute.attisdropped
              JOIN pg_catalog.pg_attrdef default_value
                ON default_value.adrelid=relation.oid
               AND default_value.adnum=attribute.attnum
             WHERE namespace.nspname='public' AND relation.relname=ANY($1)
             ORDER BY relation.relname,attribute.attnum
          ) AS column_defaults,
          ARRAY(
            SELECT relation.relname||':'||constraint_record.conname||':sha256:'||
                   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                     constraint_record.contype::pg_catalog.text||':'||
                     constraint_record.condeferrable||':'||constraint_record.condeferred||':'||
                     constraint_record.convalidated||':'||constraint_record.connoinherit||':'||
                     constraint_record.conislocal||':'||constraint_record.coninhcount||':'||
                     pg_catalog.pg_get_constraintdef(constraint_record.oid,false), 'UTF8')), 'hex')
              FROM pg_catalog.pg_constraint constraint_record
              JOIN pg_catalog.pg_class relation ON relation.oid=constraint_record.conrelid
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
             WHERE namespace.nspname='public' AND relation.relname=ANY($1)
             ORDER BY relation.relname,constraint_record.conname
          ) AS constraints,
          ARRAY(
            SELECT table_relation.relname||':'||index_relation.relname||':sha256:'||
                   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                     pg_catalog.pg_get_userbyid(index_relation.relowner)||':'||
                     access_method.amname||':'||index_record.indisunique||':'||
                     index_record.indisprimary||':'||index_record.indisexclusion||':'||
                     index_record.indimmediate||':'||index_record.indisclustered||':'||
                     index_record.indisvalid||':'||index_record.indisready||':'||
                     index_record.indislive||':'||index_record.indisreplident||':'||
                     index_record.indnkeyatts||':'||index_record.indnatts||':'||
                     COALESCE(pg_catalog.array_to_string(index_relation.reloptions,','),'')||':'||
                     pg_catalog.pg_get_indexdef(index_relation.oid), 'UTF8')), 'hex')
              FROM pg_catalog.pg_index index_record
              JOIN pg_catalog.pg_class table_relation ON table_relation.oid=index_record.indrelid
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=table_relation.relnamespace
              JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_record.indexrelid
              JOIN pg_catalog.pg_am access_method ON access_method.oid=index_relation.relam
             WHERE namespace.nspname='public' AND table_relation.relname=ANY($1)
             ORDER BY table_relation.relname,index_relation.relname
          ) AS indexes,
          ARRAY(
            SELECT relation.relname||':'||trigger_record.tgname||':sha256:'||
                   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                     trigger_record.tgtype||':'||trigger_record.tgenabled::pg_catalog.text||':'||
                     trigger_record.tgisinternal||':'||trigger_record.tgdeferrable||':'||
                     trigger_record.tginitdeferred||':'||trigger_record.tgnargs||':'||
                     pg_catalog.encode(trigger_record.tgargs,'hex')||':'||
                     trigger_function.oid::pg_catalog.regprocedure::pg_catalog.text||':'||
                     COALESCE(pg_catalog.pg_get_expr(trigger_record.tgqual,trigger_record.tgrelid),'')||':'||
                     COALESCE(trigger_record.tgoldtable::pg_catalog.text,'')||':'||
                     COALESCE(trigger_record.tgnewtable::pg_catalog.text,'')||':'||
                     pg_catalog.pg_get_triggerdef(trigger_record.oid,false), 'UTF8')), 'hex')
              FROM pg_catalog.pg_trigger trigger_record
              JOIN pg_catalog.pg_class relation ON relation.oid=trigger_record.tgrelid
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
              JOIN pg_catalog.pg_proc trigger_function ON trigger_function.oid=trigger_record.tgfoid
             WHERE namespace.nspname='public'
               AND relation.relname=ANY($1)
               AND NOT trigger_record.tgisinternal
             ORDER BY relation.relname,trigger_record.tgname
          ) AS triggers,
          ARRAY(
            SELECT function_record.proname||'('||
                   pg_catalog.pg_get_function_identity_arguments(function_record.oid)||'):sha256:'||
                   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                     pg_catalog.pg_get_userbyid(function_record.proowner)||':'||
                     language.lanname||':'||
                     pg_catalog.pg_get_function_arguments(function_record.oid)||':'||
                     pg_catalog.pg_get_function_result(function_record.oid)||':'||
                     function_record.prokind::pg_catalog.text||':'||
                     function_record.provolatile::pg_catalog.text||':'||
                     function_record.proparallel::pg_catalog.text||':'||
                     function_record.proisstrict||':'||function_record.prosecdef||':'||
                     function_record.proleakproof||':'||function_record.proretset||':'||
                     function_record.pronargs||':'||function_record.pronargdefaults||':'||
                     function_record.procost||':'||function_record.prorows||':'||
                     COALESCE(pg_catalog.array_to_string(function_record.proconfig,','),'')||':'||
                     COALESCE(function_record.probin,'')||':'||
                     COALESCE(function_record.proacl::pg_catalog.text,'NULL')||':'||
                     pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
                       function_record.prosrc,'UTF8')), 'hex'), 'UTF8')), 'hex')
              FROM pg_catalog.pg_proc function_record
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=function_record.pronamespace
              JOIN pg_catalog.pg_language language ON language.oid=function_record.prolang
             WHERE namespace.nspname='rd_owner_api' AND function_record.proname=ANY($2)
             ORDER BY function_record.proname,
                      pg_catalog.pg_get_function_identity_arguments(function_record.oid)
          ) AS functions,
          ARRAY(
            SELECT relation.relname||':'||attribute.attname||':'||attribute.attacl::pg_catalog.text
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
              JOIN pg_catalog.pg_attribute attribute
                ON attribute.attrelid=relation.oid
               AND attribute.attnum>0
               AND NOT attribute.attisdropped
             WHERE namespace.nspname='public'
               AND relation.relname=ANY($1)
               AND attribute.attacl IS NOT NULL
             ORDER BY relation.relname,attribute.attnum
          ) AS column_acl,
          ARRAY(
            SELECT relation.relname||':'||attribute.attname||':'||
                   pg_catalog.pg_get_userbyid(relation.relowner)
              FROM pg_catalog.pg_class relation
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
              JOIN pg_catalog.pg_attribute attribute
                ON attribute.attrelid=relation.oid
               AND attribute.attnum>0
               AND NOT attribute.attisdropped
              JOIN pg_catalog.pg_type type_record ON type_record.oid=attribute.atttypid
             WHERE namespace.nspname='public'
               AND relation.relname=ANY($1)
               AND attribute.attcollation<>type_record.typcollation
             ORDER BY relation.relname,attribute.attnum
          ) AS column_collation_deviations,
          ARRAY(
            SELECT relation.relname||':'||policy.polname
              FROM pg_catalog.pg_policy policy
              JOIN pg_catalog.pg_class relation ON relation.oid=policy.polrelid
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
             WHERE namespace.nspname='public' AND relation.relname=ANY($1)
             ORDER BY relation.relname,policy.polname
          ) AS policies,
          ARRAY(
            SELECT relation.relname||':'||rewrite.rulename
              FROM pg_catalog.pg_rewrite rewrite
              JOIN pg_catalog.pg_class relation ON relation.oid=rewrite.ev_class
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
             WHERE namespace.nspname='public' AND relation.relname=ANY($1)
             ORDER BY relation.relname,rewrite.rulename
          ) AS rules"#,
    )
    .bind(SOURCE_INTAKE_RELATIONS)
    .bind(SOURCE_INTAKE_FUNCTION_NAMES)
    .fetch_one(connection)
    .await
    .context("inspect sealed Source Intake authority manifest")
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn locked_sealed_source_intake_schema(
    owner_pool: &sqlx::PgPool,
    materialize_fully_absent: bool,
) -> anyhow::Result<()> {
    let mut transaction = owner_pool
        .begin()
        .await
        .context("begin sealed Source Intake schema validation")?;
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('vibe.sealed-source-intake-schema-v1', 0))",
    )
    .execute(&mut *transaction)
    .await
    .context("lock sealed Source Intake schema validation")?;

    let observed_shape = inspect_source_intake_relation_family(&mut transaction).await?;
    match classify_source_intake_relation_family(&observed_shape) {
        SourceIntakeRelationFamilyState::Complete => {}
        SourceIntakeRelationFamilyState::FullyAbsent if materialize_fully_absent => {
            for (index, statement) in SOURCE_INTAKE_MIGRATION_SQL_V1.iter().enumerate() {
                sqlx::query(*statement)
                    .execute(&mut *transaction)
                    .await
                    .with_context(|| {
                        format!("apply sealed Source Intake migration statement {index}")
                    })?;
            }
            let materialized_shape =
                inspect_source_intake_relation_family(&mut transaction).await?;
            anyhow::ensure!(
                classify_source_intake_relation_family(&materialized_shape)
                    == SourceIntakeRelationFamilyState::Complete,
                "sealed Source Intake materialization did not produce the expected relation family"
            );
        }
        SourceIntakeRelationFamilyState::FullyAbsent => {
            anyhow::bail!("sealed Source Intake relation family is not materialized")
        }
        SourceIntakeRelationFamilyState::Incompatible => {
            anyhow::bail!("sealed Source Intake relation family is partial or malformed")
        }
    }
    transaction
        .commit()
        .await
        .context("commit sealed Source Intake schema validation")
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn require_sealed_source_intake_schema(owner_pool: &sqlx::PgPool) -> anyhow::Result<()> {
    locked_sealed_source_intake_schema(owner_pool, false).await
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn materialize_sealed_source_intake_schema(owner_pool: &sqlx::PgPool) -> anyhow::Result<()> {
    locked_sealed_source_intake_schema(owner_pool, true).await
}

#[cfg(feature = "sealed-source-intake-acceptance")]
pub(super) async fn materialize_schema(database_url: &str) -> anyhow::Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await?;
    materialize_sealed_source_intake_schema(&pool).await
}

fn router(state: SourceIntakeApiState) -> Router {
    let router = Router::new()
        .route("/v1/source-intakes", post(submit))
        .route(
            "/v1/source-intakes/{request_identity}/resolve",
            post(resolve),
        );
    #[cfg(feature = "sealed-source-intake-acceptance")]
    let router = router.route(
        "/v1/source-intakes/sealed-acceptance/audit",
        axum::routing::get(sealed_acceptance_audit),
    );
    router
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(state)
}

#[cfg(feature = "sealed-source-intake-acceptance")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
struct SealedSourceIntakeAuditProjectionV1 {
    physical_provider_invocations: u64,
}

#[cfg(feature = "sealed-source-intake-acceptance")]
async fn sealed_acceptance_audit(
    State(state): State<SourceIntakeApiState>,
    headers: HeaderMap,
) -> Response {
    match sealed_audit_projection(&headers, &state.token_digest, &state.sealed_audit) {
        Ok(projection) => (StatusCode::OK, Json(projection)).into_response(),
        Err(status) => status.into_response(),
    }
}

#[cfg(feature = "sealed-source-intake-acceptance")]
fn sealed_audit_projection(
    headers: &HeaderMap,
    token_digest: &[u8; 32],
    audit: &SealedSourceIntakeAuditV1,
) -> Result<SealedSourceIntakeAuditProjectionV1, StatusCode> {
    if !authorized(headers, token_digest) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(SealedSourceIntakeAuditProjectionV1 {
        physical_provider_invocations: audit.physical_provider_invocations(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyObjectV1 {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct SourceIntakeUnknownV1 {
    request_identity: String,
    resolution: &'static str,
    next_legal_action: &'static str,
}

async fn submit(
    State(state): State<SourceIntakeApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request_identity = parse_request_identity(&body);

    if !authorized(&headers, &state.token_digest) {
        return unknown_response(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }
    let request: SourceIntakeOperationRequestV1 = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return unknown_response(
                StatusCode::BAD_REQUEST,
                "MALFORMED_TYPED_REQUEST",
                &request_identity,
            );
        }
    };

    if request.validate().is_err() {
        return unknown_response(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            &request.request_identity,
        );
    }
    let identity = request.request_identity.clone();
    owner_response(state.owner.run(request).await, &identity)
}

async fn resolve(
    State(state): State<SourceIntakeApiState>,
    Path(request_identity): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !authorized(&headers, &state.token_digest) {
        return unknown_response(
            StatusCode::FORBIDDEN,
            "UNAUTHORIZED_PRODUCT_EDGE",
            &request_identity,
        );
    }

    if !valid_identity(&request_identity) || serde_json::from_slice::<EmptyObjectV1>(&body).is_err()
    {
        return unknown_response(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            &request_identity,
        );
    }
    owner_response(
        state.owner.resolve(&request_identity).await,
        &request_identity,
    )
}

fn owner_response(
    result: Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1>,
    request_identity: &str,
) -> Response {
    match result {
        Ok(Some(terminal)) => (StatusCode::OK, Json(terminal)).into_response(),
        Ok(None)
        | Err(
            SourceIntakeOwnerErrorV1::PolicyUnavailable | SourceIntakeOwnerErrorV1::ResponseLost,
        ) => unknown_response(
            StatusCode::ACCEPTED,
            "OWNER_OUTCOME_UNKNOWN",
            request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Conflict) => unknown_response(
            StatusCode::CONFLICT,
            "CONFLICTING_SEMANTICS_FOR_REQUEST_IDENTITY",
            request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Invalid) => unknown_response(
            StatusCode::BAD_REQUEST,
            "MALFORMED_TYPED_REQUEST",
            request_identity,
        ),
        Err(SourceIntakeOwnerErrorV1::Unavailable) => unknown_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "OWNER_OUTCOME_UNKNOWN",
            request_identity,
        ),
    }
}

fn unknown_response(status: StatusCode, code: &str, request_identity: &str) -> Response {
    let mut response = (
        status,
        Json(SourceIntakeUnknownV1 {
            request_identity: request_identity.to_string(),
            resolution: "SUBMITTED_OR_UNKNOWN",
            next_legal_action: "RESOLVE_SAME_REQUEST",
        }),
    )
        .into_response();

    if let Ok(value) = code.parse() {
        response.headers_mut().insert("x-rd-rejection-code", value);
    }
    response
}

fn parse_request_identity(body: &[u8]) -> String {
    serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value.get("request_identity")?.as_str().map(str::to_string))
        .filter(|value| valid_identity(value))
        .unwrap_or_else(|| "INVALID_REQUEST_IDENTITY".to_string())
}

fn authorized(headers: &HeaderMap, expected_digest: &[u8; 32]) -> bool {
    let Some(token) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    let actual: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    actual
        .iter()
        .zip(expected_digest)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_IDENTITY_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._:/".contains(&byte))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn token_comparison_and_request_identity_are_bounded() {
        let digest: [u8; 32] = Sha256::digest(b"secret").into();
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            "Bearer secret".parse().expect("header"),
        );
        assert!(authorized(&headers, &digest));
        assert_eq!(
            parse_request_identity(br#"{"request_identity":"source-1"}"#),
            "source-1"
        );
        assert_eq!(
            parse_request_identity(br#"{"request_identity":"bad identity"}"#),
            "INVALID_REQUEST_IDENTITY"
        );
    }

    #[rstest]
    fn acceptance_composition_is_compile_time_only() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        assert!(!source.contains("RD_OWNER_SOURCE_INTAKE_PROVIDER"));
        assert!(!source.contains("fixture_corpus"));
        assert!(source.contains("#[cfg(feature = \"sealed-source-intake-acceptance\")]\npub(super) async fn sealed_acceptance_router"));
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_audit_route_is_authenticated_and_telemetry_only() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        assert!(source.contains("/v1/source-intakes/sealed-acceptance/audit"));
        assert!(source.contains("if !authorized(headers, token_digest)"));
        let projection = serde_json::to_value(SealedSourceIntakeAuditProjectionV1 {
            physical_provider_invocations: 1,
        })
        .expect("projection");
        assert_eq!(
            projection
                .as_object()
                .expect("object")
                .keys()
                .collect::<Vec<_>>(),
            vec!["physical_provider_invocations"]
        );
        assert!(projection.get("terminal").is_none());
        assert!(projection.get("receipt").is_none());
        assert!(projection.get("raw_payload").is_none());
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_runtime_validates_schema_without_materializing() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        let validation_call = source
            .find("require_sealed_source_intake_schema(&owner_pool).await?")
            .expect("acceptance schema validation call");
        let environment = source
            .find("let environment =")
            .expect("acceptance environment construction");
        assert!(validation_call < environment);
        let runtime_validation = source
            .split("async fn require_sealed_source_intake_schema")
            .nth(1)
            .expect("runtime validation function")
            .split("async fn materialize_sealed_source_intake_schema")
            .next()
            .expect("runtime validation body");
        assert!(
            runtime_validation.contains("locked_sealed_source_intake_schema(owner_pool, false)")
        );
        assert!(!runtime_validation.contains("SOURCE_INTAKE_MIGRATION_SQL_V1"));
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_schema_family_decisions_fail_closed() {
        assert_eq!(
            classify_source_intake_relation_family(&SourceIntakeRelationFamilyShape::default()),
            SourceIntakeRelationFamilyState::FullyAbsent
        );
        let prerequisite_only = SourceIntakeRelationFamilyShape {
            functions: vec![SOURCE_INTAKE_PREREQUISITE_FUNCTION.to_owned()],
            ..SourceIntakeRelationFamilyShape::default()
        };
        assert_eq!(
            classify_source_intake_relation_family(&prerequisite_only),
            SourceIntakeRelationFamilyState::FullyAbsent
        );
        let wrong_prerequisite = SourceIntakeRelationFamilyShape {
            functions: vec!["derive_source_intake_identity_v1:altered".to_owned()],
            ..SourceIntakeRelationFamilyShape::default()
        };
        assert_eq!(
            classify_source_intake_relation_family(&wrong_prerequisite),
            SourceIntakeRelationFamilyState::Incompatible
        );
        let complete = complete_source_intake_shape();
        assert_eq!(
            classify_source_intake_relation_family(&complete),
            SourceIntakeRelationFamilyState::Complete
        );
        let mut malformed_classes = Vec::new();

        for mutate in [
            |shape: &mut SourceIntakeRelationFamilyShape| shape.relation_custody.pop(),
            |shape: &mut SourceIntakeRelationFamilyShape| shape.columns.pop(),
            |shape: &mut SourceIntakeRelationFamilyShape| shape.relation_security.pop(),
            |shape: &mut SourceIntakeRelationFamilyShape| shape.column_defaults.pop(),
            |shape: &mut SourceIntakeRelationFamilyShape| shape.constraints.pop(),
            |shape: &mut SourceIntakeRelationFamilyShape| shape.indexes.pop(),
            |shape: &mut SourceIntakeRelationFamilyShape| shape.triggers.pop(),
            |shape: &mut SourceIntakeRelationFamilyShape| shape.functions.pop(),
        ] {
            let mut malformed = complete.clone();
            mutate(&mut malformed);
            malformed_classes.push(malformed);
        }
        let mut column_acl = complete.clone();
        column_acl.column_acl.push("unexpected grant".to_owned());
        malformed_classes.push(column_acl);
        let mut collation = complete.clone();
        collation
            .column_collation_deviations
            .push("unexpected collation".to_owned());
        malformed_classes.push(collation);
        let mut policy = complete.clone();
        policy.policies.push("unexpected policy".to_owned());
        malformed_classes.push(policy);
        let mut rule = complete;
        rule.rules.push("unexpected rule".to_owned());
        malformed_classes.push(rule);
        assert!(malformed_classes.iter().all(|malformed| {
            classify_source_intake_relation_family(malformed)
                == SourceIntakeRelationFamilyState::Incompatible
        }));
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    fn complete_source_intake_shape() -> SourceIntakeRelationFamilyShape {
        fn owned(values: &[&str]) -> Vec<String> {
            values.iter().map(|value| (*value).to_owned()).collect()
        }
        SourceIntakeRelationFamilyShape {
            relation_custody: owned(SOURCE_INTAKE_RELATION_CUSTODY),
            columns: owned(SOURCE_INTAKE_COLUMN_SHAPE),
            relation_security: owned(SOURCE_INTAKE_RELATION_SECURITY),
            column_defaults: owned(SOURCE_INTAKE_COLUMN_DEFAULTS),
            constraints: owned(SOURCE_INTAKE_CONSTRAINTS),
            indexes: owned(SOURCE_INTAKE_INDEXES),
            triggers: owned(SOURCE_INTAKE_TRIGGERS),
            functions: owned(SOURCE_INTAKE_FUNCTIONS),
            column_acl: Vec::new(),
            column_collation_deviations: Vec::new(),
            policies: Vec::new(),
            rules: Vec::new(),
        }
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_schema_manifest_binds_every_semantic_object_class() {
        assert_eq!(
            SOURCE_INTAKE_RELATION_SECURITY.len(),
            SOURCE_INTAKE_RELATIONS.len()
        );
        assert_eq!(SOURCE_INTAKE_CONSTRAINTS.len(), 29);
        assert_eq!(SOURCE_INTAKE_INDEXES.len(), 15);
        assert_eq!(SOURCE_INTAKE_TRIGGERS.len(), 6);
        assert_eq!(
            SOURCE_INTAKE_FUNCTIONS.len(),
            SOURCE_INTAKE_FUNCTION_NAMES.len()
        );
        assert_eq!(SOURCE_INTAKE_FUNCTIONS.len(), 16);
        assert_eq!(SOURCE_INTAKE_COLUMN_DEFAULTS.len(), 19);
        let mut migration_functions = SOURCE_INTAKE_MIGRATION_SQL_V1
            .iter()
            .filter_map(|statement| {
                statement
                    .strip_prefix("CREATE OR REPLACE FUNCTION rd_owner_api.")
                    .and_then(|definition| definition.split('(').next())
            })
            .collect::<Vec<_>>();
        migration_functions.sort_unstable();
        migration_functions.dedup();
        assert_eq!(migration_functions, SOURCE_INTAKE_FUNCTION_NAMES);
        let mut migration_relations = SOURCE_INTAKE_MIGRATION_SQL_V1
            .iter()
            .filter_map(|statement| {
                statement
                    .strip_prefix("CREATE TABLE public.")
                    .and_then(|definition| definition.split_whitespace().next())
            })
            .collect::<Vec<_>>();
        migration_relations.sort_unstable();
        assert_eq!(migration_relations, SOURCE_INTAKE_RELATIONS);
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");

        for catalog_class in [
            "pg_catalog.pg_constraint",
            "pg_catalog.pg_index",
            "pg_catalog.pg_trigger",
            "pg_catalog.pg_proc",
            "function_record.proowner",
            "function_record.prosecdef",
            "function_record.proconfig",
            "function_record.proacl",
            "relation.relacl",
            "attribute.attacl IS NOT NULL",
            "attribute.attcollation<>type_record.typcollation",
            "pg_catalog.pg_policy",
            "pg_catalog.pg_rewrite",
        ] {
            assert!(source.contains(catalog_class), "missing {catalog_class}");
        }
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    #[rstest]
    fn sealed_schema_validation_is_transactional_and_materialization_is_explicit() {
        let source = include_str!("source_intake.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module");
        assert!(source.contains("let mut transaction = owner_pool"));
        assert!(source.contains("pg_advisory_xact_lock"));
        assert!(
            source.contains(
                "SourceIntakeRelationFamilyState::FullyAbsent if materialize_fully_absent"
            )
        );
        assert!(source.contains("for (index, statement) in SOURCE_INTAKE_MIGRATION_SQL_V1"));
        assert!(source.contains(".execute(&mut *transaction)"));
        assert!(source.contains("relation family is partial or malformed"));
        assert!(source.contains("transaction\n        .commit()"));
    }
}
