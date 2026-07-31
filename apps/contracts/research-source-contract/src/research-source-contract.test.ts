import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  ResearchCitationValidationError,
  ResearchSourceIdentityConflictError,
  buildCitedFindingSet,
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
  type CitedFindingSet,
  type CitedResearchFindingDraft,
  type JSONValue,
  type ResearchChunkDraft,
  type ResearchChunkSet,
  type ResearchProducerContract,
  type ResearchSemanticProducerReceipt,
  type ResearchSourceLocator,
  type ResearchSourceAcquisitionReceipt,
  type ResearchSourceRevision,
} from "./research-source-contract"

interface GoldenFixture {
  source_utf8: string
  source: ResearchSourceLocator
  published_at: string
  available_at: string
  fetched_at: string
  chunk_producer: ResearchProducerContract
  chunks: ResearchChunkDraft[]
  finding_producer: Omit<ResearchSemanticProducerReceipt, "input_artifact_refs" | "prompt_hash"> & { prompt_text: string }
  findings: CitedResearchFindingDraft[]
  expected: {
    source_revision_id: string
    source_content_hash: string
    acquisition_receipt_id: string
    chunk_set_id: string
    chunk_set_content_hash: string
    chunk_ids: string[]
    producer_config_hash: string
    prompt_hash: string
    producer_receipt_hash: string
    finding_set_id: string
    finding_set_content_hash: string
    finding_ids: string[]
    citation_ids: string[]
  }
}

test("golden source, chunk, finding, and citation identities remain stable", () => {
  const { source, acquisition, chunkSet, findingSet } = buildGolden()
  const expected = fixture.expected

  assert.equal(source.source_revision_id, expected.source_revision_id)
  assert.equal(source.content_hash, expected.source_content_hash)
  assert.equal(acquisition.acquisition_receipt_id, expected.acquisition_receipt_id)
  assert.equal(chunkSet.chunk_set_id, expected.chunk_set_id)
  assert.equal(chunkSet.content_hash, expected.chunk_set_content_hash)
  assert.deepEqual(chunkSet.chunks.map((chunk) => chunk.chunk_id), expected.chunk_ids)
  assert.equal(chunkSet.producer_config_hash, expected.producer_config_hash)
  assert.equal(findingSet.producer_receipt.prompt_hash, expected.prompt_hash)
  assert.equal(findingSet.producer_receipt_hash, expected.producer_receipt_hash)
  assert.equal(findingSet.finding_set_id, expected.finding_set_id)
  assert.equal(findingSet.content_hash, expected.finding_set_content_hash)
  assert.deepEqual(findingSet.findings.map((finding) => finding.finding_id), expected.finding_ids)
  assert.deepEqual(findingSet.findings.flatMap((finding) => finding.citations.map((citation) => citation.citation_id)), expected.citation_ids)

  validateResearchSourceRevision(source, new TextEncoder().encode(fixture.source_utf8))
  validateResearchSourceAcquisition(acquisition)
  validateResearchChunkSet(chunkSet)
  validateCitedFindingSet(findingSet, chunkSet)
})

test("canonical JSON sorts keys, preserves array order, and normalizes negative zero", () => {
  assert.equal(canonicalJSONString({ z: 1, a: { y: -0, x: [2, 1] } }), '{"a":{"x":[2,1],"y":0},"z":1}')
  assert.throws(() => canonicalJSONString({ invalid: Number.NaN }), /non-finite/)
})

test("source acquisitions reject absolute paths and invalid time order while revisions bind exact bytes", () => {
  const source = createResearchSourceRevision({ bytes: new TextEncoder().encode("pdf") })
  assert.throws(() => createResearchSourceAcquisition({
    source_revision_id: source.source_revision_id,
    source: { kind: "local", locator: "/private/paper.pdf" },
    available_at: "2026-07-19T00:00:00Z",
    fetched_at: "2026-07-20T00:00:00Z",
  }), /repository-relative/)
  assert.throws(() => createResearchSourceAcquisition({
    source_revision_id: source.source_revision_id,
    source: { kind: "local", locator: "tmp/paper.pdf" },
    available_at: "2026-07-21T00:00:00Z",
    fetched_at: "2026-07-20T00:00:00Z",
  }), /available_at must not be after fetched_at/)

  const golden = buildGolden().source
  assert.throws(() => validateResearchSourceRevision(golden, new TextEncoder().encode("changed")), /byte length mismatch|bytes hash mismatch/)
})

test("one content revision can have multiple append-only acquisition receipts", () => {
  const source = createResearchSourceRevision({ bytes: new TextEncoder().encode("same exact PDF bytes") })
  const local = createResearchSourceAcquisition({
    source_revision_id: source.source_revision_id,
    source: { kind: "local", locator: "tmp/papers/paper.pdf" },
    available_at: "2026-07-19T00:00:00Z",
    fetched_at: "2026-07-20T00:00:00Z",
  })
  const arxiv = createResearchSourceAcquisition({
    source_revision_id: source.source_revision_id,
    source: { kind: "arxiv", locator: "arxiv:2607.12345", version: "v1" },
    available_at: "2026-07-18T00:00:00Z",
    fetched_at: "2026-07-20T00:00:00Z",
  })

  assert.equal(local.source_revision_id, arxiv.source_revision_id)
  assert.notEqual(local.acquisition_receipt_id, arxiv.acquisition_receipt_id)
  validateResearchSourceAcquisition(local)
  validateResearchSourceAcquisition(arxiv)
})

test("chunk-set validation fails closed on content and identity tampering", () => {
  const { chunkSet } = buildGolden()
  const tampered = structuredClone(chunkSet)
  tampered.chunks[0]!.text = "tampered"
  assert.throws(() => validateResearchChunkSet(tampered), /chunk content hash mismatch/)

  const changedProducer = createResearchChunkSet({
    source_revision_id: chunkSet.source_revision_id,
    producer: { ...chunkSet.producer, producer_version: "0.2.0" },
    chunks: fixture.chunks,
  })
  assert.notEqual(changedProducer.chunk_set_id, chunkSet.chunk_set_id)
})

test("citation resolver rejects unknown chunks, foreign pages, and non-exact quotes", () => {
  const { chunkSet, producerReceipt } = buildGoldenInputs()
  const base = fixture.findings[0]!

  for (const invalidCitation of [
    { chunk_position: 99, page: 1, quote: "Funding" },
    { chunk_position: 0, page: 2, quote: "Funding" },
    { chunk_position: 0, page: 1, quote: "funding payments transfer value" },
  ]) {
    assert.throws(() => buildCitedFindingSet({
      chunk_set: chunkSet,
      producer_receipt: producerReceipt,
      findings: [{ ...base, citations: [invalidCitation] }],
    }), ResearchCitationValidationError)
  }
})

test("semantic output changes and invocation changes mint new append-only identities", () => {
  const { chunkSet, producerReceipt } = buildGoldenInputs()
  const original = buildCitedFindingSet({
    chunk_set: chunkSet,
    producer_receipt: producerReceipt,
    findings: fixture.findings,
    min_citations: 2,
    min_distinct_pages: 2,
  })
  const changedOutput = buildCitedFindingSet({
    chunk_set: chunkSet,
    producer_receipt: producerReceipt,
    findings: [{ ...fixture.findings[0]!, claim: "A different semantic model output." }],
    min_citations: 2,
    min_distinct_pages: 2,
  })
  const changedInvocation = buildCitedFindingSet({
    chunk_set: chunkSet,
    producer_receipt: { ...producerReceipt, invocation_id: "fixture-run-002" },
    findings: fixture.findings,
    min_citations: 2,
    min_distinct_pages: 2,
  })

  assert.notEqual(changedOutput.finding_set_id, original.finding_set_id)
  assert.notEqual(changedInvocation.finding_set_id, original.finding_set_id)
  assert.equal(classifyCanonicalPut(undefined, original as unknown as JSONValue), "created")
  assert.equal(classifyCanonicalPut(original as unknown as JSONValue, structuredClone(original) as unknown as JSONValue), "identical")
  assert.throws(
    () => classifyCanonicalPut(original as unknown as JSONValue, { ...changedOutput, finding_set_id: original.finding_set_id } as unknown as JSONValue),
    ResearchSourceIdentityConflictError,
  )

  const forged = structuredClone(changedOutput) as CitedFindingSet
  forged.finding_set_id = original.finding_set_id
  assert.throws(() => validateCitedFindingSet(forged, chunkSet), /finding-set ID mismatch/)
})

test("minimum citation and distinct-page coverage is code-owned", () => {
  const { chunkSet, producerReceipt } = buildGoldenInputs()
  assert.throws(() => buildCitedFindingSet({
    chunk_set: chunkSet,
    producer_receipt: producerReceipt,
    findings: [{ ...fixture.findings[0]!, citations: [fixture.findings[0]!.citations[0]!] }],
    min_citations: 2,
  }), /fewer than 2 citations/)
  assert.throws(() => buildCitedFindingSet({
    chunk_set: chunkSet,
    producer_receipt: producerReceipt,
    findings: [{
      ...fixture.findings[0]!,
      citations: [
        fixture.findings[0]!.citations[0]!,
        { chunk_position: 0, page: 1, quote: "crowded long and short participants" },
      ],
    }],
    min_citations: 2,
    min_distinct_pages: 2,
  }), /fewer than 2 distinct citation pages/)
})

function buildGolden(): {
  source: ResearchSourceRevision
  acquisition: ResearchSourceAcquisitionReceipt
  chunkSet: ResearchChunkSet
  findingSet: CitedFindingSet
} {
  const { source, acquisition, chunkSet, producerReceipt } = buildGoldenInputs()
  return {
    source,
    acquisition,
    chunkSet,
    findingSet: buildCitedFindingSet({
      chunk_set: chunkSet,
      producer_receipt: producerReceipt,
      findings: fixture.findings,
      min_citations: 2,
      min_distinct_pages: 2,
    }),
  }
}

function buildGoldenInputs(): {
  source: ResearchSourceRevision
  acquisition: ResearchSourceAcquisitionReceipt
  chunkSet: ResearchChunkSet
  producerReceipt: ResearchSemanticProducerReceipt
} {
  const source = createResearchSourceRevision({
    bytes: new TextEncoder().encode(fixture.source_utf8),
  })
  const acquisition = createResearchSourceAcquisition({
    source_revision_id: source.source_revision_id,
    source: fixture.source,
    published_at: fixture.published_at,
    available_at: fixture.available_at,
    fetched_at: fixture.fetched_at,
  })
  const chunkSet = createResearchChunkSet({
    source_revision_id: source.source_revision_id,
    producer: fixture.chunk_producer,
    chunks: fixture.chunks,
  })
  const { prompt_text: promptText, ...findingProducer } = fixture.finding_producer
  return {
    source,
    acquisition,
    chunkSet,
    producerReceipt: {
      ...findingProducer,
      prompt_hash: sha256Hex(promptText),
      input_artifact_refs: [chunkSet.chunk_set_id],
    },
  }
}

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/research-source-golden-v1.json", import.meta.url),
  "utf8",
)) as GoldenFixture
