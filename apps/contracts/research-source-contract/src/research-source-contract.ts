import { createHash } from "node:crypto"
import { isAbsolute } from "node:path"

type JSONPrimitive = boolean | null | number | string
type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue }
type JSONRecord = Record<string, JSONValue>

const SOURCE_SCHEMA_VERSION = "trade.research-source-revision.v1" as const
const SOURCE_ACQUISITION_SCHEMA_VERSION = "trade.research-source-acquisition.v1" as const
const CHUNK_SET_SCHEMA_VERSION = "trade.research-chunk-set.v1" as const
const FINDING_SET_SCHEMA_VERSION = "trade.cited-finding-set.v1" as const
const IDENTITY_POLICY_VERSION = "trade.research-source-identity.sha256-canonical-json.v1" as const
const SHA256_PATTERN = /^[0-9a-f]{64}$/

interface ResearchSourceLocator {
  kind: "arxiv" | "local"
  locator: string
  version?: string
}

interface ResearchSourceRevision {
  schema_version: typeof SOURCE_SCHEMA_VERSION
  identity_policy_version: typeof IDENTITY_POLICY_VERSION
  source_revision_id: string
  content_hash: string
  byte_length: number
  media_type: "application/pdf"
}

interface ResearchSourceAcquisitionReceipt {
  schema_version: typeof SOURCE_ACQUISITION_SCHEMA_VERSION
  identity_policy_version: typeof IDENTITY_POLICY_VERSION
  acquisition_receipt_id: string
  source_revision_id: string
  source: ResearchSourceLocator
  published_at?: string
  available_at: string
  fetched_at: string
}

interface ResearchSourceRevisionInput {
  bytes: Uint8Array
}

interface ResearchSourceAcquisitionInput {
  source_revision_id: string
  source: ResearchSourceLocator
  published_at?: string
  available_at: string
  fetched_at: string
}

interface ResearchSourceSpan {
  page_number: number
  block_index: number
}

interface ResearchChunkDraft {
  text: string
  source_spans: ResearchSourceSpan[]
}

interface ResearchProducerContract {
  producer_id: string
  producer_version: string
  config: JSONRecord
}

interface ResearchChunk {
  chunk_id: string
  position: number
  text: string
  content_hash: string
  source_spans: ResearchSourceSpan[]
}

interface ResearchChunkSet {
  schema_version: typeof CHUNK_SET_SCHEMA_VERSION
  identity_policy_version: typeof IDENTITY_POLICY_VERSION
  chunk_set_id: string
  source_revision_id: string
  producer: ResearchProducerContract
  producer_config_hash: string
  content_hash: string
  chunks: ResearchChunk[]
}

interface ResearchCitationDraft {
  chunk_position: number
  page: number
  quote: string
}

interface ResearchCitation {
  citation_id: string
  chunk_set_id: string
  chunk_id: string
  page: number
  quote: string
  quote_start: number
  quote_end: number
}

type ResearchFindingStance = "contradicts" | "limits" | "supports"

interface CitedResearchFindingDraft {
  stance: ResearchFindingStance
  claim: string
  mechanism: string
  participants: string
  regime: string
  falsifier: string
  data_surfaces: string[]
  limitations: string[]
  citations: ResearchCitationDraft[]
}

interface CitedResearchFinding extends Omit<CitedResearchFindingDraft, "citations"> {
  finding_id: string
  position: number
  citations: ResearchCitation[]
}

interface ResearchSemanticProducerReceipt {
  producer_id: string
  producer_version: string
  invocation_id: string
  model_id: string
  prompt_hash: string
  input_artifact_refs: string[]
  config: JSONRecord
}

interface CitedFindingSet {
  schema_version: typeof FINDING_SET_SCHEMA_VERSION
  identity_policy_version: typeof IDENTITY_POLICY_VERSION
  finding_set_id: string
  source_revision_id: string
  input_chunk_set_id: string
  producer_receipt: ResearchSemanticProducerReceipt
  producer_receipt_hash: string
  content_hash: string
  findings: CitedResearchFinding[]
}

interface BuildCitedFindingSetInput {
  chunk_set: ResearchChunkSet
  producer_receipt: ResearchSemanticProducerReceipt
  findings: CitedResearchFindingDraft[]
  min_citations?: number
  min_distinct_pages?: number
}

type CanonicalPutResult = "created" | "identical"

class ResearchSourceContractError extends Error {}
class ResearchSourceIdentityConflictError extends ResearchSourceContractError {}
class ResearchCitationValidationError extends ResearchSourceContractError {}

function canonicalJSONString(value: JSONValue): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalHash(value: JSONValue): string {
  return sha256Hex(canonicalJSONString(value))
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function createResearchSourceRevision(input: ResearchSourceRevisionInput): ResearchSourceRevision {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    throw new ResearchSourceContractError("source bytes must be non-empty")
  }
  const contentHash = sha256Hex(input.bytes)
  return {
    schema_version: SOURCE_SCHEMA_VERSION,
    identity_policy_version: IDENTITY_POLICY_VERSION,
    source_revision_id: contentAddressedID("research-source-revision", contentHash),
    content_hash: contentHash,
    byte_length: input.bytes.byteLength,
    media_type: "application/pdf",
  }
}

function createResearchSourceAcquisition(input: ResearchSourceAcquisitionInput): ResearchSourceAcquisitionReceipt {
  requireContentAddressedID(input.source_revision_id, "research-source-revision", "source_revision_id")
  const source = normalizeSourceLocator(input.source)
  validateSourceTimes(input.published_at, input.available_at, input.fetched_at)
  const identity: JSONRecord = {
    source_revision_id: input.source_revision_id,
    source: source as unknown as JSONRecord,
    ...(input.published_at ? { published_at: input.published_at } : {}),
    available_at: input.available_at,
    fetched_at: input.fetched_at,
  }
  return {
    schema_version: SOURCE_ACQUISITION_SCHEMA_VERSION,
    identity_policy_version: IDENTITY_POLICY_VERSION,
    acquisition_receipt_id: canonicalID("research-source-acquisition", identity),
    source_revision_id: input.source_revision_id,
    source,
    ...(input.published_at ? { published_at: input.published_at } : {}),
    available_at: input.available_at,
    fetched_at: input.fetched_at,
  }
}

function validateResearchSourceRevision(value: ResearchSourceRevision, bytes?: Uint8Array): void {
  if (value.schema_version !== SOURCE_SCHEMA_VERSION) throw new ResearchSourceContractError("source schema version mismatch")
  if (value.identity_policy_version !== IDENTITY_POLICY_VERSION) throw new ResearchSourceContractError("source identity policy mismatch")
  requireSha256(value.content_hash, "source content_hash")
  if (value.source_revision_id !== contentAddressedID("research-source-revision", value.content_hash)) {
    throw new ResearchSourceContractError("source revision ID does not match content hash")
  }
  if (!Number.isSafeInteger(value.byte_length) || value.byte_length <= 0) {
    throw new ResearchSourceContractError("source byte_length must be a positive safe integer")
  }
  if (value.media_type !== "application/pdf") throw new ResearchSourceContractError("source media_type must be application/pdf")
  if (bytes) {
    if (bytes.byteLength !== value.byte_length) throw new ResearchSourceContractError("source byte length mismatch")
    if (sha256Hex(bytes) !== value.content_hash) throw new ResearchSourceContractError("source bytes hash mismatch")
  }
}

function validateResearchSourceAcquisition(value: ResearchSourceAcquisitionReceipt): void {
  if (value.schema_version !== SOURCE_ACQUISITION_SCHEMA_VERSION) throw new ResearchSourceContractError("source acquisition schema version mismatch")
  if (value.identity_policy_version !== IDENTITY_POLICY_VERSION) throw new ResearchSourceContractError("source acquisition identity policy mismatch")
  requireContentAddressedID(value.source_revision_id, "research-source-revision", "source_revision_id")
  const source = normalizeSourceLocator(value.source)
  if (canonicalJSONString(value.source as unknown as JSONValue) !== canonicalJSONString(source as unknown as JSONValue)) {
    throw new ResearchSourceContractError("source acquisition locator is not canonical")
  }
  validateSourceTimes(value.published_at, value.available_at, value.fetched_at)
  const expectedID = canonicalID("research-source-acquisition", {
    source_revision_id: value.source_revision_id,
    source: source as unknown as JSONRecord,
    ...(value.published_at ? { published_at: value.published_at } : {}),
    available_at: value.available_at,
    fetched_at: value.fetched_at,
  })
  if (value.acquisition_receipt_id !== expectedID) throw new ResearchSourceContractError("source acquisition receipt ID mismatch")
}

function createResearchChunkSet(input: {
  source_revision_id: string
  producer: ResearchProducerContract
  chunks: ResearchChunkDraft[]
}): ResearchChunkSet {
  requireContentAddressedID(input.source_revision_id, "research-source-revision", "source_revision_id")
  validateProducerContract(input.producer)
  if (input.chunks.length === 0) throw new ResearchSourceContractError("chunk set must contain at least one chunk")
  const chunks = input.chunks.map((draft, position) => createChunk(input.source_revision_id, draft, position))
  const producerConfigHash = canonicalHash(producerContractIdentity(input.producer))
  const contentHash = canonicalHash(chunks.map(chunkContentIdentity))
  const chunkSetID = canonicalID("research-chunk-set", {
    source_revision_id: input.source_revision_id,
    producer_config_hash: producerConfigHash,
    content_hash: contentHash,
  })
  return {
    schema_version: CHUNK_SET_SCHEMA_VERSION,
    identity_policy_version: IDENTITY_POLICY_VERSION,
    chunk_set_id: chunkSetID,
    source_revision_id: input.source_revision_id,
    producer: cloneProducerContract(input.producer),
    producer_config_hash: producerConfigHash,
    content_hash: contentHash,
    chunks,
  }
}

function validateResearchChunkSet(value: ResearchChunkSet): void {
  if (value.schema_version !== CHUNK_SET_SCHEMA_VERSION) throw new ResearchSourceContractError("chunk-set schema version mismatch")
  if (value.identity_policy_version !== IDENTITY_POLICY_VERSION) throw new ResearchSourceContractError("chunk-set identity policy mismatch")
  requireContentAddressedID(value.source_revision_id, "research-source-revision", "source_revision_id")
  validateProducerContract(value.producer)
  if (canonicalJSONString(value.producer as unknown as JSONValue) !== canonicalJSONString(cloneProducerContract(value.producer) as unknown as JSONValue)) {
    throw new ResearchSourceContractError("chunk producer contract is not canonical")
  }
  if (value.chunks.length === 0) throw new ResearchSourceContractError("chunk set must contain at least one chunk")
  const expectedProducerHash = canonicalHash(producerContractIdentity(value.producer))
  if (value.producer_config_hash !== expectedProducerHash) throw new ResearchSourceContractError("chunk producer hash mismatch")
  value.chunks.forEach((chunk, position) => validateChunk(value.source_revision_id, chunk, position))
  const expectedContentHash = canonicalHash(value.chunks.map(chunkContentIdentity))
  if (value.content_hash !== expectedContentHash) throw new ResearchSourceContractError("chunk-set content hash mismatch")
  const expectedID = canonicalID("research-chunk-set", {
    source_revision_id: value.source_revision_id,
    producer_config_hash: expectedProducerHash,
    content_hash: expectedContentHash,
  })
  if (value.chunk_set_id !== expectedID) throw new ResearchSourceContractError("chunk-set ID mismatch")
}

function buildCitedFindingSet(input: BuildCitedFindingSetInput): CitedFindingSet {
  validateResearchChunkSet(input.chunk_set)
  validateSemanticProducerReceipt(input.producer_receipt, input.chunk_set.chunk_set_id)
  if (input.findings.length === 0) throw new ResearchSourceContractError("finding set must contain at least one finding")
  const minCitations = positiveInteger(input.min_citations, 1, "min_citations")
  const minDistinctPages = positiveInteger(input.min_distinct_pages, 1, "min_distinct_pages")
  const findings = input.findings.map((draft, position) => resolveFinding(
    input.chunk_set,
    draft,
    position,
    minCitations,
    minDistinctPages,
  ))
  const producerReceipt = cloneSemanticProducerReceipt(input.producer_receipt)
  const producerReceiptHash = canonicalHash(semanticProducerReceiptIdentity(producerReceipt))
  const contentHash = canonicalHash(findings.map(findingContentIdentity))
  const findingSetID = canonicalID("research-finding-set", {
    source_revision_id: input.chunk_set.source_revision_id,
    input_chunk_set_id: input.chunk_set.chunk_set_id,
    producer_receipt_hash: producerReceiptHash,
    content_hash: contentHash,
  })
  return {
    schema_version: FINDING_SET_SCHEMA_VERSION,
    identity_policy_version: IDENTITY_POLICY_VERSION,
    finding_set_id: findingSetID,
    source_revision_id: input.chunk_set.source_revision_id,
    input_chunk_set_id: input.chunk_set.chunk_set_id,
    producer_receipt: producerReceipt,
    producer_receipt_hash: producerReceiptHash,
    content_hash: contentHash,
    findings,
  }
}

function validateCitedFindingSet(value: CitedFindingSet, chunkSet: ResearchChunkSet): void {
  validateResearchChunkSet(chunkSet)
  if (value.schema_version !== FINDING_SET_SCHEMA_VERSION) throw new ResearchSourceContractError("finding-set schema version mismatch")
  if (value.identity_policy_version !== IDENTITY_POLICY_VERSION) throw new ResearchSourceContractError("finding-set identity policy mismatch")
  if (value.source_revision_id !== chunkSet.source_revision_id) throw new ResearchSourceContractError("finding-set source revision mismatch")
  if (value.input_chunk_set_id !== chunkSet.chunk_set_id) throw new ResearchSourceContractError("finding-set input chunk set mismatch")
  validateSemanticProducerReceipt(value.producer_receipt, chunkSet.chunk_set_id)
  const expectedProducerHash = canonicalHash(semanticProducerReceiptIdentity(value.producer_receipt))
  if (value.producer_receipt_hash !== expectedProducerHash) throw new ResearchSourceContractError("finding producer receipt hash mismatch")
  if (value.findings.length === 0) throw new ResearchSourceContractError("finding set must contain at least one finding")
  value.findings.forEach((finding, position) => validateResolvedFinding(chunkSet, finding, position))
  const expectedContentHash = canonicalHash(value.findings.map(findingContentIdentity))
  if (value.content_hash !== expectedContentHash) throw new ResearchSourceContractError("finding-set content hash mismatch")
  const expectedID = canonicalID("research-finding-set", {
    source_revision_id: chunkSet.source_revision_id,
    input_chunk_set_id: chunkSet.chunk_set_id,
    producer_receipt_hash: expectedProducerHash,
    content_hash: expectedContentHash,
  })
  if (value.finding_set_id !== expectedID) throw new ResearchSourceContractError("finding-set ID mismatch")
}

function classifyCanonicalPut(existing: JSONValue | undefined, candidate: JSONValue): CanonicalPutResult {
  if (existing === undefined) return "created"
  if (canonicalJSONString(existing) === canonicalJSONString(candidate)) return "identical"
  throw new ResearchSourceIdentityConflictError("canonical identity already exists with different content")
}

function createChunk(sourceRevisionID: string, draft: ResearchChunkDraft, position: number): ResearchChunk {
  const text = requireNonEmptyText(draft.text, `chunks[${position}].text`)
  const sourceSpans = normalizeSourceSpans(draft.source_spans, `chunks[${position}].source_spans`)
  const contentHash = sha256Hex(text)
  const chunkID = canonicalID("research-source-chunk", {
    source_revision_id: sourceRevisionID,
    position,
    content_hash: contentHash,
    source_spans: sourceSpans.map((span) => ({ ...span })),
  })
  return { chunk_id: chunkID, position, text, content_hash: contentHash, source_spans: sourceSpans }
}

function validateChunk(sourceRevisionID: string, chunk: ResearchChunk, position: number): void {
  if (chunk.position !== position) throw new ResearchSourceContractError(`chunk position mismatch at ${position}`)
  const text = requireNonEmptyText(chunk.text, `chunks[${position}].text`)
  const spans = normalizeSourceSpans(chunk.source_spans, `chunks[${position}].source_spans`)
  const expectedContentHash = sha256Hex(text)
  if (chunk.content_hash !== expectedContentHash) throw new ResearchSourceContractError(`chunk content hash mismatch at ${position}`)
  const expectedID = canonicalID("research-source-chunk", {
    source_revision_id: sourceRevisionID,
    position,
    content_hash: expectedContentHash,
    source_spans: spans.map((span) => ({ ...span })),
  })
  if (chunk.chunk_id !== expectedID) throw new ResearchSourceContractError(`chunk ID mismatch at ${position}`)
}

function resolveFinding(
  chunkSet: ResearchChunkSet,
  draft: CitedResearchFindingDraft,
  position: number,
  minCitations: number,
  minDistinctPages: number,
): CitedResearchFinding {
  validateFindingDraft(draft, position)
  const citations = deduplicateCitations(draft.citations.map((citation) => resolveCitation(chunkSet, citation)))
  if (citations.length < minCitations) {
    throw new ResearchCitationValidationError(`finding ${position} has fewer than ${minCitations} citations`)
  }
  if (new Set(citations.map((citation) => citation.page)).size < minDistinctPages) {
    throw new ResearchCitationValidationError(`finding ${position} has fewer than ${minDistinctPages} distinct citation pages`)
  }
  const body = normalizedFindingBody(draft)
  const findingID = canonicalID("research-finding", {
    position,
    ...body,
    citation_ids: citations.map((citation) => citation.citation_id),
  })
  return { finding_id: findingID, position, ...body, citations }
}

function resolveCitation(chunkSet: ResearchChunkSet, draft: ResearchCitationDraft): ResearchCitation {
  if (!Number.isSafeInteger(draft.chunk_position) || draft.chunk_position < 0) {
    throw new ResearchCitationValidationError("citation chunk_position must be a non-negative safe integer")
  }
  if (!Number.isSafeInteger(draft.page) || draft.page < 1) {
    throw new ResearchCitationValidationError("citation page must be a positive safe integer")
  }
  const quote = requireNonEmptyText(draft.quote, "citation quote")
  const chunk = chunkSet.chunks[draft.chunk_position]
  if (!chunk) throw new ResearchCitationValidationError("citation references an unknown chunk position")
  if (!chunk.source_spans.some((span) => span.page_number === draft.page)) {
    throw new ResearchCitationValidationError("citation page is not owned by the referenced chunk")
  }
  const quoteStart = chunk.text.indexOf(quote)
  if (quoteStart < 0) throw new ResearchCitationValidationError("citation quote is not an exact substring of the referenced chunk")
  const citationID = canonicalID("research-citation", {
    chunk_set_id: chunkSet.chunk_set_id,
    chunk_id: chunk.chunk_id,
    page: draft.page,
    quote,
    quote_start: quoteStart,
  })
  return {
    citation_id: citationID,
    chunk_set_id: chunkSet.chunk_set_id,
    chunk_id: chunk.chunk_id,
    page: draft.page,
    quote,
    quote_start: quoteStart,
    quote_end: quoteStart + quote.length,
  }
}

function validateResolvedFinding(chunkSet: ResearchChunkSet, finding: CitedResearchFinding, position: number): void {
  if (finding.position !== position) throw new ResearchSourceContractError(`finding position mismatch at ${position}`)
  validateFindingBody(finding, position)
  if (finding.citations.length === 0) throw new ResearchCitationValidationError(`finding ${position} must contain citations`)
  for (const citation of finding.citations) {
    const chunkPosition = chunkSet.chunks.findIndex((chunk) => chunk.chunk_id === citation.chunk_id)
    if (citation.chunk_set_id !== chunkSet.chunk_set_id || chunkPosition < 0) {
      throw new ResearchCitationValidationError(`finding ${position} contains a foreign citation`)
    }
    const resolved = resolveCitation(chunkSet, {
      chunk_position: chunkPosition,
      page: citation.page,
      quote: citation.quote,
    })
    if (canonicalJSONString(resolved as unknown as JSONValue) !== canonicalJSONString(citation as unknown as JSONValue)) {
      throw new ResearchCitationValidationError(`finding ${position} citation identity mismatch`)
    }
  }
  const body = normalizedFindingBody(finding)
  const expectedID = canonicalID("research-finding", {
    position,
    ...body,
    citation_ids: finding.citations.map((citation) => citation.citation_id),
  })
  if (finding.finding_id !== expectedID) throw new ResearchSourceContractError(`finding ID mismatch at ${position}`)
}

function validateFindingDraft(draft: CitedResearchFindingDraft, position: number): void {
  validateFindingBody(draft, position)
  if (!Array.isArray(draft.citations) || draft.citations.length === 0) {
    throw new ResearchCitationValidationError(`findings[${position}].citations must be non-empty`)
  }
}

function validateFindingBody(
  draft: Omit<CitedResearchFindingDraft, "citations">,
  position: number,
): void {
  if (!["contradicts", "limits", "supports"].includes(draft.stance)) {
    throw new ResearchSourceContractError(`findings[${position}].stance is invalid`)
  }
  for (const field of ["claim", "mechanism", "participants", "regime", "falsifier"] as const) {
    requireNonEmptyText(draft[field], `findings[${position}].${field}`)
  }
  normalizeStringArray(draft.data_surfaces, `findings[${position}].data_surfaces`)
  normalizeStringArray(draft.limitations, `findings[${position}].limitations`)
}

function normalizedFindingBody(
  draft: Omit<CitedResearchFindingDraft, "citations">,
): Omit<CitedResearchFindingDraft, "citations"> {
  return {
    stance: draft.stance,
    claim: draft.claim.trim(),
    mechanism: draft.mechanism.trim(),
    participants: draft.participants.trim(),
    regime: draft.regime.trim(),
    falsifier: draft.falsifier.trim(),
    data_surfaces: normalizeStringArray(draft.data_surfaces, "data_surfaces"),
    limitations: normalizeStringArray(draft.limitations, "limitations"),
  }
}

function normalizeSourceLocator(source: ResearchSourceLocator): ResearchSourceLocator {
  const locator = requireNonEmptyText(source.locator, "source.locator")
  if (source.kind === "local") {
    if (isAbsolute(locator) || locator.startsWith("file:") || locator.split(/[\\/]/).includes("..")) {
      throw new ResearchSourceContractError("local source locator must be repository-relative")
    }
    if (source.version) throw new ResearchSourceContractError("local source locator must not declare an external version")
    return { kind: "local", locator }
  }
  if (source.kind === "arxiv") {
    const version = requireNonEmptyText(source.version, "source.version")
    return { kind: "arxiv", locator, version }
  }
  throw new ResearchSourceContractError("source.kind must be local or arxiv")
}

function validateSourceTimes(publishedAt: string | undefined, availableAt: string, fetchedAt: string): void {
  validateTimestamp(availableAt, "available_at")
  validateTimestamp(fetchedAt, "fetched_at")
  if (publishedAt) validateTimestamp(publishedAt, "published_at")
  if (Date.parse(availableAt) > Date.parse(fetchedAt)) {
    throw new ResearchSourceContractError("available_at must not be after fetched_at")
  }
  if (publishedAt && Date.parse(publishedAt) > Date.parse(availableAt)) {
    throw new ResearchSourceContractError("published_at must not be after available_at")
  }
}

function validateProducerContract(producer: ResearchProducerContract): void {
  requireNonEmptyText(producer.producer_id, "producer.producer_id")
  requireNonEmptyText(producer.producer_version, "producer.producer_version")
  assertJSONRecord(producer.config, "producer.config")
}

function validateSemanticProducerReceipt(receipt: ResearchSemanticProducerReceipt, chunkSetID: string): void {
  requireNonEmptyText(receipt.producer_id, "producer_receipt.producer_id")
  requireNonEmptyText(receipt.producer_version, "producer_receipt.producer_version")
  requireNonEmptyText(receipt.invocation_id, "producer_receipt.invocation_id")
  requireNonEmptyText(receipt.model_id, "producer_receipt.model_id")
  requireSha256(receipt.prompt_hash, "producer_receipt.prompt_hash")
  const refs = normalizeStringArray(receipt.input_artifact_refs, "producer_receipt.input_artifact_refs")
  if (!refs.includes(chunkSetID)) throw new ResearchSourceContractError("producer receipt must reference the input chunk set")
  const canonicalRefs = normalizeRefArray(receipt.input_artifact_refs, "producer_receipt.input_artifact_refs")
  if (canonicalJSONString(receipt.input_artifact_refs) !== canonicalJSONString(canonicalRefs)) {
    throw new ResearchSourceContractError("producer receipt input refs are not canonical")
  }
  assertJSONRecord(receipt.config, "producer_receipt.config")
}

function producerContractIdentity(producer: ResearchProducerContract): JSONRecord {
  return {
    producer_id: producer.producer_id.trim(),
    producer_version: producer.producer_version.trim(),
    config: canonicalize(producer.config) as JSONRecord,
  }
}

function semanticProducerReceiptIdentity(receipt: ResearchSemanticProducerReceipt): JSONRecord {
  return {
    producer_id: receipt.producer_id.trim(),
    producer_version: receipt.producer_version.trim(),
    invocation_id: receipt.invocation_id.trim(),
    model_id: receipt.model_id.trim(),
    prompt_hash: receipt.prompt_hash,
    input_artifact_refs: normalizeRefArray(receipt.input_artifact_refs, "producer_receipt.input_artifact_refs"),
    config: canonicalize(receipt.config) as JSONRecord,
  }
}

function cloneProducerContract(producer: ResearchProducerContract): ResearchProducerContract {
  return {
    producer_id: producer.producer_id.trim(),
    producer_version: producer.producer_version.trim(),
    config: structuredClone(canonicalize(producer.config) as JSONRecord),
  }
}

function cloneSemanticProducerReceipt(receipt: ResearchSemanticProducerReceipt): ResearchSemanticProducerReceipt {
  return {
    producer_id: receipt.producer_id.trim(),
    producer_version: receipt.producer_version.trim(),
    invocation_id: receipt.invocation_id.trim(),
    model_id: receipt.model_id.trim(),
    prompt_hash: receipt.prompt_hash,
    input_artifact_refs: normalizeRefArray(receipt.input_artifact_refs, "producer_receipt.input_artifact_refs"),
    config: structuredClone(canonicalize(receipt.config) as JSONRecord),
  }
}

function chunkContentIdentity(chunk: ResearchChunk): JSONRecord {
  return {
    chunk_id: chunk.chunk_id,
    position: chunk.position,
    content_hash: chunk.content_hash,
    text: chunk.text,
    source_spans: chunk.source_spans.map((span) => ({ ...span })),
  }
}

function findingContentIdentity(finding: CitedResearchFinding): JSONRecord {
  return {
    finding_id: finding.finding_id,
    position: finding.position,
    stance: finding.stance,
    claim: finding.claim,
    mechanism: finding.mechanism,
    participants: finding.participants,
    regime: finding.regime,
    falsifier: finding.falsifier,
    data_surfaces: [...finding.data_surfaces],
    limitations: [...finding.limitations],
    citations: finding.citations.map((citation) => ({ ...citation })),
  }
}

function normalizeSourceSpans(value: ResearchSourceSpan[], field: string): ResearchSourceSpan[] {
  if (!Array.isArray(value) || value.length === 0) throw new ResearchSourceContractError(`${field} must be non-empty`)
  const spans = value.map((span, index) => {
    if (!Number.isSafeInteger(span.page_number) || span.page_number < 1) {
      throw new ResearchSourceContractError(`${field}[${index}].page_number must be positive`)
    }
    if (!Number.isSafeInteger(span.block_index) || span.block_index < 0) {
      throw new ResearchSourceContractError(`${field}[${index}].block_index must be non-negative`)
    }
    return { page_number: span.page_number, block_index: span.block_index }
  })
  return [...new Map(spans.map((span) => [`${span.page_number}:${span.block_index}`, span])).values()]
    .sort((a, b) => a.page_number - b.page_number || a.block_index - b.block_index)
}

function normalizeStringArray(value: string[], field: string): string[] {
  if (!Array.isArray(value)) throw new ResearchSourceContractError(`${field} must be an array`)
  const result = [...new Set(value.map((item) => requireNonEmptyText(item, field)))]
  if (result.length === 0) throw new ResearchSourceContractError(`${field} must be non-empty`)
  return result
}

function normalizeRefArray(value: string[], field: string): string[] {
  return normalizeStringArray(value, field).sort()
}

function deduplicateCitations(citations: ResearchCitation[]): ResearchCitation[] {
  return [...new Map(citations.map((citation) => [citation.citation_id, citation])).values()]
}

function canonicalID(prefix: string, value: JSONValue): string {
  return contentAddressedID(prefix, canonicalHash(value))
}

function contentAddressedID(prefix: string, hash: string): string {
  requireSha256(hash, `${prefix} hash`)
  return `${prefix}:sha256:${hash}`
}

function requireContentAddressedID(value: string, prefix: string, field: string): void {
  const expectedPrefix = `${prefix}:sha256:`
  if (!value.startsWith(expectedPrefix) || !SHA256_PATTERN.test(value.slice(expectedPrefix.length))) {
    throw new ResearchSourceContractError(`${field} must be a ${prefix} content-addressed ID`)
  }
}

function canonicalize(value: JSONValue): JSONValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ResearchSourceContractError("canonical JSON does not allow non-finite numbers")
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== "object") throw new ResearchSourceContractError("canonical JSON contains an unsupported value")
  const result: Record<string, JSONValue> = {}
  for (const key of Object.keys(value).sort()) {
    const item = value[key]
    if (item === undefined) throw new ResearchSourceContractError(`canonical JSON key ${key} is undefined`)
    result[key] = canonicalize(item)
  }
  return result
}

function assertJSONRecord(value: JSONRecord, field: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchSourceContractError(`${field} must be a JSON object`)
  canonicalize(value)
}

function requireNonEmptyText(value: string | undefined, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ResearchSourceContractError(`${field} must be non-empty`)
  return value.trim()
}

function requireSha256(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) throw new ResearchSourceContractError(`${field} must be a lowercase SHA-256 hex digest`)
}

function validateTimestamp(value: string, field: string): void {
  requireNonEmptyText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ResearchSourceContractError(`${field} must be an ISO-8601 timestamp with timezone`)
  }
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new ResearchSourceContractError(`${field} must be a positive safe integer`)
  return resolved
}

export {
  CHUNK_SET_SCHEMA_VERSION,
  FINDING_SET_SCHEMA_VERSION,
  IDENTITY_POLICY_VERSION,
  ResearchCitationValidationError,
  ResearchSourceContractError,
  ResearchSourceIdentityConflictError,
  SOURCE_ACQUISITION_SCHEMA_VERSION,
  SOURCE_SCHEMA_VERSION,
  buildCitedFindingSet,
  canonicalHash,
  canonicalJSONString,
  classifyCanonicalPut,
  createResearchChunkSet,
  createResearchSourceAcquisition,
  createResearchSourceRevision,
  sha256Hex,
  validateCitedFindingSet,
  validateResearchChunkSet,
  validateResearchSourceAcquisition,
  validateResearchSourceRevision,
  type BuildCitedFindingSetInput,
  type CanonicalPutResult,
  type CitedFindingSet,
  type CitedResearchFinding,
  type CitedResearchFindingDraft,
  type JSONRecord,
  type JSONValue,
  type ResearchChunk,
  type ResearchChunkDraft,
  type ResearchChunkSet,
  type ResearchCitation,
  type ResearchCitationDraft,
  type ResearchFindingStance,
  type ResearchProducerContract,
  type ResearchSemanticProducerReceipt,
  type ResearchSourceLocator,
  type ResearchSourceAcquisitionInput,
  type ResearchSourceAcquisitionReceipt,
  type ResearchSourceRevision,
  type ResearchSourceRevisionInput,
  type ResearchSourceSpan,
}
